/**
 * useRoomMembers — fetch the profiles of everyone in a given room.
 *
 * Production reads via group_members + a join to profiles. We
 * re-query when the room id changes, and when toggleJoin succeeds
 * (callers refresh by changing a key).
 *
 * RLS: group_members SELECT requires authenticated. Anon viewers
 * get an empty array.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Profile } from "@/lib/supabase";

// Extended to include uni + subjects so RoomCard can compute match
// scores against each member without a second per-member fetch.
export type RoomMember = Pick<Profile, "id" | "name" | "avatar_color" | "photo_mode" | "photo_url" | "major" | "year" | "uni" | "subjects">;

export function useRoomMembers(roomId: string | null) {
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!roomId || !supabase) { setMembers([]); return; }
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("group_members")
        .select("user_id, profile:profiles(id, name, avatar_color, photo_mode, photo_url, major, year, uni, subjects)")
        .eq("group_id", roomId);
      if (error) throw error;
      const rows = (data ?? []) as unknown as Array<{ user_id: string; profile: RoomMember | null }>;
      setMembers(rows.map(r => r.profile).filter((p): p is RoomMember => !!p));
    } catch {
      setMembers([]);
    } finally {
      setLoading(false);
    }
  }, [roomId]);

  useEffect(() => { void load(); }, [load]);

  return { members, loading, refresh: load };
}
