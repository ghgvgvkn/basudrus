/**
 * student-memory.ts — server-side helper for loading + rendering the
 * student's persistent memory block into the AI system prompt.
 *
 * The client UI (MemoryModal) lets the student CRUD their memory.
 * This module is the read path that runs in the edge function on
 * every chat turn: load the top-N most-important memories for the
 * authenticated user, render them as a `STUDENT MEMORY` section the
 * AI can read.
 *
 * Best-effort by design — if Supabase is unreachable or the table
 * doesn't exist yet on a fresh deploy, we return "" and the chat
 * runs without memory injection. No user-facing failure.
 */

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
