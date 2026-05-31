/**
 * chatSessionStore — mobile-side persistence for AI chats.
 *
 * The AI tab streams replies from `/api/ai/tutor` but, until now, threw
 * the whole conversation away the moment the user closed the tab — so
 * the History drawer was always empty and the "remember where I was"
 * promise didn't hold. (User report: "the history of the chat is not
 * being saved.")
 *
 * The web has two separate helpers — `tutorSession.ts` (Tony) with full
 * spaced-repetition + progress tracking, and `wellbeingSession.ts`
 * (Sherlock) which is the slimmer cousin. Mobile doesn't need any of
 * the spaced-rep machinery (Tony's tutor_progress writes live on the
 * server already, kicked off by `/api/ai/analyze-session`). All mobile
 * has to do is:
 *
 *   1. Open or resume a session row before the first user message goes
 *      out so the History drawer sees the chat as it's happening.
 *   2. Append (user, assistant) pairs as each turn completes so the
 *      messages JSONB stays in sync with what the user can see on
 *      screen. RLS is own-only so a stale tab can't corrupt anyone
 *      else's session.
 *   3. Bump `updated_at` on every append so the drawer's date buckets
 *      ("Today / Yesterday / Last 7 / Earlier") stay accurate.
 *
 * Both tutor_sessions and wellbeing_sessions are RLS-gated on
 * `user_id = auth.uid()`. We pass userId explicitly anyway — defensive,
 * and it lets the helper short-circuit when the user hasn't signed in
 * yet (the user actually asked in chat whether sign-in might be why
 * history wasn't saving — the answer is "yes, and we now make that
 * explicit").
 *
 * Persona naming follows the server:
 *   - 'tony'      → tutor_sessions     (server-side persona = 'omar')
 *   - 'sherlock'  → wellbeing_sessions (server-side persona = 'noor')
 *
 * Resume window is 30 minutes for both — same heuristic the web uses,
 * matches the "one sitting even if there was a short pause" instinct.
 * If the last session on this persona is fresher than that, we append
 * to it instead of creating a new row so the drawer doesn't fragment
 * a single conversation into a stack of one-message stubs.
 *
 * Every call here is best-effort. Persistence must NEVER block the
 * streamed reply or surface as an error to the user — a transient DB
 * blip should just mean "your history might be one turn out of date,"
 * not "your AI is broken." All failures are swallowed (warn in dev so
 * we still notice during development, silent in production).
 */
import { supabase } from './supabase';

export type ChatPersona = 'tony' | 'sherlock';

export interface ChatMessageRow {
  role: 'user' | 'assistant';
  content: string;
  ts: string; // ISO timestamp
}

const RESUME_WINDOW_MS = 30 * 60 * 1000;

/** True when running a dev build — `__DEV__` is RN's global. */
declare const __DEV__: boolean;

function devWarn(label: string, err: unknown) {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    // eslint-disable-next-line no-console
    console.warn(`[chatSessionStore] ${label}:`, err);
  }
}

/** Which Supabase table this persona persists to. */
function tableFor(persona: ChatPersona): 'tutor_sessions' | 'wellbeing_sessions' {
  return persona === 'tony' ? 'tutor_sessions' : 'wellbeing_sessions';
}

/**
 * Start or resume a session row before the first user message of a
 * fresh chat. Returns the session UUID — caller stashes it in component
 * state so the same row gets appended on subsequent turns.
 *
 * Caller passes:
 *   - userId    : Supabase auth user id (chat won't be saved without one)
 *   - persona   : 'tony' or 'sherlock'
 *   - subject?  : tutor only; the website uses 'general' as the default
 *                 when no subject picker is shown, and the mobile AI tab
 *                 has no subject picker, so we default to 'general' too
 *
 * Returns '' on any failure or when there's no signed-in user — caller
 * should treat that as "persistence off, but keep streaming the reply."
 */
export async function startOrResumeChatSession(
  userId: string | null | undefined,
  persona: ChatPersona,
  subject: string = 'general',
): Promise<string> {
  if (!userId) return '';

  const table = tableFor(persona);
  const safeSubject = (subject || 'general').trim().slice(0, 120) || 'general';

  try {
    // 1. See if a recent row already exists. RLS limits us to our own
    //    rows; the eq('user_id', userId) is defensive belt-and-braces.
    const { data: last, error: readErr } = await supabase
      .from(table)
      .select('id, updated_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (readErr) throw readErr;

    if (last && last.updated_at) {
      const age = Date.now() - Date.parse(last.updated_at as string);
      if (Number.isFinite(age) && age < RESUME_WINDOW_MS) {
        // Resume the recent one — one sitting, one row.
        return (last.id as string) ?? '';
      }
    }

    // 2. No recent row — create a fresh one. Schema differs slightly
    //    between the two tables: tutor_sessions needs `subject` (NOT
    //    NULL), wellbeing_sessions needs `topic`. The Supabase typed
    //    client narrows on the literal table name, so we branch the
    //    insert here rather than building a union seed object (TS
    //    would otherwise reject the union against either narrowed
    //    shape).
    //
    // CRITICAL: tutor_sessions has additional NOT-NULL columns the
    // mobile app was previously skipping — `mode` and `session_number`
    // (the web's src/features/ai/tutorSession.ts inserts both). Without
    // them, the insert was failing silently (RLS allowed it; the NOT
    // NULL constraint did not), and the History drawer was empty for
    // every Tony chat the user started. The user reported this as
    // "history is not being saved" — the actual fix is here.
    if (persona === 'tony') {
      // Compute a sensible session_number by counting existing rows for
      // this (user, subject). Best-effort: a count error falls back to 1
      // so a transient DB blip doesn't block session creation.
      let sessionNumber = 1;
      try {
        const { count } = await supabase
          .from('tutor_sessions')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('subject', safeSubject);
        sessionNumber = (count ?? 0) + 1;
      } catch {
        // keep default 1
      }
      const { data: created, error: insErr } = await supabase
        .from('tutor_sessions')
        .insert({
          user_id: userId,
          subject: safeSubject,
          messages: [],
          // 'auto' matches what the mobile send() sets when no explicit
          // mode picker is shown. The server understands 'auto' as
          // "let me pick the teaching strategy per turn" in
          // buildModeBlock(safeMode) in api/ai/tutor.ts.
          mode: 'auto',
          session_number: sessionNumber,
        })
        .select('id')
        .single();
      if (insErr || !created) throw insErr ?? new Error('insert returned no row');
      return (created.id as string) ?? '';
    }
    const { data: created, error: insErr } = await supabase
      .from('wellbeing_sessions')
      .insert({ user_id: userId, topic: safeSubject, messages: [] })
      .select('id')
      .single();
    if (insErr || !created) throw insErr ?? new Error('insert returned no row');
    return (created.id as string) ?? '';
  } catch (e) {
    devWarn(`startOrResumeChatSession(${persona})`, e);
    return '';
  }
}

/**
 * Append a batch of messages to an existing session row. PostgREST
 * doesn't expose jsonb_array_append in a single UPDATE without a stored
 * procedure, so we do a read-modify-write — fine here because turns are
 * sequential per-user (no two clients writing to the same session at
 * once) and a lost append is recovered by the next turn's read.
 *
 * Updates `updated_at` so the History drawer's date buckets see the
 * activity. Caller fires this after the assistant's reply lands so the
 * server has the canonical (user, assistant) pair, never just one half.
 *
 * Returns true on success — failure is swallowed (silent in prod, warn
 * in dev) so the streaming reply UI is never blocked by storage.
 */
export async function appendChatMessages(
  sessionId: string,
  persona: ChatPersona,
  newMessages: ChatMessageRow[],
): Promise<boolean> {
  if (!sessionId || newMessages.length === 0) return false;

  const table = tableFor(persona);

  try {
    // Read the current array first so we can append without losing the
    // earlier turns of the same session.
    const { data: row, error: readErr } = await supabase
      .from(table)
      .select('messages')
      .eq('id', sessionId)
      .maybeSingle();
    if (readErr) throw readErr;
    const existing: ChatMessageRow[] = Array.isArray(row?.messages)
      ? (row.messages as ChatMessageRow[])
      : [];

    // Cap at 200 to keep the row size sensible (web cap matches). Older
    // turns aren't lost forever — they're embedded into student_memory
    // by /api/ai/extract-memory on the server side after a session
    // closes.
    const next = [...existing, ...newMessages].slice(-200);

    const { error: updErr } = await supabase
      .from(table)
      .update({ messages: next, updated_at: new Date().toISOString() })
      .eq('id', sessionId);
    if (updErr) throw updErr;
    return true;
  } catch (e) {
    devWarn(`appendChatMessages(${persona})`, e);
    return false;
  }
}
