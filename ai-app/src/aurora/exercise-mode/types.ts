/**
 * types.ts — shared types for the AI Exercise engine. Kept in its own file so
 * formHelpers (rule builders) and exercises (the catalog) can both import them
 * without a circular dependency.
 */
import type { Pt } from "./angles";

export type Landmarks = Pt[]; // 33 MediaPipe pose points
export type ExerciseId = string;
export type Facing = "front" | "side";
export type Category = "home" | "gym";
export type Difficulty = "beginner" | "intermediate" | "advanced";

export interface RepConfig {
  /** Primary angle (0..180) whose swing defines a rep. */
  measure: (lm: Landmarks) => number;
  downAngle: number;
  upAngle: number;
}

export interface FormContext {
  lm: Landmarks;
  /** Current primary angle. */
  measure: number;
  /** Deepest (smallest) primary angle reached during this rep. */
  minAngle: number;
  /** Estimated body orientation to the camera — lets rules skip themselves
   *  when the needed view isn't available (e.g. knee-valgus needs front). */
  facing: Facing;
}

export interface FormCheck {
  id: string;
  evaluate: (ctx: FormContext) => string | null;
}

export interface HoldConfig {
  inPosition: (lm: Landmarks) => boolean;
  cue: (lm: Landmarks, facing: Facing) => string | null;
}

export interface Contraindication {
  /** Plain-language condition, e.g. "knee osteoarthritis". */
  condition: string;
  /** What to change, or "avoid" to drop the exercise for this user. */
  modification: string;
}

export interface ExerciseDef {
  id: ExerciseId;
  name: string;
  emoji: string;
  kind: "rep" | "hold";
  /** MET value for calorie burn (kcal = MET × kg × hours). */
  met: number;
  category: Category;
  equipment: string;
  primaryMuscles: string[];
  difficulty: Difficulty;
  /** Goals this exercise serves: "muscle" | "weight-loss" | "strength" | "mobility". */
  goalFit: string[];
  /** Honest webcam-detectability of this exercise's form. */
  detectable: "high" | "medium" | "low";
  /** Landmarks that must be visible to coach this safely. */
  requiredJoints: number[];
  rep?: RepConfig;
  hold?: HoldConfig;
  form: FormCheck[];
  intro: string;
  setupHint: string;
  contraindications: Contraindication[];
}

export interface RoutineStep {
  id: ExerciseId;
  reps?: number;
  seconds?: number;
  rest: number;
}
