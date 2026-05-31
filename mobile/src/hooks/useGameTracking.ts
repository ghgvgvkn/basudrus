/**
 * useGameTracking — keeps `profiles.streak` and `profiles.xp` honest.
 *
 * Writes go through atomic RPCs:
 *   `award_xp(p_amount)` and `record_daily_activity()` (see
 *   sql/20260530_atomic_gamification.sql) do the increment / streak
 *   recompute in a single statement, so the ~9 screens that each mount
 *   this hook can't clobber each other's XP/streak. Each call falls back
 *   to the legacy client-side read-modify-write if the RPC isn't deployed
 *   yet, so the app keeps working before the migration is applied.
 *
 * What it does:
 *   1. On mount (or when called), `recordActivity()` reads the profile's
 *      last `streak_day` (stashed in `last_seen_at`-adjacent logic) and:
 *      - same calendar day  → no streak change
 *      - yesterday          → +1 streak
 *      - older / never      → reset to 1
 *      Then writes `streak` and `last_seen_at = now()`.
 *   2. `awardXP(amount)` reads current `xp`, adds, writes back.
 *
 * The hook also returns the latest snapshot so screens that already
 * read `xp` / `streak` can stay in sync without a separate query.
 *
 * Both helpers no-op when there's no signed-in user — safe to call
 * unconditionally on app open.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';

type Snapshot = { xp: number; streak: number; lastSeenAt: string | null };

const SAME_DAY = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear()
  && a.getMonth() === b.getMonth()
  && a.getDate() === b.getDate();

export function useGameTracking() {
  const { session } = useAuth();
  const uid = session?.user?.id ?? null;
  const [snap, setSnap] = useState<Snapshot>({ xp: 0, streak: 0, lastSeenAt: null });
  // In-flight guard so simultaneous awards don't race themselves into
  // a single increment.
  const writing = useRef(false);

  const refresh = useCallback(async () => {
    if (!uid) return;
    const { data } = await supabase
      .from('profiles')
      .select('xp, streak, last_seen_at')
      .eq('id', uid)
      .maybeSingle();
    if (data) {
      setSnap({
        xp: (data as { xp?: number }).xp ?? 0,
        streak: (data as { streak?: number }).streak ?? 0,
        lastSeenAt: (data as { last_seen_at?: string }).last_seen_at ?? null,
      });
    }
  }, [uid]);

  /**
   * Call this when the app opens / Home screen mounts. Updates streak
   * + last_seen_at in one round trip.
   */
  const recordActivity = useCallback(async () => {
    if (!uid) return;

    // Preferred path: atomic server-side recompute via RPC. Fixes (1) the
    // unguarded streak clobber when multiple screens call this at once, and
    // (2) the timezone bug — the old client logic WROTE last_seen_at in UTC
    // but COMPARED it in device-local time, so a real consecutive day near
    // midnight could reset the streak. The RPC uses one fixed day boundary.
    const { data, error } = await supabase.rpc('record_daily_activity');
    if (!error && Array.isArray(data) && data[0]) {
      const row = data[0] as { streak?: number; last_seen_at?: string };
      setSnap(s => ({
        ...s,
        streak: row.streak ?? s.streak,
        lastSeenAt: row.last_seen_at ?? s.lastSeenAt,
      }));
      return;
    }

    // ── Fallback: legacy client-side logic (used only if the RPC isn't
    //    deployed yet). Keeps the app working before the migration lands. ──
    const { data: cur } = await supabase
      .from('profiles')
      .select('streak, last_seen_at')
      .eq('id', uid)
      .maybeSingle();

    const now = new Date();
    const last = (cur as { last_seen_at?: string } | null)?.last_seen_at;
    const lastDate = last ? new Date(last) : null;
    const curStreak = (cur as { streak?: number } | null)?.streak ?? 0;

    let nextStreak = curStreak;
    if (!lastDate) {
      nextStreak = 1;
    } else if (SAME_DAY(lastDate, now)) {
      // Already counted today — no change. But ensure streak >= 1.
      nextStreak = Math.max(1, curStreak);
    } else {
      const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
      if (SAME_DAY(lastDate, yesterday)) nextStreak = curStreak + 1;
      else nextStreak = 1; // missed a day → reset
    }

    const { error: updErr } = await supabase
      .from('profiles')
      .update({ streak: nextStreak, last_seen_at: now.toISOString() })
      .eq('id', uid);
    if (!updErr) {
      setSnap(s => ({ ...s, streak: nextStreak, lastSeenAt: now.toISOString() }));
    }
  }, [uid]);

  /** Add to the user's XP total. No-op without a session. */
  const awardXP = useCallback(async (amount: number) => {
    if (!uid || amount <= 0) return;

    // Preferred path: atomic increment via RPC. The old read-modify-write
    // clobbered XP because ~9 screens each mount this hook — two instances
    // would both read xp, add, and write, and one overwrote the other.
    // award_xp does `xp = xp + amount` in a single statement.
    const { data, error } = await supabase.rpc('award_xp', { p_amount: amount });
    if (!error && typeof data === 'number') {
      setSnap(s => ({ ...s, xp: data }));
      return;
    }

    // ── Fallback: legacy read-modify-write (used only if the RPC isn't
    //    deployed yet). Self-race guarded so it at least doesn't fight
    //    itself within this one instance. ──
    if (writing.current) return;
    writing.current = true;
    try {
      const { data: cur } = await supabase
        .from('profiles')
        .select('xp')
        .eq('id', uid)
        .maybeSingle();
      const next = ((cur as { xp?: number } | null)?.xp ?? 0) + amount;
      const { error: updErr } = await supabase
        .from('profiles')
        .update({ xp: next })
        .eq('id', uid);
      if (!updErr) setSnap(s => ({ ...s, xp: next }));
    } finally {
      writing.current = false;
    }
  }, [uid]);

  // Initial load when the user becomes available.
  useEffect(() => { void refresh(); }, [refresh]);

  return { ...snap, refresh, recordActivity, awardXP };
}
