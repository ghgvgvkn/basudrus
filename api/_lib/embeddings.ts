/**
 * embeddings.ts — thin OpenAI text-embedding-3-small wrapper.
 *
 * Why OpenAI: $0.02/1M tokens, 1536-dim, very high recall on short
 * factual statements. The whole memory corpus per user fits in
 * pennies-per-month.
 *
 * Graceful fallback: if OPENAI_API_KEY is not set, embedText() returns
 * null. Callers MUST handle the null case so the system keeps working
 * without semantic memory (rows still get stored, just without an
 * embedding — the search RPC falls back to importance ordering).
 *
 * This file is shared between extract-memory (write path) and
 * student-memory (read path).
 */

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const EMBED_URL = "https://api.openai.com/v1/embeddings";
const EMBED_MODEL = "text-embedding-3-small";
const EMBED_DIMS = 1536;

export interface EmbedOpts {
  /** AbortSignal forwarded to fetch. */
  signal?: AbortSignal;
  /** Hard timeout in ms. Default 10s. */
  timeoutMs?: number;
}

/** Returns the embedding vector, or null on any failure or missing key. */
export async function embedText(
  text: string,
  opts: EmbedOpts = {},
): Promise<number[] | null> {
  if (!OPENAI_API_KEY) return null;
  const trimmed = (text ?? "").trim();
  if (!trimmed) return null;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 10000);
  // Forward an outer abort if provided.
  opts.signal?.addEventListener("abort", () => ctrl.abort());

  try {
    const res = await fetch(EMBED_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: EMBED_MODEL,
        input: trimmed.length > 8000 ? trimmed.slice(0, 8000) : trimmed,
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const body = await safeText(res);
      console.warn(`[embeddings] HTTP ${res.status}: ${body}`);
      return null;
    }
    const json = (await res.json()) as { data?: Array<{ embedding?: number[] }> };
    const vec = json?.data?.[0]?.embedding;
    if (!Array.isArray(vec) || vec.length !== EMBED_DIMS) return null;
    return vec;
  } catch (err) {
    if ((err as Error)?.name !== "AbortError") {
      console.warn("[embeddings] error:", (err as Error).message);
    }
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function safeText(res: Response): Promise<string> {
  try { return await res.text(); } catch { return "<unreadable>"; }
}

/** True if the OPENAI_API_KEY env var is set. Use to decide whether
 *  to even try embedding (avoids a wasted fetch). */
export function embeddingsAvailable(): boolean {
  return !!OPENAI_API_KEY;
}
