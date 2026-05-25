/**
 * Aurora visuals — parse Tony's <<<SHOW:...>>> blocks and fetch
 * a matching Wikipedia thumbnail.
 *
 * The model emits inline blocks like `<<<SHOW:Eiffel Tower>>>`
 * when it wants the JARVIS-style A4 paper to display an image
 * alongside its text. This module:
 *   - extracts the FIRST SHOW block from a message
 *   - returns the clean text (block removed)
 *   - lazily fetches the Wikipedia summary thumbnail for the query
 *
 * Wikipedia's REST API supports CORS and requires no key. If the
 * query has no Wikipedia page (or no thumbnail), we silently
 * return null — UI just shows text-only.
 */

export interface ShowBlock {
  /** The search query Tony specified (between SHOW: and >>>). */
  query: string;
}

export interface ParsedMessage {
  /** First SHOW block found in the text, if any. */
  show: ShowBlock | null;
  /** Message text with the SHOW block removed and trailing
   *  whitespace collapsed. Safe to render as-is. */
  cleanText: string;
}

const SHOW_BLOCK_RE = /<<<SHOW:\s*([^>]+?)\s*>>>/i;

/**
 * Parse the first SHOW block out of an AI message. Strips it from
 * the text so the visible reply doesn't contain the raw marker.
 * Subsequent SHOW blocks (if Tony goes against the one-per-reply
 * rule) are also stripped to avoid junk markers on the paper.
 */
export function parseShowBlock(rawText: string): ParsedMessage {
  if (typeof rawText !== "string" || rawText.length === 0) {
    return { show: null, cleanText: rawText ?? "" };
  }
  const match = SHOW_BLOCK_RE.exec(rawText);
  if (!match) {
    return { show: null, cleanText: rawText };
  }
  const query = match[1].trim();
  // Strip ALL show blocks (the captured one + any extras) and
  // collapse the whitespace they leave behind.
  const cleanText = rawText
    .replace(/<<<SHOW:\s*[^>]+?\s*>>>/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return {
    show: query.length > 0 ? { query } : null,
    cleanText,
  };
}

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
