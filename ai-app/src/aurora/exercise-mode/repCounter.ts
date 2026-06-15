/**
 * repCounter.ts — pure rep-counting state machine for rep-kind exercises.
 *
 * The movement's primary angle (e.g. knee bend) swings between a contracted
 * (down) and extended (up) threshold. The GAP between the two thresholds is
 * hysteresis — an angle hovering near one line can't rattle the counter — and
 * a cooldown stops one twitchy frame from machine-gunning reps. This is the
 * exact discipline gestures.ts uses for pinch/clap/swipe. No React, no DOM:
 * unit-testable in Node against a recorded angle array.
 */
import { ema } from "./angles";
import type { RepConfig } from "./types";

export type RepPhase = "up" | "down";

export interface RepState {
  reps: number;
  phase: RepPhase;
  /** Smoothed primary angle (post-EMA). */
  smoothed: number;
  /** Deepest (smallest) angle reached during the current/just-finished rep. */
  minAngle: number;
  /** True ONLY on the frame a rep completes — read it, then it's gone. */
  justCompleted: boolean;
}

/** Minimum ms between counted reps — kills double-counts from jitter. */
export const REP_COOLDOWN_MS = 600;
/** EMA smoothing factor for the primary angle. */
export const ANGLE_ALPHA = 0.4;

export interface RepCounter {
  update(rawAngle: number, now: number): RepState;
  reset(): void;
}

export function createRepCounter(cfg: RepConfig): RepCounter {
  let reps = 0;
  let phase: RepPhase = "up";
  let smoothed = NaN;
  let minAngle = 180;
  let lastRepAt = -Infinity;

  return {
    update(rawAngle: number, now: number): RepState {
      smoothed = ema(smoothed, rawAngle, ANGLE_ALPHA);
      let justCompleted = false;

      if (phase === "up") {
        // Begin a descent once we cross the (lower) down threshold.
        if (smoothed < cfg.downAngle) {
          phase = "down";
          minAngle = smoothed;
        }
      } else {
        // Track the deepest point of this descent for the depth form check.
        if (smoothed < minAngle) minAngle = smoothed;
        // Complete the rep only on a full re-extension, past the cooldown.
        if (smoothed > cfg.upAngle && now - lastRepAt > REP_COOLDOWN_MS) {
          phase = "up";
          reps += 1;
          lastRepAt = now;
          justCompleted = true;
        }
      }
      return { reps, phase, smoothed, minAngle, justCompleted };
    },
    reset() {
      reps = 0;
      phase = "up";
      smoothed = NaN;
      minAngle = 180;
      lastRepAt = -Infinity;
    },
  };
}
