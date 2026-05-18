/**
 * wellbeingSession.ts — durable session bookkeeping for Sherlock.
 *
 * Mirrors the basic shape of tutorSession.ts but without the
 * subject / topics / progress / weak-areas machinery. Sherlock
 * conversations are emotional, not academic — so we keep them
 * minimal: messages, a free-form topic tag, an optional summary
 * (filled in async by an analyzer later, or left null forever
 * with no consequence).
 *
 * Resume window: if the most recent Sherlock session was updated less
 * than 30 minutes ago, we append to it rather than creating a new
 * row. Same instinct as tutorSession — "this is one sitting, even
 * if there was a short pause."
 */
import { supabase } from "@/lib/supabase";

export interface WellbeingMessage {
  role: "user" | "assistant";
  content: string;
  ts: string;
}

export interface WellbeingSessionHandle {
  /** UUID of the active wellbeing_sessions row, or empty when DB write failed. */
  sessionId: string;
}

export interface WellbeingSessionRow {
  id: string;
  user_id: string;
  topic: string;
  messages: WellbeingMessage[];
  session_summary: string | null;
  created_at: string;
  updated_at: string;
}

const RESUME_WINDOW_MS = 30 * 60 * 1000;

/**
 * Pull the latest open Sherlock session for the user (if any, and recent
 * enough to count as "the same sitting"), or create a fresh one.
 * Best-effort — returns an empty handle on DB failure so callers can
 * keep streaming without persistence rather than failing the chat.
 */
export async function startOrResumeWellbeingSession(
  userId: string,
  initialTopic: string = "general",
): Promise<WellbeingSessionHandle> {
  if (!supabase || !userId) return { sessionId: "" };
  const topic = (initialTopic || "general").trim().slice(0, 80) || "general";

  try {
    const { data: last, error: selErr } = await supabase
      .from("wellbeing_sessions")
      .select("id, updated_at")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (selErr) throw selErr;

    if (last && Date.now() - Date.parse(last.updated_at) < RESUME_WINDOW_MS) {
      return { sessionId: last.id as string };
    }

    const { data: created, error: insErr } = await supabase
      .from("wellbeing_sessions")
      .insert({ user_id: userId, topic, messages: [] })
      .select("id")
      .single();
    if (insErr || !created) throw insErr ?? new Error("insert returned no row");
    return { sessionId: created.id as string };
  } catch {
    return { sessionId: "" };
  }
}

/**
 * Append a (user, assistant) message pair to a Sherlock session. Best-
 * effort — failure is silent so a transient DB blip doesn't blow up
 * the user-facing chat. The `messages` JSONB is read-modify-write
 * because PostgREST doesn't support jsonb_array_append in a single
 * UPDATE statement without a stored procedure. The race window is
 * tiny (sequential turns), and the worst case is a lost append
 * which the next turn's read recovers from.
 */
export async function appendWellbeingMessages(
  sessionId: string,
  newMessages: WellbeingMessage[],
): Promise<void> {
  if (!sessionId || !supabase || newMessages.length === 0) return;
  try {
    const { data: row, error: selErr } = await supabase
      .from("wellbeing_sessions")
      .select("messages")
      .eq("id", sessionId)
      .maybeSingle();
    if (selErr || !row) return;
    const existing = Array.isArray(row.messages) ? (row.messages as WellbeingMessage[]) : [];
    const next = [...existing, ...newMessages];
    await supabase
      .from("wellbeing_sessions")
      .update({ messages: next, updated_at: new Date().toISOString() })
      .eq("id", sessionId);
  } catch {
    // Persistence failure is silent — the user-facing chat keeps working.
  }
}

/**
 * Quick title inference for the History sidebar.
 * Returns the first 60 chars of the first user message, or the topic,
 * or a generic fallback. No AI call — pure string slicing.
 */
export function inferWellbeingTitle(row: { messages: unknown; topic?: string | null; session_summary?: string | null }): string {
  if (typeof row.session_summary === "string" && row.session_summary.trim()) {
    return row.session_summary.trim().slice(0, 80);
  }
  if (Array.isArray(row.messages)) {
    const firstUser = (row.messages as Array<{ role?: string; content?: string }>)
      .find((m) => m?.role === "user" && typeof m?.content === "string");
    if (firstUser?.content) {
      return firstUser.content.trim().replace(/\s+/g, " ").slice(0, 60) || "Wellbeing chat";
    }
  }
  return row.topic && row.topic !== "general" ? `Wellbeing — ${row.topic}` : "Wellbeing chat";
}
