/**
 * exercises.ts — the AI Exercise CATALOG. Each exercise is data: rep-angle
 * config + a list of reusable, orientation-aware form checks (from
 * formHelpers) + calorie MET + injury contraindications. Adding an exercise
 * is just adding an entry — the engine (ExerciseMode + repCounter + formHelpers)
 * stays unchanged.
 *
 * Source: founder-supplied researched catalog (batch 1), encoded for the
 * exercises the webcam can judge reliably ("high"/usable detectability). Angles
 * tuned so the rep-arm threshold is shallower than the "good form" line, so a
 * short rep still counts but still earns a correction. Tune on real footage.
 */
import { angleAt } from "./angles";
import { POSE } from "./poseConstants";
import type { ExerciseDef, Landmarks } from "./types";
import { BATCH_23 } from "./catalogBatch23";
import {
  bilateral,
  moreBent,
  depthCue,
  lockoutCue,
  trunkLeanCue,
  bodyLineCue,
  kneesCavingCue,
  overExtensionCue,
  kneesStraightCue,
} from "./formHelpers";

const LEGS = [POSE.L_HIP, POSE.R_HIP, POSE.L_KNEE, POSE.R_KNEE, POSE.L_ANKLE, POSE.R_ANKLE];
const ARMS = [POSE.L_SHOULDER, POSE.R_SHOULDER, POSE.L_ELBOW, POSE.R_ELBOW, POSE.L_WRIST, POSE.R_WRIST];
const BODY = [POSE.L_SHOULDER, POSE.R_SHOULDER, POSE.L_HIP, POSE.R_HIP, POSE.L_ANKLE, POSE.R_ANKLE];

const KNEE_L: [number, number, number] = [POSE.L_HIP, POSE.L_KNEE, POSE.L_ANKLE];
const KNEE_R: [number, number, number] = [POSE.R_HIP, POSE.R_KNEE, POSE.R_ANKLE];
const ELBOW_L: [number, number, number] = [POSE.L_SHOULDER, POSE.L_ELBOW, POSE.L_WRIST];
const ELBOW_R: [number, number, number] = [POSE.R_SHOULDER, POSE.R_ELBOW, POSE.R_WRIST];
const ANKLE_L: [number, number, number] = [POSE.L_KNEE, POSE.L_ANKLE, POSE.L_FOOT];
const ANKLE_R: [number, number, number] = [POSE.R_KNEE, POSE.R_ANKLE, POSE.R_FOOT];

const kneeAvg = bilateral(KNEE_L, KNEE_R);
const elbowAvg = bilateral(ELBOW_L, ELBOW_R);
const frontKnee = moreBent(KNEE_L, KNEE_R);

const CATALOG: ExerciseDef[] = [
  {
    id: "bodyweight-squat", name: "Squats", emoji: "🏋️", kind: "rep", met: 5.0,
    category: "home", equipment: "none", primaryMuscles: ["quads", "glutes", "hamstrings"],
    difficulty: "beginner", goalFit: ["muscle", "weight-loss", "strength", "mobility"], detectable: "high",
    requiredJoints: LEGS,
    rep: { measure: kneeAvg, downAngle: 110, upAngle: 160 },
    form: [depthCue(100, "Go a little deeper"), trunkLeanCue(45, "Chest up"), kneesCavingCue(0.7, "Push your knees out")],
    intro: "Squats. Stand facing me, feet shoulder-width apart.",
    setupHint: "Step back so I see your hips, knees and feet.",
    contraindications: [
      { condition: "knee osteoarthritis", modification: "stay in a pain-free depth, squat to a chair" },
      { condition: "lower-back pain", modification: "keep the range shallow, limit forward lean" },
    ],
  },
  {
    id: "goblet-squat", name: "Goblet Squats", emoji: "🏋️", kind: "rep", met: 5.0,
    category: "gym", equipment: "dumbbell", primaryMuscles: ["quads", "glutes", "core"],
    difficulty: "beginner", goalFit: ["muscle", "strength", "weight-loss"], detectable: "high",
    requiredJoints: LEGS,
    rep: { measure: kneeAvg, downAngle: 110, upAngle: 160 },
    form: [depthCue(100, "Hips lower"), trunkLeanCue(40, "Stay tall"), kneesCavingCue(0.7, "Knees out")],
    intro: "Goblet squats. Hold the weight at your chest, facing me.",
    setupHint: "Side-on or front both work; show your knees and hips.",
    contraindications: [
      { condition: "knee osteoarthritis", modification: "shallow box squat, lighter load" },
      { condition: "wrists", modification: "cradle the weight in your forearms, not your wrists" },
    ],
  },
  {
    id: "sumo-squat", name: "Sumo Squats", emoji: "🦵", kind: "rep", met: 5.0,
    category: "home", equipment: "none", primaryMuscles: ["glutes", "adductors", "quads"],
    difficulty: "beginner", goalFit: ["muscle", "mobility", "weight-loss"], detectable: "high",
    requiredJoints: LEGS,
    rep: { measure: kneeAvg, downAngle: 120, upAngle: 160 },
    form: [kneesCavingCue(0.85, "Push your knees out"), depthCue(105, "Drop your hips lower")],
    intro: "Sumo squats. Wide stance, toes out, face me.",
    setupHint: "Face the camera so I can see your knees track out.",
    contraindications: [
      { condition: "hips", modification: "narrow the stance, reduce depth" },
      { condition: "knee osteoarthritis", modification: "limit depth to comfort" },
    ],
  },
  {
    id: "split-squat", name: "Split Squats", emoji: "🦵", kind: "rep", met: 5.0,
    category: "home", equipment: "none", primaryMuscles: ["quads", "glutes", "hamstrings"],
    difficulty: "intermediate", goalFit: ["muscle", "strength", "mobility"], detectable: "high",
    requiredJoints: LEGS,
    rep: { measure: frontKnee, downAngle: 120, upAngle: 160 },
    form: [depthCue(110, "Drop the back knee"), trunkLeanCue(25, "Chest tall")],
    intro: "Split squats. One foot forward, one back, and lower straight down.",
    setupHint: "Turn side-on so I can see the front knee bend.",
    contraindications: [
      { condition: "knee osteoarthritis", modification: "reduce depth, shorten range" },
      { condition: "balance", modification: "hold a wall or chair" },
    ],
  },
  {
    id: "reverse-lunge", name: "Reverse Lunges", emoji: "🦵", kind: "rep", met: 5.0,
    category: "home", equipment: "none", primaryMuscles: ["quads", "glutes", "hamstrings"],
    difficulty: "intermediate", goalFit: ["muscle", "strength", "weight-loss", "mobility"], detectable: "high",
    requiredJoints: LEGS,
    rep: { measure: frontKnee, downAngle: 120, upAngle: 160 },
    form: [depthCue(110, "Lower the back knee"), trunkLeanCue(30, "Stand tall")],
    intro: "Reverse lunges. Step back and lower, alternating legs.",
    setupHint: "Side-on shows your depth best.",
    contraindications: [
      { condition: "knee osteoarthritis", modification: "shorten the range, hold support" },
      { condition: "balance", modification: "use a wall for support" },
    ],
  },
  {
    id: "forward-lunge", name: "Lunges", emoji: "🦵", kind: "rep", met: 5.0,
    category: "home", equipment: "none", primaryMuscles: ["quads", "glutes", "hamstrings"],
    difficulty: "intermediate", goalFit: ["muscle", "strength", "weight-loss"], detectable: "high",
    requiredJoints: LEGS,
    rep: { measure: frontKnee, downAngle: 120, upAngle: 160 },
    form: [depthCue(110, "Drop deeper"), trunkLeanCue(30, "Chest tall")],
    intro: "Lunges. Step forward and lower, alternating legs.",
    setupHint: "Give yourself room to step forward; side-on is best.",
    contraindications: [
      { condition: "knee osteoarthritis", modification: "use reverse lunges instead, reduce depth" },
      { condition: "knees", modification: "limit how far the knee travels, shorten range" },
    ],
  },
  {
    id: "wall-sit", name: "Wall Sit", emoji: "🧱", kind: "hold", met: 4.0,
    category: "home", equipment: "none", primaryMuscles: ["quads", "glutes"],
    difficulty: "beginner", goalFit: ["strength", "muscle"], detectable: "high",
    requiredJoints: LEGS,
    hold: {
      inPosition: (lm: Landmarks) => {
        const k = (angleAt(lm[POSE.L_HIP], lm[POSE.L_KNEE], lm[POSE.L_ANKLE]) +
          angleAt(lm[POSE.R_HIP], lm[POSE.R_KNEE], lm[POSE.R_ANKLE])) / 2;
        return k > 70 && k < 115;
      },
      cue: (lm: Landmarks) => {
        const k = (angleAt(lm[POSE.L_HIP], lm[POSE.L_KNEE], lm[POSE.L_ANKLE]) +
          angleAt(lm[POSE.R_HIP], lm[POSE.R_KNEE], lm[POSE.R_ANKLE])) / 2;
        if (k > 105) return "Slide a little lower";
        return null;
      },
    },
    form: [],
    intro: "Wall sit. Back on the wall, thighs parallel, and hold.",
    setupHint: "Side-on so I can see your knee bend to 90°.",
    contraindications: [
      { condition: "knees", modification: "hold at a higher angle (shallower), shorter holds" },
      { condition: "high blood pressure", modification: "don't hold your breath — breathe steadily" },
    ],
  },
  {
    id: "glute-bridge", name: "Glute Bridge", emoji: "🌉", kind: "rep", met: 3.5,
    category: "home", equipment: "none", primaryMuscles: ["glutes", "hamstrings"],
    difficulty: "beginner", goalFit: ["muscle", "strength", "mobility"], detectable: "high",
    requiredJoints: [POSE.L_SHOULDER, POSE.R_SHOULDER, POSE.L_HIP, POSE.R_HIP, POSE.L_KNEE, POSE.R_KNEE],
    // Hip EXTENSION rep: rests low (~120°), squeezes high (~175°). Arm low, complete high.
    rep: { measure: (lm) => angleAt(lm[POSE.L_SHOULDER], lm[POSE.L_HIP], lm[POSE.L_KNEE]), downAngle: 135, upAngle: 158 },
    form: [
      lockoutCue(165, "Squeeze your hips all the way up"),
      overExtensionCue(POSE.L_SHOULDER, POSE.L_HIP, POSE.L_KNEE, 188, "Ribs down, don't over-arch"),
    ],
    intro: "Glute bridges. Lie on your back, knees bent, and drive your hips up.",
    setupHint: "Lie side-on to the camera so I see your hips rise.",
    contraindications: [
      { condition: "lower-back pain", modification: "stop at neutral, don't over-arch the top" },
      { condition: "pregnancy", modification: "avoid prolonged lying on your back" },
    ],
  },
  {
    id: "hip-thrust", name: "Hip Thrust", emoji: "🍑", kind: "rep", met: 4.0,
    category: "home", equipment: "none", primaryMuscles: ["glutes", "hamstrings"],
    difficulty: "intermediate", goalFit: ["muscle", "strength"], detectable: "high",
    requiredJoints: [POSE.L_SHOULDER, POSE.R_SHOULDER, POSE.L_HIP, POSE.R_HIP, POSE.L_KNEE, POSE.R_KNEE],
    rep: { measure: (lm) => angleAt(lm[POSE.L_SHOULDER], lm[POSE.L_HIP], lm[POSE.L_KNEE]), downAngle: 130, upAngle: 160 },
    form: [
      lockoutCue(168, "Full hip extension at the top"),
      overExtensionCue(POSE.L_SHOULDER, POSE.L_HIP, POSE.L_KNEE, 192, "Ribs down"),
    ],
    intro: "Hip thrusts. Upper back on a bench or couch, drive your hips up.",
    setupHint: "Side-on so I can see your hips lock out.",
    contraindications: [
      { condition: "lower-back pain", modification: "stop at neutral, avoid over-extending" },
    ],
  },
  {
    id: "push-up", name: "Push-ups", emoji: "💪", kind: "rep", met: 4.0,
    category: "home", equipment: "none", primaryMuscles: ["chest", "triceps", "shoulders"],
    difficulty: "intermediate", goalFit: ["muscle", "strength", "weight-loss"], detectable: "high",
    requiredJoints: ARMS,
    rep: { measure: elbowAvg, downAngle: 110, upAngle: 150 },
    form: [depthCue(100, "Lower your chest more"), bodyLineCue(16, "Keep a flat body line")],
    intro: "Push-ups. Side-on to me works best.",
    setupHint: "Turn side-on so I can see your elbow bend and body line.",
    contraindications: [
      { condition: "shoulders", modification: "narrower hands, reduce depth" },
      { condition: "wrists", modification: "use push-up handles or fists" },
      { condition: "lower-back pain", modification: "drop to your knees to keep a neutral line" },
    ],
  },
  {
    id: "knee-push-up", name: "Knee Push-ups", emoji: "💪", kind: "rep", met: 3.5,
    category: "home", equipment: "none", primaryMuscles: ["chest", "triceps", "shoulders"],
    difficulty: "beginner", goalFit: ["muscle", "strength"], detectable: "high",
    requiredJoints: ARMS,
    rep: { measure: elbowAvg, downAngle: 110, upAngle: 150 },
    form: [depthCue(100, "Chest closer to the floor")],
    intro: "Knee push-ups. On your knees, side-on to me.",
    setupHint: "Side-on so I can see your elbows bend.",
    contraindications: [
      { condition: "wrists", modification: "use handles or fists" },
      { condition: "knees", modification: "pad your knees, or do incline push-ups instead" },
    ],
  },
  {
    id: "incline-push-up", name: "Incline Push-ups", emoji: "💪", kind: "rep", met: 3.5,
    category: "home", equipment: "none", primaryMuscles: ["chest", "triceps", "shoulders"],
    difficulty: "beginner", goalFit: ["muscle", "strength"], detectable: "high",
    requiredJoints: ARMS,
    rep: { measure: elbowAvg, downAngle: 115, upAngle: 150 },
    form: [depthCue(105, "Lower all the way"), bodyLineCue(16, "Straight line")],
    intro: "Incline push-ups. Hands on a raised surface, side-on.",
    setupHint: "Side-on so I can see your arm bend.",
    contraindications: [
      { condition: "shoulders", modification: "raise the surface higher to reduce load" },
      { condition: "wrists", modification: "grip the edge or use handles" },
    ],
  },
  {
    id: "diamond-push-up", name: "Diamond Push-ups", emoji: "💎", kind: "rep", met: 4.0,
    category: "home", equipment: "none", primaryMuscles: ["triceps", "chest", "shoulders"],
    difficulty: "advanced", goalFit: ["muscle", "strength"], detectable: "high",
    requiredJoints: ARMS,
    rep: { measure: elbowAvg, downAngle: 105, upAngle: 150 },
    form: [depthCue(95, "Chest to your hands"), bodyLineCue(16, "Flat body")],
    intro: "Diamond push-ups. Hands together under your chest, side-on.",
    setupHint: "Side-on so I can see your elbows bend.",
    contraindications: [
      { condition: "wrists", modification: "widen to a standard push-up" },
      { condition: "elbows", modification: "avoid — high elbow stress; do standard push-ups" },
    ],
  },
  {
    id: "calf-raise", name: "Calf Raises", emoji: "🦶", kind: "rep", met: 3.0,
    category: "home", equipment: "none", primaryMuscles: ["calves"],
    difficulty: "beginner", goalFit: ["muscle", "strength"], detectable: "medium",
    requiredJoints: [POSE.L_KNEE, POSE.R_KNEE, POSE.L_ANKLE, POSE.R_ANKLE, POSE.L_FOOT, POSE.R_FOOT],
    // Ankle plantarflexion: flat (~95°) → up on toes (~120°). Extension rep.
    rep: { measure: bilateral(ANKLE_L, ANKLE_R), downAngle: 100, upAngle: 115 },
    form: [lockoutCue(120, "Rise up higher"), kneesStraightCue(165, "Keep your legs straight")],
    intro: "Calf raises. Stand tall and rise onto your toes.",
    setupHint: "Side-on so I can see your heels lift.",
    contraindications: [
      { condition: "ankles", modification: "reduce range, avoid a deep stretch under load" },
      { condition: "balance", modification: "hold a wall for support" },
    ],
  },
  {
    id: "plank", name: "Plank", emoji: "🧘", kind: "hold", met: 3.3,
    category: "home", equipment: "none", primaryMuscles: ["core", "shoulders"],
    difficulty: "beginner", goalFit: ["strength", "mobility"], detectable: "high",
    requiredJoints: BODY,
    hold: {
      inPosition: (lm: Landmarks) => {
        const a = angleAt(lm[POSE.L_SHOULDER], lm[POSE.L_HIP], lm[POSE.L_ANKLE]);
        return a > 150;
      },
      cue: (lm: Landmarks) => {
        const a = angleAt(lm[POSE.L_SHOULDER], lm[POSE.L_HIP], lm[POSE.L_ANKLE]);
        if (a > 155) return null;
        const midY = (lm[POSE.L_SHOULDER].y + lm[POSE.L_ANKLE].y) / 2;
        return lm[POSE.L_HIP].y > midY ? "Lift your hips" : "Lower your hips, flat back";
      },
    },
    form: [],
    intro: "Plank. Hold a straight line from shoulders to heels.",
    setupHint: "Turn side-on so I can see your back line.",
    contraindications: [
      { condition: "lower-back pain", modification: "drop to your knees, shorter holds" },
      { condition: "high blood pressure", modification: "breathe steadily, don't hold your breath" },
    ],
  },
];

// Verified additions from the founder's researched catalog (batches 2 & 3,
// plus the safe kettlebell moves from batch 4). Kept in their own file; merged
// here so adding more batches is a one-line append.
const ALL: ExerciseDef[] = [...CATALOG, ...BATCH_23];

export const EXERCISES: Record<string, ExerciseDef> = Object.fromEntries(
  ALL.map((e) => [e.id, e]),
);
export const EXERCISE_LIST: ExerciseDef[] = ALL;
