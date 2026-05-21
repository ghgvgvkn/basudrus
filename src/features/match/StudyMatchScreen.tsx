/**
 * StudyMatchScreen — the AI-to-AI Study Match feature.
 *
 * Three entry points to picking a candidate (one tab each):
 *   - Suggested: students at your uni (year ±3), ranked by shared
 *                subjects → same major → year proximity. Shared
 *                courses surface peers who'd ACTUALLY benefit from
 *                studying with you, above peers who just share a uni.
 *   - Search:    type their email → server resolves via Supabase
 *                Admin API (rate-limited + anti-enumeration)
 *   - From chats: people you already DM
 *
 * Match runtime — four-phase state machine per click:
 *   1. browsing  — tabs + candidate lists visible
 *   2. matching  — Run AI match clicked, API call in flight
 *   3. theater   — verdict arrived w/ dialogue; messages animate in
 *                  one by one with typing-dot pauses (this is the
 *                  YC demo moment — "two AIs talking about you")
 *   4. verdict   — full verdict card with score + strengths +
 *                  concerns + suggested plan + Connect CTA
 *
 * Once a candidate is picked from ANY tab, phases 2-4 are shared.
 * The chat theater is presentation — the underlying server call is
 * still a single LLM round-trip producing the full dialogue + verdict
 * at once. The animation makes it FEEL like real back-and-forth.
 */
import { useEffect, useState } from "react";
import { TopBar } from "@/components/shell/TopBar";
import { useApp } from "@/context/AppContext";
import {
  useStudyMatch,
  checkStudyMatchEligibility,
  type CandidateRow,
  type StudyMatchVerdict,
  type StudyMatchDialogueMessage,
} from "./useStudyMatch";
import { startConversation } from "@/features/messaging/connectActions";
import {
  Sparkles,
  Loader2,
  Users2,
  AlertCircle,
  CheckCircle2,
  ArrowLeft,
  MessageSquare,
  Brain,
  Heart,
  Search,
  Mail,
  UserPlus,
  BookOpen,
} from "lucide-react";

type Tab = "suggested" | "search" | "chats";
type Phase = "browsing" | "matching" | "theater" | "verdict";

export function StudyMatchScreen() {
  const { profile, setScreen } = useApp();
  const eligibility = checkStudyMatchEligibility(profile);
  const sm = useStudyMatch();

  const [tab, setTab] = useState<Tab>("suggested");
  const [phase, setPhase] = useState<Phase>("browsing");
  /** The candidate whose match we're currently running / showing. */
  const [activeCandidate, setActiveCandidate] = useState<CandidateRow | null>(null);

  const onRunMatch = async (candidate: CandidateRow) => {
    setActiveCandidate(candidate);
    setPhase("matching");
    const verdict = await sm.runMatch(candidate.id);
    if (!verdict) {
      // sm.error is already set; bail back to browsing so the error
      // banner is visible above the tabs.
      setPhase("browsing");
      setActiveCandidate(null);
      return;
    }
    // If the model didn't produce a dialogue (very rare, but
    // possible), skip straight to verdict.
    setPhase(verdict.dialogue.length > 0 ? "theater" : "verdict");
  };

  const backToBrowsing = () => {
    sm.clearVerdict();
    setActiveCandidate(null);
    setPhase("browsing");
  };

  const onConnect = async () => {
    if (!activeCandidate) return;
    const out = await startConversation({
      id: activeCandidate.id,
      name: activeCandidate.name,
      avatar_color: activeCandidate.avatar_color ?? null,
    });
    if (out.ok) setScreen("connect");
  };

  return (
    <>
      <TopBar
        title="Study Match"
        onOpenPalette={() => (window as typeof window & { __basOpenPalette?: () => void }).__basOpenPalette?.()}
      />
      <div className="max-w-[960px] mx-auto px-4 lg:px-8 py-6 lg:py-8">
        <Header />

        {!eligibility.ready ? (
          <EligibilityBlocker
            message={eligibility.message ?? "Complete your profile to use Study Match."}
            onGo={() => setScreen("profile")}
          />
        ) : phase === "matching" && activeCandidate ? (
          <MatchingScreen candidate={activeCandidate} onCancel={backToBrowsing} />
        ) : phase === "theater" && activeCandidate && sm.lastVerdict ? (
          <DialogueTheater
            candidate={activeCandidate}
            viewerName={profile?.name ?? "You"}
            viewerAvatarColor={profile?.avatar_color ?? null}
            viewerPhotoUrl={profile?.photo_url ?? null}
            dialogue={sm.lastVerdict.dialogue}
            onComplete={() => setPhase("verdict")}
            onBack={backToBrowsing}
          />
        ) : phase === "verdict" && activeCandidate && sm.lastVerdict ? (
          <VerdictView
            verdict={sm.lastVerdict}
            candidate={activeCandidate}
            viewerName={profile?.name ?? "You"}
            viewerAvatarColor={profile?.avatar_color ?? null}
            viewerPhotoUrl={profile?.photo_url ?? null}
            onBack={backToBrowsing}
            onConnect={onConnect}
          />
        ) : (
          <>
            <TabBar tab={tab} onTab={setTab} />

            {sm.error && (
              <div className="mb-4 flex items-start gap-2 p-3 rounded-xl bg-red-500/10 text-red-700 dark:text-red-300 text-sm">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{sm.error}</span>
              </div>
            )}

            {tab === "suggested" && (
              <SuggestedTab
                loading={sm.loading}
                candidates={sm.candidates}
                matching={sm.matching}
                activeCandidateId={activeCandidate?.id ?? null}
                onRetry={() => void sm.refresh()}
                onRunMatch={onRunMatch}
              />
            )}
            {tab === "search" && (
              <SearchTab
                loading={sm.emailLookupLoading}
                result={sm.emailLookupResult}
                matching={sm.matching}
                activeCandidateId={activeCandidate?.id ?? null}
                onSearch={(email) => void sm.searchByEmail(email)}
                onClear={() => sm.clearEmailLookup()}
                onRunMatch={onRunMatch}
              />
            )}
            {tab === "chats" && (
              <ChatsTab
                loading={sm.chatPartnersLoading}
                partners={sm.chatPartners}
                matching={sm.matching}
                activeCandidateId={activeCandidate?.id ?? null}
                onRetry={() => void sm.refreshChatPartners()}
                onRunMatch={onRunMatch}
              />
            )}
          </>
        )}
      </div>
    </>
  );
}

// ── Header + tab bar ───────────────────────────────────────────────

function Header() {
  return (
    <div className="mb-5">
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <h1 className="font-serif italic text-3xl text-ink-1" style={{ letterSpacing: "-0.02em" }}>
          Study Match
        </h1>
        <p className="text-xs text-ink-3 hidden sm:block">
          AI-to-AI study-partner compatibility
        </p>
      </div>
      <div className="bu-card p-3 sm:p-4 text-sm text-ink-2 leading-relaxed flex gap-3 items-start">
        <span className="h-9 w-9 grid place-items-center rounded-xl bg-accent/10 text-accent shrink-0">
          <Brain className="h-4 w-4" />
        </span>
        <div className="flex-1 min-w-0">
          <p>
            Tony reads what we already know about you and another student, then talks to <em>their</em> Tony to figure out if you two would actually study well together. You see the conversation as it happens — and then a verdict.
          </p>
          <p className="mt-2 text-xs text-ink-3">
            No raw memories are shared between you. The AIs reason privately and surface only academic-fit conclusions.
          </p>
        </div>
      </div>
    </div>
  );
}

function TabBar({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  return (
    <div className="mb-5 inline-flex p-1 bg-surface-2/60 rounded-full border border-line/60">
      <TabButton active={tab === "suggested"} onClick={() => onTab("suggested")}>
        <Sparkles className="h-3.5 w-3.5" />
        Suggested
      </TabButton>
      <TabButton active={tab === "search"} onClick={() => onTab("search")}>
        <Mail className="h-3.5 w-3.5" />
        By email
      </TabButton>
      <TabButton active={tab === "chats"} onClick={() => onTab("chats")}>
        <MessageSquare className="h-3.5 w-3.5" />
        From chats
      </TabButton>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={
        "inline-flex items-center gap-1.5 h-9 px-4 rounded-full text-sm font-medium transition " +
        (active
          ? "bg-surface-1 text-ink-1 shadow-sm border border-line/60"
          : "text-ink-3 hover:text-ink-1")
      }
    >
      {children}
    </button>
  );
}

// ── Suggested tab ──────────────────────────────────────────────────

function SuggestedTab({
  loading, candidates, matching, activeCandidateId, onRetry, onRunMatch,
}: {
  loading: boolean;
  candidates: CandidateRow[];
  matching: boolean;
  activeCandidateId: string | null;
  onRetry: () => void;
  onRunMatch: (c: CandidateRow) => void;
}) {
  if (loading) {
    return (
      <div className="grid place-items-center py-16 text-ink-3">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }
  if (candidates.length === 0) {
    return (
      <EmptyState
        icon={<Users2 className="h-6 w-6 text-ink-3" />}
        title="No candidates near you yet"
        body="We look for students at your university in roughly your year, ranked by shared courses and major. As more students join from your campus, this list grows. Meanwhile, try Search by Email if you already know someone who's on Bas Udrus."
        action={{ label: "Refresh", onClick: onRetry }}
      />
    );
  }
  return (
    <>
      <div className="text-xs text-ink-3 mb-3">
        {candidates.length} {candidates.length === 1 ? "student" : "students"} near you — best fits first
      </div>
      <ul className="space-y-2">
        {candidates.map((c) => (
          <CandidateRowView
            key={c.id}
            c={c}
            isActive={activeCandidateId === c.id}
            disabled={matching && activeCandidateId !== c.id}
            onRunMatch={() => onRunMatch(c)}
          />
        ))}
      </ul>
    </>
  );
}

// ── Search-by-email tab ────────────────────────────────────────────

function SearchTab({
  loading, result, matching, activeCandidateId, onSearch, onClear, onRunMatch,
}: {
  loading: boolean;
  result: CandidateRow | null;
  matching: boolean;
  activeCandidateId: string | null;
  onSearch: (email: string) => void;
  onClear: () => void;
  onRunMatch: (c: CandidateRow) => void;
}) {
  const [email, setEmail] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || loading) return;
    onSearch(email.trim().toLowerCase());
  };

  return (
    <div>
      <form onSubmit={submit} className="mb-4">
        <div className="flex items-center gap-2 p-1.5 rounded-2xl bg-surface-2/40 border border-line/60 focus-within:ring-2 focus-within:ring-accent/30">
          <Search className="h-4 w-4 text-ink-3 ms-2" />
          <input
            type="email"
            inputMode="email"
            autoComplete="off"
            value={email}
            onChange={(e) => { setEmail(e.target.value); if (result) onClear(); }}
            placeholder="friend@example.com"
            className="flex-1 h-10 px-2 bg-transparent text-sm focus:outline-none"
          />
          <button
            type="submit"
            disabled={!email.trim() || loading}
            className="h-9 px-4 rounded-full bg-ink-1 text-surface-1 text-sm font-medium hover:bg-ink-2 disabled:opacity-40 disabled:cursor-not-allowed transition inline-flex items-center gap-1.5"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            {loading ? "Searching" : "Search"}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-ink-3 leading-relaxed">
          Look up a specific student by their Bas Udrus account email — works across universities and majors. We don't tell them they were searched. Limited to 10 lookups per hour to keep things polite.
        </p>
      </form>

      {result && (
        <>
          <div className="text-xs text-ink-3 mb-3">Match found:</div>
          <ul>
            <CandidateRowView
              c={result}
              isActive={activeCandidateId === result.id}
              disabled={matching && activeCandidateId !== result.id}
              onRunMatch={() => onRunMatch(result)}
            />
          </ul>
        </>
      )}

      {!result && !loading && (
        <EmptyState
          icon={<UserPlus className="h-6 w-6 text-ink-3" />}
          title="Know someone specifically?"
          body="Enter the email they signed up with — even if they're at a different university or major, you can still run an AI compatibility check."
        />
      )}
    </div>
  );
}

// ── From-chats tab ─────────────────────────────────────────────────

function ChatsTab({
  loading, partners, matching, activeCandidateId, onRetry, onRunMatch,
}: {
  loading: boolean;
  partners: CandidateRow[];
  matching: boolean;
  activeCandidateId: string | null;
  onRetry: () => void;
  onRunMatch: (c: CandidateRow) => void;
}) {
  if (loading) {
    return (
      <div className="grid place-items-center py-16 text-ink-3">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }
  if (partners.length === 0) {
    return (
      <EmptyState
        icon={<MessageSquare className="h-6 w-6 text-ink-3" />}
        title="No chats yet"
        body="Start a conversation in Messages, then come back here to AI-match against people you already know."
        action={{ label: "Reload", onClick: onRetry }}
      />
    );
  }
  return (
    <>
      <div className="text-xs text-ink-3 mb-3">
        {partners.length} {partners.length === 1 ? "person" : "people"} you've messaged
      </div>
      <ul className="space-y-2">
        {partners.map((c) => (
          <CandidateRowView
            key={c.id}
            c={c}
            isActive={activeCandidateId === c.id}
            disabled={matching && activeCandidateId !== c.id}
            onRunMatch={() => onRunMatch(c)}
          />
        ))}
      </ul>
    </>
  );
}

// ── Matching (API call in flight) ─────────────────────────────────

function MatchingScreen({ candidate, onCancel }: { candidate: CandidateRow; onCancel: () => void }) {
  return (
    <div className="bu-card p-6 text-center">
      <div className="flex flex-col items-center gap-3">
        <Avatar c={candidate} size={56} />
        <div className="text-sm font-medium text-ink-1">{candidate.name}</div>
        <div className="text-xs text-ink-3">
          {[candidate.major, candidate.year ? `Year ${candidate.year}` : null].filter(Boolean).join(" · ") || candidate.uni}
        </div>
        <div className="mt-4 inline-flex items-center gap-2 text-sm text-ink-2">
          <Loader2 className="h-4 w-4 animate-spin text-accent" />
          Two Tonys are getting ready to talk…
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="mt-3 text-xs text-ink-3 hover:text-ink-1 transition"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Dialogue theater ──────────────────────────────────────────────

const TYPING_MS = 800;       // dots phase before each message reveals
const POST_DIALOGUE_MS = 900; // pause after last message before verdict slides in

function DialogueTheater({
  candidate, viewerName, viewerAvatarColor, viewerPhotoUrl, dialogue, onComplete, onBack,
}: {
  candidate: CandidateRow;
  viewerName: string;
  viewerAvatarColor: string | null;
  viewerPhotoUrl: string | null;
  dialogue: StudyMatchDialogueMessage[];
  onComplete: () => void;
  onBack: () => void;
}) {
  // Index of the message that's CURRENTLY being typed (or shown).
  // 0..dialogue.length means N messages already shown.
  const [shown, setShown] = useState(0);
  const [typing, setTyping] = useState(true);

  useEffect(() => {
    // All messages shown — fire onComplete after a short pause so the
    // verdict card has a graceful entrance.
    if (shown >= dialogue.length) {
      const t = setTimeout(onComplete, POST_DIALOGUE_MS);
      return () => clearTimeout(t);
    }
    // Show typing indicator for TYPING_MS, then reveal next message.
    setTyping(true);
    const t = setTimeout(() => {
      setTyping(false);
      setShown((s) => s + 1);
    }, TYPING_MS);
    return () => clearTimeout(t);
  }, [shown, dialogue.length, onComplete]);

  const nextSpeaker = dialogue[shown]?.speaker;

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-xs text-ink-3 hover:text-ink-1 transition"
      >
        <ArrowLeft className="h-3 w-3" /> Cancel
      </button>

      <div className="bu-card p-4 sm:p-5">
        <div className="text-[11px] uppercase tracking-wider font-semibold text-ink-3 mb-3">
          Two Tonys, comparing notes about you and {candidate.name.split(/\s+/)[0]}
        </div>

        <ol className="space-y-3">
          {dialogue.slice(0, shown).map((msg, i) => (
            <DialogueBubble
              key={i}
              msg={msg}
              candidate={candidate}
              viewerName={viewerName}
              viewerAvatarColor={viewerAvatarColor}
              viewerPhotoUrl={viewerPhotoUrl}
            />
          ))}
          {typing && shown < dialogue.length && (
            <DialogueBubble
              typing
              msg={{ speaker: nextSpeaker ?? "tony_a", text: "" }}
              candidate={candidate}
              viewerName={viewerName}
              viewerAvatarColor={viewerAvatarColor}
              viewerPhotoUrl={viewerPhotoUrl}
            />
          )}
        </ol>

        <div className="mt-4 text-[11px] text-ink-3 text-center">
          {shown < dialogue.length
            ? "Listening in…"
            : "Verdict in a moment."}
        </div>
      </div>
    </div>
  );
}

/**
 * Static, non-animated rendering of the same dialogue — used in the
 * verdict view so the user can re-read the conversation without it
 * re-playing the typing animation. `collapsed` collapses by default
 * to a small "Show conversation" disclosure to keep the verdict
 * cards as the visual focus.
 */
function DialogueTranscript({
  candidate, viewerName, viewerAvatarColor, viewerPhotoUrl, dialogue, collapsed = false,
}: {
  candidate: CandidateRow;
  viewerName: string;
  viewerAvatarColor: string | null;
  viewerPhotoUrl: string | null;
  dialogue: StudyMatchDialogueMessage[];
  collapsed?: boolean;
}) {
  const [open, setOpen] = useState(!collapsed);
  return (
    <div className="bu-card p-4 sm:p-5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between text-start"
      >
        <span className="text-[11px] uppercase tracking-wider font-semibold text-ink-3">
          The conversation
        </span>
        <span className="text-[11px] text-ink-3 hover:text-ink-1 transition">
          {open ? "Hide" : `Show (${dialogue.length})`}
        </span>
      </button>
      {open && (
        <ol className="mt-3 space-y-3">
          {dialogue.map((msg, i) => (
            <DialogueBubble
              key={i}
              msg={msg}
              candidate={candidate}
              viewerName={viewerName}
              viewerAvatarColor={viewerAvatarColor}
              viewerPhotoUrl={viewerPhotoUrl}
            />
          ))}
        </ol>
      )}
    </div>
  );
}

function DialogueBubble({
  msg, candidate, viewerName, viewerAvatarColor, viewerPhotoUrl, typing,
}: {
  msg: StudyMatchDialogueMessage;
  candidate: CandidateRow;
  viewerName: string;
  viewerAvatarColor: string | null;
  viewerPhotoUrl: string | null;
  typing?: boolean;
}) {
  // tony_a = the caller's tutor → render on the START (left in LTR).
  // tony_b = the candidate's tutor → render on the END (right in LTR).
  const isCaller = msg.speaker === "tony_a";
  const personName = isCaller ? viewerName : candidate.name;
  const personColor = isCaller ? viewerAvatarColor : candidate.avatar_color;
  const personPhoto = isCaller ? viewerPhotoUrl : candidate.photo_url;

  return (
    <li className={`flex gap-2 ${isCaller ? "justify-start" : "justify-end"}`}>
      {isCaller && (
        <AvatarSmall name={personName} color={personColor} photoUrl={personPhoto} />
      )}
      <div className={`max-w-[78%] ${isCaller ? "" : "items-end"}`}>
        <div className={`text-[10px] uppercase tracking-wider font-semibold mb-0.5 ${isCaller ? "text-accent text-start" : "text-ink-3 text-end"}`}>
          Tony · {personName.split(/\s+/)[0]}{isCaller ? " (you)" : ""}
        </div>
        <div
          className={
            "px-3 py-2 rounded-2xl text-sm leading-relaxed shadow-sm " +
            (isCaller
              ? "bg-accent/10 text-ink-1 rounded-ss-sm"
              : "bg-surface-2 text-ink-1 rounded-se-sm")
          }
        >
          {typing
            ? <TypingDots />
            : msg.text}
        </div>
      </div>
      {!isCaller && (
        <AvatarSmall name={personName} color={personColor} photoUrl={personPhoto} />
      )}
    </li>
  );
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 py-0.5" aria-label="Typing">
      <span className="h-1.5 w-1.5 rounded-full bg-ink-2/60 animate-bounce" style={{ animationDelay: "0ms" }} />
      <span className="h-1.5 w-1.5 rounded-full bg-ink-2/60 animate-bounce" style={{ animationDelay: "150ms" }} />
      <span className="h-1.5 w-1.5 rounded-full bg-ink-2/60 animate-bounce" style={{ animationDelay: "300ms" }} />
    </span>
  );
}

// ── Verdict (after dialogue) ──────────────────────────────────────

function VerdictView({
  verdict, candidate, viewerName, viewerAvatarColor, viewerPhotoUrl, onBack, onConnect,
}: {
  verdict: StudyMatchVerdict;
  candidate: CandidateRow;
  viewerName: string;
  viewerAvatarColor: string | null;
  viewerPhotoUrl: string | null;
  onBack: () => void;
  onConnect: () => void;
}) {
  // Keep the dialogue visible above the verdict — so the user can
  // scroll back up to re-read what the Tonys said. Re-rendered with
  // shown = dialogue.length so it's instantly fully expanded.
  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-xs text-ink-3 hover:text-ink-1 transition"
      >
        <ArrowLeft className="h-3 w-3" /> Back
      </button>

      {verdict.dialogue.length > 0 && (
        <DialogueTranscript
          candidate={candidate}
          viewerName={viewerName}
          viewerAvatarColor={viewerAvatarColor}
          viewerPhotoUrl={viewerPhotoUrl}
          dialogue={verdict.dialogue}
          collapsed
        />
      )}

      <VerdictCards verdict={verdict} candidate={candidate} onBack={onBack} onConnect={onConnect} />
    </div>
  );
}

const VERDICT_STYLES: Record<StudyMatchVerdict["verdict"], { label: string; bg: string; text: string; ring: string; }> = {
  excellent: {
    label: "Excellent match",
    bg: "bg-emerald-500/10",
    text: "text-emerald-700 dark:text-emerald-300",
    ring: "ring-emerald-500/30",
  },
  good: {
    label: "Good match",
    bg: "bg-accent/10",
    text: "text-accent",
    ring: "ring-accent/30",
  },
  fair: {
    label: "Fair match",
    bg: "bg-amber-500/10",
    text: "text-amber-700 dark:text-amber-300",
    ring: "ring-amber-500/30",
  },
  poor: {
    label: "Not a great fit",
    bg: "bg-ink-1/5",
    text: "text-ink-3",
    ring: "ring-ink-1/10",
  },
};

function VerdictCards({
  verdict, candidate, onBack, onConnect,
}: {
  verdict: StudyMatchVerdict;
  candidate: CandidateRow;
  onBack: () => void;
  onConnect: () => void;
}) {
  const style = VERDICT_STYLES[verdict.verdict];
  return (
    <>
      <div className={`bu-card ${style.ring} ring-1 p-4 sm:p-5`}>
        <div className="flex items-center gap-3 mb-3">
          <Avatar c={candidate} />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-ink-1 truncate">{candidate.name}</div>
            <div className="text-xs text-ink-3 truncate">
              {[candidate.major, candidate.year ? `Year ${candidate.year}` : null].filter(Boolean).join(" · ")}
            </div>
          </div>
          <div className={`shrink-0 inline-flex items-center gap-2 px-3 py-1.5 rounded-full ${style.bg} ${style.text} text-xs font-semibold`}>
            <Sparkles className="h-3 w-3" />
            {verdict.score}/100 · {style.label}
          </div>
        </div>
        {verdict.summary && (
          <p className="text-sm text-ink-1 leading-relaxed">{verdict.summary}</p>
        )}
      </div>

      {verdict.strengths.length > 0 && (
        <div className="bu-card p-4 sm:p-5">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <span className="text-xs uppercase tracking-wider font-semibold text-ink-3">
              Why this could work
            </span>
          </div>
          <ul className="space-y-1.5">
            {verdict.strengths.map((s, i) => (
              <li key={i} className="text-sm text-ink-2 leading-relaxed flex gap-2">
                <span className="text-emerald-600 mt-0.5">•</span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {verdict.concerns.length > 0 && (
        <div className="bu-card p-4 sm:p-5">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle className="h-4 w-4 text-amber-600" />
            <span className="text-xs uppercase tracking-wider font-semibold text-ink-3">
              Things to know
            </span>
          </div>
          <ul className="space-y-1.5">
            {verdict.concerns.map((c, i) => (
              <li key={i} className="text-sm text-ink-2 leading-relaxed flex gap-2">
                <span className="text-amber-600 mt-0.5">•</span>
                <span>{c}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {verdict.suggestedPlan && (
        <div className="bu-card p-4 sm:p-5">
          <div className="flex items-center gap-2 mb-2">
            <Heart className="h-4 w-4 text-accent" />
            <span className="text-xs uppercase tracking-wider font-semibold text-ink-3">
              If you study together
            </span>
          </div>
          <p className="text-sm text-ink-2 leading-relaxed">{verdict.suggestedPlan}</p>
        </div>
      )}

      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onBack}
          className="h-10 px-4 rounded-full text-sm text-ink-2 hover:bg-surface-2 transition"
        >
          Try another
        </button>
        <button
          type="button"
          onClick={onConnect}
          disabled={verdict.verdict === "poor"}
          className="h-10 px-5 rounded-full bg-ink-1 text-surface-1 text-sm font-medium hover:bg-ink-2 disabled:opacity-40 disabled:cursor-not-allowed transition inline-flex items-center gap-2"
        >
          <MessageSquare className="h-4 w-4" />
          Send a study request
        </button>
      </div>
    </>
  );
}

// ── Shared bits ────────────────────────────────────────────────────

function EligibilityBlocker({ message, onGo }: { message: string; onGo: () => void }) {
  return (
    <div className="bu-card p-6 text-center">
      <div className="mx-auto h-12 w-12 grid place-items-center rounded-2xl bg-accent/10 text-accent mb-3">
        <AlertCircle className="h-5 w-5" />
      </div>
      <div className="text-sm font-medium text-ink-1 mb-1">A few profile bits missing</div>
      <p className="text-xs text-ink-3 max-w-md mx-auto leading-relaxed mb-4">{message}</p>
      <button
        type="button"
        onClick={onGo}
        className="h-10 px-5 rounded-full bg-ink-1 text-surface-1 text-sm font-medium hover:bg-ink-2 transition"
      >
        Go to Profile
      </button>
    </div>
  );
}

function CandidateRowView({
  c, isActive, disabled, onRunMatch,
}: {
  c: CandidateRow;
  isActive: boolean;
  disabled: boolean;
  onRunMatch: () => void;
}) {
  const subtitle = [c.major, c.year ? `Year ${c.year}` : null].filter(Boolean).join(" · ");
  const sharedCount = c.sharedSubjects ?? 0;
  return (
    <li className="bu-card flex items-center gap-3 px-4 py-3">
      <Avatar c={c} />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-ink-1 truncate flex items-center gap-2">
          <span className="truncate">{c.name || "Student"}</span>
          {sharedCount > 0 && (
            <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded-full bg-accent/10 text-accent">
              <BookOpen className="h-2.5 w-2.5" />
              {sharedCount} shared
            </span>
          )}
        </div>
        <div className="text-xs text-ink-3 truncate">{subtitle || c.uni}</div>
      </div>
      <button
        type="button"
        onClick={onRunMatch}
        disabled={disabled || isActive}
        className={
          "shrink-0 inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full text-xs font-medium transition disabled:opacity-40 disabled:cursor-not-allowed " +
          (isActive
            ? "bg-accent/10 text-accent"
            : "bg-ink-1 text-surface-1 hover:bg-ink-2")
        }
      >
        {isActive
          ? <><Loader2 className="h-3 w-3 animate-spin" /> Tonys talking…</>
          : <><Sparkles className="h-3 w-3" /> Run AI match</>}
      </button>
    </li>
  );
}

function Avatar({ c, size = 40 }: { c: CandidateRow; size?: number }) {
  if (c.photo_mode === "photo" && c.photo_url) {
    return (
      <img
        src={c.photo_url}
        alt={c.name || "Student"}
        className="rounded-xl object-cover shrink-0"
        style={{ height: size, width: size }}
      />
    );
  }
  const initials = (c.name || "S")
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <div
      className="grid place-items-center rounded-xl text-white text-sm font-semibold shrink-0"
      style={{ background: c.avatar_color ?? "#5B4BF5", height: size, width: size }}
    >
      {initials}
    </div>
  );
}

function AvatarSmall({ name, color, photoUrl }: { name: string; color: string | null; photoUrl: string | null }) {
  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt={name}
        className="h-7 w-7 rounded-full object-cover shrink-0 mt-0.5"
      />
    );
  }
  const initials = (name || "?")
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <div
      className="h-7 w-7 grid place-items-center rounded-full text-white text-[10px] font-semibold shrink-0 mt-0.5"
      style={{ background: color ?? "#5B4BF5" }}
    >
      {initials}
    </div>
  );
}

// ── Empty state ────────────────────────────────────────────────────

function EmptyState({
  icon, title, body, action,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="text-center py-12 px-6">
      <div className="mx-auto mb-3 h-12 w-12 grid place-items-center rounded-2xl bg-surface-2/60">
        {icon}
      </div>
      <div className="text-sm font-medium text-ink-1 mb-1">{title}</div>
      <div className="text-xs text-ink-3 max-w-md mx-auto leading-relaxed mb-3">{body}</div>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="h-9 px-4 rounded-full bg-surface-2 hover:bg-surface-3 text-xs text-ink-2 transition"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
