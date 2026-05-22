/**
 * useStudyMatch — client data hook for the AI-to-AI Study Match feature.
 *
 * Responsibilities:
 *   - `findCandidates()` — sources plausible study partners from
 *     public.profiles. Same university + similar academic year + has
 *     enough profile data to be matchable. Sorted by closeness of
 *     year and (when available) shared major.
 *   - `runMatch(candidateId)` — POSTs to /api/ai/study-match. The
 *     server runs an AI-to-AI dialogue and returns a structured
 *     compatibility verdict. We don't speak to ElevenLabs / OpenAI /
 *     Anthropic directly from here — everything goes through our
 *     edge function so the API key + memory access stays server-side.
 *
 * Privacy stance:
 *   The candidate list returned here is intentionally minimal — just
 *   what we'd already show in Discover (name, uni, major, year, bio,
 *   avatar). NO student_memory content is fetched client-side. The
 *   AI-to-AI verdict step is the only place memories get read, and
 *   that read is server-side via the service role; the verdict the
 *   user sees never quotes raw memory.
 *
 * State shape kept narrow — the screen does its own UI orchestration
 * (selected candidate, "currently running" state, etc.). This hook is
 * just data + actions.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { apiUrl } from "@/lib/apiBase";
import { useApp } from "@/context/AppContext";
import type { Profile } from "@/shared/types";

export interface CandidateRow {
  id: string;
  name: string;
  uni: string | null;
  major: string | null;
  year: number | null;
  bio: string | null;
  avatar_color: string | null;
  photo_url: string | null;
  photo_mode: "avatar" | "photo" | null;
  /** Optional — included in the Suggested ranking when present so
   *  candidates sharing actual courses with the viewer surface first. */
  subjects?: string[] | null;
  /** Computed client-side after ranking; surfaces in the UI as a
   *  "3 shared courses" hint on each row. Not from the DB. */
  sharedSubjects?: number;
}

export interface StudyMatchDialogueMessage {
  speaker: "tony_a" | "tony_b";
  text: string;
}

export interface StudyMatchVerdict {
  ok: boolean;
  score: number;
  verdict: "excellent" | "good" | "fair" | "poor";
  summary: string;
  strengths: string[];
  concerns: string[];
  suggestedPlan: string;
  /** Short staged dialogue (4-6 messages) that animates in the
   *  chat-theater UI before the verdict card is shown. Server always
   *  returns this; UI gracefully handles an empty array. */
  dialogue: StudyMatchDialogueMessage[];
  /** UUID of the candidate this verdict is about — surfaces in the
   *  UI so "Send a study request" wires to the right person. */
  candidateId: string;
  error?: string;
}

export interface UseStudyMatchResult {
  /** True while the candidate list is loading. */
  loading: boolean;
  /** The Suggested-tab candidates (same uni + year ±1). */
  candidates: CandidateRow[];
  /** Last error from candidate fetch / lookup / match run. */
  error: string | null;
  /** Re-pull the candidate list. */
  refresh: () => Promise<void>;

  /** True while an AI-to-AI dialogue is in flight. */
  matching: boolean;
  /** Run an AI-to-AI compatibility verdict against this candidate.
   *  Returns the verdict (also stored in state for UI access). */
  runMatch: (candidateId: string) => Promise<StudyMatchVerdict | null>;

  /** The most recent verdict, or null. The screen reads this to
   *  render the verdict card. */
  lastVerdict: StudyMatchVerdict | null;
  /** Clear the verdict card (e.g. when user goes back to candidates). */
  clearVerdict: () => void;

  /** Search by email — calls /api/ai/match-lookup. Returns the
   *  candidate when found + eligible; null with `error` set otherwise.
   *  Hard rate-limited server-side to deter enumeration; UI surfaces
   *  errors directly via the `error` state. */
  emailLookupLoading: boolean;
  emailLookupResult: CandidateRow | null;
  searchByEmail: (email: string) => Promise<CandidateRow | null>;
  clearEmailLookup: () => void;

  /** People the user has an existing connection with. Sourced from
   *  the `connections` table, same query shape as Messages. */
  chatPartnersLoading: boolean;
  chatPartners: CandidateRow[];
  refreshChatPartners: () => Promise<void>;
}

/** Year-proximity bound. Widened from the original ±1 so the
 *  Suggested list isn't empty when the user is in a year with few
 *  registered peers. The ranking step still surfaces close-year
 *  candidates first.
 *  Cross-year + cross-major matching is still the email-tab's job
 *  — Suggested stays anchored to same uni. */
const YEAR_PROXIMITY = 3;
/** Cap candidates to keep the list scannable; the AI is the heavy
 *  call, not the list query. */
const MAX_CANDIDATES = 24;

/** Count how many subjects the two arrays share, comparing
 *  case-insensitively. Used to surface peers actually taking the
 *  same courses as the viewer above peers who just share a uni. */
function sharedSubjectsCount(a: string[] | null | undefined, b: string[] | null | undefined): number {
  if (!a || !b || a.length === 0 || b.length === 0) return 0;
  const aSet = new Set(a.map((s) => s.trim().toLowerCase()).filter(Boolean));
  let n = 0;
  for (const s of b) {
    if (aSet.has((s || "").trim().toLowerCase())) n++;
  }
  return n;
}

/** profiles.year is stored as TEXT in the database. The Profile type
 *  says number|null but the row payload can arrive as "1", "Year 2",
 *  or "" depending on how the user entered it. Normalize defensively
 *  so the eligibility check works regardless. Returns null for empty
 *  or unparseable values. */
function parseYearText(val: unknown): number | null {
  if (typeof val === "number" && Number.isFinite(val) && val >= 1 && val <= 11) return val;
  if (typeof val !== "string") return null;
  const m = val.match(/\d+/);
  if (!m) return null;
  const n = parseInt(m[0], 10);
  if (!Number.isFinite(n) || n < 1 || n > 11) return null;
  return n;
}

export function useStudyMatch(): UseStudyMatchResult {
  const { profile } = useApp();
  const [candidates, setCandidates] = useState<CandidateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [matching, setMatching] = useState(false);
  const [lastVerdict, setLastVerdict] = useState<StudyMatchVerdict | null>(null);
  // Email-search tab state — kept separate from the Suggested list
  // so a failed lookup doesn't blow away the browse experience.
  const [emailLookupLoading, setEmailLookupLoading] = useState(false);
  const [emailLookupResult, setEmailLookupResult] = useState<CandidateRow | null>(null);
  // Chat-partners tab state — lazily loaded the first time the user
  // opens that tab to avoid pulling the connections list on every
  // Study Match visit.
  const [chatPartners, setChatPartners] = useState<CandidateRow[]>([]);
  const [chatPartnersLoading, setChatPartnersLoading] = useState(false);
  const [chatPartnersLoaded, setChatPartnersLoaded] = useState(false);

  /**
   * Pull candidates from public.profiles filtered for same uni +
   * year proximity. We exclude the current user via .neq. Profiles
   * without uni or year are skipped because matching against them
   * would always be low-quality and waste an LLM call.
   */
  const refresh = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const myUni = profile?.uni && profile.uni.trim() ? profile.uni : null;
      const myYear = parseYearText(profile?.year);
      if (!myUni || myYear === null) {
        setCandidates([]);
        setLoading(false);
        return;
      }
      // Because `profiles.year` is TEXT in the DB, we can't gte/lte
      // directly on a numeric range. Pull the broader uni-wide pool
      // and filter by year proximity in memory.
      const minYear = myYear - YEAR_PROXIMITY;
      const maxYear = myYear + YEAR_PROXIMITY;

      // RLS on profiles must allow authenticated SELECT for the
      // public columns; that's the same pattern Discover uses.
      // We pull `subjects` too so we can rank by shared-course count.
      // Year filter is applied client-side (column is TEXT, not int).
      const { data, error: qErr } = await supabase
        .from("profiles")
        .select("id,name,uni,major,year,bio,avatar_color,photo_url,photo_mode,subjects")
        .eq("uni", myUni)
        .neq("id", profile?.id ?? "00000000-0000-0000-0000-000000000000")
        .limit(MAX_CANDIDATES * 4);

      if (qErr) {
        setError(qErr.message);
        setCandidates([]);
        setLoading(false);
        return;
      }

      // Normalize each row: parse the text `year` to number|null
      // and treat empty-string uni/major as missing.
      const rawRows = (data ?? []) as Array<Record<string, unknown>>;
      const rows: CandidateRow[] = rawRows.map((r) => ({
        id: typeof r.id === "string" ? r.id : "",
        name: typeof r.name === "string" && r.name ? r.name : "Student",
        uni: typeof r.uni === "string" && r.uni.trim() ? r.uni : null,
        major: typeof r.major === "string" && r.major.trim() ? r.major : null,
        year: parseYearText(r.year),
        bio: typeof r.bio === "string" ? r.bio : null,
        avatar_color: typeof r.avatar_color === "string" ? r.avatar_color : null,
        photo_url: typeof r.photo_url === "string" ? r.photo_url : null,
        photo_mode: r.photo_mode === "photo" || r.photo_mode === "avatar"
          ? (r.photo_mode as "photo" | "avatar")
          : null,
        subjects: Array.isArray(r.subjects)
          ? (r.subjects as unknown[]).filter((s): s is string => typeof s === "string")
          : null,
      }));
      const myMajor = profile?.major ?? null;
      // Viewer subjects: we don't have a viewer-subjects field on the
      // AppContext profile shape, so we'd need a separate fetch to
      // include shared-subject ranking for the viewer. For now we
      // gracefully degrade — if the viewer has no subjects in their
      // profile, ranking falls back to year+major sort.
      const myProfileSubjectsReq = supabase
        .from("profiles")
        .select("subjects")
        .eq("id", profile?.id ?? "00000000-0000-0000-0000-000000000000")
        .maybeSingle();
      const myProfileRes = await myProfileSubjectsReq;
      const mySubjects: string[] | null = Array.isArray(myProfileRes.data?.subjects)
        ? (myProfileRes.data!.subjects as string[]).filter((s) => typeof s === "string")
        : null;

      // Rank candidates by (in order):
      //   1. shared subjects with the viewer (descending — most overlap first)
      //   2. major match (same major beats different major)
      //   3. year proximity (closer to viewer's year beats further)
      //   4. name (stable tiebreak)
      // This means a Year-4 CS-major student taking 2 of your courses
      // ranks ABOVE a Year-3 CS-major student taking none, which is
      // the right intent: shared courses = real study reason.
      // We also apply the year-proximity window here (instead of in
      // the DB query) because `year` is stored as TEXT — see above.
      const ranked = rows
        .filter((r) => r.id && r.uni && r.year !== null && r.year >= minYear && r.year <= maxYear)
        .map((r) => ({
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
          return (a.name || "").localeCompare(b.name || "");
        })
        .slice(0, MAX_CANDIDATES);

      setCandidates(ranked);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load candidates");
      setCandidates([]);
    } finally {
      setLoading(false);
    }
  }, [profile?.uni, profile?.year, profile?.major, profile?.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const runMatch = useCallback<UseStudyMatchResult["runMatch"]>(async (candidateId) => {
    setError(null);
    setMatching(true);
    setLastVerdict(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        setError("Sign in to run a match.");
        return null;
      }
      const res = await fetch(apiUrl("/api/ai/study-match"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ candidateUserId: candidateId }),
      });
      const json = await res.json().catch(() => null) as null | {
        ok: boolean;
        score?: number;
        verdict?: StudyMatchVerdict["verdict"];
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
        score: typeof json.score === "number" ? json.score : 0,
        verdict: json.verdict ?? "fair",
        summary: json.summary ?? "",
        strengths: Array.isArray(json.strengths) ? json.strengths : [],
        concerns: Array.isArray(json.concerns) ? json.concerns : [],
        suggestedPlan: json.suggested_plan ?? "",
        dialogue: Array.isArray(json.dialogue) ? json.dialogue : [],
      };
      setLastVerdict(verdict);
      return verdict;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
      return null;
    } finally {
      setMatching(false);
    }
  }, []);

  const clearVerdict = useCallback(() => setLastVerdict(null), []);

  /** Search-by-email tab: POST to /api/ai/match-lookup. Returns
   *  candidate or null. We DON'T throw — errors land on `error`. */
  const searchByEmail = useCallback<UseStudyMatchResult["searchByEmail"]>(async (email) => {
    setError(null);
    setEmailLookupLoading(true);
    setEmailLookupResult(null);
    try {
      const trimmed = email.trim().toLowerCase();
      if (!trimmed || !trimmed.includes("@")) {
        setError("Please enter a valid email.");
        return null;
      }
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        setError("Sign in to search by email.");
        return null;
      }
      const res = await fetch(apiUrl("/api/ai/match-lookup"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ email: trimmed }),
      });
      const json = await res.json().catch(() => null) as null | {
        ok: boolean;
        candidate?: CandidateRow;
        error?: string;
      };
      if (!res.ok || !json) {
        setError(json?.error || `Lookup failed (${res.status})`);
        return null;
      }
      if (!json.ok || !json.candidate) {
        setError(json.error || "No eligible match found.");
        return null;
      }
      setEmailLookupResult(json.candidate);
      return json.candidate;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
      return null;
    } finally {
      setEmailLookupLoading(false);
    }
  }, []);

  const clearEmailLookup = useCallback(() => {
    setEmailLookupResult(null);
    setError(null);
  }, []);

  /** From-chats tab: load people from `connections` where the
   *  current user is on either side. Same FK-aliased query the
   *  Messages screen uses (so RLS / FK constraints already work).
   *  Lazy — only runs when the user first opens the tab, then
   *  caches in state. */
  const refreshChatPartners = useCallback<UseStudyMatchResult["refreshChatPartners"]>(async () => {
    if (!profile?.id) return;
    setError(null);
    setChatPartnersLoading(true);
    try {
      const { data, error: qErr } = await supabase
        .from("connections")
        .select("partner_id, partner:profiles!connections_partner_id_fkey(id,name,uni,major,year,bio,avatar_color,photo_url,photo_mode)")
        .eq("user_id", profile.id);
      if (qErr) {
        setError(qErr.message);
        setChatPartners([]);
        return;
      }
      // Supabase types FK joins as arrays (because they could match
      // multiple rows in theory, even though the FK constraint
      // ensures 1:1 in practice). Normalize via `unknown` then
      // pick the first element if needed.
      const rows = (data ?? []) as unknown as Array<{
        partner_id: string;
        partner: CandidateRow | CandidateRow[] | null;
      }>;
      // Filter to eligible candidates only (uni + year set); dedupe
      // by partner id in case duplicate connections snuck in.
      const seen = new Set<string>();
      const result: CandidateRow[] = [];
      for (const r of rows) {
        const partner = Array.isArray(r.partner) ? r.partner[0] : r.partner;
        if (!partner) continue;
        if (!partner.uni || partner.year === null) continue;
        if (seen.has(partner.id)) continue;
        seen.add(partner.id);
        result.push(partner);
      }
      setChatPartners(result);
      setChatPartnersLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load chat partners");
      setChatPartners([]);
    } finally {
      setChatPartnersLoading(false);
    }
  }, [profile?.id]);

  // Auto-load chat partners the first time profile becomes available
  // (i.e. they're signed in) — so when the user opens the From Chats
  // tab there's no spinner delay.
  useEffect(() => {
    if (profile?.id && !chatPartnersLoaded && !chatPartnersLoading) {
      void refreshChatPartners();
    }
  }, [profile?.id, chatPartnersLoaded, chatPartnersLoading, refreshChatPartners]);

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
  };
}

/** Eligibility helper — surfaces a friendly "what's missing" message
 *  the screen can render BEFORE the user attempts a match. Mirrors
 *  the server-side check so the UI doesn't make a doomed API call.
 *
 *  `profile.year` may be stored as text on the backend (legacy schema),
 *  so we parse via parseYearText rather than `=== null` strict check —
 *  otherwise "1" or "Year 2" would look "missing" client-side. */
export function checkStudyMatchEligibility(profile: Profile | null | undefined): {
  ready: boolean;
  blocker?: "no_uni" | "no_year" | "no_profile";
  message?: string;
} {
  if (!profile) return { ready: false, blocker: "no_profile", message: "Complete your profile first." };
  if (!profile.uni || (typeof profile.uni === "string" && !profile.uni.trim())) {
    return { ready: false, blocker: "no_uni", message: "Add your university to your profile to use Study Match." };
  }
  if (parseYearText(profile.year) === null) {
    return { ready: false, blocker: "no_year", message: "Add your academic year to your profile to use Study Match." };
  }
  return { ready: true };
}
