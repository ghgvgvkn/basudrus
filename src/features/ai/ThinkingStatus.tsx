/**
 * ThinkingStatus — adaptive "AI is working" indicator.
 *
 * Replaces a static "three dots" placeholder with status text that:
 *   • Adapts to what the user just sent (image, PDF, search-like
 *     question, plain question)
 *   • Rotates phrases every ~3 seconds so it feels alive
 *   • Slips a gentler "almost there" line in after ~8s of waiting
 *   • Speaks per-persona — Omar action-y, Noor gentle
 *   • Stays in the persona color
 *
 * Heuristic only — purely client-side. No backend / SSE changes.
 * If we later want true server-phase tracking we can extend the SSE
 * protocol; this component is the visual layer either way.
 */
import { useEffect, useState } from "react";
import type { AIPersona } from "@/shared/types";

export type ThinkingAttachmentKind = "image" | "pdf" | "doc" | null;

interface ThinkingStatusProps {
  persona: AIPersona;
  /** What the user attached this turn, if anything. Drives the
   *  status phrase ("Looking at your image..." vs "Thinking..."). */
  attachment?: ThinkingAttachmentKind;
  /** The user's last message text. Used to detect search-like
   *  patterns (professor names, "recent" / "today" / dates) so the
   *  status can say "Checking sources..." when appropriate. */
  userText?: string;
}

const ROTATE_MS = 2800;
const LONG_WAIT_MS = 8000;

/** Build the ordered list of phrases we'll cycle through. The first
 *  phrase is what shows on appearance, then we rotate. */
function buildPhrases(opts: ThinkingStatusProps): string[] {
  const { persona, attachment, userText } = opts;
  const isNoor = persona === "noor";

  // Attachment-driven flows (most specific first).
  if (attachment === "image") {
    return isNoor
      ? ["Looking at what you shared...", "Sitting with this...", "Thinking with you..."]
      : ["Looking at your image...", "Reading what's in it...", "Putting it together..."];
  }
  if (attachment === "pdf") {
    return isNoor
      ? ["Reading what you shared...", "Letting it land...", "Sitting with this..."]
      : ["Reading your PDF...", "Pulling out what matters...", "Putting it together..."];
  }
  if (attachment === "doc") {
    return isNoor
      ? ["Reading what you shared...", "Letting it land...", "Sitting with this..."]
      : ["Reading the doc...", "Picking out what matters...", "Putting it together..."];
  }

  // Text-pattern flows. Order: search-trigger > long message > default.
  const text = (userText || "").toLowerCase();
  const looksLikeSearch =
    /\b(dr\.|professor|د\.|دكتور)\s+\w/i.test(userText || "") ||
    /\b(today|recent|latest|news|right now|اليوم|الآن)\b/i.test(text) ||
    /\b20(2[3-9]|3\d)\b/.test(text);

  if (looksLikeSearch && !isNoor) {
    return ["Checking sources...", "Cross-referencing...", "Putting it together..."];
  }

  // Long / complex message → working it out.
  const long = (userText || "").length > 250;
  if (long) {
    return isNoor
      ? ["Taking this in...", "Sitting with all of it...", "Thinking with you..."]
      : ["Working through this...", "Breaking it down...", "Putting it together..."];
  }

  // Default — short factual question.
  return isNoor
    ? ["Listening...", "With you...", "Thinking..."]
    : ["Thinking...", "Working it out...", "Almost there..."];
}

export function ThinkingStatus({ persona, attachment, userText }: ThinkingStatusProps) {
  const tone = persona === "omar" ? "#5B4BF5" : "#0E8A6B";
  const phrases = buildPhrases({ persona, attachment, userText });
  const [idx, setIdx] = useState(0);
  const [longWait, setLongWait] = useState(false);

  // Rotate phrases.
  useEffect(() => {
    const id = setInterval(() => {
      setIdx((i) => (i + 1) % phrases.length);
    }, ROTATE_MS);
    return () => clearInterval(id);
  }, [phrases.length]);

  // Trip "long wait" after the threshold so we can add an empathy line.
  useEffect(() => {
    const id = setTimeout(() => setLongWait(true), LONG_WAIT_MS);
    return () => clearTimeout(id);
  }, []);

  const phrase = phrases[idx];
  const longTail = persona === "noor" ? "I'm still here." : "Hang tight, almost there.";

  return (
    <div className="flex justify-start">
      <div className="inline-flex items-center gap-2 rounded-full bg-ink/5 px-4 py-2.5">
        {/* Three pulse dots — preserved from the legacy spinner. */}
        <span className="inline-flex items-center gap-1">
          <span
            className="w-1.5 h-1.5 rounded-full animate-pulse"
            style={{ background: tone, animationDelay: "0ms" }}
          />
          <span
            className="w-1.5 h-1.5 rounded-full animate-pulse"
            style={{ background: tone, animationDelay: "150ms" }}
          />
          <span
            className="w-1.5 h-1.5 rounded-full animate-pulse"
            style={{ background: tone, animationDelay: "300ms" }}
          />
        </span>
        <span
          key={phrase}
          className="text-[12.5px] font-medium tracking-tight thinking-fade-in"
          style={{ color: tone }}
        >
          {phrase}
        </span>
        {longWait && (
          <span className="text-[12px] text-ink/45">· {longTail}</span>
        )}
      </div>
      {/* Tiny inline CSS for the soft fade — keeps the component
          self-contained so we don't have to touch index.css. */}
      <style>{`
        @keyframes thinkingFade { from { opacity: 0; transform: translateY(1px); } to { opacity: 1; transform: translateY(0); } }
        .thinking-fade-in { animation: thinkingFade 220ms ease-out; }
      `}</style>
    </div>
  );
}
