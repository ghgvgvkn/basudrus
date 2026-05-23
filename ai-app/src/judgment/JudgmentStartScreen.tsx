/**
 * JudgmentStartScreen — Party A creates a new judgment.
 *
 * The user picks a relationship type, optionally names the
 * disagreement, picks a label (what to call themselves), and writes
 * their first message (their side). On submit we call
 * useJudgmentApi.create() which returns the new judgment row with
 * its invite_code. Caller then routes to the share screen.
 */
import { useState } from "react";
import { useJudgmentApi, type Judgment } from "./useJudgmentApi";

const RELATIONSHIP_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "friend",    label: "Friend" },
  { value: "partner",   label: "Partner" },
  { value: "family",    label: "Family" },
  { value: "colleague", label: "Colleague" },
  { value: "other",     label: "Other" },
];

interface Props {
  onBack: () => void;
  onCreated: (j: Judgment) => void;
}

export function JudgmentStartScreen({ onBack, onCreated }: Props) {
  const api = useJudgmentApi();
  const [relType, setRelType] = useState<string>("friend");
  const [title, setTitle] = useState("");
  const [label, setLabel] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = !busy && text.trim().length >= 5;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    const res = await api.create({
      relationshipType: relType,
      title: title.trim() || undefined,
      partyALabel: label.trim() || undefined,
      text: text.trim(),
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onCreated(res.data.judgment);
  };

  return (
    <div className="j-body">
      <div className="j-form">
        <div>
          <div className="j-form-heading">Start a judgment</div>
          <div className="j-form-sub">
            Tell Tony your side. We'll give you a link to share with the
            other person. Once they've added theirs, all three of you
            can talk it through.
          </div>
        </div>

        {error && <div className="j-error">{error}</div>}

        <div>
          <div className="j-label">Who's it with?</div>
          <div className="j-rel-grid">
            {RELATIONSHIP_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                className={`j-rel-chip${relType === o.value ? " active" : ""}`}
                onClick={() => setRelType(o.value)}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="j-label">What's it about? (optional)</div>
          <input
            type="text"
            className="j-input"
            placeholder="e.g. Last weekend's dinner argument"
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, 120))}
            maxLength={120}
          />
        </div>

        <div>
          <div className="j-label">What should Tony call you? (optional)</div>
          <input
            type="text"
            className="j-input"
            placeholder="Your name or how you want to be referred to"
            value={label}
            onChange={(e) => setLabel(e.target.value.slice(0, 60))}
            maxLength={60}
          />
        </div>

        <div>
          <div className="j-label">Your side</div>
          <textarea
            className="j-textarea"
            placeholder="What happened from your perspective? Be specific — the specifics are what Tony judges on."
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, 8000))}
            maxLength={8000}
            rows={8}
          />
        </div>

        <div style={{ display: "flex", gap: 12 }}>
          <button
            type="button"
            className="j-btn-primary"
            onClick={submit}
            disabled={!canSubmit}
          >
            {busy ? "Creating..." : "Get the link"}
          </button>
          <button type="button" className="j-btn-secondary" onClick={onBack}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
