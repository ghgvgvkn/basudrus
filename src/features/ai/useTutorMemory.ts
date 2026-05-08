/**
 * useTutorMemory — synthesizes a personalized opening for the AI
 * empty state from the student's streak + progress data.
 *
 * The whole point of this hook: when a student opens the AI screen,
 * the empty state shouldn't be "What are we learning today?" with
 * the same generic prompts every time. It should feel like the
 * tutor remembers them.
 *
 *   First-time user (no progress, no streak):
 *     "What are we learning today?" + the generic OMAR_PROMPTS list.
 *
 *   Returning user (today already studied):
 *     "Welcome back, Ahmed. Already on a 5-day streak today —
 *      pick up where you left off, or new topic?"
 *
 *   Returning user (away 3+ days):
 *     "It's been 3 days. Want to revisit calculus integration —
 *      you were close last time."
 *
 *   With weak areas to review:
 *     Suggested prompts include "Quiz me on derivatives" (the
 *     specific topic the analyzer flagged as weak), so the student
 *     can re-engage in one tap.
 *
 * No AI call — this is pure client-side synthesis from data we
 * already loaded (streak + progress rows). Zero added latency, zero
 * added cost. The greeting is deterministic given the same inputs,
 * so testing is trivial.
 *
 * Returns:
 *   • greeting     — single sentence to render as the hero text
 *   • subline      — small grey line under it (optional)
 *   • prompts      — array of 4-6 quick-tap prompts (mix of
 *                    review-from-history + generic explore)
 */
import { useMemo } from "react";
import { useApp } from "@/context/AppContext";
import { useSubjectProgress, type SubjectProgressSummary } from "./useSubjectProgress";
import { useStreak } from "./useStreak";
import { paletteFor } from "./subjectPalette";
import type { AIPersona } from "@/shared/types";

export interface TutorMemoryGreeting {
  /** Hero greeting line. Always present. */
  greeting: string;
  /** Optional small subtitle under the hero. May be empty. */
  subline: string;
  /** Suggested quick-tap prompts. Mix of memory-driven (top) and
   *  generic explore (bottom). Always 4-6 entries. */
  prompts: string[];
  /** When true, the hook is still waiting on data — caller can
   *  render a generic fallback to avoid a flash of nothing. */
  loading: boolean;
  /** The most-recent subject the user studied (used by the empty
   *  state to color the hero with the subject palette). */
  recentSubject: string | null;
}

const OMAR_GENERIC_PROMPTS = [
  "Explain photosynthesis like I'm five",
  "Build me a 5-day plan for finals",
  "Solve ∫ x·sin(x) dx step by step",
  "Debug my React useEffect",
];
const NOOR_GENERIC_PROMPTS = [
  "I can't focus today",
  "I'm anxious about tomorrow's exam",
  "Help me wind down",
  "I feel stuck",
];

/** Convert subject keys to short display names for prompt copy. */
function subjectToConvo(subject: string): string {
  const p = paletteFor(subject);
  return p.label.toLowerCase();
}

/** Days since an ISO timestamp; Infinity if missing/invalid. */
function daysSince(iso: string | null | undefined): number {
  if (!iso) return Infinity;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return Infinity;
  return (Date.now() - t) / 86400000;
}

/** First name from a full name, gracefully. */
function firstName(name: string | undefined | null): string {
  if (!name) return "";
  const parts = name.trim().split(/\s+/);
  return parts[0] || "";
}

/** Pick from N variants deterministically by day so the same user
 *  doesn't see the exact same line every refresh — but it stays
 *  stable within a single visit. */
function dailyPick<T>(arr: T[]): T {
  if (arr.length === 0) throw new Error("dailyPick: empty");
  const d = new Date();
  const day = d.getUTCFullYear() * 1000 + d.getUTCMonth() * 31 + d.getUTCDate();
  return arr[day % arr.length];
}

/** Build memory-driven prompts from a subject progress row. */
function promptsForSubject(row: SubjectProgressSummary): string[] {
  const subj = subjectToConvo(String(row.subject));
  const out: string[] = [];
  // Lead with what's overdue / weak — those are the highest-leverage
  // re-entries. Topics_count is a cap; if there are no recorded
  // topics yet, fall back to a generic per-subject practice prompt.
  if (row.weakCount > 0) {
    out.push(`Quiz me on ${subj}`);
    out.push(`Walk me through a ${subj} problem`);
  } else if (row.sessionsCount >= 1) {
    out.push(`Pick up where we left off in ${subj}`);
    out.push(`Give me one ${subj} problem to warm up`);
  }
  return out;
}

export function useTutorMemory(persona: AIPersona): TutorMemoryGreeting {
  const { profile } = useApp();
  const { rows, loading: progressLoading } = useSubjectProgress();
  const streak = useStreak();

  return useMemo<TutorMemoryGreeting>(() => {
    const isOmar = persona === "omar";
    const generic = isOmar ? OMAR_GENERIC_PROMPTS : NOOR_GENERIC_PROMPTS;

    // Noor doesn't get the memory greeting — emotional state is
    // immediate, not a "remember last session" thing. Just route to
    // the generic line.
    if (!isOmar) {
      return {
        greeting: "What's on your mind?",
        subline: "I'll listen first. Vent, ask, or just sit here.",
        prompts: generic,
        loading: false,
        recentSubject: null,
      };
    }

    if (progressLoading || streak.loading) {
      return {
        greeting: "What are we learning today?",
        subline: "",
        prompts: generic,
        loading: true,
        recentSubject: null,
      };
    }

    const name = firstName(profile?.name);
    const greetName = name ? `, ${name}` : "";

    // Sorted-by-recency rows from useSubjectProgress.
    const recent = rows[0];
    const recentSubject = recent ? String(recent.subject) : null;
    const daysAway = recent ? daysSince(recent.lastSessionAt) : Infinity;

    // Compose memory-driven prompts (top of list) + generic (filler).
    const memoryPrompts: string[] = [];
    for (const r of rows.slice(0, 2)) {
      memoryPrompts.push(...promptsForSubject(r));
    }
    // Trim duplicates while preserving order.
    const seen = new Set<string>();
    const uniqMemory = memoryPrompts.filter((p) => {
      const k = p.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).slice(0, 4);

    // Top up to ~5 with generic options the student might not have
    // seen yet — never overlapping with memory prompts.
    const memSet = new Set(uniqMemory.map((p) => p.toLowerCase()));
    const fillers = generic.filter((p) => !memSet.has(p.toLowerCase()));
    const prompts = [...uniqMemory, ...fillers].slice(0, 5);

    // Greeting variants — pick by day so it varies, never identical
    // back-to-back. Each branch references the actual data so the
    // student feels seen, not addressed.

    // First-time / no progress yet.
    if (rows.length === 0 && streak.current === 0) {
      return {
        greeting: dailyPick([
          `What are we learning today${greetName}?`,
          `Welcome${greetName}. What's first?`,
          `Ready when you are${greetName}. What are we tackling?`,
        ]),
        subline: "",
        prompts: generic,
        loading: false,
        recentSubject: null,
      };
    }

    // On a hot streak today (already studied today).
    if (streak.current >= 1 && streak.lastActiveDay && daysSince(streak.lastActiveDay) < 1) {
      const recentLabel = recent ? subjectToConvo(String(recent.subject)) : null;
      return {
        greeting: dailyPick([
          `Back already${greetName}? Let's keep it rolling.`,
          `Round two${greetName}. What's the move?`,
          `Welcome back${greetName}.`,
        ]),
        subline: recentLabel
          ? `${streak.current}-day streak. Last session was ${recentLabel} — keep going or new topic?`
          : `${streak.current}-day streak — let's keep it going.`,
        prompts,
        loading: false,
        recentSubject,
      };
    }

    // Returning after gap, but streak still alive (yesterday).
    if (streak.current >= 1 && recent && daysAway < 2) {
      const recentLabel = subjectToConvo(String(recent.subject));
      return {
        greeting: dailyPick([
          `Welcome back${greetName}.`,
          `Glad you're back${greetName}.`,
          `Right on time${greetName}.`,
        ]),
        subline: `${streak.current}-day streak. Last session: ${recentLabel}. Pick up where we left off?`,
        prompts,
        loading: false,
        recentSubject,
      };
    }

    // Returning after a longer gap (streak might have reset).
    if (recent) {
      const recentLabel = subjectToConvo(String(recent.subject));
      const dayCount = Math.round(Math.min(daysAway, 60));
      const dayCopy = dayCount === 1 ? "a day" : `${dayCount} days`;
      return {
        greeting: dailyPick([
          `It's been ${dayCopy}${greetName}.`,
          `Welcome back${greetName}.`,
          `You came back${greetName}. Good.`,
        ]),
        subline: `Last time we worked on ${recentLabel}. Want to revisit, or somewhere new?`,
        prompts,
        loading: false,
        recentSubject,
      };
    }

    // Catch-all (streak exists but no progress rows — unusual).
    return {
      greeting: `What are we learning today${greetName}?`,
      subline: streak.current > 0 ? `${streak.current}-day streak — keep it alive.` : "",
      prompts: generic,
      loading: false,
      recentSubject: null,
    };
  }, [persona, profile?.name, rows, progressLoading, streak.current, streak.lastActiveDay, streak.loading]);
}
