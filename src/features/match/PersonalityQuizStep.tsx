/**
 * PersonalityQuizStep — reusable 11-question quiz UI.
 *
 * Renders ONE question at a time with a sub-progress dot row. Auto-
 * advances on each pick. Last pick lands on the review summary with
 * an editable list of every answer.
 *
 * Stateless — the parent owns `answers` + `quizIdx` and provides the
 * three lifecycle callbacks (onBack / onSkip / onComplete). Used by
 * both the OnboardingScreen step 3 (where state lives in onboarding's
 * useState) and the standalone PersonalityQuizScreen (where state
 * lives there).
 */
import { Check, ArrowRight } from "lucide-react";
import {
  PERSONALITY_QUESTIONS,
  type PersonalityAnswers,
  type AnswerKey,
} from "./personalityQuestions";

export interface PersonalityQuizStepProps {
  answers: PersonalityAnswers;
  setAnswers: (next: PersonalityAnswers) => void;
  quizIdx: number;
  setQuizIdx: (i: number) => void;
  /** Called when the user presses Back from question 1 (or "Back" on review). */
  onBack: () => void;
  /** Called when the user presses "Skip the rest" — they want to bail without finishing. */
  onSkip: () => void;
  /** Called when the user presses Continue on the review screen. */
  onComplete: () => void;
  /** Optional copy override for the Continue button on the review screen. */
  completeLabel?: string;
  /** Optional copy override for the review-screen heading. */
  reviewHeading?: string;
  /** Optional one-liner shown on the review screen above the answer list. */
  reviewSubtitle?: string;
}

export function PersonalityQuizStep({
  answers, setAnswers,
  quizIdx, setQuizIdx,
  onBack, onSkip, onComplete,
  completeLabel = "Continue",
  reviewHeading = "Looking good.",
  reviewSubtitle,
}: PersonalityQuizStepProps) {
  const total = PERSONALITY_QUESTIONS.length;
  const isReview = quizIdx >= total;
  const q = isReview ? null : PERSONALITY_QUESTIONS[quizIdx];

  const pick = (key: AnswerKey, value: string) => {
    const next = { ...answers, [key]: value };
    setAnswers(next);
    // Auto-advance — feels like Duolingo / Tinder. Reduces friction
    // significantly vs. requiring a Next click after every pick.
    setTimeout(() => {
      if (quizIdx < total - 1) setQuizIdx(quizIdx + 1);
      else setQuizIdx(total); // land on review screen
    }, 220);
  };

  const completedCount = Object.keys(answers).length;
  const defaultSubtitle = `You answered ${completedCount} of ${total} questions. We use these to calculate match % with other students. You can change any answer later from your profile.`;

  if (isReview) {
    return (
      <div className="max-w-md w-full">
        <h2 className="font-serif italic text-4xl md:text-5xl leading-tight">
          {reviewHeading}
        </h2>
        <p className="mt-3 text-ink/60">
          {reviewSubtitle ?? defaultSubtitle}
        </p>

        <ul className="mt-8 space-y-2.5">
          {PERSONALITY_QUESTIONS.map((qq, i) => {
            const v = answers[qq.id];
            const opt = qq.options.find((o) => o.value === v);
            return (
              <li key={qq.id}>
                <button
                  onClick={() => setQuizIdx(i)}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-ink/10 hover:border-ink/35 hover:bg-ink/5 text-start transition"
                >
                  <span className="text-xs font-semibold text-ink/40 w-6 shrink-0">{i + 1}.</span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm text-ink/85 truncate">{qq.question}</span>
                    {opt ? (
                      <span className="block text-xs text-ink/55 truncate">
                        {opt.emoji ? `${opt.emoji} ` : ""}{opt.label}
                      </span>
                    ) : (
                      <span className="block text-xs text-ink/40">— skipped —</span>
                    )}
                  </span>
                  <span className="text-ink/40 text-xs shrink-0">Edit</span>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="mt-10 flex items-center gap-3">
          <button onClick={onBack} className="h-12 px-5 rounded-full text-ink/60 hover:text-ink transition">
            Back
          </button>
          <button
            onClick={onComplete}
            className="flex-1 h-12 rounded-full bg-ink text-bg font-medium hover:bg-ink/85 transition inline-flex items-center justify-center gap-2"
          >
            {completeLabel} <ArrowRight size={16} />
          </button>
        </div>
      </div>
    );
  }

  if (!q) return null;
  const value = answers[q.id];

  return (
    <div className="max-w-md w-full">
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs font-semibold text-ink/45 uppercase tracking-wider">
          Question {quizIdx + 1} of {total}
        </span>
        <button onClick={onSkip} className="text-xs text-ink/45 hover:text-ink underline-offset-2 hover:underline">
          Skip the rest
        </button>
      </div>

      {/* Sub-progress: one slim dot per question. Filled = answered;
          ringed = current. Lets the user see how far they have left. */}
      <div className="flex items-center gap-1 mb-8">
        {PERSONALITY_QUESTIONS.map((qq, i) => (
          <button
            key={qq.id}
            onClick={() => setQuizIdx(i)}
            aria-label={`Go to question ${i + 1}`}
            className={
              "h-1.5 flex-1 rounded-full transition-all " +
              (i === quizIdx
                ? "bg-ink"
                : answers[qq.id]
                ? "bg-ink/60"
                : "bg-ink/15")
            }
          />
        ))}
      </div>

      <h2 className="font-serif italic text-3xl md:text-4xl leading-tight">
        {q.question}
      </h2>
      {q.hint && <p className="mt-2 text-ink/55 text-sm">{q.hint}</p>}

      <div className="mt-7 space-y-2.5" role="radiogroup" aria-label={q.id}>
        {q.options.map((opt) => {
          const selected = value === opt.value;
          return (
            <button
              key={opt.value}
              role="radio"
              aria-checked={selected}
              onClick={() => pick(q.id, opt.value)}
              className={
                "w-full text-start flex items-center gap-3 px-4 py-3.5 rounded-xl border transition " +
                (selected
                  ? "bg-ink text-bg border-ink"
                  : "bg-bg text-ink border-ink/15 hover:border-ink/40 hover:bg-ink/5")
              }
            >
              {opt.emoji && (
                <span className="text-lg leading-none shrink-0">{opt.emoji}</span>
              )}
              <span className="text-sm font-medium flex-1">{opt.label}</span>
              {selected && <Check size={16} className="text-bg shrink-0" />}
            </button>
          );
        })}
      </div>

      <div className="mt-10 flex items-center gap-3">
        <button
          onClick={() => {
            if (quizIdx === 0) onBack();
            else setQuizIdx(quizIdx - 1);
          }}
          className="h-12 px-5 rounded-full text-ink/60 hover:text-ink transition"
        >
          Back
        </button>
        <button
          onClick={() => {
            if (quizIdx < total - 1) setQuizIdx(quizIdx + 1);
            else setQuizIdx(total);
          }}
          className="flex-1 h-12 rounded-full bg-ink/10 text-ink/70 font-medium hover:bg-ink/15 transition"
        >
          {value ? "Next" : "Skip this one"}
        </button>
      </div>
    </div>
  );
}
