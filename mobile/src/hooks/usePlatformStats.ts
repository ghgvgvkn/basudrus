/**
 * usePlatformStats — live count of total students on Bas Udrus.
 *
 * Mobile twin of `src/features/discover/usePlatformStats.ts` on the
 * web. Returns `{ totalStudents, ready }`. Auto-refreshes when anyone
 * signs up or a profile is deleted via realtime `postgres_changes`
 * on the `profiles` table.
 *
 * Cheap query: `select('id', { count: 'exact', head: true })` returns
 * ONLY the count without pulling rows — a single integer per refresh.
 *
 * Per-mount unique channel name avoids the "cannot add postgres_changes
 * callbacks after subscribe()" bug when React StrictMode remounts the
 * subscriber. Same defense pattern as `useDiscoverFeed`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

export interface PlatformStats {
  totalStudents: number | null;
  /** True once we've received our first count back from the server.
   *  Callers use this to avoid flashing "0 students" during the
   *  initial network round-trip. */
  ready: boolean;
}

export function usePlatformStats(): PlatformStats {
  const [totalStudents, setTotalStudents] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const refresh = useCallback(async () => {
    try {
      const { count, error } = await supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true });
      if (error) return;
      setTotalStudents(typeof count === 'number' ? count : null);
      setReady(true);
    } catch {
      // Stale-but-non-zero is better than flickering to null on a
      // transient network blip. Leave the previous value.
    }
  }, []);

  useEffect(() => {
    void refresh();

    // Realtime — bump on INSERT or DELETE only. UPDATEs don't change
    // the count so we skip them.
    const channelName = `platform-stats-${Math.random().toString(36).slice(2, 10)}`;
    channelRef.current = supabase
      .channel(channelName)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'profiles' }, () => { void refresh(); })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'profiles' }, () => { void refresh(); })
      .subscribe();

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [refresh]);

  return { totalStudents, ready };
}
