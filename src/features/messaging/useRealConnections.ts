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
import { supabase, PROFILE_COLUMNS } from "@/lib/supabase";
import type { Profile } from "@/lib/supabase";
import { useSupabaseSession } from "@/features/auth/useSupabaseSession";

export interface ConnectionRow {
  partner_id: string;
  rating: number | null;
  partner: Profile;
  /** ISO timestamp of the most recent message exchanged with this
   *  partner (sent OR received). Null when the connection has zero
   *  messages yet. Used by ConnectScreen to sort threads so the
   *  most-recently-active conversation rises to the top. */
  last_message_at: string | null;
  /** Short preview of the most recent message body — used to replace
   *  the placeholder "(tap to open chat)" in the thread list. Empty
   *  string when no messages yet or when the message has no text
   *  body (e.g. voice/file-only). */
  last_message_preview: string;
  /** Whether the last message was sent BY the current user (so the
   *  UI can show "You: ..." prefix) or received from the partner. */
  last_message_from_me: boolean;
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
        .select(`partner_id, rating, partner:profiles!connections_partner_id_fkey(${PROFILE_COLUMNS})`)
        .eq("user_id", user.id);
      if (err) throw err;
      // Filter out rows where the partner profile didn't join
      // (happens when the partner was deleted but the connection
      // row hung around — defensive).
      const baseRows = (data ?? []).filter((r) => !!(r as { partner: unknown }).partner) as unknown as Array<{
        partner_id: string;
        rating: number | null;
        partner: Profile;
      }>;

      // ── Enrich with last-message timestamps ──
      // Pull the user's most recent ~500 messages and group client-
      // side by partner. Why client-side: PostgREST doesn't expose
      // "latest per group" cleanly without an RPC, and 500 rows is
      // tiny over the wire (~50KB). For users in the typical range
      // (1-50 connections, <2000 lifetime messages), this is faster
      // than N round-trips and simpler than a stored function.
      // If this query fails, we fall back to unsorted connections —
      // the thread list still works, just without recency order.
      const lastByPartner = new Map<string, { at: string; preview: string; fromMe: boolean }>();
      try {
        // The messages column is `text`, not `content` — the original
        // version of this hook selected `content` which silently
        // returned null for every row, so every DM preview rendered
        // as "(tap to start chatting)" even when the conversation had
        // hundreds of messages. Schema check: src/lib/supabase.ts:116.
        // Also pull message_type so voice/file/image messages can show
        // a sensible non-text preview ("🎤 Voice", "📎 File") instead
        // of an empty string.
        const { data: msgs } = await supabase
          .from("messages")
          .select("sender_id, receiver_id, text, message_type, created_at")
          .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
          .order("created_at", { ascending: false })
          .limit(500);
        for (const m of (msgs ?? []) as Array<{
          sender_id: string;
          receiver_id: string;
          text: string | null;
          message_type: "text" | "voice" | "image" | "file" | null;
          created_at: string;
        }>) {
          const partnerId = m.sender_id === user.id ? m.receiver_id : m.sender_id;
          if (!partnerId || lastByPartner.has(partnerId)) continue;
          let preview = (m.text || "").trim().replace(/\s+/g, " ").slice(0, 80);
          if (!preview) {
            // Empty text + a known media type → render a friendly
            // emoji label so the list doesn't look broken.
            if (m.message_type === "voice") preview = "🎤 Voice message";
            else if (m.message_type === "image") preview = "📷 Image";
            else if (m.message_type === "file") preview = "📎 File";
          }
          lastByPartner.set(partnerId, {
            at: m.created_at,
            preview,
            fromMe: m.sender_id === user.id,
          });
        }
      } catch {
        /* fall through with empty map — list still renders */
      }

      const rows: ConnectionRow[] = baseRows.map((r) => {
        const last = lastByPartner.get(r.partner_id);
        return {
          partner_id: r.partner_id,
          rating: r.rating,
          partner: r.partner,
          last_message_at: last?.at ?? null,
          last_message_preview: last?.preview ?? "",
          last_message_from_me: last?.fromMe ?? false,
        };
      });
      // Sort so the most-recently-active conversation is first.
      // Connections with no messages yet sink to the bottom — that
      // mirrors how iMessage / WhatsApp / Telegram all behave.
      rows.sort((a, b) => {
        if (a.last_message_at && b.last_message_at) {
          return Date.parse(b.last_message_at) - Date.parse(a.last_message_at);
        }
        if (a.last_message_at) return -1;
        if (b.last_message_at) return 1;
        return 0;
      });

      setConnections(rows);
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
  // the partner row stays fresh. We ALSO refetch on any new message
  // row so the thread list re-sorts immediately when a friend sends
  // a new message — without this the list stays stale until the
  // next manual refresh.
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
      // Re-sort the list when a new message arrives — RLS already
      // restricts the user to messages they sent or received, so this
      // fires only for messages relevant to this user.
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, refresh)
      .subscribe();
    return () => {
      if (channel) void supabase.removeChannel(channel);
    };
  }, [user, load]);

  return { connections, loading: loading || authLoading, error, authed: !!user };
}
