/**
 * personalitySummary — turns a user's match_quiz.answers into a short
 * natural-language summary for the AI tutor's system prompt.
 *
 * Goal: a single concise paragraph that lets the AI adapt its style,
 * pacing, and tone to the student WITHOUT being preachy or robotic.
 * Maximum ~250 chars so it doesn't bloat the prompt.
 *
 * The summary is intentionally INFORMATIONAL ("Evening peak hours,
 * deep-work blocks, group-friendly") not INSTRUCTIONAL ("Always use
 * diagrams"). The system prompt itself decides how to translate the
 * traits into behavior — that's the model's job. We just give it
 * useful context.
 */
import type { PersonalityAnswers } from "./personalityQuestions";

const CHRONOTYPE_LABEL: Record<string, string> = {
  morning: "morning peak hours",
  afternoon: "afternoon peak hours",
  evening: "evening peak hours",
  late_night: "late-night peak hours",
};

const SESSION_LABEL: Record<string, string> = {
  pomodoro: "Pomodoro-style focus",
  deep: "deep-work blocks (90+ min)",
  burst: "short focus bursts",
  deadline: "deadline-driven pacing",
};

const GROUP_LABEL: Record<string, string> = {
  love: "loves group study",
  sometimes: "uses groups for hard topics",
  risky: "groups are distracting for them",
  solo: "prefers studying solo",
};

const AI_LABEL: Record<string, string> = {
  daily: "uses AI daily as a study buddy",
  sometimes: "uses AI when stuck",
  rarely: "rarely uses AI — prefers textbook",
  never: "wants to figure things out themselves",
};

const FREQ_LABEL: Record<string, string> = {
  daily: "studies daily",
  few_per_week: "studies a few times a week",
  weekends: "weekend studier",
  cram: "cram-before-exam style",
};

const STRESS_LABEL: Record<string, string> = {
  lock_in: "locks in under pressure",
  triage: "triages strategically under pressure",
  freeze: "tends to freeze under pressure",
  accept: "accepts the outcome under pressure",
};

const STUCK_LABEL: Record<string, string> = {
  persist: "persists through hard problems",
  lookup: "looks up solutions, then re-solves",
  ask: "asks for help when stuck",
  skip: "skips and revisits with fresh eyes",
};

const COMM_LABEL: Record<string, string> = {
  direct: "wants direct feedback",
  balanced: "honest-but-considerate communicator",
  gentle: "needs gentle delivery — discourages easily",
  minimal: "minimal-talk, study-first",
};

/** Build a one-paragraph summary from answers. Returns null if the
 *  user hasn't answered enough to be informative (< 3 questions),
 *  so the caller can avoid sending a useless block to the prompt. */
export function buildPersonalitySummary(answers: PersonalityAnswers | null | undefined): string | null {
  if (!answers || typeof answers !== "object") return null;
  const phrases: string[] = [];

  const push = (map: Record<string, string>, key: keyof PersonalityAnswers) => {
    const v = answers[key];
    if (v && map[v]) phrases.push(map[v]);
  };

  push(CHRONOTYPE_LABEL, "chronotype");
  push(SESSION_LABEL, "session_style");
  push(GROUP_LABEL, "group_pref");
  push(AI_LABEL, "ai_usage");
  push(FREQ_LABEL, "frequency");
  push(STRESS_LABEL, "stress_response");
  push(STUCK_LABEL, "stuck_response");
  push(COMM_LABEL, "communication");

  if (phrases.length < 3) return null;

  // Capitalize first phrase, join the rest with commas, period at end.
  const first = phrases[0].charAt(0).toUpperCase() + phrases[0].slice(1);
  const rest = phrases.slice(1).join(", ");
  return rest ? `${first}, ${rest}.` : `${first}.`;
}
