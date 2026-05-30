/**
 * personalityQuestions — single source of truth for the personality
 * quiz AND the match-score calculation. Mobile twin of
 * /src/features/match/personalityQuestions.ts on the web.
 *
 * Kept verbatim so both clients write the SAME `match_quiz.answers`
 * payload — a user who takes the quiz on the website and then opens
 * the app sees identical match percentages and vice-versa. Don't fork
 * weights, value strings, or question ids without coordinating the web
 * copy in the same commit.
 *
 * Personality weights total 82. Profile-derived dimensions (uni,
 * major, year, courses) total 18 and are scored separately in
 * computeScore.ts. Together they produce a 0-100 match.
 */

export type AnswerKey =
  | "chronotype"
  | "session_style"
  | "group_pref"
  | "ai_usage"
  | "frequency"
  | "stress_response"
  | "stuck_response"
  | "communication";

export interface QuizOption {
  value: string;
  label: string;
  emoji?: string;
}

export interface PersonalityQuestion {
  id: AnswerKey;
  question: string;
  hint?: string;
  options: QuizOption[];
  weight: number;
  score: (a: string, b: string) => number;
}

/* ───────────────── helpers ───────────────── */

function symmetricMatrix(rows: Record<string, Record<string, number>>) {
  return (a: string, b: string): number => {
    const row = rows[a];
    if (row && b in row) return row[b];
    const reverse = rows[b];
    if (reverse && a in reverse) return reverse[a];
    return 0;
  };
}

function rankScore(order: readonly string[]) {
  return (a: string, b: string): number => {
    const ai = order.indexOf(a);
    const bi = order.indexOf(b);
    if (ai === -1 || bi === -1) return 0;
    const d = Math.abs(ai - bi);
    if (d === 0) return 1;
    if (d === 1) return 0.5;
    if (d === 2) return 0.25;
    return 0;
  };
}

/* ───────────────── the 8 questions ───────────────── */

export const PERSONALITY_QUESTIONS: PersonalityQuestion[] = [
  {
    id: "chronotype",
    question: "When does your brain actually work?",
    weight: 13,
    options: [
      { value: "morning",   label: "Early bird (before 11am)", emoji: "🌅" },
      { value: "afternoon", label: "Daytime (11am–4pm)",       emoji: "☀️" },
      { value: "evening",   label: "Evening (4–10pm)",         emoji: "🌆" },
      { value: "late_night",label: "Night owl (after 10pm)",   emoji: "🌙" },
    ],
    score: rankScore(["morning", "afternoon", "evening", "late_night"]),
  },
  {
    id: "session_style",
    question: "How do you study best?",
    weight: 10,
    options: [
      { value: "pomodoro", label: "Pomodoros (25/5)",      emoji: "🍅" },
      { value: "deep",     label: "Long focus blocks",     emoji: "🏊" },
      { value: "burst",    label: "Short bursts of energy",emoji: "⚡" },
      { value: "deadline", label: "Last-minute mode",      emoji: "📅" },
    ],
    score: symmetricMatrix({
      pomodoro: { pomodoro: 1.0, deep: 0.5, burst: 0.3, deadline: 0.5 },
      deep:     { pomodoro: 0.5, deep: 1.0, burst: 0.0, deadline: 0.5 },
      burst:    { pomodoro: 0.3, deep: 0.0, burst: 1.0, deadline: 0.5 },
      deadline: { pomodoro: 0.5, deep: 0.5, burst: 0.5, deadline: 1.0 },
    }),
  },
  {
    id: "group_pref",
    question: "Studying in groups?",
    weight: 13,
    options: [
      { value: "love",      label: "Love it",                emoji: "🚀" },
      { value: "sometimes", label: "Sometimes — for hard topics", emoji: "🆗" },
      { value: "risky",     label: "Distracting",            emoji: "😬" },
      { value: "solo",      label: "Solo only",              emoji: "🚫" },
    ],
    score: symmetricMatrix({
      love:      { love: 1.0, sometimes: 0.7, risky: 0.3, solo: 0.0 },
      sometimes: { love: 0.7, sometimes: 1.0, risky: 0.5, solo: 0.4 },
      risky:     { love: 0.3, sometimes: 0.5, risky: 1.0, solo: 0.6 },
      solo:      { love: 0.0, sometimes: 0.4, risky: 0.6, solo: 1.0 },
    }),
  },
  {
    id: "ai_usage",
    question: "Do you study with AI?",
    weight: 8,
    options: [
      { value: "daily",     label: "Every day — my study buddy", emoji: "🤖" },
      { value: "sometimes", label: "When I'm stuck",             emoji: "💡" },
      { value: "rarely",    label: "Rarely — textbook person",   emoji: "📖" },
      { value: "never",     label: "Never",                      emoji: "🚫" },
    ],
    score: rankScore(["daily", "sometimes", "rarely", "never"]),
  },
  {
    id: "frequency",
    question: "How often do you study?",
    weight: 10,
    options: [
      { value: "daily",        label: "Every day",              emoji: "📆" },
      { value: "few_per_week", label: "A few times a week",     emoji: "🗓️" },
      { value: "weekends",     label: "Weekends mostly",        emoji: "🏖️" },
      { value: "cram",         label: "Cram before exams",      emoji: "🏃" },
    ],
    score: rankScore(["daily", "few_per_week", "weekends", "cram"]),
  },
  {
    id: "stress_response",
    question: "Three days before a big exam, you…",
    weight: 10,
    options: [
      { value: "lock_in", label: "Lock in — cancel everything", emoji: "🔥" },
      { value: "triage",  label: "Smart triage — focus on what scores", emoji: "📋" },
      { value: "freeze",  label: "Stress, then push through with friends", emoji: "😶" },
      { value: "accept",  label: "Take the grade — do what I can", emoji: "🤷" },
    ],
    score: symmetricMatrix({
      lock_in: { lock_in: 1.0, triage: 0.7, freeze: 0.3, accept: 0.0 },
      triage:  { lock_in: 0.7, triage: 1.0, freeze: 0.5, accept: 0.3 },
      freeze:  { lock_in: 0.3, triage: 0.5, freeze: 1.0, accept: 0.4 },
      accept:  { lock_in: 0.0, triage: 0.3, freeze: 0.4, accept: 1.0 },
    }),
  },
  {
    id: "stuck_response",
    question: "Stuck on a problem for 20 minutes. You…",
    weight: 9,
    options: [
      { value: "persist",  label: "Keep grinding",        emoji: "🧠" },
      { value: "lookup",   label: "Look it up",           emoji: "🔍" },
      { value: "ask",      label: "Ask for help",         emoji: "💬" },
      { value: "skip",     label: "Skip, come back later",emoji: "⏭️" },
    ],
    score: symmetricMatrix({
      persist: { persist: 1.0, lookup: 0.6, ask: 0.4, skip: 0.2 },
      lookup:  { persist: 0.6, lookup: 1.0, ask: 0.7, skip: 0.5 },
      ask:     { persist: 0.4, lookup: 0.7, ask: 1.0, skip: 0.5 },
      skip:    { persist: 0.2, lookup: 0.5, ask: 0.5, skip: 1.0 },
    }),
  },
  {
    id: "communication",
    question: "How do you talk to study partners?",
    weight: 9,
    options: [
      { value: "direct",   label: "Direct, no filter",            emoji: "🎯" },
      { value: "balanced", label: "Honest but kind",              emoji: "💬" },
      { value: "gentle",   label: "Gentle — I take feedback hard",emoji: "🤝" },
      { value: "minimal",  label: "Less talk, more study",        emoji: "🔇" },
    ],
    score: symmetricMatrix({
      direct:   { direct: 1.0, balanced: 0.8, gentle: 0.2, minimal: 0.6 },
      balanced: { direct: 0.8, balanced: 1.0, gentle: 0.7, minimal: 0.5 },
      gentle:   { direct: 0.2, balanced: 0.7, gentle: 1.0, minimal: 0.4 },
      minimal:  { direct: 0.6, balanced: 0.5, gentle: 0.4, minimal: 1.0 },
    }),
  },
];

export const PERSONALITY_TOTAL_WEIGHT = PERSONALITY_QUESTIONS.reduce((s, q) => s + q.weight, 0);

export const QUESTIONS_BY_ID: Record<AnswerKey, PersonalityQuestion> =
  Object.fromEntries(PERSONALITY_QUESTIONS.map((q) => [q.id, q])) as Record<AnswerKey, PersonalityQuestion>;

export type PersonalityAnswers = Partial<Record<AnswerKey, string>>;
