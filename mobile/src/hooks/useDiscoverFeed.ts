/**
 * useDiscoverFeed — unified profiles + help-requests feed for Discover.
 *
 * v4 changes — bug fix the user reported: "you're showing everybody
 * who just signed in… I need the people who only post help show first
 * same thing that is going with the website."
 *
 *   - **FK alias fix.** The `help_requests → profiles` join was using
 *     the auto-named constraint `help_requests_user_id_fkey`, which
 *     the Supabase setup explicitly says to drop in favor of the
 *     manually-named `fk_help_requests_user`. With the wrong alias
 *     the join was silently returning rows whose `profile` was null
 *     (or just dropping the join silently in some PostgREST configs),
 *     and the `r.profile` defensive filter then dropped every
 *     help-ask before it could surface in the feed. Mobile users were
 *     seeing only profiles, never asks — even when their own ask DID
 *     appear on the website. Same alias the web uses now.
 *
 *   - **Tier-based sort (matches the web).** Previously we just put
 *     help-asks first, then "active" (anyone with content), then
 *     everyone else. The web uses three signal-based tiers:
 *       1. Help-askers (someone with an open help_request)
 *       2. Recently active (last_seen_at within 7 days)
 *       3. Everyone else
 *     Within each tier, newest first by the relevant timestamp
 *     (ask.created_at for tier 1, last_seen_at for tier 2,
 *     profile.created_at for tier 3). This matches the website 1:1.
 *
 *   - **Fallback include-askers loop.** Even if a poster's profile
 *     row isn't in the first 1000 we load, we still inject their card
 *     into the feed from the asks query's joined profile, so a
 *     legit ask never silently disappears. Same defense the web has.
 *
 * v3: filters object (uni/major/year), course filter via subjects[].
 * v2: realtime + dedup.
 *
 * Returns { items, profiles (raw), loading, error, refresh }.
 * Discover screen reads `items`; legacy callers can still read
 * `profiles` for backward compat.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { HelpRequest, Profile } from '@/lib/supabase';

export type FeedItem = {
  /** Stable ID — help-ask id when from help_requests, profile id otherwise. */
  id: string;
  /** Person to render in the card. */
  profile: Profile;
  /** Present when this row represents an open help ask. */
  helpRequest?: HelpRequest;
};

export type DiscoverFilters = {
  course?: string | null;
  uni?: string | null;
  major?: string | null;
  year?: string | null;
};

const RECENT_ACTIVE_MS = 7 * 24 * 3600 * 1000;

export function useDiscoverFeed(filters: DiscoverFilters | string | null = null) {
  // Backward compat: the old signature was `useDiscoverFeed(courseFilter)`.
  // Normalize both forms into the same `DiscoverFilters` shape.
  const f: DiscoverFilters = useMemo(() => {
    if (filters && typeof filters === 'object') return filters;
    return { course: (filters as string | null) ?? null };
  }, [filters]);

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [helpRequests, setHelpRequests] = useState<HelpRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const myId = sessionData.session?.user?.id;

      // ── Profiles ────────────────────────────────────────────────
      let pQuery = supabase
        .from('profiles')
        .select('*')
        .order('last_seen_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false, nullsFirst: false })
        .limit(1000); // Match the web cap so we pull every real user.

      if (myId) pQuery = pQuery.neq('id', myId);
      if (f.course) pQuery = pQuery.contains('subjects', [f.course]);
      // ilike (case-insensitive contains) for uni + major because the
      // Discover filter is a typeable text input. Year stays as exact
      // match (discrete enum: 1, 2, 3, 4, 5, grad).
      if (f.uni) pQuery = pQuery.ilike('uni', `%${f.uni}%`);
      if (f.major) pQuery = pQuery.ilike('major', `%${f.major}%`);
      if (f.year) pQuery = pQuery.eq('year', f.year);

      // ── Help requests (joined with poster profile) ──────────────
      // CRITICAL: the FK alias is `fk_help_requests_user`, NOT the
      // PostgREST-auto-derived `help_requests_user_id_fkey`. The
      // Supabase setup SQL explicitly drops the auto one to avoid
      // PGRST201 ambiguous-FK errors. Using the wrong alias silently
      // returns rows whose `profile` is null/missing, which our
      // defensive `.filter(r => !!r.profile)` then drops — making
      // asks invisible on mobile while the website worked fine.
      let hQuery = supabase
        .from('help_requests')
        .select(`
          id, user_id, subject, detail, meet_type, created_at,
          profile:profiles!fk_help_requests_user(*)
        `)
        .order('created_at', { ascending: false })
        .limit(30);

      if (myId) hQuery = hQuery.neq('user_id', myId);

      const [{ data: pData, error: pErr }, { data: hData, error: hErr }] =
        await Promise.all([pQuery, hQuery]);

      if (pErr) throw pErr;
      if (hErr) {
        // Asks are decorative — don't blank the whole feed if this
        // fails. Log and continue with profiles only.
        // eslint-disable-next-line no-console
        console.warn('[discover] help_requests query failed:', hErr.message);
      }

      setProfiles((pData as Profile[]) ?? []);

      // Defensive unwrap: Supabase foreign join sometimes returns the
      // related row as an array depending on cardinality inference.
      const reqs: HelpRequest[] = ((hData ?? []) as unknown as Array<HelpRequest & { profile?: Profile | Profile[] }>)
        .map(r => ({
          ...r,
          profile: Array.isArray(r.profile) ? r.profile[0] : r.profile,
        }))
        .filter(r => !!r.profile)
        // Apply uni/major/year/course filters on the joined profile so
        // help-asks respect the same selections as plain profiles.
        // uni + major use contains-match to mirror the ilike on the
        // profile query (typeable text input).
        .filter(r => !f.uni    || (r.profile?.uni ?? '').toLowerCase().includes(f.uni.toLowerCase()))
        .filter(r => !f.major  || (r.profile?.major ?? '').toLowerCase().includes(f.major.toLowerCase()))
        .filter(r => !f.year   || r.profile?.year === f.year)
        // Course filter on asks: match either the poster's subjects[]
        // OR the ask's subject text (it's the course name on the web
        // — e.g. "OOP Lab" — so this lets a course filter surface
        // matching asks even if the asker hasn't added the course to
        // their profile subjects[] yet).
        .filter(r => {
          if (!f.course) return true;
          const c = f.course.toLowerCase();
          const subjMatch = (r.profile?.subjects ?? []).some(s => s.toLowerCase().includes(c));
          const askMatch = (r.subject ?? '').toLowerCase().includes(c);
          return subjMatch || askMatch;
        });
      setHelpRequests(reqs);
    } catch (e) {
      setError((e as Error).message ?? 'Could not load Discover.');
    } finally {
      setLoading(false);
    }
  }, [f.course, f.uni, f.major, f.year]);

  useEffect(() => {
    load();

    // Realtime — refresh on any profile OR help_request change.
    // Per-mount channel name: same defense as useRooms — reusing a
    // fixed name causes "cannot add postgres_changes callbacks after
    // subscribe()" because the prior channel is still in the client's
    // internal map when the second mount re-runs (StrictMode + remount).
    const channelName = `discover-feed-${Math.random().toString(36).slice(2, 10)}`;
    channelRef.current = supabase
      .channel(channelName)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'help_requests' }, () => load())
      .subscribe();

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [load]);

  /**
   * The unified feed, sorted by SIGNAL TIER (same as the web):
   *   1. Help-askers — someone with an open help_request
   *   2. Recently active — last_seen_at within 7 days
   *   3. Everyone else
   * Within each tier: newest first by the relevant timestamp.
   *
   * Dedup: a person who appears in BOTH a help_request and the
   * profiles list is rendered ONCE, as their help-ask (tier 1). The
   * fallback loop below also injects asker profiles that didn't make
   * it into the first 1000 profiles — so a legit ask never silently
   * disappears just because their profile is past the cap or got
   * filtered upstream.
   */
  const items = useMemo<FeedItem[]>(() => {
    const now = Date.now();
    const askByUserId = new Map<string, HelpRequest>();
    for (const r of helpRequests) {
      if (r.profile) askByUserId.set(r.profile.id, r);
    }

    const isRecentlyActive = (p: Profile): boolean => {
      const ls = p.last_seen_at;
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
        return p.last_seen_at ? Date.parse(p.last_seen_at) : 0;
      }
      return p.created_at ? Date.parse(p.created_at) : 0;
    };

    const used = new Set<string>();
    const feed: FeedItem[] = [];

    // Main pass: every profile we loaded, deduped.
    for (const p of profiles) {
      if (used.has(p.id)) continue;
      used.add(p.id);
      const ask = askByUserId.get(p.id);
      feed.push({
        id: ask ? `hr-${ask.id}` : `p-${p.id}`,
        profile: p,
        helpRequest: ask,
      });
    }

    // Fallback: ALWAYS include help-askers, even when their profile
    // wasn't in the 1000 we loaded (RLS filtering, scale, or any
    // upstream drop). The asks query has its own profile join so we
    // have everything needed to add the missing card without
    // re-querying. Same pattern as the web's "ALWAYS include askers"
    // loop. Two posters silently vanishing was the exact bug the
    // user reported.
    for (const r of helpRequests) {
      const p = r.profile;
      if (!p) continue;
      if (used.has(p.id)) continue;
      used.add(p.id);
      feed.push({ id: `hr-${r.id}`, profile: p, helpRequest: r });
    }

    // Tiered sort: tier first (1 before 2 before 3), then recency
    // within tier (newest first).
    feed.sort((x, y) => {
      const tx = tierOf(x.profile);
      const ty = tierOf(y.profile);
      if (tx !== ty) return tx - ty;
      return tierTimestamp(y.profile, ty) - tierTimestamp(x.profile, tx);
    });

    return feed;
  }, [helpRequests, profiles]);

  return { items, profiles, helpRequests, loading, error, refresh: load };
}
