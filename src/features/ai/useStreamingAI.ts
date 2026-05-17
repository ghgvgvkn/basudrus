/**
 * useStreamingAI — call /api/ai/tutor or /api/ai/wellbeing with SSE.
 *
 * Slim port of production sendTutorMessage / sendWellbeingMessage.
 * Same JSON request shape, same SSE-style chunk parsing
 * (`data: {"content": "..."}` lines).
 *
 * We attach the bearer token from the cached session so the API
 * endpoint can identify the user (it consults `auth.users` to
 * enforce per-user rate limits + log to `ai_usage`).
 *
 * The 90-second hang guard mirrors prod — without it, a stalled
 * stream locks the user out of sending the next message.
 *
 * UPGRADE (Bas Udros):
 *   - Loads durable per-subject session memory from tutor_sessions /
 *     tutor_progress before the first send, so the system prompt
 *     references previous work, weak/strong areas, and overdue topics.
 *   - Persists every (user, assistant) message pair to tutor_sessions
 *     in real time — never batched.
 *   - Triggers post-session analysis when the active subject changes
 *     or when the consumer calls endActiveSession() (e.g. on unmount).
 *   - All persistence is best-effort: a Supabase outage NEVER blocks
 *     the streaming response or surfaces an error to the student.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { getSessionCached } from "@/lib/supabase";
import { useApp } from "@/context/AppContext";
import type { AIPersona } from "@/shared/types";
import { useViewerPersonality } from "@/features/match/useViewerPersonality";
import {
  startOrResumeSession,
  appendMessages,
  analyzeAndCloseSession,
  extractMemoryFromSession,
  type SessionHandle,
  type TutorMode,
  type TutorMessage,
} from "./tutorSession";
import {
  startOrResumeWellbeingSession,
  appendWellbeingMessages,
  type WellbeingSessionHandle,
  type WellbeingMessage,
} from "./wellbeingSession";

export interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

export type StreamErrorReason = "daily_limit" | "hourly_limit" | "cooldown" | "rate" | "network" | "auth" | "aborted";

export interface StreamingAIState {
  send: (
    persona: AIPersona,
    body: string,
    history: ChatMsg[],
    context?: {
      subject?: string;
      major?: string;
      year?: string | number;
      uni?: string;
      lang?: "en" | "ar" | "auto";
      /** Optional: 'study_mode' for proactive teaching, default
       *  'homework_help' (full Socratic). UI doesn't expose this yet
       *  — the field is wired in advance for a future toggle. */
      mode?: TutorMode;
      /** Optional: image attached to THIS turn (e.g. a homework photo).
       *  Compressed client-side via compressImage() — caller passes
       *  the base64 string + media type. The API replaces the last
       *  user message's content with a multimodal block so the AI
       *  can actually see the image. */
      imageBase64?: string;
      imageMediaType?: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
      /** Optional: PDF attached to THIS turn, base64-encoded. Sent
       *  directly to Anthropic as a `document` content block — Claude
       *  reads the PDF natively (text + figures + scans via OCR), no
       *  client-side extraction needed. Replaces the previous pdfjs
       *  text-extraction path which had compatibility issues on iOS
       *  Safari with module workers. */
      pdfBase64?: string;
      /** Original filename for display ("midterm-2024.pdf"). */
      pdfName?: string;
      /** Optional: extracted plain-text document content (.txt, .doc,
       *  etc — non-PDF formats). Injected into the system prompt as
       *  a fenced block. Empty when the upload was a PDF (use
       *  pdfBase64 instead). */
      documentContext?: string;
      /** Optional: human-readable label for the document above
       *  ("Lecture notes.txt"). Surfaced in the prompt so the AI
       *  can reference the source naturally. */
      documentLabel?: string;
      /** Day 18 — when a focus study session is active, this carries
       *  the live session context (subject, goal, elapsed/remaining
       *  minutes, current Pomodoro block). The tutor endpoint reads
       *  it and switches Omar into "focus mode" — more structured,
       *  gentle redirect on off-topic, ready to wrap up near end.
       *  Undefined when no session is running or persona is Noor. */
      studySession?: {
        subject: string;
        goal: string;
        elapsedMin: number;
        remainingMin: number;
        currentBlock: "focus" | "break";
      };
    },
  ) => Promise<{ ok: true; assistant: string } | { ok: false; reason: StreamErrorReason; message?: string }>;
  loading: boolean;
  partial: string;
  abort: () => void;
  /** End the current Bas Udros tutor session (subject change, screen
   *  unmount, manual "end session" action). Triggers post-session
   *  analysis in the background. Safe to call when no session is
   *  active — the call is a no-op. */
  endActiveSession: () => void;
}

export function useStreamingAI(): StreamingAIState {
  const { profile } = useApp();
  // Pre-loaded personality summary — keeps the system prompt
  // adapted to the viewer's study style. Null when the user hasn't
  // taken the quiz yet, in which case the API skips the personality
  // block and uses the generic prompt.
  const { summary: personalitySummary } = useViewerPersonality();
  const [loading, setLoading] = useState(false);
  const [partial, setPartial] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  // Active Bas Udros tutor session — recreated when subject changes.
  // Stored in a ref (not state) because the value is read inside
  // send()'s closure and we don't want a stale-state issue across
  // rapid sends. The cached access token is reused so each send
  // doesn't pay an extra round-trip to /auth/v1/user.
  const sessionRef = useRef<SessionHandle | null>(null);
  // Wellbeing session handle — kept in a parallel ref so persona
  // switching doesn't wipe each other's session state. Tutor and
  // wellbeing each persist to their own table; this ref holds the
  // active Noor session id during a Noor conversation.
  const wellbeingSessionRef = useRef<WellbeingSessionHandle | null>(null);
  const accessTokenRef = useRef<string | null>(null);

  // Abort any in-flight stream on unmount. Without this, navigating
  // away mid-stream (e.g. user taps another tab, route changes, or
  // they close the AI screen while the answer is still streaming)
  // leaves the fetch + 90-second hang guard running and produces a
  // "setState on unmounted component" warning. Combined with the
  // server-side cancel handler (api/ai/*.ts → ReadableStream.cancel),
  // this stops Anthropic from continuing to bill tokens for a stream
  // the user can no longer see.
  useEffect(() => {
    return () => {
      if (abortRef.current) {
        try { abortRef.current.abort(); } catch { /* already aborted */ }
        abortRef.current = null;
      }
    };
  }, []);

  /** Trigger post-session analysis on the currently active session,
   *  then clear the ref so the next send opens a fresh session. */
  const endActiveSession = useCallback(() => {
    const handle = sessionRef.current;
    const token = accessTokenRef.current;
    sessionRef.current = null;
    if (handle?.sessionId && token) {
      // Fire-and-forget — analyzer is idempotent and never throws.
      void analyzeAndCloseSession(handle.sessionId, token);
      // Extract durable facts into student_memory (semantic memory).
      // Independent of analyze; both safe to run in parallel.
      void extractMemoryFromSession(handle.sessionId, "omar", token);
    }
    // Also extract memory from any active Noor session — wellbeing
    // sessions don't have an analyzer counterpart, but they DO produce
    // memorable facts (emotional patterns, recurring stressors).
    const wbHandle = wellbeingSessionRef.current;
    if (wbHandle?.sessionId && token) {
      void extractMemoryFromSession(wbHandle.sessionId, "noor", token);
    }
  }, []);

  const abort = useCallback(() => {
    if (abortRef.current) {
      try { abortRef.current.abort(); } catch { /* already aborted */ }
      abortRef.current = null;
    }
    setLoading(false);
    setPartial("");
  }, []);

  const send: StreamingAIState["send"] = useCallback(async (persona, body, history, context = {}) => {
    if (!body.trim()) return { ok: false, reason: "rate" } as const;
    if (loading) return { ok: false, reason: "rate" } as const;
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      return { ok: false, reason: "network" } as const;
    }

    setLoading(true);
    setPartial("");

    // Distinguishing flag for the 90s hang guard. Both deliberate user
    // cancel and the timeout call abort() → AbortError, which is
    // indistinguishable in the catch block. We flip this before
    // calling abort() from the timeout so the catch can pick the
    // right error reason ("network" + "took too long") instead of
    // silently dropping the way a user-initiated cancel does.
    let timedOut = false;
    const guard = setTimeout(() => { timedOut = true; abort(); }, 90_000);

    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    try {
      const endpoint = persona === "noor" ? "/api/ai/wellbeing" : "/api/ai/tutor";

      const { data: { session } } = await getSessionCached();
      const access = session?.access_token;
      if (!access) {
        clearTimeout(guard);
        setLoading(false);
        return { ok: false, reason: "auth", message: "Sign in to use the AI." } as const;
      }
      accessTokenRef.current = access;

      // ── Bas Udros tutor-session bookkeeping ──
      // Only the tutor endpoint uses the durable per-subject memory
      // tables; the wellbeing endpoint stays on its own (Noor) flow.
      // If the active session's subject differs from this turn's
      // subject, close the old one first so its analysis runs.
      const subjectForSession = (context.subject ?? "general").trim() || "general";
      let tutorMemory: string | null = null;
      if (endpoint === "/api/ai/tutor") {
        const active = sessionRef.current;
        if (active && active.subject !== subjectForSession) {
          // Subject change → analyse + close + open fresh.
          void analyzeAndCloseSession(active.sessionId, access);
          // Also extract memory from the closing session.
          void extractMemoryFromSession(active.sessionId, "omar", access);
          sessionRef.current = null;
        }
        if (!sessionRef.current) {
          // Best-effort load; failure leaves sessionRef null and the
          // request still goes through with no tutor memory.
          try {
            sessionRef.current = await startOrResumeSession(
              session.user.id,
              subjectForSession,
              context.mode ?? "homework_help",
            );
          } catch {
            sessionRef.current = null;
          }
        }
        tutorMemory = sessionRef.current?.memoryContext ?? null;
      }

      // ── Noor session bookkeeping ──
      // Wellbeing sessions persist into wellbeing_sessions (parallel
      // table to tutor_sessions). Resume window is the same 30 min
      // window — multi-turn conversations stay in one row. Failure
      // is silent: streaming continues with no persistence.
      if (endpoint === "/api/ai/wellbeing") {
        if (!wellbeingSessionRef.current) {
          try {
            wellbeingSessionRef.current = await startOrResumeWellbeingSession(
              session.user.id,
              "general",
            );
          } catch {
            wellbeingSessionRef.current = null;
          }
        }
      }

      const apiMsgs = [...history, { role: "user" as const, content: body }];

      abortRef.current = new AbortController();
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${access}`,
        },
        body: JSON.stringify({
          messages: apiMsgs,
          subject: context.subject ?? "",
          major:   context.major   ?? profile?.major ?? "",
          year:    context.year    ?? profile?.year  ?? "",
          uni:     context.uni     ?? profile?.uni   ?? "",
          // Day 17.6: pass the student's profile name so the AI can
          // address them by name AND auto-fill it into CV / email
          // drafts without asking. Falls back to empty string if the
          // profile hasn't been loaded yet — the API treats that as
          // "no name available, ask".
          studentName: profile?.name ?? "",
          userId:  session.user.id,
          lang:    context.lang === "auto" ? undefined : context.lang,
          // Personality summary built from match_quiz.answers — gives
          // the AI tutor enough context to adapt its tone, pacing,
          // and explanation style to the student. Null when the user
          // hasn't taken the quiz; the API endpoint skips the block.
          personality: personalitySummary ?? undefined,
          // Bas Udros (UPGRADE 3 + 7): durable session memory + mode.
          // Tutor endpoint reads them; wellbeing endpoint ignores
          // unknown fields, so this is safe to send to both.
          tutorMemory: tutorMemory ?? undefined,
          mode: context.mode ?? "homework_help",
          // Image attached to this turn — base64 string + media type.
          // The API replaces the last user message's content with a
          // multimodal Anthropic block so the model can actually see
          // the image. Client compresses to JPEG ≤700 KB before send,
          // so total request body stays under the edge function cap.
          imageBase64:    context.imageBase64    ?? undefined,
          imageMediaType: context.imageMediaType ?? undefined,
          // PDF attached to this turn — base64-encoded. Sent directly
          // to Anthropic as a `document` content block (no client-side
          // extraction). Claude reads the PDF natively. Capped at
          // 1 MB raw client-side so the request fits in our 1.5 MB
          // edge-function body limit after base64 inflation.
          pdfBase64: context.pdfBase64 ?? undefined,
          pdfName:   context.pdfName   ?? undefined,
          // Plain-text document content (.txt, .doc — non-PDF).
          // Injected as a fenced block in the system prompt.
          documentContext: context.documentContext ?? undefined,
          documentLabel:   context.documentLabel   ?? undefined,
          // Day 18 — focus session context. Tutor endpoint reads it
          // to switch Omar into focus mode. Undefined when no session
          // is running.
          studySession: context.studySession ?? undefined,
        }),
        signal: abortRef.current.signal,
      });

      if (res.status === 429) {
        const data = await res.json().catch(() => ({ reason: "rate" as const }));
        clearTimeout(guard);
        setLoading(false);
        return {
          ok: false,
          reason: (data.reason as StreamErrorReason) ?? "rate",
          message: data.message,
        } as const;
      }

      // Surface the actual server error message instead of a bare
      // status code. The API returns JSON with { error, limit } —
      // including this string in the chat helps debug live (e.g.
      // "Service temporarily unavailable" = env vars not set on
      // Vercel; "Please sign in" = JWT missing).
      if (!res.ok || !res.body) {
        clearTimeout(guard);
        setLoading(false);
        let serverMessage: string | undefined;
        try {
          const data = await res.clone().json();
          serverMessage = (data?.error as string) || undefined;
        } catch { /* not JSON — leave message empty */ }
        if (import.meta.env.DEV) {
          console.error(`[AI ${endpoint}] ${res.status}:`, serverMessage ?? "(no body)");
        }
        const reason: StreamErrorReason =
          res.status === 401 ? "auth" :
          res.status === 503 ? "network" :
          "network";
        return {
          ok: false,
          reason,
          message: serverMessage ?? `Server returned ${res.status}.`,
        } as const;
      }

      reader = res.body.getReader();
      const decoder = new TextDecoder();
      let assistant = "";
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const json = JSON.parse(line.slice(6));
            if (typeof json.content === "string") {
              assistant += json.content;
              setPartial(assistant);
            }
          } catch { /* tolerate malformed chunks — common at stream tail */ }
        }
      }
      clearTimeout(guard);
      setLoading(false);
      setPartial("");
      abortRef.current = null;

      // Persist this user/assistant pair into the correct session
      // table for this persona. Best-effort — failure is silent and
      // never blocks the chat. Tutor turns flow into tutor_sessions
      // for memory + progress; Noor turns flow into wellbeing_sessions
      // so they show up in the unified History sidebar.
      const handle = sessionRef.current;
      if (handle?.sessionId && endpoint === "/api/ai/tutor") {
        const nowIso = new Date().toISOString();
        const newMsgs: TutorMessage[] = [
          { role: "user", content: body, ts: nowIso },
          { role: "assistant", content: assistant, ts: new Date().toISOString() },
        ];
        void appendMessages(handle.sessionId, newMsgs);
      }
      const wbHandle = wellbeingSessionRef.current;
      if (wbHandle?.sessionId && endpoint === "/api/ai/wellbeing") {
        const nowIso = new Date().toISOString();
        const newWbMsgs: WellbeingMessage[] = [
          { role: "user", content: body, ts: nowIso },
          { role: "assistant", content: assistant, ts: new Date().toISOString() },
        ];
        void appendWellbeingMessages(wbHandle.sessionId, newWbMsgs);
      }

      return { ok: true, assistant } as const;
    } catch (e) {
      clearTimeout(guard);
      setLoading(false);
      setPartial("");
      if (reader) try { reader.cancel(); } catch { /* already done */ }
      const aborted = e instanceof DOMException && e.name === "AbortError";
      // Three possible paths into this catch:
      //   1. Network error → reason: "network"
      //   2. 90s hang guard fired → still aborted, but `timedOut` is
      //      set; surface a real error so the user knows the stream
      //      stalled rather than getting silently dropped.
      //   3. User clicked cancel → "aborted"; AIScreen skips the
      //      error bubble (cancel is intentional, not a failure).
      if (aborted && timedOut) {
        return { ok: false, reason: "network", message: "The AI took too long to respond. Try again." } as const;
      }
      return { ok: false, reason: aborted ? "aborted" : "network", message: aborted ? "Cancelled" : "Network error" } as const;
    }
  }, [loading, abort, profile, personalitySummary]);

  return { send, loading, partial, abort, endActiveSession };
}
