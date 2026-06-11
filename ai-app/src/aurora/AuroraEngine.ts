/**
 * AuroraEngine — TypeScript port of the dot-matrix canvas universe
 * from the Aurora AI design (design/Aurora-AI.html).
 *
 * Same visual behavior, refactored into a standalone class so it
 * mounts/unmounts cleanly inside a React component lifecycle.
 *
 * Visual states:
 *   - idle      : ambient breathing dot grid + ghost sparkles
 *   - forming   : dots stagger inward in a swirling 360° sweep
 *   - orb       : rotating 3D sphere with inner counter-rotating ring
 *                 and 2-3 planet satellites orbiting outside
 *   - returning : dots flow back to their grid home
 *
 * Public API (imperative — call from React refs / event handlers):
 *   - activate()        : idle → forming → orb
 *   - deactivate()      : orb → returning → idle
 *   - toggle()
 *   - pulse(x, y, amp)  : stereo wave from a point (used on user actions)
 *   - pulseFromAll(amp) : waves from all four edges simultaneously
 *   - spark(x, y, n)    : brief sparkle burst (used on send)
 *   - state()           : current mode
 *   - destroy()         : cleanup (removes resize handler, stops RAF)
 *
 * Body classes the engine reads from (driven by React component):
 *   - "active"     : voice mode on
 *   - "typing"     : composer is focused — calms the dot field
 *   - "focus-mode" : entered after first send — shrinks + dims the field
 */

export type AuroraMode = "idle" | "forming" | "orb" | "returning";

interface Pulse {
  x: number;
  y: number;
  born: number;
  ttl: number;
  amp: number;
}

interface Ghost {
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
  ttl: number;
  r: number;
  ambient?: boolean;
}

interface Planet {
  angle: number;
  speed: number;
  dist: number;
  r: number;
  alpha: number;
  ringRot: number;
  tilt: number;
  hasRing?: boolean;
}

/**
 * Dot tint — the color category each particle belongs to. Was just
 * "tint" (=pink) | "white", but the founder asked for the Google
 * Antigravity-inspired multi-color particle look — added cyan,
 * purple, and gold so the dot field has the same colorful-confetti
 * energy as the reference. Each tint maps to a fill+shadow color
 * pair in the DOT_TINTS table below.
 */
type DotTint = "white" | "pink" | "cyan" | "purple" | "gold";

interface Dot {
  hx: number;
  hy: number;
  phase: number;
  speed: number;
  delay: number;
  inTemp: boolean;
  inSub: boolean;
  isText: boolean;
  sx: number;
  sy: number;
  sz: number;
  R: number;
  swirl: number;
  tint: DotTint;
  life: number;
  lifeTarget: number;
  lifeNext: number;
}

/**
 * Color palette for dot tints. fill is the base rgb (alpha appended
 * by the renderer per-frame); shadow is the glow color. Picked to
 * sit naturally against the dark void background — none of them
 * are pure-saturated so the field reads as a unified palette
 * instead of a Skittles bag.
 */
const DOT_TINTS: Record<DotTint, { fill: string; shadow: string }> = {
  white:  { fill: "255,255,255", shadow: "rgba(255,255,255,0.9)" },
  pink:   { fill: "255,210,225", shadow: "rgba(255,180,210,0.9)" },
  cyan:   { fill: "180,225,255", shadow: "rgba(140,200,255,0.95)" },
  purple: { fill: "220,200,255", shadow: "rgba(180,150,255,0.9)" },
  gold:   { fill: "255,230,170", shadow: "rgba(255,200,120,0.9)" },
};

/**
 * Light-theme twin of DOT_TINTS — the founder's "white website,
 * yellow dot" ask. On the warm-white daylight background the field
 * flips polarity: the bulk tint becomes deep GOLD (dark enough to
 * read on white) and the punctuation tints become warm siblings
 * (burnt orange / bronze / violet / bright amber). Same keys, so a
 * dot keeps its tint category across theme switches and only the
 * lookup table swaps.
 */
const DOT_TINTS_LIGHT: Record<DotTint, { fill: string; shadow: string }> = {
  white:  { fill: "176,108,10",  shadow: "rgba(245,158,11,0.55)" },
  pink:   { fill: "194,65,12",   shadow: "rgba(234,88,12,0.50)" },
  cyan:   { fill: "146,64,14",   shadow: "rgba(180,83,9,0.50)" },
  purple: { fill: "109,40,217",  shadow: "rgba(139,92,246,0.45)" },
  gold:   { fill: "217,119,6",   shadow: "rgba(245,158,11,0.65)" },
};

/**
 * Frost-theme table — "Frosted Silicon", the optional cool lab look.
 * Polar blue-white canvas, so the field goes steel-blue with cobalt
 * and rare aerospace-orange punctuation.
 */
const DOT_TINTS_FROST: Record<DotTint, { fill: string; shadow: string }> = {
  white:  { fill: "30,58,112",   shadow: "rgba(0,82,255,0.45)" },
  pink:   { fill: "204,72,0",    shadow: "rgba(255,90,0,0.45)" },
  cyan:   { fill: "12,74,170",   shadow: "rgba(0,82,255,0.50)" },
  purple: { fill: "91,33,182",   shadow: "rgba(139,92,246,0.45)" },
  gold:   { fill: "0,82,255",    shadow: "rgba(59,130,246,0.60)" },
};

export type AuroraTheme = "dark" | "light" | "frost";

const THEME_TINTS: Record<AuroraTheme, Record<DotTint, { fill: string; shadow: string }>> = {
  dark: DOT_TINTS,
  light: DOT_TINTS_LIGHT,
  frost: DOT_TINTS_FROST,
};

/**
 * Non-dot accent colors (orb halo, ghost dots, inner rings, planet
 * satellites) per theme. One lookup per frame keeps the render loop
 * branch-free across all three themes.
 */
const THEME_FX: Record<AuroraTheme, {
  halo0: string; halo0A: number; halo1: string; halo1A: number;
  ghost: string; ghostShadow: string;
  ring1: string; ring1Shadow: string;
  ring2: string; ring2Shadow: string;
  planet: string; planetShadow: string;
}> = {
  dark: {
    halo0: "200,180,255", halo0A: 0.10, halo1: "255,138,166", halo1A: 0.05,
    ghost: "255,255,255", ghostShadow: "rgba(255,255,255,0.6)",
    ring1: "255,220,235", ring1Shadow: "rgba(255,210,225,0.9)",
    ring2: "220,210,255", ring2Shadow: "rgba(196,184,255,0.9)",
    planet: "255,220,235", planetShadow: "rgba(255,210,225,0.85)",
  },
  light: {
    halo0: "245,158,11", halo0A: 0.08, halo1: "217,119,6", halo1A: 0.04,
    ghost: "176,108,10", ghostShadow: "rgba(217,119,6,0.5)",
    ring1: "194,65,12", ring1Shadow: "rgba(217,119,6,0.6)",
    ring2: "109,40,217", ring2Shadow: "rgba(139,92,246,0.5)",
    planet: "176,108,10", planetShadow: "rgba(217,119,6,0.55)",
  },
  frost: {
    halo0: "59,130,246", halo0A: 0.08, halo1: "0,82,255", halo1A: 0.04,
    ghost: "30,58,112", ghostShadow: "rgba(0,82,255,0.45)",
    ring1: "204,72,0", ring1Shadow: "rgba(255,90,0,0.5)",
    ring2: "91,33,182", ring2Shadow: "rgba(139,92,246,0.5)",
    planet: "30,58,112", planetShadow: "rgba(0,82,255,0.5)",
  },
};

/**
 * Weighted random tint picker. Most dots are white (the field
 * should read as a coherent grid first, with colored "punctuation"
 * second). Total weights = 100 for easy mental math:
 *   85% white  — bulk of the field
 *   4%  pink   — preserves the original tint accent
 *   4%  cyan   — ties into the JARVIS HUD palette
 *   4%  purple — Antigravity-style accent
 *   3%  gold   — rare warm punctuation
 */
function pickTint(): DotTint {
  const r = Math.random() * 100;
  if (r < 85) return "white";
  if (r < 89) return "pink";
  if (r < 93) return "cyan";
  if (r < 97) return "purple";
  return "gold";
}

// Performance + design knobs.
//
// History:
//   - Original ambient field had a glow halo + random sparkles +
//     full dot density at SPACING=18. Looked good but ate frame
//     budget on weak laptops.
//   - First attempt cut it to corners-only with smaller dots. User
//     pushback: "return back the dots but remove the glory things."
//   - Current: full grid back (SPACING=18) — but with zero glow
//     (GLOW_BG=0) and no ambient sparkles. That keeps the visual
//     the founder wants (plain dot matrix everywhere) while still
//     being very light on hardware, because shadowBlur (the "glow")
//     is by far the most expensive op in 2D canvas, and the random
//     sparkles were spawning every 70ms.
const SPACING = 18;
const DOT_R_AMB = 1.0;
const DOT_R_ORB = 2.6;
const ALPHA_AMB = 0.16;
// GLOW_BG=0 disables the ambient glow halo around every dot.
//
// GLOW_ORB cut from 14→7. Founder reported voice-mode lag on an
// M2 MacBook Air — that's a fast machine, so the lag is real, not
// perceived. shadowBlur is expensive per dot per frame; halving
// the value cuts the per-dot cost dramatically. Visually the glow
// is still very present at 7 — the difference is barely visible
// but the frame-budget impact is huge with ~4000 dots in the field.
const GLOW_BG = 0;
const GLOW_ORB = 7;
const TRANSITION_MS = 1800;

// In sphere mode, only apply the expensive shadowBlur to the
// FRONT-FACING half of the sphere. Back-facing dots are dimmer
// anyway (low alpha) — the glow on them is barely visible but
// the cost is identical. Skipping shadow on back-facing dots
// roughly halves the per-frame shadow-blur work in orb mode.
const SPHERE_GLOW_FRONT_THRESHOLD = 0.45;

// Inner counter-rotating ring segment count. Halved 64→32: at
// the rendered size the ring still looks smooth, and we save
// 32 expensive ctx.arc + shadowBlur calls per frame.
const INNER_RING_SEGMENTS = 32;
// Note: DOT_R_TEXT and GLOW_TEXT existed in the original design's
// text-mask system (rendering "23°" as dot clusters on the field).
// The mask system was removed in the React port — Aurora's text
// labels render via DOM, not by sampling masks against dots — so
// those constants are gone here. The corresponding mask-test branches
// in the render loop have been stripped too.

const easeInOut = (t: number): number =>
  t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

export class AuroraEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private W = 0;
  private H = 0;
  private DPR = 1;
  private dots: Dot[] = [];
  private mode: AuroraMode = "idle";
  private transitionStart = 0;
  private pulses: Pulse[] = [];
  private ghosts: Ghost[] = [];
  private planets: Planet[] = [];
  private rafId = 0;
  private resizeHandler: () => void;
  private visibilityHandler: () => void;
  private startTime = performance.now();
  private destroyed = false;
  /** When true the rAF loop returns immediately without drawing.
   *  Flipped by the visibilitychange listener so a backgrounded tab
   *  doesn't paint 4000 dots every frame. Browsers throttle rAF in
   *  hidden tabs anyway, but Chrome's throttle still fires once per
   *  second — multiplied by an orb mode that draws thousands of
   *  dots that's still wasted CPU we can skip entirely. */
  private paused = false;
  /** External pause (suspend()) — held separately from the hidden-tab
   *  pause so a tab-switch while suspended can't accidentally resume. */
  private suspended = false;

  /** Active color theme. "dark" = original void palette; "light" =
   *  Stark Daylight (white site, gold dots); "frost" = Frosted
   *  Silicon (polar white, cobalt dots). Swapped live via setTheme()
   *  — dots keep their tint categories, only the color tables
   *  change, so a theme flip costs nothing per frame. */
  private theme: AuroraTheme = "dark";

  // Frame-rate throttling so the canvas doesn't burn 144 Hz on a
  // gaming monitor when the visuals only need 30 fps to look smooth.
  // lastFrameDrawAt tracks the most recent FULL render; in idle mode
  // we skip frames that arrive sooner than IDLE_MIN_FRAME_MS apart.
  // Voice / forming / orb modes render at full rate because the
  // 3D-ish sphere actually benefits from smoothness — but the orb
  // is short-lived per session so the cost is contained.
  private lastFrameDrawAt = 0;
  private readonly IDLE_MIN_FRAME_MS = 33; // ~30 fps in idle

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) throw new Error("AuroraEngine: 2D context unavailable");
    this.ctx = ctx;
    this.resizeHandler = () => this.resize();
    this.visibilityHandler = () => {
      this.paused = document.hidden || this.suspended;
      // When un-hiding, schedule the next frame immediately so the
      // orb resumes smoothly. The frame loop will short-circuit while
      // paused; resuming just means it picks up at the next tick.
      if (!this.paused) {
        this.lastFrameDrawAt = 0;
        if (!this.rafId) this.rafId = requestAnimationFrame((t) => this.frame(t));
      }
    };
    this.resize();
    window.addEventListener("resize", this.resizeHandler);
    document.addEventListener("visibilitychange", this.visibilityHandler);
    this.rafId = requestAnimationFrame((t) => this.frame(t));
  }

  // ── Public imperative API ─────────────────────────────────────────

  activate(): void {
    if (this.mode === "forming" || this.mode === "orb") return;
    this.mode = "forming";
    this.transitionStart = performance.now();
    document.body.classList.add("aurora-active");
    this.pulses.push({
      x: this.W / 2,
      y: this.H / 2,
      born: performance.now(),
      ttl: 1800,
      amp: 1,
    });
  }

  deactivate(): void {
    if (this.mode === "idle" || this.mode === "returning") return;
    this.mode = "returning";
    this.transitionStart = performance.now();
    document.body.classList.remove("aurora-active");
    this.pulses.push({
      x: this.W / 2,
      y: this.H / 2,
      born: performance.now(),
      ttl: 1400,
      amp: 0.5,
    });
  }

  toggle(): void {
    if (this.mode === "orb" || this.mode === "forming") this.deactivate();
    else this.activate();
  }

  /** Externally pause/resume the render loop. Used while JARVIS camera
   *  mode covers the screen: the canvas sits at opacity 0 there but
   *  would otherwise keep painting ~4000 dots per frame at full orb
   *  rate — on the same weak GPU the hand tracker needs. Same
   *  machinery as the hidden-tab pause. */
  suspend(on: boolean): void {
    if (this.destroyed) return;
    this.suspended = on;
    this.paused = on || document.hidden;
    if (!this.paused) {
      this.lastFrameDrawAt = 0;
      if (!this.rafId) this.rafId = requestAnimationFrame((t) => this.frame(t));
    }
  }

  /** Emit two waves from a point (the second slightly delayed for depth).
   *  Used on user-initiated events (send, conversation pick, etc.). */
  pulse(x?: number, y?: number, amp = 0.7): void {
    const cx = x ?? this.W / 2;
    const cy = y ?? this.H / 2;
    const now = performance.now();
    this.pulses.push({ x: cx, y: cy, born: now, ttl: 1300, amp });
    this.pulses.push({ x: cx, y: cy, born: now + 60, ttl: 1300, amp: amp * 0.85 });
  }

  /** Emit waves inward from all four edges of the viewport simultaneously.
   *  Used on send + on AI reply landing. */
  pulseFromAll(amp = 0.55): void {
    const now = performance.now();
    const points = [
      { x: this.W * 0.5, y: -20 },
      { x: this.W * 0.5, y: this.H + 20 },
      { x: -20, y: this.H * 0.5 },
      { x: this.W + 20, y: this.H * 0.5 },
    ];
    for (const p of points) {
      this.pulses.push({ x: p.x, y: p.y, born: now, ttl: 1400, amp });
    }
  }

  /** Brief sparkle burst near a point. */
  spark(x?: number, y?: number, count = 14): void {
    const cx = x ?? this.W / 2;
    const cy = y ?? this.H / 2;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = 4 + Math.random() * 24;
      this.ghosts.push({
        x: cx + Math.cos(a) * d,
        y: cy + Math.sin(a) * d,
        vx: Math.cos(a) * (0.5 + Math.random() * 1.5),
        vy: Math.sin(a) * (0.5 + Math.random() * 1.5),
        born: performance.now(),
        ttl: 900 + Math.random() * 600,
        r: 1.6 + Math.random() * 1.8,
      });
    }
  }

  state(): AuroraMode {
    return this.mode;
  }

  setTheme(theme: AuroraTheme): void {
    this.theme = theme;
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.rafId);
    window.removeEventListener("resize", this.resizeHandler);
    document.removeEventListener("visibilitychange", this.visibilityHandler);
    document.body.classList.remove("aurora-active");
    document.body.classList.remove("aurora-typing");
    document.body.classList.remove("aurora-focus-mode");
  }

  // ── Internal ──────────────────────────────────────────────────────

  private resize(): void {
    this.DPR = Math.min(window.devicePixelRatio || 1, 2);
    this.W = window.innerWidth;
    this.H = window.innerHeight;
    this.canvas.width = Math.floor(this.W * this.DPR);
    this.canvas.height = Math.floor(this.H * this.DPR);
    this.canvas.style.width = this.W + "px";
    this.canvas.style.height = this.H + "px";
    this.ctx.setTransform(this.DPR, 0, 0, this.DPR, 0, 0);
    this.buildDots();
    this.buildPlanets();
  }

  private buildDots(): void {
    this.dots = [];
    const cols = Math.ceil(this.W / SPACING) + 2;
    const rows = Math.ceil(this.H / SPACING) + 2;
    for (let r = -1; r < rows; r++) {
      const xOff = r % 2 === 0 ? 0 : SPACING * 0.5;
      for (let c = -1; c < cols; c++) {
        const x = c * SPACING + xOff;
        const y = r * SPACING;
        this.dots.push({
          hx: x,
          hy: y,
          phase: Math.random() * Math.PI * 2,
          speed: 0.4 + Math.random() * 0.7,
          delay: 0,
          inTemp: false,
          inSub: false,
          isText: false,
          sx: 0,
          sy: 0,
          sz: 0,
          R: 0,
          swirl: Math.random() * 2 - 1,
          tint: pickTint(),
          life: 1,
          lifeTarget: 1,
          lifeNext: 0,
        });
      }
    }
    this.assignSphereTargets();
    this.assignStagger();
  }

  /** Fibonacci sphere — sorted by radial distance so dots collapse cleanly. */
  private assignSphereTargets(): void {
    const cx = this.W / 2;
    const cy = this.H / 2;
    const N = this.dots.length;
    const R = Math.min(this.W, this.H) * 0.22;
    const points = new Array<{ x: number; y: number; z: number }>(N);
    const phi = Math.PI * (Math.sqrt(5) - 1);
    for (let i = 0; i < N; i++) {
      const y = 1 - (i / Math.max(1, N - 1)) * 2;
      const rad = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = phi * i;
      points[i] = { x: Math.cos(theta) * rad, y, z: Math.sin(theta) * rad };
    }
    const idx = this.dots.map((_, i) => i);
    idx.sort((a, b) => {
      const da = (this.dots[a].hx - cx) ** 2 + (this.dots[a].hy - cy) ** 2;
      const db = (this.dots[b].hx - cx) ** 2 + (this.dots[b].hy - cy) ** 2;
      return da - db;
    });
    for (let i = 0; i < N; i++) {
      const d = this.dots[idx[i]];
      const p = points[i];
      d.sx = p.x;
      d.sy = p.y;
      d.sz = p.z;
      d.R = R;
    }
  }

  /** Dots further from center start later → spiral collapse on form,
   *  reverse on return. */
  private assignStagger(): void {
    const cx = this.W / 2;
    const cy = this.H / 2;
    const maxD = Math.hypot(this.W, this.H) / 2;
    for (const d of this.dots) {
      const dist = Math.hypot(d.hx - cx, d.hy - cy);
      d.delay = 0.05 + 0.55 * (dist / maxD);
    }
  }

  private buildPlanets(): void {
    this.planets = [
      { angle: 0, speed: 0.45, dist: 1.55, r: 6, alpha: 0.85, ringRot: 0.6, tilt: 0.1 },
      { angle: 1.2, speed: 0.30, dist: 2.05, r: 4, alpha: 0.65, ringRot: -0.4, tilt: -0.2 },
      { angle: 2.6, speed: 0.18, dist: 2.65, r: 8, alpha: 0.55, ringRot: 0.3, tilt: 0.25, hasRing: true },
    ];
  }

  private applyPulses(x: number, y: number, now: number): { dx: number; dy: number; brightnessBoost: number } {
    let dx = 0;
    let dy = 0;
    let brightnessBoost = 0;
    for (const pl of this.pulses) {
      const age = (now - pl.born) / pl.ttl;
      const front = age * 760;
      const vx = x - pl.x;
      const vy = y - pl.y;
      const d = Math.hypot(vx, vy) || 1;
      const band = 50;
      if (d > front - band && d < front + band) {
        const k = 1 - Math.abs(d - front) / band;
        const fade = 1 - age;
        const push = k * 14 * pl.amp * fade;
        dx += (vx / d) * push;
        dy += (vy / d) * push;
        brightnessBoost += k * fade * 0.9;
      }
    }
    return { dx, dy, brightnessBoost };
  }

  private frame(now: number): void {
    if (this.destroyed) return;

    // Tab is hidden → skip the entire render. Browsers throttle
    // rAF for backgrounded tabs but Chrome still fires it ~once per
    // second; for an orb mode that means we'd compute thousands of
    // dot positions for invisible output. Returning early without
    // re-scheduling lets the rAF queue go quiet entirely; the
    // visibilitychange listener restarts it on un-hide.
    if (this.paused) {
      this.rafId = 0;
      return;
    }

    // Throttle idle-mode renders to ~30 fps. In voice / forming /
    // orb modes we render at the browser's native rate (typically 60
    // or 120 fps) because the sphere animation benefits from
    // smoothness. In idle mode, the ambient breathing/sparkle effect
    // looks identical at 30 fps and costs roughly half the CPU.
    if (this.mode === "idle") {
      if (now - this.lastFrameDrawAt < this.IDLE_MIN_FRAME_MS) {
        this.rafId = requestAnimationFrame((next) => this.frame(next));
        return;
      }
    }
    this.lastFrameDrawAt = now;

    const t = (now - this.startTime) / 1000;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.W, this.H);

    // Transition progress
    let p = 1;
    if (this.mode === "forming" || this.mode === "returning") {
      p = Math.min(1, (now - this.transitionStart) / TRANSITION_MS);
      if (p >= 1) this.mode = this.mode === "forming" ? "orb" : "idle";
    }
    const eased = easeInOut(p);
    const globalMix =
      this.mode === "forming" ? eased :
      this.mode === "orb" ? 1 :
      this.mode === "returning" ? 1 - eased : 0;

    const orbActive = globalMix > 0;
    const rotY = orbActive ? t * 0.30 : 0;
    const rotX = orbActive ? Math.sin(t * 0.22) * 0.20 : 0;
    const cosY = Math.cos(rotY);
    const sinY = Math.sin(rotY);
    const cosX = Math.cos(rotX);
    const sinX = Math.sin(rotX);

    const cx = this.W / 2;
    const cy = this.H / 2;

    // Theme-dependent colors, resolved ONCE per frame (never inside
    // the ~4000-dot hot loop). `tints` swaps the whole dot palette;
    // `fx` carries the handful of non-dot accents below.
    const tints = THEME_TINTS[this.theme];
    const fx = THEME_FX[this.theme];

    // Prune expired pulses/ghosts
    this.pulses = this.pulses.filter((pl) => now - pl.born < pl.ttl);
    this.ghosts = this.ghosts.filter((g) => now - g.born < g.ttl);

    // Halo behind the orb when active
    if (globalMix > 0.3) {
      const orbA = Math.min(1, (globalMix - 0.3) / 0.7);
      const R = Math.min(this.W, this.H) * 0.22;
      const grd = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 2.5);
      grd.addColorStop(0, `rgba(${fx.halo0},${(fx.halo0A * orbA).toFixed(3)})`);
      grd.addColorStop(0.3, `rgba(${fx.halo1},${(fx.halo1A * orbA).toFixed(3)})`);
      grd.addColorStop(1, `rgba(255,255,255,0)`);
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, this.W, this.H);
    }

    // These mode flags are read elsewhere in the render loop to
    // dim/brighten the field when typing or in focus mode. Declared
    // here even though the ambient-sparkle spawn that used to consume
    // them has been removed (see comment below).
    const isTyping = document.body.classList.contains("aurora-typing");
    const isFocus = document.body.classList.contains("aurora-focus-mode");

    // Ambient ghost-sparkle spawning is DISABLED. Founder asked to
    // "remove the glory things" — the random shimmering dots that
    // would appear and fade across the field every ~70ms. They were
    // part of the "glory" effect we're stripping. The intentional
    // spark() API used on send / tap / pulse is unaffected — those
    // bursts are user-initiated feedback, not ambient sparkle.

    // Draw dots
    for (let i = 0; i < this.dots.length; i++) {
      const d = this.dots[i];

      let dotMix = 0;
      if (this.mode === "forming") {
        const local = (eased - d.delay) / (1 - d.delay);
        dotMix = Math.max(0, Math.min(1, local));
        dotMix = easeInOut(dotMix);
      } else if (this.mode === "orb") {
        dotMix = 1;
      } else if (this.mode === "returning") {
        const reverseDelay = 0.55 - d.delay;
        const local = (eased - reverseDelay) / (1 - reverseDelay);
        dotMix = 1 - Math.max(0, Math.min(1, local));
        dotMix = easeInOut(dotMix);
      }

      // Ambient breathing
      const driftX = Math.sin(d.phase + t * 0.5 * d.speed) * 1.1;
      const driftY = Math.cos(d.phase * 1.3 + t * 0.4 * d.speed) * 0.9;
      let hx = d.hx + driftX;
      let hy = d.hy + driftY;

      // Swirling tangential displacement during transition
      if (this.mode === "forming" || this.mode === "returning") {
        const vx = hx - cx;
        const vy = hy - cy;
        const ang = Math.atan2(vy, vx);
        const distC = Math.hypot(vx, vy);
        const swirlAmt = Math.sin(dotMix * Math.PI) * 28 * d.swirl;
        hx += Math.cos(ang + Math.PI / 2) * swirlAmt;
        hy += Math.sin(ang + Math.PI / 2) * swirlAmt;
        hx -= (vx / Math.max(1, distC)) * dotMix * 6;
        hy -= (vy / Math.max(1, distC)) * dotMix * 6;
      }

      // Pulse waves push the field
      const pl = this.applyPulses(hx, hy, now);
      hx += pl.dx;
      hy += pl.dy;

      // Sphere position
      let sx = d.sx;
      let sy = d.sy;
      let sz = d.sz;
      let xR = sx * cosY + sz * sinY;
      let zR = -sx * sinY + sz * cosY;
      sx = xR;
      sz = zR;
      const yR = sy * cosX - sz * sinX;
      zR = sy * sinX + sz * cosX;
      sy = yR;
      sz = zR;
      const sxPx = cx + sx * d.R;
      const syPx = cy + sy * d.R;

      const x = hx + (sxPx - hx) * dotMix;
      const y = hy + (syPx - hy) * dotMix;

      // Home appearance
      const breath = 0.85 + 0.15 * Math.sin(t * 0.7 + d.phase * 1.3);
      const homeR = DOT_R_AMB;
      let homeA = ALPHA_AMB * breath;
      const homeBlur = GLOW_BG;
      homeA = Math.min(1, homeA + pl.brightnessBoost * 0.45);

      // Orb appearance
      const front = (1 - sz) * 0.5;
      const orbR = DOT_R_ORB * (0.5 + front * 0.85);
      const orbA = 0.15 + front * 0.85;
      const orbBlur = 3 + front * GLOW_ORB;

      const radius = homeR + (orbR - homeR) * dotMix;
      const alpha = Math.max(homeA * (1 - dotMix * 0.85), orbA * dotMix);
      const blur = homeBlur + (orbBlur - homeBlur) * dotMix;

      if (alpha < 0.01) continue;
      const finalR = isFocus ? Math.max(0.5, radius * 1.12) : Math.max(0.4, radius);
      const finalA = isFocus ? Math.min(1, alpha * 1.35) : alpha;

      const calmDots = isTyping;
      // PERF: in orb/forming mode, only glow front-facing dots.
      // Back-facing dots are low-alpha already — the glow on them
      // is invisible to the viewer but identically expensive. Cuts
      // shadow-blur work roughly in half during voice mode without
      // any perceptible visual change.
      const inOrbMode = dotMix > 0.4;
      const isFrontFacing = inOrbMode ? (1 - d.sz) * 0.5 > SPHERE_GLOW_FRONT_THRESHOLD : true;
      ctx.shadowBlur =
        isFocus ? 0 :
        calmDots ? Math.min(blur, 2) :
        inOrbMode && !isFrontFacing ? 0 :
        blur;
      // Multi-tint palette lookup. Each dot's tint is set once at
      // creation by pickTint() (~85% white, 15% colored mix). The
      // table-driven lookup keeps the hot loop branch-free —
      // important because this runs once per dot per frame across
      // ~4000 dots.
      const palette = tints[d.tint];
      ctx.shadowColor = palette.shadow;
      ctx.fillStyle = `rgba(${palette.fill},${finalA.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x, y, finalR, 0, Math.PI * 2);
      ctx.fill();
    }

    // Ghost dots
    for (const g of this.ghosts) {
      const age = (now - g.born) / g.ttl;
      const a = Math.sin(age * Math.PI);
      g.x += g.vx;
      g.y += g.vy;
      const calm = isTyping;
      ctx.shadowBlur = calm ? 0.3 : 1;
      ctx.shadowColor = fx.ghostShadow;
      ctx.fillStyle = `rgba(${fx.ghost},${(a * (calm ? 0.55 : 0.85)).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(g.x, g.y, g.r * (calm ? 0.7 : 0.85), 0, Math.PI * 2);
      ctx.fill();
      if (!calm && a > 0.7) {
        ctx.strokeStyle = `rgba(${fx.ghost},${((a - 0.7) * 0.4).toFixed(3)})`;
        ctx.lineWidth = 0.4;
        const armR = g.r * 2.2;
        ctx.beginPath();
        ctx.moveTo(g.x - armR, g.y);
        ctx.lineTo(g.x + armR, g.y);
        ctx.moveTo(g.x, g.y - armR);
        ctx.lineTo(g.x, g.y + armR);
        ctx.stroke();
      }
    }

    // Inner counter-rotating ring + planet satellites (orb mode)
    if (globalMix > 0.4) {
      const orbA = Math.min(1, (globalMix - 0.4) / 0.6);
      const R = Math.min(this.W, this.H) * 0.22;

      // Inner ring
      const innerR = R * 0.55;
      const innerRot = -t * 0.6;
      for (let i = 0; i < INNER_RING_SEGMENTS; i++) {
        const ang = (i / INNER_RING_SEGMENTS) * Math.PI * 2 + innerRot;
        let px = Math.cos(ang) * innerR;
        let py = 0;
        let pz = Math.sin(ang) * innerR;
        const yR = py * cosX - pz * sinX;
        const zR = py * sinX + pz * cosX;
        py = yR;
        pz = zR;
        const xR = px * Math.cos(-rotY * 2) + pz * Math.sin(-rotY * 2);
        const zR2 = -px * Math.sin(-rotY * 2) + pz * Math.cos(-rotY * 2);
        px = xR;
        pz = zR2;
        const f = (1 - pz / innerR) * 0.5;
        const aR = 1.2 + f * 1.6;
        const aA = 0.20 + f * 0.65;
        ctx.shadowBlur = 6 + f * 8;
        ctx.shadowColor = fx.ring1Shadow;
        ctx.fillStyle = `rgba(${fx.ring1},${(aA * orbA).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(cx + px, cy + py, aR, 0, Math.PI * 2);
        ctx.fill();
      }

      // Second inner ring — perpendicular axis. Reduced 48→24
      // segments for the same perf reason as the outer ring.
      const innerR2 = R * 0.38;
      const innerRot2 = t * 0.85;
      const INNER_RING2_SEGMENTS = 24;
      for (let i = 0; i < INNER_RING2_SEGMENTS; i++) {
        const ang = (i / INNER_RING2_SEGMENTS) * Math.PI * 2 + innerRot2;
        let px = Math.cos(ang) * innerR2;
        let py = Math.sin(ang) * innerR2;
        let pz = 0;
        const yR = py * cosX - pz * sinX;
        const zR = py * sinX + pz * cosX;
        py = yR;
        pz = zR;
        const xR = px * cosY + pz * sinY;
        const zR2 = -px * sinY + pz * cosY;
        px = xR;
        pz = zR2;
        const f = (1 - pz / innerR2) * 0.5;
        const aA = 0.18 + f * 0.6;
        ctx.shadowBlur = 5 + f * 7;
        ctx.shadowColor = fx.ring2Shadow;
        ctx.fillStyle = `rgba(${fx.ring2},${(aA * orbA).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(cx + px, cy + py, 1.6 + f * 1.6, 0, Math.PI * 2);
        ctx.fill();
      }

      // Planet satellites
      for (const planet of this.planets) {
        planet.angle += planet.speed * 0.012;
        const a = planet.angle;
        let px = Math.cos(a) * R * planet.dist;
        let py = Math.sin(a) * planet.tilt * R;
        let pz = Math.sin(a) * R * planet.dist;
        const yR = py * cosX - pz * sinX;
        const zR = py * sinX + pz * cosX;
        py = yR;
        pz = zR;
        const f = (1 - pz / (R * planet.dist)) * 0.5;
        const aA = planet.alpha * orbA * (0.5 + f * 0.5);
        ctx.shadowBlur = 16;
        ctx.shadowColor = fx.planetShadow;
        ctx.fillStyle = `rgba(${fx.planet},${aA.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(cx + px, cy + py, planet.r * (0.7 + f * 0.6), 0, Math.PI * 2);
        ctx.fill();
        if (planet.hasRing) {
          ctx.shadowBlur = 6;
          ctx.strokeStyle = `rgba(${fx.planet},${(aA * 0.6).toFixed(3)})`;
          ctx.lineWidth = 0.7;
          ctx.beginPath();
          ctx.ellipse(cx + px, cy + py, planet.r * 2.4, planet.r * 0.7, planet.tilt + Math.PI / 6, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }

    ctx.shadowBlur = 0;
    this.rafId = requestAnimationFrame((next) => this.frame(next));
  }
}
