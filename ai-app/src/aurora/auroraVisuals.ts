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

import { apiUrl } from "@/lib/apiBase";

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

/**
 * "Big number" stat tile. Pattern:
 *   <<<STAT:label|big|sub>>>
 *   <<<STAT:Population|3.5M|Lombardy, Italy>>>
 *
 * Renders as: small label across the top, a giant lightweight
 * number underneath, optional muted sub-line below it.
 */
export interface StatBlock {
  label: string;
  big: string;
  sub?: string;
}

/**
 * Key-value data table. Pattern:
 *   <<<DATA:title|key:value|key:value|...>>>
 *   <<<DATA:Lake Como facts|Depth:410 m|Length:46 km|Elevation:199 m>>>
 *
 * Renders as a JARVIS-style table with thin cyan separators between rows.
 */
export interface DataBlock {
  title: string;
  rows: Array<{ key: string; value: string }>;
}

/**
 * Pull-quote callout. Pattern:
 *   <<<QUOTE:text|attribution>>>
 *   <<<QUOTE:Stay hungry, stay foolish.|Steve Jobs>>>
 *
 * Renders large + italic + cyan accent bar.
 */
export interface QuoteBlock {
  text: string;
  attribution?: string;
}

/**
 * Side-by-side comparison table. Pattern:
 *   <<<COMPARE:title|labelA vs labelB|key:valA;valB|key:valA;valB|...>>>
 *   <<<COMPARE:iPhone vs Pixel|iPhone 16 Pro vs Pixel 9 Pro|Chip:A18 Pro;Tensor G4|Camera:48MP;50MP|Price:$999;$999>>>
 *
 * Renders as a Google "knowledge panel comparison" — two header
 * cells with the contestant labels, then rows of attribute/valueA/
 * valueB. Perfect for "X vs Y" research moments where Tony wants
 * to lay out the spec sheet instead of describing differences in
 * prose. Pairs naturally with a SHOW block for one of the items.
 *
 * Body format breakdown:
 *   - parts[0] = title (e.g. "iPhone vs Pixel")
 *   - parts[1] = "labelA vs labelB" header — split on " vs " (case-insensitive)
 *   - parts[2..] = "key:valA;valB" rows — split on first ":" for key,
 *     then ";" between the two value cells
 *
 * Tolerates rows that are missing a B-value (renders empty cell)
 * but skips rows with no A-value or no key.
 */
export interface CompareBlock {
  title: string;
  labelA: string;
  labelB: string;
  rows: Array<{ key: string; valueA: string; valueB: string }>;
}

/**
 * 3D model trigger. Pattern:
 *   <<<MODEL:name>>>
 *   <<<MODEL:atom>>>           — Carbon atom with electron shells
 *   <<<MODEL:solar-system>>>   — Sun + 8 planets
 *   <<<MODEL:dna>>>            — Double helix
 *   <<<MODEL:water>>>          — H2O molecule
 *   <<<MODEL:animal-cell>>>    — Cell with organelles
 *   <<<MODEL:heart>>>          — Human heart, beating
 *
 * Triggers the full-screen JarvisView 3D overlay. The viewer
 * resolves the name string against MODEL_REGISTRY (with common
 * aliases — "h2o" → "water", "cell" → "animal-cell", etc.) and
 * renders the matching procedural Three.js scene.
 *
 * Unlike SHOW/MAP, this block is exclusive — when present, the
 * 3D viewer takes over the screen completely. We DON'T render
 * other artifact cards underneath it.
 */
export interface ModelBlock {
  name: string;
}

export interface ParsedMessage {
  /** First SHOW block found in the text, if any. */
  show: ShowBlock | null;
  /** First MAP block found in the text, if any. */
  map: MapBlock | null;
  /** First STAT block found in the text, if any. */
  stat: StatBlock | null;
  /** First DATA block found in the text, if any. */
  data: DataBlock | null;
  /** First QUOTE block found in the text, if any. */
  quote: QuoteBlock | null;
  /** First COMPARE block found in the text, if any. */
  compare: CompareBlock | null;
  /** First MODEL block found in the text, if any. */
  model: ModelBlock | null;
  /** Message text with all artifact blocks removed and trailing
   *  whitespace collapsed. Safe to render as-is. */
  cleanText: string;
}

const SHOW_BLOCK_RE = /<<<SHOW:\s*([^>]+?)\s*>>>/i;
const MAP_BLOCK_RE = /<<<MAP:\s*([^>]+?)\s*>>>/i;
const STAT_BLOCK_RE = /<<<STAT:\s*([^>]+?)\s*>>>/i;
const DATA_BLOCK_RE = /<<<DATA:\s*([^>]+?)\s*>>>/i;
const QUOTE_BLOCK_RE = /<<<QUOTE:\s*([^>]+?)\s*>>>/i;
const COMPARE_BLOCK_RE = /<<<COMPARE:\s*([^>]+?)\s*>>>/i;
const MODEL_BLOCK_RE = /<<<MODEL:\s*([^>]+?)\s*>>>/i;

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
    return {
      show: null,
      map: null,
      stat: null,
      data: null,
      quote: null,
      compare: null,
      model: null,
      cleanText: rawText ?? "",
    };
  }
  const showMatch = SHOW_BLOCK_RE.exec(rawText);
  const mapMatch = MAP_BLOCK_RE.exec(rawText);
  const statMatch = STAT_BLOCK_RE.exec(rawText);
  const dataMatch = DATA_BLOCK_RE.exec(rawText);
  const quoteMatch = QUOTE_BLOCK_RE.exec(rawText);
  const compareMatch = COMPARE_BLOCK_RE.exec(rawText);
  const modelMatch = MODEL_BLOCK_RE.exec(rawText);

  // Strip ALL block instances (even past the first one) so the
  // user never sees raw markers if Tony emits duplicates.
  const cleanText = rawText
    .replace(/<<<SHOW:\s*[^>]+?\s*>>>/gi, "")
    .replace(/<<<MAP:\s*[^>]+?\s*>>>/gi, "")
    .replace(/<<<STAT:\s*[^>]+?\s*>>>/gi, "")
    .replace(/<<<DATA:\s*[^>]+?\s*>>>/gi, "")
    .replace(/<<<QUOTE:\s*[^>]+?\s*>>>/gi, "")
    .replace(/<<<COMPARE:\s*[^>]+?\s*>>>/gi, "")
    .replace(/<<<MODEL:\s*[^>]+?\s*>>>/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const showQuery = showMatch?.[1].trim();
  const mapQuery = mapMatch?.[1].trim();

  // STAT body: pipe-separated label|big|sub. Defensive: tolerate
  // 2 or 3 parts. If only one part is given (Tony goofed), drop it
  // — a stat tile with no number doesn't tell the user anything.
  let stat: StatBlock | null = null;
  if (statMatch?.[1]) {
    const parts = statMatch[1].split("|").map((p) => p.trim());
    if (parts.length >= 2 && parts[0] && parts[1]) {
      stat = {
        label: parts[0],
        big: parts[1],
        sub: parts[2] || undefined,
      };
    }
  }

  // DATA body: pipe-separated title|key:value|key:value|...
  // Each row is "key:value". Tolerate keys with colons inside the
  // value (split only on FIRST colon).
  let data: DataBlock | null = null;
  if (dataMatch?.[1]) {
    const parts = dataMatch[1].split("|").map((p) => p.trim());
    if (parts.length >= 2 && parts[0]) {
      const title = parts[0];
      const rows = parts.slice(1)
        .map((p) => {
          const idx = p.indexOf(":");
          if (idx < 0) return null;
          const key = p.slice(0, idx).trim();
          const value = p.slice(idx + 1).trim();
          if (!key || !value) return null;
          return { key, value };
        })
        .filter((r): r is { key: string; value: string } => r !== null);
      if (rows.length > 0) data = { title, rows };
    }
  }

  // QUOTE body: pipe-separated text|attribution. Attribution
  // is optional.
  let quote: QuoteBlock | null = null;
  if (quoteMatch?.[1]) {
    const parts = quoteMatch[1].split("|").map((p) => p.trim());
    if (parts[0]) {
      quote = {
        text: parts[0],
        attribution: parts[1] || undefined,
      };
    }
  }

  // COMPARE body: title|labelA vs labelB|key:valA;valB|key:valA;valB|...
  // Splits the header on " vs " (case-insensitive) so Tony can write
  // it naturally. Each row splits the value cell on ";" — if there's
  // no semicolon (Tony goofed), the second cell is empty but the row
  // still renders (better than dropping the whole comparison).
  let compare: CompareBlock | null = null;
  if (compareMatch?.[1]) {
    const parts = compareMatch[1].split("|").map((p) => p.trim());
    if (parts.length >= 3 && parts[0] && parts[1]) {
      const title = parts[0];
      // Header looks like "Foo vs Bar" — split on " vs " (any case).
      const header = parts[1].split(/\s+vs\s+/i).map((s) => s.trim());
      // Fall back to "A" / "B" if Tony didn't put a "vs" in the header
      // so the table still renders rather than getting silently dropped.
      const labelA = header[0] || "A";
      const labelB = header[1] || "B";
      const rows = parts.slice(2)
        .map((p) => {
          const idx = p.indexOf(":");
          if (idx < 0) return null;
          const key = p.slice(0, idx).trim();
          const valueParts = p.slice(idx + 1).split(";").map((s) => s.trim());
          const valueA = valueParts[0] ?? "";
          const valueB = valueParts[1] ?? "";
          if (!key || !valueA) return null;
          return { key, valueA, valueB };
        })
        .filter(
          (r): r is { key: string; valueA: string; valueB: string } => r !== null,
        );
      if (rows.length > 0) compare = { title, labelA, labelB, rows };
    }
  }

  const modelName = modelMatch?.[1].trim();

  return {
    show: showQuery ? { query: showQuery } : null,
    map: mapQuery ? { query: mapQuery } : null,
    stat,
    data,
    quote,
    compare,
    model: modelName ? { name: modelName } : null,
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

  // PRIMARY: try the exact summary endpoint first. Cheap and fast
  // when the query is unambiguous ("Eiffel Tower" → its page
  // immediately). Returns null when Wikipedia routes us to a
  // disambiguation page (no thumbnail) — that's the iPhone case
  // the founder hit. We fall through to search-then-fetch below.
  const direct = await fetchSummaryThumb(query.trim(), signal);
  if (direct) {
    thumbnailCache.set(key, { url: direct, ts: Date.now() });
    return direct;
  }

  // FALLBACK: query Wikipedia search to find the right page, then
  // fetch its summary. Handles ambiguous queries ("iPhone" →
  // disambig page) by letting Wikipedia's relevance ranker pick
  // the most popular matching page (usually the product/concept
  // page we actually wanted).
  const searched = await searchAndFetchThumb(query.trim(), signal);
  thumbnailCache.set(key, { url: searched, ts: Date.now() });
  return searched;
}

/**
 * fetchBriefingImage — the new front door for hero photos in
 * Tony's briefing card.
 *
 * Two-tier fallback chain:
 *
 *   1. **Brave Image Search** (via /api/research/image proxy)
 *      Real image-search results, comparable to Google. Hits a
 *      server-side proxy that holds the BRAVE_API_KEY — the key
 *      never reaches the client bundle. Quality is dramatically
 *      better than Wikipedia for: products, recent people,
 *      restaurants, brands, niche topics. When Brave returns
 *      anything we use it; we don't double-check with Wikipedia.
 *
 *   2. **Wikipedia summary thumb** (fetchWikipediaThumbnail above)
 *      Free, no key, but often grainy/missing. Used when:
 *        - Brave's API key isn't configured (degrades gracefully)
 *        - Brave returned no results (rare — they index everything)
 *        - Brave's request failed (network, rate limit, quota)
 *
 * Result is cached the same way Wikipedia results were — 24h TTL
 * keyed on the query string. Saves us from re-fetching when the
 * user revisits a topic.
 *
 * The `accessToken` is required because the Brave proxy is
 * auth-gated (prevents anonymous scraping of our quota). When
 * the caller doesn't have a token (anonymous user), we skip
 * Brave entirely and go straight to Wikipedia.
 */
export async function fetchBriefingImage(
  query: string,
  accessToken: string | null,
  signal?: AbortSignal,
): Promise<string | null> {
  const key = query.trim().toLowerCase();
  if (!key) return null;
  const cached = thumbnailCache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.url;
  }

  // TIER 1 — Brave Images via our proxy (auth-gated). apiUrl
  // resolves the right backend host whether we're on ai.basudrus.com,
  // basudrus.com directly, or a Vercel preview — same helper the
  // rest of Aurora uses for /api/ai/* calls.
  if (accessToken) {
    try {
      const url = apiUrl(
        `/api/research/image?q=${encodeURIComponent(query.trim())}`,
      );
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal,
      });
      if (res.ok) {
        const data = (await res.json()) as { url?: string | null };
        if (data?.url && typeof data.url === "string") {
          thumbnailCache.set(key, { url: data.url, ts: Date.now() });
          return data.url;
        }
      }
    } catch {
      // Network / abort / parse — fall through to Wikipedia.
    }
  }

  // TIER 2 — Wikipedia fallback. Identical logic to the legacy
  // fetchWikipediaThumbnail path (kept exported separately for any
  // caller that wants Wikipedia explicitly).
  const wikiUrl = await fetchWikipediaThumbnail(query, signal);
  // fetchWikipediaThumbnail already caches its own result, but the
  // cache is keyed the same way (lowercase trimmed query), so we
  // overwrite to keep "the briefing image for X" canonical.
  thumbnailCache.set(key, { url: wikiUrl, ts: Date.now() });
  return wikiUrl;
}

/**
 * Direct Wikipedia summary fetch — returns the page's thumbnail if
 * one exists, otherwise null. Used as the FAST path before falling
 * back to search.
 */
async function fetchSummaryThumb(
  query: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const slug = query.replace(/\s+/g, "_");
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(slug)}`;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      type?: string;
      thumbnail?: { source?: string };
      originalimage?: { source?: string };
    };
    // Disambiguation pages have type "disambiguation" and usually
    // no thumbnail — treat them as a miss so the search fallback
    // can find the right page.
    if (data.type === "disambiguation") return null;
    return data.originalimage?.source || data.thumbnail?.source || null;
  } catch {
    return null;
  }
}

/**
 * Search Wikipedia for the query, then fetch the top result's
 * thumbnail. Slower than direct lookup (two round trips) but
 * recovers gracefully from ambiguous queries.
 */
async function searchAndFetchThumb(
  query: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const url =
    `https://en.wikipedia.org/w/api.php?` +
    `action=query&list=search&format=json&origin=*&utf8=1&` +
    `srlimit=5&srsearch=${encodeURIComponent(query)}`;
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      query?: { search?: Array<{ title: string }> };
    };
    const hits = data.query?.search ?? [];
    // Try the top 3 results in order — the first hit usually has
    // a thumbnail, but if it's a stub page we fall through to the
    // next match. Stops as soon as one returns an image.
    for (const hit of hits.slice(0, 3)) {
      const thumb = await fetchSummaryThumb(hit.title, signal);
      if (thumb) return thumb;
    }
    return null;
  } catch {
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
/**
 * Two-frame "fly-in" map result. The CITY url is the close-up
 * zoom (the destination); the WORLD url is the wide "from space"
 * shot used as the starting frame for the CSS fly-in animation.
 * Either or both can be null if the geocode failed or if Mapbox
 * isn't configured — callers handle nulls gracefully (the
 * InfoCard hero-placeholder picks up the slack).
 */
export interface MapboxFlyImages {
  /** Tight zoom (~14) on the target — the destination view. */
  city: string | null;
  /** Wide "from space" zoom (~3) showing the continent/region —
   *  the starting frame for the fly-in animation. */
  world: string | null;
}

const mapCache = new Map<string, { result: MapboxFlyImages; ts: number }>();
const MAP_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * Two-frame fly-in version. Returns BOTH a wide world view and a
 * close-up city view of the same coordinates. The InfoCard's CSS
 * crossfades from world → city for the "Google Earth dive-in"
 * effect, but on a single geocode lookup (no extra Mapbox cost
 * compared to two separate calls — same coordinates, two URL
 * constructions, both billed as static map loads).
 *
 * Total Mapbox spend per MAP block: 2 static image loads.
 * At free tier (50k/month) that's 25k MAP blocks/month free.
 */
export async function fetchMapboxFlyImages(
  query: string,
  signal?: AbortSignal,
): Promise<MapboxFlyImages> {
  const token = (import.meta as { env?: Record<string, string | undefined> })
    .env?.VITE_MAPBOX_TOKEN;
  if (!token) return { city: null, world: null };
  const key = query.trim().toLowerCase();
  if (!key) return { city: null, world: null };
  const cached = mapCache.get(key);
  if (cached && Date.now() - cached.ts < MAP_CACHE_TTL_MS) {
    return cached.result;
  }
  const geocodeUrl =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query.trim())}.json` +
    `?access_token=${token}&limit=1`;
  try {
    const res = await fetch(geocodeUrl, { signal });
    if (!res.ok) {
      mapCache.set(key, { result: { city: null, world: null }, ts: Date.now() });
      return { city: null, world: null };
    }
    const data = (await res.json()) as {
      features?: Array<{ center?: [number, number]; place_type?: string[] }>;
    };
    const feature = data.features?.[0];
    if (!feature?.center) {
      mapCache.set(key, { result: { city: null, world: null }, ts: Date.now() });
      return { city: null, world: null };
    }
    const [lng, lat] = feature.center;
    // City close-up: zoom 14 (street-level for a landmark) or 7
    // for a country/region. Same wide-vs-narrow heuristic the
    // single-image version used.
    const wideTypes = new Set(["country", "region", "place"]);
    const isWide = feature.place_type?.some((t) => wideTypes.has(t));
    const cityZoom = isWide ? 7 : 14;
    // World "from space": zoom 2 shows the continent containing
    // the target — the natural "satellite from orbit" starting
    // shot for the fly-in.
    const worldZoom = 2;
    // Satellite styles per layer:
    //   World view → satellite-v9 (pure satellite, no labels —
    //     reads as "Earth from orbit")
    //   City view → satellite-streets-v12 (satellite + street
    //     labels — reads as "landed at the destination")
    const cityUrl =
      `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/static/` +
      `pin-s+4a90e2(${lng},${lat})/` +
      `${lng},${lat},${cityZoom},0/600x400@2x` +
      `?access_token=${token}`;
    const worldUrl =
      `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/` +
      `${lng},${lat},${worldZoom},0/600x400@2x` +
      `?access_token=${token}`;
    const result = { city: cityUrl, world: worldUrl };
    mapCache.set(key, { result, ts: Date.now() });
    return result;
  } catch {
    return { city: null, world: null };
  }
}

// The legacy fetchMapboxStaticImage() (single-image fetch) was
// removed when AuroraAIScreen migrated to fetchMapboxFlyImages.
// Nothing else in the codebase used it. If a future caller needs
// just one image, they can call fetchMapboxFlyImages(query) and
// use the .city URL — same Mapbox cost.
