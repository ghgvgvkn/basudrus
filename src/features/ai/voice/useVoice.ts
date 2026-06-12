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

  /**
   * Voice-activity "barge-in" monitor. Opens a dedicated mic stream
   * (separate from MediaRecorder so it doesn't interfere with the
   * primary STT path), runs a per-frame RMS check, and fires
   * `onDetected` once the level stays above `threshold` for
   * `durationMs` consecutive milliseconds.
   *
   * Designed to run WHILE the assistant is speaking: the consumer
   * uses onDetected to stopSpeaking + start a fresh listening turn,
   * giving the user true talk-over-the-AI interruption.
   *
   * Returns a `stop()` handle (or null if the mic couldn't be opened
   * — e.g. permission denied). Always call stop() in a finally so the
   * mic indicator goes away.
   *
   * The browser's built-in echo cancellation prevents the assistant's
   * own TTS playback from triggering the listener as long as the audio
   * goes through the page's normal output route.
   */
  startBargeInListener: (opts: {
    onDetected: () => void;
    /** RMS threshold (0–1). Default 0.025 — slightly higher than the
     *  primary VAD's 0.02 to reduce false positives from Tony's voice
     *  bleeding through. */
    threshold?: number;
    /** Sustained-above-threshold time before firing. Default 250ms —
     *  fast enough to feel responsive, slow enough to ignore single
     *  pops or echo-cancellation glitches. */
    durationMs?: number;
  }) => Promise<{ stop: () => void } | null>;

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
  /** Label of the input device used by the active/last recording —
   *  empty until the first successful startRecording. */
  micLabelRef: React.RefObject<string>;
  /** Current playback speed (1 / 1.2 / 1.5 / 2), persisted. */
  voiceRateRef: React.RefObject<number>;
  /** Change playback speed — applies live to the current utterance. */
  setVoiceRate: (rate: number) => void;
  /** Seconds consumed + duration of the playing utterance (null when
   *  silent). Rate-aware; drives caption sync. */
  getSpeechProgress: () => { pos: number; duration: number } | null;
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

/**
 * Decode a MediaRecorder blob and re-encode it as 16 kHz mono 16-bit
 * PCM WAV. Browser audio containers (Safari's fragmented mp4 above
 * all) intermittently come out CORRUPTED on the 2nd+ recording of a
 * session — upstream STT rejects them with 400 "corrupted file". A
 * PCM WAV has no container structure to corrupt, so re-encoding here
 * makes every upload bit-identical in shape. 16 kHz mono is full
 * speech-transcription quality at ~32 KB/s — a 60 s ramble is ~1.9 MB,
 * comfortably inside the server's 6 MB body cap.
 *
 * Returns null when the blob can't even be decoded locally — the
 * capture is truly unusable and should not be uploaded at all.
 */
/** Encode mono Float32 PCM at 16 kHz into a 16-bit WAV blob. */
function encodeWav16k(pcm: Float32Array): Blob {
  const RATE = 16000;
  const out = new DataView(new ArrayBuffer(44 + pcm.length * 2));
  const wstr = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i));
  };
  wstr(0, "RIFF");
  out.setUint32(4, 36 + pcm.length * 2, true);
  wstr(8, "WAVE");
  wstr(12, "fmt ");
  out.setUint32(16, 16, true);   // fmt chunk size
  out.setUint16(20, 1, true);    // PCM
  out.setUint16(22, 1, true);    // mono
  out.setUint32(24, RATE, true);
  out.setUint32(28, RATE * 2, true); // byte rate
  out.setUint16(32, 2, true);    // block align
  out.setUint16(34, 16, true);   // bits per sample
  wstr(36, "data");
  out.setUint32(40, pcm.length * 2, true);
  for (let i = 0, o = 44; i < pcm.length; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    out.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([out.buffer], { type: "audio/wav" });
}

/** Linear resample of mono Float32 PCM (fromRate → 16 kHz). */
function resampleTo16k(pcm: Float32Array, fromRate: number): Float32Array {
  const RATE = 16000;
  if (fromRate === RATE) return pcm;
  const outLen = Math.max(1, Math.floor((pcm.length * RATE) / fromRate));
  const out = new Float32Array(outLen);
  const step = fromRate / RATE;
  for (let i = 0; i < outLen; i++) {
    const pos = i * step;
    const i0 = Math.floor(pos);
    const i1 = Math.min(pcm.length - 1, i0 + 1);
    const frac = pos - i0;
    out[i] = pcm[i0] * (1 - frac) + pcm[i1] * frac;
  }
  return out;
}

async function blobToWav16k(blob: Blob): Promise<Blob | null> {
  try {
    const raw = await blob.arrayBuffer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const AC: typeof AudioContext = (window.AudioContext || (window as any).webkitAudioContext);
    const probe = new AC();
    let decoded: AudioBuffer;
    try {
      decoded = await probe.decodeAudioData(raw);
    } finally {
      try { void probe.close(); } catch { /* noop */ }
    }
    const RATE = 16000;
    const frames = Math.max(1, Math.ceil(decoded.duration * RATE));
    const off = new OfflineAudioContext(1, frames, RATE);
    const src = off.createBufferSource();
    src.buffer = decoded;
    src.connect(off.destination);
    src.start(0);
    const mono = await off.startRendering();
    return encodeWav16k(mono.getChannelData(0));
  } catch {
    return null;
  }
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
  // Current playback's AudioBufferSourceNode. We use the pure Web
  // Audio API path (decodeAudioData → BufferSource) rather than an
  // HTMLAudioElement because the latter has its OWN per-element
  // autoplay gate, separate from the AudioContext's gate. Once the
  // AudioContext is unlocked by primeAudio() (called during the
  // user's mic tap), every subsequent BufferSource.start() plays
  // freely — no NotAllowedError. With the <audio> element path,
  // even an unlocked context couldn't help: each new element
  // needed its own gesture, which the multi-second voice pipeline
  // couldn't provide.
  const bufferSourceRef = useRef<AudioBufferSourceNode | null>(null);
  // Abort controller for the in-flight speak() fetch (cancels server
  // streaming if the user navigates away or interrupts).
  const speakAbortRef = useRef<AbortController | null>(null);
  /** Playback speed (1 / 1.2 / 1.5 / 2). Applied to the BufferSource's
   *  playbackRate — note Web Audio rate-shift also shifts pitch a bit
   *  at 2×. Persisted across sessions. */
  const voiceRateRef = useRef<number>(0);
  if (voiceRateRef.current === 0) {
    let r = 1;
    try { r = parseFloat(localStorage.getItem("aurora-voice-rate") || "1") || 1; } catch { /* SSR/private */ }
    voiceRateRef.current = r;
  }
  /** Speech clock for caption sync: how many seconds of the CURRENT
   *  utterance's audio have been consumed, rate-aware even when the
   *  rate changes mid-playback. */
  const speechClockRef = useRef<{
    ctx: AudioContext;
    basePos: number;
    baseAt: number;
    rate: number;
    duration: number;
  } | null>(null);

  // MediaRecorder + stream refs for STT.
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  /** Human label of the input device actually recording ("MacBook Pro
   *  Microphone", "AirPods Pro", a monitor's far-away mic…). Set on
   *  every startRecording — lets the UI name the culprit when speech
   *  arrives too quiet to transcribe. */
  const micLabelRef = useRef<string>("");
  /** Raw-PCM safety tap. MediaRecorder containers (Safari fMP4 above
   *  all) intermittently come out so corrupted after a TTS playback
   *  that even decodeAudioData rejects them — the founder lost every
   *  2nd+ utterance to this. While recording in hands-free mode we
   *  ALSO capture raw Float32 samples off the same mic graph the VAD
   *  uses; stopRecording folds them into a clean 16 kHz WAV that
   *  transcribe() falls back to when the container is unusable. */
  const pcmChunksRef = useRef<Float32Array[]>([]);
  const pcmRateRef = useRef(48000);
  const pcmTapRef = useRef<ScriptProcessorNode | null>(null);
  const pcmSinkRef = useRef<GainNode | null>(null);
  const pcmWavRef = useRef<Blob | null>(null);

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
      try { bufferSourceRef.current?.stop(); } catch { /* noop */ }
      try { bufferSourceRef.current?.disconnect(); } catch { /* noop */ }
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
    if (bufferSourceRef.current) {
      // stop() throws InvalidStateError if the source hasn't been started
      // yet (rare timing race). disconnect() is always safe.
      try { bufferSourceRef.current.stop(); } catch { /* not yet started */ }
      try { bufferSourceRef.current.disconnect(); } catch { /* noop */ }
      bufferSourceRef.current = null;
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

    // Decode the MP3 response directly into an AudioBuffer and play
    // it through the AudioContext. This is the Web Audio path — no
    // HTMLAudioElement involved — and it bypasses the per-element
    // autoplay gate that was blocking us. Because primeAudio() ran
    // inside the mic-tap gesture, the AudioContext is already
    // unlocked, so BufferSource.start() plays freely.
    let audioBuf: ArrayBuffer;
    try {
      audioBuf = await res.arrayBuffer();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Couldn't read audio";
      setError(msg);
      return { ok: false, error: msg };
    }
    if (audioBuf.byteLength < 200) {
      setError("Empty audio response");
      return { ok: false, error: "Empty audio response" };
    }

    const { ctx, analyser } = ensureAudioContext();
    // Resume context if a previous tab-throttle suspended it. Chrome
    // (and especially mobile Safari) suspends background contexts.
    // We try to revive it — but if the user's gesture activation has
    // expired (no clicks for a while), resume() silently fails and
    // ctx.state stays "suspended". A suspended context still ACCEPTS
    // src.start() calls but never advances currentTime, so the
    // BufferSource never produces sound AND its "ended" event never
    // fires — leaving isSpeaking stuck true forever. We surface a
    // clear error in that case so the UI can prompt the user to
    // tap the screen.
    if (ctx.state === "suspended") {
      try { await ctx.resume(); } catch { /* noop */ }
    }
    if (ctx.state === "suspended") {
      const msg = "Audio is blocked — tap anywhere on the page to enable";
      setError(msg);
      return { ok: false, error: msg };
    }

    // decodeAudioData mutates the ArrayBuffer in some browsers, so
    // we don't reuse audioBuf after this. MP3 decoding is supported
    // in all evergreen browsers via Web Audio.
    let decoded: AudioBuffer;
    try {
      decoded = await ctx.decodeAudioData(audioBuf);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Couldn't decode audio";
      setError(msg);
      return { ok: false, error: msg };
    }

    const src = ctx.createBufferSource();
    src.buffer = decoded;
    try { src.playbackRate.value = voiceRateRef.current; } catch { /* noop */ }
    src.connect(analyser);
    analyser.connect(ctx.destination);
    bufferSourceRef.current = src;
    speechClockRef.current = {
      ctx,
      basePos: 0,
      baseAt: ctx.currentTime,
      rate: voiceRateRef.current,
      duration: decoded.duration,
    };

    setIsSpeaking(true);
    const ended = new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        try { src.disconnect(); } catch { /* noop */ }
        if (bufferSourceRef.current === src) bufferSourceRef.current = null;
        speechClockRef.current = null;
        setIsSpeaking(false);
        resolve();
      };
      src.addEventListener("ended", finish, { once: true });
      // Safety net: if the AudioContext gets suspended mid-playback
      // (user switches tabs, OS sleeps mic) the "ended" event never
      // fires and isSpeaking stays true forever. The buffer's known
      // duration plus a 5-second slop is the maximum reasonable
      // playback time; after that we force-finish.
      const maxMs = Math.ceil((decoded.duration + 5) * 1000);
      window.setTimeout(finish, maxMs);
    });

    try {
      src.start(0);
    } catch (e) {
      // start() throws if the context is in a broken state — e.g.
      // closed by the user navigating away mid-fetch.
      const msg = e instanceof Error ? e.message : "Playback failed";
      setError(msg);
      setIsSpeaking(false);
      try { src.disconnect(); } catch { /* noop */ }
      bufferSourceRef.current = null;
      return { ok: false, error: msg };
    }

    return { ok: true, ended };
  }, [ensureAudioContext, stopSpeaking]);

  /** Set playback speed (1 / 1.2 / 1.5 / 2). Applies LIVE to the
   *  currently-playing utterance and to all future ones; keeps the
   *  caption clock honest across mid-utterance changes. */
  const setVoiceRate = useCallback((rate: number) => {
    const r = Math.min(2, Math.max(0.5, rate));
    // Re-anchor the clock at the current position BEFORE the rate
    // changes, so consumed-seconds stays continuous.
    const c = speechClockRef.current;
    if (c) {
      c.basePos = Math.min(c.duration, c.basePos + (c.ctx.currentTime - c.baseAt) * c.rate);
      c.baseAt = c.ctx.currentTime;
      c.rate = r;
    }
    voiceRateRef.current = r;
    try { localStorage.setItem("aurora-voice-rate", String(r)); } catch { /* private mode */ }
    const src = bufferSourceRef.current;
    if (src) {
      try { src.playbackRate.value = r; } catch { /* detached */ }
    }
  }, []);

  /** Seconds of the current utterance consumed + its total duration.
   *  Null when nothing is playing. Drives the karaoke captions. */
  const getSpeechProgress = useCallback((): { pos: number; duration: number } | null => {
    const c = speechClockRef.current;
    if (!c) return null;
    return {
      pos: Math.min(c.duration, c.basePos + (c.ctx.currentTime - c.baseAt) * c.rate),
      duration: c.duration,
    };
  }, []);

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
    micLabelRef.current = stream.getAudioTracks()[0]?.label ?? "";

    const mimeType = pickMimeType();
    let recorder: MediaRecorder;
    try {
      // 32 kbps opus — speech-transcription quality, ~4-8× smaller blobs
      // than the browser default. Smaller base64 POSTs are dramatically
      // less likely to die with Safari's "Load failed" while JARVIS mode
      // saturates the main thread, and a long ramble can no longer brush
      // the server's body-size cap.
      recorder = mimeType
        ? new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 32_000 })
        : new MediaRecorder(stream, { audioBitsPerSecond: 32_000 });
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
    // NO timeslice (was 250ms). Chunked recordings are only assembled
    // at stop anyway, and Safari's per-slice fragmented-mp4 output is
    // the prime suspect for the corrupted 2nd+ recordings. A single
    // finalized container at stop() is the most compatible shape a
    // MediaRecorder can produce.
    recorder.start();
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

        // Raw-PCM safety tap (see pcmChunksRef). ScriptProcessor is
        // deprecated but universally supported — and unlike an
        // AudioWorklet it needs no async module load. The zero-gain
        // sink keeps the node processing without echoing the mic to
        // the speakers. Capture is capped at ~2 minutes.
        pcmWavRef.current = null;
        pcmChunksRef.current = [];
        pcmRateRef.current = micCtx.sampleRate;
        try {
          const tap = micCtx.createScriptProcessor(4096, 1, 1);
          const sink = micCtx.createGain();
          sink.gain.value = 0;
          const maxSamples = micCtx.sampleRate * 120;
          let total = 0;
          tap.onaudioprocess = (ev) => {
            if (total >= maxSamples) return;
            const ch = ev.inputBuffer.getChannelData(0);
            pcmChunksRef.current.push(new Float32Array(ch));
            total += ch.length;
          };
          source.connect(tap);
          tap.connect(sink);
          sink.connect(micCtx.destination);
          pcmTapRef.current = tap;
          pcmSinkRef.current = sink;
        } catch {
          // No tap — transcribe simply has no PCM fallback this turn.
        }

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
    // PCM tap teardown + fallback WAV. Built BEFORE the context closes;
    // consumed by transcribe() when the MediaRecorder container turns
    // out to be corrupted.
    if (pcmTapRef.current) {
      try { pcmTapRef.current.onaudioprocess = null; } catch { /* noop */ }
      try { pcmTapRef.current.disconnect(); } catch { /* noop */ }
      pcmTapRef.current = null;
    }
    if (pcmSinkRef.current) {
      try { pcmSinkRef.current.disconnect(); } catch { /* noop */ }
      pcmSinkRef.current = null;
    }
    if (pcmChunksRef.current.length) {
      try {
        const chunks = pcmChunksRef.current;
        pcmChunksRef.current = [];
        let total = 0;
        for (const c of chunks) total += c.length;
        const all = new Float32Array(total);
        let off = 0;
        for (const c of chunks) {
          all.set(c, off);
          off += c.length;
        }
        pcmWavRef.current = encodeWav16k(resampleTo16k(all, pcmRateRef.current));
      } catch {
        pcmWavRef.current = null;
      }
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
    if (chunks.length === 0) {
      // Container produced nothing — hand over the raw-PCM capture
      // instead so the utterance isn't lost.
      const pcm = pcmWavRef.current;
      return pcm && pcm.size > 1024 ? pcm : null;
    }
    const mimeType = recorder.mimeType || chunks[0].type || "audio/webm";
    return new Blob(chunks, { type: mimeType });
  }, []);

  const transcribe = useCallback<UseVoiceResult["transcribe"]>(async (blob, languageCode) => {
    setError(null);
    setIsTranscribing(true);
    try {
      // A sub-kilobyte blob is a fraction of a second of audio — the
      // server would 400 it as "Empty audio". Skip the round-trip and
      // surface the human-readable version directly.
      if (blob.size < 1024) {
        const msg = "too short";
        setError(msg);
        return { ok: false, transcript: "", error: msg };
      }
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        const msg = "Sign in to use voice.";
        setError(msg);
        return { ok: false, transcript: "", error: msg };
      }
      // NORMALIZE TO WAV before upload. Production logs showed the
      // recurring "Transcription failed (HTTP 400)": the FIRST
      // utterance of a session transcribes fine, then ElevenLabs
      // rejects the 2nd+ as a CORRUPTED FILE — Safari/Chrome
      // MediaRecorder containers (esp. fragmented mp4) come out
      // malformed once TTS playback has run in between. Decoding in
      // the browser and re-encoding to 16 kHz mono PCM WAV gives the
      // server the same bulletproof bytes every time. If the local
      // decode itself fails, the capture is truly unusable — bail
      // without burning the round-trip and let the loop re-arm.
      let wav = blob.type === "audio/wav" ? blob : await blobToWav16k(blob);
      if (!wav) {
        // Container too corrupt to decode — fall back to the raw-PCM
        // capture taken in parallel off the mic graph.
        const pcm = pcmWavRef.current;
        if (pcm && pcm.size > 1024) wav = pcm;
      }
      if (!wav) {
        const msg = "audio glitched — say that again?";
        setError(msg);
        return { ok: false, transcript: "", error: msg };
      }
      const buf = await wav.arrayBuffer();
      const base64 = arrayBufferToBase64(buf);
      const mediaType = "audio/wav";
      const body = JSON.stringify({ audioBase64: base64, mediaType, languageCode });

      // The POST can fail at the NETWORK level (Safari "Load failed",
      // "Network error") when the connection blips or the main thread is
      // saturated — e.g. JARVIS mode running the camera + MediaPipe while
      // this fires. A transcribe is a one-shot the user can't easily
      // retry by re-speaking, so we retry the fetch TWICE on a thrown
      // (network) error with growing backoff. HTTP errors (4xx/5xx) are
      // NOT retried here — those come back as a normal response and are
      // surfaced below; only a failed-to-connect throw triggers the retry.
      const doFetch = () =>
        fetch(apiUrl(TRANSCRIBE_URL), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body,
        });

      let res: Response | null = null;
      let lastNetErr: unknown = null;
      for (let i = 0; i < 3 && !res; i++) {
        if (i > 0) await new Promise((r) => setTimeout(r, 600 * i));
        try {
          res = await doFetch();
        } catch (netErr) {
          lastNetErr = netErr;
        }
      }
      if (!res) throw lastNetErr; // all attempts failed → outer catch

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

  const startBargeInListener = useCallback<UseVoiceResult["startBargeInListener"]>(
    async ({ onDetected, threshold = 0.025, durationMs = 250 }) => {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        return null;
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
      } catch {
        return null;
      }
      let ctx: AudioContext | null = null;
      let source: MediaStreamAudioSourceNode | null = null;
      let analyser: AnalyserNode | null = null;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const AC: typeof AudioContext = (window.AudioContext || (window as any).webkitAudioContext);
        ctx = new AC();
        source = ctx.createMediaStreamSource(stream);
        analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.5;
        source.connect(analyser);
      } catch {
        try { stream.getTracks().forEach((t) => t.stop()); } catch { /* noop */ }
        try { void ctx?.close(); } catch { /* noop */ }
        return null;
      }

      const buf = new Float32Array(analyser.fftSize);
      let aboveSince: number | null = null;
      let stopped = false;
      let raf: number | null = null;

      const cleanup = () => {
        stopped = true;
        if (raf !== null) {
          cancelAnimationFrame(raf);
          raf = null;
        }
        try { source?.disconnect(); } catch { /* noop */ }
        try { void ctx?.close(); } catch { /* noop */ }
        try { stream.getTracks().forEach((t) => t.stop()); } catch { /* noop */ }
      };

      const tick = () => {
        if (stopped || !analyser) return;
        analyser.getFloatTimeDomainData(buf);
        let sumSq = 0;
        for (let i = 0; i < buf.length; i++) sumSq += buf[i] * buf[i];
        const rms = Math.sqrt(sumSq / buf.length);
        const now = performance.now();
        if (rms > threshold) {
          if (aboveSince === null) aboveSince = now;
          else if (now - aboveSince >= durationMs) {
            cleanup();
            try { onDetected(); } catch { /* swallow consumer errors */ }
            return;
          }
        } else {
          aboveSince = null;
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);

      return { stop: cleanup };
    },
    [],
  );

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
    startBargeInListener,
    error,
    analyserRef,
    micLabelRef,
    voiceRateRef,
    setVoiceRate,
    getSpeechProgress,
  };
}
