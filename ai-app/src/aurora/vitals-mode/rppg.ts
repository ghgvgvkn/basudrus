/**
 * rppg.ts — remote photoplethysmography (rPPG) math for AI Vitals.
 *
 * Every heartbeat pushes blood through the face, which very slightly changes
 * how much light the skin reflects — most visibly in the GREEN channel. Sample
 * the mean green level of a face patch ~30×/sec for ~20s and the pulse shows
 * up as a periodic wave. Breathing modulates the same signal at a much lower
 * frequency. This module turns those raw samples into BPM / breaths-per-min
 * estimates with an honest confidence score.
 *
 * Pure + deterministic (no DOM, no Date.now) so it's unit-testable —
 * mirrored by scripts/tests/vitals-rppg.test.mjs, same convention as
 * repCounter/gestures. IMPORTANT: this is a wellness ESTIMATE, not a medical
 * measurement; the UI must say so.
 *
 * Pipeline per estimate():
 *   1. resample the (jittery rAF-timed) samples onto a uniform 30 Hz grid
 *   2. HEART: subtract a 0.8s moving average (detrend), Hamming window, then
 *      scan 42–180 BPM with a Goertzel-style DFT; peak power vs band mean
 *      = confidence.
 *   3. BREATHING: the 0.8s moving-average trace IS the low-frequency
 *      baseline; detrend it with an 8s average and scan 6–30 breaths/min.
 */

export interface VitalsEstimate {
  /** Estimated heart rate, or null while confidence is too low. */
  bpm: number | null;
  /** Estimated breaths per minute, or null while confidence is too low. */
  brpm: number | null;
  /** Peak-to-band power ratio for the heart band (lock needs ≥ HR_RATIO_LOCK). */
  bpmConfidence: number;
  /** Spectral concentration around the peak (lock needs ≥ HR_FRAC_LOCK).
   *  Exposed so UIs can show an HONEST progress bar: min(ratio/RATIO,
   *  frac/FRAC) — a full bar means an actual lock, not almost-forever. */
  bpmFrac: number;
  /** Seconds of signal currently buffered. */
  seconds: number;
}

const FS = 30; // uniform resample rate (Hz)
const BUFFER_S = 30; // keep at most 30s of samples
const MIN_HR_S = 8; // need ≥8s before estimating heart rate
const MIN_BR_S = 18; // breathing is slower — need ≥18s
export const HR_MIN_BPM = 42;
export const HR_MAX_BPM = 180;
export const BR_MIN_BRPM = 6;
export const BR_MAX_BRPM = 30;
// Heart-rate lock = TWO conditions, both measured empirically (120 noise
// seeds vs 84 synthetic pulses in the mirrored unit test):
//   ratio — peak power / band mean. Noise medians ~4.9 (ln N extreme-value)
//           but its tail reaches ~9, so ratio ALONE cannot separate.
//   frac  — fraction of band energy within ±3bpm of the peak. This is the
//           real discriminator: a pulse CONCENTRATES energy (real min ≈ 0.91)
//           while noise SPREADS it (noise max ≈ 0.39). Lock at 0.5 sits in
//           the gulf between them: 0/120 noise locks, 84/84 real locks.
export const HR_RATIO_LOCK = 5.5;
export const HR_FRAC_LOCK = 0.5;
export const BR_CONF_LOCK = 6;

/** Centered moving average; window in SAMPLES (odd works best). */
function movingAverage(x: number[], win: number): number[] {
  const n = x.length;
  const half = Math.floor(win / 2);
  const out = new Array<number>(n);
  let sum = 0;
  // prefix sums for O(n)
  const prefix = new Array<number>(n + 1);
  prefix[0] = 0;
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + x[i];
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - half);
    const b = Math.min(n - 1, i + half);
    sum = prefix[b + 1] - prefix[a];
    out[i] = sum / (b - a + 1);
  }
  return out;
}

/** Power of a single frequency via Goertzel-style direct DFT. */
function bandPower(x: number[], fs: number, hz: number): number {
  let re = 0;
  let im = 0;
  const w = (2 * Math.PI * hz) / fs;
  for (let n = 0; n < x.length; n++) {
    re += x[n] * Math.cos(w * n);
    im -= x[n] * Math.sin(w * n);
  }
  return re * re + im * im;
}

/** Scan a frequency band. Returns the winning frequency, the peak/mean
 *  ratio, and `frac` — the share of band energy inside ±3 bins of the peak
 *  (the concentration discriminator; see the lock-threshold comment). */
function scanBand(
  x: number[],
  fs: number,
  loHz: number,
  hiHz: number,
  stepHz: number,
): { hz: number; ratio: number; frac: number } {
  const powers: number[] = [];
  const freqs: number[] = [];
  for (let f = loHz; f <= hiHz + 1e-9; f += stepHz) {
    powers.push(bandPower(x, fs, f));
    freqs.push(f);
  }
  let bi = 0;
  let total = 0;
  for (let i = 0; i < powers.length; i++) {
    total += powers[i];
    if (powers[i] > powers[bi]) bi = i;
  }
  const mean = total / Math.max(1, powers.length);
  let peakRegion = 0;
  for (let i = Math.max(0, bi - 3); i <= Math.min(powers.length - 1, bi + 3); i++) {
    peakRegion += powers[i];
  }
  return {
    hz: freqs[bi] ?? loHz,
    ratio: mean > 0 ? powers[bi] / mean : 0,
    frac: total > 0 ? peakRegion / total : 0,
  };
}

export class RppgEngine {
  private t: number[] = [];
  private g: number[] = [];

  /** Add one mean-green sample stamped in ms (performance.now()). */
  addSample(green: number, tMs: number): void {
    if (!Number.isFinite(green) || !Number.isFinite(tMs)) return;
    // enforce monotonic time (a re-mounted rAF can replay a stale stamp)
    const last = this.t[this.t.length - 1];
    if (last != null && tMs <= last) return;
    this.t.push(tMs);
    this.g.push(green);
    // trim to the buffer window
    const cutoff = tMs - BUFFER_S * 1000;
    let drop = 0;
    while (drop < this.t.length && this.t[drop] < cutoff) drop++;
    if (drop > 0) {
      this.t.splice(0, drop);
      this.g.splice(0, drop);
    }
  }

  /** Wipe the buffer (user moved, lighting changed, restart pressed). */
  reset(): void {
    this.t = [];
    this.g = [];
  }

  get seconds(): number {
    if (this.t.length < 2) return 0;
    return (this.t[this.t.length - 1] - this.t[0]) / 1000;
  }

  estimate(): VitalsEstimate {
    const secs = this.seconds;
    const out: VitalsEstimate = { bpm: null, brpm: null, bpmConfidence: 0, bpmFrac: 0, seconds: secs };
    if (secs < MIN_HR_S || this.t.length < FS * MIN_HR_S * 0.5) return out;

    // 1 ── uniform resample (linear interpolation onto a 30 Hz grid)
    const t0 = this.t[0];
    const n = Math.floor(secs * FS);
    const u = new Array<number>(n);
    let j = 0;
    for (let i = 0; i < n; i++) {
      const tt = t0 + (i * 1000) / FS;
      while (j < this.t.length - 2 && this.t[j + 1] < tt) j++;
      const t1 = this.t[j];
      const t2 = this.t[j + 1];
      const a = t2 > t1 ? (tt - t1) / (t2 - t1) : 0;
      u[i] = this.g[j] + (this.g[j + 1] - this.g[j]) * Math.max(0, Math.min(1, a));
    }

    // 2 ── HEART: detrend with a 0.8s moving average, Hamming window, scan.
    const lf = movingAverage(u, Math.round(FS * 0.8) | 1);
    const hp = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      const w = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (n - 1)); // Hamming
      hp[i] = (u[i] - lf[i]) * w;
    }
    // Use the freshest 15s for HR — old samples blur a changing pulse.
    const hrWin = hp.slice(Math.max(0, n - FS * 15));
    const hr = scanBand(hrWin, FS, HR_MIN_BPM / 60, HR_MAX_BPM / 60, 1 / 60);
    out.bpmConfidence = hr.ratio;
    out.bpmFrac = hr.frac;
    if (hr.ratio >= HR_RATIO_LOCK && hr.frac >= HR_FRAC_LOCK) out.bpm = Math.round(hr.hz * 60);

    // 3 ── BREATHING: the LF baseline itself, detrended over 8s, scanned low.
    if (secs >= MIN_BR_S) {
      const base = movingAverage(lf, Math.round(FS * 8) | 1);
      const br = new Array<number>(n);
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
