/**
 * useAIHistory — fetches the user's past chats (tutor_sessions) and
 * saved study plans (user_study_plans), grouped by date bucket for
 * a ChatGPT-style sidebar.
 *
 * Both tables are RLS-scoped to the current user, so we simply select
 * everything they own and group client-side. The lists are typically
 * small (an active student generates maybe 20-100 sessions over a
 * semester; a few dozen plans at most), so no pagination today —
 * keep it dumb and obvious. We'll add server-side pagination when
 * any user crosses ~500 sessions.
 *
 * Date grouping rules (matches student expectations from ChatGPT):
 *   • Today   — same UTC date as now
 *   • Yesterday — exactly 1 calendar day ago
 *   • Last 7  — 2 to 7 days ago
 *   • Earlier — older than 7 days
 *
 * We sort each group by updated_at desc (sessions) or created_at desc
 * (plans). The sidebar renders sessions with their latest update —
 * a resumed older session bubbles back to "Today" naturally.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useSupabaseSession } from "@/features/auth/useSupabaseSession";

export interface SessionListItem {
  id: string;
  subject: string;
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
  deleteSession: (id: string) => Promise<boolean>;
  deletePlan: (id: string) => Promise<boolean>;
}

/** UTC-date-only string ("2026-05-12") so day comparison is timezone-safe. */
function utcDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** Days between two UTC-date strings ("2026-05-12" minus "2026-05-09" = 3). */
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

export function useAIHistory(): UseAIHistoryState {
  const { session } = useSupabaseSession();
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

    // Fetch sessions and plans in parallel — both are RLS-protected.
    const [sessRes, planRes] = await Promise.all([
      supabase
        .from("tutor_sessions")
        .select("id, subject, session_summary, topics_covered, messages, updated_at, created_at")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .limit(200),
      supabase
        .from("user_study_plans")
        .select("id, title, subjects, exam_date, uni, language, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

    if (sessRes.error) {
      setError(sessRes.error.message);
    } else {
      const mapped: SessionListItem[] = (sessRes.data ?? []).map((r: {
        id: string;
        subject: string;
        session_summary: string | null;
        topics_covered: string[] | null;
        messages: unknown;
        updated_at: string;
        created_at: string;
      }) => ({
        id: r.id,
        subject: r.subject,
        session_summary: r.session_summary,
        topics_covered: r.topics_covered ?? [],
        message_count: Array.isArray(r.messages) ? r.messages.length : 0,
        updated_at: r.updated_at,
        created_at: r.created_at,
      }));
      setSessions(mapped);
    }

    if (planRes.error) {
      // Plans table may not exist yet on older deployments; treat as
      // empty rather than surfacing a scary error.
      const code = (planRes.error as { code?: string }).code;
      if (code !== "PGRST116" && code !== "42P01") {
        setError((s) => s ?? planRes.error?.message ?? null);
      }
      setPlans([]);
    } else {
      setPlans((planRes.data ?? []) as StudyPlanListItem[]);
    }

    setLoading(false);
  }, [userId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const deleteSession = useCallback<UseAIHistoryState["deleteSession"]>(async (id) => {
    if (!userId) return false;
    setSessions((prev) => prev.filter((s) => s.id !== id));
    const { error: delErr } = await supabase
      .from("tutor_sessions")
      .delete()
      .eq("id", id)
      .eq("user_id", userId);
    if (delErr) { await refresh(); return false; }
    return true;
  }, [userId, refresh]);

  const deletePlan = useCallback<UseAIHistoryState["deletePlan"]>(async (id) => {
    if (!userId) return false;
    setPlans((prev) => prev.filter((p) => p.id !== id));
    const { error: delErr } = await supabase
      .from("user_study_plans")
      .delete()
      .eq("id", id)
      .eq("user_id", userId);
    if (delErr) { await refresh(); return false; }
    return true;
  }, [userId, refresh]);

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
