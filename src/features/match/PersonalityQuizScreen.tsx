/**
 * PersonalityQuizScreen — full-screen overlay that lets the user take
 * (or retake) the 11-question personality quiz outside of onboarding.
 *
 * Used in two places:
 *   1. The first-time prompt for users who signed in BEFORE the quiz
 *      existed — they hit a `<QuizPrompt />` overlay on app load that
 *      mounts this screen with `mode="first-time"`.
 *   2. The "Retake quiz" button on ProfileScreen — opens this screen
 *      with `mode="retake"`, prefilled with their existing answers.
 *
 * Owns its own state (answers, quizIdx) and its own Supabase upsert
 * to public.match_quiz on completion. The parent only provides
 * `mode` and `onClose` — everything else is self-contained.
 */
import { useEffect, useState, useCallback } from "react";
import { X, Sparkles } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useSupabaseSession } from "@/features/auth/useSupabaseSession";
import { PersonalityQuizStep } from "./PersonalityQuizStep";
import type { PersonalityAnswers } from "./personalityQuestions";

export type QuizMode = "first-time" | "retake";

export function PersonalityQuizScreen({
  mode,
  onClose,
}: {
  mode: QuizMode;
  /** Called after a successful save, OR after the user dismisses the
   *  quiz without saving. */
  onClose: (saved: boolean) => void;
}) {
  const { user } = useSupabaseSession();
  const [answers, setAnswers] = useState<PersonalityAnswers>({});
  const [quizIdx, setQuizIdx] = useState<number>(mode === "first-time" ? -1 : 0);
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // For retake mode: load the user's existing answers so they
  // start the flow with their previous picks shown.
  useEffect(() => {
    if (mode !== "retake" || !user || !supabase) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("match_quiz")
        .select("answers")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      if (data?.answers && typeof data.answers === "object") {
        setAnswers(data.answers as PersonalityAnswers);
      }
    })();
    return () => { cancelled = true; };
  }, [mode, user]);

  const save = useCallback(async () => {
    if (!user || !supabase) {
      setErr("Sign in to save your answers.");
      return;
    }
    setErr(null);
    setSaving(true);
    try {
      const { error } = await supabase
        .from("match_quiz")
        .upsert({
          user_id: user.id,
          answers,
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id" });
      if (error) throw error;
      setSavedOk(true);
      // Tiny pause so the user sees the "saved" affordance, then close.
      // Discover feed listens for `bu:posts-changed` style refresh
      // signals — emit a custom event so any open feed re-fetches its
      // viewer answers.
      try { window.dispatchEvent(new CustomEvent("bu:quiz-updated")); } catch { /* noop */ }
      setTimeout(() => onClose(true), 600);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save. Try again.");
      setSaving(false);
    }
  }, [user, answers, onClose]);

  // Esc / click-outside dismissal — only allowed in retake mode.
  // First-time prompt requires explicit "Skip for now" to dismiss
  // (otherwise users would back out by accident and never see it).
  useEffect(() => {
    if (mode !== "retake") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, onClose]);

  // Intro card — shown only in first-time mode. Sets context before
  // the user dives into 11 questions.
  if (quizIdx < 0) {
    return (
      <div className="fixed inset-0 z-[80] bg-bg flex items-center justify-center p-6 overflow-y-auto">
        <div className="max-w-md w-full text-center py-12">
          <div className="mx-auto w-16 h-16 rounded-full bg-accent-soft text-accent-ink grid place-items-center mb-6">
            <Sparkles className="h-7 w-7" />
          </div>
          <h1 className="font-serif italic text-4xl md:text-5xl leading-[1.04] mb-4">
            Personalize your matches.
          </h1>
          <p className="text-ink/65 text-base">
            We added a short personality quiz that powers Discover's match %.
            Eleven questions about how you study — takes about 90 seconds.
          </p>
          <div className="mt-10 space-y-3">
            <button
              onClick={() => setQuizIdx(0)}
              className="w-full h-12 rounded-full bg-ink text-bg font-medium hover:bg-ink/85 transition"
            >
              Take the quiz
            </button>
            <button
              onClick={() => onClose(false)}
              className="w-full h-12 rounded-full text-ink/60 hover:text-ink hover:bg-ink/5 transition text-sm font-medium"
            >
              Skip for now
            </button>
          </div>
          <p className="mt-6 text-[11px] text-ink/40">
            You can always retake it from your profile.
          </p>
        </div>
      </div>
    );
  }

  // Save-success card — shown briefly after the upsert returns.
  if (savedOk) {
    return (
      <div className="fixed inset-0 z-[80] bg-bg flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center">
          <div className="mx-auto w-16 h-16 rounded-full bg-[#0E8A6B]/10 text-[#0E8A6B] grid place-items-center mb-6">
            <Sparkles className="h-7 w-7" />
          </div>
          <h2 className="font-serif italic text-4xl mb-2">All saved.</h2>
          <p className="text-ink/65">
            Discover is recalculating your matches.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[80] bg-bg overflow-y-auto">
      {/* Top bar with close (retake) or skip-the-rest hint (first-time) */}
      <div className="sticky top-0 bg-bg/95 backdrop-blur z-10 px-5 py-3 flex items-center justify-between border-b border-ink/5">
        <span className="text-sm font-semibold text-ink/65">
          {mode === "retake" ? "Update your answers" : "Personality quiz"}
        </span>
        {mode === "retake" && (
          <button
            onClick={() => onClose(false)}
            aria-label="Close"
            className="h-9 w-9 rounded-full grid place-items-center text-ink/55 hover:bg-ink/5"
          >
            <X size={18} />
          </button>
        )}
      </div>

      <div className="px-6 py-10 flex flex-col items-center min-h-[calc(100dvh-56px)]">
        <PersonalityQuizStep
          answers={answers}
          setAnswers={setAnswers}
          quizIdx={quizIdx}
          setQuizIdx={setQuizIdx}
          onBack={() => onClose(false)}
          onSkip={() => {
            // "Skip the rest" — save whatever they DID answer (so
            // partial credit still flows into the match score).
            void save();
          }}
          onComplete={save}
          completeLabel={
            saving
              ? "Saving…"
              : mode === "retake"
                ? "Update answers"
                : "Save & finish"
          }
          reviewHeading={mode === "retake" ? "Quick review." : "Looking good."}
        />

        {err && (
          <p className="mt-4 text-sm text-[#C23F6C]">{err}</p>
        )}
      </div>
    </div>
  );
}
