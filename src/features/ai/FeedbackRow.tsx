/**
 * FeedbackRow — tiny 👍 / 👎 affordance under an AI bubble.
 *
 * Behavior:
 *   • Tap 👍  → instant "thanks" state, fire-and-forget insert.
 *   • Tap 👎  → open a small note modal: "What was wrong? (optional)".
 *               Skip submits with empty note; Send submits with text.
 *   • Once rated, the row collapses to a subtle "Rated" line so the
 *     student can't accidentally double-rate.
 *
 * The component is intentionally self-contained — no external state
 * besides one boolean ("rated"). Persistence is fire-and-forget via
 * useTutorFeedback. If the insert fails (network drop, RLS hiccup),
 * the UI still reads as "rated" — we never block the student.
 */
import { useState } from "react";
import { ThumbsUp, ThumbsDown, X } from "lucide-react";
import { useTutorFeedback, type FeedbackPersona } from "./useTutorFeedback";

interface FeedbackRowProps {
  persona: FeedbackPersona;
  messageText: string;
  userMessageText?: string | null;
}

export function FeedbackRow({ persona, messageText, userMessageText }: FeedbackRowProps) {
  const { submit } = useTutorFeedback();
  const [rated, setRated] = useState<null | "up" | "down">(null);
  const [downModalOpen, setDownModalOpen] = useState(false);
  const [note, setNote] = useState("");

  if (rated) {
    return (
      <div className="text-[11px] text-ink/45 inline-flex items-center gap-1">
        {rated === "up" ? <ThumbsUp size={11} /> : <ThumbsDown size={11} />}
        <span>Thanks — feedback noted</span>
      </div>
    );
  }

  const onUp = () => {
    setRated("up");
    void submit({ rating: "up", persona, messageText, userMessageText });
  };
  const onDownClick = () => setDownModalOpen(true);
  const onDownSubmit = (n: string) => {
    setRated("down");
    setDownModalOpen(false);
    void submit({ rating: "down", persona, messageText, userMessageText, note: n });
  };

  return (
    <>
      <div className="inline-flex items-center gap-1">
        <button
          type="button"
          onClick={onUp}
          aria-label="This response was helpful"
          className="inline-flex items-center justify-center w-7 h-7 rounded-full text-ink/45 hover:text-ink/85 hover:bg-ink/5 transition active:scale-95"
        >
          <ThumbsUp size={13} />
        </button>
        <button
          type="button"
          onClick={onDownClick}
          aria-label="This response was not helpful"
          className="inline-flex items-center justify-center w-7 h-7 rounded-full text-ink/45 hover:text-ink/85 hover:bg-ink/5 transition active:scale-95"
        >
          <ThumbsDown size={13} />
        </button>
      </div>
      {downModalOpen && (
        <FeedbackNoteModal
          onClose={() => setDownModalOpen(false)}
          onSubmit={onDownSubmit}
          note={note}
          setNote={setNote}
        />
      )}
    </>
  );
}

/** Lightweight modal — note input + Skip / Send. Closes on Escape +
 *  on backdrop click. We never require text; the rating itself is the
 *  signal, the note is bonus context for weekly review. */
function FeedbackNoteModal({
  onClose, onSubmit, note, setNote,
}: {
  onClose: () => void;
  onSubmit: (note: string) => void;
  note: string;
  setNote: (s: string) => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="What was wrong with this response?"
    >
      <div
        className="w-full max-w-md rounded-3xl bg-bg border border-ink/10 shadow-2xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="text-[15px] font-semibold text-ink">What was wrong?</h3>
            <p className="text-[12px] text-ink/55 mt-0.5">Optional — helps us fix it.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-ink/45 hover:text-ink/85"
          >
            <X size={18} />
          </button>
        </div>
        <textarea
          autoFocus
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Wrong answer, confusing, made something up, etc."
          rows={3}
          maxLength={2000}
          className="w-full rounded-2xl border border-ink/15 bg-bg p-3 text-[13px] text-ink resize-none focus:outline-none focus:border-ink/40 transition"
        />
        <div className="flex gap-2 mt-3">
          <button
            type="button"
            onClick={() => onSubmit("")}
            className="flex-1 h-10 rounded-full text-[13px] font-medium bg-ink/5 text-ink/70 hover:bg-ink/10 transition"
          >
            Skip
          </button>
          <button
            type="button"
            onClick={() => onSubmit(note)}
            className="flex-1 h-10 rounded-full text-[13px] font-medium bg-ink text-bg hover:opacity-90 transition"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
