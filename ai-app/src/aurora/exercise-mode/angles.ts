/**
 * angles.ts — pure geometry for AI Exercise form-checking.
 *
 * 100% pure (no DOM, no React, no MediaPipe) so the rep/form logic that
 * sits on top is unit-testable in Node, exactly like gestures.ts. We work
 * in 2D (x,y only): z from a single webcam is too noisy to judge form on.
 *
 * Landmarks come in MediaPipe-normalized 0..1 coordinates, already mirrored
 * to screen space by usePoseTracking (x: 1 - x), y growing downward.
 */

export interface Pt {
  x: number;
  y: number;
  /** MediaPipe per-landmark visibility 0..1 (how confident the point is). */
  visibility?: number;
}

/**
 * Interior angle in DEGREES at vertex `b`, formed by the points a–b–c.
 * e.g. angle(hip, knee, ankle) = how bent the knee is (≈180 straight,
 * ≈90 deep squat). Returns 0..180.
 */
export function angleAt(a: Pt, b: Pt, c: Pt): number {
  const r =
    Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
  let deg = Math.abs((r * 180) / Math.PI);
  if (deg > 180) deg = 360 - deg;
  return deg;
}

/** Euclidean distance between two 2D points. */
export function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Average visibility of a set of landmarks — the "can I see you?" gate. */
export function avgVisibility(pts: Array<Pt | undefined>): number {
  let sum = 0;
  let n = 0;
  for (const p of pts) {
    if (!p) return 0;
    sum += p.visibility ?? 1;
    n += 1;
  }
  return n ? sum / n : 0;
}

/**
 * Exponential moving average — smooths a noisy per-frame scalar (a joint
 * angle) before we threshold it, so landmark jitter can't rattle the rep
 * counter. Mirrors the CURSOR_ALPHA smoothing in gestures.ts.
 */
export function ema(prev: number, next: number, alpha = 0.4): number {
  if (!Number.isFinite(prev)) return next;
  return prev + alpha * (next - prev);
}

/** Clamp helper. */
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Signed angle of the torso/limb line from vertical, in degrees. Used for
 * the plank straight-line check: the shoulder→hip→ankle should be ~180°
 * (a straight body), measured as the interior angle at the hip.
 */
export function straightnessAt(shoulder: Pt, hip: Pt, ankle: Pt): number {
  return angleAt(shoulder, hip, ankle);
}
