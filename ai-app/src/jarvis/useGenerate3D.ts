/**
 * useGenerate3D — React lifecycle for a Meshy text-to-3D job.
 *
 * Drives /api/research/model3d (create → poll → glb URL) and exposes a
 * Gen3DStep the viewer renders. All decision logic is the PURE
 * functions in generate3d.ts (tested); this file is only fetch + timer
 * + unmount plumbing.
 *
 * Auth matches the rest of Aurora: a fresh supabase session token per
 * call (the same pattern AuroraAIScreen uses for /api/ai/*). Signed-out
 * users get the "unauthorized" phase — the viewer shows a sign-in nudge
 * instead of firing a doomed request.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { apiUrl } from "@/lib/apiBase";
import {
  classifyCreate,
  classifyPoll,
  isTerminal,
  pollDelayMs,
  MAX_POLL_MS,
  type Gen3DStep,
} from "./generate3d";

export function useGenerate3D(prompt: string): {
  step: Gen3DStep;
  /** Restart the whole job (Try-again button). */
  retry: () => void;
  /** The viewer calls this once the GLTF finishes parsing. */
  markReady: () => void;
} {
  const [step, setStep] = useState<Gen3DStep>({ phase: "creating", progress: 0 });
  // Bump to re-run the whole lifecycle (retry).
  const [attempt, setAttempt] = useState(0);

  // markReady flips loading → ready without touching the job effect.
  const markReady = useCallback(() => {
    setStep((s) => (s.phase === "loading" ? { ...s, phase: "ready" } : s));
  }, []);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  // Keep the latest step in a ref for the poll loop's closure.
  const stepRef = useRef(step);
  stepRef.current = step;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();

    const run = async () => {
      setStep({ phase: "creating", progress: 0 });

      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token ?? null;
      if (cancelled) return;
      if (!token) {
        setStep({ phase: "unauthorized", progress: 0, message: "Sign in to generate 3D models." });
        return;
      }
      const authHeaders = { Authorization: `Bearer ${token}` };

      // ── CREATE ──
      let created: Gen3DStep;
      try {
        const res = await fetch(apiUrl("/api/research/model3d"), {
          method: "POST",
          headers: { ...authHeaders, "Content-Type": "application/json" },
          body: JSON.stringify({ prompt }),
        });
        const body = await res.json().catch(() => null);
        created = classifyCreate(res.status, body);
      } catch {
        created = { phase: "failed", progress: 0, message: "Network hiccup — try again." };
      }
      if (cancelled) return;
      setStep(created);
      if (created.phase !== "pending" || !created.jobId || !created.token) return;

      // ── POLL ──
      const { jobId, token: jobToken } = created;
      let pollAttempt = 0;
      let consecutiveFailures = 0;

      const poll = async () => {
        if (cancelled) return;
        if (Date.now() - startedAt > MAX_POLL_MS) {
          setStep({ phase: "failed", progress: stepRef.current.progress, message: "Build timed out — try again." });
          return;
        }
        let next: Gen3DStep;
        try {
          const res = await fetch(
            apiUrl(`/api/research/model3d?jobId=${encodeURIComponent(jobId)}&token=${encodeURIComponent(jobToken)}`),
            { headers: authHeaders },
          );
          const body = await res.json().catch(() => null);
          next = classifyPoll(res.status, body);
        } catch {
          next = { phase: "failed", progress: stepRef.current.progress, message: "Network hiccup." };
        }
        if (cancelled) return;

        consecutiveFailures = next.phase === "failed" ? consecutiveFailures + 1 : 0;
        if (isTerminal(next, consecutiveFailures)) {
          setStep({ ...next, jobId, token: jobToken });
          return;
        }
        // Non-terminal: show progress (a retryable failed poll keeps
        // the previous visible phase so the UI doesn't flicker).
        if (next.phase !== "failed") {
          setStep({ ...next, jobId, token: jobToken });
        }
        pollAttempt += 1;
        timer = setTimeout(poll, pollDelayMs(pollAttempt));
      };
      timer = setTimeout(poll, pollDelayMs(0));
    };

    void run();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [prompt, attempt]);

  return { step, retry, markReady };
}
