/**
 * useSubjectProgress — load every tutor_progress row for the current
 * user so the Profile screen can render a per-subject progress grid.
 *
 * Mirrors `src/features/ai/useSubjectProgress.ts` on the website so the
 * Profile screen sees identical data on phone + web. The only delta is
 * the auth source: mobile pulls the session from our `useAuth` hook
 * (Supabase wraps an AsyncStorage-backed session), web uses
 * `useSupabaseSession`. Same Supabase client underneath.
 *
 * Shape we expose is intentionally small — only what the grid needs
 * (subject, sessions_count, topics covered, weak/strong areas,
 * last_session_at). Heavier fields (next_review_topics) live on the
 * full TutorProgressRow but the grid doesn't need them.
 *
 * Refresh: rows refresh on mount and on a manual refresh() call. We
 * don't subscribe to realtime — progress is updated by the post-session
 * analyzer (server-side) which writes once per session, so live
 * updates aren't worth the websocket overhead.
 *
 * Failure mode: silent. Errors set `error` for UI hinting but never
 * throw. An empty grid is preferable to a crash.
 */
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import type { AISubject } from '@/lib/subjectPalette';

export interface SubjectProgressSummary {
  /** Canonical subject key. Some rows may have free-form subjects
   *  (server inferred a subject we don't render colors for); we keep
   *  them as strings and let the palette helper pick a fallback. */
  subject: AISubject | string;
  sessionsCount: number;
  topicsCount: number;
  /** Last session ISO timestamp; null if the analyzer never ran. */
  lastSessionAt: string | null;
  weakCount: number;
  strongCount: number;
  /** A 0..1 mastery proxy:
   *    base from sessions  (more practice = more comfort, capped)
   *    + boost from strong areas
   *    − penalty from weak areas
   *  Imperfect — real mastery would require quiz scoring — but
   *  good enough to drive a meaningful progress bar. */
  masteryHint: number;
}

interface UseSubjectProgressReturn {
  rows: SubjectProgressSummary[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

interface RawRow {
  subject: string | null;
  sessions_count: number | null;
  topics_covered: Array<{ topic?: string }> | null;
  weak_areas: string[] | null;
  strong_areas: string[] | null;
  last_session_at: string | null;
}

function computeMastery(sessions: number, strong: number, weak: number): number {
  // Sessions provide a baseline up to ~0.55 at 12 sessions. Diminishing
  // returns — past 12 sessions you need actual mastery signal (strong
  // areas ≫ weak areas) to climb higher.
  const base = Math.min(0.55, sessions / 24);
  const ratio = strong + weak > 0 ? strong / (strong + weak) : 0.5;
  // Strong > weak adds up to +0.45, weak > strong subtracts up to 0.2.
  const adjust = (ratio - 0.5) * 0.9;
  return Math.max(0, Math.min(1, base + adjust));
}

export function useSubjectProgress(): UseSubjectProgressReturn {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const [rows, setRows] = useState<SubjectProgressSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data, error: dbError } = await supabase
        .from('tutor_progress')
        .select('subject,sessions_count,topics_covered,weak_areas,strong_areas,last_session_at')
        .eq('user_id', userId);
      if (dbError) {
        setError(dbError.message);
        setRows([]);
        return;
      }
      const out: SubjectProgressSummary[] = (data as RawRow[] | null ?? [])
        .map((r) => {
          const subject = (r.subject || 'general').toLowerCase();
          const sessions = r.sessions_count ?? 0;
          const topics = Array.isArray(r.topics_covered)
            ? r.topics_covered.filter((t) => t?.topic).length
            : 0;
          const weak = Array.isArray(r.weak_areas) ? r.weak_areas.length : 0;
          const strong = Array.isArray(r.strong_areas) ? r.strong_areas.length : 0;
          return {
            subject: subject as AISubject,
            sessionsCount: sessions,
            topicsCount: topics,
            lastSessionAt: r.last_session_at,
            weakCount: weak,
            strongCount: strong,
            masteryHint: computeMastery(sessions, strong, weak),
          };
        })
        // Sort by recency — most-recently-touched first. Subjects with
        // no last_session_at sink to the bottom.
        .sort((a, b) => {
          const ta = a.lastSessionAt ? Date.parse(a.lastSessionAt) : 0;
          const tb = b.lastSessionAt ? Date.parse(b.lastSessionAt) : 0;
          return tb - ta;
        });
      setRows(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { rows, loading, error, refresh: load };
}
