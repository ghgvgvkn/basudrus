/**
 * StudyPlanArtifact — premium document-style card for AI-generated
 * study plans. The redesign: a plan should feel like something you'd
 * save and return to, not a paragraph that scrolls past.
 *
 * Layout decisions:
 *   • Gradient header keyed to the dominant subject's palette so the
 *     card feels like part of the conversation but earns visual weight.
 *   • Big exam-countdown badge in the header when examDate is set —
 *     "3 DAYS UNTIL CALC II MIDTERM" is the line the student
 *     screenshots and sends to friends.
 *   • Title in serif italic for editorial gravity.
 *   • Stats strip — total hours, sessions, subjects covered.
 *   • Day cards with subject-palette color blocks for each study /
 *     class / exam block. Times prominent, topic in gray underneath.
 *   • Two action buttons: "Add to Calendar" downloads .ics; "Email me"
 *     sends the plan as a styled email via Resend.
 *
 * The Block component pulls colors from subjectPalette so a math
 * block is indigo, biology green, chemistry teal, etc. Anything
 * non-study (break / class / sleep / exam) gets its own neutral or
 * accent treatment.
 */
import { useMemo, useState } from "react";
import type { StudyPlanArtifact as T } from "@/shared/types";
import { Calendar, Download, Mail, Check, Loader2 } from "lucide-react";
import { paletteFor } from "./subjectPalette";
import { downloadStudyPlanIcs } from "./studyPlanIcs";
import { supabase } from "@/lib/supabase";

interface Props {
  artifact: T;
}

/** Compute days-until from an ISO date in UTC. Negative if past. */
function daysUntil(iso: string): number {
  const target = new Date(`${iso}T00:00:00Z`).getTime();
  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((target - todayUtc) / 86400000);
}

/** Sum minutes between HH:MM strings; 0 if either is malformed. */
function blockMinutes(start: string, end: string): number {
  const parse = (t: string) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(t);
    if (!m) return null;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  };
  const a = parse(start);
  const b = parse(end);
  if (a == null || b == null) return 0;
  return Math.max(0, b - a);
}

export function StudyPlanArtifact({ artifact }: Props) {
  // Stats: total study hours, sessions, distinct subjects.
  const stats = useMemo(() => {
    let totalMin = 0;
    let sessions = 0;
    const subjects = new Set<string>();
    for (const day of artifact.days) {
      for (const b of day.blocks) {
        if (b.kind === "study") {
          totalMin += blockMinutes(b.start, b.end);
          sessions += 1;
          if (b.subject) subjects.add(b.subject.toLowerCase());
        }
      }
    }
    return {
      hours: artifact.totalStudyHours ?? Math.round((totalMin / 60) * 10) / 10,
      sessions,
      subjects: Array.from(subjects),
    };
  }, [artifact]);

  // Dominant subject for the header gradient — most-studied subject
  // wins. Falls back to "general" palette if no study blocks.
  const dominantSubject = useMemo(() => {
    const counts = new Map<string, number>();
    for (const day of artifact.days) {
      for (const b of day.blocks) {
        if (b.kind === "study" && b.subject) {
          counts.set(b.subject.toLowerCase(), (counts.get(b.subject.toLowerCase()) || 0) + 1);
        }
      }
    }
    let best: string | null = null;
    let bestN = 0;
    for (const [k, n] of counts) {
      if (n > bestN) { best = k; bestN = n; }
    }
    return best || "general";
  }, [artifact]);

  const headerPalette = paletteFor(dominantSubject);

  const countdown = artifact.examDate ? daysUntil(artifact.examDate) : null;
  const countdownLabel = (() => {
    if (countdown == null) return null;
    if (countdown < 0) return "PAST EXAM";
    if (countdown === 0) return "TODAY";
    if (countdown === 1) return "1 DAY";
    return `${countdown} DAYS`;
  })();

  return (
    <div className="mt-3 rounded-2xl overflow-hidden shadow-md border border-ink/8 bg-bg">
      {/* Header — gradient keyed to dominant subject. Countdown
          badge anchored top-right when there's an exam date. */}
      <div
        className="relative px-5 py-5 md:px-6 md:py-6"
        style={{
          backgroundImage: `linear-gradient(135deg, ${headerPalette.accent} 0%, ${headerPalette.accent}cc 60%, ${headerPalette.accent}99 100%)`,
          color: "#ffffff",
        }}
      >
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-[11px] uppercase tracking-[0.18em] opacity-90 font-semibold inline-flex items-center gap-1.5">
              <Calendar size={12} /> Study Plan
            </div>
            <h3
              className="mt-1.5 font-serif italic text-[22px] md:text-[26px] leading-tight"
              style={{ textShadow: "0 1px 2px rgba(0,0,0,0.18)" }}
            >
              {artifact.title}
            </h3>
            {artifact.subtitle && (
              <p className="mt-1.5 text-[13px] md:text-[14px] opacity-95 leading-snug">
                {artifact.subtitle}
              </p>
            )}
          </div>
          {countdownLabel && (
            <div className="shrink-0 text-right">
              <div className="text-[10px] uppercase tracking-[0.18em] opacity-85">
                {countdown != null && countdown >= 0 ? "Until exam" : ""}
              </div>
              <div className="font-bold text-[22px] md:text-[26px] tabular-nums leading-none mt-0.5">
                {countdownLabel}
              </div>
              {artifact.examLabel && (
                <div className="text-[11px] opacity-90 mt-1 max-w-[140px] leading-tight">
                  {artifact.examLabel}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Stats strip */}
      <div className="px-5 md:px-6 py-3 border-b border-ink/8 flex items-center gap-5 text-[12px] text-ink/70">
        <div className="inline-flex items-center gap-1.5">
          <span className="font-bold text-ink tabular-nums">{stats.hours}</span>
          <span>hr study</span>
        </div>
        <div className="inline-flex items-center gap-1.5">
          <span className="font-bold text-ink tabular-nums">{stats.sessions}</span>
          <span>{stats.sessions === 1 ? "session" : "sessions"}</span>
        </div>
        {stats.subjects.length > 0 && (
          <div className="inline-flex items-center gap-1.5 truncate">
            <span className="font-bold text-ink tabular-nums">{stats.subjects.length}</span>
            <span className="truncate">
              {stats.subjects.length === 1 ? "subject" : "subjects"}: {stats.subjects.map((s) => paletteFor(s).label).join(", ")}
            </span>
          </div>
        )}
      </div>

      {/* Day-by-day grid. Each row: day label on left, blocks on right.
          Mobile: blocks wrap. Desktop: same — no horizontal scroll
          because we want to keep the document readable as a unit. */}
      <div className="divide-y divide-ink/6">
        {artifact.days.map((day, di) => (
          <div key={`${day.label}-${di}`} className="flex">
            <div className="w-24 md:w-32 shrink-0 px-4 md:px-5 py-3 text-[11px] uppercase tracking-wider text-ink/55 border-r border-ink/8 flex flex-col justify-center">
              <div className="font-semibold text-ink/75">{day.label}</div>
              {day.date && (
                <div className="text-[10px] text-ink/40 normal-case mt-0.5">
                  {day.date}
                </div>
              )}
            </div>
            <div className="flex-1 p-2 md:p-2.5 flex flex-wrap gap-1.5">
              {day.blocks.map((b, i) => (
                <Block key={`${day.label}-${i}`} b={b} />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Action footer. Calendar download is local + instant; email
          send hits the API. */}
      <ActionFooter artifact={artifact} />
    </div>
  );
}

function Block({ b }: { b: T["days"][number]["blocks"][number] }) {
  // Style varies by kind. Study + exam blocks use the subject palette
  // for a colored chip. Class is neutral-with-subject-tint. Break is
  // gray. Sleep is dim italic.
  if (b.kind === "sleep") {
    return (
      <div className="px-2.5 py-1.5 rounded-lg text-[11px] bg-ink/4 text-ink/40 italic">
        <div>Sleep</div>
        <div className="text-[10px] opacity-80">{b.start}–{b.end}</div>
      </div>
    );
  }
  if (b.kind === "break") {
    return (
      <div className="px-2.5 py-1.5 rounded-lg text-[11px] bg-ink/5 text-ink/55">
        <div className="font-medium">☕ Break</div>
        <div className="text-[10px] opacity-70">{b.start}–{b.end}</div>
      </div>
    );
  }

  const p = paletteFor(b.subject || "general");
  const isExam = b.kind === "exam";
  const isClass = b.kind === "class";

  return (
    <div
      className="px-2.5 py-1.5 rounded-lg text-[11.5px] border"
      style={{
        background: isExam ? p.accent : isClass ? `${p.accent}15` : `${p.accent}1F`,
        color: isExam ? "#ffffff" : p.accent,
        borderColor: isExam ? p.accent : `${p.accent}55`,
        boxShadow: isExam ? `0 2px 8px ${p.accent}40` : undefined,
      }}
    >
      <div className="font-semibold inline-flex items-center gap-1">
        {isExam && <span aria-hidden>📝</span>}
        {isClass && <span aria-hidden>🏫</span>}
        <span className="truncate max-w-[140px]">{p.label}</span>
      </div>
      {b.topic && (
        <div className="text-[10px] opacity-90 truncate max-w-[160px]">{b.topic}</div>
      )}
      <div className="text-[10px] opacity-80 tabular-nums">
        {b.start}–{b.end}
      </div>
    </div>
  );
}

/** Two-button footer: "Add to Calendar" (.ics download — instant,
 *  local, no API call) and "Email me" (sends a styled email via the
 *  /api/notify/study-plan endpoint, requires auth). */
function ActionFooter({ artifact }: { artifact: T }) {
  const [emailState, setEmailState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleDownload = () => {
    try {
      downloadStudyPlanIcs(artifact);
    } catch (e) {
      // Should be near-impossible (Blob + URL.createObjectURL widely
      // supported), but we catch so a calendar app's quirks don't
      // crash the page.
      console.warn("[studyPlanArtifact] ics download failed:", e);
    }
  };

  const handleEmail = async () => {
    if (emailState === "sending" || emailState === "sent") return;
    setEmailState("sending");
    setErrorMsg(null);
    try {
      if (!supabase) throw new Error("Auth not configured");
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        setEmailState("error");
        setErrorMsg("Sign in to email yourself the plan.");
        return;
      }
      const res = await fetch("/api/notify/study-plan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ plan: artifact }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setEmailState("error");
        setErrorMsg(data?.reason || "Couldn't send the email — try again.");
        return;
      }
      setEmailState("sent");
    } catch (e) {
      setEmailState("error");
      setErrorMsg(e instanceof Error ? e.message : "Couldn't send the email.");
    }
  };

  return (
    <div className="px-4 md:px-5 py-3 border-t border-ink/6 flex flex-wrap items-center gap-2 bg-ink/[2%]">
      <button
        type="button"
        onClick={handleDownload}
        className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full bg-ink text-bg text-[12.5px] font-medium hover:bg-ink/85 transition active:scale-95"
      >
        <Download size={13} />
        Add to Calendar
      </button>
      <button
        type="button"
        onClick={handleEmail}
        disabled={emailState === "sending" || emailState === "sent"}
        className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full border border-ink/15 text-ink/80 hover:bg-ink/5 hover:text-ink text-[12.5px] font-medium transition active:scale-95 disabled:opacity-60 disabled:cursor-default"
      >
        {emailState === "sending" && <Loader2 size={13} className="animate-spin" />}
        {emailState === "idle" && <Mail size={13} />}
        {emailState === "sent" && <Check size={13} />}
        {emailState === "error" && <Mail size={13} />}
        {emailState === "idle" && "Email me this"}
        {emailState === "sending" && "Sending…"}
        {emailState === "sent" && "Sent — check your inbox"}
        {emailState === "error" && "Try again"}
      </button>
      {errorMsg && (
        <span className="text-[11.5px] text-rose-600 leading-tight">
          {errorMsg}
        </span>
      )}
    </div>
  );
}
