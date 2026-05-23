/**
 * useVoice — shared client hook for Bas Udrus's voice layer.
 *
 * Provides:
 *   - speak(text)          : stream TTS audio from /api/ai/voice/speak,
 *                            play through an AudioContext, expose an
 *                            AnalyserNode for future 3D-Jarvis visuals.
 *   - startRecording()     : begin MediaRecorder capture (Opus/WebM).
 *   - stopRecording()      : end capture, return the Blob.
 *   - transcribe(blob)     : POST to /api/ai/voice/transcribe, return text.
 *   - cancel()             : interrupt playback (Jarvis-prep — V3 will
 *                            extend this to interrupt mid-stream).
 *
 * Why AudioContext + AnalyserNode now (instead of plain <audio>)?
 *   Even in V1 (REST TTS, no streaming WebSocket yet), the 3D scene
 *   we'll build later reads FFT data from the AnalyserNode every frame
 *   to drive shaders / mesh deformation. By piping playback through
 *   the same node now, the 3D layer is plug-and-play when it lands —
 *   no audio-pipeline refactor required. See the architecture sketch
 *   in chat history.
 *
 * Lives in shared src/features/ai/voice/ so both apps can import it,
 * but only ai-app mounts a UI that calls it today (per the V1+V2
 * "ai-app only" scope decision).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { apiUrl } from "@/lib/apiBase";

// API endpoints — same-origin in production on basudrus.com, but the
// ai-app deployment (basudrus-ai.vercel.app) calls them cross-origin
// via VITE_API_BASE. apiUrl() handles both modes — see src/lib/apiBase.ts
// for the full explanation.
const SPEAK_URL = "/api/ai/voice/speak";
const TRANSCRIBE_URL = "/api/ai/voice/transcribe";

/** Result of a single speak() call. */
export interface SpeakResult {
  ok: boolean;
  /** When ok=false; UI surfaces this. */
  error?: string;
  /** When ok=true; resolves when playback finishes (useful for chaining). */
  ended?: Promise<void>;
}

/** Result of transcribe(). */
export interface TranscribeResult {
  ok: boolean;
  transcript: string;
  detectedLanguage?: string;
  error?: string;
}

/** Public shape of the hook. */
export interface UseVoiceResult {
  // ── TTS ──
  /** True while audio is queued or playing. */
  isSpeaking: boolean;
  /** Synthesize + play. Returns a SpeakResult once playback STARTS
   *  (not when it finishes — use result.ended for that). */
  speak: (text: string, opts?: { voiceId?: string }) => Promise<SpeakResult>;
  /** Stop current playback, drop the queue. Safe to call any time. */
  stopSpeaking: () => void;
  /**
   * Unlock the audio pipeline during a user gesture so later speak()
   * calls aren't blocked by browser autoplay policy. Call this from
   * any onClick / onTap that LEADS to an automatic later playback —
   * e.g. when the user taps the mic for hands-free voice mode, where
   * the TTS reply arrives seconds later, well past the gesture window.
   *
   * Synchronous-ish: returns immediately. Idempotent.
   */
  primeAudio: () => void;

  // ── STT ──
  /** True while the microphone is recording. */
  isListening: boolean;
  /** True while a transcription request is in flight. */
  isTranscribing: boolean;
  /**
   * Start microphone capture. Resolves once recording is active.
   *
   * Optional `handsFree` mode enables voice-activity detection (VAD):
   * after the user has spoken at least once and then goes silent for
   * `silenceMs` (default 1500), the `onSilence` callback fires — the
   * caller then runs stopRecording + transcribe + send. While
   * recording, `onLevel` (if provided) is called every animation frame
   * with the current normalized 0–1 audio level — drives visual
   * feedback (canvas reactivity, animated dots, etc.).
   *
   * Without `handsFree`, behavior is unchanged: caller must call
   * stopRecording manually (push-to-talk pattern).
   */
  startRecording: (opts?: {
    handsFree?: {
      silenceMs?: number;
      onSilence?: () => void;
      onLevel?: (rms: number) => void;
    };
  }) => Promise<{ ok: boolean; error?: string }>;
  /** Stop microphone capture and return the recorded Blob (or null on error). */
  stopRecording: () => Promise<Blob | null>;
  /** POST audio to the server; return the transcript. */
  transcribe: (blob: Blob, languageCode?: "en" | "ar") => Promise<TranscribeResult>;

  // ── Last error surfaced to UI ──
  error: string | null;

  // ── Future Jarvis hook: 3D scenes read FFT data off this node. ──
  /** AnalyserNode wired into the playback chain. Null until first speak()
   *  call (AudioContext is created lazily after a user gesture, per
   *  browser autoplay policy). The node persists across speak() calls
   *  so the 3D scene can keep its reference. */
  analyserRef: React.RefObject<AnalyserNode | null>;
}

/** What MediaRecorder mime type to use. Browsers vary:
 *    - Chrome / Edge / Firefox → audio/webm;codecs=opus (preferred)
 *    - Safari (iOS + macOS)     → audio/mp4 (Opus support landed late)
 *  We probe in priority order and fall back to the first that works.
 *  Empty string means "let MediaRecorder pick its default." */
function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
    "audio/mpeg",
  ];
  for (const mt of candidates) {
    if (MediaRecorder.isTypeSupported(mt)) return mt;
  }
  return "";
}

/** Chunk-safe ArrayBuffer → base64 (iOS Safari blows up on
 *  String.fromCharCode.apply with a multi-MB Uint8Array). */
function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, Math.min(i + CHUNK, bytes.length))),
    );
  }
  return btoa(bin);
}

export function useVoice(): UseVoiceResult {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // AudioContext + AnalyserNode are created lazily on first speak()
  // because browsers throw on AudioContext construction outside a
  // user gesture. We persist them across calls so the 3D scene's
  // analyser reference stays stable.
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  // Current playback's <audio> element + the MediaElementAudioSource
  // bridging it into the AudioContext. We keep refs so stopSpeaking()
  // can pause/disconnect cleanly.
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  // Abort controller for the in-flight speak() fetch (cancels server
  // streaming if the user navigates away or interrupts).
  const speakAbortRef = useRef<AbortController | null>(null);

  // MediaRecorder + stream refs for STT.
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  // VAD / hands-free voice mode refs. Created on startRecording when
  // hands-free mode is active, torn down on stopRecording.
  //   micCtx        — dedicated AudioContext for mic-side analysis.
  //                   Separate from the playback context so closing
  //                   one doesn't kill the other.
  //   micSource     — MediaStreamSourceNode reading the mic stream.
  //   micAnalyser   — AnalyserNode for level sampling. fftSize=512
  //                   for cheap per-frame RMS calculation.
  //   vadRaf        — requestAnimationFrame handle so we can cancel
  //                   the level-monitoring loop on stop/unmount.
  const micCtxRef = useRef<AudioContext | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const vadRafRef = useRef<number | null>(null);

  // Cleanup on unmount — stop any active audio + release the mic
  // stream so the browser's recording indicator disappears.
  useEffect(() => {
    return () => {
      try { speakAbortRef.current?.abort(); } catch { /* noop */ }
      try { audioElRef.current?.pause(); } catch { /* noop */ }
      try { sourceNodeRef.current?.disconnect(); } catch { /* noop */ }
      try { audioContextRef.current?.close(); } catch { /* noop */ }
      try {
        streamRef.current?.getTracks().forEach((t) => t.stop());
      } catch { /* noop */ }
      // Tear down VAD-side audio graph if it survived (defensive — the
      // stopRecording path normally handles this).
      if (vadRafRef.current !== null) cancelAnimationFrame(vadRafRef.current);
      try { micSourceRef.current?.disconnect(); } catch { /* noop */ }
      try { void micCtxRef.current?.close(); } catch { /* noop */ }
    };
  }, []);

  /** Lazy-init the AudioContext + AnalyserNode the first time we speak.
   *  Re-using the same context across calls means the analyser ref is
   *  stable for downstream consumers (3D scene). */
  const ensureAudioContext = useCallback((): { ctx: AudioContext; analyser: AnalyserNode } => {
    if (audioContextRef.current && analyserRef.current) {
      return { ctx: audioContextRef.current, analyser: analyserRef.current };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const AC: typeof AudioContext = (window.AudioContext || (window as any).webkitAudioContext);
    const ctx = new AC();
    const analyser = ctx.createAnalyser();
    // Default 2048 FFT is plenty for amplitude-driven visuals; bump
    // higher only if the 3D scene needs finer frequency resolution.
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.85;
    audioContextRef.current = ctx;
    analyserRef.current = analyser;
    return { ctx, analyser };
  }, []);

  /**
   * Prime the audio pipeline inside a user-gesture handler so playback
   * works later when it really matters.
   *
   * Browsers enforce an autoplay policy: HTMLAudioElement.play() and
   * AudioContext creation are only allowed during (or shortly after)
   * a user gesture — a click, tap, key press. Hands-free voice mode
   * has a multi-second pipeline (record → silence-detect → STT →
   * Anthropic stream → TTS fetch → play) so by the time speak() calls
   * audio.play(), the original mic-tap gesture has expired and Chrome
   * (especially Safari) refuses to play.
   *
   * Calling primeAudio() synchronously inside the mic-tap onClick
   * lets us:
   *   1. Create the AudioContext while the gesture is still "fresh"
   *      — so it starts in "running" state instead of "suspended".
   *   2. Play a tiny silent buffer immediately, which counts as
   *      "the page initiated audio playback" and unlocks later
   *      audio.play() calls for the rest of the session on most
   *      browsers.
   *
   * Safe to call multiple times — idempotent after first success.
   */
  const primeAudio = useCallback(() => {
    try {
      const { ctx } = ensureAudioContext();
      // Resume if the context was created earlier in a non-gesture
      // path (e.g. by an analyser being requested elsewhere). resume()
      // is async but works as long as we're in a gesture stack at
      // call time — we don't need to await it.
      if (ctx.state === "suspended") void ctx.resume();
      // Play a 50ms silent buffer through the destination. This is
      // the "audio unlock" trick: many browsers (Safari, older Chrome)
      // only allow further playback once at least one buffer has
      // actually been played within a gesture.
      const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.05), ctx.sampleRate);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start(0);
    } catch {
      // Construction can fail on very old browsers or in some embedded
      // webviews. We swallow — the regular speak() path will surface a
      // clean error if playback later fails.
    }
  }, [ensureAudioContext]);

  // ── TTS ────────────────────────────────────────────────────────────

  const stopSpeaking = useCallback(() => {
    try { speakAbortRef.current?.abort(); } catch { /* noop */ }
    speakAbortRef.current = null;
    if (audioElRef.current) {
      try { audioElRef.current.pause(); } catch { /* noop */ }
      try { audioElRef.current.src = ""; } catch { /* noop */ }
      audioElRef.current = null;
    }
    if (sourceNodeRef.current) {
      try { sourceNodeRef.current.disconnect(); } catch { /* noop */ }
      sourceNodeRef.current = null;
    }
    setIsSpeaking(false);
  }, []);

  const speak = useCallback<UseVoiceResult["speak"]>(async (text, opts) => {
    setError(null);
    if (!text || !text.trim()) {
      return { ok: false, error: "Nothing to speak" };
    }
    // If we're already speaking something, drop it. Last call wins —
    // matches the "user just hit speak on a different message" UX.
    stopSpeaking();

    // We need the JWT for the rate limiter.
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) {
      setError("Sign in to use voice.");
      return { ok: false, error: "Not signed in" };
    }

    const ctl = new AbortController();
    speakAbortRef.current = ctl;

    let res: Response;
    try {
      res = await fetch(apiUrl(SPEAK_URL), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ text: text.trim(), voiceId: opts?.voiceId }),
        signal: ctl.signal,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Network error";
      // AbortError = user-initiated stop; don't surface as a real error.
      if (e instanceof Error && e.name === "AbortError") {
        return { ok: false, error: "Aborted" };
      }
      setError(msg);
      return { ok: false, error: msg };
    }
    if (!res.ok) {
      // Try to read a JSON error envelope; fall back to status text.
      let serverMsg = `Voice failed (${res.status})`;
      try {
        const j = await res.json() as { error?: string };
        if (j?.error) serverMsg = j.error;
      } catch { /* keep default */ }
      setError(serverMsg);
      return { ok: false, error: serverMsg };
    }

    // Pipe the audio response into an <audio> element via a Blob URL.
    // Why Blob URL instead of MediaSource Extensions? MSE for streamed
    // MP3 is fiddly across browsers; the small latency cost of fully
    // downloading before playback (vs. streaming through MSE) is ~150ms
    // for a typical Tony response and worth the simplicity.
    //
    // V3 (Jarvis WebSocket) will swap this for direct AudioContext
    // decoding, which is what enables interruption + per-chunk visuals.
    let audioBlob: Blob;
    try {
      audioBlob = await res.blob();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Couldn't read audio";
      setError(msg);
      return { ok: false, error: msg };
    }
    if (audioBlob.size < 200) {
      setError("Empty audio response");
      return { ok: false, error: "Empty audio response" };
    }

    const { ctx, analyser } = ensureAudioContext();
    // Resume context if a previous tab-throttle suspended it (Chrome
    // suspends background contexts; we revive on next gesture).
    if (ctx.state === "suspended") {
      try { await ctx.resume(); } catch { /* noop */ }
    }

    const url = URL.createObjectURL(audioBlob);
    const el = new Audio();
    el.src = url;
    el.crossOrigin = "anonymous";
    audioElRef.current = el;

    // Wire <audio> → MediaElementAudioSource → AnalyserNode → destination.
    // The analyser is a passive tap — audio still reaches speakers.
    let source: MediaElementAudioSourceNode;
    try {
      source = ctx.createMediaElementSource(el);
      source.connect(analyser);
      analyser.connect(ctx.destination);
      sourceNodeRef.current = source;
    } catch {
      // Some browsers throw when createMediaElementSource is called on
      // the same element twice. We create a fresh element per call so
      // this shouldn't fire, but in case it does fall back to direct
      // playback (no analyser → no 3D visuals for this turn).
      sourceNodeRef.current = null;
    }

    setIsSpeaking(true);
    const ended = new Promise<void>((resolve) => {
      el.addEventListener("ended", () => {
        URL.revokeObjectURL(url);
        if (audioElRef.current === el) {
          audioElRef.current = null;
          sourceNodeRef.current?.disconnect();
          sourceNodeRef.current = null;
        }
        setIsSpeaking(false);
        resolve();
      }, { once: true });
      el.addEventListener("error", () => {
        URL.revokeObjectURL(url);
        setIsSpeaking(false);
        resolve();
      }, { once: true });
    });

    try {
      await el.play();
    } catch (e) {
      // Autoplay policy can still block .play() if the user hasn't
      // interacted yet. Surface a clean message.
      const msg = e instanceof Error ? e.message : "Playback blocked";
      setError(`Tap to enable audio (${msg})`);
      setIsSpeaking(false);
      return { ok: false, error: msg };
    }

    return { ok: true, ended };
  }, [ensureAudioContext, stopSpeaking]);

  // ── STT ────────────────────────────────────────────────────────────

  const startRecording = useCallback<UseVoiceResult["startRecording"]>(async (opts) => {
    setError(null);
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      const msg = "Microphone not supported in this browser";
      setError(msg);
      return { ok: false, error: msg };
    }
    // Already recording? Treat as a no-op (caller likely double-clicked).
    if (recorderRef.current && recorderRef.current.state === "recording") {
      return { ok: true };
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (e) {
      const msg = e instanceof Error
        ? (e.name === "NotAllowedError" ? "Microphone permission denied" : e.message)
        : "Couldn't access microphone";
      setError(msg);
      return { ok: false, error: msg };
    }
    streamRef.current = stream;

    const mimeType = pickMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "MediaRecorder unavailable";
      setError(msg);
      stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      return { ok: false, error: msg };
    }

    recordedChunksRef.current = [];
    recorder.addEventListener("dataavailable", (ev: BlobEvent) => {
      if (ev.data && ev.data.size > 0) recordedChunksRef.current.push(ev.data);
    });
    recorderRef.current = recorder;
    recorder.start(250); // 250ms timeslice — keep chunks small for low latency
    setIsListening(true);

    // ── Hands-free mode: set up VAD ────────────────────────────────────
    // Spin up a dedicated mic-side AudioContext + AnalyserNode so we
    // can monitor the input level every animation frame. The first
    // time we detect speech (RMS above the threshold) we flip a
    // "spoke at least once" flag — without it, the silence detector
    // would fire instantly at session start before the user has said
    // anything. Once they've spoken AND fallen silent for silenceMs,
    // we invoke onSilence so the caller can stop+transcribe.
    if (opts?.handsFree) {
      const { silenceMs = 1500, onSilence, onLevel } = opts.handsFree;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const AC: typeof AudioContext = (window.AudioContext || (window as any).webkitAudioContext);
        const micCtx = new AC();
        const source = micCtx.createMediaStreamSource(stream);
        const analyser = micCtx.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.6;
        source.connect(analyser);
        micCtxRef.current = micCtx;
        micSourceRef.current = source;
        micAnalyserRef.current = analyser;

        // RMS calculation reuses one Float32Array to avoid per-frame
        // allocation. Threshold is empirical — ~0.02 is roughly
        // "quieter than typing nearby" but louder than fan noise on
        // most laptops with echoCancellation enabled.
        const buf = new Float32Array(analyser.fftSize);
        const SPEECH_THRESHOLD = 0.02;
        let hasSpoken = false;
        let silenceStartedAt: number | null = null;
        let cancelled = false;

        const loop = () => {
          if (cancelled) return;
          // Bail out if recording has already been stopped from outside.
          if (!recorderRef.current || recorderRef.current.state !== "recording") {
            return;
          }
          analyser.getFloatTimeDomainData(buf);
          // Standard RMS over the frame.
          let sumSq = 0;
          for (let i = 0; i < buf.length; i++) sumSq += buf[i] * buf[i];
          const rms = Math.sqrt(sumSq / buf.length);
          if (onLevel) {
            // Clamp to 0–1 with a soft ceiling for nicer visuals.
            onLevel(Math.min(1, rms * 4));
          }
          const now = performance.now();
          if (rms > SPEECH_THRESHOLD) {
            hasSpoken = true;
            silenceStartedAt = null;
          } else if (hasSpoken) {
            if (silenceStartedAt === null) silenceStartedAt = now;
            else if (now - silenceStartedAt >= silenceMs) {
              // End of utterance detected. Fire callback ONCE then stop
              // the loop — the caller is expected to call stopRecording
              // which will tear down the VAD context via the cleanup
              // path in stopRecording.
              cancelled = true;
              vadRafRef.current = null;
              try { onSilence?.(); } catch { /* caller threw — swallow */ }
              return;
            }
          }
          vadRafRef.current = requestAnimationFrame(loop);
        };
        vadRafRef.current = requestAnimationFrame(loop);
      } catch (e) {
        // VAD setup failed — keep recording in non-handsfree mode rather
        // than tearing the whole thing down. Caller can still tap to
        // stop manually.
        if (import.meta.env.DEV) console.warn("[useVoice] VAD setup failed:", e);
      }
    }

    return { ok: true };
  }, []);

  const stopRecording = useCallback<UseVoiceResult["stopRecording"]>(async () => {
    // Cancel any in-flight VAD loop and tear down the mic-side audio
    // graph. Safe to run unconditionally — refs are null when not in
    // hands-free mode.
    if (vadRafRef.current !== null) {
      cancelAnimationFrame(vadRafRef.current);
      vadRafRef.current = null;
    }
    if (micSourceRef.current) {
      try { micSourceRef.current.disconnect(); } catch { /* noop */ }
      micSourceRef.current = null;
    }
    micAnalyserRef.current = null;
    if (micCtxRef.current) {
      try { void micCtxRef.current.close(); } catch { /* noop */ }
      micCtxRef.current = null;
    }

    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      setIsListening(false);
      return null;
    }
    const stopped = new Promise<void>((resolve) => {
      recorder.addEventListener("stop", () => resolve(), { once: true });
    });
    try { recorder.stop(); } catch { /* noop */ }
    await stopped;
    // Release the mic so the browser's recording indicator goes away.
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
    setIsListening(false);

    const chunks = recordedChunksRef.current;
    recordedChunksRef.current = [];
    if (chunks.length === 0) return null;
    const mimeType = recorder.mimeType || chunks[0].type || "audio/webm";
    return new Blob(chunks, { type: mimeType });
  }, []);

  const transcribe = useCallback<UseVoiceResult["transcribe"]>(async (blob, languageCode) => {
    setError(null);
    setIsTranscribing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        const msg = "Sign in to use voice.";
        setError(msg);
        return { ok: false, transcript: "", error: msg };
      }
      const buf = await blob.arrayBuffer();
      const base64 = arrayBufferToBase64(buf);
      // Normalize mediaType: drop the codecs= suffix variant the server
      // doesn't need to know — Scribe handles either form, but our
      // server allowlist is matched against both with-/without-codec
      // variants anyway.
      const mediaType = blob.type || "audio/webm";
      const res = await fetch(apiUrl(TRANSCRIBE_URL), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ audioBase64: base64, mediaType, languageCode }),
      });
      const json = await res.json().catch(() => null) as
        | { ok?: boolean; transcript?: string; detectedLanguage?: string; error?: string }
        | null;
      if (!res.ok || !json) {
        const msg = json?.error || `Transcription failed (${res.status})`;
        setError(msg);
        return { ok: false, transcript: "", error: msg };
      }
      return {
        ok: !!json.ok,
        transcript: json.transcript ?? "",
        detectedLanguage: json.detectedLanguage,
        error: json.error,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Network error";
      setError(msg);
      return { ok: false, transcript: "", error: msg };
    } finally {
      setIsTranscribing(false);
    }
  }, []);

  return {
    isSpeaking,
    speak,
    stopSpeaking,
    primeAudio,
    isListening,
    isTranscribing,
    startRecording,
    stopRecording,
    transcribe,
    error,
    analyserRef,
  };
}
