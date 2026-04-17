import { useState, useRef, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import type { Profile, Message } from "@/lib/supabase";
import { BADGES_DEF } from "@/lib/constants";
import { useApp } from "@/context/AppContext";
import { logError, trackEvent } from "@/services/analytics";
import { generateClientId } from "@/shared/useNetworkStatus";

export function useMessages(awardBadge: (badgeId: string) => Promise<void>) {
  const { user, profile, showNotif } = useApp();

  // ── Connections ──
  const [connections, setConnections] = useState<Profile[]>([]);
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [rateModal, setRateModal] = useState<Profile | null>(null);
  const [hoverStar, setHoverStar] = useState(0);

  // ── Chat ──
  const [activeChat, setActiveChat] = useState<Profile | null>(null);
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const [newMsg, setNewMsg] = useState("");

  // ── Unread message counts (per-partner) ──
  // key = partner id, value = count of messages received from them but not read
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const totalUnread = Object.values(unreadCounts).reduce((a, b) => a + b, 0);

  // Timestamp (ISO) of the most recent message THIS user received from each partner.
  // Used to sort the Connect inbox so the partner who's been waiting longest for a
  // reply bubbles to the top (oldest unreplied first, newest at the bottom).
  const [lastReceivedAt, setLastReceivedAt] = useState<Record<string, string>>({});

  // ── Schedule ──
  const [schedModal, setSchedModal] = useState<Profile | null>(null);
  const [schedForm, setSchedForm] = useState({ date: "", time: "", type: "online", note: "" });

  // ── Voice & File sharing ──
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chatFileRef = useRef<HTMLInputElement>(null);

  // ── Pending messages (optimistic UI dedup) ──
  const pendingMsgs = useRef<Map<string, string>>(new Map());

  // ── Scroll refs ──
  const chatEndRef = useRef<HTMLDivElement>(null);

  // ── Data loading ──
  const loadConnections = async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from("connections")
        .select("partner_id, rating, partner:profiles!connections_partner_id_fkey(*)")
        .eq("user_id", user.id);
      if (error) { logError("loadConnections", error); return; }
      if (data) {
        setConnections(data.map((c: any) => c.partner).filter(Boolean));
        const r: Record<string, number> = {};
        data.forEach((c: any) => { if (c.rating) r[c.partner_id] = c.rating; });
        setRatings(r);
      }
    } catch (e) { logError("loadConnections", e); }
  };

  // ── Load unread counts grouped by sender ──
  const loadUnreadCounts = async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from("messages")
        .select("sender_id")
        .eq("receiver_id", user.id)
        .eq("read", false)
        .limit(500);
      if (error) { logError("loadUnreadCounts", error); return; }
      const counts: Record<string, number> = {};
      (data || []).forEach((m: { sender_id: string }) => {
        counts[m.sender_id] = (counts[m.sender_id] || 0) + 1;
      });
      setUnreadCounts(counts);
    } catch (e) { logError("loadUnreadCounts", e); }
  };

  // ── Load the most recent message received from each partner (for inbox sorting) ──
  const loadLastReceivedTimestamps = async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from("messages")
        .select("sender_id, created_at")
        .eq("receiver_id", user.id)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) { logError("loadLastReceivedTimestamps", error); return; }
      const newest: Record<string, string> = {};
      (data || []).forEach((m: { sender_id: string; created_at: string }) => {
        // Because we ordered desc, the first time we see a sender is their newest message.
        if (!newest[m.sender_id]) newest[m.sender_id] = m.created_at;
      });
      setLastReceivedAt(newest);
    } catch (e) { logError("loadLastReceivedTimestamps", e); }
  };

  // ── Load which partners this user has exchanged messages with (for filtering Connect) ──
  const [partnersWithMessages, setPartnersWithMessages] = useState<Set<string>>(new Set());
  const loadPartnersWithMessages = async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from("messages")
        .select("sender_id, receiver_id")
        .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
        .limit(1000);
      if (error) { logError("loadPartnersWithMessages", error); return; }
      const ids = new Set<string>();
      (data || []).forEach((m: { sender_id: string; receiver_id: string }) => {
        const other = m.sender_id === user.id ? m.receiver_id : m.sender_id;
        ids.add(other);
      });
      setPartnersWithMessages(ids);
    } catch (e) { logError("loadPartnersWithMessages", e); }
  };

  // ── Mark all messages from a partner as read ──
  const markAsRead = async (partnerId: string) => {
    if (!user) return;
    // Optimistically zero the local count
    setUnreadCounts(prev => {
      if (!prev[partnerId]) return prev;
      const next = { ...prev };
      delete next[partnerId];
      return next;
    });
    try {
      await supabase
        .from("messages")
        .update({ read: true })
        .eq("receiver_id", user.id)
        .eq("sender_id", partnerId)
        .eq("read", false);
    } catch (e) { logError("markAsRead", e); }
  };

  const loadMessages = async (partnerId: string) => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .or(`and(sender_id.eq.${user.id},receiver_id.eq.${partnerId}),and(sender_id.eq.${partnerId},receiver_id.eq.${user.id})`)
        .order("created_at", { ascending: true })
        .limit(100);
      if (error) { logError("loadMessages", error); return; }
      if (data) {
        setMessages(prev => {
          const existing = prev[partnerId] || [];
          const pendingOptimistic = existing.filter(m => m.id.startsWith("temp-"));
          if (pendingOptimistic.length === 0) return { ...prev, [partnerId]: data };
          const stillPending = pendingOptimistic.filter(m => {
            const clientId = m.id.replace("temp-", "");
            return !data.some((d: any) => d.client_id === clientId);
          });
          return { ...prev, [partnerId]: [...data, ...stillPending] };
        });
      }
    } catch (e) { logError("loadMessages", e); }
  };

  // ── Send message ──
  const sendMessage = async (partnerId: string) => {
    if (!newMsg.trim() || !user) return;
    if (!navigator.onLine) { showNotif("You're offline — message not sent. Check your connection.", "err"); return; }
    const text = newMsg;
    const clientId = generateClientId();
    setNewMsg("");
    const tempId = `temp-${clientId}`;
    const optimistic: Message = { id: tempId, sender_id: user.id, receiver_id: partnerId, text, message_type: "text", file_url: null, file_name: null, created_at: new Date().toISOString() };
    pendingMsgs.current.set(clientId, tempId);
    setMessages(prev => ({ ...prev, [partnerId]: [...(prev[partnerId] || []), optimistic] }));
    try {
      const { data, error } = await supabase.from("messages").insert({
        sender_id: user.id,
        receiver_id: partnerId,
        text,
        message_type: "text",
        client_id: clientId,
      }).select().single();
      if (error || !data) {
        logError("sendMessage", error);
        trackEvent("msg_fail", { reason: error?.code || "unknown", network: !navigator.onLine });
        pendingMsgs.current.delete(clientId);
        setMessages(prev => ({ ...prev, [partnerId]: (prev[partnerId] || []).filter(m => m.id !== tempId) }));
        setNewMsg(text);
        const isNetworkErr = !navigator.onLine || (error?.message && /fetch|network|timeout|abort/i.test(error.message));
        showNotif(isNetworkErr ? "No connection — message not sent. Try again when online." : "Couldn't send message — please try again.", "err");
        return;
      }
      pendingMsgs.current.delete(clientId);
      setMessages(prev => ({ ...prev, [partnerId]: (prev[partnerId] || []).map(m => m.id === tempId ? data : m) }));
      // Remember the conversation exists so it shows in Connect inbox
      setPartnersWithMessages(prev => prev.has(partnerId) ? prev : new Set(prev).add(partnerId));
      trackEvent("msg_sent", { type: "text" });
      const earnedBadges: string[] = profile.badges ?? [];
      if (!earnedBadges.includes("ice_breaker")) await awardBadge("ice_breaker");
      // Fire email notification to the partner (rate-limited server-side to 1/10min).
      const partner = activeChat?.id === partnerId ? activeChat : connections.find(c => c.id === partnerId);
      if (partner?.email) {
        fetch("/api/notify/message", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            senderId: user.id,
            receiverId: partnerId,
            senderName: profile.name || "A student",
            receiverEmail: partner.email,
            receiverName: partner.name || "",
            messagePreview: text.slice(0, 280),
          }),
        }).catch(() => {});
      }
    } catch (err) {
      logError("sendMessage", err);
      trackEvent("msg_fail", { reason: "exception", network: !navigator.onLine });
      pendingMsgs.current.delete(clientId);
      setMessages(prev => ({ ...prev, [partnerId]: (prev[partnerId] || []).filter(m => m.id !== tempId) }));
      setNewMsg(text);
      const isNet = !navigator.onLine || (err instanceof TypeError && /fetch|network/i.test(err.message));
      showNotif(isNet ? "No connection — message not sent. Check your internet." : "Couldn't send message — please try again.", "err");
    }
  };

  // ── File / voice upload ──
  const uploadAndSendFile = async (fileOrBlob: File | Blob, fileName: string, msgType: "voice" | "image" | "file") => {
    if (!user || !activeChat) return;
    if (!navigator.onLine) { showNotif(`You're offline — ${msgType === "voice" ? "voice message" : "file"} not sent.`, "err"); return; }
    const partnerId = activeChat.id;
    const displayText = msgType === "voice" ? "🎤 Voice message" : msgType === "image" ? `📷 ${fileName}` : `📎 ${fileName}`;
    const tempId = `temp-upload-${Date.now()}`;
    const optimistic: Message = { id: tempId, sender_id: user.id, receiver_id: partnerId, text: `⏳ Sending ${msgType}...`, message_type: msgType, file_url: null, file_name: fileName, created_at: new Date().toISOString() };
    setMessages(prev => ({ ...prev, [partnerId]: [...(prev[partnerId] || []), optimistic] }));
    try {
      const ext = fileName.split(".").pop() || "bin";
      const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await supabase.storage.from("chat-files").upload(path, fileOrBlob, { contentType: fileOrBlob instanceof File ? fileOrBlob.type : (fileOrBlob.type || "audio/webm") });
      if (upErr) {
        logError("uploadChatFile", upErr);
        setMessages(prev => ({ ...prev, [partnerId]: (prev[partnerId] || []).filter(m => m.id !== tempId) }));
        showNotif(!navigator.onLine ? "No connection — upload failed." : "Upload failed — try again", "err");
        return;
      }
      const { data: urlData } = supabase.storage.from("chat-files").getPublicUrl(path);
      const { data, error } = await supabase.from("messages").insert({
        sender_id: user.id,
        receiver_id: partnerId,
        text: displayText,
        message_type: msgType,
        file_url: urlData.publicUrl,
        file_name: fileName,
      }).select().single();
      if (error || !data) {
        logError("sendFileMsg", error);
        setMessages(prev => ({ ...prev, [partnerId]: (prev[partnerId] || []).filter(m => m.id !== tempId) }));
        showNotif(!navigator.onLine ? "Connection lost — message not sent." : "Couldn't send — try again", "err");
        return;
      }
      setMessages(prev => ({ ...prev, [partnerId]: (prev[partnerId] || []).map(m => m.id === tempId ? data : m) }));
      setPartnersWithMessages(prev => prev.has(partnerId) ? prev : new Set(prev).add(partnerId));
      trackEvent(msgType === "voice" ? "voice_sent" : "msg_sent", { type: msgType });
      // Fire email notification for the file/voice message too
      if (activeChat?.email) {
        fetch("/api/notify/message", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            senderId: user.id,
            receiverId: partnerId,
            senderName: profile.name || "A student",
            receiverEmail: activeChat.email,
            receiverName: activeChat.name || "",
            messagePreview: displayText,
          }),
        }).catch(() => {});
      }
    } catch (err) {
      logError("uploadAndSendFile", err);
      trackEvent(msgType === "voice" ? "voice_fail" : "msg_fail", { type: msgType, network: !navigator.onLine });
      setMessages(prev => ({ ...prev, [partnerId]: (prev[partnerId] || []).filter(m => m.id !== tempId) }));
      showNotif(!navigator.onLine ? "No connection — upload failed. Check your internet." : "Upload failed — try again", "err");
    }
  };

  // ── Voice recording ──
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg", ""].find(m => !m || MediaRecorder.isTypeSupported(m)) || "";
      const options = mimeType ? { mimeType } : undefined;
      const mediaRecorder = new MediaRecorder(stream, options);
      const actualMime = mediaRecorder.mimeType || "audio/webm";
      audioChunksRef.current = [];
      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        if (recordTimerRef.current) { clearInterval(recordTimerRef.current); recordTimerRef.current = null; }
        try {
          const blob = new Blob(audioChunksRef.current, { type: actualMime });
          if (blob.size < 500) { showNotif("Recording too short", "err"); setIsRecording(false); setRecordingTime(0); return; }
          const ext = actualMime.includes("mp4") ? "m4a" : actualMime.includes("ogg") ? "ogg" : "webm";
          await uploadAndSendFile(blob, `voice-${Date.now()}.${ext}`, "voice");
        } catch (err) {
          logError("recording:onstop", err);
          showNotif("Failed to send voice message", "err");
        }
        setIsRecording(false);
        setRecordingTime(0);
      };
      mediaRecorder.onerror = () => {
        stream.getTracks().forEach(t => t.stop());
        if (recordTimerRef.current) { clearInterval(recordTimerRef.current); recordTimerRef.current = null; }
        setIsRecording(false);
        setRecordingTime(0);
        showNotif("Recording error — try again", "err");
      };
      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);
      recordTimerRef.current = setInterval(() => setRecordingTime(prev => prev + 1), 1000);
    } catch (err) {
      logError("startRecording", err);
      showNotif("Microphone access denied. Check browser permissions.", "err");
    }
  };

  // Cleanup recording timer and media on unmount
  useEffect(() => {
    return () => {
      if (recordTimerRef.current) { clearInterval(recordTimerRef.current); recordTimerRef.current = null; }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
        try { mediaRecorderRef.current.stop(); } catch {}
        mediaRecorderRef.current = null;
      }
    };
  }, []);

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }
  };

  const handleChatFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { showNotif("File too large — max 10MB", "err"); return; }
    const isImage = file.type.startsWith("image/");
    const msgType = isImage ? "image" : "file";
    await uploadAndSendFile(file, file.name, msgType);
    if (chatFileRef.current) chatFileRef.current.value = "";
  };

  // ── Rating ──
  const submitRating = async (partnerId: string, stars: number) => {
    if (!user) return;
    try {
      const { error } = await supabase.from("connections")
        .update({ rating: stars })
        .eq("user_id", user.id)
        .eq("partner_id", partnerId);
      if (error) { showNotif("Rating failed — try again", "err"); return; }
      setRatings(prev => ({ ...prev, [partnerId]: stars }));
      setRateModal(null);
      if (stars === 5) {
        try {
          const { data: partnerProfile } = await supabase.from("profiles").select("badges,xp").eq("id", partnerId).maybeSingle();
          if (partnerProfile && !(partnerProfile.badges || []).includes("top_rated")) {
            const b = BADGES_DEF.find(b => b.id === "top_rated");
            if (b) {
              const newBadges = [...(partnerProfile.badges || []), "top_rated"];
              await supabase.from("profiles").update({ badges: newBadges, xp: (partnerProfile.xp || 0) + b.xp }).eq("id", partnerId);
            }
          }
        } catch {}
      }
      showNotif("Thanks for rating! ⭐");
    } catch { showNotif("Rating failed", "err"); }
  };

  return {
    // Connections
    connections, setConnections,
    ratings, setRatings,
    rateModal, setRateModal,
    hoverStar, setHoverStar,
    // Chat
    activeChat, setActiveChat,
    messages, setMessages,
    newMsg, setNewMsg,
    chatEndRef,
    // Schedule
    schedModal, setSchedModal,
    schedForm, setSchedForm,
    // Voice & file
    isRecording, recordingTime,
    chatFileRef,
    // Pending msgs
    pendingMsgs,
    // Unread
    unreadCounts, setUnreadCounts, totalUnread,
    lastReceivedAt, setLastReceivedAt,
    partnersWithMessages, setPartnersWithMessages,
    loadUnreadCounts, loadLastReceivedTimestamps, loadPartnersWithMessages, markAsRead,
    // Handlers
    loadConnections, loadMessages,
    sendMessage, startRecording, stopRecording,
    handleChatFileSelect, submitRating,
  };
}
