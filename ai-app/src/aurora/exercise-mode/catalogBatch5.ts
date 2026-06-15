/**
 * catalogBatch5.ts — barbell & machine exercises from catalog batch 5, encoded
 * per the verification plan. Most are HONESTLY "low" detectable: the camera
 * counts reps + cues range/lockout, but on loaded barbell lifts it CANNOT see
 * spinal rounding (the real injury risk) — so those drop the "flat back" cue,
 * gate back/disc injuries (auto-excluded via "avoid"), and say so in the intro.
 *
 * Dropped/deferred (verification): barbell bench (lying), pec deck & db-fly
 * (need a fly primitive), barbell bent-over row (needs spine we can't see;
 * db-bent-over-row already covers it), leg-press & chest-press (occluded),
 * overhead carry hold (bar not trackable). Deduped: barbell RDL / hip-thrust /
 * glute-bridge (= db-romanian-deadlift / hip-thrust / glute-bridge).
 */
import { angleAt } from "./angles";
import { POSE } from "./poseConstants";
import type { ExerciseDef } from "./types";
import { bilateral, depthCue, lockoutCue, trunkLeanCue } from "./formHelpers";

const ARMS = [POSE.L_SHOULDER, POSE.R_SHOULDER, POSE.L_ELBOW, POSE.R_ELBOW, POSE.L_WRIST, POSE.R_WRIST];
const LEGS = [POSE.L_HIP, POSE.R_HIP, POSE.L_KNEE, POSE.R_KNEE, POSE.L_ANKLE, POSE.R_ANKLE];
const HIP_KNEE = [POSE.L_SHOULDER, POSE.R_SHOULDER, POSE.L_HIP, POSE.R_HIP, POSE.L_KNEE, POSE.R_KNEE];

const ELBOW_L: [number, number, number] = [POSE.L_SHOULDER, POSE.L_ELBOW, POSE.L_WRIST];
const ELBOW_R: [number, number, number] = [POSE.R_SHOULDER, POSE.R_ELBOW, POSE.R_WRIST];
const KNEE_L: [number, number, number] = [POSE.L_HIP, POSE.L_KNEE, POSE.L_ANKLE];
const KNEE_R: [number, number, number] = [POSE.R_HIP, POSE.R_KNEE, POSE.R_ANKLE];

const elbowAvg = bilateral(ELBOW_L, ELBOW_R);
const kneeAvg = bilateral(KNEE_L, KNEE_R);
const hipHinge = (lm: { x: number; y: number }[]) => angleAt(lm[POSE.L_SHOULDER], lm[POSE.L_HIP], lm[POSE.L_KNEE]);

export const BATCH_5: ExerciseDef[] = [
  // ── Gated heavy barbell lifts (count + range only; spine not visible) ──
  {
    id: "barbell-back-squat", name: "Barbell Back Squat", emoji: "🏋️", kind: "rep", met: 6.0,
    category: "gym", equipment: "barbell + rack", primaryMuscles: ["quads", "glutes", "hamstrings"],
    difficulty: "advanced", goalFit: ["strength", "muscle"], detectable: "low", requiredJoints: LEGS,
    rep: { measure: kneeAvg, downAngle: 110, upAngle: 160 },
    form: [depthCue(100, "Hit depth"), trunkLeanCue(45, "Chest up")],
    intro: "Barbell back squat. Use a rack and a spotter. I count reps and cue depth, but I can't see your spine — stay braced and flat.",
    setupHint: "Side-on. Your knee angle is a depth proxy; the bar isn't visible.",
    contraindications: [
      { condition: "lower-back", modification: "avoid — reduce to a goblet or box squat; I can't check your back under load" },
      { condition: "knees", modification: "box squat to a comfortable depth, lighter load" },
    ],
  },
  {
    id: "barbell-front-squat", name: "Barbell Front Squat", emoji: "🏋️", kind: "rep", met: 6.0,
    category: "gym", equipment: "barbell + rack", primaryMuscles: ["quads", "glutes", "core"],
    difficulty: "advanced", goalFit: ["strength", "muscle"], detectable: "low", requiredJoints: LEGS,
    rep: { measure: kneeAvg, downAngle: 110, upAngle: 160 },
    form: [depthCue(95, "Sit to depth"), trunkLeanCue(35, "Stay tall, elbows up")],
    intro: "Barbell front squat. Rack and spotter. I count reps and cue depth — keep your torso tall and braced.",
    setupHint: "Side-on. Knee angle is a depth proxy.",
    contraindications: [
      { condition: "lower-back", modification: "reduce load and limit depth" },
      { condition: "knees", modification: "reduce depth and load" },
      { condition: "wrists", modification: "use a cross-arm grip to offload the wrists" },
    ],
  },
  {
    id: "barbell-deadlift", name: "Barbell Deadlift", emoji: "🏋️", kind: "rep", met: 6.0,
    category: "gym", equipment: "barbell + plates", primaryMuscles: ["glutes", "hamstrings", "lower-back"],
    difficulty: "advanced", goalFit: ["strength", "muscle"], detectable: "low", requiredJoints: HIP_KNEE,
    // Hip-hinge flexion rep (same pattern as kb-deadlift): dip into the hinge, stand to lock out.
    rep: { measure: hipHinge, downAngle: 120, upAngle: 160 },
    form: [lockoutCue(165, "Stand tall and lock out")],
    intro: "Barbell deadlift. Heavy pull — I CANNOT see your spine. Keep a flat back, go light, use a belt and spotter.",
    setupHint: "Side-on so I can see your hinge and lockout.",
    contraindications: [
      { condition: "lower-back", modification: "avoid — use a rack pull or hip thrust; spinal rounding isn't visible to me" },
      { condition: "disc", modification: "avoid heavy conventional pulls" },
    ],
  },
  {
    id: "barbell-overhead-press", name: "Barbell Overhead Press", emoji: "🏋️", kind: "rep", met: 5.0,
    category: "gym", equipment: "barbell", primaryMuscles: ["shoulders", "triceps"],
    difficulty: "advanced", goalFit: ["strength", "muscle"], detectable: "low", requiredJoints: ARMS,
    rep: { measure: elbowAvg, downAngle: 95, upAngle: 150 },
    form: [lockoutCue(160, "Lock out overhead"), trunkLeanCue(15, "Squeeze your glutes, ribs down")],
    intro: "Barbell overhead press. Press the bar to lockout overhead.",
    setupHint: "Front-on; press all the way up.",
    contraindications: [
      { condition: "shoulders", modification: "use a neutral grip or reduce the overhead range" },
      { condition: "lower-back", modification: "press seated with back support to remove the lean-back" },
    ],
  },
  {
    id: "barbell-curl", name: "Barbell Curls", emoji: "💪", kind: "rep", met: 3.5,
    category: "gym", equipment: "barbell", primaryMuscles: ["biceps", "forearms"],
    difficulty: "beginner", goalFit: ["muscle"], detectable: "high", requiredJoints: ARMS,
    rep: { measure: elbowAvg, downAngle: 120, upAngle: 150 },
    form: [depthCue(90, "Curl all the way up"), trunkLeanCue(10, "Keep your torso still — no swinging")],
    intro: "Barbell curls. Curl the bar up, lower with control.",
    setupHint: "Side-on so I can see your elbows bend.",
    contraindications: [
      { condition: "elbows", modification: "use an EZ-bar and lighter load" },
      { condition: "wrists", modification: "use an EZ-bar to ease the wrist angle" },
    ],
  },

  // ── Machines (single clear joint — count + range) ──
  {
    id: "leg-extension", name: "Leg Extension (Machine)", emoji: "🦵", kind: "rep", met: 4.0,
    category: "gym", equipment: "machine", primaryMuscles: ["quads"],
    difficulty: "beginner", goalFit: ["muscle"], detectable: "medium", requiredJoints: LEGS,
    rep: { measure: kneeAvg, downAngle: 130, upAngle: 150 },
    form: [lockoutCue(160, "Straighten fully and squeeze the quad")],
    intro: "Leg extension. Straighten your knees against the pad, lower with control.",
    setupHint: "Side-on so I can see your knees extend.",
    contraindications: [
      { condition: "knees", modification: "limit the top range and reduce load if it pinches the knee" },
    ],
  },
  {
    id: "leg-curl", name: "Leg Curl (Machine)", emoji: "🦵", kind: "rep", met: 4.0,
    category: "gym", equipment: "machine", primaryMuscles: ["hamstrings"],
    difficulty: "beginner", goalFit: ["muscle"], detectable: "low", requiredJoints: LEGS,
    rep: { measure: kneeAvg, downAngle: 140, upAngle: 160 },
    form: [depthCue(70, "Curl your heels toward your glutes")],
    intro: "Leg curl. Curl your heels in, lower with control.",
    setupHint: "Side-on so I can see your knees bend.",
    contraindications: [
      { condition: "lower-back", modification: "use a seated leg curl to keep your spine supported" },
    ],
  },
  {
    id: "lat-pulldown", name: "Lat Pulldown (Machine)", emoji: "🔽", kind: "rep", met: 4.0,
    category: "gym", equipment: "machine", primaryMuscles: ["lats", "upper-back", "biceps"],
    difficulty: "beginner", goalFit: ["muscle", "strength"], detectable: "low", requiredJoints: ARMS,
    rep: { measure: elbowAvg, downAngle: 100, upAngle: 155 },
    form: [depthCue(90, "Bring the bar down to your chest"), trunkLeanCue(30, "Limit the lean back")],
    intro: "Lat pulldown. Pull the bar to your chest, control it back up.",
    setupHint: "Side-on reads your pull best.",
    contraindications: [
      { condition: "shoulders", modification: "pull to the front only (never behind the neck), neutral grip" },
      { condition: "lower-back", modification: "keep your torso upright, avoid heavy lean-back" },
    ],
  },
  {
    id: "seated-row-machine", name: "Seated Cable Row (Machine)", emoji: "🚣", kind: "rep", met: 4.0,
    category: "gym", equipment: "machine", primaryMuscles: ["upper-back", "lats", "biceps"],
    difficulty: "beginner", goalFit: ["muscle", "strength"], detectable: "medium", requiredJoints: ARMS,
    rep: { measure: elbowAvg, downAngle: 100, upAngle: 155 },
    form: [depthCue(90, "Pull the handle to your stomach"), trunkLeanCue(25, "Row with your arms, not your back")],
    intro: "Seated cable row. Pull the handle to your stomach, control it back.",
    setupHint: "Side-on so I can see your arms and torso.",
    contraindications: [
      { condition: "lower-back", modification: "keep a tall supported torso, avoid the big lean" },
      { condition: "shoulders", modification: "neutral grip, keep elbows close" },
    ],
  },
  {
    id: "shoulder-press-machine", name: "Shoulder Press (Machine)", emoji: "🏋️", kind: "rep", met: 4.0,
    category: "gym", equipment: "machine", primaryMuscles: ["shoulders", "triceps"],
    difficulty: "beginner", goalFit: ["muscle", "strength"], detectable: "medium", requiredJoints: ARMS,
    rep: { measure: elbowAvg, downAngle: 100, upAngle: 150 },
    form: [lockoutCue(158, "Press fully up"), depthCue(95, "Lower to shoulder height")],
    intro: "Machine shoulder press. Press the handles overhead, lower to your shoulders.",
    setupHint: "Front-on; use the seat back support.",
    contraindications: [
      { condition: "shoulders", modification: "limit the overhead range, neutral grip if available" },
      { condition: "lower-back", modification: "use the seat back support, don't arch to press" },
    ],
  },
];
