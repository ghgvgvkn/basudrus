// JARVIS Mode gesture engine test — imports the REAL TypeScript source
// (ai-app/src/aurora/jarvis-mode/gestures.ts) via Node >=23 native type
// stripping, so unlike the mirror-style suites there is NO drift risk:
// we test the exact shipped logic. Requires Node 23.6+ / 24 (repo uses 24).
import {
  GestureEngine,
  isTap,
  PINCH_ON,
  PINCH_OFF,
  DOUBLE_PINCH_MS,
  CLAP_COOLDOWN_MS,
  SWIPE_FRAMES,
} from "../../ai-app/src/aurora/jarvis-mode/gestures.ts";

// ── synthetic-hand helpers ───────────────────────────────────────────────
// Build a 21-landmark hand whose palm cluster sits at (x,y) and whose
// thumb-tip(4)/index-tip(8) are separated by `pinchDist` around (x,y).
function mkHand(id, x, y, pinchDist) {
  const lm = Array.from({ length: 21 }, () => ({ x, y }));
  lm[4] = { x: x - pinchDist / 2, y };
  lm[8] = { x: x + pinchDist / 2, y };
  return { id, landmarks: lm };
}
const OPEN = PINCH_OFF + 0.04; // clearly not pinching
const CLOSED = PINCH_ON - 0.02; // clearly pinching

const t = (name, cond) => {
  console.log(cond ? "✅" : "❌", name);
  return cond;
};
let all = true;

// 1 ── pinch hysteresis: latches below PINCH_ON, holds in the dead zone,
//      releases only above PINCH_OFF
{
  const eng = new GestureEngine();
  let r = eng.update({ t: 0, hands: [mkHand("Right", 0.5, 0.5, OPEN)] });
  all = t("open hand → no pinch", !r.events.some((e) => e.type === "pinch-start")) && all;
  r = eng.update({ t: 33, hands: [mkHand("Right", 0.5, 0.5, CLOSED)] });
  all = t("close fingers → pinch-start", r.events.some((e) => e.type === "pinch-start")) && all;
  const mid = (PINCH_ON + PINCH_OFF) / 2; // inside the hysteresis dead zone
  r = eng.update({ t: 66, hands: [mkHand("Right", 0.5, 0.5, mid)] });
  all = t("dead zone → still pinching (no end)", !r.events.some((e) => e.type === "pinch-end")) && all;
  r = eng.update({ t: 99, hands: [mkHand("Right", 0.5, 0.5, PINCH_OFF + 0.02)] });
  all = t("open past OFF → pinch-end", r.events.some((e) => e.type === "pinch-end")) && all;
}

// 2 ── drag: pinch then move → pinch-move with growing dx
{
  const eng = new GestureEngine();
  eng.update({ t: 0, hands: [mkHand("Right", 0.3, 0.5, CLOSED)] });
  const r = eng.update({ t: 33, hands: [mkHand("Right", 0.42, 0.5, CLOSED)] });
  const mv = r.events.find((e) => e.type === "pinch-move");
  all = t("drag → pinch-move with dx>0", !!mv && mv.dx > 0.03) && all;
}

// 3 ── tap vs drag classification
{
  const eng = new GestureEngine();
  eng.update({ t: 0, hands: [mkHand("Right", 0.5, 0.5, CLOSED)] });
  const r = eng.update({ t: 120, hands: [mkHand("Right", 0.5, 0.5, OPEN)] });
  const end = r.events.find((e) => e.type === "pinch-end");
  all = t("quick still pinch → isTap", !!end && isTap(end)) && all;

  const eng2 = new GestureEngine();
  eng2.update({ t: 0, hands: [mkHand("Right", 0.3, 0.5, CLOSED)] });
  eng2.update({ t: 200, hands: [mkHand("Right", 0.6, 0.5, CLOSED)] }); // big travel
  const r2 = eng2.update({ t: 400, hands: [mkHand("Right", 0.6, 0.5, OPEN)] });
  const end2 = r2.events.find((e) => e.type === "pinch-end");
  all = t("long moving pinch → NOT a tap", !!end2 && !isTap(end2)) && all;
}

// 4 ── double-pinch fires within the window; a slow second pinch doesn't
{
  const eng = new GestureEngine();
  eng.update({ t: 0, hands: [mkHand("Right", 0.5, 0.5, CLOSED)] });
  eng.update({ t: 100, hands: [mkHand("Right", 0.5, 0.5, OPEN)] });
  const r = eng.update({ t: 250, hands: [mkHand("Right", 0.5, 0.5, CLOSED)] });
  all = t("fast re-pinch → double-pinch", r.events.some((e) => e.type === "double-pinch")) && all;

  const eng2 = new GestureEngine();
  eng2.update({ t: 0, hands: [mkHand("Right", 0.5, 0.5, CLOSED)] });
  eng2.update({ t: 100, hands: [mkHand("Right", 0.5, 0.5, OPEN)] });
  const r2 = eng2.update({
    t: 100 + DOUBLE_PINCH_MS + 400, // way past the window
    hands: [mkHand("Right", 0.5, 0.5, CLOSED)],
  });
  all = t("slow re-pinch → no double-pinch", !r2.events.some((e) => e.type === "double-pinch")) && all;
}

// 5 ── two-hand scale: both pinch, spread apart → ratio grows ≈ 2x
{
  const eng = new GestureEngine();
  eng.update({
    t: 0,
    hands: [mkHand("Left", 0.4, 0.5, CLOSED), mkHand("Right", 0.6, 0.5, CLOSED)],
  });
  // spread: 0.2 apart → 0.4 apart (let cursor EMA catch up over frames)
  let lastRatio = 0;
  for (let i = 1; i <= 14; i++) {
    const r = eng.update({
      t: i * 33,
      hands: [mkHand("Left", 0.3, 0.5, CLOSED), mkHand("Right", 0.7, 0.5, CLOSED)],
    });
    for (const e of r.events) if (e.type === "two-hand-scale") lastRatio = e.ratio;
  }
  all = t(`two-hand spread → scale ratio ~2 (got ${lastRatio.toFixed(2)})`, lastRatio > 1.6 && lastRatio < 2.4) && all;
  const rEnd = eng.update({ t: 600, hands: [mkHand("Left", 0.3, 0.5, OPEN), mkHand("Right", 0.7, 0.5, CLOSED)] });
  all = t("release one hand → scale-end", rEnd.events.some((e) => e.type === "two-hand-scale-end")) && all;
}

// 6 ── clap fires once, then the cooldown blocks an immediate repeat
{
  const eng = new GestureEngine();
  // approach: palms 0.5 apart → 0.3 → 0.08 over fast frames (open hands)
  eng.update({ t: 0, hands: [mkHand("Left", 0.25, 0.5, OPEN), mkHand("Right", 0.75, 0.5, OPEN)] });
  eng.update({ t: 100, hands: [mkHand("Left", 0.35, 0.5, OPEN), mkHand("Right", 0.65, 0.5, OPEN)] });
  const r = eng.update({ t: 200, hands: [mkHand("Left", 0.47, 0.5, OPEN), mkHand("Right", 0.53, 0.5, OPEN)] });
  const clapped = r.events.some((e) => e.type === "clap");
  all = t("palms rush together → clap", clapped) && all;
  // immediate re-clap inside cooldown → blocked
  eng.update({ t: 300, hands: [mkHand("Left", 0.3, 0.5, OPEN), mkHand("Right", 0.7, 0.5, OPEN)] });
  const r2 = eng.update({ t: 380, hands: [mkHand("Left", 0.47, 0.5, OPEN), mkHand("Right", 0.53, 0.5, OPEN)] });
  all = t("second clap inside cooldown → blocked", !r2.events.some((e) => e.type === "clap")) && all;
  all = t(`cooldown constant sane (${CLAP_COOLDOWN_MS}ms ≥ 800ms)`, CLAP_COOLDOWN_MS >= 800) && all;
}

// 7 ── swipe-left: open palm moving fast left for SWIPE_FRAMES frames;
//      a pinching hand must NEVER swipe (it's dragging)
{
  const eng = new GestureEngine();
  let fired = false;
  for (let i = 0; i <= SWIPE_FRAMES + 2; i++) {
    const x = 0.9 - i * 0.06; // fast leftward at ~1.8 units/sec @30fps
    const r = eng.update({ t: i * 33, hands: [mkHand("Right", x, 0.5, OPEN)] });
    if (r.events.some((e) => e.type === "swipe-left")) fired = true;
  }
  all = t("fast open-palm left → swipe-left", fired) && all;

  const eng2 = new GestureEngine();
  let firedPinching = false;
  for (let i = 0; i <= SWIPE_FRAMES + 2; i++) {
    const x = 0.9 - i * 0.06;
    const r = eng2.update({ t: i * 33, hands: [mkHand("Right", x, 0.5, CLOSED)] });
    if (r.events.some((e) => e.type === "swipe-left")) firedPinching = true;
  }
  all = t("pinching hand moving left → NO swipe (drag wins)", !firedPinching) && all;
}

// 8 ── hand vanishes mid-pinch → clean pinch-end (no stranded grab)
{
  const eng = new GestureEngine();
  eng.update({ t: 0, hands: [mkHand("Right", 0.5, 0.5, CLOSED)] });
  const r = eng.update({ t: 33, hands: [] });
  all = t("hand vanishes mid-pinch → pinch-end", r.events.some((e) => e.type === "pinch-end")) && all;
}

// 9 ── garbage in → never throws
{
  const eng = new GestureEngine();
  let threw = false;
  try {
    eng.update({ t: 0, hands: [] });
    eng.update({ t: 10, hands: [{ id: "Right", landmarks: [{ x: 0, y: 0 }] }] }); // <21 points
    eng.update({ t: 20, hands: [mkHand("Left", NaN, 0.5, OPEN)] });
    eng.reset();
    eng.update({ t: 30, hands: [mkHand("Right", 0.5, 0.5, CLOSED)] });
  } catch (e) {
    threw = true;
    console.log("   threw:", e?.message);
  }
  all = t("pathological frames → never throws", !threw) && all;
}

console.log(`\nJARVIS gestures: ${all ? "ALL PASSED" : "SOME FAILED"}`);
process.exit(all ? 0 : 1);
