/**
 * fitnessProfile.ts — the user's one-time AI Exercise profile: goal, body
 * stats (for calories), where they train, and injuries/limitations (so the
 * coach can adapt and warn). Stored locally for now (fast + private +
 * reversible); can move to their Supabase account later for cross-device.
 *
 * SAFETY: injury handling here is for adapting exercise selection + cues. It
 * is NOT medical advice — the UI must say so and tell users to see a
 * professional and stop if anything hurts.
 */

export type Goal = "muscle" | "weight" | "strength" | "mobility";
export type Sex = "male" | "female" | "other";
export type TrainPlace = "home" | "gym" | "both";
export type InjuryArea =
  | "lower-back"
  | "knees"
  | "shoulders"
  | "neck"
  | "wrists"
  | "hips"
  | "ankles";

export interface FitnessProfile {
  goal: Goal;
  heightCm: number;
  weightKg: number;
  age: number;
  sex: Sex;
  place: TrainPlace;
  injuries: InjuryArea[];
  injuryNotes: string;
  updatedAt: number;
}

export const GOAL_LABELS: Record<Goal, string> = {
  muscle: "Build muscle",
  weight: "Lose weight",
  strength: "Get stronger",
  mobility: "Stay active & mobile",
};

export const INJURY_LABELS: Record<InjuryArea, string> = {
  "lower-back": "Lower back",
  knees: "Knees",
  shoulders: "Shoulders",
  neck: "Neck",
  wrists: "Wrists",
  hips: "Hips",
  ankles: "Ankles",
};

const KEY = "bu:exercise-profile-v1";

export function loadProfile(): FitnessProfile | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as FitnessProfile;
    // minimal validation — a corrupt/partial profile re-triggers onboarding
    if (!p || typeof p.weightKg !== "number" || typeof p.heightCm !== "number") return null;
    return p;
  } catch {
    return null;
  }
}

export function saveProfile(p: Omit<FitnessProfile, "updatedAt">): FitnessProfile {
  const full: FitnessProfile = { ...p, updatedAt: Date.now() };
  try {
    localStorage.setItem(KEY, JSON.stringify(full));
  } catch {
    /* private mode — won't persist, profile lives for this session only */
  }
  return full;
}

/**
 * Calories burned, the standard MET model:
 *   kcal = MET × bodyweight(kg) × hours
 * Accrue per active second during a workout; MET comes from each exercise.
 */
export function caloriesForSeconds(met: number, weightKg: number, seconds: number): number {
  return met * weightKg * (seconds / 3600);
}

/** A neutral default so calories still show if a field is missing. */
export const DEFAULT_WEIGHT_KG = 70;
