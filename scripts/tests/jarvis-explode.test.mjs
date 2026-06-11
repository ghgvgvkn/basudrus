// EXPLODED VIEW math test — imports the REAL TypeScript source
// (ai-app/src/jarvis/explode.ts) via Node >=23 native type stripping,
// same zero-drift pattern as jarvis-gestures.test.mjs.
import {
  explodeTargetFromRatio,
  approachExplode,
  EXPLODE_GESTURE_GAIN,
} from "../../ai-app/src/jarvis/explode.ts";

const t = (name, cond) => {
  console.log(cond ? "✅" : "❌", name);
  return cond;
};
let all = true;

// 1 ── ratio 1.0 (hands haven't moved) holds the base exactly
all &= t("ratio 1.0 holds base", explodeTargetFromRatio(0.4, 1.0) === 0.4);

// 2 ── pulling apart increases t; pushing together decreases it
all &= t(
  "pull apart explodes",
  explodeTargetFromRatio(0, 1.4) > 0.3 && explodeTargetFromRatio(0, 1.4) < 0.7,
);
all &= t("push together reassembles", explodeTargetFromRatio(0.8, 0.6) < 0.8);

// 3 ── clamping: huge pulls cap at 1, hard push floors at 0
all &= t("clamps at 1", explodeTargetFromRatio(0.5, 5) === 1);
all &= t("clamps at 0", explodeTargetFromRatio(0.2, 0.01) === 0);

// 4 ── base composition: a second pull continues from where the
//      first left off (mirrors holo-tab baseScale * ratio feel)
{
  const afterFirst = explodeTargetFromRatio(0, 1.3);
  const afterSecond = explodeTargetFromRatio(afterFirst, 1.3);
  all &= t("pulls compose via base", afterSecond > afterFirst && afterSecond <= 1);
}

// 5 ── full explode reachable in one strong pull: ratio 1.9 from 0
all &= t(
  "1.9x pull ≈ full explode",
  explodeTargetFromRatio(0, 1.9) >= 0.9 * Math.min(1, 0.9 * EXPLODE_GESTURE_GAIN),
);

// 6 ── degenerate ratios (NaN/Infinity from a bad frame) hold base
all &= t("NaN ratio holds base", explodeTargetFromRatio(0.5, NaN) === 0.5);
all &= t("Infinity ratio holds base", explodeTargetFromRatio(0.5, Infinity) === 0.5);

// 7 ── smoothing approaches monotonically and settles exactly
{
  let cur = 0;
  let prev = 0;
  let monotone = true;
  for (let i = 0; i < 120; i++) {
    cur = approachExplode(cur, 1, 1 / 60);
    if (cur < prev) monotone = false;
    prev = cur;
  }
  all &= t("approach is monotone toward target", monotone);
  all &= t("approach settles exactly at target", cur === 1);
}

// 8 ── smoothing is frame-rate independent-ish: a 30fps run lands in
//      the same neighborhood as a 60fps run after equal wall time
{
  let a = 0;
  for (let i = 0; i < 60; i++) a = approachExplode(a, 1, 1 / 60); // 1s @60
  let b = 0;
  for (let i = 0; i < 30; i++) b = approachExplode(b, 1, 1 / 30); // 1s @30
  all &= t("framerate-independent within 5%", Math.abs(a - b) < 0.05);
}

// 9 ── zero/negative delta is a no-op (paused tab safety)
all &= t("zero delta no-op", approachExplode(0.3, 1, 0) === 0.3);
all &= t("negative delta no-op", approachExplode(0.3, 1, -1) === 0.3);

// 10 ── smoothing clamps an out-of-range target
all &= t("approach clamps target >1", approachExplode(0.9, 7, 1) === 1);

if (!all) {
  console.error("jarvis-explode: FAILURES");
  process.exit(1);
}
console.log("jarvis-explode: all passed");
