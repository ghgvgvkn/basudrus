/**
 * exercise-fall.test.mjs — proves the AI Exercise fall-detection math.
 *
 * MIRRORS the pure logic in ai-app/src/aurora/exercise-mode/fallDetector.ts
 * (same convention as exercise-rep-counter.test.mjs mirroring repCounter.ts).
 * Keep the constants here in sync with the source if you tune them.
 *
 * Run: node scripts/tests/exercise-fall.test.mjs
 */

// ── mirror of fallDetector.ts ──
const FALL_DROP_TORSOS = 1.1;
const FALL_WINDOW_MS = 750;
const FLAT_RATIO = 0.5;
const STILL_MS = 2000;
const STILL_EPS = 0.045;
const RECOVER_MS = 1000;

const FLOOR_RE = /push|plank|bridge|thrust|sit-?up|situp|leg[- ]?raise|child|inchworm|mountain|burpee|crawl|lying|knee[- ]?to[- ]?elbow|dip/i;
function isFloorExercise(def) {
  return FLOOR_RE.test(def.id) || FLOOR_RE.test(def.name);
}

function midY(lm, a, b) {
  const pa = lm[a], pb = lm[b];
  if (!pa || !pb) return null;
  const va = pa.visibility ?? 1, vb = pb.visibility ?? 1;
  if (va < 0.5 || vb < 0.5) return null;
  return (pa.y + pb.y) / 2;
}

function createFallDetector() {
  let history = [];
  let phase = "idle";
  let stillSince = 0;
  let stillRefY = 0;
  let uprightSince = 0;
  let alerted = false;

  const reset = () => {
    history = []; phase = "idle"; stillSince = 0; uprightSince = 0; alerted = false;
  };

  const update = (lm, t) => {
    if (!lm) return phase === "fallen" ? "fallen" : "idle";
    const hipY = midY(lm, 23, 24);
    const shoulderY = midY(lm, 11, 12);
    if (hipY == null || shoulderY == null) return phase === "fallen" ? "fallen" : "idle";
    const sh = lm[11], hp = lm[23];
    const torso = Math.hypot((sh?.x ?? 0) - (hp?.x ?? 0), (sh?.y ?? 0) - (hp?.y ?? 0));
    if (torso < 0.05) return phase === "fallen" ? "fallen" : "idle";
    const flat = Math.abs(shoulderY - hipY) < FLAT_RATIO * torso;
    history.push({ t, hipY, shoulderY, torso, flat });
    while (history.length > 0 && t - history[0].t > 3000) history.shift();
    const upright = shoulderY < hipY - 0.55 * torso;

    if (phase === "fallen") {
      if (upright) {
        if (uprightSince === 0) uprightSince = t;
        else if (t - uprightSince > RECOVER_MS) reset();
      } else {
        uprightSince = 0;
      }
      return alerted ? "fallen" : "fallen";
    }
    if (phase === "idle") {
      for (let i = history.length - 1; i >= 0; i--) {
        const s = history[i];
        if (t - s.t > FALL_WINDOW_MS) break;
        if (hipY - s.hipY >= FALL_DROP_TORSOS * s.torso && flat) {
          phase = "down"; stillSince = t; stillRefY = hipY;
          break;
        }
      }
      return "idle";
    }
    if (!flat || upright) { phase = "idle"; return "idle"; }
    if (Math.abs(hipY - stillRefY) > STILL_EPS) {
      stillSince = t; stillRefY = hipY;
      return "down";
    }
    if (t - stillSince >= STILL_MS) {
      phase = "fallen"; alerted = true;
      return "fallen";
    }
    return "down";
  };

  return { update, reset };
}

// ── synthetic pose helpers (33-pt array; only 11/12/23/24 matter) ──
// A lying body spans HORIZONTALLY (shoulder.x far from hip.x) — the torso
// length is preserved, it just rotates. shoulderX/hipX model that.
function pose({ shoulderY, hipY, shoulderX = 0.5, hipX = 0.5, vis = 1 }) {
  const lm = new Array(33).fill(null).map(() => ({ x: 0.5, y: 0.5, visibility: vis }));
  lm[11] = { x: shoulderX - 0.05, y: shoulderY, visibility: vis };
  lm[12] = { x: shoulderX + 0.05, y: shoulderY, visibility: vis };
  lm[23] = { x: hipX - 0.04, y: hipY, visibility: vis };
  lm[24] = { x: hipX + 0.04, y: hipY, visibility: vis };
  return lm;
}
// standing: shoulders (0.30) well above hips (0.55) → torso ≈ 0.25 vertical
const STANDING = () => pose({ shoulderY: 0.3, hipY: 0.55 });
// on the floor: shoulders + hips near-level in y, spread ~0.25 in x → flat
const FLOOR = () => pose({ shoulderY: 0.86, hipY: 0.88, shoulderX: 0.36, hipX: 0.6 });

let failures = 0;
function check(name, ok) {
  console.log(`${ok ? "✅" : "❌"} ${name}`);
  if (!ok) failures++;
}

// 1) real fall: stand → fast drop (400ms) → flat + still 2s → FALLEN
{
  const det = createFallDetector();
  let t = 0;
  for (; t < 1500; t += 100) det.update(STANDING(), t);
  // fast drop over ~400ms (body already tipping → x starts spreading)
  det.update(pose({ shoulderY: 0.6, hipY: 0.72, shoulderX: 0.42, hipX: 0.56 }), t); t += 200;
  det.update(FLOOR(), t); t += 200;
  let phase = det.update(FLOOR(), t);
  // still on the floor for 2.2s
  let sawFallen = false;
  for (let i = 0; i < 23; i++) {
    t += 100;
    phase = det.update(FLOOR(), t);
    if (phase === "fallen") { sawFallen = true; break; }
  }
  check("hard fall + stillness → fallen", sawFallen);
}

// 2) controlled slow lie-down (3s descent) → NEVER fallen
{
  const det = createFallDetector();
  let t = 0;
  for (; t < 1500; t += 100) det.update(STANDING(), t);
  // slow descent: hip 0.55 → 0.88 over 3000ms (way beyond the 750ms window)
  for (let i = 0; i <= 30; i++) {
    const f = i / 30;
    det.update(
      pose({
        shoulderY: 0.3 + f * 0.56,
        hipY: 0.55 + f * 0.33,
        shoulderX: 0.5 - f * 0.14,
        hipX: 0.5 + f * 0.1,
      }),
      t,
    );
    t += 100;
  }
  let phase = "idle";
  for (let i = 0; i < 30; i++) { t += 100; phase = det.update(FLOOR(), t); }
  check("slow deliberate lie-down never alerts", phase !== "fallen");
}

// 3) squat (hips drop ~0.5 torso, stays vertical) → no alert
{
  const det = createFallDetector();
  let t = 0;
  for (; t < 1000; t += 100) det.update(STANDING(), t);
  for (let i = 0; i < 30; i++) {
    // deep squat: hips 0.55→0.68, shoulders 0.30→0.42 — body stays upright
    const f = Math.abs(Math.sin(i / 3));
    det.update(pose({ shoulderY: 0.3 + 0.12 * f, hipY: 0.55 + 0.13 * f }), t);
    t += 100;
  }
  let alerted = false;
  for (let i = 0; i < 25; i++) { t += 100; if (det.update(STANDING(), t) === "fallen") alerted = true; }
  check("squatting never alerts", !alerted);
}

// 4) fall then STAND BACK UP → auto-clears within ~1s
{
  const det = createFallDetector();
  let t = 0;
  for (; t < 1200; t += 100) det.update(STANDING(), t);
  det.update(FLOOR(), t + 300); t += 300;
  let phase = "idle";
  for (let i = 0; i < 25; i++) { t += 100; phase = det.update(FLOOR(), t); }
  check("(setup) fallen latched", phase === "fallen");
  // stand back up
  for (let i = 0; i < 14; i++) { t += 100; phase = det.update(STANDING(), t); }
  check("standing back up auto-clears the alert", phase !== "fallen");
}

// 5) low-visibility landmarks are ignored (no false alert from junk)
{
  const det = createFallDetector();
  let t = 0;
  for (; t < 1000; t += 100) det.update(STANDING(), t);
  let phase = det.update(pose({ shoulderY: 0.86, hipY: 0.88, shoulderX: 0.36, hipX: 0.6, vis: 0.2 }), t + 200);
  check("invisible landmarks are ignored", phase === "idle");
}

// 6) floor-exercise gate
{
  check(
    "push-up / plank / bridge / burpee are floor exercises",
    isFloorExercise({ id: "push-up", name: "Push-up" }) &&
    isFloorExercise({ id: "plank", name: "High plank" }) &&
    isFloorExercise({ id: "glute-bridge", name: "Glute bridge" }) &&
    isFloorExercise({ id: "burpee", name: "Burpees" }),
  );
  check(
    "squat / lunge / curl are NOT floor exercises",
    !isFloorExercise({ id: "bodyweight-squat", name: "Bodyweight squat" }) &&
    !isFloorExercise({ id: "forward-lunge", name: "Forward lunge" }) &&
    !isFloorExercise({ id: "biceps-curl", name: "Dumbbell biceps curl" }),
  );
}

if (failures > 0) {
  console.error(`\nexercise-fall: ${failures} test(s) FAILED`);
  process.exit(1);
}
console.log("\nexercise-fall: all tests passed");
