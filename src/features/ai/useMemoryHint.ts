/**
 * useMemoryHint — surfaces a single durable memory in the empty state
 * to make returning sessions feel proactive ("Last time you mentioned
 * struggling with X — want to revisit?").
 *
 * The hook is purely additive on top of useTutorMemory. When there's
 * no memory worth surfacing (or memories haven't been embedded yet)
 * it returns { hint: null } and the empty state renders unchanged.
 *
 * Rules baked in to avoid creepiness:
 *   • Only auto_extracted memories — never echo back what the user
 *     manually typed in their Memory modal (that already feels like
 *     spying when surfaced).
 *   • Confidence ≥ 0.8 to surface. Otherwise the AI looks dumb when it
 *     gets a memory subtly wrong.
 *   • Only memories from the last 30 days. A 4-month-old fact will
 *     read as stale, not personal.
 *   • Different framings for Tony Starrk vs Sherlock. Tony Starrk gets actionable;
 *     Sherlock stays gentle.
 *   • One memory only — never a list. The empty state is hero copy,
 *     not a recap screen.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useSupabaseSession } from "@/features/auth/useSupabaseSession";
import type { AIPersona } from "@/shared/types";

interface MemoryHint {
  /** Hint text to render under the greeting. Null = nothing to surface. */
  hint: string | null;
  /** Optional quick-reply prompt aligned with the hint. Lets the
   *  student tap "Yes, let's revisit it" without typing. */
  quickPrompt: string | null;
  /** True while the fetch is in flight. Renderers should ignore this —
   *  the empty state already renders gracefully. */
  loading: boolean;
}

interface MemoryRow {
  fact: string;
  category: string | null;
  importance: number | null;
  confidence: number | null;
  created_at: string;
}

const MAX_AGE_DAYS = 30;
const MIN_CONFIDENCE = 0.8;

export function useMemoryHint(persona: AIPersona): MemoryHint {
  const { session } = useSupabaseSession();
  const userId = session?.user?.id || null;
  const [state, setState] = useState<MemoryHint>({ hint: null, quickPrompt: null, loading: true });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!userId) {
        setState({ hint: null, quickPrompt: null, loading: false });
        return;
      }
      try {
        const { data, error } = await supabase
          .from("student_memory")
          .select("fact, category, importance, confidence, created_at")
          .eq("source", "auto_extracted")
          .gte("confidence", MIN_CONFIDENCE)
          .order("importance", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(5);
        if (cancelled) return;
        if (error || !Array.isArray(data) || data.length === 0) {
          setState({ hint: null, quickPrompt: null, loading: false });
          return;
        }
        const recent = (data as MemoryRow[]).find((r) => isRecent(r.created_at));
        if (!recent) {
          setState({ hint: null, quickPrompt: null, loading: false });
          return;
        }
        const hint = formatHint(recent, persona);
        const quickPrompt = buildQuickPrompt(recent, persona);
        setState({ hint, quickPrompt, loading: false });
      } catch {
        setState({ hint: null, quickPrompt: null, loading: false });
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [userId, persona]);

  return state;
}

function isRecent(iso: string): boolean {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  const days = (Date.now() - t) / 86400000;
  return days >= 0 && days <= MAX_AGE_DAYS;
}

function formatHint(row: MemoryRow, persona: AIPersona): string {
  // The fact is stored in third person ("Has a Calc II midterm May 20")
  // — we want to soften that into a natural reference. Lowercase the
  // first letter so it flows after "you mentioned".
  const fact = (row.fact || "").trim();
  if (!fact) return "";
  const lower = fact[0].toLowerCase() + fact.slice(1);

  if (persona === "omar") {
    const cat = (row.category || "").toLowerCase();
    if (cat === "academic" || cat === "goal") {
      return `Last time we talked, ${lower}. Want to keep working on it?`;
    }
    if (cat === "weakness") {
      return `From earlier: ${lower}. Want to revisit it together?`;
    }
    if (cat === "win" || cat === "strength") {
      return `Building on what's been working — ${lower}.`;
    }
    return `Remembering from before: ${lower}. Helpful starting point?`;
  }

  // Sherlock — gentler, no action prompt by default.
  if (persona === "noor") {
    return `I remember from before — ${lower}. Here when you want to talk.`;
  }

  return `Remembering: ${lower}.`;
}

function buildQuickPrompt(row: MemoryRow, persona: AIPersona): string | null {
  if (persona !== "omar") return null;
  const cat = (row.category || "").toLowerCase();
  if (cat === "academic" || cat === "weakness" || cat === "goal") {
    return "Yes, let's revisit it.";
  }
  return null;
}
