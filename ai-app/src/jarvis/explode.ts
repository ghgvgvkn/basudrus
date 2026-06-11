/**
 * explode.ts — pure math for the EXPLODED VIEW interaction.
 *
 * The exploded view separates a model's parts proportionally to a
 * single scalar t ∈ [0, 1]:
 *   t = 0  → fully assembled
 *   t = 1  → fully exploded
 *
 * Two inputs can drive t:
 *   - the HUD slider (writes the target directly), and
 *   - the JARVIS two-hand gesture: both hands pinch, pull apart.
 *     The gesture engine reports ratio = current hand distance /
 *     distance at gesture start (1.0 at start). We map that to a
 *     DELTA on top of whatever t was when the gesture began, so a
 *     user can explode in several pulls, or pinch-pull-together to
 *     reassemble — exactly like the holo-tab resize feels.
 *
 * Kept free of React/Three imports so scripts/tests/ can import the
 * real source under Node's native type stripping (same pattern as
 * gestures.ts — no drift between shipped logic and tests).
 */

/** How much explode-t a 2× hand-distance pull adds. 1.25 means
 *  pulling hands ~1.8× apart from a closed start fully explodes. */
export const EXPLODE_GESTURE_GAIN = 1.25;

/** Per-second exponential approach rate for the smoothed value the
 *  models actually render. ~8 ⇒ settles in roughly a third of a
 *  second — snappy but never poppy. */
export const EXPLODE_SMOOTH_RATE = 8;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Map a two-hand gesture ratio onto an explode target.
 *
 * @param base  explode-t captured at two-hand-scale-start
 * @param ratio engine's hand-distance ratio (1.0 = unchanged)
 * @param gain  how aggressively distance maps to t
 */
export function explodeTargetFromRatio(
  base: number,
  ratio: number,
  gain: number = EXPLODE_GESTURE_GAIN,
): number {
  // Guard NaN/Infinity from any degenerate frame — hold the base.
  if (!Number.isFinite(ratio)) return clamp01(base);
  return clamp01(base + (ratio - 1) * gain);
}

/**
 * Frame-rate-independent exponential approach of current → target.
 * Returns the new current. Pure so the rig's smoothing is testable.
 */
export function approachExplode(
  current: number,
  target: number,
  deltaSeconds: number,
  rate: number = EXPLODE_SMOOTH_RATE,
): number {
  if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return current;
  const k = Math.min(1, deltaSeconds * rate);
  const next = current + (clamp01(target) - current) * k;
  // Snap when close enough that further frames are invisible churn.
  return Math.abs(next - clamp01(target)) < 0.0005 ? clamp01(target) : next;
}

/**
 * The prop every procedural model accepts. A REF, not a value — the
 * smoothed t mutates at frame rate and must never trigger React
 * renders. Models read explodeRef.current inside their useFrame.
 */
export interface ModelExplodeProps {
  explodeRef?: { readonly current: number };
}

/** Shared shape for hand cursors mirrored into the 3D viewer
 *  (screen-space px, written by JarvisMode's rAF, drawn by
 *  JarvisView's overlay canvas). */
export interface ViewerHandCursor {
  x: number;
  y: number;
  pinching: boolean;
}
