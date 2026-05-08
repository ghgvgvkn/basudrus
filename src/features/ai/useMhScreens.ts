/**
 * useMhScreens — load history of completed PHQ-9 / GAD-7 self-screens
 * for the current user, plus a save() function that persists a fresh
 * result. Own-only RLS at the table level — nobody else can read.
 *
 * History is useful so a student can see whether their PHQ-9 score
 * is trending down over weeks. We don't surface graphs in v1, but
 * the data is there.
 *
 * Failure mode: silent. If load fails, history stays empty and the
 * modal still works fine (results just don't save). The student is
 * never blocked from completing a check-in.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useSupabaseSession } from "@/features/auth/useSupabaseSession";
import type { ScreenId, ScreenLang, Severity } from "./mhScreens";

export interface ScreenResult {
  id: string;
  screen: ScreenId;
  score: number;
  severity: Severity;
  answers: number[];
  flaggedSelfHarm: boolean;
  lang: ScreenLang;
  takenAt: string;
}

interface UseMhScreensReturn {
  history: ScreenResult[];
  loading: boolean;
  save: (input: {
    screen: ScreenId;
    score: number;
    severity: Severity;
    answers: number[];
    flaggedSelfHarm: boolean;
    lang: ScreenLang;
  }) => Promise<ScreenResult | null>;
  refresh: () => Promise<void>;
}

interface RawRow {
  id: string;
  screen: ScreenId;
  score: number;
  severity: Severity;
  answers: number[];
  flagged_self_harm: boolean;
  lang: ScreenLang;
  taken_at: string;
}

export function useMhScreens(): UseMhScreensReturn {
  const { user } = useSupabaseSession();
  const [history, setHistory] = useState<ScreenResult[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user || !supabase) {
      setHistory([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("mh_screen_results")
        .select("id,screen,score,severity,answers,flagged_self_harm,lang,taken_at")
        .eq("user_id", user.id)
        .order("taken_at", { ascending: false })
        .limit(60);
      if (error) {
        if (import.meta.env.DEV) console.warn("[useMhScreens] load:", error);
        setHistory([]);
        return;
      }
      const rows = (data as RawRow[] | null) ?? [];
      setHistory(rows.map((r) => ({
        id: r.id,
        screen: r.screen,
        score: r.score,
        severity: r.severity,
        answers: Array.isArray(r.answers) ? r.answers : [],
        flaggedSelfHarm: !!r.flagged_self_harm,
        lang: r.lang,
        takenAt: r.taken_at,
      })));
    } catch (e) {
      if (import.meta.env.DEV) console.warn("[useMhScreens] load threw:", e);
      setHistory([]);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { void load(); }, [load]);

  const save = useCallback(async (input: {
    screen: ScreenId;
    score: number;
    severity: Severity;
    answers: number[];
    flaggedSelfHarm: boolean;
    lang: ScreenLang;
  }): Promise<ScreenResult | null> => {
    if (!user || !supabase) return null;
    try {
      const { data, error } = await supabase
        .from("mh_screen_results")
        .insert({
          user_id: user.id,
          screen: input.screen,
          score: input.score,
          severity: input.severity,
          answers: input.answers,
          flagged_self_harm: input.flaggedSelfHarm,
          lang: input.lang,
        })
        .select("id,screen,score,severity,answers,flagged_self_harm,lang,taken_at")
        .single();
      if (error) {
        if (import.meta.env.DEV) console.warn("[useMhScreens] save:", error);
        return null;
      }
      const row = data as RawRow;
      const result: ScreenResult = {
        id: row.id,
        screen: row.screen,
        score: row.score,
        severity: row.severity,
        answers: Array.isArray(row.answers) ? row.answers : [],
        flaggedSelfHarm: !!row.flagged_self_harm,
        lang: row.lang,
        takenAt: row.taken_at,
      };
      setHistory((h) => [result, ...h]);
      return result;
    } catch (e) {
      if (import.meta.env.DEV) console.warn("[useMhScreens] save threw:", e);
      return null;
    }
  }, [user]);

  return { history, loading, save, refresh: load };
}
