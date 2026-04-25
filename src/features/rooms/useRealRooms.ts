/**
 * useRealRooms — real `group_rooms` + `group_members` from Supabase.
 *
 * Minimal port of the production useRooms hook, tuned to what the
 * redesign RoomsScreen actually renders:
 *   - list rooms (with host profile joined)
 *   - per-room "is current user a member?" flag
 *   - join / leave via group_members + RPC to increment filled
 *   - create (submitGroup)
 *
 * Full edit/delete/member-viewer flows are TODO for the next pass —
 * this is enough to replace the hardcoded ROOMS array.
 *
 * RLS: `group_rooms_select_authenticated` requires a signed-in user.
 * Signed-out viewers get zero rows and the UI shows a sign-in nudge.
 *
 * Writes use `host_id` / `user_id` = `auth.uid()` which is enforced
 * by the INSERT / UPDATE / DELETE policies.
 */
import { useCallback, useEffect, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import type { GroupRoom, Profile } from "@/lib/supabase";
import { useSupabaseSession } from "@/features/auth/useSupabaseSession";

export interface RoomFeedItem extends GroupRoom {
  joined: boolean;
  host?: Profile;
}

export function useRealRooms() {
  const { user, loading: authLoading } = useSupabaseSession();
  const [rooms, setRooms] = useState<RoomFeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<"blocked" | "offline" | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!supabase) { setError("offline"); setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      // Parallel: all visible rooms + the rows showing which groups
      // THIS user is already in. Production uses `withRetry` for
      // Cloudflare 520s — for a preview we just let Supabase retry.
      const [{ data: groupRows, error: gErr },
             { data: memberRows, error: mErr }] = await Promise.all([
        supabase
          .from("group_rooms")
          .select("*, host:profiles!fk_group_rooms_host(*)")
          .order("created_at", { ascending: false })
          .limit(50),
        user
          ? supabase.from("group_members").select("group_id").eq("user_id", user.id)
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (gErr || mErr) {
        setError("offline");
        setRooms([]);
        setLoading(false);
        return;
      }

      // Empty result + no user = RLS denied. Distinguish from
      // genuinely-empty-but-authed so the UI renders the right
      // empty state.
      if ((groupRows ?? []).length === 0 && !user) {
        setError("blocked");
        setRooms([]);
        setLoading(false);
        return;
      }

      const joined = new Set((memberRows ?? []).map((r: { group_id: string }) => r.group_id));
      setRooms(((groupRows ?? []) as (GroupRoom & { host?: Profile })[]).map(g => ({
        ...g,
        joined: joined.has(g.id),
      })));
      setLoading(false);
    } catch {
      setError("offline");
      setLoading(false);
    }
  }, [user]);

  // Reload when auth state changes so a fresh sign-in fetches the
  // user's joined-set.
  useEffect(() => {
    if (authLoading) return;
    void load();
  }, [authLoading, load]);

  // Realtime: re-fetch the rooms list whenever group_rooms or
  // group_members change. Covers:
  //   - new rooms appearing (someone else creates)
  //   - someone joins/leaves a room (filled count + members preview)
  //   - a host edits or deletes a room
  // Re-fetch is cheap (~50 rows max with profile join). Per-mount
  // unique channel name so React StrictMode + remount don't cache
  // a stale subscription.
  useEffect(() => {
    if (!supabase) return;
    let channel: RealtimeChannel | null = null;
    const channelName = `rooms-feed-${
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2)
    }`;

    const refresh = () => { void load(); };

    channel = supabase
      .channel(channelName)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "group_rooms" }, refresh)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "group_rooms" }, refresh)
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "group_rooms" }, refresh)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "group_members" }, refresh)
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "group_members" }, refresh)
      .subscribe();

    return () => {
      if (channel) void supabase.removeChannel(channel);
    };
  }, [load]);

  /** Create a new room. Live host_id = current user. */
  const submitRoom = useCallback(async (payload: {
    subject: string; date: string; time: string;
    type: "online" | "in_person"; spots: number;
    link?: string; location?: string;
  }) => {
    if (!user || !supabase) return { ok: false, error: "Not signed in" };
    if (busy) return { ok: false, error: "Busy" };
    setBusy(true);
    try {
      const { data, error } = await supabase.from("group_rooms").insert({
        host_id: user.id,
        subject: payload.subject,
        date: payload.date,
        time: payload.time,
        type: payload.type,
        spots: Math.max(1, payload.spots),
        filled: 0,
        link: payload.link ?? "",
        location: payload.location ?? "",
      })
        .select("*, host:profiles!fk_group_rooms_host(*)")
        .single();
      if (error) return { ok: false, error: error.message };
      setRooms(prev => [{ ...(data as GroupRoom & { host?: Profile }), joined: false }, ...prev]);
      return { ok: true as const, room: data };
    } finally {
      setBusy(false);
    }
  }, [user, busy]);

  /** Toggle join state. Optimistic UI — rolls back on server error. */
  const toggleJoin = useCallback(async (groupId: string) => {
    if (!user || !supabase) return;
    const current = rooms.find(r => r.id === groupId);
    if (!current) return;

    // Optimistic flip
    setRooms(prev => prev.map(r => r.id === groupId
      ? { ...r, joined: !r.joined, filled: r.joined ? Math.max(0, r.filled - 1) : r.filled + 1 }
      : r));

    try {
      if (current.joined) {
        // Leave: delete membership + decrement filled count
        const { error } = await supabase.from("group_members")
          .delete()
          .eq("group_id", groupId)
          .eq("user_id", user.id);
        if (error) throw error;
        await supabase.rpc("increment_filled", { room_id: groupId, delta: -1 });
      } else {
        // Join: capacity check then upsert + increment
        if (current.filled >= current.spots) {
          // rollback
          setRooms(prev => prev.map(r => r.id === groupId
            ? { ...r, joined: false, filled: Math.max(0, r.filled - 1) } : r));
          return;
        }
        const { error } = await supabase.from("group_members")
          .upsert({ group_id: groupId, user_id: user.id }, { onConflict: "group_id,user_id" });
        if (error) throw error;
        await supabase.rpc("increment_filled", { room_id: groupId, delta: 1 });
      }
    } catch {
      // Rollback optimistic change
      setRooms(prev => prev.map(r => r.id === groupId
        ? { ...r, joined: current.joined, filled: current.filled } : r));
    }
  }, [user, rooms]);

  return { rooms, loading: loading || authLoading, error, submitRoom, toggleJoin, refresh: load };
}
