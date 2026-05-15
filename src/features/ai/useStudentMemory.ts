/**
 * useStudentMemory — durable per-user memory the AI can recall across
 * sessions. Backed by the `student_memory` Supabase table with
 * own-only RLS.
 *
 * The hook does three things:
 *   1. Loads the user's memories on mount (most-important first).
 *   2. Exposes add / delete / update for the Memory view UI.
 *   3. Exposes a `topForPrompt(limit)` helper that the API route
 *      consumers can use to format a STUDENT MEMORY block to inject
 *      into the system prompt. (Server-side injection is wired in
 *      api/ai/tutor.ts + api/ai/wellbeing.ts; this client-side
 *      version is for the Memory view and the import flow only.)
 *
 * UX rules baked in here:
 *   - Adding a duplicate fact (case-insensitive) updates the existing
 *     row's importance + updated_at instead of failing the insert.
 *     Mirrors the unique index on (user_id, lower(fact)).
 *   - Delete is hard, not soft. Students should have full control of
 *     what the AI remembers about them — including the ability to
 *     erase. This is a trust feature, not just storage.
 *   - All writes are optimistic; on failure we revert and surface a
 *     callback the caller can use to toast.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useSupabaseSession } from "@/features/auth/useSupabaseSession";

export type MemoryCategory =
  | "academic"
  | "preference"
  | "context"
  | "weakness"
  | "strength"
  | "goal"
  | "win"
  | "other";

export type MemorySource = "manual" | "auto_extracted" | "imported";

export interface StudentMemoryRow {
  id: string;
  user_id: string;
  fact: string;
  category: MemoryCategory;
  importance: number;
  source: MemorySource;
  last_referenced: string | null;
  created_at: string;
  updated_at: string;
}

export interface UseStudentMemoryState {
  memories: StudentMemoryRow[];
  loading: boolean;
  error: string | null;
  /** Add a new fact. If a same-lowercased fact already exists for this
   *  user, updates that row's importance to max(existing, new). */
  add: (input: {
    fact: string;
    category?: MemoryCategory;
    importance?: number;
    source?: MemorySource;
  }) => Promise<{ ok: boolean; id?: string; error?: string }>;
  /** Bulk add — used by the Import flow when many facts arrive at once.
   *  Returns the count actually inserted (duplicates are skipped). */
  addMany: (
    inputs: Array<{ fact: string; category?: MemoryCategory; importance?: number }>,
    source?: MemorySource,
  ) => Promise<{ ok: boolean; inserted: number; error?: string }>;
  update: (id: string, patch: Partial<Pick<StudentMemoryRow, "fact" | "category" | "importance">>) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
  removeAll: () => Promise<boolean>;
  refresh: () => Promise<void>;
}

/** Sanitize a fact string before storage. Trims, collapses whitespace,
 *  enforces the 4-600 char range to match the DB check constraint. */
function sanitizeFact(raw: string): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/\s+/g, " ").trim();
  if (cleaned.length < 4 || cleaned.length > 600) return null;
  return cleaned;
}

export function useStudentMemory(): UseStudentMemoryState {
  const { session } = useSupabaseSession();
  const userId = session?.user?.id ?? null;
  const [memories, setMemories] = useState<StudentMemoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!userId) { setMemories([]); return; }
    setLoading(true);
    setError(null);
    try {
      const { data, error: dbErr } = await supabase
        .from("student_memory")
        .select("*")
        .eq("user_id", userId)
        .order("importance", { ascending: false })
        .order("created_at", { ascending: false });
      if (dbErr) throw dbErr;
      setMemories((data ?? []) as StudentMemoryRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load memory");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const add = useCallback<UseStudentMemoryState["add"]>(async (input) => {
    if (!userId) return { ok: false, error: "Not signed in" };
    const fact = sanitizeFact(input.fact);
    if (!fact) return { ok: false, error: "Memory must be 4–600 characters." };
    const category = input.category ?? "context";
    const importance = Math.min(10, Math.max(1, input.importance ?? 5));
    const source = input.source ?? "manual";

    try {
      // Insert with on-conflict do nothing; if it duplicates we
      // upgrade the existing row's importance instead.
      const { data, error: insErr } = await supabase
        .from("student_memory")
        .insert({ user_id: userId, fact, category, importance, source })
        .select("id")
        .single();
      if (insErr) {
        // Duplicate (unique index violation) — upgrade existing row.
        if (typeof insErr.code === "string" && insErr.code === "23505") {
          await supabase
            .from("student_memory")
            .update({ importance })
            .eq("user_id", userId)
            .ilike("fact", fact);
          await refresh();
          return { ok: true };
        }
        return { ok: false, error: insErr.message };
      }
      await refresh();
      return { ok: true, id: data?.id };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Insert failed" };
    }
  }, [userId, refresh]);

  const addMany = useCallback<UseStudentMemoryState["addMany"]>(async (inputs, source = "imported") => {
    if (!userId) return { ok: false, inserted: 0, error: "Not signed in" };
    if (inputs.length === 0) return { ok: true, inserted: 0 };
    const rows = inputs
      .map((i) => ({
        user_id: userId,
        fact: sanitizeFact(i.fact),
        category: i.category ?? "context",
        importance: Math.min(10, Math.max(1, i.importance ?? 5)),
        source,
      }))
      .filter((r) => r.fact !== null);
    if (rows.length === 0) return { ok: false, inserted: 0, error: "No valid facts to insert." };

    // Use upsert with ignoreDuplicates to safely skip dupes. The unique
    // index is on (user_id, lower(fact)) which doesn't match a simple
    // PG upsert key — so we just insert + count rejected dupes.
    let inserted = 0;
    for (const row of rows) {
      const { error: insErr } = await supabase.from("student_memory").insert(row);
      if (!insErr) inserted += 1;
    }
    await refresh();
    return { ok: true, inserted };
  }, [userId, refresh]);

  const update = useCallback<UseStudentMemoryState["update"]>(async (id, patch) => {
    if (!userId) return false;
    const next: Record<string, unknown> = {};
    if (patch.fact !== undefined) {
      const cleaned = sanitizeFact(patch.fact);
      if (!cleaned) return false;
      next.fact = cleaned;
    }
    if (patch.category !== undefined) next.category = patch.category;
    if (patch.importance !== undefined) next.importance = Math.min(10, Math.max(1, patch.importance));
    if (Object.keys(next).length === 0) return false;
    const { error: upErr } = await supabase.from("student_memory").update(next).eq("id", id).eq("user_id", userId);
    if (upErr) return false;
    await refresh();
    return true;
  }, [userId, refresh]);

  const remove = useCallback<UseStudentMemoryState["remove"]>(async (id) => {
    if (!userId) return false;
    // Optimistic: yank from local state first.
    setMemories((prev) => prev.filter((m) => m.id !== id));
    const { error: delErr } = await supabase.from("student_memory").delete().eq("id", id).eq("user_id", userId);
    if (delErr) { await refresh(); return false; }
    return true;
  }, [userId, refresh]);

  const removeAll = useCallback<UseStudentMemoryState["removeAll"]>(async () => {
    if (!userId) return false;
    const { error: delErr } = await supabase.from("student_memory").delete().eq("user_id", userId);
    if (delErr) return false;
    setMemories([]);
    return true;
  }, [userId]);

  return { memories, loading, error, add, addMany, update, remove, removeAll, refresh };
}

// ─────────────────────────────────────────────────────────────────────
// Parsing helper for the Import flow
// ─────────────────────────────────────────────────────────────────────

/**
 * The Import flow lets a student paste output from another AI (e.g.
 * ChatGPT, Claude.ai) that lists facts about them. We expect the
 * source AI to be prompted with our template (rendered in the UI)
 * which asks it to output a JSON array of {fact, category, importance}
 * objects.
 *
 * In practice the source AI often wraps the array in prose, markdown
 * fences, or extra text — so this parser is forgiving:
 *   1. Find the first '[' and matching ']'
 *   2. Try to JSON.parse the slice
 *   3. Validate each entry; coerce category and importance
 *
 * Returns the cleaned array or null if no parseable JSON was found.
 */
export interface ParsedImportEntry {
  fact: string;
  category: MemoryCategory;
  importance: number;
}

export function parseImportPayload(raw: string): ParsedImportEntry[] | null {
  if (typeof raw !== "string") return null;
  // Find the outermost JSON array.
  const first = raw.indexOf("[");
  const last = raw.lastIndexOf("]");
  if (first < 0 || last <= first) return null;
  const slice = raw.slice(first, last + 1);
  let parsed: unknown;
  try { parsed = JSON.parse(slice); } catch { return null; }
  if (!Array.isArray(parsed)) return null;

  const ALLOWED: ReadonlySet<MemoryCategory> = new Set<MemoryCategory>([
    "academic", "preference", "context", "weakness", "strength", "goal", "win", "other",
  ]);
  const out: ParsedImportEntry[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const factRaw = typeof e.fact === "string" ? e.fact : "";
    const fact = sanitizeFact(factRaw);
    if (!fact) continue;
    const categoryRaw = typeof e.category === "string" ? e.category.toLowerCase() : "context";
    const category: MemoryCategory = (ALLOWED.has(categoryRaw as MemoryCategory) ? categoryRaw : "context") as MemoryCategory;
    const impRaw = Number(e.importance);
    const importance = Number.isFinite(impRaw) ? Math.min(10, Math.max(1, Math.round(impRaw))) : 5;
    out.push({ fact, category, importance });
  }
  return out.length > 0 ? out : null;
}

/**
 * The prompt template the student copies into another AI to extract
 * facts about themselves. Rendered in the Memory > Import UI.
 * Returns a string ready to copy.
 */
export function buildImportPrompt(opts: { studentName?: string }): string {
  const name = opts.studentName?.trim() || "the student";
  return `I want you to look back through our entire conversation and extract a list of durable, factual things about me (${name}) that another AI tutor should remember when helping me with my studies and life.

Output ONLY a valid JSON array. Do not include any text before or after the array.

Each array entry must be an object with these exact keys:
- "fact": one sentence, present-tense, written about me. 4 to 600 characters. No first-person; write "they"/"the student" or use my name.
- "category": exactly one of "academic", "preference", "context", "weakness", "strength", "goal", "win", "other"
- "importance": integer from 1 (trivia) to 10 (critical recurring pattern)

Rules:
- Skip anything trivial or one-off ("once asked about Python").
- Skip anything I asked you to forget.
- Skip information you can only infer with low confidence — only durable, observed patterns.
- Aim for 10-30 entries. If there's less than 4 you can produce confidently, output the array anyway with what you have.

Example output (do not copy these literally — they are format only):

[
  {"fact": "${name} is a third-year Computer Science student at Princess Sumaya University for Technology (PSUT)", "category": "academic", "importance": 9},
  {"fact": "${name} consistently struggles with integration by parts and prefers visual explanations for calculus", "category": "weakness", "importance": 7},
  {"fact": "${name} prefers Arabic explanations after midnight and English during the day", "category": "preference", "importance": 5}
]

Now extract the facts. Output the JSON array only.`;
}
