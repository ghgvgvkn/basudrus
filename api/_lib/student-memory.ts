/**
 * student-memory.ts — server-side helper for loading + rendering the
 * student's persistent memory block into the AI system prompt.
 *
 * The client UI (MemoryModal) lets the student CRUD their memory.
 * This module is the read path that runs in the edge function on
 * every chat turn: load the top-N most-RELEVANT memories for the
 * authenticated user, render them as a `STUDENT MEMORY` section the
 * AI can read.
 *
 * TWO read paths:
 *   1. fetchStudentMemory()          — legacy importance-ordered fetch.
 *                                      Always works (no embedding needed).
 *   2. fetchStudentMemoryRelevant()  — semantic fetch via
 *                                      match_student_memory RPC.
 *                                      Falls back to (1) automatically
 *                                      when embedding service is offline.
 *
 * Best-effort by design — if Supabase is unreachable or the table
 * doesn't exist yet on a fresh deploy, we return [] and the chat
 * runs without memory injection. No user-facing failure.
 */
import { embedText, embeddingsAvailable } from "./embeddings";

export interface MemoryRow {
  fact: string;
  category: string;
  importance: number;
}

interface FetchOpts {
  supabaseUrl: string;
  supabaseAnonKey: string;
  /** Authorization: Bearer <jwt> header forwarded from the original
   *  request. We use it so the PostgREST call runs as the user and
   *  respects RLS (own rows only). */
  authHeader: string | null;
  /** Cap on rows pulled. 10-15 is a sweet spot — enough to feel
   *  personal, small enough to not bloat the prompt. */
  limit?: number;
  /** Optional AbortSignal — forwarded to fetch so this never outlives
   *  a cancelled client request. */
  signal?: AbortSignal;
}

/**
 * Fetch the user's top-importance memories. Returns [] on any failure
 * (missing auth, network, RLS-rejected, table doesn't exist).
 */
export async function fetchStudentMemory({
  supabaseUrl, supabaseAnonKey, authHeader, limit = 12, signal,
}: FetchOpts): Promise<MemoryRow[]> {
  if (!authHeader || !supabaseUrl) return [];
  const url = new URL(`${supabaseUrl}/rest/v1/student_memory`);
  url.searchParams.set("select", "fact,category,importance");
  url.searchParams.set("order", "importance.desc,created_at.desc");
  url.searchParams.set("limit", String(limit));
  try {
    const res = await fetch(url.toString(), {
      headers: {
        Authorization: authHeader,
        apikey: supabaseAnonKey,
      },
      signal,
    });
    if (!res.ok) return [];
    const rows = (await res.json()) as Array<{ fact: string; category: string; importance: number }>;
    if (!Array.isArray(rows)) return [];
    return rows
      .filter((r) => typeof r.fact === "string" && r.fact.length >= 4)
      .map((r) => ({ fact: r.fact, category: r.category, importance: r.importance }));
  } catch {
    return [];
  }
}

/**
 * Render a STUDENT MEMORY block for the system prompt. Grouped by
 * category and ordered by importance, so the AI sees the highest-
 * leverage facts first. Returns "" when the list is empty so the
 * caller can `.filter(Boolean)` the prompt sections cleanly.
 */
export function renderMemoryBlock(rows: MemoryRow[]): string {
  if (!rows || rows.length === 0) return "";
  // Group by category. Categories appear in a stable order.
  const order = ["academic", "weakness", "strength", "goal", "preference", "context", "win", "other"] as const;
  const byCat: Record<string, MemoryRow[]> = {};
  for (const r of rows) {
    (byCat[r.category] = byCat[r.category] ?? []).push(r);
  }
  const lines: string[] = [
    "═══════════════════════════════════════════",
    "STUDENT MEMORY (durable facts the student has shared or you've",
    "observed across previous sessions). Use these to personalize your",
    "responses — but DO NOT recite the whole list back at them. Weave",
    "in the relevant 1-2 facts naturally. If a memory contradicts what",
    "the student just said in THIS conversation, the live message wins.",
    "═══════════════════════════════════════════",
  ];
  for (const cat of order) {
    const rowsInCat = byCat[cat];
    if (!rowsInCat || rowsInCat.length === 0) continue;
    lines.push(`• ${cat.toUpperCase()}:`);
    for (const r of rowsInCat) {
      lines.push(`    - ${r.fact} (importance ${r.importance}/10)`);
    }
  }
  // Catch any unknown categories.
  for (const cat of Object.keys(byCat)) {
    if ((order as readonly string[]).includes(cat)) continue;
    lines.push(`• ${cat.toUpperCase()}:`);
    for (const r of byCat[cat]) {
      lines.push(`    - ${r.fact} (importance ${r.importance}/10)`);
    }
  }
  lines.push("═══════════════════════════════════════════");
  return lines.join("\n");
}

interface FetchRelevantOpts extends FetchOpts {
  /** The query text — typically the latest user message. We embed
   *  this and ask Postgres for cosine-nearest rows. If embedText
   *  returns null (no OPENAI_API_KEY, fetch failed, etc.), we
   *  silently fall back to the importance-ordered legacy fetch. */
  query: string;
  /** Minimum confidence required for a row to be considered. Default
   *  0.0 so legacy rows (NULL confidence) still surface. Increase
   *  (e.g. 0.8) when the caller wants only high-confidence facts. */
  minConfidence?: number;
}

/**
 * Fetch the user's most RELEVANT memories for a query. Uses the
 * pgvector RPC `match_student_memory`. Falls back to legacy
 * importance-ordering when embeddings are unavailable.
 *
 * Always returns within ~1 second under normal conditions because the
 * embedding call is bounded by a 10s timeout and Postgres lookups on
 * a per-user corpus are sub-50ms.
 */
export async function fetchStudentMemoryRelevant(
  opts: FetchRelevantOpts,
): Promise<MemoryRow[]> {
  const { supabaseUrl, supabaseAnonKey, authHeader, limit = 10, signal, query, minConfidence = 0 } = opts;
  if (!authHeader || !supabaseUrl) return [];

  // Optional embedding. Null is fine — RPC handles the null case.
  let queryEmbedding: number[] | null = null;
  if (embeddingsAvailable() && query && query.trim().length > 0) {
    queryEmbedding = await embedText(query, { signal });
  }

  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/match_student_memory`, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        apikey: supabaseAnonKey,
        "Content-Type": "application/json",
      },
      signal,
      body: JSON.stringify({
        query_embedding: queryEmbedding,
        match_count: limit,
        min_confidence: minConfidence,
      }),
    });
    if (!res.ok) {
      // RPC missing on an older DB (e.g. local dev that hasn't
      // applied the migration) — fall back to legacy.
      return fetchStudentMemory(opts);
    }
    const rows = (await res.json()) as Array<{
      fact: string; category: string; importance: number;
    }>;
    if (!Array.isArray(rows) || rows.length === 0) return [];
    return rows
      .filter((r) => typeof r.fact === "string" && r.fact.length >= 4)
      .map((r) => ({ fact: r.fact, category: r.category ?? "other", importance: r.importance ?? 5 }));
  } catch {
    // Network / serialization error — fall back so the chat keeps running.
    return fetchStudentMemory(opts);
  }
}

