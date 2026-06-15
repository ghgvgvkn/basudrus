/**
 * exercise-rep-counter.test.mjs — proves the AI Exercise rep-counting math.
 *
 * MIRRORS the pure logic in ai-app/src/aurora/exercise-mode/{angles,repCounter}.ts
 * (same convention as scripts/tests/jarvis-gestures.test.mjs mirroring gestures.ts).
 * Keep the constants here in sync with the source if you tune them.
 *
 * Run: node scripts/tests/exercise-rep-counter.test.mjs
 */

// ── mirror of angles.ts ──
function angleAt(a, b, c) {
  const r = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
  let deg = Math.abs((r * 180) / Math.PI);
  if (deg > 180) deg = 360 - deg;
  return deg;
}
function ema(prev, next, alpha = 0.4) {
  if (!Number.isFinite(prev)) return next;
  return prev + alpha * (next - prev);
}

// ── mirror of repCounter.ts ──
const REP_COOLDOWN_MS = 600;
const ANGLE_ALPHA = 0.4;
function createRepCounter(cfg) {
  let reps = 0;
  let phase = "up";
  let smoothed = NaN;
  let minAngle = 180;
  let lastRepAt = -Infinity;
  return {
    update(rawAngle, now) {
      smoothed = ema(smoothed, rawAngle, ANGLE_ALPHA);
      let justCompleted = false;
      if (phase === "up") {
        if (smoothed < cfg.downAngle) {
          phase = "down";
          minAngle = smoothed;
        }
      } else {
        if (smoothed < minAngle) minAngle = smoothed;
        if (smoothed > cfg.upAngle && now - lastRepAt > REP_COOLDOWN_MS) {
          phase = "up";
          reps += 1;
          lastRepAt = now;
          justCompleted = true;
        }
      }
      return { reps, phase, smoothed, minAngle, justCompleted };
    },
  };
}

const SQUAT = { downAngle: 110, upAngle: 160 };
const SQUAT_DEPTH_CUE = 100; // minAngle above this → "go deeper"

// ── test harness ──
let passed = 0;
let failed = 0;
function assert(name, cond) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

/** Generate a frame sequence; each segment ramps angle from→to over `frames`. */
function ramp(from, to, frames) {
  const out = [];
  for (let i = 0; i < frames; i++) out.push(from + ((to - from) * i) / (frames - 1));
  return out;
}

/** Feed an angle sequence (33ms apart) through a counter, return final reps
 *  and per-rep minAngles. */
function run(cfg, angles, startT = 0) {
  const c = createRepCounter(cfg);
  let reps = 0;
  const minAngles = [];
  let t = startT;
  for (const a of angles) {
    const st = c.update(a, t);
    if (st.justCompleted) {
      reps = st.reps;
      minAngles.push(Math.round(st.minAngle));
    }
    t += 33;
  }
  return { reps, minAngles };
}

console.log("angle math:");
{
  // right angle: a above b, c to the right of b → 90°
  const a = { x: 0, y: -1 }, b = { x: 0, y: 0 }, c = { x: 1, y: 0 };
  assert("right angle ≈ 90", Math.abs(angleAt(a, b, c) - 90) < 0.001);
  // straight line a-b-c → 180°
  const s1 = { x: -1, y: 0 }, s2 = { x: 0, y: 0 }, s3 = { x: 1, y: 0 };
  assert("straight ≈ 180", Math.abs(angleAt(s1, s2, s3) - 180) < 0.001);
  // shallow bend
  const d1 = { x: -1, y: 0 }, d2 = { x: 0, y: 0 }, d3 = { x: 1, y: -1 };
  assert("45° bend ≈ 135", Math.abs(angleAt(d1, d2, d3) - 135) < 0.001);
}

console.log("rep counting:");
{
  // 5 clean squats: stand(170) → deep(80) → stand(170), ~20 frames each way.
  let seq = [];
  for (let i = 0; i < 5; i++) {
    seq = seq.concat(ramp(170, 80, 20), ramp(80, 170, 20));
  }
  const r = run(SQUAT, seq);
  assert("5 full squats → 5 reps", r.reps === 5);
  assert("each rep reached good depth (<100)", r.minAngles.every((m) => m < 100));
}
{
  // Half squats that never pass the down threshold → 0 reps.
  let seq = [];
  for (let i = 0; i < 5; i++) seq = seq.concat(ramp(170, 120, 20), ramp(120, 170, 20));
  const r = run(SQUAT, seq);
  assert("half squats (to 120) → 0 reps", r.reps === 0);
}
{
  // Jitter at the bottom must not create extra reps within one descent.
  const seq = ramp(170, 80, 20)
    .concat([85, 82, 88, 81, 90, 79, 86]) // noisy bottom
    .concat(ramp(80, 170, 20));
  const r = run(SQUAT, seq);
  assert("one squat with noisy bottom → exactly 1 rep", r.reps === 1);
}
{
  // Cooldown guard: two HARD full-range swings back-to-back (both cross the
  // down + up thresholds) within 600ms must count as ONE rep, not two.
  const A = Array(3).fill(70); // hard down
  const B = Array(4).fill(180); // hard up
  const seq = [...A, ...B, ...A, ...B]; // 2 cycles in ~460ms
  const r = run(SQUAT, seq);
  assert("two hard swings within 600ms cooldown → 1 rep, not 2", r.reps === 1);
}
{
  // Shallow-but-counting rep: knee bottoms around 104° (past the 110 arm line
  // but not parallel) → counts, AND its minAngle sits above the depth line so
  // "go deeper" would fire. Hold the bottom so the EMA settles there.
  const seq = ramp(170, 104, 16)
    .concat(Array(6).fill(104)) // brief hold at the bottom
    .concat(ramp(104, 170, 16));
  const r = run(SQUAT, seq);
  assert("shallow rep still counts", r.reps === 1);
  assert(
    "shallow rep minAngle in (depth-cue, arm) → depth cue fires",
    r.minAngles[0] > SQUAT_DEPTH_CUE && r.minAngles[0] < 110,
  );
}

console.log("");
if (failed === 0) {
  console.log(`✅ exercise-rep-counter: all ${passed} checks passed`);
  process.exit(0);
} else {
  console.error(`❌ exercise-rep-counter: ${failed} failed, ${passed} passed`);
  process.exit(1);
}
