/**
 * catalogBatch6.ts — cable, machine, and MOBILITY/STRETCH moves from catalog
 * batch 6, encoded per the verification plan. Adds a stretch category (holds
 * judged by joint angles) for the "mobility" goal.
 *
 * Dropped/deferred (verification): cat-cow (spine motion invisible to 2D),
 * cable woodchop & pallof press (need a trunk-rotation primitive), cable chest
 * fly (needs a wrist-gap fly measure), hip abduction/adduction (need an
 * inter-limb thigh-spread measure), cable face pull (needs elbow-height).
 * Deduped: cable biceps curl (= db-biceps-curl), cable lateral raise
 * (= db-lateral-raise), seated calf raise (= calf-raise).
 */
import { angleAt } from "./angles";
import { POSE } from "./poseConstants";
import type { ExerciseDef, Landmarks } from "./types";
import {
  bilateral,
  moreBent,
  joint,
  depthCue,
  lockoutCue,
  trunkLeanCue,
  overExtensionCue,
  kneesStraightCue,
  elbowStraightCue,
  trunkLeanDeg,
} from "./formHelpers";

const ARMS = [POSE.L_SHOULDER, POSE.R_SHOULDER, POSE.L_ELBOW, POSE.R_ELBOW, POSE.L_WRIST, POSE.R_WRIST];
const LEGS = [POSE.L_HIP, POSE.R_HIP, POSE.L_KNEE, POSE.R_KNEE, POSE.L_ANKLE, POSE.R_ANKLE];
const SHO_ARM = [POSE.L_HIP, POSE.R_HIP, POSE.L_SHOULDER, POSE.R_SHOULDER, POSE.L_WRIST, POSE.R_WRIST];
const HIP_KNEE = [POSE.L_SHOULDER, POSE.R_SHOULDER, POSE.L_HIP, POSE.R_HIP, POSE.L_KNEE, POSE.R_KNEE];

const ELBOW_L: [number, number, number] = [POSE.L_SHOULDER, POSE.L_ELBOW, POSE.L_WRIST];
const ELBOW_R: [number, number, number] = [POSE.R_SHOULDER, POSE.R_ELBOW, POSE.R_WRIST];
const KNEE_L: [number, number, number] = [POSE.L_HIP, POSE.L_KNEE, POSE.L_ANKLE];
const KNEE_R: [number, number, number] = [POSE.R_HIP, POSE.R_KNEE, POSE.R_ANKLE];

const elbowAvg = bilateral(ELBOW_L, ELBOW_R);
const bentKnee = moreBent(KNEE_L, KNEE_R);
const hipL = (lm: Landmarks) => angleAt(lm[POSE.L_SHOULDER], lm[POSE.L_HIP], lm[POSE.L_KNEE]);
const frontKneeStraight = (lm: Landmarks) =>
  Math.max(
    angleAt(lm[POSE.L_HIP], lm[POSE.L_KNEE], lm[POSE.L_ANKLE]),
    angleAt(lm[POSE.R_HIP], lm[POSE.R_KNEE], lm[POSE.R_ANKLE]),
  );

export const BATCH_6: ExerciseDef[] = [
  {
    id: "cable-triceps-pushdown", name: "Cable Triceps Pushdown", emoji: "🔗", kind: "rep", met: 3.5,
    category: "gym", equipment: "cable", primaryMuscles: ["triceps"],
    difficulty: "beginner", goalFit: ["muscle"], detectable: "high", requiredJoints: ARMS,
    rep: { measure: elbowAvg, downAngle: 110, upAngle: 150 },
    form: [lockoutCue(155, "Straighten your arm fully"), overExtensionCue(POSE.L_HIP, POSE.L_SHOULDER, POSE.L_ELBOW, 28, "Pin your elbows — stop them swinging forward")],
    intro: "Cable triceps pushdown. Elbows pinned, push the bar straight down.",
    setupHint: "Side-on so I can see your elbows extend.",
    contraindications: [
      { condition: "elbows", modification: "use a rope, lighter load, slow tempo" },
    ],
  },
  {
    id: "cable-straight-arm-pulldown", name: "Straight-Arm Pulldown", emoji: "🔗", kind: "rep", met: 4.0,
    category: "gym", equipment: "cable", primaryMuscles: ["lats", "core"],
    difficulty: "intermediate", goalFit: ["muscle"], detectable: "medium", requiredJoints: SHO_ARM,
    rep: { measure: joint(POSE.L_HIP, POSE.L_SHOULDER, POSE.L_WRIST), downAngle: 90, upAngle: 140 },
    form: [depthCue(50, "Bring the bar down to your thighs"), elbowStraightCue(140, "Keep your arms long"), trunkLeanCue(20, "Stay tall, don't hinge")],
    intro: "Straight-arm pulldown. Arms long, pull the bar down to your thighs.",
    setupHint: "Side-on so I can see your arm sweep.",
    contraindications: [
      { condition: "shoulders", modification: "start with the bar a little lower" },
      { condition: "lower-back", modification: "keep a tall torso, don't hinge to drive it down" },
    ],
  },
  {
    id: "cable-glute-kickback", name: "Cable Glute Kickback", emoji: "🍑", kind: "rep", met: 4.0,
    category: "gym", equipment: "cable", primaryMuscles: ["glutes", "hamstrings"],
    difficulty: "beginner", goalFit: ["muscle"], detectable: "medium", requiredJoints: HIP_KNEE,
    // Hip extension: thigh forward (~90) → leg driven back (~160).
    rep: { measure: hipL, downAngle: 100, upAngle: 150 },
    form: [lockoutCue(155, "Squeeze the glute, drive the leg fully back"), trunkLeanCue(20, "Move the leg, not your back")],
    intro: "Cable glute kickback. Drive your leg straight back, squeeze the glute.",
    setupHint: "Side-on so I can see your leg extend back.",
    contraindications: [
      { condition: "lower-back", modification: "reduce the range, don't arch to gain height" },
    ],
  },
  {
    id: "cable-pull-through", name: "Cable Pull-Through", emoji: "🔗", kind: "rep", met: 4.5,
    category: "gym", equipment: "cable", primaryMuscles: ["glutes", "hamstrings", "lower-back"],
    difficulty: "beginner", goalFit: ["muscle", "strength"], detectable: "medium", requiredJoints: HIP_KNEE,
    // Hip hinge: hinged (~90) → standing tall (~175). A great way to learn the hinge.
    rep: { measure: hipL, downAngle: 120, upAngle: 160 },
    form: [kneesStraightCue(140, "Push your hips back — don't squat it"), lockoutCue(168, "Stand tall, squeeze your glutes")],
    intro: "Cable pull-through. Hinge your hips back, then stand tall. I cue your hinge, but can't see your spine — keep it flat.",
    setupHint: "Side-on so I can see your hip hinge.",
    contraindications: [
      { condition: "lower-back", modification: "reduce the range and load" },
      { condition: "disc", modification: "avoid — keep range very short and light" },
    ],
  },
  {
    id: "assisted-pull-up", name: "Assisted Pull-ups (Machine)", emoji: "🆙", kind: "rep", met: 4.0,
    category: "gym", equipment: "machine", primaryMuscles: ["lats", "biceps", "upper-back"],
    difficulty: "beginner", goalFit: ["muscle", "strength"], detectable: "medium", requiredJoints: ARMS,
    rep: { measure: elbowAvg, downAngle: 150, upAngle: 165 },
    form: [lockoutCue(160, "Full hang at the bottom"), depthCue(70, "Pull a little higher")],
    intro: "Assisted pull-ups. Let the machine help — pull your chin toward the bar.",
    setupHint: "Face me; I'll count each pull.",
    contraindications: [
      { condition: "shoulders", modification: "use a neutral grip, limit the bottom range" },
      { condition: "elbows", modification: "reduce volume, no hard dead-hang under fatigue" },
    ],
  },

  // ── Mobility / stretches (holds judged by joint angles) ──
  {
    id: "standing-quad-stretch", name: "Standing Quad Stretch", emoji: "🧎", kind: "hold", met: 2.3,
    category: "home", equipment: "none", primaryMuscles: ["quads", "hip-flexors"],
    difficulty: "beginner", goalFit: ["mobility"], detectable: "medium", requiredJoints: LEGS,
    hold: {
      inPosition: (lm) => bentKnee(lm) < 80 && trunkLeanDeg(lm) < 20,
      cue: (lm) => (trunkLeanDeg(lm) > 15 ? "Stand tall" : null),
    },
    form: [],
    intro: "Standing quad stretch. Pull one heel toward your glute, stand tall, and hold.",
    setupHint: "Side-on; hold a wall if you need balance.",
    contraindications: [
      { condition: "knees", modification: "reduce the knee bend, or use a strap" },
      { condition: "ankles", modification: "hold a wall for balance" },
    ],
  },
  {
    id: "standing-hamstring-stretch", name: "Standing Hamstring Stretch", emoji: "🧍", kind: "hold", met: 2.3,
    category: "home", equipment: "none", primaryMuscles: ["hamstrings"],
    difficulty: "beginner", goalFit: ["mobility"], detectable: "low", requiredJoints: LEGS,
    hold: {
      inPosition: (lm) => hipL(lm) < 125 && frontKneeStraight(lm) > 155,
      cue: (lm) => (frontKneeStraight(lm) < 155 ? "Keep your leg straight" : null),
    },
    form: [],
    intro: "Standing hamstring stretch. Hinge over a straight front leg, reach toward it, and hold. I can't see your spine — hinge from the hips, don't round.",
    setupHint: "Side-on so I can see your hinge.",
    contraindications: [
      { condition: "lower-back", modification: "avoid the deep rounded reach — use a supine strap stretch instead" },
      { condition: "disc", modification: "avoid loaded forward flexion" },
    ],
  },
  {
    id: "kneeling-hip-flexor-stretch", name: "Kneeling Hip-Flexor Stretch", emoji: "🧎", kind: "hold", met: 2.3,
    category: "home", equipment: "none", primaryMuscles: ["hip-flexors", "quads"],
    difficulty: "beginner", goalFit: ["mobility"], detectable: "medium", requiredJoints: HIP_KNEE,
    hold: {
      inPosition: (lm) => hipL(lm) > 160 && trunkLeanDeg(lm) < 20,
      cue: (lm) => (trunkLeanDeg(lm) > 18 ? "Stay tall, tuck your hips under" : null),
    },
    form: [],
    intro: "Kneeling hip-flexor stretch. Half-kneeling, ease your hips forward and stay tall.",
    setupHint: "Side-on; pad the kneeling knee.",
    contraindications: [
      { condition: "knees", modification: "pad the kneeling knee, reduce the range" },
      { condition: "lower-back", modification: "keep it gentle, focus on tucking the hips" },
    ],
  },
  {
    id: "childs-pose", name: "Child's Pose", emoji: "🧘", kind: "hold", met: 2.0,
    category: "home", equipment: "none", primaryMuscles: ["lower-back", "lats", "hips"],
    difficulty: "beginner", goalFit: ["mobility"], detectable: "medium",
    requiredJoints: [POSE.L_SHOULDER, POSE.R_SHOULDER, POSE.L_HIP, POSE.R_HIP, POSE.L_KNEE, POSE.R_KNEE, POSE.L_ELBOW],
    hold: {
      inPosition: (lm) =>
        angleAt(lm[POSE.L_SHOULDER], lm[POSE.L_HIP], lm[POSE.L_KNEE]) < 60 &&
        angleAt(lm[POSE.L_HIP], lm[POSE.L_SHOULDER], lm[POSE.L_ELBOW]) > 150,
      cue: (lm) => (angleAt(lm[POSE.L_SHOULDER], lm[POSE.L_HIP], lm[POSE.L_KNEE]) > 80 ? "Sit back toward your heels" : null),
    },
    form: [],
    intro: "Child's pose. Sit your hips back toward your heels, reach your arms forward, and breathe.",
    setupHint: "Side-on so I can see you fold back.",
    contraindications: [
      { condition: "knees", modification: "put a cushion behind your knees or under your hips" },
    ],
  },
];
