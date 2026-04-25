/**
 * useRealConnections — real `connections` joined with partner profiles.
 *
 * Returns the signed-in user's connection list with the partner's
 * Profile attached. This backs the left rail of ConnectScreen.
 *
 * Ports the shape of the production `loadConnections` from useMessages
 * (line 55+) — same query, same FK alias (`connections_partner_id_fkey`).
 *
 * RLS: `connections` SELECT requires `authenticated`. Anon → empty.
 *
 * Realtime:
 *   - When someone says hi back to me (a new connections row appears
 *     with user_id = me OR partner_id = me), the thread list updates
 *     without a refresh. Same for breakups (DELETE).
 *   - We don't filter the postgres_changes by user_id here — RLS
 *     already restricts events to rows the viewer can SELECT, and
 *     filter expressions on `connections` would need to fire twice
 *     (one for each side of the OR). Cheaper to just refetch.
 */
import { useCallback, useEffect, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import type { Profile } from "@/lib/supabase";
import { useSupabaseSession } from "@/features/auth/useSupabaseSession";

export interface ConnectionRow {
  partner_id: string;
  rating: number | null;
  partner: Profile;
}

export function useRealConnections() {
  const { user, loading: authLoading } = useSupabaseSession();
  const [connections, setConnections] = useState<ConnectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<"blocked" | "offline" | null>(null);

  const load = useCallback(async () => {
    if (!user || !supabase) {
      setConnections([]);
      setLoading(false);
      setError(user ? "offline" : "blocked");
      return;
    }
    try {
      const { data, error: err } = await supabase
        .from("connections")
        .select("partner_id, rating, partner:profiles!connections_partner_id_fkey(*)")
        .eq("user_id", user.id);
      if (err) throw err;
      const rows = (data ?? []) as unknown as ConnectionRow[];
      // Filter out rows where the partner profile didn't join
      // (happens when the partner was deleted but the connection
      // row hung around — defensive).
      setConnections(rows.filter(r => !!r.partner));
      setError(null);
      setLoading(false);
    } catch {
      setError("offline");
      setLoading(false);
    }
  }, [user]);

  // Initial fetch + auth-state-change refetch.
  useEffect(() => {
    if (authLoading) return;
    setLoading(true);
    void load();
  }, [authLoading, load]);

  // Realtime: refetch when any connection row touching this user
  // is INSERTed or DELETEd. Updates (rating bump) re-fetch too so
  // the partner row stays fresh.
  useEffect(() => {
    if (!supabase || !user) return;
    let channel: RealtimeChannel | null = null;
    const channelName = `connections-${user.id}-${
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2)
    }`;
    const refresh = () => { void load(); };
    channel = supabase
      .channel(channelName)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "connections" }, refresh)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "connections" }, refresh)
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "connections" }, refresh)
      .subscribe();
    return () => {
      if (channel) void supabase.removeChannel(channel);
    };
  }, [user, load]);

  return { connections, loading: loading || authLoading, error, authed: !!user };
}
