/**
 * exercises.ts — the AI Exercise "playbook": one data-driven definition per
 * exercise. Pure logic (no DOM/React/MediaPipe) so the rep + form rules are
 * unit-testable in Node, in the spirit of gestures.ts.
 *
 * Each exercise is EITHER:
 *   - kind "rep":  a primary joint angle swings between a contracted (down)
 *                  and extended (up) threshold; one full down→up is a rep.
 *   - kind "hold": the body holds a position (plank); we time how long the
 *                  form stays valid.
 *
 * COORDINATES: landmarks are MediaPipe-normalized 0..1, already mirrored to
 * screen space (x: 1 - x), y down. Form thresholds were chosen to be forgiving
 * (webcam landmarks are noisy) and should be tuned against real footage.
 */
import { angleAt, avgVisibility, type Pt } from "./angles";
import { POSE } from "./poseConstants";

export type ExerciseId = "squat" | "pushup" | "lunge" | "plank";
export type Landmarks = Pt[]; // 33 MediaPipe pose points

export interface RepConfig {
  /** Primary angle (0..180) whose swing defines a rep. */
  measure: (lm: Landmarks) => number;
  /** At or below this the movement has reached the bottom (contracted). */
  downAngle: number;
  /** At or above this the movement is fully extended → a rep completes. */
  upAngle: number;
}

export interface FormContext {
  lm: Landmarks;
  /** Current primary angle. */
  measure: number;
  /** Deepest (smallest) primary angle reached during this rep. */
  minAngle: number;
}

export interface FormCheck {
  id: string;
  /** Return a short spoken/printed cue if form is off, else null. */
  evaluate: (ctx: FormContext) => string | null;
}

export interface HoldConfig {
  /** Is the body currently in a valid hold? Drives the timer. */
  inPosition: (lm: Landmarks) => boolean;
  /** Per-second form cue while holding (e.g. "lift your hips"), or null. */
  cue: (lm: Landmarks) => string | null;
}

export interface ExerciseDef {
  id: ExerciseId;
  name: string;
  emoji: string;
  kind: "rep" | "hold";
  /** Landmarks that must be visible to coach this safely. */
  requiredJoints: number[];
  rep?: RepConfig;
  hold?: HoldConfig;
  /** Form checks evaluated at the bottom of each rep (rep kind only). */
  form: FormCheck[];
  /** Spoken line when the exercise begins. */
  intro: string;
  /** Short on-screen "how to stand" hint. */
  setupHint: string;
}

// ── helpers ────────────────────────────────────────────────────────────
/** Angle at joint b using indices into the landmark array. */
function jAngle(lm: Landmarks, a: number, b: number, c: number): number {
  return angleAt(lm[a], lm[b], lm[c]);
}

/**
 * Pick the more reliable side for a single-limb measure: average both sides
 * when both are clearly visible, else use whichever side the camera sees best.
 * Front-on the user may angle their body, so one side is often cleaner.
 */
function sideAware(
  lm: Landmarks,
  left: [number, number, number],
  right: [number, number, number],
): number {
  const visL = avgVisibility([lm[left[0]], lm[left[1]], lm[left[2]]]);
  const visR = avgVisibility([lm[right[0]], lm[right[1]], lm[right[2]]]);
  const angL = jAngle(lm, left[0], left[1], left[2]);
  const angR = jAngle(lm, right[0], right[1], right[2]);
  if (visL > 0.5 && visR > 0.5) return (angL + angR) / 2;
  return visL >= visR ? angL : angR;
}

/** Horizontal gap between two landmarks (normalized). */
function hGap(a: Pt, b: Pt): number {
  return Math.abs(a.x - b.x);
}

// ── exercise definitions ────────────────────────────────────────────────

const SQUAT: ExerciseDef = {
  id: "squat",
  name: "Squats",
  emoji: "🏋️",
  kind: "rep",
  requiredJoints: [POSE.L_HIP, POSE.R_HIP, POSE.L_KNEE, POSE.R_KNEE, POSE.L_ANKLE, POSE.R_ANKLE],
  rep: {
    // A rep ARMS once the knee bends past ~110° (a real squat, not a dip) and
    // COMPLETES on standing back up (>160). The depth cue below then fires for
    // any counted rep that didn't reach parallel (≤100°) — so the arm
    // threshold MUST be shallower (higher angle) than the depth line.
    measure: (lm) =>
      sideAware(lm, [POSE.L_HIP, POSE.L_KNEE, POSE.L_ANKLE], [POSE.R_HIP, POSE.R_KNEE, POSE.R_ANKLE]),
    downAngle: 110,
    upAngle: 160,
  },
  form: [
    {
      id: "depth",
      evaluate: ({ minAngle }) =>
        minAngle > 100 ? "Go a little deeper next time" : null,
    },
    {
      id: "knee-cave",
      // Knees collapsing inward: the knee gap shrinks well below the ankle gap.
      evaluate: ({ lm }) =>
        hGap(lm[POSE.L_KNEE], lm[POSE.R_KNEE]) <
        hGap(lm[POSE.L_ANKLE], lm[POSE.R_ANKLE]) * 0.7
          ? "Push your knees out"
          : null,
    },
    {
      id: "symmetry",
      evaluate: ({ lm }) => {
        const l = jAngle(lm, POSE.L_HIP, POSE.L_KNEE, POSE.L_ANKLE);
        const r = jAngle(lm, POSE.R_HIP, POSE.R_KNEE, POSE.R_ANKLE);
        return Math.abs(l - r) > 22 ? "Keep it even, left and right" : null;
      },
    },
  ],
  intro: "Squats. Stand facing me, feet shoulder-width apart.",
  setupHint: "Stand back so I can see your hips, knees and feet.",
};

const PUSHUP: ExerciseDef = {
  id: "pushup",
  name: "Push-ups",
  emoji: "💪",
  kind: "rep",
  requiredJoints: [POSE.L_SHOULDER, POSE.R_SHOULDER, POSE.L_ELBOW, POSE.R_ELBOW, POSE.L_WRIST, POSE.R_WRIST],
  rep: {
    measure: (lm) =>
      sideAware(
        lm,
        [POSE.L_SHOULDER, POSE.L_ELBOW, POSE.L_WRIST],
        [POSE.R_SHOULDER, POSE.R_ELBOW, POSE.R_WRIST],
      ),
    downAngle: 115,
    upAngle: 155,
  },
  form: [
    {
      id: "depth",
      evaluate: ({ minAngle }) =>
        minAngle > 100 ? "Lower your chest more" : null,
    },
    {
      id: "body-line",
      // Shoulder–hip–ankle should be a straight line (~180). Sag or pike breaks it.
      evaluate: ({ lm }) => {
        const straight = sideAware(
          lm,
          [POSE.L_SHOULDER, POSE.L_HIP, POSE.L_ANKLE],
          [POSE.R_SHOULDER, POSE.R_HIP, POSE.R_ANKLE],
        );
        return straight < 150 ? "Keep your body in a straight line" : null;
      },
    },
  ],
  intro: "Push-ups. Get into a push-up position, side-on to me works best.",
  setupHint: "Turn side-on so I can see your arm bend.",
};

const LUNGE: ExerciseDef = {
  id: "lunge",
  name: "Lunges",
  emoji: "🦵",
  kind: "rep",
  requiredJoints: [POSE.L_HIP, POSE.R_HIP, POSE.L_KNEE, POSE.R_KNEE, POSE.L_ANKLE, POSE.R_ANKLE],
  rep: {
    // The forward leg bends most — track the MORE bent knee so it works for
    // either leg, alternating.
    measure: (lm) => {
      const l = jAngle(lm, POSE.L_HIP, POSE.L_KNEE, POSE.L_ANKLE);
      const r = jAngle(lm, POSE.R_HIP, POSE.R_KNEE, POSE.R_ANKLE);
      return Math.min(l, r);
    },
    downAngle: 130,
    upAngle: 160,
  },
  form: [
    {
      id: "depth",
      evaluate: ({ minAngle }) =>
        minAngle > 115 ? "Drop your back knee lower" : null,
    },
    {
      id: "upright",
      // Torso should stay roughly upright: shoulders above hips, not tipped far forward.
      evaluate: ({ lm }) => {
        const shoulder = (lm[POSE.L_SHOULDER].visibility ?? 0) > (lm[POSE.R_SHOULDER].visibility ?? 0)
          ? lm[POSE.L_SHOULDER]
          : lm[POSE.R_SHOULDER];
        const hip = (lm[POSE.L_HIP].visibility ?? 0) > (lm[POSE.R_HIP].visibility ?? 0)
          ? lm[POSE.L_HIP]
          : lm[POSE.R_HIP];
        return hGap(shoulder, hip) > 0.18 ? "Keep your chest up" : null;
      },
    },
  ],
  intro: "Lunges. Step one foot forward and lower down, alternating legs.",
  setupHint: "Give yourself room to step forward, facing me.",
};

const PLANK: ExerciseDef = {
  id: "plank",
  name: "Plank",
  emoji: "🧘",
  kind: "hold",
  requiredJoints: [POSE.L_SHOULDER, POSE.R_SHOULDER, POSE.L_HIP, POSE.R_HIP, POSE.L_ANKLE, POSE.R_ANKLE],
  hold: {
    inPosition: (lm) => {
      const straight = sideAware(
        lm,
        [POSE.L_SHOULDER, POSE.L_HIP, POSE.L_ANKLE],
        [POSE.R_SHOULDER, POSE.R_HIP, POSE.R_ANKLE],
      );
      return straight > 150;
    },
    cue: (lm) => {
      // Decide sag vs pike by where the hip sits relative to the line from
      // shoulder to ankle (mid-y). Hip lower on screen (greater y) = sagging.
      const shoulder = lm[POSE.L_SHOULDER];
      const hip = lm[POSE.L_HIP];
      const ankle = lm[POSE.L_ANKLE];
      const straight = sideAware(
        lm,
        [POSE.L_SHOULDER, POSE.L_HIP, POSE.L_ANKLE],
        [POSE.R_SHOULDER, POSE.R_HIP, POSE.R_ANKLE],
      );
      if (straight > 155) return null; // good line
      const midY = (shoulder.y + ankle.y) / 2;
      return hip.y > midY ? "Lift your hips" : "Lower your hips, flat back";
    },
  },
  form: [],
  intro: "Plank. Hold a straight line from your shoulders to your heels. I'll time you.",
  setupHint: "Turn side-on so I can see your back line.",
};

export const EXERCISES: Record<ExerciseId, ExerciseDef> = {
  squat: SQUAT,
  pushup: PUSHUP,
  lunge: LUNGE,
  plank: PLANK,
};

export interface RoutineStep {
  id: ExerciseId;
  /** Target reps (rep kind) — ignored for holds. */
  reps?: number;
  /** Target seconds (hold kind). */
  seconds?: number;
  /** Rest after this step, seconds. */
  rest: number;
}

/** The default guided workout the founder picked: all four, sensible volume. */
export const DEFAULT_ROUTINE: RoutineStep[] = [
  { id: "squat", reps: 10, rest: 15 },
  { id: "pushup", reps: 8, rest: 15 },
  { id: "lunge", reps: 10, rest: 15 },
  { id: "plank", seconds: 30, rest: 0 },
];
