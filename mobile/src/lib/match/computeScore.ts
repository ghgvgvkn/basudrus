/**
 * computeScore — mobile twin of /src/features/match/computeScore.ts.
 *
 * Pure function — no I/O — so it's safe to call from inside a tight
 * loop scoring every candidate in a list. Kept VERBATIM with the web
 * implementation so a 73% match on the web reads as 73% on mobile.
 *
 * Distribution (weights total 100):
 *   - Personality questions (8)   → 82 total
 *   - Profile context (uni/major/year/courses) → 18 total
 */
import { PERSONALITY_QUESTIONS, type PersonalityAnswers } from "./personalityQuestions";

export interface MatchInputs {
  viewerAnswers: PersonalityAnswers | null;
  candidateAnswers: PersonalityAnswers | null;
  viewer: {
    uni?: string | null;
    major?: string | null;
    year?: string | number | null;
    subjects?: string[] | null;
  };
  candidate: {
    uni?: string | null;
    major?: string | null;
    year?: string | number | null;
    subjects?: string[] | null;
  };
}

export interface MatchResult {
  /** 0-100 integer match score. */
  score: number;
  /** Human-friendly reasons, ordered by impact. */
  reasons: string[];
  /** Per-dimension breakdown. */
  breakdown: Array<{ key: string; weight: number; score: number; earned: number; label: string }>;
}

const W_UNI = 6;
const W_MAJOR = 5;
const W_YEAR = 3;
const W_COURSES = 4;

const norm = (s: string | null | undefined): string =>
  (s ?? "").trim().toLowerCase();

function sameFaculty(a: string, b: string): boolean {
  if (!a || !b) return false;
  const aw = a.trim().split(/\s+/).filter(Boolean);
  const bw = b.trim().split(/\s+/).filter(Boolean);
  if (aw.length === 0 || bw.length === 0) return false;
  return aw[aw.length - 1].toLowerCase() === bw[bw.length - 1].toLowerCase();
}

function parseYear(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

function jaccard(a: string[] | null | undefined, b: string[] | null | undefined): number {
  if (!Array.isArray(a) || !Array.isArray(b)) return 0;
  const A = new Set(a.map(norm).filter(Boolean));
  const B = new Set(b.map(norm).filter(Boolean));
  if (A.size === 0 || B.size === 0) return 0;
  let intersect = 0;
  for (const x of A) if (B.has(x)) intersect++;
  const union = A.size + B.size - intersect;
  return union === 0 ? 0 : intersect / union;
}

function yearScore(va: string | number | null | undefined, vb: string | number | null | undefined): number {
  const a = parseYear(va);
  const b = parseYear(vb);
  if (a === null || b === null) return 0;
  const d = Math.abs(a - b);
  if (d === 0) return 1;
  if (d === 1) return 0.5;
  if (d === 2) return 0.25;
  return 0;
}

function reasonFor(key: string, value: string, candidateValue: string): string {
  switch (key) {
    case "chronotype": {
      const map: Record<string, string> = {
        morning: "early-morning", afternoon: "afternoon",
        evening: "evening", late_night: "late-night",
      };
      return value === candidateValue
        ? `Both ${map[value] ?? value} studiers`
        : `Adjacent peak hours`;
    }
    case "session_style":
      return value === candidateValue ? `Same session style` : `Compatible session styles`;
    case "group_pref":
      return value === candidateValue ? `Both ${value === "love" ? "love group study" : value === "solo" ? "prefer solo" : "share the same group preference"}` : `Compatible group preferences`;
    case "ai_usage":
      return value === candidateValue ? `Both use AI ${value}` : `Compatible AI usage`;
    case "frequency":
      return value === candidateValue ? `Both study ${value === "daily" ? "daily" : "on a similar rhythm"}` : `Similar study frequency`;
    case "stress_response":
      return value === candidateValue ? `Same exam-week strategy` : `Compatible under pressure`;
    case "stuck_response":
      return value === candidateValue ? `Same approach when stuck` : `Compatible problem-solving styles`;
    case "communication":
      return value === candidateValue ? `Same communication style` : `Compatible communication`;
    default:
      return `Match on ${key}`;
  }
}

export function computeMatch({
  viewerAnswers,
  candidateAnswers,
  viewer,
  candidate,
}: MatchInputs): MatchResult {
  const breakdown: MatchResult["breakdown"] = [];

  const sameUni =
    !!viewer.uni && !!candidate.uni && norm(viewer.uni) === norm(candidate.uni);
  breakdown.push({
    key: "uni",
    label: "University",
    weight: W_UNI,
    score: sameUni ? 1 : 0,
    earned: sameUni ? W_UNI : 0,
  });

  let majorScore = 0;
  if (viewer.major && candidate.major) {
    if (norm(viewer.major) === norm(candidate.major)) majorScore = 1;
    else if (sameFaculty(viewer.major, candidate.major)) majorScore = 0.5;
  }
  breakdown.push({
    key: "major",
    label: "Major",
    weight: W_MAJOR,
    score: majorScore,
    earned: majorScore * W_MAJOR,
  });

  const yScore = yearScore(viewer.year, candidate.year);
  breakdown.push({
    key: "year",
    label: "Year",
    weight: W_YEAR,
    score: yScore,
    earned: yScore * W_YEAR,
  });

  const cScore = jaccard(viewer.subjects, candidate.subjects);
  breakdown.push({
    key: "courses",
    label: "Courses",
    weight: W_COURSES,
    score: cScore,
    earned: cScore * W_COURSES,
  });

  for (const q of PERSONALITY_QUESTIONS) {
    const a = viewerAnswers?.[q.id];
    const b = candidateAnswers?.[q.id];
    let s = 0.5;
    if (a && b) s = q.score(a, b);
    breakdown.push({
      key: q.id,
      label: q.question,
      weight: q.weight,
      score: s,
      earned: s * q.weight,
    });
  }

  const earnedTotal = breakdown.reduce((sum, d) => sum + d.earned, 0);
  const finalScore = Math.max(0, Math.min(100, Math.round(earnedTotal)));

  const reasonRows = breakdown
    .filter((d) => d.score >= 0.6 && d.weight >= 4 && d.earned > 0)
    .sort((a, b) => b.earned - a.earned)
    .slice(0, 4);

  const reasons: string[] = [];
  for (const r of reasonRows) {
    if (r.key === "uni" && sameUni && viewer.uni) {
      reasons.push(`Both at ${viewer.uni}`);
    } else if (r.key === "major" && majorScore === 1 && viewer.major) {
      reasons.push(`Both in ${viewer.major}`);
    } else if (r.key === "major" && majorScore === 0.5) {
      reasons.push(`Same faculty`);
    } else if (r.key === "year" && parseYear(viewer.year) === parseYear(candidate.year)) {
      reasons.push(`Same year (${parseYear(viewer.year)})`);
    } else if (r.key === "year") {
      reasons.push(`Adjacent year`);
    } else if (r.key === "courses" && cScore > 0) {
      const A = new Set((viewer.subjects ?? []).map(norm));
      const B = new Set((candidate.subjects ?? []).map(norm));
      let shared = 0;
      for (const x of A) if (B.has(x)) shared++;
      reasons.push(shared === 1 ? `1 shared course` : `${shared} shared courses`);
    } else {
      const a = viewerAnswers?.[r.key as keyof PersonalityAnswers];
      const b = candidateAnswers?.[r.key as keyof PersonalityAnswers];
      if (a && b) reasons.push(reasonFor(r.key, a, b));
    }
  }

  return { score: finalScore, reasons, breakdown };
}
