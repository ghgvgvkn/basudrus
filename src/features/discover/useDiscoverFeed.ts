/**
 * useDiscoverFeed — ONE unified feed for Discover.
 *
 * Returns a list of `FeedItem` where each item is a profile,
 * optionally carrying a `helpRequest` when that person has an open
 * ask. Same shape for both "just a student looking to match" and
 * "student asking for help with CS 301" — the UI renders them with
 * one card component (see UnifiedMatchCard).
 *
 * Behaviour:
 *   - Anon viewer → empty feed (profiles + help_requests both need
 *     authenticated RLS). The card UI shows a sign-in CTA.
 *   - Authed viewer → pulls ~30 profiles (excluding self) + 24
 *     open help_requests, zips them together so anyone with a
 *     recent ask floats to the top, and pads with non-asking
 *     profiles sorted by activity.
 *   - Respects `courseFilter`: only show people whose subjects
 *     array contains it, or whose help_request.subject matches.
 *
 * Safety: reads only. No writes.
 */
import { useEffect, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import type { Profile, HelpRequest } from "@/lib/supabase";
import { computeMatch } from "@/features/match/computeScore";
import type { PersonalityAnswers } from "@/features/match/personalityQuestions";
import { useUserBlocks } from "@/features/safety/useUserBlocks";

export interface FeedItem {
  kind: "profile" | "help";
  id: string;               // stable id for React keys (profile.id for profiles, `help:${req.id}` for asks)
  profile: Profile;
  helpRequest?: HelpRequest;
  /** Demo match score for ranking. Real scoring lives server-side. */
  score: number;
  reasons: string[];
}

// demoScore + demoReasons removed — match scoring + reasons now come
// from features/match/computeScore.ts using real profile data and
// match_quiz.answers. See computeMatch() above.

export function useDiscoverFeed(opts: {
  viewerId: string | null;
  courseFilter: string | null;
  uniFilter: string;
  majorFilter: string;
}) {
  const { viewerId, courseFilter, uniFilter, majorFilter } = opts;
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<"blocked" | "offline" | null>(null);
  // Block list — when the viewer (or someone else) blocks a user, that
  // user is filtered out of the feed entirely. The hook listens to
  // bu:user-blocked / bu:user-unblocked events so a fresh block hides
  // them immediately without a manual refresh.
  const { blockedSet } = useUserBlocks();
  // Bumped by `bu:posts-changed` from PostComposer (and anywhere else
  // that mutates help_requests in the future). The fetch effect below
  // depends on this so we re-pull the feed and the user's brand-new
  // ask shows up at the top without a manual refresh.
  const [refreshNonce, setRefreshNonce] = useState(0);

  useEffect(() => {
    const onChange = () => setRefreshNonce((n) => n + 1);
    window.addEventListener("bu:posts-changed", onChange);
    return () => window.removeEventListener("bu:posts-changed", onChange);
  }, []);

  // Realtime subscriptions: bump `refreshNonce` when ANYTHING the
  // feed cares about changes, so newly-signed-up students + freshly-
  // posted help requests appear without a manual refresh.
  //
  // Why we re-fetch instead of patching state in-place:
  //   1. Tier sort (askers → recently-active → rest) depends on the
  //      whole list — a single insert could re-rank everyone.
  //   2. Match scoring depends on the viewer's quiz answers + the
  //      candidate's quiz answers. Re-pulling keeps both sides in
  //      lockstep without per-event scoring.
  //   3. Re-fetch is cheap (~300KB, ~600 profile rows) and runs at
  //      most once per insert. Bursts coalesce naturally because
  //      React batches the setRefreshNonce calls into one render.
  //
  // Channel name uses a per-mount UUID so React StrictMode's double-
  // invocation in dev doesn't try to re-subscribe a cached channel
  // (Supabase realtime caches by name and throws "cannot add
  // postgres_changes callbacks ... after subscribe()" otherwise —
  // same issue we hit on messages + notifications earlier).
  useEffect(() => {
    if (!supabase) return;
    let channel: RealtimeChannel | null = null;
    const channelName = `discover-feed-${
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2)
    }`;

    const bump = () => setRefreshNonce((n) => n + 1);

    channel = supabase
      .channel(channelName)
      // New users joining → show up in Discover.
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "profiles" },
        bump,
      )
      // Profile edits (uni / major / photo) → update the card.
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles" },
        bump,
      )
      // New help requests → push the asker into tier 1.
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "help_requests" },
        bump,
      )
      // Help request deletes (e.g. host marks as resolved) → re-rank.
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "help_requests" },
        bump,
      )
      .subscribe();

    return () => {
      if (channel) void supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      if (!supabase) {
        if (!cancelled) { setItems([]); setError("offline"); setLoading(false); }
        return;
      }

      try {
        // Pull profiles (sans self) + help_requests in parallel.
        // 1000 cap is ~1.5x the current real-user count (608) — pulls
        // every real user with headroom for growth, costs ~300KB on
        // the wire which is fine. The DB pre-sorts by last_seen_at
        // so tier 2 arrives in correct order; the JS pass below
        // promotes help-askers into tier 1.
        const profilesReq = supabase
          .from("profiles")
          .select("*")
          .neq("id", viewerId ?? "00000000-0000-0000-0000-000000000000")
          .order("last_seen_at", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false })
          .limit(1000);

        // FK alias = the actual constraint name in Postgres
        // (`fk_help_requests_user`), not the column-derived default.
        const asksReq = supabase
          .from("help_requests")
          .select(`
            id, user_id, subject, detail, meet_type, created_at,
            profile:profiles!fk_help_requests_user(*)
          `)
          .order("created_at", { ascending: false })
          .limit(30);

        // Pull all match_quiz answer rows for everyone we might need
        // to score. RLS allows authenticated users to SELECT their
        // own match_quiz row, but we also need everyone else's so the
        // scoring pass can compare. The schema's SELECT policy on
        // match_quiz needs to permit authenticated reads — if it
        // doesn't, this query returns [] and we fall back to the
        // profile-only score (still meaningful, capped at 18).
        const quizReq = supabase
          .from("match_quiz")
          .select("user_id, answers");

        const [{ data: profiles, error: pErr },
               { data: asks,     error: aErr },
               { data: quizzes,  error: qErr }] = await Promise.all([profilesReq, asksReq, quizReq]);
        if (cancelled) return;

        // Profiles query is the load-bearing one — if it fails, the
        // whole feed is empty and we surface offline. The asks query
        // is decorative — a bad join shouldn't blank the page, just
        // skip the help-asks. (This was the original bug: a wrong
        // FK alias on `asks` was killing the entire feed.)
        if (pErr) {
          if (import.meta.env.DEV) console.warn("[useDiscoverFeed] profiles error:", pErr);
          setError("offline");
          setItems([]);
          setLoading(false);
          return;
        }
        if (aErr && import.meta.env.DEV) {
          console.warn("[useDiscoverFeed] asks error:", aErr);
        }

        // Drop blocked users + askers BEFORE any further processing so
        // the blocked person never appears in any tier or ranking.
        const profileRows = ((profiles ?? []) as Profile[])
          .filter((p) => !blockedSet.has(p.id));
        const askRows = aErr
          ? []
          : ((asks ?? []) as unknown as (HelpRequest & { profile: Profile | null })[])
              .filter((a) => !!a.profile && a.user_id !== viewerId && !blockedSet.has(a.user_id));

        // Build a map of user_id → personality answers so the scoring
        // pass below has O(1) access. RLS may return only the viewer's
        // own row in restricted setups — that still gives us a base
        // score for everyone (capped at 18 from profile dims), with
        // 1.0 contribution wherever the candidate's answer is unknown
        // would actually inflate scores. computeScore.ts handles a
        // null candidate map by giving a neutral 0.5 per personality
        // question (50% credit), which is honest about uncertainty.
        const quizByUserId = new Map<string, PersonalityAnswers>();
        if (!qErr) {
          for (const row of (quizzes ?? []) as Array<{ user_id: string; answers: PersonalityAnswers | null }>) {
            if (row.answers) quizByUserId.set(row.user_id, row.answers);
          }
        } else if (import.meta.env.DEV) {
          console.warn("[useDiscoverFeed] match_quiz error:", qErr);
        }

        // The viewer's own profile + answers — needed by computeMatch
        // for every candidate. We pull from the loaded profileRows
        // first (cheap), but the viewer is filtered out of profileRows
        // by the .neq above, so we re-fetch their row separately.
        let viewerRow: Profile | null = null;
        let viewerAnswers: PersonalityAnswers | null = null;
        if (viewerId) {
          viewerAnswers = quizByUserId.get(viewerId) ?? null;
          const { data: meRow } = await supabase
            .from("profiles")
            .select("uni, major, year, subjects")
            .eq("id", viewerId)
            .maybeSingle();
          if (cancelled) return;
          viewerRow = (meRow ?? null) as Profile | null;
        }

        // RLS returns [] for anon viewers. Distinguish "no data" from
        // "need auth" — if we have a viewerId but got nothing back,
        // it's likely an empty DB, not RLS.
        if (profileRows.length === 0 && askRows.length === 0 && !viewerId) {
          setError("blocked");
          setItems([]);
          setLoading(false);
          return;
        }

        // Apply client-side filters. Server-side filtering would be
        // faster at scale but for a preview this keeps the code
        // obvious and testable.
        // Filters: course is a substring match (course names vary in
        // formatting, "CS 301" vs "CS301"). University + Major are
        // case-insensitive equality — the filters now come from the
        // canonical Supabase `universities` / `uni_majors` tables, so
        // exact match is what we want.
        const norm = (s: string) => s.trim().toLowerCase();
        const matchesCourse = (p: Profile) =>
          !courseFilter ||
          norm(p.course ?? "").includes(norm(courseFilter)) ||
          (p.subjects ?? []).some(s => norm(s).includes(norm(courseFilter)));
        const matchesUni = (p: Profile) =>
          !uniFilter || norm(p.uni ?? "") === norm(uniFilter);
        const matchesMajor = (p: Profile) =>
          !majorFilter || norm(p.major ?? "") === norm(majorFilter);
        const keep = (p: Profile) => matchesCourse(p) && matchesUni(p) && matchesMajor(p);

        // ── Build the feed in TIERS, by real signal ──
        //
        // 1. Help-askers   — someone with an open help_request
        // 2. Recently active — last_seen_at < 7 days
        // 3. Everyone else
        //
        // Within each tier: newest first using real Supabase
        // timestamps. NO photo-priority tier — photo upload is
        // not a sort signal in this redesign anymore.
        const askByUserId = new Map<string, HelpRequest>();
        for (const a of askRows) askByUserId.set(a.user_id, a);

        const RECENT_ACTIVE_MS = 7 * 86_400_000;
        const now = Date.now();
        type ProfileWithTs = Profile & { last_seen_at?: string | null };
        const isRecentlyActive = (p: Profile): boolean => {
          const ls = (p as ProfileWithTs).last_seen_at;
          if (!ls) return false;
          const t = Date.parse(ls);
          return Number.isFinite(t) && (now - t) <= RECENT_ACTIVE_MS;
        };

        const tierOf = (p: Profile): 1 | 2 | 3 => {
          if (askByUserId.has(p.id)) return 1;
          if (isRecentlyActive(p)) return 2;
          return 3;
        };

        const tierTimestamp = (p: Profile, tier: 1 | 2 | 3): number => {
          if (tier === 1) {
            const ask = askByUserId.get(p.id);
            return ask ? Date.parse(ask.created_at) : 0;
          }
          if (tier === 2) {
            const ls = (p as ProfileWithTs).last_seen_at;
            return ls ? Date.parse(ls) : 0;
          }
          return Date.parse(p.created_at) || 0;
        };

        const usedIds = new Set<string>();
        const feed: FeedItem[] = [];

        for (const p of profileRows) {
          if (usedIds.has(p.id)) continue;
          if (!keep(p)) continue;
          usedIds.add(p.id);
          const tier = tierOf(p);
          const ask = askByUserId.get(p.id);

          // Compute the real match score using personality + profile
          // weights from computeScore.ts. When the viewer hasn't taken
          // the quiz yet (or hasn't filled their profile), the function
          // returns a sensible baseline rather than 0 — neutral 0.5 per
          // personality question + whatever profile dims are populated.
          const candidateAnswers = quizByUserId.get(p.id) ?? null;
          const match = computeMatch({
            viewerAnswers,
            candidateAnswers,
            viewer: {
              uni: viewerRow?.uni ?? null,
              major: viewerRow?.major ?? null,
              year: viewerRow?.year ?? null,
              subjects: viewerRow?.subjects ?? null,
            },
            candidate: {
              uni: p.uni,
              major: p.major,
              year: p.year,
              subjects: p.subjects,
            },
          });

          // Help-askers get a small visibility boost on the displayed
          // % (capped at 99) so a great-match asker still looks more
          // urgent than a great-match non-asker.
          const askBoost = ask ? Math.min(99, match.score + 5) : match.score;

          // If the viewer hasn't completed the quiz, the score is
          // floored at the profile contribution + 41 neutral points
          // from personality (11 questions × ~3.7 average). Anchoring
          // a reasonable minimum for new users keeps the feed from
          // looking like 30% match across the board.
          const displayScore = Math.max(askBoost, viewerAnswers ? 0 : 55);

          feed.push({
            kind: ask ? "help" : "profile",
            id: ask ? `help:${ask.id}` : p.id,
            profile: p,
            helpRequest: ask,
            score: tier === 1
              ? Math.max(displayScore, 80)   // tier 1 (asker) floor 80
              : displayScore,
            reasons: ask
              ? [`Asking: ${ask.subject}`, ...match.reasons.slice(0, 2)]
              : match.reasons,
          });
        }

        // Also include help-askers whose profile passed the
        // course-filter check via the ask itself even when their
        // profile didn't otherwise match.
        if (courseFilter) {
          for (const a of askRows) {
            const p = a.profile!;
            if (usedIds.has(p.id)) continue;
            if (!a.subject.toLowerCase().includes(courseFilter.toLowerCase())) continue;
            usedIds.add(p.id);
            const candidateAnswers = quizByUserId.get(p.id) ?? null;
            const m = computeMatch({
              viewerAnswers,
              candidateAnswers,
              viewer: {
                uni: viewerRow?.uni ?? null,
                major: viewerRow?.major ?? null,
                year: viewerRow?.year ?? null,
                subjects: viewerRow?.subjects ?? null,
              },
              candidate: {
                uni: p.uni, major: p.major, year: p.year, subjects: p.subjects,
              },
            });
            feed.push({
              kind: "help",
              id: `help:${a.id}`,
              profile: p,
              helpRequest: a,
              score: Math.max(80, Math.min(99, m.score + 5)),
              reasons: [`Asking: ${a.subject}`, ...m.reasons.slice(0, 2)],
            });
          }
        }

        // Tiered sort: tier first, then recency within tier.
        feed.sort((x, y) => {
          const tx = tierOf(x.profile);
          const ty = tierOf(y.profile);
          if (tx !== ty) return tx - ty;        // 1 before 2 before 3
          return tierTimestamp(y.profile, ty) - tierTimestamp(x.profile, tx);
        });

        setItems(feed);
        setLoading(false);
      } catch {
        if (cancelled) return;
        setError("offline");
        setItems([]);
        setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [viewerId, courseFilter, uniFilter, majorFilter, refreshNonce, blockedSet]);

  return { items, loading, error };
}
