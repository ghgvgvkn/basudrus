/**
 * VitalsMode — "AI Vitals": experimental camera heart-rate + breathing check.
 *
 * Sit still, face in the circle, good light → the front camera watches the
 * tiny skin-color changes each heartbeat causes (rPPG, see rppg.ts) and
 * estimates heart rate + breathing rate in ~20 seconds. All processing is
 * on-device (mean color of a small face patch — no frame is ever uploaded).
 *
 * HONESTY REQUIREMENT: this is a wellness ESTIMATE for curiosity/fitness —
 * NOT a medical device, and the UI says so permanently. Estimates only show
 * once the signal confidence crosses a lock threshold; motion or darkness
 * resets the measurement instead of showing junk.
 *
 * Mirrors the StylistMode shape (props { onExit, speak, stopSpeaking }).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { RppgEngine, type VitalsEstimate } from "./rppg";
import "./vitals-mode.css";

interface VitalsModeProps {
  onExit: () => void;
  /** Speak a short line in Tony's voice (TTS). */
  speak: (text: string) => void;
  /** Stop any in-flight speech (on exit). */
  stopSpeaking?: () => void;
}

type CamStatus = "idle" | "loading" | "running" | "denied" | "error";

/** Measurement window the progress ring fills toward. */
const TARGET_S = 20;
/** Mean-green jump (0–255) between frames that reads as "you moved". */
const MOTION_JUMP = 7;
/** Minimum mean luma for a usable signal. */
const MIN_LUMA = 34;

export function VitalsMode({ onExit, speak, stopSpeaking }: VitalsModeProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [status, setStatus] = useState<CamStatus>("idle");
  const [attempt, setAttempt] = useState(0);

  const engineRef = useRef(new RppgEngine());
  const [est, setEst] = useState<VitalsEstimate>({ bpm: null, brpm: null, bpmConfidence: 0, seconds: 0 });
  const [hint, setHint] = useState<string>("Fit your face in the circle");
  const [locked, setLocked] = useState<{ bpm: number; brpm: number | null } | null>(null);

  const spokeRef = useRef(false);
  const stableRef = useRef<number[]>([]);

  // ── camera ──
  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    setStatus("loading");
    setLocked(null);
    spokeRef.current = false;
    stableRef.current = [];
    engineRef.current.reset();

    void (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus("error");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
          audio: false,
        });
      } catch (e) {
        if (!cancelled) {
          const name = (e as DOMException)?.name ?? "";
          setStatus(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "error");
        }
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      try {
        await video.play();
      } catch {
        /* muted+playsInline autoplay quirk */
      }
      if (!cancelled) setStatus("running");
    })();

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [attempt]);

  // ── sampling loop: mean green of the face patch → engine ──
  useEffect(() => {
    if (status !== "running") return;
    let raf = 0;
    let lastG = -1;
    let lastUi = 0;
    const off = document.createElement("canvas");
    off.width = 48;
    off.height = 48;
    const octx = off.getContext("2d", { willReadFrequently: true });

    const loop = () => {
      const video = videoRef.current;
      const now = performance.now();
      if (video && octx && video.readyState >= 2) {
        const vw = video.videoWidth || 640;
        const vh = video.videoHeight || 480;
        // Face patch: the guide circle sits at (0.5, 0.42) of the frame;
        // sample a square inscribed in it (~26% of the min dimension).
        const side = Math.min(vw, vh) * 0.26;
        const sx = vw * 0.5 - side / 2;
        const sy = vh * 0.42 - side / 2;
        try {
          octx.drawImage(video, sx, sy, side, side, 0, 0, 48, 48);
          const px = octx.getImageData(0, 0, 48, 48).data;
          let g = 0;
          let luma = 0;
          const count = px.length / 4;
          for (let i = 0; i < px.length; i += 4) {
            g += px[i + 1];
            luma += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
          }
          g /= count;
          luma /= count;

          if (luma < MIN_LUMA) {
            setHint("Too dark — face a light source");
            engineRef.current.reset();
            lastG = -1;
          } else if (lastG >= 0 && Math.abs(g - lastG) > MOTION_JUMP) {
            setHint("Hold still…");
            engineRef.current.reset();
          } else {
            engineRef.current.addSample(g, now);
          }
          lastG = g;
        } catch {
          /* drawImage can throw on a mid-teardown video — skip the frame */
        }
      }

      // UI sync ~2×/sec: estimate + stability lock + voice.
      if (now - lastUi > 500) {
        lastUi = now;
        const e = engineRef.current.estimate();
        setEst(e);
        if (e.seconds >= 3 && lastG >= 0) {
          setHint(e.bpm ? "Locked on — keep steady" : "Measuring… keep steady");
        }
        if (e.bpm != null) {
          const s = stableRef.current;
          s.push(e.bpm);
          if (s.length > 3) s.shift();
          const stable = s.length === 3 && Math.max(...s) - Math.min(...s) <= 4;
          if (stable && !spokeRef.current) {
            spokeRef.current = true;
            const bpm = Math.round((s[0] + s[1] + s[2]) / 3);
            setLocked({ bpm, brpm: e.brpm });
            try {
              speak(`Estimated heart rate: ${bpm} beats per minute.`);
            } catch {
              /* TTS optional */
            }
          } else if (spokeRef.current) {
            // keep the locked card fresh as estimates refine
            setLocked((prev) => (prev ? { bpm: e.bpm ?? prev.bpm, brpm: e.brpm ?? prev.brpm } : prev));
          }
        } else {
          stableRef.current = [];
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [status, speak]);

  const restart = useCallback(() => {
    engineRef.current.reset();
    stableRef.current = [];
    spokeRef.current = false;
    setLocked(null);
    setEst({ bpm: null, brpm: null, bpmConfidence: 0, seconds: 0 });
    setHint("Fit your face in the circle");
  }, []);

  const handleExit = () => {
    try {
      stopSpeaking?.();
    } catch {
      /* noop */
    }
    onExit();
  };

  const progress = Math.max(0, Math.min(1, est.seconds / TARGET_S));
  const ringStyle = { "--vit-progress": `${Math.round(progress * 360)}deg` } as React.CSSProperties;

  return (
    <div className="vit-root">
      <video ref={videoRef} className="vit-video" muted playsInline autoPlay />
      <div className="vit-scrim" />

      {/* top bar */}
      <div className="vit-topbar">
        <div className="vit-brand">
          <span className="vit-dot" /> AI Vitals
        </div>
        <button className="vit-icon" onClick={handleExit} title="Exit" aria-label="Exit AI Vitals">
          ✕
        </button>
      </div>

      {status === "running" && (
        <>
          {/* face guide + progress ring */}
          <div className="vit-guide" style={ringStyle}>
            <div className="vit-guide-ring" />
          </div>

          {/* live readout */}
          <div className="vit-panel">
            {locked ? (
              <>
                <div className="vit-bpm">
                  <span className="vit-bpm-num">{locked.bpm}</span>
                  <span className="vit-bpm-unit">bpm ♥</span>
                </div>
                {locked.brpm != null && (
                  <div className="vit-breath">Breathing ≈ {locked.brpm} / min</div>
                )}
                <div className="vit-hint">Estimate locked — {hint.toLowerCase()}</div>
              </>
            ) : (
              <>
                <div className="vit-measuring">
                  {est.seconds < 1 ? "—" : `${Math.min(TARGET_S, Math.round(est.seconds))}s`}
                  <span className="vit-measuring-sub"> / {TARGET_S}s</span>
                </div>
                <div className="vit-hint">{hint}</div>
              </>
            )}
            <div className="vit-disclaimer">
              Experimental camera estimate — NOT a medical device. For any health concern, see a professional.
            </div>
            <div className="vit-actions">
              <button className="vit-btn-ghost" onClick={restart}>Restart</button>
              <button className="vit-btn-ghost" onClick={handleExit}>Done</button>
            </div>
          </div>
        </>
      )}

      {(status === "loading" || status === "idle") && (
        <div className="vit-state">
          <div className="vit-spinner" />
          <div className="vit-state-title">Starting the camera…</div>
          <div className="vit-state-sub">Everything runs on your device. No photo or video is uploaded.</div>
        </div>
      )}
      {status === "denied" && (
        <div className="vit-state">
          <div className="vit-state-title">Camera needed</div>
          <div className="vit-state-sub">Allow camera access so Tony can read the tiny color changes your pulse makes.</div>
          <button className="vit-cta" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
          <button className="vit-cta vit-cta-ghost" onClick={handleExit}>Exit</button>
        </div>
      )}
      {status === "error" && (
        <div className="vit-state">
          <div className="vit-state-title">Camera hiccup</div>
          <div className="vit-state-sub">Something interrupted the camera.</div>
          <button className="vit-cta" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
          <button className="vit-cta vit-cta-ghost" onClick={handleExit}>Exit</button>
        </div>
      )}
    </div>
  );
}
