import { useState, useRef, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import type { Notification } from "@/lib/supabase";
import { useApp } from "@/context/AppContext";
import { logError } from "@/services/analytics";
import { withRetry } from "@/shared/retry";

export function useNotifications() {
  const { user } = useApp();

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showNotifPanel, setShowNotifPanel] = useState(false);
  const notifPanelRef = useRef<HTMLDivElement>(null);

  const unreadCount = notifications.filter(n => !n.read).length;

  const loadNotifications = async () => {
    if (!user) return;
    try {
      const { data, error } = await withRetry(() =>
        supabase
          .from("notifications")
          .select("*, from_profile:profiles!notifications_from_id_fkey(*)")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(50)
      );
      if (error) { logError("loadNotifications", error); return; }
      if (data) setNotifications(data as Notification[]);
    } catch (e) { logError("loadNotifications", e); }
  };

  const sendNotification = async (toUserId: string, fromId: string, type: string, subject: string, postId: string | null) => {
    if (toUserId === fromId) return;
    try {
      const { error } = await supabase.from("notifications").insert({
        user_id: toUserId,
        from_id: fromId,
        type,
        subject,
        post_id: postId,
        read: false,
      });
      if (error) { logError("sendNotification", error); return; }
    } catch (e) { logError("sendNotification", e); }
  };

  const markNotifRead = async (notifId: string) => {
    try {
      const { error } = await supabase.from("notifications").update({ read: true }).eq("id", notifId);
      if (error) logError("markNotifRead", error);
      else setNotifications(prev => prev.map(n => n.id === notifId ? { ...n, read: true } : n));
    } catch (e) { logError("markNotifRead", e); }
  };

  // Load notifications + realtime subscription
  useEffect(() => {
    if (!user) return;
    loadNotifications();
    const channel = supabase.channel("notif-" + user.id)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` }, async (payload) => {
        const newNotif = payload.new as Notification;
        const { data: fromProfile } = await supabase.from("profiles").select("*").eq("id", newNotif.from_id).maybeSingle();
        setNotifications(prev => [{ ...newNotif, from_profile: fromProfile } as Notification, ...prev]);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.id]);

  // Click outside to close panel
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (notifPanelRef.current && !notifPanelRef.current.contains(e.target as Node)) setShowNotifPanel(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return {
    notifications, setNotifications,
    showNotifPanel, setShowNotifPanel,
    notifPanelRef,
    unreadCount,
    loadNotifications, sendNotification, markNotifRead,
  };
}
