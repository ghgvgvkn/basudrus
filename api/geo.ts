export const config = { runtime: "edge" };

/**
 * /api/geo — best-effort "what city is this request coming from"
 *
 * Returns `{ city, country, region }` derived from one of two sources,
 * in order of preference:
 *   1. Vercel's automatic geolocation request headers
 *      (x-vercel-ip-city / x-vercel-ip-country / x-vercel-ip-country-region).
 *      Free, accurate, zero round-trip — Vercel attaches these at the
 *      edge based on the connecting IP.
 *   2. ipapi.co fallback — only fires if header 1 came back empty.
 *      Free tier: 1k requests/day per IP. Used as defense-in-depth.
 *
 * Used by Aurora's meta strip to show the user's actual city
 * ("AMMAN", "LONDON", etc.) instead of a hardcoded label.
 *
 * Caching:
 *   - Client caches the result in localStorage for 24h so we don't
 *     hit this endpoint on every page load.
 *   - We also set a Cache-Control header on the response so Vercel's
 *     edge can short-circuit repeat lookups from the same IP for an
 *     hour at the CDN layer.
 *
 * No auth required — this is purely a convenience endpoint. The IP
 * is already public (Vercel sees it on every request). We're not
 * exposing anything new.
 */

const ALLOWED_ORIGINS = [
  "https://basudrus.com",
  "https://www.basudrus.com",
  "https://ai.basudrus.com",
  "https://basudrus.vercel.app",
  "https://basudrus-redesign.vercel.app",
  "https://basudrus-ai.vercel.app",
];

function matchOrigin(origin: string | null, allowed: string[]): boolean {
  if (!origin) return false;
  try {
    const host = new URL(origin).host.toLowerCase();
    return allowed.some((a) => {
      try { return new URL(a).host.toLowerCase() === host; } catch { return false; }
    });
  } catch { return false; }
}

function securityHeaders(origin: string | null): Record<string, string> {
  const h: Record<string, string> = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
  };
  if (matchOrigin(origin, ALLOWED_ORIGINS)) {
    h["Access-Control-Allow-Origin"] = origin!;
    h["Access-Control-Allow-Methods"] = "GET, OPTIONS";
    h["Access-Control-Allow-Headers"] = "Content-Type";
    h["Vary"] = "Origin";
  }
  return h;
}

interface GeoResult {
  city: string | null;
  country: string | null;
  region: string | null;
  source: "vercel" | "ipapi" | "unknown";
}

/** Extract Vercel's geolocation headers from the request. Returns
 *  null if the headers are absent (e.g. local dev). */
function readVercelGeo(req: Request): GeoResult | null {
  const city = req.headers.get("x-vercel-ip-city");
  const country = req.headers.get("x-vercel-ip-country");
  const region = req.headers.get("x-vercel-ip-country-region");
  // Vercel URL-encodes city names with spaces ("New%20York")
  const decodedCity = city ? decodeURIComponent(city) : null;
  if (!decodedCity && !country) return null;
  return {
    city: decodedCity,
    country,
    region,
    source: "vercel",
  };
}

/** Fall back to ipapi.co — free 1k/day. Reads the connecting IP from
 *  the standard forwarded headers Vercel sets. */
async function fetchIpApi(req: Request): Promise<GeoResult | null> {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    null;
  if (!ip) return null;
  // The IP comes from a client-influenceable forwarded header, so reject
  // anything that isn't a plain IPv4/IPv6 address before interpolating it
  // into the upstream URL (defense in depth — the value is also
  // encodeURIComponent'd, and the host is fixed to ipapi.co).
  const isValidIp = /^[0-9]{1,3}(\.[0-9]{1,3}){3}$/.test(ip) || /^[0-9a-fA-F:]+$/.test(ip);
  if (!isValidIp) return null;
  try {
    const res = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const j = await res.json() as {
      city?: string;
      country_name?: string;
      region?: string;
      error?: boolean;
    };
    if (j.error) return null;
    return {
      city: j.city ?? null,
      country: j.country_name ?? null,
      region: j.region ?? null,
      source: "ipapi",
    };
  } catch {
    return null;
  }
}

export default async function handler(req: Request): Promise<Response> {
  const origin = req.headers.get("origin");
  const sHeaders = securityHeaders(origin);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: sHeaders });
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...sHeaders, "Content-Type": "application/json" },
    });
  }

  // Try Vercel first (cheap), fall back to ipapi.
  const geo = readVercelGeo(req) ?? (await fetchIpApi(req)) ?? {
    city: null, country: null, region: null, source: "unknown" as const,
  };

  return new Response(JSON.stringify(geo), {
    status: 200,
    headers: {
      ...sHeaders,
      "Content-Type": "application/json",
      // Edge cache for an hour — geolocation per IP is very stable;
      // we don't need to recompute on every page load.
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
