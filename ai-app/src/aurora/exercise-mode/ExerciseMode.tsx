/**
 * ExerciseMode — the AI Exercise coach (full-screen camera takeover).
 *
 * Tony watches you through the webcam, runs you through a guided routine
 * (squats → push-ups → lunges → plank), counts your reps / times your hold,
 * checks your form, and coaches you OUT LOUD (his voice) + on screen.
 *
 * Architecture:
 *   - usePoseTracking(true): webcam + MediaPipe pose (33 body points), ref-based.
 *   - ONE rAF loop draws the live skeleton every frame and, while a set is
 *     "active", runs the rep counter / hold timer + form checks. Per-frame work
 *     is canvas + refs (no React re-renders); only low-frequency values
 *     (rep count, cue, stage) touch React state.
 *   - A small stage machine (intro → countdown → active → rest → … → done)
 *     drives the guided routine via timer effects.
 *
 * Privacy: pose frames never leave the device (usePoseTracking has no upload
 * path). Only the visible coaching is computed here.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { usePoseTracking, type PoseFrame } from "./usePoseTracking";
import { avgVisibility } from "./angles";
import { POSE_BONES, POSE_JOINTS } from "./poseConstants";
import {
  EXERCISES,
  DEFAULT_ROUTINE,
  type ExerciseDef,
  type Landmarks,
} from "./exercises";
import { createRepCounter, type RepCounter } from "./repCounter";
import "./exercise-mode.css";

interface ExerciseModeProps {
  onExit: () => void;
  /** Speak a short coaching line in Tony's voice (TTS). */
  speak: (text: string) => void;
  /** Stop any in-flight speech (on exit / mute). */
  stopSpeaking?: () => void;
}

type Stage = "intro" | "countdown" | "active" | "rest" | "done";

const ROUTINE = DEFAULT_ROUTINE;
/** Min ms between spoken form cues so corrections don't stutter. */
const CUE_THROTTLE_MS = 4000;

export function ExerciseMode({ onExit, speak, stopSpeaking }: ExerciseModeProps) {
  const pose = usePoseTracking(true);
  const { videoRef, landmarksRef, status } = pose;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // ── React state (low-frequency only) ──
  const [started, setStarted] = useState(false);
  const [stage, setStage] = useState<Stage>("intro");
  const [stepIndex, setStepIndex] = useState(0);
  const [reps, setReps] = useState(0);
  const [holdSec, setHoldSec] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const [restLeft, setRestLeft] = useState(0);
  const [cue, setCue] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [totalReps, setTotalReps] = useState(0);

  const step = ROUTINE[stepIndex];
  const exercise: ExerciseDef = EXERCISES[step.id];
  const target = exercise.kind === "rep" ? step.reps ?? 0 : step.seconds ?? 0;

  // ── refs the long-lived rAF reads without re-subscribing ──
  const stageRef = useRef(stage);
  stageRef.current = stage;
  const stepIndexRef = useRef(stepIndex);
  stepIndexRef.current = stepIndex;
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  const repCounterRef = useRef<RepCounter | null>(null);
  const holdMsRef = useRef(0);
  const lastNowRef = useRef(0);
  const stepDoneRef = useRef(false);
  const lastSpokenRepRef = useRef(0);
  const lastCueRef = useRef<string | null>(null);
  const lastCueAtRef = useRef(0);
  const flashRef = useRef(0); // rep-pulse timer
  // De-dupe React state writes from the per-frame loop (no render storms).
  const displayedCueRef = useRef<string | null>(null);
  const displayedHoldRef = useRef(-1);

  const speakSafe = useCallback(
    (t: string) => {
      if (!mutedRef.current) speak(t);
    },
    [speak],
  );

  // Set the on-screen cue ONLY when it actually changes (the loop runs ~30fps).
  const showCue = useCallback((text: string | null) => {
    if (displayedCueRef.current === text) return;
    displayedCueRef.current = text;
    setCue(text);
  }, []);

  // ── completion: called from the rAF when a set's target is reached ──
  const completeStep = useCallback(() => {
    if (stepDoneRef.current) return;
    stepDoneRef.current = true;
    const idx = stepIndexRef.current;
    const ex = EXERCISES[ROUTINE[idx].id];
    if (ex.kind === "rep") {
      speakSafe(`Nice! That's ${ROUTINE[idx].reps}.`);
    } else {
      speakSafe(`Time! ${ROUTINE[idx].seconds} second hold. Strong.`);
    }
    if (idx + 1 >= ROUTINE.length) {
      setStage("done");
    } else {
      setStage("rest");
    }
  }, [speakSafe]);

  // keep a stable ref to completeStep for the rAF
  const completeStepRef = useRef(completeStep);
  completeStepRef.current = completeStep;

  // ── begin a set (called when entering "active") ──
  const startActive = useCallback(() => {
    const ex = EXERCISES[ROUTINE[stepIndexRef.current].id];
    stepDoneRef.current = false;
    lastSpokenRepRef.current = 0;
    holdMsRef.current = 0;
    lastNowRef.current = 0;
    lastCueRef.current = null;
    displayedCueRef.current = null;
    displayedHoldRef.current = -1;
    setReps(0);
    setHoldSec(0);
    setCue(null);
    repCounterRef.current = ex.kind === "rep" && ex.rep ? createRepCounter(ex.rep) : null;
  }, []);

  // ════════════ the single rAF loop (draw + count) ════════════
  useEffect(() => {
    let raf = 0;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d") ?? null;

    const resize = () => {
      if (!canvas) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
    };
    resize();
    window.addEventListener("resize", resize);

    const loop = () => {
      const now = performance.now();
      const frame: PoseFrame = landmarksRef.current;
      const lm = frame.landmarks as Landmarks | null;

      if (ctx && canvas) drawSkeleton(ctx, canvas, lm, videoRef.current, flashRef);

      if (stageRef.current === "active" && !stepDoneRef.current) {
        const ex = EXERCISES[ROUTINE[stepIndexRef.current].id];
        const dt = lastNowRef.current ? now - lastNowRef.current : 0;
        lastNowRef.current = now;

        const visible =
          lm && avgVisibility(ex.requiredJoints.map((i) => lm[i])) > 0.55;

        if (!visible) {
          showCue("Step back so I can see your whole body");
          maybeCue("Step back so I can see your whole body", now);
        } else if (ex.kind === "rep" && ex.rep && repCounterRef.current) {
          const angle = ex.rep.measure(lm);
          const st = repCounterRef.current.update(angle, now);
          if (st.justCompleted) {
            flashRef.current = now;
            // Form check on the completed rep — a fault cue takes priority
            // over the spoken count (speak() is last-wins, so never both).
            let faultCue: string | null = null;
            for (const f of ex.form) {
              const c = f.evaluate({ lm, measure: angle, minAngle: st.minAngle });
              if (c) { faultCue = c; break; }
            }
            setReps(st.reps);
            if (faultCue) {
              showCue(faultCue);
              maybeCue(faultCue, now, true);
            } else {
              showCue(null);
              speakSafe(String(st.reps));
            }
            lastSpokenRepRef.current = st.reps;
            if (st.reps >= (ROUTINE[stepIndexRef.current].reps ?? 0)) {
              completeStepRef.current();
            }
          }
        } else if (ex.kind === "hold" && ex.hold) {
          if (ex.hold.inPosition(lm)) {
            holdMsRef.current += dt;
            const sec = Math.floor(holdMsRef.current / 1000);
            if (sec !== displayedHoldRef.current) {
              displayedHoldRef.current = sec;
              setHoldSec(sec);
            }
            showCue(ex.hold.cue(lm));
            const targetSec = ROUTINE[stepIndexRef.current].seconds ?? 0;
            // Encourage at the halfway mark.
            if (sec === Math.floor(targetSec / 2) && lastSpokenRepRef.current < sec) {
              lastSpokenRepRef.current = sec;
              speakSafe("Halfway, hold strong");
            }
            if (sec >= targetSec) completeStepRef.current();
          } else {
            showCue("Get into a straight plank");
            maybeCue("Get into a straight plank", now);
          }
        }
      } else {
        lastNowRef.current = now;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Throttled spoken cue (form fault / framing). `force` bypasses the
  // same-text check (used for a fresh rep's fault).
  const maybeCue = (text: string, now: number, force = false) => {
    if (!force && text === lastCueRef.current && now - lastCueAtRef.current < CUE_THROTTLE_MS) return;
    if (now - lastCueAtRef.current < CUE_THROTTLE_MS && !force) return;
    lastCueRef.current = text;
    lastCueAtRef.current = now;
    speakSafe(text);
  };

  // ── kick off the routine once the camera is live ──
  useEffect(() => {
    if (status === "running" && !started) {
      setStarted(true);
      setStage("intro");
    }
  }, [status, started]);

  // ── stage timers ──
  useEffect(() => {
    if (!started || stage !== "intro") return;
    speakSafe(exercise.intro);
    const t = setTimeout(() => setStage("countdown"), 2600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, stepIndex, started]);

  useEffect(() => {
    if (stage !== "countdown") return;
    let n = 3;
    setCountdown(n);
    speakSafe(String(n));
    const iv = setInterval(() => {
      n -= 1;
      if (n <= 0) {
        clearInterval(iv);
        setCountdown(0);
        speakSafe("Go!");
        startActive();
        setStage("active");
      } else {
        setCountdown(n);
        speakSafe(String(n));
      }
    }, 1000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  useEffect(() => {
    if (stage !== "rest") return;
    let left = ROUTINE[stepIndex].rest;
    setRestLeft(left);
    if (left <= 0) {
      goNextStep();
      return;
    }
    speakSafe(`Rest. ${left} seconds.`);
    const iv = setInterval(() => {
      left -= 1;
      setRestLeft(left);
      if (left <= 0) {
        clearInterval(iv);
        goNextStep();
      }
    }, 1000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, stepIndex]);

  // accumulate totals when a rep step ends
  useEffect(() => {
    if (stage === "rest" || stage === "done") {
      setTotalReps((t) => t + reps);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  const goNextStep = () => {
    if (stepIndex + 1 >= ROUTINE.length) {
      setStage("done");
      return;
    }
    setStepIndex((i) => i + 1);
    setStage("intro");
  };

  const restart = () => {
    setTotalReps(0);
    setReps(0);
    setStepIndex(0);
    setStage("intro");
  };

  const handleExit = () => {
    try {
      stopSpeaking?.();
    } catch {
      /* noop */
    }
    onExit();
  };

  // ── render ──
  const loading = status === "loading" || status === "idle";
  const denied = status === "denied" || status === "unsupported";
  const errored = status === "error";

  return (
    <div className="exr-root">
      <video ref={videoRef} className="exr-video" muted playsInline autoPlay />
      <canvas ref={canvasRef} className="exr-canvas" />
      <div className="exr-dim" />

      {/* Top bar: routine progress + controls */}
      <div className="exr-topbar">
        <div className="exr-progress">
          {ROUTINE.map((s, i) => (
            <span
              key={i}
              className={`exr-dot ${i === stepIndex ? "is-current" : ""} ${i < stepIndex || stage === "done" ? "is-done" : ""}`}
              title={EXERCISES[s.id].name}
            >
              {EXERCISES[s.id].emoji}
            </span>
          ))}
        </div>
        <div className="exr-controls">
          <button className="exr-btn" onClick={() => setMuted((m) => !m)} title={muted ? "Unmute Tony" : "Mute Tony"}>
            {muted ? "🔇" : "🔊"}
          </button>
          {pose.cameraCount > 1 && (
            <button className="exr-btn" onClick={pose.cycleCamera} title={pose.cameraLabel || "Switch camera"}>
              ⟳
            </button>
          )}
          {stage === "active" && (
            <button className="exr-btn" onClick={() => completeStepRef.current()} title="Skip this exercise">
              ⏭
            </button>
          )}
          <button className="exr-btn exr-btn-exit" onClick={handleExit} title="Exit">
            ✕ Exit
          </button>
        </div>
      </div>

      {/* Main HUD */}
      {!loading && !denied && !errored && stage !== "done" && (
        <div className="exr-hud">
          <div className="exr-ex-name">
            <span className="exr-ex-emoji">{exercise.emoji}</span> {exercise.name}
          </div>

          {stage === "countdown" && countdown > 0 && (
            <div className="exr-countdown">{countdown}</div>
          )}

          {stage === "active" && exercise.kind === "rep" && (
            <div className="exr-bignum-wrap">
              <div className="exr-bignum">{reps}</div>
              <div className="exr-bignum-sub">of {target} reps</div>
            </div>
          )}
          {stage === "active" && exercise.kind === "hold" && (
            <div className="exr-bignum-wrap">
              <div className="exr-bignum">{holdSec}s</div>
              <div className="exr-bignum-sub">hold {target}s</div>
            </div>
          )}

          {stage === "rest" && (
            <div className="exr-bignum-wrap">
              <div className="exr-bignum">{restLeft}</div>
              <div className="exr-bignum-sub">rest — next: {EXERCISES[ROUTINE[Math.min(stepIndex + 1, ROUTINE.length - 1)].id].name}</div>
            </div>
          )}

          {(stage === "intro" || stage === "countdown") && (
            <div className="exr-hint">{exercise.setupHint}</div>
          )}

          {cue && stage === "active" && <div className="exr-cue">{cue}</div>}
        </div>
      )}

      {/* States */}
      {loading && (
        <div className="exr-overlay">
          <div className="exr-spinner" />
          <div className="exr-overlay-title">Warming up the camera…</div>
          <div className="exr-overlay-sub">Tony is getting ready to watch your form.</div>
        </div>
      )}
      {denied && (
        <div className="exr-overlay">
          <div className="exr-overlay-title">Camera needed</div>
          <div className="exr-overlay-sub">Allow camera access so Tony can see your movement, then try again.</div>
          <button className="exr-cta" onClick={pose.retry}>Try again</button>
          <button className="exr-cta exr-cta-ghost" onClick={handleExit}>Exit</button>
        </div>
      )}
      {errored && (
        <div className="exr-overlay">
          <div className="exr-overlay-title">Camera hiccup</div>
          <div className="exr-overlay-sub">Something interrupted the camera.</div>
          <button className="exr-cta" onClick={pose.retry}>Try again</button>
          <button className="exr-cta exr-cta-ghost" onClick={handleExit}>Exit</button>
        </div>
      )}
      {stage === "done" && (
        <div className="exr-overlay">
          <div className="exr-done-emoji">🎉</div>
          <div className="exr-overlay-title">Workout complete!</div>
          <div className="exr-overlay-sub">
            {totalReps + reps} reps across {ROUTINE.length} exercises. Great work — same time tomorrow?
          </div>
          <button className="exr-cta" onClick={restart}>Go again</button>
          <button className="exr-cta exr-cta-ghost" onClick={handleExit}>Done</button>
        </div>
      )}
    </div>
  );
}

// ════════════ canvas skeleton drawing ════════════

/** object-fit: cover mapping — normalized video coords → canvas pixels. */
function coverMap(
  nx: number,
  ny: number,
  vidW: number,
  vidH: number,
  cw: number,
  ch: number,
): [number, number] {
  const scale = Math.max(cw / vidW, ch / vidH);
  const dispW = vidW * scale;
  const dispH = vidH * scale;
  const offX = (cw - dispW) / 2;
  const offY = (ch - dispH) / 2;
  return [offX + nx * dispW, offY + ny * dispH];
}

function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  lm: Landmarks | null,
  video: HTMLVideoElement | null,
  flashRef: React.MutableRefObject<number>,
) {
  const cw = canvas.width;
  const ch = canvas.height;
  ctx.clearRect(0, 0, cw, ch);
  if (!lm) return;

  const vidW = video?.videoWidth || 640;
  const vidH = video?.videoHeight || 480;

  // Rep-pulse: brighten the skeleton briefly when a rep lands.
  const sinceFlash = performance.now() - flashRef.current;
  const flash = sinceFlash < 320 ? 1 - sinceFlash / 320 : 0;
  const accent = `rgba(${Math.round(110 + 60 * flash)}, ${Math.round(200 + 40 * flash)}, 255, ${0.85})`;
  const glow = `rgba(120, 210, 255, ${0.35 + 0.45 * flash})`;

  ctx.lineWidth = Math.max(3, cw * 0.004);
  ctx.lineCap = "round";
  ctx.strokeStyle = accent;
  ctx.shadowColor = glow;
  ctx.shadowBlur = 14 + 18 * flash;

  for (const [a, b] of POSE_BONES) {
    const pa = lm[a];
    const pb = lm[b];
    if (!pa || !pb) continue;
    if ((pa.visibility ?? 1) < 0.4 || (pb.visibility ?? 1) < 0.4) continue;
    const [ax, ay] = coverMap(pa.x, pa.y, vidW, vidH, cw, ch);
    const [bx, by] = coverMap(pb.x, pb.y, vidW, vidH, cw, ch);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  }

  ctx.shadowBlur = 0;
  const r = Math.max(4, cw * 0.005);
  for (const i of POSE_JOINTS) {
    const p = lm[i];
    if (!p || (p.visibility ?? 1) < 0.4) continue;
    const [px, py] = coverMap(p.x, p.y, vidW, vidH, cw, ch);
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.fill();
  }
}
