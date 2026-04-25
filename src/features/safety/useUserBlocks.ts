/**
 * useUserBlocks — load the viewer's block set + a quick predicate.
 *
 * The set is built from `user_blocks` rows where the viewer is EITHER
 * the blocker OR the blocked party — both directions hide the user
 * from the calling viewer's surfaces (mutual hide is friendlier than
 * asymmetric and prevents the blocked party from creating a second
 * account specifically because they noticed they were blocked).
 *
 * Cheap: ~1 small SELECT per session. Each row is two uuids + a
 * timestamp. Typical sets are 0-10 entries; even 100s wouldn't be
 * meaningful weight.
 *
 * Refreshes on `bu:user-blocked` / `bu:user-unblocked` events so
 * Discover, Connect, etc. re-filter immediately after the block.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useSupabaseSession } from "@/features/auth/useSupabaseSession";

export interface UserBlocksState {
  /** Set of user_ids the viewer should NOT see anywhere in the app. */
  blockedSet: Set<string>;
  /** Quick predicate. */
  isBlocked: (userId: string) => boolean;
  loading: boolean;
  /** Programmatic unblock (used by Profile → Blocked users). */
  unblock: (userId: string) => Promise<void>;
}

export function useUserBlocks(): UserBlocksState {
  const { user, loading: authLoading } = useSupabaseSession();
  const [blockedSet, setBlockedSet] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!user || !supabase) {
      setBlockedSet(new Set());
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("user_blocks")
        .select("blocker_id, blocked_id")
        .or(`blocker_id.eq.${user.id},blocked_id.eq.${user.id}`);
      if (error) throw error;
      const set = new Set<string>();
      for (const row of (data ?? []) as Array<{ blocker_id: string; blocked_id: string }>) {
        // Add the OTHER party — the user we should hide from view.
        if (row.blocker_id === user.id) set.add(row.blocked_id);
        else if (row.blocked_id === user.id) set.add(row.blocker_id);
      }
      setBlockedSet(set);
    } catch {
      setBlockedSet(new Set());
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    void reload();
  }, [authLoading, reload]);

  // React to block events from anywhere in the app.
  useEffect(() => {
    const onChange = () => { void reload(); };
    window.addEventListener("bu:user-blocked", onChange);
    window.addEventListener("bu:user-unblocked", onChange);
    return () => {
      window.removeEventListener("bu:user-blocked", onChange);
      window.removeEventListener("bu:user-unblocked", onChange);
    };
  }, [reload]);

  const isBlocked = useCallback((userId: string) => blockedSet.has(userId), [blockedSet]);

  const unblock = useCallback(async (userId: string) => {
    if (!user || !supabase) return;
    try {
      await supabase
        .from("user_blocks")
        .delete()
        .eq("blocker_id", user.id)
        .eq("blocked_id", userId);
      try { window.dispatchEvent(new CustomEvent("bu:user-unblocked", { detail: { unblockedId: userId } })); } catch { /* noop */ }
    } catch { /* swallow — caller can refresh and retry */ }
  }, [user]);

  return useMemo(() => ({ blockedSet, isBlocked, loading, unblock }), [blockedSet, isBlocked, loading, unblock]);
}
