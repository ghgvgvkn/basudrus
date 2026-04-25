/**
 * useRealNotifications — read + mark-as-read against `notifications`.
 *
 * Slim port of production useNotifications. Subscribes to realtime
 * INSERTs filtered by `user_id=eq.<me>` so new notifications stream
 * in without a refresh.
 *
 * Schema: id, user_id, from_id, type, subject, post_id, read, created_at
 *         + from_profile join via from_id.
 *
 * RLS: SELECT requires `user_id = auth.uid()`. Same for UPDATE
 * (the read flag flip).
 */
import { useCallback, useEffect, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import type { Notification as NotifRow } from "@/lib/supabase";
import { useSupabaseSession } from "@/features/auth/useSupabaseSession";

export interface UseRealNotificationsState {
  notifications: NotifRow[];
  unreadCount: number;
  loading: boolean;
  error: "blocked" | "offline" | null;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  reload: () => Promise<void>;
}

export function useRealNotifications(): UseRealNotificationsState {
  const { user, loading: authLoading } = useSupabaseSession();
  const [notifications, setNotifications] = useState<NotifRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<"blocked" | "offline" | null>(null);

  const reload = useCallback(async () => {
    if (!user || !supabase) {
      setNotifications([]);
      setError(user ? "offline" : "blocked");
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data, error: err } = await supabase
        .from("notifications")
        .select("*, from_profile:profiles!notifications_from_id_fkey(id, name, avatar_color)")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (err) throw err;
      setNotifications((data ?? []) as unknown as NotifRow[]);
      setError(null);
      setLoading(false);
    } catch {
      setError("offline");
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    void reload();
  }, [authLoading, reload]);

  // Realtime — new INSERTs land instantly.
  // Channel name needs a per-mount UUID so a re-mount doesn't try
  // to add callbacks to an already-subscribed cached channel
  // (Supabase realtime throws "cannot add postgres_changes
  // callbacks ... after subscribe()" otherwise).
  useEffect(() => {
    if (!user || !supabase) return;
    let channel: RealtimeChannel | null = null;
    const channelName = `notif-inbox-${user.id}-${
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
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const row = payload.new as NotifRow;
          setNotifications((prev) => {
            if (prev.some((n) => n.id === row.id)) return prev;
            return [row, ...prev];
          });
        },
      )
      .subscribe();
    return () => { if (channel) void supabase.removeChannel(channel); };
  }, [user]);

  const markRead = useCallback(async (id: string) => {
    if (!user || !supabase) return;
    // Optimistic flip — UI doesn't wait on the round-trip.
    setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, read: true } : n));
    try {
      await supabase.from("notifications").update({ read: true }).eq("id", id).eq("user_id", user.id);
    } catch { /* swallow — next reload corrects state */ }
  }, [user]);

  const markAllRead = useCallback(async () => {
    if (!user || !supabase) return;
    const unreadIds = notifications.filter(n => !n.read).map(n => n.id);
    if (unreadIds.length === 0) return;
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    try {
      await supabase.from("notifications").update({ read: true })
        .in("id", unreadIds)
        .eq("user_id", user.id);
    } catch { /* see above */ }
  }, [user, notifications]);

  const unreadCount = notifications.filter(n => !n.read).length;

  return { notifications, unreadCount, loading: loading || authLoading, error, markRead, markAllRead, reload };
}
