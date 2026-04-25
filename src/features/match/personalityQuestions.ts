/**
 * personalityQuestions — single source of truth for the onboarding
 * personality quiz AND the match-score calculation.
 *
 * Each question carries:
 *   - id: stored as the key in match_quiz.answers (jsonb)
 *   - question / options: rendered by PersonalityQuizStep
 *   - weight: contribution to the final 0-100 match score
 *   - score(a, b): given two users' answers for THIS question, return
 *                  a 0.0-1.0 compatibility (1 = perfect match for the
 *                  question's purpose, 0 = full mismatch)
 *
 * Personality weights total 82. Profile-derived dimensions (uni,
 * major, year, courses) total 18 and are scored separately in
 * computeScore.ts. Together they produce a 0-100 match.
 *
 * History:
 *   - v1: 5 questions on a Likert scale (legacy onboarding)
 *   - v2: 11 questions with mixed matrices + rank scores
 *   - v3 (current): trimmed to 8 questions for completion rate. The
 *     three dropped (environment, note-taking, social) had the lowest
 *     matching signal — note-taking is irrelevant to whether two
 *     people can study together; environment is partly captured by
 *     where the room ends up; social was redundant with group_pref.
 *     Their 15 weight points were redistributed across the surviving
 *     high-signal dimensions.
 *
 * Existing match_quiz rows with the dropped keys still parse fine —
 * computeScore iterates PERSONALITY_QUESTIONS, so unknown keys in
 * answers are silently ignored. No migration needed.
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
  /** Stored value (short, lowercase, snake-style). Don't change without a migration. */
  value: string;
  /** Visible English label. */
  label: string;
  /** Optional emoji prefix for the chip. */
  emoji?: string;
}

export interface PersonalityQuestion {
  id: AnswerKey;
  /** Visible English question text — conversational. */
  question: string;
  /** A short subtitle shown below the question (optional). */
  hint?: string;
  /** Multiple-choice options. Always 3-4 options for skim speed. */
  options: QuizOption[];
  /** Contribution weight in the 0-100 match score. Sum of weights here = 82. */
  weight: number;
  /** Pure scoring function: given two answer values, return 0..1.
   *  Implementation per question below — uses simple matrices, never AI. */
  score: (a: string, b: string) => number;
}

/* ───────────────── helpers ───────────────── */

/** Symmetric pairwise lookup. Order of arguments doesn't matter. */
function symmetricMatrix(rows: Record<string, Record<string, number>>) {
  return (a: string, b: string): number => {
    const row = rows[a];
    if (row && b in row) return row[b];
    const reverse = rows[b];
    if (reverse && a in reverse) return reverse[a];
    return 0;
  };
}

/** Equal-rank score: same → 1, ±1 step on the array → 0.5, ±2 → 0.25, further → 0. */
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
    // Same window → 1.0, adjacent → 0.5, two apart → 0.25, opposite → 0.
    // Two students whose peak hours don't overlap can't actually meet.
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
    // Compatibility matrix — deep+burst is misery (one's still focused
    // when the other's gone). "Deadline" (flex) plays OK with anyone.
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
    // High weight because mismatch here is the loudest pain in
    // partnerships — "love group" + "solo" = nobody's happy.
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
    // Adjacent score on the spectrum — daily↔sometimes pairs fine,
    // daily↔never is a real cultural mismatch in study sessions.
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
    // Rank score along the discipline spectrum. Daily + cram = friction.
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
    // Pairing matrix — different panic styles need to mesh.
    // Lock-in + Accept = the lock-in person resents the chill one.
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
    // Direct + Gentle = the gentle person feels attacked.
    // Worth catching at match time so we don't pair them.
    score: symmetricMatrix({
      direct:   { direct: 1.0, balanced: 0.8, gentle: 0.2, minimal: 0.6 },
      balanced: { direct: 0.8, balanced: 1.0, gentle: 0.7, minimal: 0.5 },
      gentle:   { direct: 0.2, balanced: 0.7, gentle: 1.0, minimal: 0.4 },
      minimal:  { direct: 0.6, balanced: 0.5, gentle: 0.4, minimal: 1.0 },
    }),
  },
];

/** Used by computeScore.ts and validation tests — sanity check that
 *  weights total exactly 82 (= 100 - profile bucket). */
export const PERSONALITY_TOTAL_WEIGHT = PERSONALITY_QUESTIONS.reduce((s, q) => s + q.weight, 0);

/** Map of id → question for O(1) lookup during scoring. */
export const QUESTIONS_BY_ID: Record<AnswerKey, PersonalityQuestion> =
  Object.fromEntries(PERSONALITY_QUESTIONS.map((q) => [q.id, q])) as Record<AnswerKey, PersonalityQuestion>;

export type PersonalityAnswers = Partial<Record<AnswerKey, string>>;
