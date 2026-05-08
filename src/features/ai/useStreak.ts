/**
 * useStreak — daily-streak tracking + variable-reward milestones for
 * the AI tutor.
 *
 * The streak concept is the simplest, most-studied retention loop in
 * existence (Duolingo's flagship mechanic). Every day a student opens
 * the AI and sends at least one message, current_streak ticks up. Skip
 * a day → resets to 1 the next time they come back.
 *
 * Variable rewards on top of the streak — instead of the same generic
 * congratulation every day, milestone tiers fire a celebratory toast
 * with copy that varies per tier (3 days = first proof of habit,
 * 7 = one week, 14, 30, 60, 100, 365). Each tier's copy is randomly
 * picked from a small pool, so even returning to the same milestone
 * for someone re-doing it after a reset feels fresh.
 *
 * Persistence: `public.tutor_streaks` table (own-only RLS). One row
 * per user, upserted on each bump. The bump is idempotent within a
 * day — calling recordToday() twice on the same day leaves state
 * unchanged.
 *
 * Failure mode: silent. If the network is dead we keep the local
 * counter optimistically; the next successful bump reconciles. We
 * never show streak-related errors to the student — losing a day
 * because Supabase blipped is the kind of pain that destroys trust.
 *
 * Timezone: we use UTC dates, not local. Jordan is UTC+3, so a UTC
 * date "today" rolls over at 3 AM local time. That's actually the
 * right boundary for a study app — anything you're doing at 2 AM
 * is yesterday's grind, not today's start.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useSupabaseSession } from "@/features/auth/useSupabaseSession";

/** Milestone tiers in days. Adding here automatically wires up the
 *  celebration toast — see MILESTONE_COPY for matching copy pools. */
export const MILESTONES = [3, 7, 14, 30, 60, 100, 365] as const;
export type MilestoneTier = (typeof MILESTONES)[number];

/** Variable-reward copy pools. We pick a random line per tier so the
 *  same milestone hit twice (after a reset) doesn't feel canned.
 *  Each entry is { title, body, emoji } — the toast component reads
 *  these directly. */
export const MILESTONE_COPY: Record<MilestoneTier, Array<{ title: string; body: string; emoji: string }>> = {
  3: [
    { emoji: "🌱", title: "3 days in a row.", body: "First milestone. Habit is starting to form — keep going." },
    { emoji: "🔥", title: "Day 3.", body: "Two more shows up. Three more is rare. Stay rare." },
    { emoji: "💪", title: "Three in a row.", body: "Most students never get past day 2. You did." },
  ],
  7: [
    { emoji: "🎯", title: "One week.", body: "Seven straight days. This is a real habit now, not motivation." },
    { emoji: "🔥", title: "Week 1 locked.", body: "The hardest week is the first. You finished it." },
    { emoji: "🏆", title: "7-day streak.", body: "Less than 5% of students hit 7 days. You're one of them." },
  ],
  14: [
    { emoji: "⚡", title: "Two weeks.", body: "Habit consolidating. Skipping a day will actually feel weird now." },
    { emoji: "🔥", title: "14 days clean.", body: "Half a month. You're not motivated — you're trained." },
  ],
  30: [
    { emoji: "🏔️", title: "30 days.", body: "A full month of consistency. This isn't a phase, it's who you are now." },
    { emoji: "🎓", title: "30-day mark.", body: "Studies show 30+ days of repetition is when behavior becomes identity. You crossed it." },
    { emoji: "🌟", title: "Month 1 complete.", body: "Most New Year resolutions die before today. Yours is alive." },
  ],
  60: [
    { emoji: "🚀", title: "60 days.", body: "Two months. Top 1% of students who ever start a streak make it here." },
    { emoji: "💎", title: "Day 60.", body: "Compound interest on focus. What you're doing now is rare." },
  ],
  100: [
    { emoji: "💯", title: "100 days.", body: "Triple digits. Whatever you came here for, you're going to get it." },
    { emoji: "👑", title: "Day 100.", body: "Three months of showing up. The grades will follow. They always do." },
  ],
  365: [
    { emoji: "🌌", title: "ONE YEAR.", body: "365 days of choosing to show up. You are not the same person you were a year ago." },
    { emoji: "🏛️", title: "365 days.", body: "Discipline at this level changes a life. Yours is changing." },
  ],
};

export interface StreakState {
  current: number;
  longest: number;
  /** ISO YYYY-MM-DD, UTC. */
  lastActiveDay: string | null;
  totalSessions: number;
  milestonesReached: number[];
  loading: boolean;
}

export interface MilestoneEvent {
  tier: MilestoneTier;
  emoji: string;
  title: string;
  body: string;
}

export interface UseStreakReturn extends StreakState {
  /** Bump-once-per-day. Returns a MilestoneEvent if this bump crossed
   *  a never-seen-before milestone tier; null otherwise. Safe to call
   *  any number of times per day — only the first call per UTC date
   *  has any effect. */
  recordToday: () => Promise<MilestoneEvent | null>;
}

// ─────────────────────────────────────────────────────────────────
// Date helpers — UTC only. We use plain ISO date strings so we can
// compare with === and avoid timezone surprises. Date math goes
// through millisecond diffs (1 day = 86400000 ms) which is correct
// for UTC dates.
// ─────────────────────────────────────────────────────────────────

function utcToday(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function daysBetween(aISO: string, bISO: string): number {
  const a = new Date(`${aISO}T00:00:00Z`).getTime();
  const b = new Date(`${bISO}T00:00:00Z`).getTime();
  return Math.round((a - b) / 86400000);
}

/** Pick a random copy variant for a milestone tier. */
function pickMilestoneCopy(tier: MilestoneTier): MilestoneEvent {
  const pool = MILESTONE_COPY[tier];
  const choice = pool[Math.floor(Math.random() * pool.length)];
  return { tier, emoji: choice.emoji, title: choice.title, body: choice.body };
}

// ─────────────────────────────────────────────────────────────────

const EMPTY: StreakState = {
  current: 0,
  longest: 0,
  lastActiveDay: null,
  totalSessions: 0,
  milestonesReached: [],
  loading: true,
};

export function useStreak(): UseStreakReturn {
  const { user } = useSupabaseSession();
  const [state, setState] = useState<StreakState>(EMPTY);
  // Stable ref for the bump path — avoids re-creating the closure on
  // every render and lets useEffect cleanup work correctly even mid-
  // bump. We mutate this in setState's updater for atomicity.
  const stateRef = useRef<StreakState>(EMPTY);
  stateRef.current = state;
  // CRITICAL: gate on successful load. Two failure modes this prevents:
  //   1. Race — user sends a message before load completes. Without
  //      the gate we'd compute nextCurrent=1 from EMPTY state and
  //      upsert, clobbering whatever was in the DB.
  //   2. Load errored — bumping anyway would write current=1, which
  //      can DESTROY a real 47-day streak if the user's network
  //      blipped on app open. Refusing to write until we've read at
  //      least once is the only safe behaviour.
  // Reset to false whenever the user changes (sign-out / sign-in).
  const loadedOkRef = useRef<boolean>(false);

  // Initial load.
  useEffect(() => {
    loadedOkRef.current = false;
    if (!user || !supabase) {
      setState({ ...EMPTY, loading: false });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    void (async () => {
      try {
        const { data, error } = await supabase
          .from("tutor_streaks")
          .select("current_streak,longest_streak,last_active_day,total_sessions,milestones_reached")
          .eq("user_id", user.id)
          .maybeSingle();
        if (cancelled) return;
        if (error) {
          // Log + bail. State stays at EMPTY but loadedOkRef stays
          // false — recordToday() will refuse to write so we don't
          // destroy a real streak we just couldn't read this session.
          if (import.meta.env.DEV) console.warn("[useStreak] load:", error);
          setState({ ...EMPTY, loading: false });
          return;
        }
        if (!data) {
          // No row yet — fresh user, safe to bump.
          loadedOkRef.current = true;
          setState({ ...EMPTY, loading: false });
          return;
        }
        // Successful read of an existing row.
        loadedOkRef.current = true;
        setState({
          current: data.current_streak ?? 0,
          longest: data.longest_streak ?? 0,
          lastActiveDay: data.last_active_day ?? null,
          totalSessions: data.total_sessions ?? 0,
          milestonesReached: Array.isArray(data.milestones_reached) ? data.milestones_reached : [],
          loading: false,
        });
      } catch (e) {
        if (import.meta.env.DEV) console.warn("[useStreak] load threw:", e);
        if (!cancelled) setState({ ...EMPTY, loading: false });
        // loadedOkRef stays false — see comment above.
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  const recordToday = useCallback(async (): Promise<MilestoneEvent | null> => {
    if (!user || !supabase) return null;
    // Refuse to bump until we've successfully read at least once.
    // Without this gate we risk clobbering a real streak on transient
    // network or RLS errors. The next AI message after a successful
    // load will pick up the bump — at most a one-message delay.
    if (!loadedOkRef.current) return null;

    const today = utcToday();
    const cur = stateRef.current;

    // Idempotent within a day.
    if (cur.lastActiveDay === today) return null;

    // Compute the next state.
    let nextCurrent: number;
    if (!cur.lastActiveDay) {
      nextCurrent = 1;
    } else {
      const diff = daysBetween(today, cur.lastActiveDay);
      if (diff === 1) {
        nextCurrent = cur.current + 1;
      } else if (diff === 0) {
        // Should have been caught above; defensive.
        return null;
      } else if (diff < 0) {
        // Clock went backwards (timezone joke or system clock reset).
        // Refuse the bump rather than create nonsense state.
        if (import.meta.env.DEV) console.warn("[useStreak] today < lastActive — skipping bump");
        return null;
      } else {
        // Skipped at least one day → reset.
        nextCurrent = 1;
      }
    }
    const nextLongest = Math.max(cur.longest, nextCurrent);
    const nextTotal = cur.totalSessions + 1;

    // Milestone detection: did we just cross a tier we hadn't yet?
    const crossedTier = MILESTONES.find(
      (t) => nextCurrent === t && !cur.milestonesReached.includes(t),
    );
    const nextMilestones = crossedTier
      ? [...cur.milestonesReached, crossedTier].sort((a, b) => a - b)
      : cur.milestonesReached;
    const milestoneEvent = crossedTier ? pickMilestoneCopy(crossedTier as MilestoneTier) : null;

    // Optimistic local update — UI flips immediately even if network
    // is slow. The DB write follows with one retry; failure leaves
    // the optimistic state intact and the next mount reloads from DB
    // to converge.
    setState({
      current: nextCurrent,
      longest: nextLongest,
      lastActiveDay: today,
      totalSessions: nextTotal,
      milestonesReached: nextMilestones,
      loading: false,
    });

    // Persist with one retry on transient failure (matches the
    // useSavedMessages pattern). We don't surface errors to the user —
    // a quietly-failed streak bump is recoverable on next session;
    // an error toast destroys the gamification feel.
    void (async () => {
      const payload = {
        user_id: user.id,
        current_streak: nextCurrent,
        longest_streak: nextLongest,
        last_active_day: today,
        total_sessions: nextTotal,
        milestones_reached: nextMilestones,
      };
      const writeOnce = async (): Promise<boolean> => {
        try {
          const { error } = await supabase
            .from("tutor_streaks")
            .upsert(payload, { onConflict: "user_id" });
          if (error) {
            if (import.meta.env.DEV) console.warn("[useStreak] upsert:", error);
            return false;
          }
          return true;
        } catch (e) {
          if (import.meta.env.DEV) console.warn("[useStreak] upsert threw:", e);
          return false;
        }
      };
      const ok = await writeOnce();
      if (!ok) {
        // 500 ms backoff, single retry. Beyond that we bail; the user
        // will reconcile next mount and we don't need a 3rd attempt
        // for a non-critical write.
        await new Promise((r) => setTimeout(r, 500));
        await writeOnce();
      }
    })();

    return milestoneEvent;
  }, [user]);

  return { ...state, recordToday };
}
