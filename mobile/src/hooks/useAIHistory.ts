/**
 * useAIHistory — fetches the user's past chats (tutor_sessions +
 * wellbeing_sessions) and saved study plans, grouped by date bucket
 * for a ChatGPT-style sidebar. Mobile twin of
 * `src/features/ai/useAIHistory.ts` on the web.
 *
 * Both session tables are RLS-scoped to the current user, so we just
 * select everything they own and group client-side. The lists are
 * typically small (active student → 20-100 sessions / semester), so
 * no pagination today — keep it dumb and obvious.
 *
 * Date grouping rules (matches student expectations from ChatGPT):
 *   • Today   — same UTC date as now
 *   • Yesterday — exactly 1 calendar day ago
 *   • Last 7  — 2 to 7 days ago
 *   • Earlier — older than 7 days
 *
 * Why a unified list:
 *   We merge tutor + wellbeing into a single timeline sorted by
 *   updated_at desc. The drawer renders one stream with persona badges
 *   so the user sees "today's chats" interleaved by time, not split
 *   into separate Tony vs Sherlock columns. Matches the web.
 *
 * Mobile-specific notes:
 *   - Uses useAuth (mobile AuthContext) instead of useSupabaseSession.
 *   - Persona names mirror the web: `omar` for tutor, `noor` for
 *     wellbeing. The AI tab maps `omar` → 'tony' and `noor` →
 *     'sherlock' for the PersonaToggle.
 */
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';

/** Persona identifier as stored on the server. Matches the web's
 *  AIPersona type. The AI tab translates `omar` → 'tony' for display. */
export type AIPersona = 'omar' | 'noor';

export interface SessionListItem {
  id: string;
  /** Which persona this session is with — drives the badge in the
   *  drawer and the persona auto-switch on resume. */
  persona: AIPersona;
  /** Tutor sessions have a real subject; wellbeing sessions get a
   *  topic that's usually "general" and a friendlier title derived
   *  from the first message. The UI shows whichever is more
   *  human-readable. */
  subject: string;
  /** Pre-computed display title — for tutor sessions it's the
   *  session_summary / first topic; for wellbeing it's the first
   *  user message excerpt. Saves the renderer from re-deriving the
   *  same string in many places. */
  title: string;
  session_summary: string | null;
  topics_covered: string[];
  message_count: number;
  /** ISO string. We sort/group on this. */
  updated_at: string;
  created_at: string;
}

export interface StudyPlanListItem {
  id: string;
  title: string;
  subjects: string[];
  exam_date: string | null;
  uni: string | null;
  language: string;
  created_at: string;
}

export interface DateBucket<T> {
  today: T[];
  yesterday: T[];
  lastSeven: T[];
  earlier: T[];
}

export interface UseAIHistoryState {
  sessions: SessionListItem[];
  sessionsGrouped: DateBucket<SessionListItem>;
  plans: StudyPlanListItem[];
  plansGrouped: DateBucket<StudyPlanListItem>;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** Delete a chat session. Must pass the persona so we know which
   *  table to delete from (tutor_sessions vs wellbeing_sessions). */
  deleteSession: (id: string, persona: AIPersona) => Promise<boolean>;
  deletePlan: (id: string) => Promise<boolean>;
}

/** UTC-date-only string ("2026-05-12") so day comparison is TZ-safe. */
function utcDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** Days between two UTC-date strings ("2026-05-12" − "2026-05-09" = 3). */
function daysBetween(a: string, b: string): number {
  const aT = Date.parse(`${a}T00:00:00Z`);
  const bT = Date.parse(`${b}T00:00:00Z`);
  if (!Number.isFinite(aT) || !Number.isFinite(bT)) return Infinity;
  return Math.abs(Math.round((aT - bT) / 86400000));
}

/** Bucket an array of {updated_at/created_at} into today / yesterday /
 *  last 7 / earlier relative to NOW (UTC). */
export function groupByDate<T extends { updated_at?: string; created_at: string }>(
  rows: T[],
): DateBucket<T> {
  const todayUtc = utcDay(new Date().toISOString());
  const out: DateBucket<T> = { today: [], yesterday: [], lastSeven: [], earlier: [] };
  for (const r of rows) {
    const stamp = r.updated_at ?? r.created_at;
    const dist = daysBetween(todayUtc, utcDay(stamp));
    if (dist === 0) out.today.push(r);
    else if (dist === 1) out.yesterday.push(r);
    else if (dist <= 7) out.lastSeven.push(r);
    else out.earlier.push(r);
  }
  return out;
}

/** Pure-string title inference for wellbeing sessions — no AI call. */
function inferWellbeingTitle(row: {
  messages: unknown;
  topic?: string | null;
  session_summary?: string | null;
}): string {
  if (typeof row.session_summary === 'string' && row.session_summary.trim()) {
    return row.session_summary.trim().slice(0, 80);
  }
  if (Array.isArray(row.messages)) {
    const firstUser = (row.messages as Array<{ role?: string; content?: string }>).find(
      m => m?.role === 'user' && typeof m?.content === 'string',
    );
    if (firstUser?.content) {
      return (
        firstUser.content.trim().replace(/\s+/g, ' ').slice(0, 60) ||
        'Wellbeing chat'
      );
    }
  }
  return row.topic && row.topic !== 'general'
    ? `Wellbeing — ${row.topic}`
    : 'Wellbeing chat';
}

export function useAIHistory(): UseAIHistoryState {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [plans, setPlans] = useState<StudyPlanListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!userId) {
      setSessions([]);
      setPlans([]);
      return;
    }
    setLoading(true);
    setError(null);

    // Fetch tutor sessions, wellbeing sessions, and plans in parallel —
    // all three are RLS-protected. Wellbeing/plans tables may not exist
    // yet on older deploys; we treat the missing-table error codes
    // (PGRST116 / 42P01) as "empty list" so the History UI degrades
    // gracefully instead of showing a scary error.
    const [tutorRes, wellbeingRes, planRes] = await Promise.all([
      supabase
        .from('tutor_sessions')
        .select(
          'id, subject, session_summary, topics_covered, messages, updated_at, created_at',
        )
        .eq('user_id', userId)
        .order('updated_at', { ascending: false })
        .limit(200),
      supabase
        .from('wellbeing_sessions')
        .select('id, topic, session_summary, messages, updated_at, created_at')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false })
        .limit(200),
      supabase
        .from('user_study_plans')
        .select('id, title, subjects, exam_date, uni, language, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(100),
    ]);

    const merged: SessionListItem[] = [];
    if (tutorRes.error) {
      const code = (tutorRes.error as { code?: string }).code;
      if (code !== 'PGRST116' && code !== '42P01') {
        setError(tutorRes.error.message);
      }
    } else {
      for (const r of (tutorRes.data ?? []) as Array<{
        id: string;
        subject: string;
        session_summary: string | null;
        topics_covered: string[] | null;
        messages: unknown;
        updated_at: string;
        created_at: string;
      }>) {
        const title =
          r.session_summary?.trim() ||
          r.topics_covered?.[0] ||
          r.subject ||
          'Untitled chat';
        merged.push({
          id: r.id,
          persona: 'omar',
          subject: r.subject,
          title,
          session_summary: r.session_summary,
          topics_covered: r.topics_covered ?? [],
          message_count: Array.isArray(r.messages) ? r.messages.length : 0,
          updated_at: r.updated_at,
          created_at: r.created_at,
        });
      }
    }
    if (wellbeingRes.error) {
      const code = (wellbeingRes.error as { code?: string }).code;
      if (code !== 'PGRST116' && code !== '42P01') {
        setError(prev => prev ?? wellbeingRes.error?.message ?? null);
      }
    } else {
      for (const r of (wellbeingRes.data ?? []) as Array<{
        id: string;
        topic: string | null;
        session_summary: string | null;
        messages: unknown;
        updated_at: string;
        created_at: string;
      }>) {
        const title = inferWellbeingTitle({
          messages: r.messages,
          topic: r.topic,
          session_summary: r.session_summary,
        });
        merged.push({
          id: r.id,
          persona: 'noor',
          subject: r.topic || 'wellbeing',
          title,
          session_summary: r.session_summary,
          topics_covered: [],
          message_count: Array.isArray(r.messages) ? r.messages.length : 0,
          updated_at: r.updated_at,
          created_at: r.created_at,
        });
      }
    }
    // Sort merged list by updated_at desc — one unified timeline with
    // Tony + Sherlock interleaved by time.
    merged.sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
    setSessions(merged);

    if (planRes.error) {
      const code = (planRes.error as { code?: string }).code;
      if (code !== 'PGRST116' && code !== '42P01') {
        setError(prev => prev ?? planRes.error?.message ?? null);
      }
      setPlans([]);
    } else {
      setPlans((planRes.data ?? []) as StudyPlanListItem[]);
    }

    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const deleteSession = useCallback<UseAIHistoryState['deleteSession']>(
    async (id, persona) => {
      if (!userId) return false;
      setSessions(prev => prev.filter(s => s.id !== id));
      const table = persona === 'noor' ? 'wellbeing_sessions' : 'tutor_sessions';
      const { error: delErr } = await supabase
        .from(table)
        .delete()
        .eq('id', id)
        .eq('user_id', userId);
      if (delErr) {
        await refresh();
        return false;
      }
      return true;
    },
    [userId, refresh],
  );

  const deletePlan = useCallback<UseAIHistoryState['deletePlan']>(
    async id => {
      if (!userId) return false;
      setPlans(prev => prev.filter(p => p.id !== id));
      const { error: delErr } = await supabase
        .from('user_study_plans')
        .delete()
        .eq('id', id)
        .eq('user_id', userId);
      if (delErr) {
        await refresh();
        return false;
      }
      return true;
    },
    [userId, refresh],
  );

  return {
    sessions,
    sessionsGrouped: groupByDate(sessions),
    plans,
    plansGrouped: groupByDate(plans),
    loading,
    error,
    refresh,
    deleteSession,
    deletePlan,
  };
}

// ─────────────────────────────────────────────────────────────────────
// One-shot session loader — used by the resume-in-place flow.
// ─────────────────────────────────────────────────────────────────────

export interface FullSessionMessage {
  role: 'user' | 'assistant';
  content: string;
  ts: string;
}

export interface FullSessionRow {
  id: string;
  persona: AIPersona;
  subject: string;
  messages: FullSessionMessage[];
  session_summary: string | null;
  topics_covered: string[];
  updated_at: string;
  created_at: string;
}

function parseJsonbMessages(raw: unknown): FullSessionMessage[] {
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[])
    .filter(
      (m): m is { role: string; content: string; ts?: string } =>
        typeof m === 'object' &&
        m !== null &&
        'role' in m &&
        'content' in m &&
        typeof (m as { role: unknown }).role === 'string' &&
        typeof (m as { content: unknown }).content === 'string',
    )
    .map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
      ts: typeof m.ts === 'string' ? m.ts : new Date().toISOString(),
    }));
}

/**
 * Pull a single session by ID, including the full messages JSONB.
 * Caller must pass the persona so we know which table to query
 * (tutor_sessions vs wellbeing_sessions). The SessionListItem the
 * drawer holds already carries persona, so the call site has it.
 *
 * Returns null on any failure — caller decides how to surface to
 * the user (we typically push a system notice in the chat).
 *
 * RLS naturally scopes to the owning user. No client-side filter.
 */
export async function fetchSessionById(
  sessionId: string,
  persona: AIPersona,
): Promise<FullSessionRow | null> {
  if (persona === 'noor') {
    const { data, error } = await supabase
      .from('wellbeing_sessions')
      .select('id, topic, messages, session_summary, updated_at, created_at')
      .eq('id', sessionId)
      .maybeSingle();
    if (error || !data) return null;
    const raw = data as {
      id: string;
      topic: string | null;
      messages: unknown;
      session_summary: string | null;
      updated_at: string;
      created_at: string;
    };
    return {
      id: raw.id,
      persona: 'noor',
      subject: raw.topic || 'wellbeing',
      messages: parseJsonbMessages(raw.messages),
      session_summary: raw.session_summary,
      topics_covered: [],
      updated_at: raw.updated_at,
      created_at: raw.created_at,
    };
  }
  // Default: tutor (Tony Starrk) sessions.
  const { data, error } = await supabase
    .from('tutor_sessions')
    .select(
      'id, subject, messages, session_summary, topics_covered, updated_at, created_at',
    )
    .eq('id', sessionId)
    .maybeSingle();
  if (error || !data) return null;
  const raw = data as {
    id: string;
    subject: string;
    messages: unknown;
    session_summary: string | null;
    topics_covered: string[] | null;
    updated_at: string;
    created_at: string;
  };
  return {
    id: raw.id,
    persona: 'omar',
    subject: raw.subject,
    messages: parseJsonbMessages(raw.messages),
    session_summary: raw.session_summary,
    topics_covered: raw.topics_covered ?? [],
    updated_at: raw.updated_at,
    created_at: raw.created_at,
  };
}
