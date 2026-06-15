/**
 * catalogBatch4.ts — dumbbell exercises from the founder's catalog batch 4,
 * encoded per the verification plan. Only the camera-judgeable ones; thresholds
 * use OUR rep convention (arm threshold shallower than the good-form line so a
 * short rep still counts but still earns a cue) — NOT the raw anatomical
 * endpoints in the source JSON.
 *
 * Dropped: db-fly & db-pullover (lying, non-angular — undetectable),
 * db-renegade-row (needs an anti-rotation primitive). Deduped: db-calf-raise
 * (= calf-raise), db-lunge (= forward-lunge). Back-loaded rows gate on injury.
 */
import { POSE } from "./poseConstants";
import type { ExerciseDef } from "./types";
import {
  bilateral,
  moreBent,
  depthCue,
  lockoutCue,
  trunkLeanCue,
  overExtensionCue,
} from "./formHelpers";

const ARMS = [POSE.L_SHOULDER, POSE.R_SHOULDER, POSE.L_ELBOW, POSE.R_ELBOW, POSE.L_WRIST, POSE.R_WRIST];
const LEGS = [POSE.L_HIP, POSE.R_HIP, POSE.L_KNEE, POSE.R_KNEE, POSE.L_ANKLE, POSE.R_ANKLE];

const ELBOW_L: [number, number, number] = [POSE.L_SHOULDER, POSE.L_ELBOW, POSE.L_WRIST];
const ELBOW_R: [number, number, number] = [POSE.R_SHOULDER, POSE.R_ELBOW, POSE.R_WRIST];
const KNEE_L: [number, number, number] = [POSE.L_HIP, POSE.L_KNEE, POSE.L_ANKLE];
const KNEE_R: [number, number, number] = [POSE.R_HIP, POSE.R_KNEE, POSE.R_ANKLE];

const elbowAvg = bilateral(ELBOW_L, ELBOW_R);
const elbowWorking = moreBent(ELBOW_L, ELBOW_R);
const kneeWorking = moreBent(KNEE_L, KNEE_R);
// "Pin your elbows" = shoulder flexion past a small angle (elbow drifts forward).
const pinElbows = (cue: string) => overExtensionCue(POSE.L_HIP, POSE.L_SHOULDER, POSE.L_ELBOW, 28, cue);

export const BATCH_4: ExerciseDef[] = [
  {
    id: "db-bent-over-row", name: "Bent-Over Rows", emoji: "🚣", kind: "rep", met: 5.0,
    category: "gym", equipment: "dumbbells", primaryMuscles: ["lats", "upper-back", "biceps"],
    difficulty: "intermediate", goalFit: ["muscle", "strength"], detectable: "medium", requiredJoints: ARMS,
    rep: { measure: elbowWorking, downAngle: 120, upAngle: 155 },
    form: [depthCue(95, "Drive your elbow up to your hip"), trunkLeanCue(15, "Keep your chest down — don't let your torso rise")],
    intro: "Bent-over rows. Hinge forward, row the weights up to your hips. I can't see your spine on this — keep it flat yourself.",
    setupHint: "Side-on so I can see your elbows pull up.",
    contraindications: [
      { condition: "lower-back", modification: "avoid — use a chest-supported row; I can't see if your back rounds" },
      { condition: "disc", modification: "avoid the unsupported hinge" },
    ],
  },
  {
    id: "db-single-arm-row", name: "Single-Arm Rows", emoji: "💪", kind: "rep", met: 4.5,
    category: "gym", equipment: "dumbbell + bench", primaryMuscles: ["lats", "upper-back", "biceps"],
    difficulty: "beginner", goalFit: ["muscle", "strength"], detectable: "medium", requiredJoints: ARMS,
    rep: { measure: elbowWorking, downAngle: 120, upAngle: 155 },
    form: [depthCue(90, "Drive the elbow back past your ribs")],
    intro: "Single-arm rows. Brace a hand and knee on a bench, row the weight to your ribs.",
    setupHint: "Side-on so I can see the working arm pull.",
    contraindications: [
      { condition: "lower-back", modification: "brace your free hand and knee on a bench to support your spine" },
      { condition: "shoulders", modification: "reduce the top range, keep the elbow close" },
    ],
  },
  {
    id: "db-biceps-curl", name: "Biceps Curls", emoji: "💪", kind: "rep", met: 3.5,
    category: "gym", equipment: "dumbbells", primaryMuscles: ["biceps"],
    difficulty: "beginner", goalFit: ["muscle"], detectable: "high", requiredJoints: ARMS,
    rep: { measure: elbowAvg, downAngle: 120, upAngle: 150 },
    form: [depthCue(90, "Squeeze all the way up"), pinElbows("Pin your elbows — stop them swinging forward")],
    intro: "Biceps curls. Curl the weights up, lower with control.",
    setupHint: "Side-on so I can see your elbows bend.",
    contraindications: [
      { condition: "elbows", modification: "use an EZ-bar feel — neutral grip, lighter, slower" },
    ],
  },
  {
    id: "db-hammer-curl", name: "Hammer Curls", emoji: "🔨", kind: "rep", met: 3.5,
    category: "gym", equipment: "dumbbells", primaryMuscles: ["biceps", "forearms"],
    difficulty: "beginner", goalFit: ["muscle"], detectable: "high", requiredJoints: ARMS,
    rep: { measure: elbowAvg, downAngle: 120, upAngle: 150 },
    form: [pinElbows("Keep your elbows back — no swinging forward"), trunkLeanCue(10, "Keep your torso still")],
    intro: "Hammer curls. Palms facing in, curl up and lower.",
    setupHint: "Side-on so I can see your elbows bend.",
    contraindications: [
      { condition: "elbows", modification: "lighter load, slow tempo" },
    ],
  },
  {
    id: "db-triceps-kickback", name: "Triceps Kickbacks", emoji: "🦵", kind: "rep", met: 3.5,
    category: "gym", equipment: "dumbbells", primaryMuscles: ["triceps"],
    difficulty: "beginner", goalFit: ["muscle"], detectable: "medium", requiredJoints: ARMS,
    // Extension: elbow flexed (~90) → straightened back (~165).
    rep: { measure: elbowAvg, downAngle: 110, upAngle: 150 },
    form: [lockoutCue(155, "Straighten your arm fully")],
    intro: "Triceps kickbacks. Upper arms pinned by your sides, straighten back.",
    setupHint: "Side-on; brace on a bench so I can see your elbow extend.",
    contraindications: [
      { condition: "elbows", modification: "lighter load, don't snap into lockout" },
      { condition: "lower-back", modification: "support your torso on a bench instead of the free hinge" },
    ],
  },
  {
    id: "db-overhead-triceps-extension", name: "Overhead Triceps Extension", emoji: "🙆", kind: "rep", met: 3.5,
    category: "gym", equipment: "dumbbell", primaryMuscles: ["triceps"],
    difficulty: "beginner", goalFit: ["muscle"], detectable: "medium", requiredJoints: ARMS,
    // Extension: flexed behind head (~70) → reached overhead (~165).
    rep: { measure: elbowAvg, downAngle: 100, upAngle: 150 },
    form: [lockoutCue(158, "Reach tall, lock it out")],
    intro: "Overhead triceps extension. Lower behind your head, reach tall.",
    setupHint: "Seated with back support; side-on so I can see your elbow extend.",
    contraindications: [
      { condition: "shoulders", modification: "reduce the behind-head range, or do kickbacks instead" },
      { condition: "lower-back", modification: "do it seated with back support to avoid arching" },
    ],
  },
  {
    id: "db-step-up", name: "Step-Ups", emoji: "🪜", kind: "rep", met: 5.0,
    category: "gym", equipment: "dumbbells + box", primaryMuscles: ["quads", "glutes", "hamstrings"],
    difficulty: "intermediate", goalFit: ["muscle", "strength", "weight-loss"], detectable: "medium", requiredJoints: LEGS,
    // Lead knee bent on the box (~90) → standing tall on the box (~170).
    rep: { measure: kneeWorking, downAngle: 130, upAngle: 160 },
    form: [lockoutCue(165, "Stand all the way up on the box")],
    intro: "Step-ups. Drive up onto the box through your top leg, step down.",
    setupHint: "Side-on; the box may hide your lower leg, so stand back a bit.",
    contraindications: [
      { condition: "knees", modification: "use a lower box, lighter load" },
      { condition: "ankles", modification: "lower box, hold a rail for balance" },
    ],
  },
  {
    id: "db-bulgarian-split-squat", name: "Bulgarian Split Squats", emoji: "🦿", kind: "rep", met: 5.5,
    category: "gym", equipment: "dumbbells + bench", primaryMuscles: ["quads", "glutes", "hamstrings"],
    difficulty: "advanced", goalFit: ["muscle", "strength"], detectable: "medium", requiredJoints: LEGS,
    rep: { measure: kneeWorking, downAngle: 120, upAngle: 160 },
    form: [depthCue(110, "Drop a bit deeper"), trunkLeanCue(25, "Stay tall")],
    intro: "Bulgarian split squats. Rear foot on a bench, lower straight down.",
    setupHint: "Side-on so I can see the front knee bend.",
    contraindications: [
      { condition: "knees", modification: "reduce depth, lower the rear-foot height" },
      { condition: "ankles", modification: "hold a rail; reduce depth" },
    ],
  },
  {
    id: "db-thruster", name: "Thrusters", emoji: "🚀", kind: "rep", met: 6.0,
    category: "gym", equipment: "dumbbells", primaryMuscles: ["quads", "shoulders", "glutes"],
    difficulty: "intermediate", goalFit: ["muscle", "strength", "weight-loss"], detectable: "low", requiredJoints: ARMS,
    // The overhead press is the primary, countable phase (elbow ~90 racked → ~165 overhead).
    rep: { measure: elbowAvg, downAngle: 110, upAngle: 150 },
    form: [lockoutCue(155, "Press fully overhead"), trunkLeanCue(15, "Ribs down, stand tall — don't lean back")],
    intro: "Thrusters. Squat, then drive the weights overhead. I count the press and cue lockout.",
    setupHint: "Side-on; I track the press, so press all the way up.",
    contraindications: [
      { condition: "shoulders", modification: "neutral grip, limit the overhead range" },
      { condition: "lower-back", modification: "lighter load, stay strict — don't arch to press" },
    ],
  },
];
