/**
 * StudySessionModal — Day 18 — solo focused study session.
 *
 * Three phases:
 *   1. Setup     — subject + goal + duration
 *   2. Active    — Pomodoro timer (25 min focus / 5 min break / repeat)
 *   3. Summary   — elapsed time, focus blocks completed, celebrate
 *
 * Design intent: a student can chat with Omar normally during a
 * session — the system prompt knows they're in focus mode (more
 * structured, less playful, gentle redirect on off-topic). When the
 * timer hits zero on a focus block, a soft break notification fires;
 * the student can take 5 then come back, or end the session.
 *
 * No persistence in v1 — sessions live in component state. Adding a
 * `study_sessions` table (history + analytics + streak interplay) is
 * a Day 18.5 if usage warrants it.
 */
import { useEffect, useRef, useState } from "react";
import {
  X, Play, Pause, Square, Coffee, Target, Check, ArrowLeft,
} from "lucide-react";

export type SessionPhase =
  | { kind: "setup" }
  | {
      kind: "active";
      subject: string;
      goal: string;
      totalDurationMin: number;
      startedAt: number;        // ms since epoch
      currentBlock: "focus" | "break";
      blockStartedAt: number;   // ms since epoch
      paused: boolean;
      pausedAtElapsedMs: number; // total elapsed at pause moment (used to resume cleanly)
      focusBlocksCompleted: number;
    }
  | {
      kind: "summary";
      subject: string;
      goal: string;
      totalElapsedMin: number;
      focusBlocksCompleted: number;
    };

const FOCUS_BLOCK_MIN = 25;
const BREAK_BLOCK_MIN = 5;

interface Props {
  /** When set, the modal opens directly into the active phase using
   *  this state — used when the user reopens a session-in-progress. */
  initialPhase?: SessionPhase;
  /** Called whenever the modal is closed (by X, by Done, by End). */
  onClose: () => void;
  /** Called when a session enters / leaves the active phase OR phase
   *  data changes (timer ticks, block transitions). The parent uses
   *  this to drive the "in focus mode" banner + pass context to the
   *  AI on each message send. */
  onPhaseChange?: (phase: SessionPhase | null) => void;
}

export function StudySessionModal({ initialPhase, onClose, onPhaseChange }: Props) {
  const [phase, setPhase] = useState<SessionPhase>(initialPhase ?? { kind: "setup" });
  // tick state — re-render every second when active so the timer
  // text updates. Doesn't store time itself; computed from
  // phase.startedAt to avoid drift.
  const [, setTick] = useState(0);

  // Surface phase changes upward.
  useEffect(() => {
    onPhaseChange?.(phase);
  }, [phase, onPhaseChange]);

  // Tick every second when active + not paused.
  useEffect(() => {
    if (phase.kind !== "active" || phase.paused) return;
    const t = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [phase.kind, phase.kind === "active" ? phase.paused : false]);

  // Auto-transition focus → break and break → focus when blocks complete.
  useEffect(() => {
    if (phase.kind !== "active" || phase.paused) return;
    const blockLenMs = (phase.currentBlock === "focus" ? FOCUS_BLOCK_MIN : BREAK_BLOCK_MIN) * 60_000;
    const elapsedInBlock = Date.now() - phase.blockStartedAt;
    if (elapsedInBlock < blockLenMs) return;
    // Block complete — flip.
    setPhase({
      ...phase,
      currentBlock: phase.currentBlock === "focus" ? "break" : "focus",
      blockStartedAt: Date.now(),
      focusBlocksCompleted:
        phase.currentBlock === "focus" ? phase.focusBlocksCompleted + 1 : phase.focusBlocksCompleted,
    });
    // Soft notification — vibration on mobile, no sound to avoid
    // surprises. The phase change visually communicates the switch.
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      try { (navigator as Navigator & { vibrate: (p: number | number[]) => boolean }).vibrate?.([120, 60, 120]); } catch { /* ignore */ }
    }
  });

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[100] bg-bg flex flex-col"
    >
      <div className="flex items-center justify-between px-4 md:px-6 py-3 border-b border-ink/8 bg-bg/95 backdrop-blur">
        <div className="inline-flex items-center gap-2 text-[13px] text-ink/70">
          <Target size={14} className="text-[#5B4BF5]" />
          <span className="font-medium">Focus session</span>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="w-9 h-9 rounded-full inline-flex items-center justify-center text-ink/55 hover:text-ink hover:bg-ink/5 transition"
        >
          <X size={18} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {phase.kind === "setup" && (
          <SetupPhase
            onStart={(subject, goal, durationMin) => {
              setPhase({
                kind: "active",
                subject, goal,
                totalDurationMin: durationMin,
                startedAt: Date.now(),
                currentBlock: "focus",
                blockStartedAt: Date.now(),
                paused: false,
                pausedAtElapsedMs: 0,
                focusBlocksCompleted: 0,
              });
            }}
          />
        )}
        {phase.kind === "active" && (
          <ActivePhase
            phase={phase}
            onPause={() => {
              if (phase.paused) return;
              setPhase({
                ...phase,
                paused: true,
                pausedAtElapsedMs: Date.now() - phase.blockStartedAt,
              });
            }}
            onResume={() => {
              if (!phase.paused) return;
              // Shift blockStartedAt forward by the pause duration so
              // the elapsed-in-block counter resumes from where we paused.
              setPhase({
                ...phase,
                paused: false,
                blockStartedAt: Date.now() - phase.pausedAtElapsedMs,
                pausedAtElapsedMs: 0,
              });
            }}
            onEnd={() => {
              const totalMs = Date.now() - phase.startedAt;
              setPhase({
                kind: "summary",
                subject: phase.subject,
                goal: phase.goal,
                totalElapsedMin: Math.round(totalMs / 60_000),
                focusBlocksCompleted: phase.focusBlocksCompleted + (phase.currentBlock === "focus" ? 1 : 0),
              });
            }}
          />
        )}
        {phase.kind === "summary" && (
          <SummaryPhase phase={phase} onClose={onClose} />
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Phase 1 — Setup
// ─────────────────────────────────────────────────────────────────

const DURATION_PRESETS = [25, 45, 60, 90] as const;

function SetupPhase({ onStart }: { onStart: (subject: string, goal: string, durationMin: number) => void }) {
  const [subject, setSubject] = useState("");
  const [goal, setGoal] = useState("");
  const [duration, setDuration] = useState<number>(45);
  const subjectRef = useRef<HTMLInputElement>(null);

  // Autofocus subject on mount so the student can type immediately.
  useEffect(() => {
    subjectRef.current?.focus();
  }, []);

  const canStart = subject.trim().length > 0 && goal.trim().length > 0;

  return (
    <div className="max-w-xl mx-auto px-5 md:px-6 py-8 md:py-12">
      <h1 className="font-serif italic text-3xl md:text-4xl text-ink leading-tight">
        What are you focusing on?
      </h1>
      <p className="mt-3 text-[15px] text-ink/65 leading-relaxed">
        Set the subject and goal. I'll start a Pomodoro timer ({FOCUS_BLOCK_MIN}-min focus blocks with {BREAK_BLOCK_MIN}-min breaks). Chat with me during the session — I'll stay in focus mode and help you stay on track.
      </p>

      <div className="mt-7 space-y-4">
        <Field label="Subject">
          <input
            ref={subjectRef}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="e.g. Calc II, Algorithms, Arabic Lit"
            maxLength={80}
            className="w-full h-11 px-3.5 rounded-xl border border-ink/15 focus:border-ink/40 bg-bg text-ink placeholder:text-ink/40 outline-none transition"
          />
        </Field>
        <Field label="What you'll work on">
          <input
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="e.g. Past papers Ch 3-5, finish problem set 4"
            maxLength={200}
            className="w-full h-11 px-3.5 rounded-xl border border-ink/15 focus:border-ink/40 bg-bg text-ink placeholder:text-ink/40 outline-none transition"
          />
        </Field>
        <Field label="Total duration">
          <div className="flex flex-wrap gap-2">
            {DURATION_PRESETS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDuration(d)}
                className={
                  "h-10 px-4 rounded-full border text-[13.5px] font-medium transition active:scale-95 " +
                  (duration === d
                    ? "bg-[#5B4BF5] border-[#5B4BF5] text-white"
                    : "bg-bg border-ink/12 text-ink/75 hover:bg-ink/5 hover:text-ink")
                }
              >
                {d} min
              </button>
            ))}
          </div>
        </Field>
      </div>

      <button
        type="button"
        disabled={!canStart}
        onClick={() => onStart(subject.trim(), goal.trim(), duration)}
        className="mt-8 w-full h-12 rounded-full bg-ink text-bg font-medium text-[14.5px] inline-flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-default active:scale-[0.99]"
      >
        <Play size={16} /> Start session
      </button>

      <p className="mt-6 text-[12px] text-ink/45 leading-relaxed">
        You can pause, resume, or end early at any time. The session is private — no friends, no notifications, just you and the work.
      </p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[12px] uppercase tracking-wider text-ink/55 font-semibold mb-1.5">{label}</span>
      {children}
    </label>
  );
}

// ─────────────────────────────────────────────────────────────────
// Phase 2 — Active session with timer
// ─────────────────────────────────────────────────────────────────

function ActivePhase({
  phase, onPause, onResume, onEnd,
}: {
  phase: Extract<SessionPhase, { kind: "active" }>;
  onPause: () => void;
  onResume: () => void;
  onEnd: () => void;
}) {
  const blockLenMs = (phase.currentBlock === "focus" ? FOCUS_BLOCK_MIN : BREAK_BLOCK_MIN) * 60_000;
  // When paused, freeze at pausedAtElapsedMs. When active, compute live.
  const elapsedInBlockMs = phase.paused
    ? phase.pausedAtElapsedMs
    : Math.max(0, Math.min(blockLenMs, Date.now() - phase.blockStartedAt));
  const remainingMs = Math.max(0, blockLenMs - elapsedInBlockMs);
  const remainingMin = Math.floor(remainingMs / 60_000);
  const remainingSec = Math.floor((remainingMs % 60_000) / 1000);
  const totalElapsedMin = Math.floor((Date.now() - phase.startedAt) / 60_000);
  const isFocus = phase.currentBlock === "focus";

  // Progress ring — 0 to 1 representing how much of the block is complete.
  const progress = blockLenMs > 0 ? elapsedInBlockMs / blockLenMs : 0;

  return (
    <div className="max-w-md mx-auto px-5 md:px-6 py-6 md:py-8 text-center">
      {/* Block label */}
      <div className={
        "inline-flex items-center gap-2 px-3 h-7 rounded-full text-[11.5px] font-semibold uppercase tracking-wider " +
        (isFocus ? "bg-[#5B4BF5]/12 text-[#5B4BF5]" : "bg-amber-500/15 text-amber-700")
      }>
        {isFocus ? <Target size={11} /> : <Coffee size={11} />}
        {isFocus ? "Focus block" : "Break"}
      </div>

      {/* Big timer */}
      <div className="mt-8 relative inline-block">
        {/* Progress ring SVG */}
        <svg width={220} height={220} className="-rotate-90">
          <circle
            cx={110} cy={110} r={96}
            fill="none"
            strokeWidth={8}
            className="stroke-ink/8"
          />
          <circle
            cx={110} cy={110} r={96}
            fill="none"
            strokeWidth={8}
            strokeLinecap="round"
            stroke={isFocus ? "#5B4BF5" : "#E8743B"}
            strokeDasharray={2 * Math.PI * 96}
            strokeDashoffset={2 * Math.PI * 96 * (1 - progress)}
            style={{ transition: "stroke-dashoffset 1s linear" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="font-serif italic text-5xl md:text-6xl text-ink tabular-nums leading-none">
            {String(remainingMin).padStart(2, "0")}:{String(remainingSec).padStart(2, "0")}
          </div>
          <div className="mt-1 text-[12px] text-ink/55">
            {isFocus ? "remaining in this focus block" : "break time"}
          </div>
        </div>
      </div>

      {/* Goal reminder */}
      <div className="mt-8 max-w-sm mx-auto">
        <div className="text-[11px] uppercase tracking-wider text-ink/45 font-semibold">Goal</div>
        <div className="mt-1 text-[15px] font-semibold text-ink">{phase.subject}</div>
        <div className="mt-0.5 text-[13.5px] text-ink/65 leading-snug">{phase.goal}</div>
      </div>

      {/* Total session stats */}
      <div className="mt-6 flex items-center justify-center gap-5 text-[12.5px] text-ink/60">
        <span><span className="font-bold text-ink tabular-nums">{totalElapsedMin}</span> min total</span>
        <span><span className="font-bold text-ink tabular-nums">{phase.focusBlocksCompleted}</span> focus blocks done</span>
      </div>

      {/* Actions */}
      <div className="mt-7 flex items-center justify-center gap-3">
        {phase.paused ? (
          <button
            type="button"
            onClick={onResume}
            className="inline-flex items-center gap-2 h-11 px-5 rounded-full bg-ink text-bg font-medium text-[13.5px] active:scale-95"
          >
            <Play size={15} /> Resume
          </button>
        ) : (
          <button
            type="button"
            onClick={onPause}
            className="inline-flex items-center gap-2 h-11 px-5 rounded-full bg-ink/8 text-ink hover:bg-ink/12 font-medium text-[13.5px] active:scale-95"
          >
            <Pause size={15} /> Pause
          </button>
        )}
        <button
          type="button"
          onClick={onEnd}
          className="inline-flex items-center gap-2 h-11 px-5 rounded-full border border-ink/15 text-ink/70 hover:text-ink hover:bg-ink/5 font-medium text-[13.5px] active:scale-95"
        >
          <Square size={13} /> End session
        </button>
      </div>

      <p className="mt-7 text-[11.5px] text-ink/45 max-w-sm mx-auto leading-relaxed">
        Chat with Omar in the main app while the session runs. He'll stay in focus mode and help you stay on track.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Phase 3 — Summary
// ─────────────────────────────────────────────────────────────────

function SummaryPhase({
  phase, onClose,
}: {
  phase: Extract<SessionPhase, { kind: "summary" }>;
  onClose: () => void;
}) {
  return (
    <div className="max-w-md mx-auto px-5 md:px-6 py-10 text-center">
      <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-[#5B4BF5]/15 mb-4">
        <Check size={28} className="text-[#5B4BF5]" />
      </div>
      <h1 className="font-serif italic text-3xl md:text-4xl text-ink leading-tight">
        That's a session.
      </h1>
      <p className="mt-3 text-[14.5px] text-ink/65 leading-relaxed">
        {phase.totalElapsedMin === 0
          ? "Even short focus counts. Come back when you're ready."
          : `${phase.totalElapsedMin} minutes on ${phase.subject}. ${phase.focusBlocksCompleted > 0 ? "Real work happened." : "You showed up, that's the hardest part."}`}
      </p>

      {/* Stats grid */}
      <div className="mt-7 grid grid-cols-2 gap-3">
        <Stat label="Total time" value={`${phase.totalElapsedMin}`} unit="min" />
        <Stat label="Focus blocks" value={`${phase.focusBlocksCompleted}`} unit={phase.focusBlocksCompleted === 1 ? "block" : "blocks"} />
      </div>

      {/* Goal echo */}
      <div className="mt-6 rounded-2xl bg-ink/4 border border-ink/10 px-4 py-3 text-start">
        <div className="text-[11px] uppercase tracking-wider text-ink/45 font-semibold mb-1">Goal</div>
        <div className="text-[14px] font-semibold text-ink">{phase.subject}</div>
        <div className="text-[12.5px] text-ink/65 mt-0.5">{phase.goal}</div>
      </div>

      <button
        type="button"
        onClick={onClose}
        className="mt-8 w-full h-12 rounded-full bg-ink text-bg font-medium text-[14.5px] inline-flex items-center justify-center gap-2 active:scale-[0.99]"
      >
        <ArrowLeft size={15} /> Back to chat
      </button>
    </div>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="rounded-2xl bg-ink/4 border border-ink/8 px-4 py-3 text-start">
      <div className="text-[11px] uppercase tracking-wider text-ink/45 font-semibold">{label}</div>
      <div className="mt-1 inline-flex items-baseline gap-1.5">
        <span className="text-2xl font-bold text-ink tabular-nums">{value}</span>
        <span className="text-[11.5px] text-ink/55">{unit}</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Helpers used by the parent (AIScreen) to format the in-session
// banner + the AI request context.
// ─────────────────────────────────────────────────────────────────

export interface StudySessionContext {
  subject: string;
  goal: string;
  elapsedMin: number;
  remainingMin: number;
  currentBlock: "focus" | "break";
}

export function getSessionContext(phase: SessionPhase | null): StudySessionContext | null {
  if (!phase || phase.kind !== "active") return null;
  const totalElapsedMs = Date.now() - phase.startedAt;
  const totalDurationMs = phase.totalDurationMin * 60_000;
  return {
    subject: phase.subject,
    goal: phase.goal,
    elapsedMin: Math.floor(totalElapsedMs / 60_000),
    remainingMin: Math.max(0, Math.floor((totalDurationMs - totalElapsedMs) / 60_000)),
    currentBlock: phase.currentBlock,
  };
}

/** Banner text for the in-session indicator at the top of AIScreen. */
export function getBannerText(phase: SessionPhase | null): string | null {
  if (!phase || phase.kind !== "active") return null;
  const ctx = getSessionContext(phase);
  if (!ctx) return null;
  if (ctx.currentBlock === "break") {
    return `On break · ${ctx.subject}`;
  }
  return `Focus: ${ctx.subject} · ${ctx.elapsedMin} min in`;
}
