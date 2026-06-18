/**
 * useStudyMatch — mobile port of `src/features/match/useStudyMatch.ts`.
 *
 * Hits the SAME backend the website does — no separate mobile-only
 * server work was needed. We reuse the existing edge functions
 * (`/api/ai/study-match`, `/api/ai/match-lookup`) via `authedFetch`
 * which automatically attaches the Bearer token from
 * `getAccessToken()`.
 *
 * Differences from the web hook:
 *   • No `useApp()` context exists on mobile — the viewer's profile
 *     is fetched directly from `profiles` via the authed session id.
 *     We cache it inside the hook (`viewerProfile`), refresh when
 *     the session id changes.
 *   • `parseYearText` lives unchanged — `profiles.year` is TEXT in
 *     the DB and the mobile profile shape stores it as string too.
 *   • Ranking, FK-aliased `connections` join, email lookup, dialogue
 *     state shape — all identical to web. The screen on top of this
 *     hook is the only thing that changes shape (React Native primitives).
 *
 * Privacy stance is unchanged: only the public profile columns the
 * website's Discover already shows are pulled client-side. The
 * AI-to-AI dialogue + verdict happen server-side; no raw memory ever
 * leaves the edge function.
 */
import { useCallback, useEffect, useState } from 'react';
import { supabase, PROFILE_COLUMNS, type Profile } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { authedFetch } from '@/lib/api';

export interface CandidateRow {
  id: string;
  name: string;
  uni: string | null;
  major: string | null;
  year: number | null;
  bio: string | null;
  avatar_color: string | null;
  photo_url: string | null;
  photo_mode: 'avatar' | 'photo' | null;
  /** Subjects the candidate has on their profile. Used for ranking
   *  (more shared courses → higher in Suggested). */
  subjects?: string[] | null;
  /** Computed client-side after ranking; surfaces in the UI as a
   *  "3 shared" hint on each row. */
  sharedSubjects?: number;
}

export interface StudyMatchDialogueMessage {
  speaker: 'tony_a' | 'tony_b';
  text: string;
}

export interface StudyMatchVerdict {
  ok: boolean;
  score: number;
  verdict: 'excellent' | 'good' | 'fair' | 'poor';
  summary: string;
  strengths: string[];
  concerns: string[];
  suggestedPlan: string;
  dialogue: StudyMatchDialogueMessage[];
  /** Candidate this verdict is about — surfaces in the UI so the
   *  "Send a study request" button hits the right person. */
  candidateId: string;
  error?: string;
}

export interface UseStudyMatchResult {
  loading: boolean;
  candidates: CandidateRow[];
  error: string | null;
  refresh: () => Promise<void>;

  matching: boolean;
  runMatch: (candidateId: string) => Promise<StudyMatchVerdict | null>;

  lastVerdict: StudyMatchVerdict | null;
  clearVerdict: () => void;

  emailLookupLoading: boolean;
  emailLookupResult: CandidateRow | null;
  searchByEmail: (email: string) => Promise<CandidateRow | null>;
  clearEmailLookup: () => void;

  chatPartnersLoading: boolean;
  chatPartners: CandidateRow[];
  refreshChatPartners: () => Promise<void>;

  /** Viewer's own profile — exposed so the screen can render bubbles
   *  with the viewer's name + avatar in the dialogue theater. */
  viewerProfile: Profile | null;
}

/** Year-proximity bound (±N). Wide enough to keep the Suggested list
 *  from going empty in years with thin signups; ranking still surfaces
 *  closer-year candidates first. */
const YEAR_PROXIMITY = 3;
/** Cap candidates to keep the list scannable. */
const MAX_CANDIDATES = 24;

function sharedSubjectsCount(
  a: string[] | null | undefined,
  b: string[] | null | undefined,
): number {
  if (!a || !b || a.length === 0 || b.length === 0) return 0;
  const aSet = new Set(a.map(s => s.trim().toLowerCase()).filter(Boolean));
  let n = 0;
  for (const s of b) {
    if (aSet.has((s || '').trim().toLowerCase())) n++;
  }
  return n;
}

/** `profiles.year` is TEXT in the DB ("1", "Year 2", or ""), so we
 *  normalize defensively. Returns null for empty / unparseable values. */
export function parseYearText(val: unknown): number | null {
  if (typeof val === 'number' && Number.isFinite(val) && val >= 1 && val <= 11) return val;
  if (typeof val !== 'string') return null;
  const m = val.match(/\d+/);
  if (!m) return null;
  const n = parseInt(m[0], 10);
  if (!Number.isFinite(n) || n < 1 || n > 11) return null;
  return n;
}

export function useStudyMatch(): UseStudyMatchResult {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const [viewerProfile, setViewerProfile] = useState<Profile | null>(null);

  const [candidates, setCandidates] = useState<CandidateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [matching, setMatching] = useState(false);
  const [lastVerdict, setLastVerdict] = useState<StudyMatchVerdict | null>(null);

  const [emailLookupLoading, setEmailLookupLoading] = useState(false);
  const [emailLookupResult, setEmailLookupResult] = useState<CandidateRow | null>(null);

  const [chatPartners, setChatPartners] = useState<CandidateRow[]>([]);
  const [chatPartnersLoading, setChatPartnersLoading] = useState(false);
  const [chatPartnersLoaded, setChatPartnersLoaded] = useState(false);

  // ── Viewer profile — single source of truth used by refresh ranking
  //    + by the screen's chat bubbles for the viewer's own name/avatar.
  useEffect(() => {
    let cancelled = false;
    if (!userId) {
      setViewerProfile(null);
      return;
    }
    (async () => {
      const { data } = await supabase
        .from('profiles')
        .select(PROFILE_COLUMNS)
        .eq('id', userId)
        .maybeSingle();
      if (!cancelled) setViewerProfile((data as Profile | null) ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  /**
   * Pull Suggested candidates — same-uni, year ±YEAR_PROXIMITY, then
   * ranked by shared subjects → major → year proximity → name.
   * If we don't have the viewer's uni/year yet, returns empty (the
   * screen renders the eligibility blocker instead).
   */
  const refresh = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const myUni = viewerProfile?.uni && viewerProfile.uni.trim() ? viewerProfile.uni : null;
      const myYear = parseYearText(viewerProfile?.year);
      if (!myUni || myYear === null) {
        setCandidates([]);
        setLoading(false);
        return;
      }
      const minYear = myYear - YEAR_PROXIMITY;
      const maxYear = myYear + YEAR_PROXIMITY;

      // `year` is TEXT in the DB so we can't gte/lte server-side —
      // pull a wider pool then year-filter in memory.
      const { data, error: qErr } = await supabase
        .from('profiles')
        .select('id,name,uni,major,year,bio,avatar_color,photo_url,photo_mode,subjects')
        .eq('uni', myUni)
        .neq('id', viewerProfile?.id ?? '00000000-0000-0000-0000-000000000000')
        .limit(MAX_CANDIDATES * 4);

      if (qErr) {
        setError(qErr.message);
        setCandidates([]);
        setLoading(false);
        return;
      }

      const rawRows = (data ?? []) as Array<Record<string, unknown>>;
      const rows: CandidateRow[] = rawRows.map(r => ({
        id: typeof r.id === 'string' ? r.id : '',
        name: typeof r.name === 'string' && r.name ? r.name : 'Student',
        uni: typeof r.uni === 'string' && r.uni.trim() ? r.uni : null,
        major: typeof r.major === 'string' && r.major.trim() ? r.major : null,
        year: parseYearText(r.year),
        bio: typeof r.bio === 'string' ? r.bio : null,
        avatar_color: typeof r.avatar_color === 'string' ? r.avatar_color : null,
        photo_url: typeof r.photo_url === 'string' ? r.photo_url : null,
        photo_mode:
          r.photo_mode === 'photo' || r.photo_mode === 'avatar'
            ? (r.photo_mode as 'photo' | 'avatar')
            : null,
        subjects: Array.isArray(r.subjects)
          ? (r.subjects as unknown[]).filter((s): s is string => typeof s === 'string')
          : null,
      }));

      const myMajor = viewerProfile?.major ?? null;
      const mySubjects: string[] | null = Array.isArray(viewerProfile?.subjects)
        ? (viewerProfile!.subjects as string[]).filter(s => typeof s === 'string')
        : null;

      // Rank by:
      //   1. shared subjects with viewer (desc — biggest overlap first)
      //   2. major match (same major beats different)
      //   3. year proximity (closer year beats further)
      //   4. name (stable tiebreak)
      const ranked = rows
        .filter(r => r.id && r.uni && r.year !== null && r.year >= minYear && r.year <= maxYear)
        .map(r => ({
          ...r,
          sharedSubjects: sharedSubjectsCount(mySubjects, r.subjects ?? null),
        }))
        .sort((a, b) => {
          if ((a.sharedSubjects ?? 0) !== (b.sharedSubjects ?? 0)) {
            return (b.sharedSubjects ?? 0) - (a.sharedSubjects ?? 0);
          }
          const mA = myMajor && a.major && a.major === myMajor ? 0 : 1;
          const mB = myMajor && b.major && b.major === myMajor ? 0 : 1;
          if (mA !== mB) return mA - mB;
          const yA = Math.abs((a.year ?? 0) - myYear);
          const yB = Math.abs((b.year ?? 0) - myYear);
          if (yA !== yB) return yA - yB;
          return (a.name || '').localeCompare(b.name || '');
        })
        .slice(0, MAX_CANDIDATES);

      setCandidates(ranked);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load candidates");
      setCandidates([]);
    } finally {
      setLoading(false);
    }
  }, [viewerProfile?.uni, viewerProfile?.year, viewerProfile?.major, viewerProfile?.id, viewerProfile]);

  useEffect(() => {
    if (viewerProfile !== null) void refresh();
  }, [refresh, viewerProfile]);

  const runMatch = useCallback<UseStudyMatchResult['runMatch']>(async candidateId => {
    setError(null);
    setMatching(true);
    setLastVerdict(null);
    try {
      const res = await authedFetch('/api/ai/study-match', {
        method: 'POST',
        body: JSON.stringify({ candidateUserId: candidateId }),
      });
      const json = (await res.json().catch(() => null)) as null | {
        ok: boolean;
        score?: number;
        verdict?: StudyMatchVerdict['verdict'];
        summary?: string;
        strengths?: string[];
        concerns?: string[];
        suggested_plan?: string;
        dialogue?: StudyMatchDialogueMessage[];
        error?: string;
      };

      if (!res.ok || !json) {
        const errMsg = json?.error || `Matchmaker failed (${res.status})`;
        setError(errMsg);
        return null;
      }
      if (!json.ok) {
        setError(json.error || "Matchmaker couldn't produce a verdict.");
        return null;
      }

      const verdict: StudyMatchVerdict = {
        ok: true,
        candidateId,
        score: typeof json.score === 'number' ? json.score : 0,
        verdict: json.verdict ?? 'fair',
        summary: json.summary ?? '',
        strengths: Array.isArray(json.strengths) ? json.strengths : [],
        concerns: Array.isArray(json.concerns) ? json.concerns : [],
        suggestedPlan: json.suggested_plan ?? '',
        dialogue: Array.isArray(json.dialogue) ? json.dialogue : [],
      };
      setLastVerdict(verdict);
      return verdict;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
      return null;
    } finally {
      setMatching(false);
    }
  }, []);

  const clearVerdict = useCallback(() => setLastVerdict(null), []);

  /** By-email tab — POST to /api/ai/match-lookup, rate-limited
   *  server-side. */
  const searchByEmail = useCallback<UseStudyMatchResult['searchByEmail']>(async email => {
    setError(null);
    setEmailLookupLoading(true);
    setEmailLookupResult(null);
    try {
      const trimmed = email.trim().toLowerCase();
      if (!trimmed || !trimmed.includes('@')) {
        setError('Please enter a valid email.');
        return null;
      }
      const res = await authedFetch('/api/ai/match-lookup', {
        method: 'POST',
        body: JSON.stringify({ email: trimmed }),
      });
      const json = (await res.json().catch(() => null)) as null | {
        ok: boolean;
        candidate?: CandidateRow;
        error?: string;
      };
      if (!res.ok || !json) {
        setError(json?.error || `Lookup failed (${res.status})`);
        return null;
      }
      if (!json.ok || !json.candidate) {
        setError(json.error || 'No eligible match found.');
        return null;
      }
      setEmailLookupResult(json.candidate);
      return json.candidate;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
      return null;
    } finally {
      setEmailLookupLoading(false);
    }
  }, []);

  const clearEmailLookup = useCallback(() => {
    setEmailLookupResult(null);
    setError(null);
  }, []);

  /** From-chats tab — load people from `connections` where the
   *  current user is on the left side. Same FK-aliased shape the
   *  web hook uses (and the mobile useConversations hook). */
  const refreshChatPartners = useCallback<UseStudyMatchResult['refreshChatPartners']>(async () => {
    if (!userId) return;
    setError(null);
    setChatPartnersLoading(true);
    try {
      const { data, error: qErr } = await supabase
        .from('connections')
        .select(
          'partner_id, partner:profiles!connections_partner_id_fkey(id,name,uni,major,year,bio,avatar_color,photo_url,photo_mode)',
        )
        .eq('user_id', userId);
      if (qErr) {
        setError(qErr.message);
        setChatPartners([]);
        return;
      }
      const rows = (data ?? []) as unknown as Array<{
        partner_id: string;
        partner: PartnerRow | PartnerRow[] | null;
      }>;
      // Dedupe + drop non-eligible (no uni / no year).
      const seen = new Set<string>();
      const result: CandidateRow[] = [];
      for (const r of rows) {
        const raw = Array.isArray(r.partner) ? r.partner[0] : r.partner;
        if (!raw) continue;
        const parsedYear = parseYearText(raw.year);
        if (!raw.uni || parsedYear === null) continue;
        if (seen.has(raw.id)) continue;
        seen.add(raw.id);
        result.push({
          id: raw.id,
          name: raw.name && raw.name.trim() ? raw.name : 'Student',
          uni: raw.uni,
          major: raw.major,
          year: parsedYear,
          bio: raw.bio,
          avatar_color: raw.avatar_color,
          photo_url: raw.photo_url,
          photo_mode:
            raw.photo_mode === 'photo' || raw.photo_mode === 'avatar'
              ? raw.photo_mode
              : null,
        });
      }
      setChatPartners(result);
      setChatPartnersLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load chat partners");
      setChatPartners([]);
    } finally {
      setChatPartnersLoading(false);
    }
  }, [userId]);

  // Auto-load chat partners on first sign-in so the From Chats tab
  // doesn't spin the first time the user opens it.
  useEffect(() => {
    if (userId && !chatPartnersLoaded && !chatPartnersLoading) {
      void refreshChatPartners();
    }
  }, [userId, chatPartnersLoaded, chatPartnersLoading, refreshChatPartners]);

  return {
    loading,
    candidates,
    error,
    refresh,
    matching,
    runMatch,
    lastVerdict,
    clearVerdict,
    emailLookupLoading,
    emailLookupResult,
    searchByEmail,
    clearEmailLookup,
    chatPartnersLoading,
    chatPartners,
    refreshChatPartners,
    viewerProfile,
  };
}

/** Shape of a row returned from the connections-with-partner join.
 *  `year` arrives as TEXT (DB column type) — we parse to number on
 *  ingest before pushing into CandidateRow. */
type PartnerRow = {
  id: string;
  name: string | null;
  uni: string | null;
  major: string | null;
  year: string | null;
  bio: string | null;
  avatar_color: string | null;
  photo_url: string | null;
  photo_mode: string | null;
};

/** Eligibility helper — surfaces a friendly "what's missing" message
 *  the screen renders BEFORE the user attempts a match. Mirrors the
 *  server-side check so we don't make doomed API calls.
 *
 *  Pass the viewerProfile from the hook (or a freshly-loaded Profile). */
export function checkStudyMatchEligibility(profile: Profile | null | undefined): {
  ready: boolean;
  blocker?: 'no_uni' | 'no_year' | 'no_profile';
  message?: string;
} {
  if (!profile) {
    return {
      ready: false,
      blocker: 'no_profile',
      message: 'Complete your profile first.',
    };
  }
  if (!profile.uni || (typeof profile.uni === 'string' && !profile.uni.trim())) {
    return {
      ready: false,
      blocker: 'no_uni',
      message: 'Add your university to your profile to use Study Match.',
    };
  }
  if (parseYearText(profile.year) === null) {
    return {
      ready: false,
      blocker: 'no_year',
      message: 'Add your academic year to your profile to use Study Match.',
    };
  }
  return { ready: true };
}
