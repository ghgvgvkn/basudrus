/**
 * useMatchScores — shared hook for computing match scores anywhere
 * in the mobile app (Discover, Connect, Rooms, Profile drawer, …).
 *
 * Mobile twin of /src/features/match/useMatchScores.ts. Key adapter
 * changes vs the web hook:
 *
 *   • Reads the session from our `useAuth()` context (not the web
 *     `useSupabaseSession()`).
 *   • Subscribes to refresh via the global `DeviceEventEmitter` event
 *     `bu:quiz-updated` — DOM events don't exist in React Native.
 *   • Channel name carries a per-mount random suffix to dodge the
 *     React Strict-Mode "cannot add postgres_changes after subscribe"
 *     warning we already worked around in useRooms.
 *
 * Loads once per session:
 *   - viewer profile (uni, major, year, subjects)
 *   - viewer's match_quiz.answers
 *   - every other user's match_quiz.answers as a Map
 *
 * Returns scoreFor(candidate) — pure JS after the warm-up fetch, so
 * cheap to call inside a render loop.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { DeviceEventEmitter } from 'react-native';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { computeMatch, type MatchResult } from '@/lib/match/computeScore';
import type { PersonalityAnswers } from '@/lib/match/personalityQuestions';

/** Anything with these fields can be scored. */
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
  /** Compute match for a candidate. Returns null when:
   *   - viewer isn't authed
   *   - candidate IS the viewer (don't show self-match)
   *   - viewer hasn't taken the quiz yet (consumers fall back to no badge) */
  scoreFor: (candidate: ScoreableProfile | null | undefined) => MatchResult | null;
  /** True if the viewer has saved at least one quiz answer. */
  hasQuiz: boolean;
  loading: boolean;
}

const QUIZ_UPDATED_EVENT = 'bu:quiz-updated';

/** Emit this from the quiz screen after a successful upsert so any
 *  open useMatchScores instance re-fetches and re-scores immediately. */
export function emitQuizUpdated() {
  DeviceEventEmitter.emit(QUIZ_UPDATED_EVENT);
}

export function useMatchScores(): UseMatchScoresState {
  const { session, ready } = useAuth();
  const userId = session?.user?.id ?? null;
  const [viewer, setViewer] = useState<ViewerCtx | null>(null);
  const [quizMap, setQuizMap] = useState<Map<string, PersonalityAnswers>>(new Map());
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!userId) {
      setViewer(null);
      setQuizMap(new Map());
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [profileQ, quizQ] = await Promise.all([
        supabase.from('profiles').select('uni, major, year, subjects').eq('id', userId).maybeSingle(),
        supabase.from('match_quiz').select('user_id, answers'),
      ]);

      const me = profileQ.data ?? null;
      const meQuiz = (quizQ.data ?? []).find((r: { user_id: string }) => r.user_id === userId);
      setViewer({
        uni: (me?.uni as string | null) ?? null,
        major: (me?.major as string | null) ?? null,
        year: (me?.year as string | null) ?? null,
        subjects: (me?.subjects as string[] | null) ?? null,
        answers: (meQuiz?.answers as PersonalityAnswers) ?? null,
      });

      const map = new Map<string, PersonalityAnswers>();
      for (const row of (quizQ.data ?? []) as Array<{ user_id: string; answers: PersonalityAnswers | null }>) {
        if (row.answers) map.set(row.user_id, row.answers);
      }
      setQuizMap(map);
    } catch {
      // Soft fail — consumers omit the match badge when scoreFor returns null.
      setViewer(null);
      setQuizMap(new Map());
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!ready) return;
    void reload();
  }, [ready, reload]);

  // Local event: quiz screen calls emitQuizUpdated() after a successful save.
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(QUIZ_UPDATED_EVENT, () => {
      void reload();
    });
    return () => sub.remove();
  }, [reload]);

  // Realtime: another user retakes the quiz OR updates their profile.
  // Per-mount channel name to dodge Strict-Mode duplicate-subscribe.
  useEffect(() => {
    if (!userId) return;
    const channelName = `match-scores-${userId}-${Math.random().toString(36).slice(2, 10)}`;
    const refresh = () => { void reload(); };
    const channel: RealtimeChannel = supabase
      .channel(channelName)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'match_quiz' }, refresh)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'match_quiz' }, refresh)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles' }, refresh)
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, reload]);

  const scoreFor = useCallback<UseMatchScoresState['scoreFor']>(
    (candidate) => {
      if (!candidate || !viewer || !userId) return null;
      if (candidate.id === userId) return null;
      return computeMatch({
        viewerAnswers: viewer.answers,
        candidateAnswers: quizMap.get(candidate.id) ?? null,
        viewer: {
          uni: viewer.uni,
          major: viewer.major,
          year: viewer.year,
          subjects: viewer.subjects,
        },
        candidate: {
          uni: candidate.uni ?? null,
          major: candidate.major ?? null,
          year: candidate.year ?? null,
          subjects: candidate.subjects ?? null,
        },
      });
    },
    [viewer, quizMap, userId],
  );

  return useMemo(
    () => ({ scoreFor, hasQuiz: !!viewer?.answers && Object.keys(viewer.answers).length > 0, loading }),
    [scoreFor, viewer, loading],
  );
}
