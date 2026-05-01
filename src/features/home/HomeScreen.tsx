/**
 * HomeScreen — bento feed + Ask Omar hero.
 *
 * Bento (desktop, 12-col grid, collapses to 1-col on mobile):
 *   row 1: Greeting + AI input  (span 8)    Streak card       (span 4)
 *   row 2: Match suggestions    (span 8)    Today's rooms     (span 4)
 *   row 3: Activity feed        (span 12)
 *
 * Data: all stubbed here. Slice 3 wires useHome(), useDiscover(),
 * useRooms(), useNotifications().
 */
import { useState } from "react";
import { Sparkles, ArrowRight, Flame, Users, Plus, Hand } from "lucide-react";
import { useApp } from "@/context/AppContext";
import { useLocale } from "@/context/LocaleContext";
import { TopBar } from "@/components/shell/TopBar";
import { Avatar } from "@/shared/Avatar";
import { useDiscoverFeed } from "@/features/discover/useDiscoverFeed";
import { useRealRooms } from "@/features/rooms/useRealRooms";
import { useSupabaseSession } from "@/features/auth/useSupabaseSession";
import { startConversation } from "@/features/messaging/connectActions";
import { usePhotoGuard } from "@/features/profile/usePhotoGuard";
import { useRecentActivity } from "./useRecentActivity";
import { useRealProfile } from "@/features/profile/useRealProfile";

export function HomeScreen() {
  const { profile, setScreen, setAIPrefill, openPostComposer } = useApp();
  const { lang } = useLocale();
  const { user } = useSupabaseSession();
  const { profile: realProfile } = useRealProfile();
  const { requirePhoto } = usePhotoGuard();
  const { items: activity, loading: activityLoading } = useRecentActivity();
  const [draft, setDraft] = useState("");

  const guardedPost = () => requirePhoto(
    openPostComposer,
    "Please upload your profile photo first so other students know who's asking for help.",
  );

  // Pull the top 3 real matches + the next 3 real rooms for the
  // bento. Both hooks fall back to empty when the viewer is
  // signed out, which triggers the fallback stub lists below.
  const { items: realMatches } = useDiscoverFeed({
    viewerId: user?.id ?? null,
    courseFilter: null,
    uniFilter: "",
    majorFilter: "",
  });
  const { rooms: realRooms } = useRealRooms();

  // Greeting source: real profile name first (if signed in), then
  // demo profile fallback, then "student" so the line is never bare.
  const realName = realProfile?.name?.split(" ")[0]?.trim();
  const ctxName = profile?.name?.split(" ")[0]?.trim();
  const greet = lang === "ar" ? "أهلًا" : "Hello";
  const displayName = realName || ctxName || (lang === "ar" ? "طالب" : "student");
  const name = displayName;

  const submitAI = () => {
    setAIPrefill(draft.trim());
    setScreen("ai");
  };

  const openPalette = () =>
    (window as typeof window & { __basOpenPalette?: () => void })
      .__basOpenPalette?.();

  return (
    <>
      <TopBar onOpenPalette={openPalette} />
      <div className="max-w-[1200px] mx-auto px-4 lg:px-8 py-6 lg:py-10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6">
          {/* Greeting + AI
              Mobile order: 1st (top, after greeting). Same as desktop.
              Phone reorder explanation: user requested matches above
              streak on the phone view, while keeping the desktop
              grid (AI col-8 next to Streak col-4) intact. We do that
              with `order-*` on mobile + `lg:order-*` to restore
              original DOM order at desktop breakpoint. */}
          <section className="order-1 lg:order-1 lg:col-span-8 bu-card p-6 lg:p-8">
            <div className="serif text-2xl lg:text-4xl text-ink-1 mb-1" style={{ fontStyle: "italic" }}>
              {greet}, {name}.
            </div>
            <p className="text-ink-3 text-sm lg:text-base mb-5">
              Ask AI (Omar) anything — study help, exam stress, planning, who to study with.
            </p>
            <div className="flex gap-2">
              <div className="flex-1 flex items-center gap-2 h-12 px-4 rounded-full bg-surface-2 border border-line focus-within:border-accent transition-colors">
                <Sparkles className="h-4 w-4 text-accent shrink-0" />
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") submitAI(); }}
                  placeholder="e.g. help me study for midterms in 3 days"
                  className="flex-1 bg-transparent outline-none text-ink-1 placeholder:text-ink-3 text-sm"
                />
              </div>
              <button
                type="button"
                onClick={submitAI}
                disabled={!draft.trim()}
                className="h-12 px-5 rounded-full bg-ink-1 text-surface-0 text-sm font-medium inline-flex items-center gap-2 disabled:opacity-50 active:scale-95 transition-transform"
              >
                Ask <ArrowRight className="h-4 w-4 rtl:rotate-180" />
              </button>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {["quiz me on DB joins", "plan my finals week", "who's a good algo partner?"].map(s => (
                <button
                  key={s}
                  onClick={() => { setAIPrefill(s); setScreen("ai"); }}
                  className="h-8 px-3 rounded-full text-xs text-ink-2 bg-surface-2 hover:bg-surface-3 border border-line"
                >
                  {s}
                </button>
              ))}
            </div>
          </section>

          {/* Streak
              Mobile order: 3rd (after Matches). Desktop order: 2nd
              (next to AI in the right column). */}
          <section className="order-3 lg:order-2 lg:col-span-4 bu-card p-6 flex flex-col gap-3">
            <div className="flex items-center gap-2 text-ink-3 text-xs uppercase tracking-wider">
              <Flame className="h-4 w-4" /> Streak
            </div>
            <div className="serif text-5xl text-ink-1" style={{ fontStyle: "italic" }}>
              {profile?.streak ?? 0}
            </div>
            <div className="text-ink-3 text-sm">days in a row. Keep it going.</div>
            <button
              type="button"
              onClick={guardedPost}
              className="mt-auto self-start h-9 px-4 rounded-full bg-accent text-white text-xs font-medium inline-flex items-center gap-1.5 active:scale-95 transition-transform"
            >
              <Plus className="h-3.5 w-3.5" /> Post for help
            </button>
          </section>

          {/* Match suggestions
              Mobile order: 2nd (right after AI — user wants this
              promoted). Desktop order: 3rd (back to its original
              row in the grid). */}
          <section className="order-2 lg:order-3 lg:col-span-8 bu-card p-6">
            <div className="flex items-baseline justify-between mb-4">
              <h2 className="serif text-xl text-ink-1" style={{ fontStyle: "italic" }}>New matches for you</h2>
              <button onClick={() => setScreen("discover")} className="h-9 px-4 rounded-full bg-accent-soft text-accent-ink text-sm font-semibold inline-flex items-center gap-1.5 hover:bg-accent hover:text-white transition-colors active:scale-95">View all <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" /></button>
            </div>
            <ul className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {(realMatches.length > 0
                ? realMatches.slice(0, 3).map(it => ({
                    id: it.profile.id,
                    name: it.profile.name || "Someone",
                    major: it.profile.major || "—",
                    score: it.score,
                    avatar_color: it.profile.avatar_color || "#5B4BF5",
                    reason: it.helpRequest ? `Asking: ${it.helpRequest.subject}` : (it.reasons[0] ?? ""),
                  }))
                : MATCH_STUBS.map(m => ({
                    id: m.id, name: m.name, major: m.major, score: m.score,
                    avatar_color: m.avatar_color, reason: m.reasons[0],
                  }))
              ).map(m => (
                <li key={m.id}>
                  <div className="bu-card-inset p-4 hover:border-accent transition-colors flex flex-col h-full">
                    <div className="flex items-center gap-3 mb-3">
                      <Avatar profile={m} size={44} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-ink-1 truncate">{m.name}</div>
                        <div className="text-xs text-ink-3 truncate">{m.major}</div>
                      </div>
                      <div className="text-xs font-mono text-accent">{m.score}%</div>
                    </div>
                    <div className="text-xs text-ink-3 line-clamp-2 mb-3 flex-1">{m.reason}</div>
                    <button
                      type="button"
                      onClick={async () => {
                        // Real connection insert + localStorage handoff.
                        // Fire-and-forget the DB write — UI lands on
                        // chat regardless. Connection row drives the
                        // thread list on the next refresh.
                        void startConversation({
                          id: m.id, name: m.name, avatar_color: m.avatar_color,
                        });
                        setScreen("connect");
                      }}
                      className="h-9 px-3 rounded-full bg-accent text-white text-xs font-medium inline-flex items-center justify-center gap-1.5 active:scale-95 transition-transform"
                    >
                      <Hand className="h-3.5 w-3.5" /> Say hi
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          {/* Today's rooms — order is the same on mobile + desktop */}
          <section className="order-4 lg:order-4 lg:col-span-4 bu-card p-6">
            <div className="flex items-baseline justify-between mb-4">
              <h2 className="serif text-xl text-ink-1" style={{ fontStyle: "italic" }}>Rooms today</h2>
              <button onClick={() => setScreen("rooms")} className="text-xs text-accent font-medium">See all</button>
            </div>
            <ul className="space-y-3">
              {(realRooms.length > 0
                ? realRooms.slice(0, 3).map(rr => ({
                    id: rr.id,
                    name: rr.subject,
                    when: [rr.date, rr.time].filter(Boolean).join(" · ") || "Soon",
                    members: rr.filled,
                  }))
                : ROOM_STUBS
              ).map(r => (
                <li key={r.id}>
                  <button onClick={() => setScreen("rooms")} className="w-full text-start flex items-start gap-3 py-2">
                    <div className="h-10 w-10 rounded-xl bg-accent-soft text-accent grid place-items-center shrink-0">
                      <Users className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-ink-1 truncate">{r.name}</div>
                      <div className="text-xs text-ink-3 truncate">{r.when} · {r.members} joined</div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          {/* Activity feed — real Supabase data: help_requests +
              group_rooms + connections, mixed by created_at desc.
              Always last, both desktop + mobile. */}
          <section className="order-5 lg:order-5 lg:col-span-12 bu-card p-6">
            <h2 className="serif text-xl text-ink-1 mb-4" style={{ fontStyle: "italic" }}>Recent activity</h2>
            {activityLoading ? (
              <ul className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <li key={i} className="flex items-start gap-3 py-2 border-b border-line last:border-0 animate-pulse">
                    <div className="h-9 w-9 rounded-full bg-surface-3" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3 w-2/3 bg-surface-3 rounded" />
                      <div className="h-3 w-1/4 bg-surface-3 rounded" />
                    </div>
                  </li>
                ))}
              </ul>
            ) : activity.length === 0 ? (
              <p className="text-sm text-ink-3 py-2">
                {user
                  ? "Quiet around here. Post for help or create a room to get the feed going."
                  : "Sign in to see what your peers are doing right now."}
              </p>
            ) : (
              <ul className="space-y-3">
                {activity.map(f => (
                  <li key={f.id} className="flex items-start gap-3 py-2 border-b border-line last:border-0">
                    <Avatar
                      profile={{
                        name: f.actor?.name ?? "Someone",
                        avatar_color: f.actor?.avatar_color ?? "#5B4BF5",
                        photo_mode: f.actor?.photo_mode === "photo" ? "photo" : "avatar",
                        photo_url: f.actor?.photo_url ?? null,
                      }}
                      size={36}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-ink-1">
                        <span className="font-semibold">{f.actor?.name ?? "Someone"}</span> {f.verb}
                      </div>
                      <div className="text-xs text-ink-3 mt-0.5">{relativeTime(f.createdAt)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

// ── stubs (signed-out fallback only — Home falls back here when a
// guest visits so the design still demos. Real users see live data.) ──
const MATCH_STUBS = [
  { id: "m1", name: "Omar Hamdan", major: "CS · Year 3", score: 94, avatar_color: "#5B4BF5",
    reasons: ["Same DB course · overlapping free blocks Tuesdays"] },
  { id: "m2", name: "Hanan Saleh", major: "Math · Year 2", score: 88, avatar_color: "#E27D60",
    reasons: ["Both prefer whiteboarding · similar pace"] },
  { id: "m3", name: "Yusuf Abadi", major: "CE · Year 3", score: 82, avatar_color: "#7CE0B6",
    reasons: ["Lives on campus · free Thu evenings"] },
];
const ROOM_STUBS = [
  { id: "r1", name: "Algorithms finals cram", when: "Today 7pm", members: 8 },
  { id: "r2", name: "Arabic lit discussion", when: "Tomorrow 4pm", members: 4 },
  { id: "r3", name: "Calc III drills", when: "Fri 2pm", members: 12 },
];

function relativeTime(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const d = Date.now() - t;
  if (d < 60_000) return "just now";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return `${Math.floor(d / 86_400_000)}d ago`;
}
