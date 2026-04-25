/**
 * useVoiceRecorder — thin wrapper around MediaRecorder.
 *
 * Returns:
 *   start()   → request mic + begin recording
 *   stop()    → end recording, returns { blob, durationMs }
 *   cancel()  → stop + discard
 *   recording → true while a recording is in flight
 *   error     → "denied" | "unsupported" | "network" | null
 *
 * Notes:
 *   - We pick the best MIME type the browser supports; defaults to
 *     audio/webm (Chrome / Firefox / Edge), falls back to audio/mp4
 *     (Safari iOS), and finally to MediaRecorder default.
 *   - Auto-stops at MAX_DURATION_MS so a stuck-down mic button can't
 *     create a 50 MB blob.
 *   - Mic permission is requested on each start() call; the browser
 *     remembers grant after the first time.
 */
import { useCallback, useRef, useState } from "react";

export type VoiceRecorderError = "denied" | "unsupported" | "network" | null;

const MAX_DURATION_MS = 3 * 60_000; // 3 minutes hard cap

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  for (const m of candidates) {
    try { if (MediaRecorder.isTypeSupported(m)) return m; } catch { /* ignore */ }
  }
  return undefined;
}

export function useVoiceRecorder() {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<VoiceRecorderError>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startedAtRef = useRef<number>(0);
  const stopResolverRef = useRef<((b: { blob: Blob; durationMs: number } | null) => void) | null>(null);
  const cappedTimerRef = useRef<number | null>(null);

  const cleanup = useCallback(() => {
    if (cappedTimerRef.current !== null) {
      window.clearTimeout(cappedTimerRef.current);
      cappedTimerRef.current = null;
    }
    if (streamRef.current) {
      // Releases the mic indicator in the browser address bar.
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    recRef.current = null;
    chunksRef.current = [];
    stopResolverRef.current = null;
  }, []);

  const start = useCallback(async (): Promise<boolean> => {
    if (typeof MediaRecorder === "undefined" || !navigator?.mediaDevices?.getUserMedia) {
      setError("unsupported");
      return false;
    }
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickMimeType();
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      streamRef.current = stream;
      recRef.current = rec;
      chunksRef.current = [];
      startedAtRef.current = performance.now();

      rec.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || mimeType || "audio/webm" });
        const durationMs = Math.max(0, Math.round(performance.now() - startedAtRef.current));
        const resolver = stopResolverRef.current;
        cleanup();
        setRecording(false);
        // Resolver is set by stop() / triggered by cancel(). If
        // neither was called (browser killed the recorder unexpectedly)
        // the blob is just discarded.
        resolver?.(blob.size > 0 ? { blob, durationMs } : null);
      };
      rec.onerror = () => {
        setError("network");
        cleanup();
        setRecording(false);
        stopResolverRef.current?.(null);
      };

      rec.start(100); // emit chunks every 100ms so we have data even on early stop
      setRecording(true);

      // Auto-stop after MAX_DURATION_MS to cap blob size.
      cappedTimerRef.current = window.setTimeout(() => {
        if (recRef.current && recRef.current.state === "recording") {
          recRef.current.stop();
        }
      }, MAX_DURATION_MS);

      return true;
    } catch (e) {
      const name = (e as { name?: string })?.name;
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        setError("denied");
      } else if (name === "NotFoundError") {
        setError("unsupported"); // no mic
      } else {
        setError("network");
      }
      cleanup();
      setRecording(false);
      return false;
    }
  }, [cleanup]);

  /** Stop the recording and resolve with the captured blob. */
  const stop = useCallback((): Promise<{ blob: Blob; durationMs: number } | null> => {
    if (!recRef.current || recRef.current.state !== "recording") {
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      stopResolverRef.current = resolve;
      try { recRef.current?.stop(); } catch { resolve(null); }
    });
  }, []);

  /** Cancel — stop + discard. Caller gets null. */
  const cancel = useCallback(() => {
    if (!recRef.current) return;
    stopResolverRef.current = (b) => {
      // Discard whatever blob came back.
      void b;
    };
    try { recRef.current.stop(); } catch { /* ignore */ }
  }, []);

  return { recording, error, start, stop, cancel };
}
