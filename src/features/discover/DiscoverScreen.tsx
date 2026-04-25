/**
 * DiscoverScreen — study-partner finder.
 *
 * Iteration 3 layout:
 *   ┌──────────────────────────────────────────────────┐
 *   │ TopBar                                            │
 *   ├──────────────────────────────────────────────────┤
 *   │ [Matches] [History]                               │  tabs
 *   │ ┌────────────────────────────────────┐ ┌──────┐  │
 *   │ │ 🔍 Course search combobox          │ │Filter│  │  top row
 *   │ └────────────────────────────────────┘ └──────┘  │
 *   │ Active pill row: CS 201 · On campus · Similar   │
 *   ├──────────────────────────────────────────────────┤
 *   │ Match card        ·        Filter rail (desktop) │
 *   └──────────────────────────────────────────────────┘
 *                                            [ + Post ]   ← FAB
 *
 *   - Course combobox is a filtering input; typing narrows an inline
 *     dropdown of course codes scraped from the user's schedule and
 *     popular courses at their university.
 *   - Filter rail becomes a bottom sheet on mobile (toggled by the
 *     Filter pill in the top row).
 *   - History tab shows the user's previous swipes — skipped and
 *     "said hi" — with an option to unskip.
 *   - FAB opens the post-for-help composer (reuses HomeScreen's
 *     `openPostComposer` from AppContext, so posts land in the same
 *     feed regardless of entry point).
 *
 * Live port:
 *   - Replace STUBS with useDiscover({ courseCode, filters }).
 *   - Swap `courses` array for the user's enrolled list from
 *     profile.courses and top courses at their uni (Supabase view).
 *   - History tab reads from swipes table filtered by current user.
 */
import { useRef, useState, useEffect } from "react";
import { Heart, X, Filter, Search, Plus, GraduationCap, Undo2, History as HistoryIcon, Flag } from "lucide-react";
import { ReportBlockModal } from "@/features/safety/ReportBlockModal";
import { useCourseSearch } from "./useCourseSearch";
import { useDiscoverFeed, type FeedItem } from "./useDiscoverFeed";
import { usePlatformStats } from "./usePlatformStats";
import { useSupabaseSession } from "@/features/auth/useSupabaseSession";
import { useApp } from "@/context/AppContext";
import { TopBar } from "@/components/shell/TopBar";
import { startConversation } from "@/features/messaging/connectActions";
import { usePhotoGuard } from "@/features/profile/usePhotoGuard";
import { useUniversities, useMajors } from "@/features/onboarding/useOnboardingCatalog";

// Hardcoded COURSES removed — course search now hits uni_courses
// via useCourseSearch (36k+ rows, live via anon RLS).
type Tab = "matches" | "history";
type Swipe = { id: string; name: string; avatar_color: string | null; action: "skip" | "connect"; at: string };

// University + Major filters now come from real Supabase tables
// (`universities`, `uni_majors`) via the onboarding catalog hooks.
// FilterRail consumes them and re-fetches majors when the user
// picks a university — same UX as onboarding.

export function DiscoverScreen() {
  const { setScreen, openPostComposer } = useApp();
  const { requirePhoto } = usePhotoGuard();
  const guardedPost = () => requirePhoto(
    openPostComposer,
    "Please upload your profile photo first so other students know who's asking for help.",
  );
  const { user, loading: authLoading } = useSupabaseSession();
  const [tab, setTab] = useState<Tab>("matches");
  const [courseCode, setCourseCode] = useState<string | null>(null);
  const [filters, setFilters] = useState<Record<string, boolean>>({
    sameCourse: false, similarPace: true, onCampus: false, sameYear: false,
  });
  const [uniFilter, setUniFilter] = useState<string>("");
  const [majorFilter, setMajorFilter] = useState<string>("");
  const [showFilters, setShowFilters] = useState(false);
  const [history, setHistory] = useState<Swipe[]>([]);
  /** Ids the viewer has swiped on in THIS session — hides them from
   *  the feed without needing a backend write. Next turn's port
   *  persists these as `swipes` rows. */
  const [swiped, setSwiped] = useState<Set<string>>(new Set());

  // Unified real feed — profiles + help_requests merged into one
  // stream. Replaces the old STUBS + HelpPostList split.
  const { items, loading: feedLoading, error: feedError } = useDiscoverFeed({
    viewerId: user?.id ?? null,
    courseFilter: courseCode,
    uniFilter,
    majorFilter,
  });

  // Live platform-wide student count — auto-updates the moment a
  // new student signs up or one deletes their account. Used in the
  // count line below ("Showing X of Y students") so the user can
  // see the platform's growth without a refresh.
  const { totalStudents } = usePlatformStats();

  const visible = items.filter(it => !swiped.has(it.id));

  const recordSwipe = (it: FeedItem, action: "skip" | "connect") => {
    setHistory(h => [{
      id: `sw-${Date.now()}`,
      name: it.profile.name || "Someone",
      avatar_color: it.profile.avatar_color ?? null,
      action,
      at: new Date().toISOString(),
    }, ...h]);
    setSwiped(prev => new Set(prev).add(it.id));
    if (action === "connect") {
      // Persist the real connection row + handoff to ConnectScreen.
      // Fire-and-forget — the screen transition shouldn't wait on
      // the DB write.
      void startConversation({
        id: it.profile.id,
        name: it.profile.name || "Someone",
        avatar_color: it.profile.avatar_color,
      });
      setScreen("connect");
    }
  };

  const activeFilters = Object.entries(filters).filter(([, v]) => v).map(([k]) => k);
  const activeFilterCount = activeFilters.length + (uniFilter ? 1 : 0) + (majorFilter ? 1 : 0);

  return (
    <>
      <TopBar onOpenPalette={() => (window as typeof window & { __basOpenPalette?: () => void }).__basOpenPalette?.()} />
      <div className="max-w-[1100px] mx-auto px-4 lg:px-8 py-6 lg:py-10 relative">
        {/* Bypass-auth banner: shown when the user is in trial/guest
            mode (no real Supabase session). RLS-gated tables return
            empty for them, which feels like "demo mode". This nudges
            them to sign up so they actually see real people. */}
        {!user && (
          <div className="mb-5 bu-card p-4 flex items-center gap-3 border-accent/30 bg-accent-soft/40">
            <div className="flex-1 text-sm text-ink-1">
              <strong>You're in guest mode.</strong> Sign up to see real people from your university.
            </div>
            <button
              onClick={() => {
                try {
                  localStorage.removeItem("bu:bypass-auth");
                  localStorage.removeItem("bu:onb");
                } catch { /* noop */ }
                window.location.reload();
              }}
              className="h-9 px-4 rounded-full bg-ink-1 text-surface-0 text-xs font-semibold whitespace-nowrap"
            >Sign up</button>
          </div>
        )}

        <div className="flex items-center gap-1 mb-4 border-b border-line">
          <TabButton active={tab === "matches"} onClick={() => setTab("matches")} icon={<Heart className="h-4 w-4" />}>
            Matches
          </TabButton>
          <TabButton active={tab === "history"} onClick={() => setTab("history")} icon={<HistoryIcon className="h-4 w-4" />}>
            History {history.length > 0 && <span className="ml-1 inline-flex items-center justify-center h-5 min-w-5 px-1 rounded-full bg-ink-1 text-surface-0 text-[10px] font-medium">{history.length}</span>}
          </TabButton>
        </div>

        {tab === "matches" ? (
          <>
            {/* Top filter row */}
            <div className="flex items-start gap-3 mb-4">
              <div className="flex-1">
                <CourseCombobox
                  value={courseCode}
                  onChange={setCourseCode}
                />
              </div>
              <button
                onClick={() => setShowFilters(v => !v)}
                className={`h-12 px-4 rounded-xl border inline-flex items-center gap-2 text-sm transition ${
                  activeFilterCount > 0 || showFilters
                    ? "border-ink-1 bg-ink-1 text-surface-0"
                    : "border-line bg-surface-0 text-ink-1 hover:bg-surface-2"
                }`}
              >
                <Filter className="h-4 w-4" /> Filters
                {activeFilterCount > 0 && (
                  <span className="h-5 min-w-5 px-1 rounded-full bg-white/20 inline-flex items-center justify-center text-[10px] font-medium">
                    {activeFilterCount}
                  </span>
                )}
              </button>
            </div>

            {/* Active filter chips */}
            {(courseCode || activeFilterCount > 0) && (
              <div className="flex flex-wrap gap-1.5 mb-4">
                {courseCode && (
                  <Chip onClear={() => setCourseCode(null)}>
                    <GraduationCap className="h-3 w-3" /> {courseCode}
                  </Chip>
                )}
                {uniFilter && (
                  <Chip onClear={() => setUniFilter("")}>
                    🎓 {uniFilter}
                  </Chip>
                )}
                {majorFilter && (
                  <Chip onClear={() => setMajorFilter("")}>
                    📚 {majorFilter}
                  </Chip>
                )}
                {activeFilters.map(k => (
                  <Chip key={k} onClear={() => setFilters(f => ({ ...f, [k]: false }))}>
                    {filterLabel(k)}
                  </Chip>
                ))}
              </div>
            )}

            {/* Live count — auto-updates via realtime subscription
                on the profiles table (usePlatformStats). When a new
                student signs up or someone leaves, this number
                changes without a page refresh.
                Format: "Showing X of Y students" where Y is the
                platform total (including the viewer). The Discover
                query already excludes the viewer from the feed, so
                X tops out at Y - 1. The TOTAL is the more useful
                signal because it shows the platform's real size. */}
            {!feedLoading && user && items.length > 0 && (
              <div className="mb-3 text-xs text-ink-3">
                Showing <span className="text-ink-1 font-semibold">{visible.length}</span>
                {typeof totalStudents === "number" && (
                  <> of <span className="text-ink-1 font-semibold">{totalStudents.toLocaleString()}</span></>
                )}
                {" "}{(typeof totalStudents === "number" ? totalStudents : items.length) === 1 ? "student" : "students"} on Bas Udrus
                {(courseCode || uniFilter || majorFilter) && " (filtered)"}
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <section className="lg:col-span-2">
                {/* ONE unified feed. Every entry uses the same card
                    design — the only visible difference is a small
                    "asking for help" line when `helpRequest` is set.
                    Profiles and help-asks are the same thing: a
                    person you can connect with, optionally with a
                    specific ask attached. */}
                <UnifiedFeed
                  items={visible}
                  loading={feedLoading || authLoading}
                  error={feedError}
                  authed={!!user}
                  onSwipe={recordSwipe}
                  onPost={guardedPost}
                />
              </section>

              {/* Desktop filter rail */}
              <aside className="hidden lg:block lg:col-span-1">
                <FilterRail
                  filters={filters} setFilters={setFilters}
                  uni={uniFilter} setUni={setUniFilter}
                  major={majorFilter} setMajor={setMajorFilter}
                />
              </aside>
            </div>

            {/* Mobile filter sheet */}
            {showFilters && (
              <div className="lg:hidden fixed inset-0 z-50 flex items-end" role="dialog">
                <div className="absolute inset-0 bg-black/40" onClick={() => setShowFilters(false)} />
                <div className="relative w-full bg-surface-0 rounded-t-3xl p-5 max-h-[70vh] overflow-y-auto">
                  <div className="mx-auto w-10 h-1.5 rounded-full bg-ink-1/15 mb-4" />
                  <FilterRail
                  filters={filters} setFilters={setFilters}
                  uni={uniFilter} setUni={setUniFilter}
                  major={majorFilter} setMajor={setMajorFilter}
                />
                  <button
                    onClick={() => setShowFilters(false)}
                    className="mt-5 w-full h-12 rounded-full bg-ink-1 text-surface-0 font-medium"
                  >
                    Apply
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <HistoryTab
            history={history}
            onUndo={(id) => {
              setHistory(h => h.filter(s => s.id !== id));
            }}
            onEmpty={() => setTab("matches")}
          />
        )}

        {/* FAB — post for help */}
        <button
          onClick={guardedPost}
          aria-label="Post a study request"
          className="fixed bottom-20 lg:bottom-8 end-4 lg:end-8 z-40 h-14 px-5 rounded-full bg-ink-1 text-surface-0 shadow-lg inline-flex items-center gap-2 font-medium text-sm hover:bg-[color-mix(in_oklab,var(--color-ink-1)_92%,transparent)] active:scale-95 transition"
        >
          <Plus className="h-5 w-5" />
          <span className="hidden sm:inline">Post a request</span>
        </button>
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════
// Unified feed — ONE card design for every entry
// ═══════════════════════════════════════════════════════════

/** The feed list — renders a UnifiedCard per FeedItem, handles
 *  loading skeletons, empty states, sign-in nudge, and the
 *  "all caught up" message at the end. */
function UnifiedFeed({
  items, loading, error, authed, onSwipe, onPost,
}: {
  items: FeedItem[];
  loading: boolean;
  error: "blocked" | "offline" | null;
  authed: boolean;
  onSwipe: (it: FeedItem, action: "skip" | "connect") => void;
  onPost: () => void;
}) {
  if (loading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="bu-card p-6 animate-pulse">
            <div className="flex items-center gap-4 mb-5">
              <div className="h-20 w-20 lg:h-24 lg:w-24 rounded-full bg-surface-3" />
              <div className="flex-1 space-y-2">
                <div className="h-5 w-1/2 bg-surface-3 rounded" />
                <div className="h-3 w-2/3 bg-surface-3 rounded" />
              </div>
            </div>
            <div className="h-3 w-full bg-surface-3 rounded mb-2" />
            <div className="h-3 w-5/6 bg-surface-3 rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (!authed && (error === "blocked" || items.length === 0)) {
    return (
      <div className="bu-card p-10 text-center">
        <div className="serif text-2xl text-ink-1 mb-2" style={{ fontStyle: "italic" }}>Sign in to see matches</div>
        <p className="text-ink-3 text-sm max-w-md mx-auto">
          Real students, real help requests, real group rooms — all live once you're signed in.
          Head back to onboarding and choose "Continue with email".
        </p>
      </div>
    );
  }

  if (error === "offline") {
    return (
      <div className="bu-card p-10 text-center">
        <div className="serif text-xl text-ink-1 mb-1" style={{ fontStyle: "italic" }}>Couldn't load the feed</div>
        <p className="text-ink-3 text-sm">Network hiccup. Pull to refresh or check your connection.</p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="bu-card p-10 text-center">
        <div className="serif text-2xl text-ink-1 mb-2" style={{ fontStyle: "italic" }}>All caught up.</div>
        <p className="text-ink-3 text-sm mb-5">
          No one else at your university matches those filters right now. Post what you need help with and wait for replies.
        </p>
        <button onClick={onPost} className="h-10 px-5 rounded-full bg-accent text-white text-sm font-semibold inline-flex items-center gap-1.5">
          <Plus className="h-4 w-4" /> Post for help
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {items.map((it) => (
        <UnifiedCard
          key={it.id}
          item={it}
          onSkip={() => onSwipe(it, "skip")}
          onConnect={() => onSwipe(it, "connect")}
        />
      ))}
    </div>
  );
}

/** Single card for every feed entry. Profiles and help-asks look
 *  identical — the only visible difference is a small "is asking for
 *  help with X" line when `item.helpRequest` is present. */
function UnifiedCard({
  item, onSkip, onConnect,
}: {
  item: FeedItem;
  onSkip: () => void;
  onConnect: () => void;
}) {
  const p = item.profile;
  const ask = item.helpRequest;
  const initials = (p.name ?? "?").split(" ").slice(0, 2).map(s => s[0]?.toUpperCase() ?? "").join("") || "?";
  const [reportOpen, setReportOpen] = useState(false);

  // Body prefers the help-request detail when this is an ask — the
  // bio is secondary context in that case. If the detail is empty
  // we fall back to the profile bio.
  const bodyText = ask?.detail?.trim() || p.bio || `${p.name} is on Bas Udrus.`;
  const ctaLabel = ask ? "Help them" : "Say hi";

  return (
    <article className="bu-card p-6 lg:p-7 relative">
      {/* Report/block trigger — small, low-attention button in the
          corner so it's discoverable but never the primary action.
          Stops event propagation so the article click doesn't
          bubble. */}
      <button
        onClick={(e) => { e.stopPropagation(); setReportOpen(true); }}
        aria-label="Report or block"
        className="absolute top-3 end-3 h-8 w-8 rounded-full grid place-items-center text-ink-3 hover:bg-surface-2 hover:text-ink-1 z-10"
      >
        <Flag className="h-4 w-4" />
      </button>
      {reportOpen && (
        <ReportBlockModal
          reportedUserId={p.id}
          reportedUserName={p.name || "this user"}
          onClose={() => setReportOpen(false)}
        />
      )}
      {/* Avatar bumped from h-14 → h-20 (and lg:h-24) so the photo is
          the visual anchor of the card. With a real photo this reads
          like a person; with initials it's a strong colour block.
          Wrapped in a relative container so the presence dot can
          absolutely-position to the bottom-right edge. */}
      <header className="flex items-center gap-4 mb-4">
        <div className="relative h-20 w-20 lg:h-24 lg:w-24 shrink-0">
          <div
            className="h-full w-full rounded-full grid place-items-center text-2xl lg:text-3xl font-semibold text-white ring-1 ring-line/60 overflow-hidden"
            style={{ background: p.avatar_color || "#5B4BF5" }}
          >
            {p.photo_mode === "photo" && p.photo_url ? (
              <img src={p.photo_url} alt="" className="h-full w-full rounded-full object-cover" />
            ) : (
              initials
            )}
          </div>
          {/* Online dot — visible if last_seen_at is within 6 minutes. */}
          {(() => {
            const ls = (p as { last_seen_at?: string | null }).last_seen_at;
            if (!ls) return null;
            const t = Date.parse(ls);
            if (!Number.isFinite(t) || (Date.now() - t) > 6 * 60 * 1000) return null;
            return (
              <span
                aria-label="online"
                className="absolute rounded-full"
                style={{
                  width: 18, height: 18,
                  right: 2, bottom: 2,
                  background: "#22C55E",
                  boxShadow: "0 0 0 3px var(--color-surface-1)",
                }}
              />
            );
          })()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="serif text-xl lg:text-2xl text-ink-1 leading-snug" style={{ fontStyle: "italic" }}>
            {p.name || "Someone"}
          </div>
          <div className="text-ink-3 text-sm truncate">
            {[p.major, p.year ? `Year ${p.year}` : null, p.uni].filter(Boolean).join(" · ")}
          </div>
        </div>
        <div className="text-end shrink-0">
          <div className="serif text-2xl lg:text-3xl text-accent" style={{ fontStyle: "italic" }}>{item.score}%</div>
          <div className="text-[10px] uppercase tracking-wider text-ink-3">match</div>
        </div>
      </header>

      {/* Help-ask badge — the one visible difference vs. a plain
          profile card. Shows subject + age + meet type. */}
      {ask && (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
          <span className="px-2.5 h-6 inline-flex items-center rounded-full bg-accent-soft text-accent-ink font-semibold tracking-wide">
            Asking: {ask.subject}
          </span>
          <span className="text-ink-3">· {timeAgo(ask.created_at)}</span>
          {ask.meet_type && (
            <span className="text-ink-3 capitalize">· {ask.meet_type.replace("_", " ")}</span>
          )}
        </div>
      )}

      <p className="text-ink-2 text-[15px] leading-relaxed mb-4">{bodyText}</p>

      {/* Subjects / interests. Only shown when present; profiles
          without any subjects don't get an empty chip row. */}
      {Array.isArray(p.subjects) && p.subjects.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {p.subjects.slice(0, 4).map(s => (
            <span key={s} className="px-3 h-7 inline-flex items-center rounded-full bg-surface-2 text-xs text-ink-2 border border-line">
              {s}
            </span>
          ))}
        </div>
      )}

      {item.reasons.length > 0 && (
        <div className="border-t border-line pt-3 mb-5">
          <ul className="space-y-1">
            {item.reasons.map((r) => <li key={r} className="text-sm text-ink-2">· {r}</li>)}
          </ul>
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={onSkip}
          aria-label="Skip"
          className="h-12 w-12 rounded-full bg-surface-2 border border-line grid place-items-center active:scale-95 transition-transform"
        ><X className="h-5 w-5 text-ink-3" /></button>
        <button
          onClick={onConnect}
          className="flex-1 h-12 rounded-full bg-accent text-white font-medium text-sm inline-flex items-center justify-center gap-2 active:scale-95 transition-transform"
        >
          <Heart className="h-4 w-4" /> {ctaLabel}
        </button>
      </div>
    </article>
  );
}

function HistoryTab({ history, onUndo, onEmpty }: { history: Swipe[]; onUndo: (id: string) => void; onEmpty: () => void }) {
  if (history.length === 0) {
    return (
      <div className="bu-card p-10 text-center">
        <HistoryIcon className="h-6 w-6 mx-auto text-ink-3 mb-3" />
        <div className="serif text-2xl text-ink-1 mb-2" style={{ fontStyle: "italic" }}>No history yet.</div>
        <p className="text-ink-3 text-sm max-w-sm mx-auto">Once you skip or say hi to someone, they'll show up here. You can always unskip.</p>
        <button onClick={onEmpty} className="mt-5 h-10 px-5 rounded-full bg-ink-1 text-surface-0 text-sm font-medium">Find matches</button>
      </div>
    );
  }

  return (
    <div className="bu-card divide-y divide-line overflow-hidden">
      {history.map(s => (
        <div key={s.id} className="flex items-center gap-4 p-4 lg:p-5">
          <div
            className="h-12 w-12 rounded-full grid place-items-center text-sm font-semibold text-white shrink-0"
            style={{ background: s.avatar_color ?? "#5B4BF5" }}
          >
            {s.name.split(" ").slice(0, 2).map(w => w[0]?.toUpperCase() ?? "").join("") || "?"}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-ink-1 text-sm font-medium truncate">{s.name}</div>
            <div className="text-ink-3 text-xs truncate">
              {new Date(s.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </div>
          </div>
          <span className={`inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-[11px] font-medium ${
            s.action === "connect" ? "bg-accent-soft text-accent" : "bg-surface-2 text-ink-3"
          }`}>
            {s.action === "connect" ? <><Heart className="h-3 w-3" /> Said hi</> : <><X className="h-3 w-3" /> Skipped</>}
          </span>
          <button
            onClick={() => onUndo(s.id)}
            className="h-9 px-3 rounded-full border border-line hover:bg-surface-2 text-xs text-ink-2 inline-flex items-center gap-1.5"
            title="Undo"
          >
            <Undo2 className="h-3.5 w-3.5" /> Undo
          </button>
        </div>
      ))}
    </div>
  );
}

function FilterRail({
  filters, setFilters,
  uni, setUni,
  major, setMajor,
}: {
  filters: Record<string, boolean>;
  setFilters: (f: Record<string, boolean>) => void;
  uni: string;
  setUni: (v: string) => void;
  major: string;
  setMajor: (v: string) => void;
}) {
  // Real universities from Supabase. We store the display name in
  // `uni` (matches profiles.uni column for the equality filter).
  const { data: universities, loading: unisLoading } = useUniversities();
  // To filter majors by university we need the picked uni's id —
  // resolve it from the display name. If not picked yet, majors
  // load is skipped (passing null) and the dropdown stays empty.
  const pickedUni = universities.find(u => u.name === uni);
  const { data: majorsForUni, loading: majorsLoading } = useMajors(pickedUni?.id ?? null);

  return (
    <div className="bu-card p-5">
      <div className="flex items-center gap-2 mb-4">
        <Filter className="h-4 w-4 text-ink-3" />
        <h3 className="serif text-lg text-ink-1" style={{ fontStyle: "italic" }}>Filters</h3>
      </div>

      <div className="space-y-4 mb-5">
        <div>
          <label className="block text-xs text-ink-3 mb-1.5 font-medium uppercase tracking-wide">University</label>
          <select
            value={uni}
            onChange={(e) => {
              setUni(e.target.value);
              // Clear the major when uni changes — old major is
              // probably not under the new university.
              setMajor("");
            }}
            disabled={unisLoading}
            className="w-full h-10 px-3 rounded-lg border border-line bg-surface-1 text-sm text-ink-1 focus:border-accent outline-none disabled:opacity-50"
          >
            <option value="">{unisLoading ? "Loading…" : "Any university"}</option>
            {universities.map(u => (
              <option key={u.id} value={u.name}>
                {u.name}{u.short_name ? ` (${u.short_name})` : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-ink-3 mb-1.5 font-medium uppercase tracking-wide">Major</label>
          <select
            value={major}
            onChange={(e) => setMajor(e.target.value)}
            disabled={!uni || majorsLoading}
            className="w-full h-10 px-3 rounded-lg border border-line bg-surface-1 text-sm text-ink-1 focus:border-accent outline-none disabled:opacity-50"
          >
            <option value="">
              {!uni ? "Pick a university first" :
               majorsLoading ? "Loading majors…" :
               majorsForUni.length === 0 ? "No majors found" : "Any major"}
            </option>
            {majorsForUni.map(m => (
              <option key={m.id} value={m.name}>{m.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="pt-4 border-t border-line">
        <div className="text-xs text-ink-3 mb-3 font-medium uppercase tracking-wide">Match signals</div>
        <div className="space-y-4 text-sm">
          {Object.keys(filters).map(k => (
            <FilterRow
              key={k}
              label={filterLabel(k)}
              on={filters[k]}
              onToggle={() => setFilters({ ...filters, [k]: !filters[k] })}
            />
          ))}
        </div>
      </div>
      <div className="mt-5 pt-5 border-t border-line text-xs text-ink-3">
        Filters apply live — pick a university to narrow the feed.
      </div>
    </div>
  );
}

function filterLabel(k: string) {
  return {
    sameCourse: "Same course",
    similarPace: "Similar pace",
    onCampus: "On campus",
    sameYear: "Same year",
  }[k] ?? k;
}

function FilterRow({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }) {
  return (
    <label className="flex items-center justify-between cursor-pointer">
      <span className="text-ink-1">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={onToggle}
        className={`w-9 h-5 rounded-full transition-colors relative ${on ? "bg-accent" : "bg-surface-3"}`}
      >
        <span className={`absolute top-0.5 ${on ? "start-[18px]" : "start-0.5"} h-4 w-4 rounded-full bg-white transition-all`} />
      </button>
    </label>
  );
}

function TabButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`relative h-11 px-4 inline-flex items-center gap-2 text-sm font-medium transition ${
        active ? "text-ink-1" : "text-ink-3 hover:text-ink-2"
      }`}
    >
      {icon}
      {children}
      {active && <span className="absolute bottom-0 start-3 end-3 h-0.5 bg-ink-1 rounded-full" />}
    </button>
  );
}

function Chip({ children, onClear }: { children: React.ReactNode; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 h-7 ps-2.5 pe-1 rounded-full bg-ink-1 text-surface-0 text-[11px] font-medium">
      {children}
      <button
        onClick={onClear}
        aria-label="Clear"
        className="w-5 h-5 rounded-full inline-flex items-center justify-center hover:bg-white/15"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

function CourseCombobox({
  value, onChange,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const [query, setQuery] = useState(value ?? "");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Live search against `uni_courses` (36k rows). Replaces the
  // previous hardcoded 9-course list. Anon RLS policy "Anyone can
  // read courses" lets this work without sign-in.
  const { results, loading } = useCourseSearch(query);

  // Keep query synced to external value changes (chip cleared).
  useEffect(() => { setQuery(value ?? ""); }, [value]);

  // Close on outside click.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const select = (c: { id: string; name: string }) => {
    onChange(c.name);
    setQuery(c.name);
    setOpen(false);
  };

  return (
    <div ref={wrapRef} className="relative">
      <div className={`flex items-center gap-2 h-12 px-4 rounded-xl border transition ${
        open ? "border-ink-1/35 bg-surface-0" : "border-line bg-surface-0 hover:border-ink-1/20"
      }`}>
        <Search className="h-4 w-4 text-ink-3 shrink-0" />
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); setCursor(0); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setCursor(c => Math.min(c + 1, results.length - 1)); }
            if (e.key === "ArrowUp")   { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)); }
            if (e.key === "Enter" && results[cursor]) { e.preventDefault(); select(results[cursor]); }
            if (e.key === "Escape") setOpen(false);
          }}
          placeholder="Search 36k courses — Calculus, CS, Physics…"
          className="flex-1 bg-transparent outline-none text-ink-1 placeholder:text-ink-3 text-sm"
        />
        {query && (
          <button
            onClick={() => { onChange(null); setQuery(""); }}
            aria-label="Clear"
            className="text-ink-3 hover:text-ink-1"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {open && (results.length > 0 || loading) && (
        <div className="absolute top-full start-0 end-0 mt-1 rounded-xl border border-line bg-surface-0 shadow-lg z-30 overflow-hidden max-h-80 overflow-y-auto">
          {loading && results.length === 0 && (
            <div className="px-4 py-3 text-sm text-ink-3 text-center">Searching 36k courses…</div>
          )}
          {results.map((c, i) => {
            // Split "CS 301 · Databases" style names so the code
            // renders as a monospace chip like the old pill.
            const m = c.name.match(/^([A-Z]{2,}\s?\d{2,4}[A-Z]?)\s*[·\-:]?\s*(.*)$/);
            const code = m?.[1];
            const rest = m?.[2] || c.name;
            return (
              <button
                key={c.id}
                onMouseEnter={() => setCursor(i)}
                onClick={() => select(c)}
                className={`w-full px-4 py-2.5 text-start flex items-center gap-3 transition ${
                  i === cursor ? "bg-surface-2" : "hover:bg-surface-2"
                }`}
              >
                {code && (
                  <span className="inline-flex items-center justify-center h-8 w-14 rounded-lg bg-ink-1/5 text-ink-1 text-xs font-mono font-medium shrink-0">
                    {code}
                  </span>
                )}
                <span className="text-sm text-ink-1 truncate">{rest || c.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}


function timeAgo(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}
