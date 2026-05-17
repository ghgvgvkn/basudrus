/**
 * MagicMomentCard — one-time post-onboarding "wow" moment on Home.
 *
 * The standard onboarding ends with a form completion — emotionally
 * flat. This card adds the "holy shit, this knows me already" moment:
 *
 *   "Get your first personalized plan from Omar.
 *    Paste your syllabus, share an exam date, or just describe what's
 *    on your plate this week — I'll build you a 5-day plan."
 *
 * On submit: routes to AIScreen with a prefilled prompt that triggers
 * Omar's existing study-plan artifact path. No new endpoint required.
 *
 * On dismiss: localStorage flag — never appears again. Card vanishes.
 *
 * Design rules:
 *   • Skippable with one tap (no friction).
 *   • Surfaces with subtle, optional visual emphasis — not a modal.
 *   • Uses the user's first name when available (already personal).
 *   • Disappears forever after first interaction (dismiss OR submit).
 */
import { useState } from "react";
import { Sparkles, X } from "lucide-react";
import { useApp } from "@/context/AppContext";

const DISMISS_KEY = "bu:magic-moment-dismissed";

/** Is the magic moment card visible? Returns false if it's been
 *  dismissed or already used. Cheap localStorage read, safe inside
 *  render. EXPORTED so the parent can avoid rendering an empty grid
 *  cell when the card is hidden. */
export function shouldShowMagicMomentCard(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return !window.localStorage.getItem(DISMISS_KEY);
  } catch {
    return false;
  }
}

function shouldShow(): boolean {
  return shouldShowMagicMomentCard();
}

function markDismissed() {
  try {
    window.localStorage.setItem(DISMISS_KEY, new Date().toISOString());
  } catch {
    // Quota / private mode — fail open. Card hides for the session
    // anyway because we control visibility via local state too.
  }
}

export function MagicMomentCard() {
  const { profile, setScreen, setAIPrefill } = useApp();
  const [visible, setVisible] = useState<boolean>(shouldShow);
  const [text, setText] = useState("");
  const [expanded, setExpanded] = useState(false);

  if (!visible) return null;

  const firstName = (profile?.name?.trim().split(/\s+/)[0]) || "";
  const greet = firstName ? `${firstName}, ` : "";

  const dismiss = () => {
    markDismissed();
    setVisible(false);
  };

  const handleSubmit = () => {
    const raw = text.trim();
    if (!raw) return;
    // Frame the prefill as a study-plan request so Omar's existing
    // STUDY_PLAN artifact path kicks in. Same code that already
    // generates artifacts from chat — we're just seeding the first
    // turn. No new endpoint, no new prompt logic.
    const prefill = [
      "Build me a personalized study plan based on what I'm sharing below.",
      "If you don't have all the info you need (exam date, subjects, hours per day), ask me ONE short question to fill the gap before generating.",
      "",
      "Here's what I have:",
      raw,
    ].join("\n");
    setAIPrefill(prefill);
    markDismissed();
    setVisible(false);
    setScreen("ai");
  };

  return (
    <div
      className="relative rounded-3xl border bg-bg p-5 md:p-6"
      style={{
        borderColor: "#5B4BF533",
        background: "linear-gradient(135deg, rgba(91,75,245,0.04) 0%, rgba(91,75,245,0.01) 100%)",
      }}
    >
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss this card"
        className="absolute top-3 right-3 inline-flex items-center justify-center w-7 h-7 rounded-full text-ink/45 hover:text-ink/85 hover:bg-ink/5 transition"
      >
        <X size={14} />
      </button>
      <div className="flex items-start gap-3">
        <span
          className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
          style={{ background: "#5B4BF515" }}
        >
          <Sparkles size={18} style={{ color: "#5B4BF5" }} />
        </span>
        <div className="flex-1 min-w-0">
          <h2 className="text-ink font-semibold text-[15.5px] md:text-base leading-tight">
            {greet}let's build your first plan together.
          </h2>
          <p className="mt-1.5 text-ink/65 text-[13.5px] leading-relaxed">
            Paste a syllabus, share an exam date, or describe what's on your plate this week — Omar will build you a personalized study plan.
          </p>
        </div>
      </div>

      {!expanded ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="h-10 px-4 rounded-full text-[13px] font-medium text-white hover:opacity-90 transition active:scale-95"
            style={{ background: "#5B4BF5" }}
          >
            Build my plan
          </button>
          <button
            type="button"
            onClick={dismiss}
            className="h-10 px-4 rounded-full text-[13px] font-medium text-ink/65 hover:bg-ink/5 transition"
          >
            Skip for now
          </button>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. Calc II midterm May 20 — chapters 4-7. I have 3 hours/day for the next 5 days."
            rows={4}
            maxLength={2000}
            className="w-full rounded-2xl border border-ink/15 bg-bg p-3 text-[13.5px] text-ink resize-y focus:outline-none focus:border-ink/40 transition"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!text.trim()}
              className="h-10 px-5 rounded-full text-[13px] font-medium text-white disabled:opacity-30 hover:opacity-90 transition active:scale-95"
              style={{ background: "#5B4BF5" }}
            >
              Generate plan with Omar
            </button>
            <button
              type="button"
              onClick={() => { setExpanded(false); setText(""); }}
              className="h-10 px-4 rounded-full text-[13px] font-medium text-ink/65 hover:bg-ink/5 transition"
            >
              Back
            </button>
            <button
              type="button"
              onClick={dismiss}
              className="h-10 px-4 rounded-full text-[13px] font-medium text-ink/45 hover:bg-ink/5 transition"
            >
              Skip forever
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
