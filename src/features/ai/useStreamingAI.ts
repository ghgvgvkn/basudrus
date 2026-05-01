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
 */
import { useCallback, useRef, useState } from "react";
import { getSessionCached } from "@/lib/supabase";
import { useApp } from "@/context/AppContext";
import type { AIPersona } from "@/shared/types";
import { useViewerPersonality } from "@/features/match/useViewerPersonality";

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
    context?: { subject?: string; major?: string; year?: string | number; uni?: string; lang?: "en" | "ar" | "auto" },
  ) => Promise<{ ok: true; assistant: string } | { ok: false; reason: StreamErrorReason; message?: string }>;
  loading: boolean;
  partial: string;
  abort: () => void;
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
          userId:  session.user.id,
          lang:    context.lang === "auto" ? undefined : context.lang,
          // Personality summary built from match_quiz.answers — gives
          // the AI tutor enough context to adapt its tone, pacing,
          // and explanation style to the student. Null when the user
          // hasn't taken the quiz; the API endpoint skips the block.
          personality: personalitySummary ?? undefined,
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

  return { send, loading, partial, abort };
}
