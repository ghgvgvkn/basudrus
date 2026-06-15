/**
 * routine.ts — builds a personalized workout from the catalog + the user's
 * profile: filters by where they train, DROPS anything an injury contraindicates
 * ("avoid"), picks a muscle-group-varied set, and sizes reps/holds to the goal.
 * Pure + deterministic so it's unit-testable.
 */
import { EXERCISE_LIST } from "./exercises";
import type { ExerciseDef, RoutineStep } from "./types";
import type { FitnessProfile, InjuryArea, Goal } from "./fitnessProfile";

/** Injury area → substring to match against a contraindication's `condition`. */
const INJURY_KEYWORD: Record<InjuryArea, string> = {
  "lower-back": "back",
  knees: "knee",
  shoulders: "shoulder",
  neck: "neck",
  wrists: "wrist",
  hips: "hip",
  ankles: "ankle",
};

function allowedByPlace(e: ExerciseDef, place: FitnessProfile["place"] | undefined): boolean {
  if (place === "gym" || place === "both") return true; // gym-goers can do everything
  return e.category === "home"; // home (or unknown) → bodyweight/home only
}

/** True if any flagged injury has a matching contraindication telling us to AVOID. */
function avoidedByInjury(e: ExerciseDef, injuries: InjuryArea[] | undefined): boolean {
  if (!injuries || injuries.length === 0) return false;
  return injuries.some((inj) => {
    const kw = INJURY_KEYWORD[inj];
    return e.contraindications.some(
      (c) => c.condition.toLowerCase().includes(kw) && /avoid/i.test(c.modification),
    );
  });
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
  const picked = pickBalanced(list, 6);
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
