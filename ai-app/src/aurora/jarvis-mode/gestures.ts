/**
 * gestures.ts — the PURE gesture engine behind JARVIS Mode.
 *
 * Turns raw MediaPipe hand landmarks into high-level "spells":
 *
 *   pinch-start / pinch-move / pinch-end   → grab + drag a holo-window
 *   double-pinch                            → spawn a new tab          (founder: "click your hand twice")
 *   two-hand-scale (both hands pinching)    → resize the held window   (founder: "take the tab with two hands")
 *   clap (palms together, fast)             → create a new orb/circle  (founder: "two hands together → circle")
 *   swipe-left (open palm, fast left)       → focus mode, orb only     (founder: "hand to the left → only AI")
 *   swipe-right                             → bring the tabs back
 *
 * DESIGN RULES:
 *   - 100% pure: no DOM, no React, no MediaPipe imports. Input is plain
 *     numbers, output is plain events. That makes the whole interaction
 *     grammar unit-testable in Node (scripts/tests/jarvis-gestures.test.mjs
 *     mirrors this logic — keep both in sync when tuning constants).
 *   - Hysteresis everywhere: gestures latch ON at a tight threshold and
 *     release at a looser one, so a trembling hand never flickers
 *     grab/release at the boundary. Webcam landmarks are noisy; raw
 *     thresholds without hysteresis feel haunted.
 *   - Cooldowns on one-shot gestures (clap, swipe, double-pinch) so one
 *     physical motion can't machine-gun five events.
 *
 * COORDINATES: all positions are normalized 0..1 in *mirrored screen
 * space* — the caller flips x (1 - x) before handing landmarks in, so
 * "move hand right" means +x here, matching what the user sees on the
 * mirrored video. y grows downward (screen convention).
 */

/** One tracked hand for one frame. Landmarks follow MediaPipe's 21-point
 *  hand topology (0=wrist, 4=thumb tip, 8=index tip, 12=middle tip,
 *  16=ring tip, 20=pinky tip). Only x/y are used — z from a single
 *  webcam is too noisy to gate gameplay on. */
export interface HandData {
  /** Stable id for the hand within a session: 'Left' | 'Right'. */
  id: "Left" | "Right";
  /** 21 normalized landmarks in mirrored screen space. */
  landmarks: Array<{ x: number; y: number }>;
}

export interface HandFrame {
  hands: HandData[];
  /** Timestamp in ms (performance.now() at capture). */
  t: number;
}

export type HandId = "Left" | "Right";

/** Continuous per-hand cursor state, emitted every frame for drawing. */
export interface CursorState {
  hand: HandId;
  /** Smoothed index-fingertip position, normalized 0..1. */
  x: number;
  y: number;
  pinching: boolean;
}

export type GestureEvent =
  | { type: "pinch-start"; hand: HandId; x: number; y: number }
  | { type: "pinch-move"; hand: HandId; x: number; y: number; dx: number; dy: number }
  | { type: "pinch-end"; hand: HandId; x: number; y: number; durationMs: number; moved: number }
  | { type: "double-pinch"; hand: HandId; x: number; y: number }
  | { type: "two-hand-scale-start"; distance: number }
  | { type: "two-hand-scale"; ratio: number }
  | { type: "two-hand-scale-end" }
  | { type: "clap"; x: number; y: number }
  | { type: "swipe-left"; hand: HandId }
  | { type: "swipe-right"; hand: HandId }
  | { type: "fist-open"; hand: HandId };

// ── Tuning constants (exported so the mirror test can assert against the
//    exact same numbers; tune here, re-run the suite) ────────────────────────

/** Pinch latches ON when thumb-tip↔index-tip distance drops below this. */
export const PINCH_ON = 0.055;
/** ...and releases only when it grows past this (hysteresis gap). */
export const PINCH_OFF = 0.09;
/** Two pinch-starts on the same hand within this window = double-pinch. */
export const DOUBLE_PINCH_MS = 480;
/** ...provided the hand moved less than this between them. */
export const DOUBLE_PINCH_MAX_MOVE = 0.07;
/** Palm centers closer than this (with approach speed) = clap. */
export const CLAP_DIST = 0.13;
/** Required approach speed (normalized units/sec) for a clap. */
export const CLAP_APPROACH_SPEED = 0.45;
/** Min ms between claps. */
export const CLAP_COOLDOWN_MS = 1200;
/** Horizontal palm speed (units/sec) that counts as a swipe. */
export const SWIPE_SPEED = 1.1;
/** Vertical speed must stay under this for a horizontal swipe. */
export const SWIPE_MAX_CROSS = 0.9;
/** Consecutive qualifying frames before a swipe fires. */
export const SWIPE_FRAMES = 3;
/** Min ms between swipes per hand. */
export const SWIPE_COOLDOWN_MS = 900;
/** Cursor smoothing is SPEED-ADAPTIVE (1€-filter style): a slow hand
 *  gets heavy smoothing (steady, no jitter) while a fast hand gets
 *  almost none — so a grabbed tab keeps up with a fast throw instead
 *  of trailing ~100ms behind it (founder: "when I move fast it should
 *  move with me fast"). */
/** EMA floor — smoothing applied when the hand is (near) still. */
export const CURSOR_ALPHA = 0.35;
/** EMA ceiling — smoothing when the hand is moving at full speed. */
export const CURSOR_ALPHA_MAX = 0.95;
/** Raw cursor speed (normalized units/sec) at which alpha hits the ceiling. */
export const CURSOR_SPEED_FULL = 0.8;
/** A pinch shorter than this with less travel than TAP_MAX_MOVE is a "tap". */
export const TAP_MAX_MS = 280;
export const TAP_MAX_MOVE = 0.035;
/** ...and shorter than this is a tracking flicker, not a human tap. A
 *  1-frame phantom pinch at 30fps is ~33ms; humans can't pinch+release
 *  under ~70ms. Filters the founder-reported bug where a page opened
 *  by itself the moment the camera started. */
export const TAP_MIN_MS = 70;
/** Two pinch-STARTS closer together than this are tracking jitter, not
 *  an intentional double-pinch (humans can't re-pinch in 130ms). */
export const DOUBLE_PINCH_MIN_GAP_MS = 130;
/** Events from a hand are suppressed for this long after it first
 *  appears — landmark jitter during acquisition fakes pinches. Cursors
 *  still render immediately so tracking feels instant. */
export const HAND_WARMUP_MS = 700;

// ── Fist → open ("crush and release" — founder: "close your hand as a
//    fist… then open it for five fingers → the page should be closed").
//    Ratios are fingertip-to-palm distance normalized by hand size
//    (wrist→middle-MCP), so the gesture works at any distance from the
//    camera. Hold the fist briefly (deliberate), then open wide.
/** avg fingertip/palm ratio below this = fist. */
export const FIST_RATIO = 0.7;
/** avg fingertip/palm ratio above this = open hand (five fingers). */
export const OPEN_RATIO = 1.15;
/** Fist must be held this long to arm (prevents accidental flickers). */
export const FIST_HOLD_MS = 450;
/** After leaving the fist, the open hand must appear within this window. */
export const FIST_OPEN_WINDOW_MS = 700;
/** Min ms between fist-open firings per hand. */
export const FIST_COOLDOWN_MS = 1100;

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

/** Palm center ≈ mean of wrist + index/middle/ring/pinky MCP knuckles
 *  (landmarks 0, 5, 9, 13, 17) — stable under finger wiggle. */
function palmCenter(lm: Array<{ x: number; y: number }>): { x: number; y: number } {
  const idx = [0, 5, 9, 13, 17];
  let x = 0;
  let y = 0;
  for (const i of idx) {
    x += lm[i].x;
    y += lm[i].y;
  }
  return { x: x / idx.length, y: y / idx.length };
}

interface PerHand {
  pinching: boolean;
  /** Smoothed cursor (index tip). */
  cx: number;
  cy: number;
  /** Cursor position at pinch-start (for drag deltas + tap detection). */
  startX: number;
  startY: number;
  pinchStartT: number;
  /** Total travel during the current pinch. */
  travel: number;
  /** Last pinch-START time, for double-pinch detection. */
  lastPinchStartT: number;
  lastPinchStartX: number;
  lastPinchStartY: number;
  /** Palm-velocity EMA (units/sec). */
  vx: number;
  vy: number;
  px: number; // previous palm center
  py: number;
  pt: number; // previous frame time
  /** Previous RAW cursor sample (pre-smoothing) — drives the adaptive
   *  smoothing alpha. -1 = no sample yet. */
  rx: number;
  ry: number;
  rt: number;
  swipeFramesLeft: number; // consecutive frames qualifying leftward
  swipeFramesRight: number;
  lastSwipeT: number;
  /** Fist→open tracking: when the current fist started (-1 = not in
   *  fist), whether it was held long enough to arm, the last moment the
   *  hand was still a fist, and the last firing time (cooldown). */
  fistSince: number;
  fistArmed: boolean;
  fistLastSeenT: number;
  lastFistOpenT: number;
  /** When this hand FIRST appeared in the current visibility streak —
   *  events are suppressed until warmupMs elapse (acquisition jitter). */
  firstSeenT: number;
  seen: boolean; // present in the latest frame
}

function freshHand(): PerHand {
  return {
    pinching: false,
    cx: -1,
    cy: -1,
    startX: 0,
    startY: 0,
    pinchStartT: 0,
    travel: 0,
    lastPinchStartT: -1e9,
    lastPinchStartX: 0,
    lastPinchStartY: 0,
    vx: 0,
    vy: 0,
    px: -1,
    py: -1,
    pt: -1,
    rx: -1,
    ry: -1,
    rt: -1,
    swipeFramesLeft: 0,
    swipeFramesRight: 0,
    lastSwipeT: -1e9,
    fistSince: -1,
    fistArmed: false,
    fistLastSeenT: -1e9,
    lastFistOpenT: -1e9,
    firstSeenT: -1,
    seen: false,
  };
}

/**
 * Stateful gesture recognizer. Feed it one HandFrame per camera tick;
 * it returns the events that fired plus the current cursor states.
 * Create one per JARVIS session; call reset() if the camera restarts.
 */
export class GestureEngine {
  private hands: Record<HandId, PerHand> = {
    Left: freshHand(),
    Right: freshHand(),
  };
  /** Per-hand event suppression window after acquisition (ms). The
   *  production layer passes HAND_WARMUP_MS; tests default to 0 so
   *  scenarios can start at t=0 without pre-feeding warm-up frames. */
  private readonly warmupMs: number;
  private twoHandActive = false;
  private twoHandStartDist = 0;

  constructor(opts: { warmupMs?: number } = {}) {
    this.warmupMs = opts.warmupMs ?? 0;
  }
  private lastClapT = -1e9;
  /** Previous-frame palm distance for clap approach speed. */
  private prevPalmDist = -1;
  private prevPalmT = -1;

  reset(): void {
    this.hands = { Left: freshHand(), Right: freshHand() };
    this.twoHandActive = false;
    this.twoHandStartDist = 0;
    this.lastClapT = -1e9;
    this.prevPalmDist = -1;
    this.prevPalmT = -1;
  }

  update(frame: HandFrame): { events: GestureEvent[]; cursors: CursorState[] } {
    const events: GestureEvent[] = [];
    const cursors: CursorState[] = [];
    const t = frame.t;

    this.hands.Left.seen = false;
    this.hands.Right.seen = false;

    for (const hand of frame.hands) {
      const s = this.hands[hand.id];
      if (!s || hand.landmarks.length < 21) continue;
      s.seen = true;
      if (s.firstSeenT < 0) s.firstSeenT = t;
      // Acquisition warm-up: landmark jitter in the first moments of
      // tracking fakes pinches (the founder watched a page open itself).
      // Cursors/velocity keep updating so tracking FEELS instant, but no
      // gesture can fire until the hand has been stable for warmupMs.
      const warm = t - s.firstSeenT >= this.warmupMs;

      const thumb = hand.landmarks[4];
      const index = hand.landmarks[8];
      const palm = palmCenter(hand.landmarks);
      const pinchDist = dist(thumb, index);

      // ── Cursor smoothing (midpoint of thumb+index reads as "the grab
      //    point"; while open, the index tip alone feels more precise) ──
      const rawX = s.pinching ? (thumb.x + index.x) / 2 : index.x;
      const rawY = s.pinching ? (thumb.y + index.y) / 2 : index.y;
      // Speed-adaptive alpha: still hand → CURSOR_ALPHA (smooth), fast
      // hand → CURSOR_ALPHA_MAX (nearly raw, no perceptible lag).
      let alpha = CURSOR_ALPHA;
      if (s.rt >= 0 && t > s.rt) {
        const rdt = (t - s.rt) / 1000;
        const speed = Math.hypot(rawX - s.rx, rawY - s.ry) / rdt;
        const k = Math.min(1, speed / CURSOR_SPEED_FULL);
        alpha = CURSOR_ALPHA + (CURSOR_ALPHA_MAX - CURSOR_ALPHA) * k;
      }
      s.rx = rawX;
      s.ry = rawY;
      s.rt = t;
      if (s.cx < 0) {
        s.cx = rawX;
        s.cy = rawY;
      } else {
        s.cx += alpha * (rawX - s.cx);
        s.cy += alpha * (rawY - s.cy);
      }

      // ── Palm velocity EMA (for swipes + clap approach) ──
      if (s.pt >= 0 && t > s.pt) {
        const dt = (t - s.pt) / 1000;
        const ivx = (palm.x - s.px) / dt;
        const ivy = (palm.y - s.py) / dt;
        s.vx += 0.5 * (ivx - s.vx);
        s.vy += 0.5 * (ivy - s.vy);
      }
      s.px = palm.x;
      s.py = palm.y;
      s.pt = t;

      // ── Pinch with hysteresis ──
      if (!warm) {
        // Still warming up — hold the state machine released so the first
        // post-warm-up frame starts clean. No events of any kind.
        s.pinching = false;
      } else if (!s.pinching && pinchDist < PINCH_ON) {
        s.pinching = true;
        s.startX = s.cx;
        s.startY = s.cy;
        s.pinchStartT = t;
        s.travel = 0;

        // Double-pinch: a second start close (time AND space) to the last.
        // A re-pinch under DOUBLE_PINCH_MIN_GAP_MS is tracking flicker —
        // humans can't physically re-pinch that fast — so it neither fires
        // nor moves the anchor (the flicker is "the same pinch").
        const sinceLast = t - s.lastPinchStartT;
        const moveSinceLast = Math.hypot(s.cx - s.lastPinchStartX, s.cy - s.lastPinchStartY);
        if (sinceLast < DOUBLE_PINCH_MIN_GAP_MS) {
          /* flicker — keep the existing anchor */
        } else if (sinceLast < DOUBLE_PINCH_MS && moveSinceLast < DOUBLE_PINCH_MAX_MOVE) {
          events.push({ type: "double-pinch", hand: hand.id, x: s.cx, y: s.cy });
          // Consume so a triple-tap doesn't fire two double-pinches.
          s.lastPinchStartT = -1e9;
        } else {
          s.lastPinchStartT = t;
          s.lastPinchStartX = s.cx;
          s.lastPinchStartY = s.cy;
        }
        events.push({ type: "pinch-start", hand: hand.id, x: s.cx, y: s.cy });
      } else if (s.pinching && pinchDist > PINCH_OFF) {
        s.pinching = false;
        events.push({
          type: "pinch-end",
          hand: hand.id,
          x: s.cx,
          y: s.cy,
          durationMs: t - s.pinchStartT,
          moved: s.travel,
        });
      } else if (s.pinching) {
        const dx = s.cx - s.startX;
        const dy = s.cy - s.startY;
        s.travel = Math.max(s.travel, Math.hypot(dx, dy));
        events.push({ type: "pinch-move", hand: hand.id, x: s.cx, y: s.cy, dx, dy });
      }

      // ── Swipes: open palm only (pinching = dragging, never a swipe) ──
      if (warm && !s.pinching && Math.abs(s.vy) < SWIPE_MAX_CROSS) {
        s.swipeFramesLeft = s.vx < -SWIPE_SPEED ? s.swipeFramesLeft + 1 : 0;
        s.swipeFramesRight = s.vx > SWIPE_SPEED ? s.swipeFramesRight + 1 : 0;
      } else {
        s.swipeFramesLeft = 0;
        s.swipeFramesRight = 0;
      }
      if (s.swipeFramesLeft >= SWIPE_FRAMES && t - s.lastSwipeT > SWIPE_COOLDOWN_MS) {
        events.push({ type: "swipe-left", hand: hand.id });
        s.lastSwipeT = t;
        s.swipeFramesLeft = 0;
      } else if (s.swipeFramesRight >= SWIPE_FRAMES && t - s.lastSwipeT > SWIPE_COOLDOWN_MS) {
        events.push({ type: "swipe-right", hand: hand.id });
        s.lastSwipeT = t;
        s.swipeFramesRight = 0;
      }

      // ── Fist → open: crush-and-release closes the open page view ──
      // Ratio = avg(non-thumb fingertip ↔ palm-center) / hand size, so it
      // works at any distance from the camera. The thumb is excluded (it
      // curls differently). Skipped while pinching (a pinch half-curls the
      // index) and for degenerate frames (handSize ≈ 0 — also keeps the
      // synthetic single-point test hands from tripping it).
      const handSize = dist(hand.landmarks[0], hand.landmarks[9]);
      if (!warm || s.pinching || handSize < 0.02) {
        s.fistSince = -1;
        s.fistArmed = false;
      } else {
        const tips = [8, 12, 16, 20];
        let avg = 0;
        for (const i of tips) avg += dist(hand.landmarks[i], palm);
        avg = avg / tips.length / handSize;

        if (avg < FIST_RATIO) {
          if (s.fistSince < 0) s.fistSince = t;
          if (t - s.fistSince >= FIST_HOLD_MS) s.fistArmed = true;
          s.fistLastSeenT = t;
        } else {
          if (
            avg > OPEN_RATIO &&
            s.fistArmed &&
            t - s.fistLastSeenT <= FIST_OPEN_WINDOW_MS &&
            t - s.lastFistOpenT > FIST_COOLDOWN_MS
          ) {
            events.push({ type: "fist-open", hand: hand.id });
            s.lastFistOpenT = t;
            s.fistArmed = false;
            s.fistSince = -1;
          } else if (s.fistArmed && t - s.fistLastSeenT > FIST_OPEN_WINDOW_MS) {
            // Fist released but never opened wide in time — disarm.
            s.fistArmed = false;
            s.fistSince = -1;
          } else if (!s.fistArmed) {
            s.fistSince = -1;
          }
        }
      }

      cursors.push({ hand: hand.id, x: s.cx, y: s.cy, pinching: s.pinching });
    }

    // ── Hands that vanished mid-pinch: emit a clean pinch-end so a grabbed
    //    window is never stranded mid-air. ──
    for (const id of ["Left", "Right"] as const) {
      const s = this.hands[id];
      if (!s.seen && s.pinching) {
        s.pinching = false;
        events.push({
          type: "pinch-end",
          hand: id,
          x: s.cx,
          y: s.cy,
          durationMs: t - s.pinchStartT,
          moved: s.travel,
        });
      }
      if (!s.seen) {
        s.swipeFramesLeft = 0;
        s.swipeFramesRight = 0;
        s.pt = -1; // velocity restarts cleanly when the hand returns
        s.vx = 0;
        s.vy = 0;
        s.rt = -1; // adaptive-smoothing speed sample restarts too
        s.fistSince = -1;
        s.fistArmed = false;
        s.firstSeenT = -1; // re-acquisition restarts the warm-up window
      }
    }

    // ── Two-hand interactions (both hands present AND past warm-up) ──
    const L = this.hands.Left;
    const R = this.hands.Right;
    const bothWarm =
      L.firstSeenT >= 0 &&
      R.firstSeenT >= 0 &&
      t - L.firstSeenT >= this.warmupMs &&
      t - R.firstSeenT >= this.warmupMs;
    if (L.seen && R.seen && bothWarm) {
      const palmDist = Math.hypot(L.px - R.px, L.py - R.py);

      // Two-hand scale: BOTH pinching = holding the window with two hands.
      const bothPinching = L.pinching && R.pinching;
      const grabDist = Math.hypot(L.cx - R.cx, L.cy - R.cy);
      if (bothPinching && !this.twoHandActive) {
        this.twoHandActive = true;
        this.twoHandStartDist = Math.max(grabDist, 0.02);
        events.push({ type: "two-hand-scale-start", distance: grabDist });
      } else if (bothPinching && this.twoHandActive) {
        events.push({ type: "two-hand-scale", ratio: grabDist / this.twoHandStartDist });
      } else if (!bothPinching && this.twoHandActive) {
        this.twoHandActive = false;
        events.push({ type: "two-hand-scale-end" });
      }

      // Clap: palms rushing together, neither pinching, close together.
      if (this.prevPalmDist >= 0 && this.prevPalmT >= 0 && t > this.prevPalmT) {
        const approach = (this.prevPalmDist - palmDist) / ((t - this.prevPalmT) / 1000);
        if (
          !L.pinching &&
          !R.pinching &&
          palmDist < CLAP_DIST &&
          approach > CLAP_APPROACH_SPEED &&
          t - this.lastClapT > CLAP_COOLDOWN_MS
        ) {
          events.push({
            type: "clap",
            x: (L.px + R.px) / 2,
            y: (L.py + R.py) / 2,
          });
          this.lastClapT = t;
        }
      }
      this.prevPalmDist = palmDist;
      this.prevPalmT = t;
    } else {
      // A hand left the frame — any ongoing two-hand scale ends.
      if (this.twoHandActive) {
        this.twoHandActive = false;
        events.push({ type: "two-hand-scale-end" });
      }
      this.prevPalmDist = -1;
      this.prevPalmT = -1;
    }

    return { events, cursors };
  }
}

/** True when a finished pinch reads as a "tap" (click) rather than a drag —
 *  used by the window layer to treat quick pinches as clicks on content.
 *  The TAP_MIN_MS floor rejects 1-frame tracking flickers (~33ms) that
 *  would otherwise phantom-open pages the user never touched. */
export function isTap(e: Extract<GestureEvent, { type: "pinch-end" }>): boolean {
  return e.durationMs >= TAP_MIN_MS && e.durationMs < TAP_MAX_MS && e.moved < TAP_MAX_MOVE;
}
