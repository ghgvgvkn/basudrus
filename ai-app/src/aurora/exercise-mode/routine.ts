/**
 * routine.ts — builds a personalized workout from the catalog + the user's
 * profile: filters by where they train, DROPS anything an injury contraindicates
 * ("avoid"), picks a muscle-group-varied set, and sizes reps/holds to the goal.
 * Pure + deterministic so it's unit-testable.
 */
import { EXERCISE_LIST } from "./exercises";
import type { ExerciseDef, RoutineStep } from "./types";
import type { FitnessProfile, InjuryArea, Goal } from "./fitnessProfile";

/** Injury area → keywords to match against a contraindication's `condition`
 *  (synonyms so e.g. "disc herniation" / "patellofemoral" still match). */
const INJURY_KEYWORDS: Record<InjuryArea, string[]> = {
  "lower-back": ["back", "disc", "spine", "lumbar"],
  knees: ["knee", "patell"],
  shoulders: ["shoulder"],
  neck: ["neck"],
  wrists: ["wrist"],
  hips: ["hip"],
  ankles: ["ankle", "achilles"],
};

function allowedByPlace(e: ExerciseDef, place: FitnessProfile["place"] | undefined): boolean {
  if (place === "gym" || place === "both") return true; // gym-goers can do everything
  // Home (or unknown): bodyweight only — no dumbbells / bar / kettlebell, so we
  // never hand a home user a move they have no equipment for.
  return e.category === "home" && e.equipment === "none";
}

/** True if any flagged injury has a matching contraindication telling us to AVOID. */
function avoidedByInjury(e: ExerciseDef, injuries: InjuryArea[] | undefined): boolean {
  if (!injuries || injuries.length === 0) return false;
  return injuries.some((inj) => {
    const kws = INJURY_KEYWORDS[inj];
    return e.contraindications.some(
      (c) => kws.some((kw) => c.condition.toLowerCase().includes(kw)) && /avoid/i.test(c.modification),
    );
  });
}

/** Profile goal → the matching goalFit tag on exercises. */
const GOAL_FIT: Record<Goal, string> = {
  muscle: "muscle",
  weight: "weight-loss",
  strength: "strength",
  mobility: "mobility",
};

/** Rank an exercise for the user's goal: goal-fit first, then weight-loss
 *  favours high-burn (MET), mobility favours gentler/beginner moves. */
function goalScore(e: ExerciseDef, goal: Goal | undefined): number {
  let s = goal && e.goalFit.includes(GOAL_FIT[goal]) ? 100 : 0;
  if (goal === "weight") s += e.met; // weight-loss → high-MET cardio rises
  else if (goal === "mobility") s += e.difficulty === "beginner" ? 5 : 0;
  return s;
}

/** Pick up to `n` exercises favouring variety of primary muscle group. */
function pickBalanced(list: ExerciseDef[], n: number): ExerciseDef[] {
  const out: ExerciseDef[] = [];
  const usedGroups = new Set<string>();
  // First pass: one per new muscle group.
  for (const e of list) {
    if (out.length >= n) break;
    const g = e.primaryMuscles[0] ?? e.id;
    if (!usedGroups.has(g)) {
      usedGroups.add(g);
      out.push(e);
    }
  }
  // Second pass: fill remaining slots with anything left.
  for (const e of list) {
    if (out.length >= n) break;
    if (!out.includes(e)) out.push(e);
  }
  return out;
}

function repsForGoal(goal: Goal | undefined): number {
  switch (goal) {
    case "strength": return 8;
    case "muscle": return 12;
    case "weight": return 16;
    case "mobility": return 10;
    default: return 12;
  }
}

function holdSecForGoal(goal: Goal | undefined): number {
  switch (goal) {
    case "weight": return 40;
    case "strength": return 25;
    default: return 30;
  }
}

/** A safe minimal routine if everything got filtered out. */
const FALLBACK: RoutineStep[] = [
  { id: "bodyweight-squat", reps: 10, rest: 15 },
  { id: "plank", seconds: 30, rest: 0 },
];

export function buildRoutine(profile: FitnessProfile | null): RoutineStep[] {
  const list = EXERCISE_LIST.filter(
    (e) => allowedByPlace(e, profile?.place) && !avoidedByInjury(e, profile?.injuries),
  );
  // Order by goal fit first (so the muscle-variety pick draws from the most
  // relevant moves), then pick a varied set. Gym-goers get a nudge toward
  // equipment moves so a gym routine isn't just bodyweight.
  const gymUser = profile?.place === "gym" || profile?.place === "both";
  const score = (e: ExerciseDef) =>
    goalScore(e, profile?.goal) + (gymUser && e.equipment !== "none" ? 8 : 0);
  const ordered = [...list].sort((a, b) => score(b) - score(a));
  const picked = pickBalanced(ordered, 6);
  if (picked.length === 0) return FALLBACK;
  const reps = repsForGoal(profile?.goal);
  const holdSec = holdSecForGoal(profile?.goal);
  return picked.map((e, i) => {
    const rest = i === picked.length - 1 ? 0 : 15;
    return e.kind === "hold"
      ? { id: e.id, seconds: holdSec, rest }
      : { id: e.id, reps, rest };
  });
}
