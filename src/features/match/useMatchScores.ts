/**
 * useMatchScores — shared hook for computing match scores anywhere.
 *
 * Loads once per session:
 *   - the viewer's profile fields (uni, major, year, subjects)
 *   - the viewer's match_quiz.answers
 *   - every other user's match_quiz.answers as a Map
 *
 * Returns a scoreFor(candidate) function that any screen (Rooms,
 * Connect, ProfileDrawer, Discover) can call to get { score, reasons }
 * for any profile shape with the right fields. Pure JS computation
 * after the initial fetch — O(1) per call after warm-up.
 *
 * Refreshes when the user retakes the quiz (`bu:quiz-updated` event).
 *
 * Cost: ONE SELECT against match_quiz (~600 small rows, < 50KB) per
 * session. Cheaper than per-screen N+1 fetches.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { useSupabaseSession } from "@/features/auth/useSupabaseSession";
import { computeMatch, type MatchResult } from "./computeScore";
import type { PersonalityAnswers } from "./personalityQuestions";

/** Subset of profile fields needed for scoring. Anything with these
 *  fields can be scored — Profile rows, GroupMember rows, etc. */
export interface ScoreableProfile {
  id: string;
  uni?: string | null;
  major?: string | null;
  year?: string | number | null;
  subjects?: string[] | null;
}

interface ViewerCtx {
  uni: string | null;
  major: string | null;
  year: string | null;
  subjects: string[] | null;
  answers: PersonalityAnswers | null;
}

export interface UseMatchScoresState {
  /** Compute match score + reasons for a candidate. Returns null if
   *  the viewer isn't authed or the candidate IS the viewer. */
  scoreFor: (candidate: ScoreableProfile | null | undefined) => MatchResult | null;
  loading: boolean;
}

export function useMatchScores(): UseMatchScoresState {
  const { user, loading: authLoading } = useSupabaseSession();
  const [viewer, setViewer] = useState<ViewerCtx | null>(null);
  const [quizMap, setQuizMap] = useState<Map<string, PersonalityAnswers>>(new Map());
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!user || !supabase) {
      setViewer(null);
      setQuizMap(new Map());
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      // Pull viewer's profile fields + every quiz row in parallel.
      // RLS lets authenticated users SELECT all match_quiz rows
      // (added in the match_quiz_select_authenticated migration).
      const [profileQ, quizQ] = await Promise.all([
        supabase!.from("profiles").select("uni, major, year, subjects").eq("id", user.id).maybeSingle(),
        supabase!.from("match_quiz").select("user_id, answers"),
      ]);

      const me = profileQ.data ?? null;
      const meQuiz = (quizQ.data ?? []).find((r: { user_id: string }) => r.user_id === user.id);
      setViewer({
        uni: me?.uni ?? null,
        major: me?.major ?? null,
        year: me?.year ?? null,
        subjects: me?.subjects ?? null,
        answers: (meQuiz?.answers as PersonalityAnswers) ?? null,
      });

      const map = new Map<string, PersonalityAnswers>();
      for (const row of (quizQ.data ?? []) as Array<{ user_id: string; answers: PersonalityAnswers | null }>) {
        if (row.answers) map.set(row.user_id, row.answers);
      }
      setQuizMap(map);
    } catch {
      // Soft fail — scoreFor() returns null for everyone, screens
      // gracefully omit the match badge.
      setViewer(null);
      setQuizMap(new Map());
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    void reload();
  }, [authLoading, reload]);

  // Re-fetch on quiz update (own retake — local custom event).
  useEffect(() => {
    const onUpdate = () => { void reload(); };
    window.addEventListener("bu:quiz-updated", onUpdate);
    return () => window.removeEventListener("bu:quiz-updated", onUpdate);
  }, [reload]);

  // Realtime: when ANY user inserts or updates their match_quiz row,
  // re-fetch so cross-user match scores stay current. Without this,
  // a friend retaking the quiz wouldn't change the % I see for them
  // until I refresh. Profile field changes (uni / major / subjects)
  // also affect scores — listen for profiles UPDATE too.
  //
  // Per-mount unique channel name. RLS already restricts events to
  // rows the viewer can SELECT, so safe + cheap.
  useEffect(() => {
    if (!supabase || !user) return;
    let channel: RealtimeChannel | null = null;
    const channelName = `match-scores-${user.id}-${
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2)
    }`;
    const refresh = () => { void reload(); };
    channel = supabase
      .channel(channelName)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "match_quiz" }, refresh)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "match_quiz" }, refresh)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles" }, refresh)
      .subscribe();
    return () => {
      if (channel) void supabase.removeChannel(channel);
    };
  }, [user, reload]);

  const scoreFor = useCallback<UseMatchScoresState["scoreFor"]>((candidate) => {
    if (!candidate || !viewer || !user) return null;
    if (candidate.id === user.id) return null; // don't show self-match
    return computeMatch({
      viewerAnswers: viewer.answers,
      candidateAnswers: quizMap.get(candidate.id) ?? null,
      viewer: {
        uni: viewer.uni, major: viewer.major,
        year: viewer.year, subjects: viewer.subjects,
      },
      candidate: {
        uni: candidate.uni ?? null,
        major: candidate.major ?? null,
        year: candidate.year ?? null,
        subjects: candidate.subjects ?? null,
      },
    });
  }, [viewer, quizMap, user]);

  return useMemo(() => ({ scoreFor, loading }), [scoreFor, loading]);
}
