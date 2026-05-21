/**
 * StudyMatchScreen — the AI-to-AI Study Match feature.
 *
 * Three entry points to picking a candidate (one tab each):
 *   - Suggested: students at your uni in your year ±1 (default)
 *   - Search:    type their email → server looks them up via the
 *                Supabase Admin API (privacy-careful, rate-limited)
 *   - From Chats: people you already DM
 *
 * Once a candidate is picked from ANY tab, the rest of the flow is
 * shared: "Run AI match" → server runs the AI-to-AI verdict → verdict
 * card → optional "Send a study request" → existing Connect flow.
 *
 * NOT in this revision (intentional):
 *   - Match history / no-repeat (would need a study_matches table)
 *   - Premium gating (cost still low enough today)
 *   - Multi-turn streamed AI-to-AI dialogue UI (the YC demo polish)
 *   - Search by name (only by email today — name search would be
 *     basically the same as Discover, and emails are how students
 *     actually identify their peers in WhatsApp / Telegram contacts)
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
  Search,
  Mail,
  UserPlus,
} from "lucide-react";

type Tab = "suggested" | "search" | "chats";

export function StudyMatchScreen() {
  const { profile, setScreen } = useApp();
  const eligibility = checkStudyMatchEligibility(profile);
  const sm = useStudyMatch();
  const [tab, setTab] = useState<Tab>("suggested");
  // Which candidate's "Run AI match" button is currently spinning.
  // Tracked at the screen level (not the hook) because the active
  // candidate UX is per-tab and per-row.
  const [activeCandidateId, setActiveCandidateId] = useState<string | null>(null);

  // When the user clicks "Run AI match" on any tab, the candidate is
  // resolved to its row from whichever list contains it. The verdict
  // card needs the candidate's profile to render avatar + name; we
  // stash a copy here when we run the match because the
  // suggested/search/chats lists each own their own row.
  const [verdictCandidate, setVerdictCandidate] = useState<CandidateRow | null>(null);

  const onRunMatch = async (candidate: CandidateRow) => {
    setActiveCandidateId(candidate.id);
    setVerdictCandidate(candidate);
    await sm.runMatch(candidate.id);
    // If matching failed, sm.error will be set and sm.lastVerdict
    // stays null — the verdict card won't render. The error banner
    // shows above the tabs instead.
    setActiveCandidateId(null);
  };

  const onConnect = async () => {
    if (!verdictCandidate) return;
    const out = await startConversation({
      id: verdictCandidate.id,
      name: verdictCandidate.name,
      avatar_color: verdictCandidate.avatar_color ?? null,
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
        ) : sm.lastVerdict && verdictCandidate ? (
          <VerdictCard
            verdict={sm.lastVerdict}
            candidate={verdictCandidate}
            onBack={() => {
              sm.clearVerdict();
              setActiveCandidateId(null);
              setVerdictCandidate(null);
            }}
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
                activeCandidateId={activeCandidateId}
                onRetry={() => void sm.refresh()}
                onRunMatch={onRunMatch}
              />
            )}
            {tab === "search" && (
              <SearchTab
                loading={sm.emailLookupLoading}
                result={sm.emailLookupResult}
                matching={sm.matching}
                activeCandidateId={activeCandidateId}
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
                activeCandidateId={activeCandidateId}
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

// ── Suggested tab (same as before, slightly refactored) ───────────

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
        body="We look for students at your university in roughly the same year. As more students join from your campus, this list grows. Meanwhile, try Search by Email if you know someone who's already on Bas Udrus."
        action={{ label: "Refresh", onClick: onRetry }}
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
          Look up a specific student by their Bas Udrus account email — the email they signed up with. We don't tell them they were searched. Limited to 10 lookups per hour to keep things polite.
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
          body="Enter the email they signed up with. If they're on Bas Udrus with a complete profile, we'll find them and you can run an AI compatibility check."
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
  candidate: CandidateRow;
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
        <ArrowLeft className="h-3 w-3" /> Back
      </button>

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
