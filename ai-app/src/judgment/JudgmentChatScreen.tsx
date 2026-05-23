/**
 * JudgmentChatScreen — the live three-way chat (A, B, Tony).
 *
 * Reads the message transcript from the server, renders each
 * message in its own bubble (color-coded by speaker), parses Tony's
 * <<<VERDICT>>> blocks into a sticky badge at the top, lets either
 * party post follow-up messages, and exposes an "Ask Tony" button
 * to trigger ai_respond.
 *
 * Live updates: we poll every 3 seconds while the screen is visible.
 * Real-time via Supabase Realtime is a v2 enhancement — polling is
 * dead simple and works on every network.
 *
 * BOTH PARTY VARIANTS:
 *  - Party A sees this screen right after creating a judgment
 *    (status='waiting' — composer disabled until B joins, with a
 *    "waiting for the other person" banner)
 *  - Both A and B see it once B joins (status='both_in' or 'active')
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSupabaseSession } from "@/features/auth/useSupabaseSession";
import {
  useJudgmentApi,
  type Judgment,
  type JudgmentMessage,
} from "./useJudgmentApi";
import { latestVerdict, type ParsedVerdict } from "./parseVerdict";
import { parseVerdict } from "./parseVerdict";

interface Props {
  judgment: Judgment;
  /** Called when the user wants to leave (back button). Currently
   *  unused inside the chat (the back-to-Aurora button lives in the
   *  topbar one level up in JudgmentApp), but kept on the prop
   *  surface so this screen can be reused with its own back affordance
   *  later (e.g. an embedded panel). */
  onBack?: () => void;
}

const POLL_INTERVAL_MS = 3000;

export function JudgmentChatScreen({ judgment: initialJudgment }: Props) {
  const { user } = useSupabaseSession();
  const api = useJudgmentApi();
  const [judgment, setJudgment] = useState<Judgment>(initialJudgment);
  const [messages, setMessages] = useState<JudgmentMessage[]>([]);
  const [composerText, setComposerText] = useState("");
  const [sending, setSending] = useState(false);
  const [askingAi, setAskingAi] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyHint, setCopyHint] = useState<string | null>(null);

  const threadRef = useRef<HTMLDivElement>(null);

  // Auto-scroll thread to bottom on new content.
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Initial fetch + polling.
  // Also derives status updates from the message list — if we see
  // a party_b message arrive (B joined) or an ai message (Tony
  // weighed in), bump the local judgment status accordingly so the
  // composer + Ask Tony button unhide for Party A even though the
  // judgment row in their local state was set ONCE at create-time.
  const refresh = useCallback(async () => {
    const res = await api.listMessages({ judgmentId: judgment.id });
    if (!res.ok) return;
    const fetched = res.data.messages ?? [];
    setMessages(fetched);
    const hasBMessage = fetched.some((m) => m.sender_type === "party_b");
    const hasAiMessage = fetched.some((m) => m.sender_type === "ai");
    setJudgment((prev) => {
      // Promote 'waiting' → 'both_in' the moment B's first message
      // shows up in the transcript (means B joined since this client
      // last knew about it).
      if (prev.status === "waiting" && hasBMessage) {
        return { ...prev, status: "both_in" };
      }
      // Promote 'both_in' → 'active' once Tony has responded.
      if (prev.status === "both_in" && hasAiMessage) {
        return { ...prev, status: "active" };
      }
      return prev;
    });
  }, [api, judgment.id]);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => { void refresh(); }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  // ── Auto-trigger Tony's opening verdict the moment both sides
  //    have posted AND Tony hasn't said anything beyond his ack.
  //
  //    This is the "no button click needed" experience the founder
  //    asked for. The flow:
  //      1. A creates → server inserts A's message + Tony's ack
  //         (the brief "I'll wait for them" message). status='waiting'.
  //      2. B joins via link → server inserts B's message.
  //         status='both_in'. Both clients poll and see B's message.
  //      3. This effect fires on BOTH clients: it sees a party_a
  //         message + a party_b message in the transcript + only
  //         the initial ack from Tony (no verdict). It auto-calls
  //         ai_respond. Server runs the AI + posts the opening
  //         verdict. status → 'active'. Tony's verdict appears in
  //         both browsers on the next poll.
  //
  //    Guarded by autoAiTriggeredRef so it only fires ONCE per
  //    judgment per mount (avoids retriggering on every poll).
  const autoAiTriggeredRef = useRef(false);
  useEffect(() => {
    if (autoAiTriggeredRef.current) return;
    if (askingAi) return;
    // Need both human sides AND no verdict-grade AI message yet.
    // The initial ack message is OK — it doesn't count as a verdict.
    const hasA = messages.some((m) => m.sender_type === "party_a");
    const hasB = messages.some((m) => m.sender_type === "party_b");
    if (!hasA || !hasB) return;
    const hasVerdict = messages.some(
      (m) => m.sender_type === "ai" && /<<<VERDICT>>>/i.test(m.text),
    );
    if (hasVerdict) return;
    autoAiTriggeredRef.current = true;
    void askTony();
    // Note: askTony is defined below — its identity is stable across
    // renders thanks to useCallback, so referencing it before the
    // declaration is fine at runtime (closure on the latest reference).
    // We intentionally don't put it in the deps array — we only want
    // this effect's body to gate on `messages` (and the ref).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, askingAi]);

  // Derive party-A vs party-B labels for the speaker chips.
  const aLabel = judgment.party_a_label?.trim() || "Party A";
  const bLabel = judgment.party_b_label?.trim() || "Party B";

  // Determine which party the current user is.
  const meIsA = !!user && user.id === judgment.party_a_user_id;
  const meIsB = !!user && user.id === judgment.party_b_user_id;
  const isParticipant = meIsA || meIsB;

  // Latest verdict from Tony (used for the sticky badge at top).
  const verdict = useMemo(() => latestVerdict(messages), [messages]);

  // Whether the user can post messages right now.
  const canCompose =
    isParticipant &&
    (judgment.status === "both_in" || judgment.status === "active");

  // Whether Tony can be asked to respond (need both sides + active).
  const canAskAi = canCompose && messages.length >= 2;

  // ── Actions ─────────────────────────────────────────────────────

  const send = async () => {
    const text = composerText.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    const res = await api.postMessage({ judgmentId: judgment.id, text });
    setSending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setComposerText("");
    // Optimistically append (poll will reconcile).
    setMessages((prev) => [...prev, res.data.message]);
  };

  const askTony = async () => {
    if (askingAi) return;
    setAskingAi(true);
    setError(null);
    const res = await api.askAi({ judgmentId: judgment.id });
    setAskingAi(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setMessages((prev) => [...prev, res.data.message]);
    // Bump status to 'active' if server flipped it.
    if (judgment.status === "both_in") {
      setJudgment((j) => ({ ...j, status: "active" }));
    }
  };

  const copyShareLink = async () => {
    const link = `${window.location.origin}/judgment/${judgment.invite_code}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopyHint("Copied!");
      window.setTimeout(() => setCopyHint(null), 1800);
    } catch {
      setCopyHint("Couldn't copy — long-press to copy manually");
    }
  };

  // ── Render helpers ───────────────────────────────────────────────

  const renderMessage = (m: JudgmentMessage) => {
    const wrapperClass =
      m.sender_type === "party_a" ? "j-msg j-msg-from-a" :
      m.sender_type === "party_b" ? "j-msg j-msg-from-b" :
      "j-msg j-msg-from-ai";

    const label =
      m.sender_type === "party_a" ? aLabel :
      m.sender_type === "party_b" ? bLabel :
      "TONY";

    // For AI messages, strip the <<<VERDICT>>> block from the bubble
    // (it's already rendered as the sticky badge above).
    const displayText = m.sender_type === "ai"
      ? parseVerdict(m.text).cleanText
      : m.text;

    return (
      <div key={m.id} className={wrapperClass}>
        <div className="j-msg-label">{label}</div>
        <div className="j-msg-bubble">{displayText}</div>
      </div>
    );
  };

  // ── Render ──────────────────────────────────────────────────────

  return (
    <>
      {/* Status banner (waiting state) */}
      {judgment.status === "waiting" && (
        <div className="j-status-banner">
          Waiting for the other person to weigh in · share the link below
        </div>
      )}

      {/* Share-link card for Party A while waiting */}
      {judgment.status === "waiting" && meIsA && (
        <div className="j-share-card">
          <div>
            <div className="j-label">Send this to them</div>
            <div className="j-share-link">
              {`${typeof window !== "undefined" ? window.location.origin : ""}/judgment/${judgment.invite_code}`}
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button type="button" className="j-btn-primary" onClick={copyShareLink}>
              Copy link
            </button>
            {copyHint && (
              <span style={{ fontSize: 12, color: "rgba(255,255,255,0.7)" }}>
                {copyHint}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Verdict badge (only once Tony has issued one) */}
      {verdict && (
        <VerdictBadge verdict={verdict} aLabel={aLabel} bLabel={bLabel} />
      )}

      {/* Loading shimmer while Tony auto-generates his opening
          verdict — gives the user immediate feedback so they know
          something is happening, instead of the chat looking
          frozen during the ~3-5s AI call. Auto-hides as soon as
          a verdict-bearing AI message arrives. */}
      {!verdict && askingAi && (
        <div className="j-ask-cta">
          <div className="j-ask-cta-text">
            Tony is reading both sides...
          </div>
        </div>
      )}

      {/* Message thread */}
      <div className="j-thread" ref={threadRef}>
        {messages.map(renderMessage)}
        {messages.length === 0 && judgment.status === "waiting" && (
          <div style={{ textAlign: "center", color: "rgba(255,255,255,0.5)", fontSize: 13, padding: "20px 0" }}>
            Your side is in. Once the other person submits theirs, you'll
            both be able to talk it through here with Tony.
          </div>
        )}
      </div>

      {/* Error banner */}
      {error && <div className="j-error" style={{ margin: "0 0 10px" }}>{error}</div>}

      {/* Composer (only when status allows) */}
      {canCompose && (
        <div className="j-composer">
          <textarea
            className="j-textarea"
            placeholder="Type a message..."
            value={composerText}
            onChange={(e) => setComposerText(e.target.value.slice(0, 8000))}
            rows={2}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <div className="j-composer-actions">
            <button
              type="button"
              className="j-btn-primary"
              onClick={send}
              disabled={sending || composerText.trim().length === 0}
            >
              {sending ? "..." : "Send"}
            </button>
            <button
              type="button"
              className="j-btn-secondary"
              onClick={askTony}
              disabled={askingAi || !canAskAi}
              title="Tony reads everyone's messages and weighs in"
            >
              {askingAi ? "Tony is thinking..." : "Ask Tony"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/** Sticky verdict badge above the thread. */
function VerdictBadge({
  verdict,
  aLabel,
  bLabel,
}: {
  verdict: ParsedVerdict;
  aLabel: string;
  bLabel: string;
}) {
  const sides = verdict.sidesWith;
  const conf = verdict.confidence;

  const headline =
    sides === "a"       ? `${bLabel} is in the wrong` :
    sides === "b"       ? `${aLabel} is in the wrong` :
    sides === "both"    ? "Both of you blew it" :
    sides === "neither" ? "Neither of you is wrong — you want different things" :
    "Verdict";

  const confLabel =
    conf === "clear"      ? "Clear call" :
    conf === "leaning"    ? "Leaning this way" :
    conf === "close_call" ? "Close call" :
    "";

  const cls =
    sides ? `j-verdict-badge sides-${sides}` : "j-verdict-badge";

  return (
    <div className={cls}>
      <div className="j-verdict-headline">{headline}</div>
      {confLabel && <div className="j-verdict-confidence">{confLabel}</div>}
    </div>
  );
}
