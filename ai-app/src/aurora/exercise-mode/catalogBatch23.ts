/**
 * catalogBatch23.ts — exercises from the founder's researched catalog batches
 * 2 & 3, encoded per the adversarial-verification plans (correctness, honest
 * webcam-detectability, and safety reviewed before encoding). Merged into the
 * main EXERCISES map by exercises.ts.
 *
 * Only the camera-reliable, safely-encodable moves are here. Dropped/deferred:
 * superman & pseudo-planche & russian-twist & pull-up chin-height & skater/jump
 * landings (need primitives we don't have), bench/fly/pullover (lying =
 * undetectable), bear-crawl, db-goblet-squat (dup of goblet-squat).
 *
 * Gated moves (sit-up, leg-raise, bench-dip, RDL) carry "avoid …" contraindi-
 * cations so routine.ts auto-excludes them for the matching injury.
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
  bodyLineCue,
  overExtensionCue,
  kneesStraightCue,
} from "./formHelpers";

const ARMS = [POSE.L_SHOULDER, POSE.R_SHOULDER, POSE.L_ELBOW, POSE.R_ELBOW, POSE.L_WRIST, POSE.R_WRIST];
const LEGS = [POSE.L_HIP, POSE.R_HIP, POSE.L_KNEE, POSE.R_KNEE, POSE.L_ANKLE, POSE.R_ANKLE];
const BODY = [POSE.L_SHOULDER, POSE.R_SHOULDER, POSE.L_HIP, POSE.R_HIP, POSE.L_ANKLE, POSE.R_ANKLE];
const SHO_ARM = [POSE.L_HIP, POSE.R_HIP, POSE.L_SHOULDER, POSE.R_SHOULDER, POSE.L_WRIST, POSE.R_WRIST];
const HIP_KNEE = [POSE.L_SHOULDER, POSE.R_SHOULDER, POSE.L_HIP, POSE.R_HIP, POSE.L_KNEE, POSE.R_KNEE];

const KNEE_L: [number, number, number] = [POSE.L_HIP, POSE.L_KNEE, POSE.L_ANKLE];
const KNEE_R: [number, number, number] = [POSE.R_HIP, POSE.R_KNEE, POSE.R_ANKLE];
const ELBOW_L: [number, number, number] = [POSE.L_SHOULDER, POSE.L_ELBOW, POSE.L_WRIST];
const ELBOW_R: [number, number, number] = [POSE.R_SHOULDER, POSE.R_ELBOW, POSE.R_WRIST];
const HIPFLEX_L: [number, number, number] = [POSE.L_SHOULDER, POSE.L_HIP, POSE.L_KNEE];
const HIPFLEX_R: [number, number, number] = [POSE.R_SHOULDER, POSE.R_HIP, POSE.R_KNEE];

const elbowAvg = bilateral(ELBOW_L, ELBOW_R);
const kneeAvg = bilateral(KNEE_L, KNEE_R);
const shoulderRaise = joint(POSE.L_HIP, POSE.L_SHOULDER, POSE.L_WRIST);
const hipHinge = joint(POSE.L_SHOULDER, POSE.L_HIP, POSE.L_KNEE);
const bodyLineAngle = (lm: Landmarks) => angleAt(lm[POSE.L_SHOULDER], lm[POSE.L_HIP], lm[POSE.L_ANKLE]);

export const BATCH_23: ExerciseDef[] = [
  // ── Batch 2: upper-body & core (camera-reliable) ──
  {
    id: "wide-push-up", name: "Wide Push-ups", emoji: "💪", kind: "rep", met: 4.0,
    category: "home", equipment: "none", primaryMuscles: ["chest", "shoulders", "triceps"],
    difficulty: "intermediate", goalFit: ["muscle", "strength"], detectable: "high", requiredJoints: ARMS,
    rep: { measure: elbowAvg, downAngle: 110, upAngle: 150 },
    form: [depthCue(100, "Lower your chest more"), bodyLineCue(16, "Keep a flat body line")],
    intro: "Wide push-ups. Hands wider than your shoulders, side-on to me.",
    setupHint: "Side-on so I can see your elbows bend.",
    contraindications: [
      { condition: "shoulders", modification: "bring your hands narrower" },
      { condition: "wrists", modification: "use push-up handles or fists" },
    ],
  },
  {
    id: "inverted-row", name: "Inverted Rows", emoji: "🚣", kind: "rep", met: 4.0,
    category: "home", equipment: "bar or sturdy table", primaryMuscles: ["upper-back", "lats", "biceps"],
    difficulty: "intermediate", goalFit: ["muscle", "strength"], detectable: "high",
    requiredJoints: [...ARMS, POSE.L_HIP, POSE.R_HIP],
    rep: { measure: elbowAvg, downAngle: 110, upAngle: 155 },
    form: [depthCue(95, "Pull your chest to the bar"), bodyLineCue(15, "Straight body — don't let your hips sag")],
    intro: "Inverted rows. Under a bar or sturdy table, pull your chest up.",
    setupHint: "Side-on so I can see your arms bend.",
    contraindications: [
      { condition: "lower-back", modification: "bend your knees, feet flat" },
      { condition: "shoulders", modification: "use a neutral grip" },
    ],
  },
  {
    id: "chin-up", name: "Chin-ups", emoji: "🆙", kind: "rep", met: 8.0,
    category: "home", equipment: "pull-up bar", primaryMuscles: ["biceps", "lats", "upper-back"],
    difficulty: "advanced", goalFit: ["muscle", "strength"], detectable: "medium", requiredJoints: ARMS,
    rep: { measure: elbowAvg, downAngle: 150, upAngle: 165 },
    form: [lockoutCue(160, "Full hang at the bottom"), depthCue(70, "Pull a little higher")],
    intro: "Chin-ups. Hang from the bar, palms facing you, and pull up.",
    setupHint: "Face me; I'll count each pull.",
    contraindications: [
      { condition: "elbows", modification: "reduce volume, use a neutral grip" },
      { condition: "shoulders", modification: "limit the bottom range" },
    ],
  },
  {
    id: "high-plank", name: "High Plank", emoji: "🤸", kind: "hold", met: 3.5,
    category: "home", equipment: "none", primaryMuscles: ["core", "shoulders", "triceps"],
    difficulty: "beginner", goalFit: ["strength"], detectable: "high", requiredJoints: BODY,
    hold: {
      inPosition: (lm) => bodyLineAngle(lm) > 150,
      cue: (lm) => {
        const a = bodyLineAngle(lm);
        if (a > 155) return null;
        const midY = (lm[POSE.L_SHOULDER].y + lm[POSE.L_ANKLE].y) / 2;
        return lm[POSE.L_HIP].y > midY ? "Tuck your hips up" : "Lower your hips, flat back";
      },
    },
    form: [],
    intro: "High plank. Straight arms, body in one line, and hold.",
    setupHint: "Side-on so I can see your back line.",
    contraindications: [
      { condition: "wrists", modification: "drop to a forearm plank" },
      { condition: "lower-back", modification: "drop to your knees" },
    ],
  },
  {
    id: "bench-dip", name: "Bench Dips", emoji: "🪑", kind: "rep", met: 3.5,
    category: "home", equipment: "none", primaryMuscles: ["triceps", "shoulders"],
    difficulty: "intermediate", goalFit: ["muscle", "strength"], detectable: "high", requiredJoints: ARMS,
    rep: { measure: elbowAvg, downAngle: 115, upAngle: 150 },
    form: [depthCue(105, "Lower a bit deeper — but stop around 90 degrees")],
    intro: "Bench dips. Hands on a chair behind you, lower and press up.",
    setupHint: "Side-on so I can see your elbows bend.",
    contraindications: [
      { condition: "shoulders", modification: "avoid — bench dips put high stress on the front of the shoulder" },
    ],
  },
  {
    id: "leg-raise", name: "Lying Leg Raises", emoji: "🦵", kind: "rep", met: 3.5,
    category: "home", equipment: "none", primaryMuscles: ["abs", "hip-flexors"],
    difficulty: "intermediate", goalFit: ["muscle", "strength"], detectable: "high",
    requiredJoints: [POSE.L_SHOULDER, POSE.R_SHOULDER, POSE.L_HIP, POSE.R_HIP, POSE.L_ANKLE, POSE.R_ANKLE],
    // Hip flexion: lying flat (shoulder-hip-ankle ~170) → legs vertical (~90).
    rep: { measure: (lm) => angleAt(lm[POSE.L_SHOULDER], lm[POSE.L_HIP], lm[POSE.L_ANKLE]), downAngle: 110, upAngle: 150 },
    form: [depthCue(100, "Bring your legs up toward vertical"), kneesStraightCue(160, "Keep your legs straight")],
    intro: "Leg raises. Lie down, legs straight, and lift them toward vertical.",
    setupHint: "Lie side-on so I can see your legs rise.",
    contraindications: [
      { condition: "lower-back", modification: "avoid — bend your knees or do a reverse crunch; straight-leg raises strain the spine" },
    ],
  },
  {
    id: "side-plank", name: "Side Plank", emoji: "📐", kind: "hold", met: 3.5,
    category: "home", equipment: "none", primaryMuscles: ["obliques", "core", "shoulders"],
    difficulty: "intermediate", goalFit: ["strength", "muscle"], detectable: "medium", requiredJoints: BODY,
    hold: {
      inPosition: (lm) => bodyLineAngle(lm) > 160,
      cue: (lm) => (bodyLineAngle(lm) < 165 ? "Lift your bottom hip up" : null),
    },
    form: [],
    intro: "Side plank. Up on one forearm, body in a straight line, and hold.",
    setupHint: "Lift your hips so your body is one straight line.",
    contraindications: [
      { condition: "shoulders", modification: "rest on your forearm, shorter holds" },
      { condition: "lower-back", modification: "drop your bottom knee to the floor" },
    ],
  },
  {
    id: "sit-up", name: "Sit-ups", emoji: "🔺", kind: "rep", met: 3.8,
    category: "home", equipment: "none", primaryMuscles: ["abs", "hip-flexors"],
    difficulty: "beginner", goalFit: ["muscle"], detectable: "high", requiredJoints: HIP_KNEE,
    // Hip/trunk flexion: lying back (~160) → sitting up (~70).
    rep: { measure: (lm) => angleAt(lm[POSE.L_SHOULDER], lm[POSE.L_HIP], lm[POSE.L_KNEE]), downAngle: 150, upAngle: 95 },
    form: [depthCue(100, "Come all the way up")],
    intro: "Sit-ups. Knees bent, and sit all the way up.",
    setupHint: "Lie side-on so I can see your torso rise.",
    contraindications: [
      { condition: "lower-back", modification: "avoid — do crunches or dead bugs instead; sit-ups load the lower spine" },
      { condition: "neck", modification: "support your head, don't pull on your neck" },
    ],
  },

  // ── Batch 3: cardio / plyo-lite + dumbbell ──
  {
    id: "jumping-jack", name: "Jumping Jacks", emoji: "⭐", kind: "rep", met: 7.0,
    category: "home", equipment: "none", primaryMuscles: ["shoulders", "calves"],
    difficulty: "beginner", goalFit: ["weight-loss", "mobility"], detectable: "high", requiredJoints: SHO_ARM,
    // Shoulder abduction (extension rep): arms down (~20) → overhead (~160).
    rep: { measure: shoulderRaise, downAngle: 45, upAngle: 140 },
    form: [lockoutCue(150, "Arms all the way overhead")],
    intro: "Jumping jacks. Arms and legs out, then back in.",
    setupHint: "Face me so I can see your arms go overhead.",
    contraindications: [
      { condition: "knees", modification: "do step jacks instead — no jumping" },
      { condition: "ankles", modification: "use the low-impact step version" },
    ],
  },
  {
    id: "step-jack", name: "Step Jacks", emoji: "👟", kind: "rep", met: 4.5,
    category: "home", equipment: "none", primaryMuscles: ["shoulders", "hip-abductors", "calves"],
    difficulty: "beginner", goalFit: ["weight-loss", "mobility"], detectable: "high", requiredJoints: SHO_ARM,
    rep: { measure: shoulderRaise, downAngle: 45, upAngle: 140 },
    form: [lockoutCue(150, "Reach your arms overhead")],
    intro: "Step jacks. Step one foot out as your arms go up — low impact.",
    setupHint: "Face me; reach your arms overhead.",
    contraindications: [],
  },
  {
    id: "high-knees", name: "High Knees", emoji: "🏃", kind: "rep", met: 8.0,
    category: "home", equipment: "none", primaryMuscles: ["hip-flexors", "quads", "calves"],
    difficulty: "beginner", goalFit: ["weight-loss"], detectable: "high", requiredJoints: HIP_KNEE,
    rep: { measure: moreBent(HIPFLEX_L, HIPFLEX_R), downAngle: 150, upAngle: 165 },
    form: [depthCue(115, "Knees up to hip height"), trunkLeanCue(20, "Stay upright")],
    intro: "High knees. Drive your knees up to hip height.",
    setupHint: "Side-on so I can see your knees rise.",
    contraindications: [
      { condition: "knees", modification: "march in place instead of running" },
      { condition: "hips", modification: "lower the knee height to comfort" },
    ],
  },
  {
    id: "butt-kicks", name: "Butt Kicks", emoji: "🦿", kind: "rep", met: 7.5,
    category: "home", equipment: "none", primaryMuscles: ["hamstrings", "calves"],
    difficulty: "beginner", goalFit: ["weight-loss"], detectable: "high", requiredJoints: LEGS,
    rep: { measure: moreBent(KNEE_L, KNEE_R), downAngle: 140, upAngle: 160 },
    form: [depthCue(75, "Heels up to your glutes"), trunkLeanCue(20, "Tall posture")],
    intro: "Butt kicks. Kick your heels up toward your glutes.",
    setupHint: "Side-on so I can see your heels come up.",
    contraindications: [
      { condition: "knees", modification: "slow the tempo, reduce the range" },
    ],
  },
  {
    id: "mountain-climber", name: "Mountain Climbers", emoji: "⛰️", kind: "rep", met: 8.0,
    category: "home", equipment: "none", primaryMuscles: ["core", "hip-flexors", "shoulders"],
    difficulty: "intermediate", goalFit: ["weight-loss", "strength"], detectable: "medium", requiredJoints: HIP_KNEE,
    rep: { measure: moreBent(HIPFLEX_L, HIPFLEX_R), downAngle: 150, upAngle: 165 },
    form: [depthCue(125, "Drive your knee to your chest")],
    intro: "Mountain climbers. In a plank, drive your knees to your chest.",
    setupHint: "Side-on so I can see your knees drive in.",
    contraindications: [
      { condition: "wrists", modification: "put your hands on an elevated surface" },
      { condition: "lower-back", modification: "slow tempo, keep your hips low" },
    ],
  },
  {
    id: "inchworm", name: "Inchworms", emoji: "🐛", kind: "rep", met: 4.0,
    category: "home", equipment: "none", primaryMuscles: ["core", "shoulders", "hamstrings"],
    difficulty: "beginner", goalFit: ["mobility", "strength"], detectable: "medium",
    requiredJoints: [...BODY, POSE.L_KNEE, POSE.R_KNEE],
    // Hip extension: folded hinge (~80) → walked out to plank (~175).
    rep: { measure: hipHinge, downAngle: 100, upAngle: 160 },
    form: [lockoutCue(165, "Walk all the way out to a plank"), bodyLineCue(20, "Flatten — hips in line")],
    intro: "Inchworms. Hinge, walk your hands out to a plank, walk back.",
    setupHint: "Side-on so I can see you reach a plank.",
    contraindications: [
      { condition: "wrists", modification: "shorten the walkout" },
      { condition: "lower-back", modification: "bend your knees in the hinge" },
    ],
  },
  {
    id: "knee-to-elbow", name: "Standing Knee-to-Elbow", emoji: "🔁", kind: "rep", met: 4.5,
    category: "home", equipment: "none", primaryMuscles: ["obliques", "hip-flexors", "core"],
    difficulty: "beginner", goalFit: ["weight-loss", "mobility"], detectable: "medium", requiredJoints: HIP_KNEE,
    rep: { measure: moreBent(HIPFLEX_L, HIPFLEX_R), downAngle: 150, upAngle: 160 },
    form: [depthCue(110, "Knee up to meet your elbow")],
    intro: "Standing knee to elbow. Bring your opposite elbow to your raised knee.",
    setupHint: "Face me so I can see your knee come up.",
    contraindications: [
      { condition: "hips", modification: "lower the knee height to comfort" },
    ],
  },
  {
    id: "burpee", name: "Burpees", emoji: "🔥", kind: "rep", met: 8.0,
    category: "home", equipment: "none", primaryMuscles: ["full-body", "quads", "chest"],
    difficulty: "advanced", goalFit: ["weight-loss", "strength"], detectable: "low", requiredJoints: LEGS,
    rep: { measure: kneeAvg, downAngle: 120, upAngle: 160 },
    form: [depthCue(115, "Lower into the squat")],
    intro: "Burpees. Squat, jump to a plank, jump up. I count reps, but can't fully check burpee form.",
    setupHint: "Side-on; give yourself space.",
    contraindications: [
      { condition: "lower-back", modification: "step back instead of jumping" },
      { condition: "knees", modification: "remove the jump, step it out" },
      { condition: "wrists", modification: "put your hands on an elevated surface" },
    ],
  },
  {
    id: "db-incline-press", name: "Incline DB Press", emoji: "🏋️", kind: "rep", met: 5.0,
    category: "gym", equipment: "dumbbells", primaryMuscles: ["chest", "shoulders", "triceps"],
    difficulty: "intermediate", goalFit: ["muscle", "strength"], detectable: "low", requiredJoints: ARMS,
    rep: { measure: elbowAvg, downAngle: 115, upAngle: 155 },
    form: [lockoutCue(150, "Press to full lockout"), depthCue(100, "Lower under control")],
    intro: "Incline dumbbell press. On an incline bench, press up.",
    setupHint: "Side-on; this one's hard for me to see — I'll count and cue lockout.",
    contraindications: [
      { condition: "shoulders", modification: "lower the incline, use a neutral grip" },
    ],
  },
  {
    id: "db-shoulder-press", name: "DB Shoulder Press", emoji: "🏋️", kind: "rep", met: 5.0,
    category: "gym", equipment: "dumbbells", primaryMuscles: ["shoulders", "triceps"],
    difficulty: "intermediate", goalFit: ["muscle", "strength"], detectable: "medium", requiredJoints: ARMS,
    rep: { measure: elbowAvg, downAngle: 115, upAngle: 158 },
    form: [lockoutCue(150, "Press fully overhead"), trunkLeanCue(15, "Ribs down, stand tall")],
    intro: "Dumbbell shoulder press. Press the weights overhead.",
    setupHint: "Face me; press all the way up.",
    contraindications: [
      { condition: "shoulders", modification: "use a neutral grip, limit the overhead range" },
      { condition: "lower-back", modification: "do it seated with back support" },
    ],
  },
  {
    id: "db-lateral-raise", name: "Lateral Raises", emoji: "🦅", kind: "rep", met: 4.0,
    category: "gym", equipment: "dumbbells", primaryMuscles: ["shoulders"],
    difficulty: "beginner", goalFit: ["muscle"], detectable: "high", requiredJoints: SHO_ARM,
    rep: { measure: shoulderRaise, downAngle: 30, upAngle: 70 },
    form: [overExtensionCue(POSE.L_HIP, POSE.L_SHOULDER, POSE.L_WRIST, 100, "Stop at shoulder height")],
    intro: "Lateral raises. Lift the weights out to your sides, to shoulder height.",
    setupHint: "Face me; stop at shoulder height.",
    contraindications: [
      { condition: "shoulders", modification: "keep below shoulder height, thumbs slightly up" },
      { condition: "neck", modification: "use a lighter weight" },
    ],
  },
  {
    id: "db-front-raise", name: "Front Raises", emoji: "🙌", kind: "rep", met: 4.0,
    category: "gym", equipment: "dumbbells", primaryMuscles: ["shoulders"],
    difficulty: "beginner", goalFit: ["muscle"], detectable: "high", requiredJoints: SHO_ARM,
    rep: { measure: shoulderRaise, downAngle: 30, upAngle: 70 },
    form: [
      overExtensionCue(POSE.L_HIP, POSE.L_SHOULDER, POSE.L_WRIST, 100, "Stop around shoulder height"),
      trunkLeanCue(15, "Keep your torso still"),
    ],
    intro: "Front raises. Lift the weights out in front, to shoulder height.",
    setupHint: "Side-on; lift to shoulder height.",
    contraindications: [
      { condition: "shoulders", modification: "keep below shoulder height" },
      { condition: "lower-back", modification: "do it seated to avoid leaning back" },
    ],
  },
  {
    id: "db-romanian-deadlift", name: "Romanian Deadlift", emoji: "🏋️", kind: "rep", met: 5.0,
    category: "gym", equipment: "dumbbells", primaryMuscles: ["hamstrings", "glutes", "lower-back"],
    difficulty: "intermediate", goalFit: ["muscle", "strength"], detectable: "medium", requiredJoints: HIP_KNEE,
    // Hip hinge (flexion): standing (~175) → hinged (~95).
    rep: { measure: hipHinge, downAngle: 160, upAngle: 170 },
    form: [
      depthCue(110, "Push your hips back further"),
      kneesStraightCue(150, "Soft knees — push your hips back, don't squat it"),
    ],
    intro: "Romanian deadlifts. Soft knees, push your hips back, hinge down.",
    setupHint: "Side-on so I can see your hip hinge.",
    contraindications: [
      { condition: "lower-back", modification: "avoid — I can't see if your spine rounds; go light or skip this one" },
    ],
  },

  // ── Batch 4 (partial — kettlebell chunk verified; rest pending re-run) ──
  {
    id: "kb-swing", name: "Kettlebell Swing", emoji: "🔔", kind: "rep", met: 9.8,
    category: "gym", equipment: "kettlebell", primaryMuscles: ["glutes", "hamstrings", "lower-back"],
    difficulty: "intermediate", goalFit: ["strength", "weight-loss", "muscle"], detectable: "medium",
    requiredJoints: HIP_KNEE,
    rep: { measure: hipHinge, downAngle: 120, upAngle: 160 },
    form: [lockoutCue(165, "Snap your hips through"), kneesStraightCue(120, "Hinge — don't squat it")],
    intro: "Kettlebell swings. Hinge and snap your hips. Keep a flat back — I can't see your spine, so stay strict and go light.",
    setupHint: "Side-on so I can see your hip hinge and snap.",
    contraindications: [
      { condition: "lower-back", modification: "avoid — master the hinge unloaded first; ballistic loading is risky" },
      { condition: "shoulders", modification: "keep the swing to chest height, not overhead" },
    ],
  },
  {
    id: "kb-deadlift", name: "Kettlebell Deadlift", emoji: "🏋️", kind: "rep", met: 5.0,
    category: "gym", equipment: "kettlebell", primaryMuscles: ["glutes", "hamstrings", "lower-back"],
    difficulty: "beginner", goalFit: ["strength", "muscle"], detectable: "medium",
    requiredJoints: HIP_KNEE,
    rep: { measure: hipHinge, downAngle: 120, upAngle: 160 },
    form: [lockoutCue(165, "Stand tall, squeeze your glutes")],
    intro: "Kettlebell deadlift. Hinge down to the bell, then stand up tall.",
    setupHint: "Side-on so I can see your hinge and lockout.",
    contraindications: [
      { condition: "lower-back", modification: "elevate the bell to shorten the range, go lighter" },
    ],
  },
];
