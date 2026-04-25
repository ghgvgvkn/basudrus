/**
 * usePlatformStats — live count of total students on Bas Udrus.
 *
 * Returns `{ totalStudents }` — refreshes automatically when anyone
 * signs up or a profile is deleted, via realtime postgres_changes
 * on the `profiles` table.
 *
 * Cheap implementation: uses `select('id', { count: 'exact', head: true })`
 * which returns ONLY the count without pulling rows. Each refresh is
 * a single integer over the wire.
 *
 * Per-mount unique channel name so React StrictMode + remount don't
 * try to re-subscribe a cached channel (same defense pattern as
 * messages / notifications / room_messages).
 */
import { useCallback, useEffect, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export interface PlatformStats {
  totalStudents: number | null;
  /** True the very first time we have a count back from the server.
   *  Use this to fade in the badge so the UI doesn't show "0 students"
   *  during initial load. */
  ready: boolean;
}

export function usePlatformStats(): PlatformStats {
  const [totalStudents, setTotalStudents] = useState<number | null>(null);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    if (!supabase) return;
    try {
      const { count, error } = await supabase
        .from("profiles")
        .select("id", { count: "exact", head: true });
      if (error) return;
      setTotalStudents(typeof count === "number" ? count : null);
      setReady(true);
    } catch {
      // Stale-but-non-zero is better than flickering to null on a
      // transient network blip. Leave the previous value.
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Realtime — bump on every INSERT or DELETE to profiles. UPDATEs
  // don't change the count so we don't subscribe to those.
  useEffect(() => {
    if (!supabase) return;
    let channel: RealtimeChannel | null = null;
    const channelName = `platform-stats-${
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2)
    }`;

    channel = supabase
      .channel(channelName)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "profiles" }, () => { void refresh(); })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "profiles" }, () => { void refresh(); })
      .subscribe();

    return () => {
      if (channel) void supabase.removeChannel(channel);
    };
  }, [refresh]);

  return { totalStudents, ready };
}
