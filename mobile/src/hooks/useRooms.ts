/**
 * useRooms — real group_rooms from Supabase with join/leave/create.
 *
 * Port of the web `useRealRooms` hook, trimmed to what the mobile UI
 * needs:
 *   - list visible rooms (with host profile joined in)
 *   - is the current user a member?
 *   - join / leave with optimistic UI (rollback on error)
 *   - create a new room
 *   - delete a room (host only)
 *   - realtime subscription so the list updates live
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { GroupRoom, Profile } from '@/lib/supabase';

export interface RoomFeedItem extends GroupRoom {
  joined: boolean;
  host?: Profile;
}

export type NewRoomPayload = {
  subject: string;
  date: string;        // YYYY-MM-DD
  time: string;        // HH:MM
  type: 'online' | 'in_person';
  spots: number;
  link?: string;
  location?: string;
};

export function useRooms() {
  const [rooms, setRooms] = useState<RoomFeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const user = sessionData.session?.user;

      const [{ data: groupRows, error: gErr }, { data: memberRows, error: mErr }] =
        await Promise.all([
          supabase
            .from('group_rooms')
            .select('*, host:profiles!fk_group_rooms_host(*)')
            .order('created_at', { ascending: false })
            .limit(50),
          user
            ? supabase.from('group_members').select('group_id').eq('user_id', user.id)
            : Promise.resolve({ data: [], error: null }),
        ]);

      if (gErr || mErr) throw gErr ?? mErr;

      const joined = new Set((memberRows ?? []).map((r: { group_id: string }) => r.group_id));
      setRooms(
        ((groupRows ?? []) as (GroupRoom & { host?: Profile })[]).map(g => ({
          ...g,
          joined: joined.has(g.id),
        })),
      );
    } catch (e) {
      setError((e as Error).message ?? 'Could not load rooms.');
    } finally {
      setLoading(false);
    }
  }, []);

  /** Optimistic join/leave; rolls back the local state if the write fails. */
  const toggleJoin = useCallback(async (room: RoomFeedItem) => {
    const { data: sessionData } = await supabase.auth.getSession();
    const user = sessionData.session?.user;
    if (!user) return { ok: false as const, error: 'Not signed in' };

    // Optimistic flip
    setRooms(prev => prev.map(r =>
      r.id === room.id
        ? { ...r, joined: !r.joined, filled: r.joined ? Math.max(0, r.filled - 1) : r.filled + 1 }
        : r,
    ));

    try {
      if (room.joined) {
        const { error: dErr } = await supabase
          .from('group_members')
          .delete()
          .match({ group_id: room.id, user_id: user.id });
        if (dErr) throw dErr;
        try { await supabase.rpc('increment_filled', { room_id: room.id, delta: -1 }); } catch { /* RPC optional */ }
      } else {
        // Capacity guard.
        if (room.filled >= room.spots) {
          setRooms(prev => prev.map(r => r.id === room.id ? { ...r, joined: false, filled: room.filled } : r));
          return { ok: false as const, error: 'Room is full' };
        }
        const { error: iErr } = await supabase
          .from('group_members')
          .upsert({ group_id: room.id, user_id: user.id }, { onConflict: 'group_id,user_id' });
        if (iErr) throw iErr;
        try { await supabase.rpc('increment_filled', { room_id: room.id, delta: 1 }); } catch { /* RPC optional */ }
      }
      return { ok: true as const };
    } catch (e) {
      // Rollback
      setRooms(prev => prev.map(r => r.id === room.id
        ? { ...r, joined: room.joined, filled: room.filled }
        : r,
      ));
      return { ok: false as const, error: (e as Error).message };
    }
  }, []);

  /** Create a new room. host_id = current user. */
  const submitRoom = useCallback(async (payload: NewRoomPayload) => {
    const { data: sessionData } = await supabase.auth.getSession();
    const user = sessionData.session?.user;
    if (!user) return { ok: false as const, error: 'Not signed in' };
    if (busy) return { ok: false as const, error: 'Busy' };
    setBusy(true);
    try {
      const { data, error: err } = await supabase
        .from('group_rooms')
        .insert({
          host_id: user.id,
          subject: payload.subject.trim(),
          date: payload.date,
          time: payload.time,
          type: payload.type,
          spots: Math.max(1, payload.spots),
          filled: 0,
          link: payload.link ?? '',
          location: payload.location ?? '',
        })
        .select('*, host:profiles!fk_group_rooms_host(*)')
        .single();
      if (err) return { ok: false as const, error: err.message };
      setRooms(prev => [{ ...(data as GroupRoom & { host?: Profile }), joined: false }, ...prev]);
      return { ok: true as const, room: data as GroupRoom };
    } finally {
      setBusy(false);
    }
  }, [busy]);

  /** Delete a room. Caller should pass own room only — RLS enforces it server-side too. */
  const deleteRoom = useCallback(async (roomId: string) => {
    const { error: err } = await supabase.from('group_rooms').delete().eq('id', roomId);
    if (err) return { ok: false as const, error: err.message };
    setRooms(prev => prev.filter(r => r.id !== roomId));
    return { ok: true as const };
  }, []);

  useEffect(() => {
    load();
    // Unique channel name per mount. React Strict Mode and Fast Refresh
    // double-mount this effect: the cleanup is async (Supabase tears the
    // socket down on a microtask), so when the second mount re-uses a
    // fixed channel name like 'rooms-feed' it grabs the SAME, still-
    // subscribing channel object out of the client's internal map and
    // tries to add new `.on()` handlers after `.subscribe()` was called —
    // which throws "tried to push on a duplicated channel name" /
    // "cannot add postgres_changes callbacks after subscribe()" and the
    // Rooms tab renders empty. A per-mount suffix sidesteps the cache.
    const channelName = `rooms-feed-${Math.random().toString(36).slice(2, 10)}`;
    channelRef.current = supabase
      .channel(channelName)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'group_rooms' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'group_members' }, () => load())
      .subscribe();
    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [load]);

  return { rooms, loading, error, busy, refresh: load, toggleJoin, submitRoom, deleteRoom };
}
