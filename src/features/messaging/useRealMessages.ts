/**
 * useRealMessages — per-thread message reads, send, and realtime.
 *
 * Ported from the production hook, stripped to the 90% path:
 *   - loadMessages(partnerId): fetch the two-way DM between me and
 *     partnerId, newest-last. Sets `messages[partnerId]`.
 *   - sendText(partnerId, body): optimistic INSERT with client_id
 *     dedup — the row comes back via realtime INSERT event and we
 *     swap in the real row by matching client_id.
 *   - Realtime: a single channel subscribes to
 *     `postgres_changes` on the messages table filtered by
 *     `receiver_id=eq.<me>`. Any inbound message triggers a merge
 *     into the right thread.
 *
 * Skipped vs prod (deliberately — port next):
 *   - Voice recording + upload (MediaRecorder + Storage)
 *   - Image / file attach
 *   - Unread counts persisted to DB
 *   - Rate + rating / scheduling modals
 *
 * RLS on `messages`: sender_id = auth.uid() OR receiver_id = auth.uid()
 * for SELECT; INSERT requires sender_id = auth.uid().
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import type { Message } from "@/lib/supabase";
import { useSupabaseSession } from "@/features/auth/useSupabaseSession";
import { uploadVoice } from "./uploadVoice";

function generateClientId(): string {
  // Short, URL-safe, collision-resistant enough for dedup within a
  // single user's session. Production uses the same pattern.
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Fire-and-forget email notification trigger. Hits the existing
 * /api/notify/message edge function which:
 *   - validates the bearer token, derives sender from JWT
 *   - looks up receiver email server-side (via service role, bypasses
 *     the column-level revoke we put on profiles.email)
 *   - rate-limits per (sender, receiver) pair to once per 10 minutes
 *   - skips silently if RESEND_API_KEY isn't configured
 *
 * We call it for EVERY DM send. The 10-min rate limiter handles
 * back-to-back chatter; the receiver gets one email per burst, not
 * one per message. Failures are swallowed — chat must never break
 * because email is misconfigured.
 *
 * We don't gate on receiver presence here. The endpoint is cheap, the
 * rate limit is server-side, and "they're online" detection is
 * unreliable from the sender's tab anyway (Supabase realtime presence
 * tracking would tell us, but we don't have it wired up). The
 * receiver already gets the message via realtime — the email is a
 * bonus for the offline case.
 */
async function fireNotifyEmail(
  accessToken: string,
  receiverId: string,
  preview: string,
): Promise<void> {
  try {
    await fetch("/api/notify/message", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        receiverId,
        messagePreview: preview.slice(0, 280),
      }),
    });
  } catch {
    // Email is best-effort. Never fail the chat send because of it.
  }
}

export interface UseRealMessagesState {
  messages: Record<string, Message[]>;   // keyed by partner_id
  loading: Set<string>;                  // partner_ids currently loading
  send: (partnerId: string, body: string) => Promise<void>;
  /** Upload + send a voice note. `durationMs` is stored in the
   *  `text` column (legacy production convention) so existing
   *  rows render correctly without a schema change. */
  sendVoice: (partnerId: string, blob: Blob, durationMs: number) => Promise<void>;
  load: (partnerId: string) => Promise<void>;
}

export function useRealMessages(): UseRealMessagesState {
  const { user } = useSupabaseSession();
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const [loading, setLoading] = useState<Set<string>>(new Set());
  // Tracks client_ids we've sent optimistically so the realtime echo
  // replaces the placeholder instead of appending a duplicate.
  const pendingRef = useRef<Map<string, string>>(new Map());

  /** Fetch the DM history with a specific partner. */
  const load = useCallback(async (partnerId: string) => {
    if (!user || !supabase) return;
    setLoading((s) => new Set(s).add(partnerId));
    try {
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .or(`and(sender_id.eq.${user.id},receiver_id.eq.${partnerId}),and(sender_id.eq.${partnerId},receiver_id.eq.${user.id})`)
        .order("created_at", { ascending: true })
        .limit(200);
      if (error) throw error;
      setMessages((m) => ({ ...m, [partnerId]: (data ?? []) as Message[] }));
    } catch {
      // Leave previous messages in place on error — better than
      // wiping the UI when the network flaps.
    } finally {
      setLoading((s) => { const n = new Set(s); n.delete(partnerId); return n; });
    }
  }, [user]);

  /** Send a text message. Optimistic append + real INSERT; realtime
   *  then reconciles via client_id. */
  const send = useCallback(async (partnerId: string, body: string) => {
    const trimmed = body.trim();
    if (!user || !supabase || !trimmed) return;
    const client_id = generateClientId();
    pendingRef.current.set(client_id, partnerId);

    // Optimistic message — shown immediately, replaced by the real
    // row when the realtime INSERT echoes back.
    const optimistic: Message = {
      id: client_id,
      sender_id: user.id,
      receiver_id: partnerId,
      text: trimmed,
      message_type: "text",
      file_url: null,
      file_name: null,
      client_id,
      created_at: new Date().toISOString(),
    };
    setMessages((m) => ({ ...m, [partnerId]: [...(m[partnerId] ?? []), optimistic] }));

    try {
      const { error } = await supabase.from("messages").insert({
        sender_id: user.id,
        receiver_id: partnerId,
        text: trimmed,
        message_type: "text",
        client_id,
      });
      if (error) throw error;
      // Fire email notification — best-effort, never awaited.
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        void fireNotifyEmail(session.access_token, partnerId, trimmed);
      }
    } catch {
      // Roll back the optimistic row + surface a failure marker.
      // Production re-queues + retries; the preview just removes.
      setMessages((m) => ({
        ...m,
        [partnerId]: (m[partnerId] ?? []).filter((msg) => msg.client_id !== client_id),
      }));
      pendingRef.current.delete(client_id);
    }
  }, [user]);

  /** Send a voice note. Uploads the blob to chat-files first, then
   *  inserts a messages row referencing the public URL. Same
   *  optimistic + realtime-reconcile pattern as text. */
  const sendVoice = useCallback(async (partnerId: string, blob: Blob, durationMs: number) => {
    if (!user || !supabase || !blob || blob.size === 0) return;
    const client_id = generateClientId();
    pendingRef.current.set(client_id, partnerId);

    // Optimistic — show a "uploading…" voice bubble. The text field
    // carries the duration in ms (production convention) so the
    // VoiceBubble UI can show the clock without a separate column.
    const optimistic: Message = {
      id: client_id,
      sender_id: user.id,
      receiver_id: partnerId,
      text: String(durationMs),
      message_type: "voice",
      file_url: null,
      file_name: null,
      client_id,
      created_at: new Date().toISOString(),
    };
    setMessages((m) => ({ ...m, [partnerId]: [...(m[partnerId] ?? []), optimistic] }));

    try {
      // Step 1: upload to Storage. Throws on size/MIME/permission.
      const uploaded = await uploadVoice(blob, user.id);

      // Step 2: INSERT the messages row with the public URL.
      const { error } = await supabase.from("messages").insert({
        sender_id: user.id,
        receiver_id: partnerId,
        text: String(durationMs),
        message_type: "voice",
        file_url: uploaded.publicUrl,
        file_name: uploaded.fileName,
        client_id,
      });
      if (error) throw error;
      // Fire email notification — best-effort, never awaited.
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        const seconds = Math.round(durationMs / 1000);
        const preview = `🎤 Voice note · ${seconds}s`;
        void fireNotifyEmail(session.access_token, partnerId, preview);
      }
    } catch (e) {
      // Roll back the optimistic row.
      setMessages((m) => ({
        ...m,
        [partnerId]: (m[partnerId] ?? []).filter((msg) => msg.client_id !== client_id),
      }));
      pendingRef.current.delete(client_id);
      // Re-throw so the caller's UI can show "failed to send".
      throw e instanceof Error ? e : new Error("Voice send failed.");
    }
  }, [user]);

  // ── Realtime subscription ──────────────────────────────────
  // One channel per hook instance. The channel name MUST be
  // unique per mount — Supabase's realtime client caches channel
  // instances by name, and calling `.channel("foo")` twice with the
  // same name returns the SAME (already-subscribed) instance. Adding
  // postgres_changes callbacks to an already-subscribed channel
  // throws: "cannot add postgres_changes callbacks ... after
  // subscribe()". This was the messages-click crash.
  //
  // We append a per-mount UUID to the name so cleanup +
  // re-subscribe across ChatView remounts works cleanly.
  useEffect(() => {
    if (!user || !supabase) return;
    let channel: RealtimeChannel | null = null;
    const channelName = `msg-inbox-${user.id}-${
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
          table: "messages",
          filter: `receiver_id=eq.${user.id}`,
        },
        (payload) => {
          const row = payload.new as Message;
          const partnerId = row.sender_id;
          setMessages((m) => {
            const thread = m[partnerId] ?? [];
            // Dedup by id OR client_id (our own optimistic echo).
            if (thread.some((x) => x.id === row.id || (row.client_id && x.client_id === row.client_id))) {
              return m;
            }
            return { ...m, [partnerId]: [...thread, row] };
          });
        },
      )
      .on(
        // Also listen for our own outbound rows so the optimistic
        // placeholder gets swapped for the real server row (with the
        // authoritative created_at + id).
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `sender_id=eq.${user.id}`,
        },
        (payload) => {
          const row = payload.new as Message;
          const partnerId = row.receiver_id;
          setMessages((m) => {
            const thread = m[partnerId] ?? [];
            const idx = row.client_id
              ? thread.findIndex((x) => x.client_id === row.client_id)
              : -1;
            if (idx === -1) {
              // Came in without matching our optimistic insert (e.g.
              // the user has two tabs open). Append if not present.
              if (thread.some((x) => x.id === row.id)) return m;
              return { ...m, [partnerId]: [...thread, row] };
            }
            const next = thread.slice();
            next[idx] = row;
            return { ...m, [partnerId]: next };
          });
          if (row.client_id) pendingRef.current.delete(row.client_id);
        },
      )
      .subscribe();

    return () => {
      if (channel) {
        void supabase.removeChannel(channel);
      }
    };
  }, [user]);

  return { messages, loading, send, sendVoice, load };
}
