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
}

export interface StudyMatchVerdict {
  ok: boolean;
  score: number;
  verdict: "excellent" | "good" | "fair" | "poor";
  summary: string;
  strengths: string[];
  concerns: string[];
  suggestedPlan: string;
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

/** Tightness of the year-proximity filter. Same uni + year diff <= 1
 *  catches the most useful matches (same year + neighbors). Loosen
 *  later if candidate pool is thin. */
const YEAR_PROXIMITY = 1;
/** Cap candidates to keep the list scannable; the AI is the heavy
 *  call, not the list query. */
const MAX_CANDIDATES = 24;

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
      const myUni = profile?.uni ?? null;
      const myYear = typeof profile?.year === "number" ? profile.year : null;
      if (!myUni || myYear === null) {
        setCandidates([]);
        setLoading(false);
        return;
      }
      const minYear = myYear - YEAR_PROXIMITY;
      const maxYear = myYear + YEAR_PROXIMITY;

      // RLS on profiles must allow authenticated SELECT for the
      // public columns (id, name, uni, major, year, bio, avatar);
      // that's already the case in the existing Discover query.
      const { data, error: qErr } = await supabase
        .from("profiles")
        .select("id,name,uni,major,year,bio,avatar_color,photo_url,photo_mode")
        .eq("uni", myUni)
        .gte("year", minYear)
        .lte("year", maxYear)
        .neq("id", profile?.id ?? "00000000-0000-0000-0000-000000000000")
        .not("year", "is", null)
        .limit(MAX_CANDIDATES * 2);

      if (qErr) {
        setError(qErr.message);
        setCandidates([]);
        setLoading(false);
        return;
      }

      const rows = (data ?? []) as CandidateRow[];
      // Sort: exact year first, then by major match, then by name.
      const myMajor = profile?.major ?? null;
      const ranked = rows
        .filter((r) => r.id && r.uni && r.year !== null)
        .sort((a, b) => {
          const yA = Math.abs((a.year ?? 0) - myYear);
          const yB = Math.abs((b.year ?? 0) - myYear);
          if (yA !== yB) return yA - yB;
          const mA = myMajor && a.major && a.major === myMajor ? 0 : 1;
          const mB = myMajor && b.major && b.major === myMajor ? 0 : 1;
          if (mA !== mB) return mA - mB;
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
      const res = await fetch("/api/ai/study-match", {
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
      const res = await fetch("/api/ai/match-lookup", {
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
 *  the server-side check so the UI doesn't make a doomed API call. */
export function checkStudyMatchEligibility(profile: Profile | null | undefined): {
  ready: boolean;
  blocker?: "no_uni" | "no_year" | "no_profile";
  message?: string;
} {
  if (!profile) return { ready: false, blocker: "no_profile", message: "Complete your profile first." };
  if (!profile.uni) return { ready: false, blocker: "no_uni", message: "Add your university to your profile to use Study Match." };
  if (profile.year === null || profile.year === undefined) {
    return { ready: false, blocker: "no_year", message: "Add your academic year to your profile to use Study Match." };
  }
  return { ready: true };
}
