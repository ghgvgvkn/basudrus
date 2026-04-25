/**
 * useViewerPersonality — load + cache the current user's match_quiz
 * answers + a pre-built summary string for the AI prompt.
 *
 * Refreshes when the user retakes the quiz (listens for the
 * `bu:quiz-updated` window event that PersonalityQuizScreen
 * dispatches on save).
 *
 * Cheap and small — single row read, ~1 KB jsonb. Used by
 * useStreamingAI to inject personality context into every AI
 * request, and could be reused on Profile to display answers.
 */
import { useCallback, useEffect, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { useSupabaseSession } from "@/features/auth/useSupabaseSession";
import type { PersonalityAnswers } from "./personalityQuestions";
import { buildPersonalitySummary } from "./personalitySummary";

export interface ViewerPersonalityState {
  answers: PersonalityAnswers | null;
  /** Pre-built summary string ready to inject into the AI system
   *  prompt. Null when we don't have enough answers to be useful. */
  summary: string | null;
  loading: boolean;
}

export function useViewerPersonality(): ViewerPersonalityState {
  const { user, loading: authLoading } = useSupabaseSession();
  const [answers, setAnswers] = useState<PersonalityAnswers | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!user || !supabase) {
      setAnswers(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data } = await supabase
        .from("match_quiz")
        .select("answers")
        .eq("user_id", user.id)
        .maybeSingle();
      setAnswers((data?.answers as PersonalityAnswers | null) ?? null);
    } catch {
      setAnswers(null);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    void reload();
  }, [authLoading, reload]);

  // Re-fetch when the user retakes the quiz from any screen
  // (same-tab via custom event).
  useEffect(() => {
    const onUpdate = () => { void reload(); };
    window.addEventListener("bu:quiz-updated", onUpdate);
    return () => window.removeEventListener("bu:quiz-updated", onUpdate);
  }, [reload]);

  // Realtime: cross-tab — if the user retakes the quiz on another
  // device or browser tab, the AI personality summary updates here
  // too. Filters by the viewer's user_id so we only react to their
  // own row changes.
  useEffect(() => {
    if (!supabase || !user) return;
    let channel: RealtimeChannel | null = null;
    const channelName = `viewer-quiz-${user.id}-${
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2)
    }`;
    const refresh = () => { void reload(); };
    channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "match_quiz", filter: `user_id=eq.${user.id}` },
        refresh,
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "match_quiz", filter: `user_id=eq.${user.id}` },
        refresh,
      )
      .subscribe();
    return () => {
      if (channel) void supabase.removeChannel(channel);
    };
  }, [user, reload]);

  const summary = buildPersonalitySummary(answers);
  return { answers, summary, loading };
}
