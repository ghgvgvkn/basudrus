/**
 * Aurora visuals — parse Tony's artifact blocks (<<<SHOW:...>>> for
 * Wikipedia thumbnails, <<<MAP:...>>> for static maps) and lazily
 * fetch the matching media for the JARVIS-style A4 paper UI.
 *
 * Supported artifact blocks:
 *
 *   <<<SHOW:Eiffel Tower>>>     → Wikipedia summary thumbnail
 *   <<<MAP:Lake Como, Italy>>>  → Mapbox static dark-themed image
 *
 * Both blocks are extracted, stripped from the visible text, and turned
 * into a renderable URL. Failures (no Wikipedia page / Mapbox not
 * configured / geocode miss) silently return null — UI then just shows
 * text without the image. No broken-image icons, no error banners.
 *
 * Wikipedia: CORS-enabled, no key needed.
 * Mapbox: requires VITE_MAPBOX_TOKEN at build time. If absent we
 * never hit Mapbox — MAP blocks become text-only no-ops, which is the
 * correct degradation when the env var hasn't been set up yet.
 */

export interface ShowBlock {
  /** The search query Tony specified (between SHOW: and >>>). */
  query: string;
}

export interface MapBlock {
  /** The place Tony wants mapped (between MAP: and >>>). Free-form —
   *  Mapbox's forward geocoder accepts "Eiffel Tower", "Lake Como",
   *  "Brooklyn", "Iraq" all equally well. */
  query: string;
}

export interface ParsedMessage {
  /** First SHOW block found in the text, if any. */
  show: ShowBlock | null;
  /** First MAP block found in the text, if any. */
  map: MapBlock | null;
  /** Message text with all artifact blocks removed and trailing
   *  whitespace collapsed. Safe to render as-is. */
  cleanText: string;
}

const SHOW_BLOCK_RE = /<<<SHOW:\s*([^>]+?)\s*>>>/i;
const MAP_BLOCK_RE = /<<<MAP:\s*([^>]+?)\s*>>>/i;

/**
 * Parse the first SHOW + MAP block out of an AI message. Strips them
 * from the text so the visible reply doesn't contain the raw markers.
 * Subsequent blocks (if Tony goes against the one-per-reply rule) are
 * also stripped to avoid junk markers on the paper.
 *
 * Returns clean text + zero or more artifact handles. Caller decides
 * which artifacts to render and in what order.
 */
export function parseArtifacts(rawText: string): ParsedMessage {
  if (typeof rawText !== "string" || rawText.length === 0) {
    return { show: null, map: null, cleanText: rawText ?? "" };
  }
  const showMatch = SHOW_BLOCK_RE.exec(rawText);
  const mapMatch = MAP_BLOCK_RE.exec(rawText);
  const cleanText = rawText
    .replace(/<<<SHOW:\s*[^>]+?\s*>>>/gi, "")
    .replace(/<<<MAP:\s*[^>]+?\s*>>>/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const showQuery = showMatch?.[1].trim();
  const mapQuery = mapMatch?.[1].trim();
  return {
    show: showQuery ? { query: showQuery } : null,
    map: mapQuery ? { query: mapQuery } : null,
    cleanText,
  };
}

/**
 * Back-compat alias. The original API only knew about SHOW blocks.
 * New callers should use parseArtifacts directly so they get the
 * map handle too. Kept exported so any older consumer still compiles
 * — they'll just see show + cleanText and ignore the new map field.
 */
export const parseShowBlock = parseArtifacts;

/**
 * Wikipedia summary endpoint. Returns the first paragraph + a
 * thumbnail URL when one exists. We only need the thumbnail.
 * CORS-enabled by Wikipedia, no auth needed.
 *
 * Caches per-query in module memory so flipping between messages
 * doesn't re-fetch the same image. Cache survives the page
 * session; cleared on hard reload.
 */
const thumbnailCache = new Map<string, { url: string | null; ts: number }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

export async function fetchWikipediaThumbnail(
  query: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const key = query.trim().toLowerCase();
  if (!key) return null;
  const cached = thumbnailCache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.url;
  }
  // Wikipedia's REST API matches on URL-encoded page titles.
  // Spaces → underscores, then encodeURIComponent for safety.
  const slug = query.trim().replace(/\s+/g, "_");
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(slug)}`;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal,
    });
    if (!res.ok) {
      thumbnailCache.set(key, { url: null, ts: Date.now() });
      return null;
    }
    const data = (await res.json()) as {
      thumbnail?: { source?: string };
      originalimage?: { source?: string };
    };
    // Prefer the originalimage (full size) over the smaller thumbnail
    // when available — the paper renders at a decent size, so a
    // 320x240 thumb looks pixelated.
    const imgUrl =
      data.originalimage?.source
      || data.thumbnail?.source
      || null;
    thumbnailCache.set(key, { url: imgUrl, ts: Date.now() });
    return imgUrl;
  } catch {
    // Network error or aborted — don't cache failures so a transient
    // network blip doesn't blackball this query forever.
    return null;
  }
}

/**
 * Mapbox static image fetch.
 *
 * Pipeline (single HTTP round-trip — Mapbox's `places.json` geocoder
 * gives us back the lat/lng, then the static image URL is built
 * client-side without another fetch):
 *
 *   1. Geocode the user-readable query → [lng, lat]
 *   2. Pick a zoom based on place_type ("country" / "region" → wide,
 *      everything else → close-up)
 *   3. Compose a Mapbox Static Images URL (style: dark-v11, with a
 *      small cyan pin at the location) — return that URL for the
 *      <img> tag to load directly.
 *
 * The static URL itself never hits our backend. The <img> tag fetches
 * it from Mapbox's CDN. We just need a valid signed URL.
 *
 * Returns null when:
 *   - VITE_MAPBOX_TOKEN is not configured (build without the env var)
 *   - the query is empty
 *   - geocoding returns no features (typo, made-up place)
 *   - the network call fails
 * The caller treats null the same as "no map for this message" —
 * just shows text. No error UI.
 *
 * The dark-v11 style was picked specifically to match the JARVIS HUD
 * aesthetic: night-mode map with cyan-blue water, low-contrast roads,
 * blends into the dark UI shell instead of fighting it.
 */
const mapCache = new Map<string, { url: string | null; ts: number }>();
const MAP_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

export async function fetchMapboxStaticImage(
  query: string,
  signal?: AbortSignal,
): Promise<string | null> {
  // Read the token at runtime — Vite injects import.meta.env at build
  // time. If the env var isn't set, the value is undefined and we
  // return null cleanly without ever hitting Mapbox.
  const token = (import.meta as { env?: Record<string, string | undefined> })
    .env?.VITE_MAPBOX_TOKEN;
  if (!token) return null;
  const key = query.trim().toLowerCase();
  if (!key) return null;
  const cached = mapCache.get(key);
  if (cached && Date.now() - cached.ts < MAP_CACHE_TTL_MS) {
    return cached.url;
  }
  const geocodeUrl =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query.trim())}.json` +
    `?access_token=${token}&limit=1`;
  try {
    const res = await fetch(geocodeUrl, { signal });
    if (!res.ok) {
      mapCache.set(key, { url: null, ts: Date.now() });
      return null;
    }
    const data = (await res.json()) as {
      features?: Array<{
        center?: [number, number];
        place_type?: string[];
      }>;
    };
    const feature = data.features?.[0];
    if (!feature?.center) {
      mapCache.set(key, { url: null, ts: Date.now() });
      return null;
    }
    const [lng, lat] = feature.center;
    // Wider zoom for big regions (country / state / city), tighter
    // for specific landmarks. Tony usually asks for the latter, but
    // when he says "Iraq" we don't want a 14-zoom on Baghdad — we
    // want the country outline.
    const wideTypes = new Set(["country", "region", "place"]);
    const isWide = feature.place_type?.some((t) => wideTypes.has(t));
    const zoom = isWide ? 5 : 14;
    // Static image params:
    //   style: mapbox/dark-v11 (night theme — matches JARVIS HUD)
    //   overlay: small cyan pin at the target location
    //   size: 600x400@2x retina (≈400px wide in the panel layout)
    // Cyan pin (`4a90e2`) ties into the same palette as the corner
    // brackets + JARVIS ring elsewhere in Aurora.
    const staticUrl =
      `https://api.mapbox.com/styles/v1/mapbox/dark-v11/static/` +
      `pin-s+4a90e2(${lng},${lat})/` +
      `${lng},${lat},${zoom},0/600x400@2x` +
      `?access_token=${token}`;
    mapCache.set(key, { url: staticUrl, ts: Date.now() });
    return staticUrl;
  } catch {
    return null;
  }
}
