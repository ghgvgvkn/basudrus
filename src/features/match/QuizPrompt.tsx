/**
 * QuizPrompt — auto-detects users who haven't completed the
 * personality quiz and offers them the chance to take it.
 *
 * Mounted high in the tree (next to ProfileSync inside SignInGate)
 * so it runs once per session for every authed user. Three cases:
 *
 *   1. User has a match_quiz row with answers → render nothing.
 *   2. User has no match_quiz row → show the first-time prompt.
 *      Covers people who signed up BEFORE the quiz existed (e.g.
 *      via the old website), or users who skipped onboarding.
 *   3. User dismissed the prompt → respect the localStorage flag
 *      `bu:quiz-dismissed` for 7 days, then re-prompt.
 *
 * Doesn't block the app — the user can dismiss with "Skip for now"
 * and continue to Discover. The Discover feed handles missing-quiz
 * candidates gracefully (neutral 0.5 per question).
 */
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useSupabaseSession } from "@/features/auth/useSupabaseSession";
import { PersonalityQuizScreen } from "./PersonalityQuizScreen";

const DISMISS_KEY = "bu:quiz-dismissed";
const DISMISS_DAYS = 7;

function isDismissed(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const at = parseInt(raw, 10);
    if (!Number.isFinite(at)) return false;
    return Date.now() - at < DISMISS_DAYS * 86_400_000;
  } catch {
    return false;
  }
}

function markDismissed() {
  try { localStorage.setItem(DISMISS_KEY, String(Date.now())); }
  catch { /* ignore */ }
}

function clearDismissal() {
  try { localStorage.removeItem(DISMISS_KEY); }
  catch { /* ignore */ }
}

export function QuizPrompt() {
  const { user, loading } = useSupabaseSession();
  // null = haven't checked yet, true = needs prompt, false = has answers (or dismissed)
  const [needsQuiz, setNeedsQuiz] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (loading) return;
    if (!user || !supabase) {
      setNeedsQuiz(false);
      return;
    }
    if (isDismissed()) {
      setNeedsQuiz(false);
      return;
    }
    (async () => {
      try {
        const { data, error } = await supabase!
          .from("match_quiz")
          .select("answers")
          .eq("user_id", user.id)
          .maybeSingle();
        if (cancelled) return;
        if (error) {
          // RLS or network issue — don't surface a prompt we're not
          // sure about. Default to "no prompt" so we don't bother
          // users on a flaky load.
          setNeedsQuiz(false);
          return;
        }
        // No row, OR a row with empty/missing answers, both mean
        // "needs to take the quiz". A row with even partial answers
        // counts as taken — they can retake from Profile if they want.
        const a = data?.answers as Record<string, unknown> | null | undefined;
        const hasAnyAnswers = !!a && typeof a === "object" && Object.keys(a).length > 0;
        setNeedsQuiz(!hasAnyAnswers);
      } catch {
        if (!cancelled) setNeedsQuiz(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user, loading]);

  // Auto-open the prompt 1.5s after sign-in so it doesn't fire mid-
  // page-load and feel jarring. The delay lets the user see the app
  // load successfully first, building trust before we ask for input.
  useEffect(() => {
    if (needsQuiz !== true) return;
    const t = setTimeout(() => setOpen(true), 1500);
    return () => clearTimeout(t);
  }, [needsQuiz]);

  if (!open || needsQuiz !== true) return null;

  return (
    <PersonalityQuizScreen
      mode="first-time"
      onClose={(saved) => {
        setOpen(false);
        if (saved) {
          // Successful save — clear any prior dismissal and never
          // re-prompt this user.
          clearDismissal();
          setNeedsQuiz(false);
        } else {
          // Skip for now — remember for a week.
          markDismissed();
          setNeedsQuiz(false);
        }
      }}
    />
  );
}
