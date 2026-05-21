/**
 * StudyMatchScreen — the AI-to-AI Study Match feature.
 *
 * UX flow:
 *   1. Show eligibility check. If user is missing uni/year on their
 *      profile, surface a friendly "complete profile" CTA. No
 *      candidate list, no API calls.
 *   2. Otherwise show a candidate list: same uni + year ±1 + has
 *      profile data. Each candidate has a "Run AI match" button.
 *   3. Tapping "Run AI match" hits /api/ai/study-match. Loading
 *      state replaces the card with an inline shimmer + the line
 *      "Tony and {name}'s Tony are talking…" — sells the AI-to-AI
 *      framing even though the server uses one LLM with two personas.
 *   4. Verdict card appears with score + summary + strengths +
 *      concerns + suggested plan + two actions:
 *        - "Send a study request" → existing startConversation flow
 *          → bounces to Connect screen
 *        - "Try another candidate" → clears verdict, returns to list
 *
 * NOT in this MVP (future passes):
 *   - Match history / no-repeat (would need a study_matches table)
 *   - Premium gating (cost is low enough today)
 *   - Auto-ranked candidate (run AI on top 3 silently, surface best)
 *   - Multi-turn streamed AI-to-AI dialogue UI (the actual two Tonys
 *     "speaking" with a transcript shown live — that's the YC demo
 *     polish step)
 */
import { useState } from "react";
import { TopBar } from "@/components/shell/TopBar";
import { useApp } from "@/context/AppContext";
import {
  useStudyMatch,
  checkStudyMatchEligibility,
  type CandidateRow,
  type StudyMatchVerdict,
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
} from "lucide-react";

export function StudyMatchScreen() {
  const { profile, setScreen } = useApp();
  const eligibility = checkStudyMatchEligibility(profile);
  const { loading, candidates, error, refresh, matching, runMatch, lastVerdict, clearVerdict } = useStudyMatch();
  // Which candidate's card is currently spinning (only one at a time).
  const [activeCandidateId, setActiveCandidateId] = useState<string | null>(null);

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
        ) : lastVerdict ? (
          <VerdictCard
            verdict={lastVerdict}
            candidate={candidates.find((c) => c.id === lastVerdict.candidateId) ?? null}
            onBack={() => { clearVerdict(); setActiveCandidateId(null); }}
            onConnect={async () => {
              const c = candidates.find((c) => c.id === lastVerdict.candidateId);
              if (!c) return;
              const out = await startConversation({
                id: c.id,
                name: c.name,
                avatar_color: c.avatar_color ?? null,
              });
              if (out.ok) setScreen("connect");
            }}
          />
        ) : (
          <CandidatesList
            loading={loading}
            error={error}
            candidates={candidates}
            matching={matching}
            activeCandidateId={activeCandidateId}
            onRetry={() => void refresh()}
            onRunMatch={async (candidate) => {
              setActiveCandidateId(candidate.id);
              await runMatch(candidate.id);
              // The runMatch state machine puts the verdict in
              // lastVerdict; if the call failed, the error banner
              // shows above and we go back to the list view.
              setActiveCandidateId(null);
            }}
          />
        )}
      </div>
    </>
  );
}

// ── Header ─────────────────────────────────────────────────────────

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
            Tony reads what we already know about you and another student, then talks to <em>their</em> Tony to figure out if you two would actually study well together. You see a compatibility verdict — they don't know they were considered.
          </p>
          <p className="mt-2 text-xs text-ink-3">
            No raw memories are shared between you. The AIs reason privately and surface only academic-fit conclusions.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Eligibility block ──────────────────────────────────────────────

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

// ── Candidate list ─────────────────────────────────────────────────

function CandidatesList({
  loading, error, candidates, matching, activeCandidateId, onRetry, onRunMatch,
}: {
  loading: boolean;
  error: string | null;
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
  if (error) {
    return (
      <div className="mb-4 flex items-start gap-2 p-3 rounded-xl bg-red-500/10 text-red-700 dark:text-red-300 text-sm">
        <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
        <div className="flex-1">
          <div>{error}</div>
          <button
            type="button"
            onClick={onRetry}
            className="mt-1 text-xs underline opacity-80 hover:opacity-100"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }
  if (candidates.length === 0) {
    return (
      <EmptyState
        icon={<Users2 className="h-6 w-6 text-ink-3" />}
        title="No candidates near you yet"
        body="We look for students at your university in roughly the same year. As more students join from your campus, this list grows."
      />
    );
  }
  return (
    <>
      <div className="text-xs text-ink-3 mb-3">
        {candidates.length} {candidates.length === 1 ? "student" : "students"} near you
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

function CandidateRowView({
  c, isActive, disabled, onRunMatch,
}: {
  c: CandidateRow;
  isActive: boolean;
  disabled: boolean;
  onRunMatch: () => void;
}) {
  const subtitle = [c.major, c.year ? `Year ${c.year}` : null].filter(Boolean).join(" · ");
  return (
    <li className="bu-card flex items-center gap-3 px-4 py-3">
      <Avatar c={c} />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-ink-1 truncate">{c.name || "Student"}</div>
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

function Avatar({ c }: { c: CandidateRow }) {
  if (c.photo_mode === "photo" && c.photo_url) {
    return (
      <img
        src={c.photo_url}
        alt={c.name || "Student"}
        className="h-10 w-10 rounded-xl object-cover shrink-0"
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
      className="h-10 w-10 grid place-items-center rounded-xl text-white text-sm font-semibold shrink-0"
      style={{ background: c.avatar_color ?? "#5B4BF5" }}
    >
      {initials}
    </div>
  );
}

// ── Verdict card ───────────────────────────────────────────────────

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

function VerdictCard({
  verdict, candidate, onBack, onConnect,
}: {
  verdict: StudyMatchVerdict;
  candidate: CandidateRow | null;
  onBack: () => void;
  onConnect: () => void;
}) {
  const style = VERDICT_STYLES[verdict.verdict];
  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-xs text-ink-3 hover:text-ink-1 transition"
      >
        <ArrowLeft className="h-3 w-3" /> Back to candidates
      </button>

      {/* Score + summary */}
      <div className={`bu-card ${style.ring} ring-1 p-4 sm:p-5`}>
        <div className="flex items-center gap-3 mb-3">
          {candidate ? <Avatar c={candidate} /> : null}
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-ink-1 truncate">
              {candidate?.name ?? "Match"}
            </div>
            <div className="text-xs text-ink-3 truncate">
              {candidate ? [candidate.major, candidate.year ? `Year ${candidate.year}` : null].filter(Boolean).join(" · ") : ""}
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

      {/* Strengths */}
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

      {/* Concerns */}
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

      {/* Suggested plan */}
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

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onBack}
          className="h-10 px-4 rounded-full text-sm text-ink-2 hover:bg-surface-2 transition"
        >
          Try another candidate
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
    </div>
  );
}

// ── Empty state ────────────────────────────────────────────────────

function EmptyState({
  icon, title, body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="text-center py-12 px-6">
      <div className="mx-auto mb-3 h-12 w-12 grid place-items-center rounded-2xl bg-surface-2/60">
        {icon}
      </div>
      <div className="text-sm font-medium text-ink-1 mb-1">{title}</div>
      <div className="text-xs text-ink-3 max-w-md mx-auto leading-relaxed">{body}</div>
    </div>
  );
}
