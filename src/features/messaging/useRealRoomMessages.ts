/**
 * useRealRoomMessages — per-room message reads, send, and realtime.
 *
 * Group-chat counterpart to useRealMessages. Same shape (load + send
 * + realtime reconcile + optimistic insert with client_id dedup) but
 * keyed to `room_id` instead of partner_id, and reads from the
 * `public.room_messages` table.
 *
 * RLS:
 *   - SELECT: members of the room (group_members) OR the host.
 *   - INSERT: same membership check + sender_id = auth.uid().
 *   - DELETE: author of the row only.
 *
 * Realtime: one channel per hook instance with a unique name (UUID
 * suffix per mount) — Supabase realtime caches channels by name and
 * adding callbacks to an already-subscribed channel throws. Same
 * defense as useRealMessages / useRealNotifications.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import type { RoomMessage } from "@/lib/supabase";
import { useSupabaseSession } from "@/features/auth/useSupabaseSession";

function generateClientId(): string {
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface UseRealRoomMessagesState {
  /** keyed by room_id */
  messages: Record<string, RoomMessage[]>;
  loading: Set<string>;
  send: (roomId: string, body: string) => Promise<void>;
  load: (roomId: string) => Promise<void>;
}

export function useRealRoomMessages(): UseRealRoomMessagesState {
  const { user } = useSupabaseSession();
  const [messages, setMessages] = useState<Record<string, RoomMessage[]>>({});
  const [loading, setLoading] = useState<Set<string>>(new Set());
  // Track client_ids of optimistic inserts so the realtime echo can
  // replace them in place rather than appending a duplicate.
  const pendingRef = useRef<Map<string, string>>(new Map());

  /** Fetch the message history for a specific room. */
  const load = useCallback(async (roomId: string) => {
    if (!user || !supabase) return;
    setLoading((s) => new Set(s).add(roomId));
    try {
      const { data, error } = await supabase
        .from("room_messages")
        .select("*, sender:profiles!fk_room_messages_sender(id, name, avatar_color, photo_mode, photo_url)")
        .eq("room_id", roomId)
        .order("created_at", { ascending: true })
        .limit(200);
      if (error) throw error;
      setMessages((m) => ({ ...m, [roomId]: (data ?? []) as unknown as RoomMessage[] }));
    } catch {
      // Leave existing thread state untouched on error — the next
      // realtime tick or a manual refresh will recover.
    } finally {
      setLoading((s) => { const n = new Set(s); n.delete(roomId); return n; });
    }
  }, [user]);

  /** Send a text message to a room. Optimistic append + INSERT;
   *  realtime echo reconciles via client_id. */
  const send = useCallback(async (roomId: string, body: string) => {
    const trimmed = body.trim();
    if (!user || !supabase || !trimmed) return;
    const client_id = generateClientId();
    pendingRef.current.set(client_id, roomId);

    const optimistic: RoomMessage = {
      id: client_id,
      room_id: roomId,
      sender_id: user.id,
      text: trimmed,
      message_type: "text",
      file_url: null,
      file_name: null,
      client_id,
      created_at: new Date().toISOString(),
    };
    setMessages((m) => ({ ...m, [roomId]: [...(m[roomId] ?? []), optimistic] }));

    try {
      const { error } = await supabase.from("room_messages").insert({
        room_id: roomId,
        sender_id: user.id,
        text: trimmed,
        message_type: "text",
        client_id,
      });
      if (error) throw error;
    } catch {
      // Roll back the optimistic placeholder. Production retries; the
      // preview just removes so the user can re-send.
      setMessages((m) => ({
        ...m,
        [roomId]: (m[roomId] ?? []).filter((msg) => msg.client_id !== client_id),
      }));
      pendingRef.current.delete(client_id);
    }
  }, [user]);

  // ── Realtime subscription ──────────────────────────────────────
  // Channel filtering on room_id isn't possible without knowing every
  // room ahead of time, so we subscribe to ALL room_messages INSERTs
  // and rely on RLS to deliver only rows the user can read. RLS-aware
  // realtime is enabled by default for postgres_changes — rooms the
  // viewer isn't a member of will be filtered out before they reach
  // the client.
  //
  // Channel name per-mount UUID prevents the "cannot add
  // postgres_changes callbacks ... after subscribe()" cache hit.
  useEffect(() => {
    if (!user || !supabase) return;
    let channel: RealtimeChannel | null = null;
    const channelName = `room-msg-inbox-${user.id}-${
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2)
    }`;

    channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "room_messages",
        },
        (payload) => {
          const row = payload.new as RoomMessage;
          const roomId = row.room_id;
          setMessages((m) => {
            const thread = m[roomId];
            // Don't materialize a thread we haven't loaded yet — the
            // open ChatView calls load() on mount, and merging into a
            // never-loaded thread would just leak unbounded memory.
            if (!thread) return m;
            // Dedup by id OR client_id (our own optimistic echo).
            const idx = row.client_id
              ? thread.findIndex((x) => x.client_id === row.client_id)
              : -1;
            if (idx !== -1) {
              const next = thread.slice();
              next[idx] = row;
              if (row.client_id) pendingRef.current.delete(row.client_id);
              return { ...m, [roomId]: next };
            }
            if (thread.some((x) => x.id === row.id)) return m;
            return { ...m, [roomId]: [...thread, row] };
          });
        },
      )
      .subscribe();

    return () => {
      if (channel) {
        void supabase.removeChannel(channel);
      }
    };
  }, [user]);

  return { messages, loading, send, load };
}
