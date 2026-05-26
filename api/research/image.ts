/**
 * /api/research/image — proxy to Brave Image Search.
 *
 * Aurora's briefing card needs a hero photo when Tony emits a
 * <<<SHOW:query>>> block. Wikipedia thumbnails are free but
 * grainy/missing for many subjects (products, recent people, niche
 * topics). Brave Image Search returns real image-search results
 * comparable to Google.
 *
 * WHY A SERVER PROXY (not direct from client)
 *
 *   Brave requires an API key in the X-Subscription-Token header.
 *   That key is a paid credential — putting it in the client bundle
 *   means anyone can scrape it and burn through our quota. So we
 *   proxy: client → /api/research/image?q=... → Brave (server-side
 *   with the key) → top result back to client.
 *
 *   Bonus: we can cache aggressively at the proxy layer later
 *   (Vercel edge cache or a Supabase table), which we can't do
 *   from the client side.
 *
 * QUOTA MANAGEMENT
 *
 *   Brave free tier: ~2k queries/month. Paid: $5/1000 after that.
 *   We rate-limit per user (modest daily cap) so a misbehaving
 *   client doesn't burn through the whole quota in one session.
 *
 * FALLBACK BEHAVIOR
 *
 *   If BRAVE_API_KEY is unset OR the upstream fails, we return 200
 *   with { url: null } so the client falls through to Wikipedia
 *   (its existing pre-Brave behavior). No visible error to the user
 *   — they just see a Wikipedia thumb instead of a Brave image.
 *
 * RESPONSE SHAPE
 *
 *   { url: string | null, source: "brave" | null, query: string }
 *
 *   We return a single URL (not an array) for v1 to match the
 *   current single-hero briefing card. When we add image carousels
 *   later, we'll extend the response to include a `gallery: string[]`.
 */
export const config = { runtime: "edge" };

import {
  ALLOWED_ORIGINS,
  securityHeaders,
  checkRateLimit,
  rateLimitResponse,
  sanitizeLine,
  getUserIdFromToken,
} from "../_lib/ai-guard";

const BRAVE_API_KEY = process.env.BRAVE_API_KEY || "";
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const BRAVE_IMAGE_URL = "https://api.search.brave.com/res/v1/images/search";

// Per-user quotas. Generous because briefings fire automatically on
// most research moments — we don't want to cut a chatty user off
// just because they asked Tony about 50 different things. The hard
// cost ceiling is Brave's monthly quota; this is the per-user share.
const LIMITS = { daily: 80, hourly: 30, minute: 8 };

export default async function handler(req: Request): Promise<Response> {
  const origin = req.headers.get("origin");
  const sHeaders = securityHeaders(origin, ALLOWED_ORIGINS);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: sHeaders });
  }
  if (req.method !== "GET") {
    return json({ error: "Method not allowed" }, sHeaders, 405);
  }

  // Auth — Aurora is auth-gated so this proxy is too. Prevents
  // anonymous scraping of our Brave quota.
  const authHeader = req.headers.get("authorization");
  const userId = await getUserIdFromToken(authHeader, SUPABASE_URL, SUPABASE_ANON_KEY);
  if (!userId) {
    return json({ error: "unauthorized" }, sHeaders, 401);
  }

  // Rate limit per user — keeps any single user from blowing through
  // the monthly Brave quota by themselves.
  const rl = await checkRateLimit({
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY,
    authHeader,
    endpoint: "research_image",
    daily: LIMITS.daily,
    hourly: LIMITS.hourly,
    minute: LIMITS.minute,
  });
  if (!rl.allowed) {
    return rateLimitResponse(rl, sHeaders, {
      cooldown: "Slow down — fetching too many images.",
      minute_limit: "Too many image lookups per minute — try again shortly.",
      hourly_limit: "Hourly image lookup limit reached.",
      daily_limit: "Daily image lookup limit reached — comes back tomorrow.",
    });
  }

  // Parse + validate the query. The query is user-influenced (it
  // came from Tony's SHOW block which is influenced by the user's
  // message), so sanitize before sending upstream.
  const url = new URL(req.url);
  const rawQuery = url.searchParams.get("q") || "";
  const query = sanitizeLine(rawQuery, 120);
  if (!query) {
    return json({ url: null, source: null, query: "" }, sHeaders);
  }

  // No key configured = graceful fallback path. Client treats this
  // identically to "no result" and falls through to Wikipedia.
  if (!BRAVE_API_KEY) {
    return json({ url: null, source: null, query }, sHeaders);
  }

  // ── Brave Image Search call ────────────────────────────────────
  // Free tier rate: 1 query/second. We pass safesearch=strict by
  // default (Aurora is a general consumer app — we don't want adult
  // content sneaking into a research briefing about an innocuous
  // topic like a product or musician).
  const braveUrl =
    `${BRAVE_IMAGE_URL}?` +
    `q=${encodeURIComponent(query)}` +
    `&count=5` +
    `&safesearch=strict`;

  try {
    const ctl = new AbortController();
    const timeoutId = setTimeout(() => ctl.abort(), 5000);
    const res = await fetch(braveUrl, {
      headers: {
        "Accept": "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": BRAVE_API_KEY,
      },
      signal: ctl.signal,
    }).finally(() => clearTimeout(timeoutId));

    if (!res.ok) {
      // Upstream failure — log status code (no body, could be HTML
      // or contain quota info we don't want to leak to the client)
      // and return graceful fallback to client.
      console.warn(`[research/image] Brave HTTP ${res.status} for "${query}"`);
      return json({ url: null, source: null, query }, sHeaders);
    }

    const data = await res.json() as {
      results?: Array<{
        url?: string;          // page URL the image was found on
        title?: string;
        thumbnail?: { src?: string };
        properties?: { url?: string };  // the actual image URL
      }>;
    };

    // Brave returns `properties.url` as the direct image URL and
    // `thumbnail.src` as a smaller preview. We want the full image
    // for the hero — fall back to thumbnail if the full one isn't
    // present.
    const top = data?.results?.[0];
    const imageUrl = top?.properties?.url || top?.thumbnail?.src || null;

    return json(
      { url: imageUrl, source: imageUrl ? "brave" : null, query },
      sHeaders,
    );
  } catch (e) {
    // Network/abort/parse error. Graceful fallback so the briefing
    // still renders (with Wikipedia or a placeholder).
    console.warn(`[research/image] error for "${query}":`, (e as Error).message);
    return json({ url: null, source: null, query }, sHeaders);
  }
}

function json(payload: unknown, headers: Record<string, string>, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}
