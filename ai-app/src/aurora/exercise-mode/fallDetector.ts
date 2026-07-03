/**
 * fallDetector.ts — pure fall detection from pose landmarks for AI Exercise.
 *
 * A fall (vs. lying down on purpose) has a SIGNATURE: the hips drop a large
 * distance FAST, the body ends up horizontal, and then it stays still. We
 * require all three before alerting, so squats, burpees and deliberate
 * floor work don't cry wolf:
 *   1. DROP    — mid-hip falls ≥ FALL_DROP_TORSOS × torso-length within
 *                ≤ FALL_WINDOW_MS (a controlled lie-down takes ~2s+; a real
 *                fall takes ~0.4–0.7s).
 *   2. FLAT    — after the drop, the torso reads horizontal (shoulder and
 *                hip at similar heights relative to torso length).
 *   3. STILL   — barely any hip movement for STILL_MS afterward.
 *
 * Exercises that are SUPPOSED to be on the floor (push-ups, planks,
 * bridges…) are excluded by the caller via isFloorExercise() — the detector
 * is only armed for standing moves and rest periods.
 *
 * Pure + deterministic (caller supplies timestamps) so it's unit-testable —
 * mirrored by scripts/tests/exercise-fall.test.mjs, same convention as
 * repCounter/gestures. Landmarks are MediaPipe-normalized (y grows DOWNWARD).
 */
import type { Landmarks } from "./types";
import type { ExerciseDef } from "./types";

export const FALL_DROP_TORSOS = 1.1;   // hip must drop ≥ 1.1 torso-lengths…
export const FALL_WINDOW_MS = 750;     // …within this window (fast = fall)
export const FLAT_RATIO = 0.5;         // |shoulderY-hipY| < 0.5×torso = flat
export const STILL_MS = 2000;          // stay still this long → alert
export const STILL_EPS = 0.045;        // max hip movement that counts as still
export const RECOVER_MS = 1000;        // upright this long → reset

/** Exercises performed on the floor by design — never arm fall detection. */
const FLOOR_RE = /push|plank|bridge|thrust|sit-?up|situp|leg[- ]?raise|child|inchworm|mountain|burpee|crawl|lying|knee[- ]?to[- ]?elbow|dip/i;

export function isFloorExercise(def: Pick<ExerciseDef, "id" | "name">): boolean {
  return FLOOR_RE.test(def.id) || FLOOR_RE.test(def.name);
}

export type FallPhase = "idle" | "down" | "fallen";

interface Snap {
  t: number;
  hipY: number;
  shoulderY: number;
  torso: number;
  flat: boolean;
}

export interface FallDetector {
  /** Feed the current landmarks (or null when no body). Returns the phase;
   *  "fallen" means alert NOW (returned once per incident, then latched). */
  update(lm: Landmarks | null, t: number): FallPhase;
  /** Clear after the user confirms they're OK (or on exercise change). */
  reset(): void;
}

/** Mid-point y of two landmarks, or null if either is barely visible. */
function midY(lm: Landmarks, a: number, b: number): number | null {
  const pa = lm[a];
  const pb = lm[b];
  if (!pa || !pb) return null;
  const va = (pa as { visibility?: number }).visibility ?? 1;
  const vb = (pb as { visibility?: number }).visibility ?? 1;
  if (va < 0.5 || vb < 0.5) return null;
  return (pa.y + pb.y) / 2;
}

export function createFallDetector(): FallDetector {
  let history: Snap[] = [];
  let phase: FallPhase = "idle";
  let stillSince = 0;
  let stillRefY = 0;
  let uprightSince = 0;
  let alerted = false;

  const reset = () => {
    history = [];
    phase = "idle";
    stillSince = 0;
    uprightSince = 0;
    alerted = false;
  };

  const update = (lm: Landmarks | null, t: number): FallPhase => {
    if (!lm) return phase === "fallen" ? "fallen" : "idle";
    const hipY = midY(lm, 23, 24);
    const shoulderY = midY(lm, 11, 12);
    if (hipY == null || shoulderY == null) return phase === "fallen" ? "fallen" : "idle";

    const sh = lm[11];
    const hp = lm[23];
    const torso = Math.hypot((sh?.x ?? 0) - (hp?.x ?? 0), (sh?.y ?? 0) - (hp?.y ?? 0));
    if (torso < 0.05) return phase === "fallen" ? "fallen" : "idle"; // degenerate frame

    const flat = Math.abs(shoulderY - hipY) < FLAT_RATIO * torso;
    history.push({ t, hipY, shoulderY, torso, flat });
    // keep ~3s of history
    while (history.length > 0 && t - history[0].t > 3000) history.shift();

    const upright = shoulderY < hipY - 0.55 * torso; // shoulders clearly above hips

    if (phase === "fallen") {
      // latched until reset() — but auto-release if they stand back up.
      if (upright) {
        if (uprightSince === 0) uprightSince = t;
        else if (t - uprightSince > RECOVER_MS) reset();
      } else {
        uprightSince = 0;
      }
      return alerted ? "fallen" : "fallen";
    }

    if (phase === "idle") {
      // look for the fast drop: any snapshot within the window whose hipY is
      // ≥ FALL_DROP_TORSOS torsos ABOVE (smaller y) the current hipY.
      for (let i = history.length - 1; i >= 0; i--) {
        const s = history[i];
        if (t - s.t > FALL_WINDOW_MS) break;
        if (hipY - s.hipY >= FALL_DROP_TORSOS * s.torso && flat) {
          phase = "down";
          stillSince = t;
          stillRefY = hipY;
          break;
        }
      }
      return "idle";
    }

    // phase === "down": require sustained stillness while flat.
    if (!flat || upright) {
      phase = "idle";
      return "idle";
    }
    if (Math.abs(hipY - stillRefY) > STILL_EPS) {
      // still moving — keep waiting, re-anchor
      stillSince = t;
      stillRefY = hipY;
      return "down";
    }
    if (t - stillSince >= STILL_MS) {
      phase = "fallen";
      alerted = true;
      return "fallen";
    }
    return "down";
  };

  return { update, reset };
}
