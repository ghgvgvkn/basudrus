/**
 * formHelpers.ts — the reusable form-correction primitives that turn the
 * researched/catalog exercise data into live coaching. Pure (no React/DOM),
 * so it's unit-testable in Node.
 *
 * The big idea: most form faults across all exercises reduce to a handful of
 * MEASURABLE checks (depth, joint lockout, trunk lean, body-line straightness,
 * knee valgus, range-of-motion). Each builder returns a FormCheck the engine
 * evaluates per frame/rep. Every builder is ORIENTATION-AWARE: a check that
 * needs the user facing the camera (e.g. knees-caving) silently no-ops when
 * they're side-on, so we never shout a correction we can't actually see.
 */
import { angleAt, type Pt } from "./angles";
import { POSE } from "./poseConstants";
import type { FormCheck, Facing, Landmarks } from "./types";

const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * Estimate body orientation to the camera from how wide the shoulders read
 * relative to torso height. Facing the camera → shoulders span wide; turned
 * side-on → they overlap (small span). Cheap and robust enough to gate
 * view-specific cues.
 */
export function facingOf(lm: Landmarks): Facing {
  const ls = lm[POSE.L_SHOULDER];
  const rs = lm[POSE.R_SHOULDER];
  const lh = lm[POSE.L_HIP];
  const rh = lm[POSE.R_HIP];
  if (!ls || !rs || !lh || !rh) return "front";
  const shoulderSpread = Math.abs(ls.x - rs.x);
  const torsoH = Math.abs((ls.y + rs.y) / 2 - (lh.y + rh.y) / 2) || 0.001;
  return shoulderSpread / torsoH > 0.55 ? "front" : "side";
}

/** Trunk lean from vertical in degrees (0 = upright). Side view is best but
 *  it reads acceptably from the front too. */
export function trunkLeanDeg(lm: Landmarks): number {
  const sh = mid(lm[POSE.L_SHOULDER], lm[POSE.R_SHOULDER]);
  const hip = mid(lm[POSE.L_HIP], lm[POSE.R_HIP]);
  const dx = sh.x - hip.x;
  const dy = sh.y - hip.y; // shoulder is above hip → dy negative
  return Math.abs((Math.atan2(dx, -dy) * 180) / Math.PI);
}

const hGap = (a: Pt, b: Pt) => Math.abs(a.x - b.x);

// ── REP-ANGLE MEASURES (the number the rep counter swings on) ──

/** Average of a bilateral joint (both knees / both elbows), visibility-weighted. */
export function bilateral(
  left: [number, number, number],
  right: [number, number, number],
): (lm: Landmarks) => number {
  return (lm) => {
    const aL = angleAt(lm[left[0]], lm[left[1]], lm[left[2]]);
    const aR = angleAt(lm[right[0]], lm[right[1]], lm[right[2]]);
    const visL = lm[left[1]].visibility ?? 1;
    const visR = lm[right[1]].visibility ?? 1;
    if (visL > 0.5 && visR > 0.5) return (aL + aR) / 2;
    return visL >= visR ? aL : aR;
  };
}

/** The MORE bent of two joints — for unilateral moves (lunge/split squat)
 *  where we don't know which limb is working. */
export function moreBent(
  left: [number, number, number],
  right: [number, number, number],
): (lm: Landmarks) => number {
  return (lm) =>
    Math.min(
      angleAt(lm[left[0]], lm[left[1]], lm[left[2]]),
      angleAt(lm[right[0]], lm[right[1]], lm[right[2]]),
    );
}

/** A single joint angle. */
export function joint(a: number, b: number, c: number): (lm: Landmarks) => number {
  return (lm) => angleAt(lm[a], lm[b], lm[c]);
}

// ── FORM-CHECK BUILDERS (each returns a FormCheck) ──

/** End-of-rep DEPTH: fault if the rep's deepest angle didn't pass `goodBelow`. */
export function depthCue(goodBelow: number, cue: string): FormCheck {
  return { id: "depth", evaluate: ({ minAngle }) => (minAngle > goodBelow ? cue : null) };
}

/** End-of-rep LOCKOUT/extension: fault if top angle didn't reach `reachAbove`.
 *  (Uses live `measure` at the moment the rep completes = top of the rep.) */
export function lockoutCue(reachAbove: number, cue: string): FormCheck {
  return { id: "lockout", evaluate: ({ measure }) => (measure < reachAbove ? cue : null) };
}

/** Live TRUNK LEAN: fault if torso tips past `maxDeg` from vertical. */
export function trunkLeanCue(maxDeg: number, cue: string): FormCheck {
  return { id: "trunk-lean", evaluate: ({ lm }) => (trunkLeanDeg(lm) > maxDeg ? cue : null) };
}

/** Live BODY-LINE: fault if shoulder→hip→ankle bends more than `maxDev` from
 *  a straight 180° line (push-up/plank sag or pike). Picks the more-visible side. */
export function bodyLineCue(maxDev: number, cue: string): FormCheck {
  return {
    id: "body-line",
    evaluate: ({ lm }) => {
      const visL = lm[POSE.L_HIP].visibility ?? 1;
      const visR = lm[POSE.R_HIP].visibility ?? 1;
      const a =
        visL >= visR
          ? angleAt(lm[POSE.L_SHOULDER], lm[POSE.L_HIP], lm[POSE.L_ANKLE])
          : angleAt(lm[POSE.R_SHOULDER], lm[POSE.R_HIP], lm[POSE.R_ANKLE]);
      return Math.abs(180 - a) > maxDev ? cue : null;
    },
  };
}

/** Live KNEE VALGUS (caving): fault if the knees draw closer than the ankles.
 *  FRONT-VIEW ONLY — silently no-ops side-on (the research's #1 fix). */
export function kneesCavingCue(ratio: number, cue: string): FormCheck {
  return {
    id: "knee-cave",
    evaluate: ({ lm, facing }) => {
      if (facing !== "front") return null; // can't judge valgus from the side
      const kneeGap = hGap(lm[POSE.L_KNEE], lm[POSE.R_KNEE]);
      const ankleGap = hGap(lm[POSE.L_ANKLE], lm[POSE.R_ANKLE]);
      return kneeGap < ankleGap * ratio ? cue : null;
    },
  };
}

/** Live OVER-EXTENSION: fault if a joint opens PAST `maxAngle` (e.g. glute
 *  bridge / hip thrust arching past neutral). */
export function overExtensionCue(a: number, b: number, c: number, maxAngle: number, cue: string): FormCheck {
  return {
    id: "over-extend",
    evaluate: ({ lm }) => (angleAt(lm[a], lm[b], lm[c]) > maxAngle ? cue : null),
  };
}

/** Live KNEE-BEND CHEAT (calf raise): fault if the knee bends below `minStraight`. */
export function kneesStraightCue(minStraight: number, cue: string): FormCheck {
  return {
    id: "knees-straight",
    evaluate: ({ lm }) => {
      const a = (angleAt(lm[POSE.L_HIP], lm[POSE.L_KNEE], lm[POSE.L_ANKLE]) +
        angleAt(lm[POSE.R_HIP], lm[POSE.R_KNEE], lm[POSE.R_ANKLE])) / 2;
      return a < minStraight ? cue : null;
    },
  };
}
