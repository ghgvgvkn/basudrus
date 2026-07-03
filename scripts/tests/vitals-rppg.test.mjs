/**
 * vitals-rppg.test.mjs — proves the AI Vitals heart/breathing math.
 *
 * MIRRORS the pure logic in ai-app/src/aurora/vitals-mode/rppg.ts
 * (same convention as exercise-rep-counter.test.mjs mirroring repCounter.ts).
 * Keep the constants here in sync with the source if you tune them.
 *
 * Run: node scripts/tests/vitals-rppg.test.mjs
 */

// ── mirror of rppg.ts ──
const FS = 30;
const BUFFER_S = 30;
const MIN_HR_S = 8;
const MIN_BR_S = 18;
const HR_MIN_BPM = 42;
const HR_MAX_BPM = 180;
const BR_MIN_BRPM = 6;
const BR_MAX_BRPM = 30;
// See rppg.ts: the HR lock is TWO conditions. ratio alone can't separate
// (noise tail reaches ~9); frac — the share of band energy within ±3bpm of
// the peak — is the discriminator (noise max ≈0.39, real min ≈0.91).
const HR_RATIO_LOCK = 5.5;
const HR_FRAC_LOCK = 0.5;
const BR_CONF_LOCK = 6;

function movingAverage(x, win) {
  const n = x.length;
  const half = Math.floor(win / 2);
  const out = new Array(n);
  const prefix = new Array(n + 1);
  prefix[0] = 0;
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + x[i];
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - half);
    const b = Math.min(n - 1, i + half);
    out[i] = (prefix[b + 1] - prefix[a]) / (b - a + 1);
  }
  return out;
}

function bandPower(x, fs, hz) {
  let re = 0, im = 0;
  const w = (2 * Math.PI * hz) / fs;
  for (let n = 0; n < x.length; n++) {
    re += x[n] * Math.cos(w * n);
    im -= x[n] * Math.sin(w * n);
  }
  return re * re + im * im;
}

function scanBand(x, fs, loHz, hiHz, stepHz) {
  const powers = [], freqs = [];
  for (let f = loHz; f <= hiHz + 1e-9; f += stepHz) {
    powers.push(bandPower(x, fs, f));
    freqs.push(f);
  }
  let bi = 0, total = 0;
  for (let i = 0; i < powers.length; i++) {
    total += powers[i];
    if (powers[i] > powers[bi]) bi = i;
  }
  const mean = total / Math.max(1, powers.length);
  let peakRegion = 0;
  for (let i = Math.max(0, bi - 3); i <= Math.min(powers.length - 1, bi + 3); i++) peakRegion += powers[i];
  return {
    hz: freqs[bi] ?? loHz,
    ratio: mean > 0 ? powers[bi] / mean : 0,
    frac: total > 0 ? peakRegion / total : 0,
  };
}

class RppgEngine {
  constructor() { this.t = []; this.g = []; }
  addSample(green, tMs) {
    if (!Number.isFinite(green) || !Number.isFinite(tMs)) return;
    const last = this.t[this.t.length - 1];
    if (last != null && tMs <= last) return;
    this.t.push(tMs); this.g.push(green);
    const cutoff = tMs - BUFFER_S * 1000;
    let drop = 0;
    while (drop < this.t.length && this.t[drop] < cutoff) drop++;
    if (drop > 0) { this.t.splice(0, drop); this.g.splice(0, drop); }
  }
  reset() { this.t = []; this.g = []; }
  get seconds() {
    if (this.t.length < 2) return 0;
    return (this.t[this.t.length - 1] - this.t[0]) / 1000;
  }
  estimate() {
    const secs = this.seconds;
    const out = { bpm: null, brpm: null, bpmConfidence: 0, bpmFrac: 0, seconds: secs };
    if (secs < MIN_HR_S || this.t.length < FS * MIN_HR_S * 0.5) return out;
    const t0 = this.t[0];
    const n = Math.floor(secs * FS);
    const u = new Array(n);
    let j = 0;
    for (let i = 0; i < n; i++) {
      const tt = t0 + (i * 1000) / FS;
      while (j < this.t.length - 2 && this.t[j + 1] < tt) j++;
      const t1 = this.t[j], t2 = this.t[j + 1];
      const a = t2 > t1 ? (tt - t1) / (t2 - t1) : 0;
      u[i] = this.g[j] + (this.g[j + 1] - this.g[j]) * Math.max(0, Math.min(1, a));
    }
    const lf = movingAverage(u, Math.round(FS * 0.8) | 1);
    const hp = new Array(n);
    for (let i = 0; i < n; i++) {
      const w = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (n - 1));
      hp[i] = (u[i] - lf[i]) * w;
    }
    const hrWin = hp.slice(Math.max(0, n - FS * 15));
    const hr = scanBand(hrWin, FS, HR_MIN_BPM / 60, HR_MAX_BPM / 60, 1 / 60);
    out.bpmConfidence = hr.ratio;
    out.bpmFrac = hr.frac;
    if (hr.ratio >= HR_RATIO_LOCK && hr.frac >= HR_FRAC_LOCK) out.bpm = Math.round(hr.hz * 60);
    if (secs >= MIN_BR_S) {
      const base = movingAverage(lf, Math.round(FS * 8) | 1);
      const br = new Array(n);
      for (let i = 0; i < n; i++) {
        const w = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (n - 1));
        br[i] = (lf[i] - base[i]) * w;
      }
      const rr = scanBand(br, FS, BR_MIN_BRPM / 60, BR_MAX_BRPM / 60, 0.25 / 60);
      if (rr.ratio >= BR_CONF_LOCK) out.brpm = Math.round(rr.hz * 60);
    }
    return out;
  }
}

// ── deterministic pseudo-noise (no Math.random — reproducible runs) ──
function makeNoise(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648 - 0.5;
  };
}

// ── tiny harness ──
let failures = 0;
function check(name, ok) {
  console.log(`${ok ? "✅" : "❌"} ${name}`);
  if (!ok) failures++;
}

// 1) clean 72 BPM pulse (+ drift + noise) over 22s → estimate within ±3
{
  const eng = new RppgEngine();
  const noise = makeNoise(42);
  const HR = 72 / 60; // Hz
  const BR = 15 / 60; // Hz breathing baseline wobble
  for (let i = 0; i < 22 * 30; i++) {
    const t = (i * 1000) / 30;
    const s =
      128 +
      1.2 * Math.sin(2 * Math.PI * HR * (t / 1000)) + // pulse
      3.0 * Math.sin(2 * Math.PI * BR * (t / 1000)) + // breathing baseline
      0.02 * (t / 1000) * 3 + // slow lighting drift
      0.5 * noise(); // sensor noise
    eng.addSample(s, t);
  }
  const e = eng.estimate();
  check(`72bpm sine detected (got ${e.bpm}, conf ${e.bpmConfidence.toFixed(1)})`, e.bpm !== null && Math.abs(e.bpm - 72) <= 3);
  check(`breathing ~15/min detected (got ${e.brpm})`, e.brpm !== null && Math.abs(e.brpm - 15) <= 2);
}

// 2) a different rate — 110 BPM — still tracks
{
  const eng = new RppgEngine();
  const noise = makeNoise(7);
  for (let i = 0; i < 20 * 30; i++) {
    const t = (i * 1000) / 30;
    eng.addSample(128 + 1.0 * Math.sin(2 * Math.PI * (110 / 60) * (t / 1000)) + 0.4 * noise(), t);
  }
  const e = eng.estimate();
  check(`110bpm sine detected (got ${e.bpm})`, e.bpm !== null && Math.abs(e.bpm - 110) <= 3);
}

// 3) pure noise → NO lock, for heart NOR breathing (honesty: junk in, null out).
//    Run several seeds — noise max/mean sits near ln(bins)≈4.9, so the lock
//    thresholds must clear it every time.
{
  let anyLock = false;
  for (const seed of [1234, 99, 2718, 31415, 8, 7919, 55, 4242, 606, 13, 777, 90210]) {
    const eng = new RppgEngine();
    const noise = makeNoise(seed);
    for (let i = 0; i < 22 * 30; i++) {
      eng.addSample(128 + 6 * noise(), (i * 1000) / 30);
    }
    const e = eng.estimate();
    if (e.bpm !== null || e.brpm !== null) anyLock = true;
  }
  check("pure noise never locks heart OR breathing (12 seeds)", !anyLock);
}

// 4) too little data → null (needs ≥10s)
{
  const eng = new RppgEngine();
  for (let i = 0; i < 5 * 30; i++) {
    eng.addSample(128 + Math.sin(2 * Math.PI * 1.2 * (i / 30)), (i * 1000) / 30);
  }
  const e = eng.estimate();
  check("under 10s of data → no estimate", e.bpm === null && e.brpm === null);
}

// 5) buffer trims to 30s and stays monotonic
{
  const eng = new RppgEngine();
  for (let i = 0; i < 45 * 30; i++) eng.addSample(128, (i * 1000) / 30);
  check(`buffer capped near ${BUFFER_S}s (got ${eng.seconds.toFixed(1)}s)`, eng.seconds <= BUFFER_S + 0.5);
  eng.addSample(128, 0); // stale timestamp must be ignored
  check("stale timestamps ignored", eng.seconds <= BUFFER_S + 0.5);
}

// 6) reset clears everything
{
  const eng = new RppgEngine();
  for (let i = 0; i < 12 * 30; i++) eng.addSample(128, (i * 1000) / 30);
  eng.reset();
  check("reset() empties the buffer", eng.seconds === 0 && eng.estimate().bpm === null);
}

// 7) REALISTIC conditions — the founder's field failure, reproduced + fixed.
//    A real heart WANDERS (HRV ±4bpm) and a desk monitor flickers light onto
//    the face. CHROMINANCE sampling (g-(r+b)/2) leaks only ~25% of that
//    flicker → must LOCK; RAW GREEN leaks 100% + dilutes the pulse → must
//    correctly REFUSE to lock (that refusal is what the founder saw).
{
  function simulate(seed, pulseAmp, flickerLeak, bpm0) {
    const noise = makeNoise(seed), jit = makeNoise(seed * 31 + 7), flick = makeNoise(seed * 17 + 3);
    const eng = new RppgEngine();
    let f = bpm0 / 60, phase = 0, flicker = 0;
    for (let i = 0; i < 22 * 30; i++) {
      const t = i / 30;
      f += jit() * 0.004;
      f = Math.max((bpm0 - 4) / 60, Math.min((bpm0 + 4) / 60, f));
      phase += (2 * Math.PI * f) / 30;
      flicker = flicker * 0.96 + flick() * 1.4;
      eng.addSample(
        128 + pulseAmp * Math.sin(phase) + 2.2 * Math.sin(2 * Math.PI * 0.25 * t) + flickerLeak * flicker + 0.55 * noise(),
        (i * 1000) / 30,
      );
    }
    return eng.estimate();
  }
  let chromLocks = 0, chromRight = 0, rawLocks = 0;
  for (let seed = 1; seed <= 8; seed++) {
    const c = simulate(seed * 1013 + 9, 0.9, 0.25, 72); // chrominance conditions
    if (c.bpm !== null) { chromLocks++; if (Math.abs(c.bpm - 72) <= 5) chromRight++; }
    const r = simulate(seed * 1013 + 9, 0.35, 1.0, 72); // raw-green + diluted patch
    if (r.bpm !== null) rawLocks++;
  }
  check(`realistic HRV+flicker: chrominance locks (${chromLocks}/8, right ${chromRight})`, chromLocks >= 7 && chromRight === chromLocks);
  check(`realistic flicker: raw-green diluted correctly refuses (${rawLocks}/8 locked)`, rawLocks <= 1);
}

if (failures > 0) {
  console.error(`\nvitals-rppg: ${failures} test(s) FAILED`);
  process.exit(1);
}
console.log("\nvitals-rppg: all tests passed");
