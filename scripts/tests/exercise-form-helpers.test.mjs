/**
 * exercise-form-helpers.test.mjs — proves the orientation + form-geometry that
 * powers live correction. MIRRORS ai-app/src/aurora/exercise-mode/formHelpers.ts
 * (same convention as the other exercise tests). Keep in sync if you tune it.
 *
 * Run: node scripts/tests/exercise-form-helpers.test.mjs
 */

// ── mirror of formHelpers.ts ──
function angleAt(a, b, c) {
  const r = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
  let deg = Math.abs((r * 180) / Math.PI);
  if (deg > 180) deg = 360 - deg;
  return deg;
}
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

// landmark indices used here
const P = { LSH: 11, RSH: 12, LHIP: 23, RHIP: 24, LKNEE: 25, RKNEE: 26, LANK: 27, RANK: 28 };

function facingOf(lm) {
  const ls = lm[P.LSH], rs = lm[P.RSH], lh = lm[P.LHIP], rh = lm[P.RHIP];
  const shoulderSpread = Math.abs(ls.x - rs.x);
  const torsoH = Math.abs((ls.y + rs.y) / 2 - (lh.y + rh.y) / 2) || 0.001;
  return shoulderSpread / torsoH > 0.55 ? "front" : "side";
}
function trunkLeanDeg(lm) {
  const sh = mid(lm[P.LSH], lm[P.RSH]);
  const hip = mid(lm[P.LHIP], lm[P.RHIP]);
  const dx = sh.x - hip.x;
  const dy = sh.y - hip.y;
  return Math.abs((Math.atan2(dx, -dy) * 180) / Math.PI);
}
// knee-valgus cue: front-only; fault when knees draw closer than ankles*ratio
function kneesCaving(lm, facing, ratio) {
  if (facing !== "front") return false; // view-gated — the research's #1 fix
  const kneeGap = Math.abs(lm[P.LKNEE].x - lm[P.RKNEE].x);
  const ankleGap = Math.abs(lm[P.LANK].x - lm[P.RANK].x);
  return kneeGap < ankleGap * ratio;
}

// ── helpers to build a 33-point landmark array ──
function makeLm(overrides) {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1 }));
  for (const [i, p] of Object.entries(overrides)) lm[i] = { visibility: 1, ...p };
  return lm;
}

let passed = 0, failed = 0;
function assert(name, cond) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}

console.log("orientation (facingOf):");
{
  const front = makeLm({
    [P.LSH]: { x: 0.40, y: 0.30 }, [P.RSH]: { x: 0.60, y: 0.30 },
    [P.LHIP]: { x: 0.42, y: 0.60 }, [P.RHIP]: { x: 0.58, y: 0.60 },
  });
  assert("wide shoulders → front", facingOf(front) === "front");

  const side = makeLm({
    [P.LSH]: { x: 0.50, y: 0.30 }, [P.RSH]: { x: 0.52, y: 0.30 },
    [P.LHIP]: { x: 0.50, y: 0.60 }, [P.RHIP]: { x: 0.52, y: 0.60 },
  });
  assert("overlapping shoulders → side", facingOf(side) === "side");
}

console.log("trunk lean:");
{
  const upright = makeLm({
    [P.LSH]: { x: 0.48, y: 0.30 }, [P.RSH]: { x: 0.52, y: 0.30 },
    [P.LHIP]: { x: 0.48, y: 0.60 }, [P.RHIP]: { x: 0.52, y: 0.60 },
  });
  assert("upright torso ≈ 0°", trunkLeanDeg(upright) < 3);

  const leaned = makeLm({
    [P.LSH]: { x: 0.63, y: 0.33 }, [P.RSH]: { x: 0.67, y: 0.33 },
    [P.LHIP]: { x: 0.48, y: 0.60 }, [P.RHIP]: { x: 0.52, y: 0.60 },
  });
  const deg = trunkLeanDeg(leaned);
  assert("forward lean detected (>25°)", deg > 25);
}

console.log("knee valgus — view-gated (the key safety fix):");
{
  // Knees caved in (close together), ankles wider apart.
  const cavedFront = makeLm({
    [P.LSH]: { x: 0.40, y: 0.30 }, [P.RSH]: { x: 0.60, y: 0.30 },
    [P.LHIP]: { x: 0.42, y: 0.60 }, [P.RHIP]: { x: 0.58, y: 0.60 },
    [P.LKNEE]: { x: 0.49, y: 0.75 }, [P.RKNEE]: { x: 0.51, y: 0.75 },
    [P.LANK]: { x: 0.43, y: 0.92 }, [P.RANK]: { x: 0.57, y: 0.92 },
  });
  assert("front view: caving knees flagged", kneesCaving(cavedFront, "front", 0.7) === true);
  assert("SIDE view: same geometry NOT flagged (can't see it)", kneesCaving(cavedFront, "side", 0.7) === false);

  // Good knees (tracking over ankles).
  const goodFront = makeLm({
    [P.LKNEE]: { x: 0.43, y: 0.75 }, [P.RKNEE]: { x: 0.57, y: 0.75 },
    [P.LANK]: { x: 0.43, y: 0.92 }, [P.RANK]: { x: 0.57, y: 0.92 },
  });
  assert("front view: good knee tracking NOT flagged", kneesCaving(goodFront, "front", 0.7) === false);
}

console.log("");
if (failed === 0) {
  console.log(`✅ exercise-form-helpers: all ${passed} checks passed`);
  process.exit(0);
} else {
  console.error(`❌ exercise-form-helpers: ${failed} failed, ${passed} passed`);
  process.exit(1);
}
