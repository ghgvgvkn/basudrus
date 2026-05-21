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
  /** The candidates (already filtered + sorted). */
  candidates: CandidateRow[];
  /** Last error from either candidate fetch or a match run. */
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

  return {
    loading,
    candidates,
    error,
    refresh,
    matching,
    runMatch,
    lastVerdict,
    clearVerdict,
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
