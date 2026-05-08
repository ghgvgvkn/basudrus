/**
 * useSavedMessages — bookmark / unbookmark AI replies, with the set
 * of currently-saved message IDs cached in memory so the UI can
 * render the bookmark icon's filled vs empty state without a
 * round-trip per message.
 *
 * Persistence lives in the `tutor_saved_messages` Supabase table,
 * own-only RLS. We load the user's saved IDs once on mount and
 * track inserts/deletes locally as the user toggles. If a network
 * write fails we don't roll back the optimistic UI immediately —
 * we retry once after 500 ms; if that also fails the icon stays
 * "saved" and we log a dev warning. Failure is silent at the user
 * level by design (saves are not critical-path).
 *
 * Public surface:
 *   - savedIds: Set<string> of message IDs the user has saved
 *   - isSaved(messageId): boolean
 *   - toggle(message): persist or remove
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useSupabaseSession } from "@/features/auth/useSupabaseSession";
import type { AIMessage } from "@/shared/types";

interface UseSavedMessagesState {
  savedIds: Set<string>;
  isSaved: (messageId: string) => boolean;
  /** Toggle on/off. Idempotent; a double-tap saves then unsaves. */
  toggle: (msg: AIMessage, opts?: { sessionId?: string | null }) => Promise<void>;
  loading: boolean;
}

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T | null> {
  try {
    return await fn();
  } catch (e1) {
    if (import.meta.env.DEV) console.warn(`[useSavedMessages] ${label} attempt 1:`, e1);
    await new Promise((r) => setTimeout(r, 500));
    try {
      return await fn();
    } catch (e2) {
      if (import.meta.env.DEV) console.warn(`[useSavedMessages] ${label} attempt 2 (giving up):`, e2);
      return null;
    }
  }
}

export function useSavedMessages(): UseSavedMessagesState {
  const { user } = useSupabaseSession();
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  // Initial load — pull every saved message_id for the user. We
  // don't paginate; even a heavy user is unlikely to have >1k saves
  // and the payload is just IDs.
  useEffect(() => {
    if (!user || !supabase) {
      setSavedIds(new Set());
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const rows = await withRetry(async () => {
        const { data, error } = await supabase
          .from("tutor_saved_messages")
          .select("message_id")
          .eq("user_id", user.id);
        if (error) throw error;
        return (data ?? []) as Array<{ message_id: string }>;
      }, "loadSaved");
      if (cancelled) return;
      setSavedIds(new Set((rows ?? []).map((r) => r.message_id)));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user]);

  const isSaved = useCallback((messageId: string) => savedIds.has(messageId), [savedIds]);

  const toggle = useCallback(async (msg: AIMessage, opts?: { sessionId?: string | null }) => {
    if (!user || !supabase) return;
    const messageId = msg.id;
    const wasSaved = savedIds.has(messageId);

    // Optimistic update — flip the icon immediately, then reconcile
    // against the network response. Failure leaves the optimistic
    // state in place; the next mount reloads from DB to converge.
    setSavedIds((prev) => {
      const next = new Set(prev);
      if (wasSaved) next.delete(messageId); else next.add(messageId);
      return next;
    });

    if (wasSaved) {
      void withRetry(async () => {
        const { error } = await supabase
          .from("tutor_saved_messages")
          .delete()
          .eq("user_id", user.id)
          .eq("message_id", messageId);
        if (error) throw error;
        return true;
      }, "removeSaved");
    } else {
      void withRetry(async () => {
        const { error } = await supabase
          .from("tutor_saved_messages")
          .insert({
            user_id: user.id,
            session_id: opts?.sessionId ?? null,
            message_id: messageId,
            subject: msg.subject ?? null,
            persona: msg.persona,
            // Cap at 16 KB to match the table CHECK constraint —
            // matches the Anthropic max_tokens budget anyway.
            body: (msg.body ?? "").slice(0, 16000),
          });
        if (error) throw error;
        return true;
      }, "addSaved");
    }
  }, [user, savedIds]);

  return { savedIds, isSaved, toggle, loading };
}
