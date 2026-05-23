/**
 * JudgmentJoinScreen — Party B opens the invite link.
 *
 * On mount: peek the judgment by invite code to confirm it exists,
 * isn't already complete, and the current user isn't actually
 * Party A. Then show the join form (which is INTENTIONALLY blind
 * to A's side — B writes their take without seeing A's framing,
 * so both stories are honest first-takes).
 */
import { useEffect, useState } from "react";
import {
  useJudgmentApi,
  peekJudgmentByCode,
  type Judgment,
  type JudgmentStatus,
} from "./useJudgmentApi";

interface PeekResult {
  id: string;
  invite_code: string;
  relationship_type: string;
  title: string | null;
  party_a_label: string | null;
  status: JudgmentStatus;
  is_party_a: boolean;
}

interface Props {
  inviteCode: string;
  /** Called once B successfully joins — caller routes to chat. */
  onJoined: (j: Judgment) => void;
  /** Called when B turns out to already be Party A (they opened
   *  their own link) — caller routes to the chat directly. */
  onAlreadyParticipant: (judgmentId: string) => void;
  onBack: () => void;
}

export function JudgmentJoinScreen({
  inviteCode,
  onJoined,
  onAlreadyParticipant,
  onBack,
}: Props) {
  const api = useJudgmentApi();
  const [peek, setPeek] = useState<PeekResult | null>(null);
  const [peekError, setPeekError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Peek on mount.
  useEffect(() => {
    let cancelled = false;
    void peekJudgmentByCode(inviteCode).then((r) => {
      if (cancelled) return;
      if (!r.ok) {
        setPeekError(r.error);
        return;
      }
      setPeek(r.data);
      // If they're actually Party A (opened their own link), bounce
      // straight into the chat — no need to "join" their own thing.
      if (r.data.is_party_a) {
        onAlreadyParticipant(r.data.id);
      }
    });
    return () => { cancelled = true; };
  }, [inviteCode, onAlreadyParticipant]);

  const canSubmit = !busy && !!peek && text.trim().length >= 5;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    const res = await api.join({
      inviteCode,
      partyBLabel: label.trim() || undefined,
      text: text.trim(),
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onJoined(res.data.judgment);
  };

  // Loading state (peek in-flight)
  if (!peek && !peekError) {
    return (
      <div className="j-body">
        <div className="j-form">
          <div className="j-form-heading">Loading...</div>
        </div>
      </div>
    );
  }

  // Peek failed (bad link, not signed in, etc.)
  if (peekError) {
    return (
      <div className="j-body">
        <div className="j-form">
          <div className="j-form-heading">Can't open this link</div>
          <div className="j-form-sub">{peekError}</div>
          <button type="button" className="j-btn-secondary" onClick={onBack}>
            Back
          </button>
        </div>
      </div>
    );
  }

  // Judgment exists but is past the join phase.
  if (peek && peek.status !== "waiting") {
    return (
      <div className="j-body">
        <div className="j-form">
          <div className="j-form-heading">This judgment isn't open for new participants</div>
          <div className="j-form-sub">
            Either both people have already weighed in, or it's been closed.
          </div>
          <button type="button" className="j-btn-secondary" onClick={onBack}>
            Back
          </button>
        </div>
      </div>
    );
  }

  // Normal join flow.
  const aName = peek!.party_a_label?.trim() || "The other person";
  const titleLine = peek!.title?.trim() ? ` about "${peek!.title.trim()}"` : "";

  return (
    <div className="j-body">
      <div className="j-form">
        <div>
          <div className="j-form-heading">
            {aName} wants Tony to weigh in{titleLine}.
          </div>
          <div className="j-form-sub">
            Tell Tony YOUR side. You won't see {aName}'s message until
            after you submit — that way both stories are honest first
            takes, not reactions to each other.
          </div>
        </div>

        {error && <div className="j-error">{error}</div>}

        <div>
          <div className="j-label">What should Tony call you? (optional)</div>
          <input
            type="text"
            className="j-input"
            placeholder="Your name"
            value={label}
            onChange={(e) => setLabel(e.target.value.slice(0, 60))}
            maxLength={60}
          />
        </div>

        <div>
          <div className="j-label">Your side</div>
          <textarea
            className="j-textarea"
            placeholder="What happened from your perspective?"
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, 8000))}
            maxLength={8000}
            rows={10}
          />
        </div>

        <div style={{ display: "flex", gap: 12 }}>
          <button
            type="button"
            className="j-btn-primary"
            onClick={submit}
            disabled={!canSubmit}
          >
            {busy ? "Joining..." : "Submit my side"}
          </button>
          <button type="button" className="j-btn-secondary" onClick={onBack}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
