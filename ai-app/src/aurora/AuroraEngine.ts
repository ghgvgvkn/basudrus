/**
 * AuroraEngine — Enhanced TypeScript canvas universe for Aurora AI.
 *
 * UPGRADED VISUALS:
 *   - Particles now drift organically across the entire screen
 *   - Multiple orbital rings with varied speeds and tilts
 *   - Pulsing glow effects that react to interaction
 *   - Floating ambient particles that move in all directions
 *   - Improved sphere with depth-based scaling and glow
 *   - Shooting star trails and particle bursts
 *   - Smoother transitions with elastic easing
 *
 * Visual states:
 *   - idle      : ambient breathing particles drifting across screen
 *   - forming   : particles swirl inward forming the sphere
 *   - orb       : rotating 3D sphere with multiple orbital rings
 *   - returning : particles flow back outward
 *
 * Public API (imperative — call from React refs / event handlers):
 *   - activate()        : idle → forming → orb
 *   - deactivate()      : orb → returning → idle
 *   - toggle()
 *   - pulse(x, y, amp)  : stereo wave from a point
 *   - pulseFromAll(amp) : waves from all four edges
 *   - spark(x, y, n)    : burst of particles
 *   - state()           : current mode
 *   - destroy()         : cleanup
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
  trail?: { x: number; y: number }[];
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
  orbitTilt: number;
}

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
  tint: "tint" | "white" | "accent";
  life: number;
  lifeTarget: number;
  lifeNext: number;
  // New properties for ambient movement
  wanderAngle: number;
  wanderSpeed: number;
  baseX: number;
  baseY: number;
}

interface FloatingParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  alpha: number;
  born: number;
  ttl: number;
  color: string;
}

// Performance + design knobs
const SPACING = 20;
const DOT_R_AMB = 1.2;
const DOT_R_ORB = 3.0;
const ALPHA_AMB = 0.18;
const GLOW_BG = 2;
const GLOW_ORB = 10;
const TRANSITION_MS = 2200;

const SPHERE_GLOW_FRONT_THRESHOLD = 0.45;
const INNER_RING_SEGMENTS = 40;

// Floating particles config
const MAX_FLOATING_PARTICLES = 60;
const FLOATING_SPAWN_INTERVAL = 120;

// Easing functions
const easeInOut = (t: number): number =>
  t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

const easeOutElastic = (t: number): number => {
  const c4 = (2 * Math.PI) / 3;
  return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
};

const easeOutBack = (t: number): number => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

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
  private floatingParticles: FloatingParticle[] = [];
  private rafId = 0;
  private resizeHandler: () => void;
  private startTime = performance.now();
  private destroyed = false;
  private lastFloatingSpawn = 0;

  private lastFrameDrawAt = 0;
  private readonly IDLE_MIN_FRAME_MS = 25; // ~40 fps in idle for smoother movement

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) throw new Error("AuroraEngine: 2D context unavailable");
    this.ctx = ctx;
    this.resizeHandler = () => this.resize();
    this.resize();
    window.addEventListener("resize", this.resizeHandler);
    this.rafId = requestAnimationFrame((t) => this.frame(t));
  }

  // ── Public imperative API ─────────────────────────────────────────

  activate(): void {
    if (this.mode === "forming" || this.mode === "orb") return;
    this.mode = "forming";
    this.transitionStart = performance.now();
    document.body.classList.add("aurora-active");
    // Multiple pulses for dramatic effect
    this.pulses.push({
      x: this.W / 2,
      y: this.H / 2,
      born: performance.now(),
      ttl: 2000,
      amp: 1.2,
    });
    this.pulses.push({
      x: this.W / 2,
      y: this.H / 2,
      born: performance.now() + 100,
      ttl: 1800,
      amp: 0.8,
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
      ttl: 1600,
      amp: 0.6,
    });
  }

  toggle(): void {
    if (this.mode === "orb" || this.mode === "forming") this.deactivate();
    else this.activate();
  }

  pulse(x?: number, y?: number, amp = 0.7): void {
    const cx = x ?? this.W / 2;
    const cy = y ?? this.H / 2;
    const now = performance.now();
    this.pulses.push({ x: cx, y: cy, born: now, ttl: 1400, amp });
    this.pulses.push({ x: cx, y: cy, born: now + 80, ttl: 1400, amp: amp * 0.75 });
    this.pulses.push({ x: cx, y: cy, born: now + 160, ttl: 1400, amp: amp * 0.5 });
  }

  pulseFromAll(amp = 0.6): void {
    const now = performance.now();
    const points = [
      { x: this.W * 0.5, y: -30 },
      { x: this.W * 0.5, y: this.H + 30 },
      { x: -30, y: this.H * 0.5 },
      { x: this.W + 30, y: this.H * 0.5 },
      { x: 0, y: 0 },
      { x: this.W, y: 0 },
      { x: 0, y: this.H },
      { x: this.W, y: this.H },
    ];
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      this.pulses.push({ x: p.x, y: p.y, born: now + i * 50, ttl: 1600, amp });
    }
  }

  spark(x?: number, y?: number, count = 20): void {
    const cx = x ?? this.W / 2;
    const cy = y ?? this.H / 2;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = 6 + Math.random() * 30;
      const speed = 1.5 + Math.random() * 3;
      this.ghosts.push({
        x: cx + Math.cos(a) * d,
        y: cy + Math.sin(a) * d,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        born: performance.now(),
        ttl: 1200 + Math.random() * 800,
        r: 2 + Math.random() * 2.5,
        trail: [],
      });
    }
  }

  state(): AuroraMode {
    return this.mode;
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.rafId);
    window.removeEventListener("resize", this.resizeHandler);
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
        const tintRoll = Math.random();
        this.dots.push({
          hx: x,
          hy: y,
          baseX: x,
          baseY: y,
          phase: Math.random() * Math.PI * 2,
          speed: 0.3 + Math.random() * 0.8,
          delay: 0,
          inTemp: false,
          inSub: false,
          isText: false,
          sx: 0,
          sy: 0,
          sz: 0,
          R: 0,
          swirl: Math.random() * 2 - 1,
          tint: tintRoll < 0.03 ? "accent" : tintRoll < 0.08 ? "tint" : "white",
          life: 1,
          lifeTarget: 1,
          lifeNext: 0,
          wanderAngle: Math.random() * Math.PI * 2,
          wanderSpeed: 0.001 + Math.random() * 0.003,
        });
      }
    }
    this.assignSphereTargets();
    this.assignStagger();
  }

  private assignSphereTargets(): void {
    const cx = this.W / 2;
    const cy = this.H / 2;
    const N = this.dots.length;
    const R = Math.min(this.W, this.H) * 0.24;
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

  private assignStagger(): void {
    const cx = this.W / 2;
    const cy = this.H / 2;
    const maxD = Math.hypot(this.W, this.H) / 2;
    for (const d of this.dots) {
      const dist = Math.hypot(d.hx - cx, d.hy - cy);
      d.delay = 0.03 + 0.60 * (dist / maxD);
    }
  }

  private buildPlanets(): void {
    this.planets = [
      { angle: 0, speed: 0.5, dist: 1.45, r: 7, alpha: 0.9, ringRot: 0.7, tilt: 0.15, orbitTilt: 0.2 },
      { angle: Math.PI * 0.6, speed: 0.35, dist: 1.85, r: 5, alpha: 0.75, ringRot: -0.5, tilt: -0.25, orbitTilt: -0.15 },
      { angle: Math.PI * 1.2, speed: 0.25, dist: 2.35, r: 9, alpha: 0.65, ringRot: 0.35, tilt: 0.3, hasRing: true, orbitTilt: 0.1 },
      { angle: Math.PI * 1.8, speed: 0.6, dist: 1.25, r: 4, alpha: 0.85, ringRot: -0.3, tilt: -0.1, orbitTilt: 0.3 },
    ];
  }

  private spawnFloatingParticle(): void {
    if (this.floatingParticles.length >= MAX_FLOATING_PARTICLES) return;
    
    const side = Math.floor(Math.random() * 4);
    let x: number, y: number, vx: number, vy: number;
    const speed = 0.3 + Math.random() * 0.8;
    
    switch (side) {
      case 0: // Top
        x = Math.random() * this.W;
        y = -10;
        vx = (Math.random() - 0.5) * speed;
        vy = speed;
        break;
      case 1: // Right
        x = this.W + 10;
        y = Math.random() * this.H;
        vx = -speed;
        vy = (Math.random() - 0.5) * speed;
        break;
      case 2: // Bottom
        x = Math.random() * this.W;
        y = this.H + 10;
        vx = (Math.random() - 0.5) * speed;
        vy = -speed;
        break;
      default: // Left
        x = -10;
        y = Math.random() * this.H;
        vx = speed;
        vy = (Math.random() - 0.5) * speed;
        break;
    }

    const colors = [
      "rgba(255,255,255,",
      "rgba(255,200,220,",
      "rgba(200,220,255,",
      "rgba(220,200,255,",
    ];

    this.floatingParticles.push({
      x,
      y,
      vx,
      vy,
      r: 1 + Math.random() * 2,
      alpha: 0.2 + Math.random() * 0.4,
      born: performance.now(),
      ttl: 8000 + Math.random() * 12000,
      color: colors[Math.floor(Math.random() * colors.length)],
    });
  }

  private applyPulses(x: number, y: number, now: number): { dx: number; dy: number; brightnessBoost: number } {
    let dx = 0;
    let dy = 0;
    let brightnessBoost = 0;
    for (const pl of this.pulses) {
      const age = (now - pl.born) / pl.ttl;
      const front = age * 900;
      const vx = x - pl.x;
      const vy = y - pl.y;
      const d = Math.hypot(vx, vy) || 1;
      const band = 60;
      if (d > front - band && d < front + band) {
        const k = 1 - Math.abs(d - front) / band;
        const fade = 1 - age;
        const push = k * 18 * pl.amp * fade;
        dx += (vx / d) * push;
        dy += (vy / d) * push;
        brightnessBoost += k * fade * 1.2;
      }
    }
    return { dx, dy, brightnessBoost };
  }

  private frame(now: number): void {
    if (this.destroyed) return;

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

    // Spawn floating particles
    if (now - this.lastFloatingSpawn > FLOATING_SPAWN_INTERVAL) {
      this.spawnFloatingParticle();
      this.lastFloatingSpawn = now;
    }

    // Transition progress
    let p = 1;
    if (this.mode === "forming" || this.mode === "returning") {
      p = Math.min(1, (now - this.transitionStart) / TRANSITION_MS);
      if (p >= 1) this.mode = this.mode === "forming" ? "orb" : "idle";
    }
    const eased = this.mode === "forming" ? easeOutBack(p) : easeInOut(p);
    const globalMix =
      this.mode === "forming" ? eased :
      this.mode === "orb" ? 1 :
      this.mode === "returning" ? 1 - eased : 0;

    const orbActive = globalMix > 0;
    const rotY = orbActive ? t * 0.35 : 0;
    const rotX = orbActive ? Math.sin(t * 0.25) * 0.25 : 0;
    const rotZ = orbActive ? Math.sin(t * 0.15) * 0.08 : 0;
    const cosY = Math.cos(rotY);
    const sinY = Math.sin(rotY);
    const cosX = Math.cos(rotX);
    const sinX = Math.sin(rotX);
    const cosZ = Math.cos(rotZ);
    const sinZ = Math.sin(rotZ);

    const cx = this.W / 2;
    const cy = this.H / 2;

    // Prune expired pulses/ghosts/floating
    this.pulses = this.pulses.filter((pl) => now - pl.born < pl.ttl);
    this.ghosts = this.ghosts.filter((g) => now - g.born < g.ttl);
    this.floatingParticles = this.floatingParticles.filter((fp) => {
      const age = now - fp.born;
      return age < fp.ttl && fp.x > -50 && fp.x < this.W + 50 && fp.y > -50 && fp.y < this.H + 50;
    });

    // Draw floating particles (behind everything)
    for (const fp of this.floatingParticles) {
      const age = (now - fp.born) / fp.ttl;
      const fadeIn = Math.min(1, age * 10);
      const fadeOut = age > 0.8 ? 1 - (age - 0.8) / 0.2 : 1;
      const a = fp.alpha * fadeIn * fadeOut;
      
      fp.x += fp.vx;
      fp.y += fp.vy;
      // Add gentle wave motion
      fp.x += Math.sin(t * 2 + fp.born * 0.001) * 0.3;
      fp.y += Math.cos(t * 1.5 + fp.born * 0.001) * 0.2;

      ctx.shadowBlur = 4;
      ctx.shadowColor = fp.color + "0.5)";
      ctx.fillStyle = fp.color + a.toFixed(3) + ")";
      ctx.beginPath();
      ctx.arc(fp.x, fp.y, fp.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Halo behind the orb when active
    if (globalMix > 0.2) {
      const orbA = Math.min(1, (globalMix - 0.2) / 0.8);
      const R = Math.min(this.W, this.H) * 0.24;
      
      // Multiple gradient layers for depth
      const grd1 = ctx.createRadialGradient(cx, cy, R * 0.1, cx, cy, R * 3);
      grd1.addColorStop(0, `rgba(220,200,255,${0.12 * orbA})`);
      grd1.addColorStop(0.3, `rgba(255,180,200,${0.06 * orbA})`);
      grd1.addColorStop(0.6, `rgba(200,220,255,${0.03 * orbA})`);
      grd1.addColorStop(1, `rgba(255,255,255,0)`);
      ctx.fillStyle = grd1;
      ctx.fillRect(0, 0, this.W, this.H);

      // Pulsing inner glow
      const pulseScale = 1 + Math.sin(t * 2) * 0.05;
      const grd2 = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.2 * pulseScale);
      grd2.addColorStop(0, `rgba(255,255,255,${0.08 * orbA})`);
      grd2.addColorStop(0.5, `rgba(255,220,235,${0.04 * orbA})`);
      grd2.addColorStop(1, `rgba(255,255,255,0)`);
      ctx.fillStyle = grd2;
      ctx.fillRect(0, 0, this.W, this.H);
    }

    const isTyping = document.body.classList.contains("aurora-typing");
    const isFocus = document.body.classList.contains("aurora-focus-mode");

    // Draw dots
    for (let i = 0; i < this.dots.length; i++) {
      const d = this.dots[i];

      let dotMix = 0;
      if (this.mode === "forming") {
        const local = (eased - d.delay) / (1 - d.delay);
        dotMix = Math.max(0, Math.min(1, local));
        dotMix = easeOutElastic(Math.min(1, dotMix * 1.1));
      } else if (this.mode === "orb") {
        dotMix = 1;
      } else if (this.mode === "returning") {
        const reverseDelay = 0.60 - d.delay;
        const local = (eased - reverseDelay) / (1 - reverseDelay);
        dotMix = 1 - Math.max(0, Math.min(1, local));
        dotMix = easeInOut(dotMix);
      }

      // Enhanced ambient wandering
      d.wanderAngle += d.wanderSpeed + Math.sin(t * 0.5 + d.phase) * 0.002;
      const wanderRadius = 25 + Math.sin(t * 0.3 + d.phase * 2) * 10;
      const wanderX = Math.cos(d.wanderAngle) * wanderRadius * (1 - dotMix);
      const wanderY = Math.sin(d.wanderAngle * 0.7) * wanderRadius * (1 - dotMix);

      // Ambient breathing with wandering
      const driftX = Math.sin(d.phase + t * 0.6 * d.speed) * 1.5 + wanderX;
      const driftY = Math.cos(d.phase * 1.3 + t * 0.5 * d.speed) * 1.2 + wanderY;
      let hx = d.baseX + driftX;
      let hy = d.baseY + driftY;

      // Swirling during transition
      if (this.mode === "forming" || this.mode === "returning") {
        const vx = hx - cx;
        const vy = hy - cy;
        const ang = Math.atan2(vy, vx);
        const distC = Math.hypot(vx, vy);
        const swirlAmt = Math.sin(dotMix * Math.PI) * 35 * d.swirl;
        hx += Math.cos(ang + Math.PI / 2) * swirlAmt;
        hy += Math.sin(ang + Math.PI / 2) * swirlAmt;
        hx -= (vx / Math.max(1, distC)) * dotMix * 8;
        hy -= (vy / Math.max(1, distC)) * dotMix * 8;
      }

      // Pulse waves push the field
      const pl = this.applyPulses(hx, hy, now);
      hx += pl.dx;
      hy += pl.dy;

      // Sphere position with 3-axis rotation
      let sx = d.sx;
      let sy = d.sy;
      let sz = d.sz;
      
      // Y-axis rotation
      let xR = sx * cosY + sz * sinY;
      let zR = -sx * sinY + sz * cosY;
      sx = xR;
      sz = zR;
      
      // X-axis rotation
      const yR = sy * cosX - sz * sinX;
      zR = sy * sinX + sz * cosX;
      sy = yR;
      sz = zR;
      
      // Z-axis rotation (subtle wobble)
      xR = sx * cosZ - sy * sinZ;
      const yR2 = sx * sinZ + sy * cosZ;
      sx = xR;
      sy = yR2;

      const sxPx = cx + sx * d.R;
      const syPx = cy + sy * d.R;

      const x = hx + (sxPx - hx) * dotMix;
      const y = hy + (syPx - hy) * dotMix;

      // Enhanced home appearance with pulsing
      const breath = 0.8 + 0.2 * Math.sin(t * 0.8 + d.phase * 1.5);
      const homeR = DOT_R_AMB * breath;
      let homeA = ALPHA_AMB * breath;
      const homeBlur = GLOW_BG;
      homeA = Math.min(1, homeA + pl.brightnessBoost * 0.5);

      // Improved orb appearance with depth
      const front = (1 - sz) * 0.5;
      const depthScale = 0.4 + front * 1.0;
      const orbR = DOT_R_ORB * depthScale;
      const orbA = 0.1 + front * 0.9;
      const orbBlur = 2 + front * GLOW_ORB;

      const radius = homeR + (orbR - homeR) * dotMix;
      const alpha = Math.max(homeA * (1 - dotMix * 0.8), orbA * dotMix);
      const blur = homeBlur + (orbBlur - homeBlur) * dotMix;

      if (alpha < 0.01) continue;
      const finalR = isFocus ? Math.max(0.6, radius * 1.15) : Math.max(0.5, radius);
      const finalA = isFocus ? Math.min(1, alpha * 1.4) : alpha;

      const calmDots = isTyping;
      const inOrbMode = dotMix > 0.4;
      const isFrontFacing = inOrbMode ? (1 - d.sz) * 0.5 > SPHERE_GLOW_FRONT_THRESHOLD : true;
      
      ctx.shadowBlur =
        isFocus ? 1 :
        calmDots ? Math.min(blur, 2) :
        inOrbMode && !isFrontFacing ? 0 :
        blur;
      
      // Color based on tint type
      if (d.tint === "accent") {
        ctx.shadowColor = "rgba(200,220,255,0.9)";
        ctx.fillStyle = `rgba(180,200,255,${finalA.toFixed(3)})`;
      } else if (d.tint === "tint") {
        ctx.shadowColor = "rgba(255,180,210,0.9)";
        ctx.fillStyle = `rgba(255,210,225,${finalA.toFixed(3)})`;
      } else {
        ctx.shadowColor = "rgba(255,255,255,0.9)";
        ctx.fillStyle = `rgba(255,255,255,${finalA.toFixed(3)})`;
      }
      
      ctx.beginPath();
      ctx.arc(x, y, finalR, 0, Math.PI * 2);
      ctx.fill();
    }

    // Ghost dots with trails
    for (const g of this.ghosts) {
      const age = (now - g.born) / g.ttl;
      const a = Math.sin(age * Math.PI);
      
      // Store trail position
      if (g.trail && g.trail.length < 8) {
        g.trail.push({ x: g.x, y: g.y });
      } else if (g.trail) {
        g.trail.shift();
        g.trail.push({ x: g.x, y: g.y });
      }
      
      // Draw trail
      if (g.trail && g.trail.length > 1 && a > 0.3) {
        ctx.beginPath();
        ctx.moveTo(g.trail[0].x, g.trail[0].y);
        for (let i = 1; i < g.trail.length; i++) {
          ctx.lineTo(g.trail[i].x, g.trail[i].y);
        }
        ctx.strokeStyle = `rgba(255,255,255,${(a * 0.3).toFixed(3)})`;
        ctx.lineWidth = g.r * 0.5;
        ctx.lineCap = "round";
        ctx.stroke();
      }
      
      g.x += g.vx;
      g.y += g.vy;
      g.vx *= 0.98;
      g.vy *= 0.98;
      
      const calm = isTyping;
      ctx.shadowBlur = calm ? 1 : 4;
      ctx.shadowColor = "rgba(255,255,255,0.7)";
      ctx.fillStyle = `rgba(255,255,255,${(a * (calm ? 0.6 : 0.9)).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(g.x, g.y, g.r * (calm ? 0.75 : 1), 0, Math.PI * 2);
      ctx.fill();
      
      // Sparkle cross
      if (!calm && a > 0.6) {
        ctx.strokeStyle = `rgba(255,255,255,${((a - 0.6) * 0.5).toFixed(3)})`;
        ctx.lineWidth = 0.5;
        const armR = g.r * 2.5;
        ctx.beginPath();
        ctx.moveTo(g.x - armR, g.y);
        ctx.lineTo(g.x + armR, g.y);
        ctx.moveTo(g.x, g.y - armR);
        ctx.lineTo(g.x, g.y + armR);
        ctx.stroke();
      }
    }

    // Enhanced orbital rings and planets (orb mode)
    if (globalMix > 0.3) {
      const orbA = Math.min(1, (globalMix - 0.3) / 0.7);
      const R = Math.min(this.W, this.H) * 0.24;

      // Primary inner ring
      const innerR = R * 0.6;
      const innerRot = -t * 0.7;
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
        const aR = 1.5 + f * 2;
        const aA = 0.25 + f * 0.7;
        ctx.shadowBlur = 8 + f * 10;
        ctx.shadowColor = "rgba(255,210,225,0.9)";
        ctx.fillStyle = `rgba(255,220,235,${(aA * orbA).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(cx + px, cy + py, aR, 0, Math.PI * 2);
        ctx.fill();
      }

      // Secondary perpendicular ring
      const innerR2 = R * 0.42;
      const innerRot2 = t * 0.95;
      const INNER_RING2_SEGMENTS = 30;
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
        const aA = 0.2 + f * 0.65;
        ctx.shadowBlur = 6 + f * 8;
        ctx.shadowColor = "rgba(196,184,255,0.9)";
        ctx.fillStyle = `rgba(220,210,255,${(aA * orbA).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(cx + px, cy + py, 1.8 + f * 1.8, 0, Math.PI * 2);
        ctx.fill();
      }

      // Third diagonal ring
      const innerR3 = R * 0.75;
      const innerRot3 = -t * 0.5;
      const INNER_RING3_SEGMENTS = 50;
      for (let i = 0; i < INNER_RING3_SEGMENTS; i++) {
        const ang = (i / INNER_RING3_SEGMENTS) * Math.PI * 2 + innerRot3;
        let px = Math.cos(ang) * innerR3;
        let py = Math.sin(ang) * innerR3 * 0.3;
        let pz = Math.sin(ang) * innerR3 * 0.95;
        
        const yR = py * cosX - pz * sinX;
        const zR = py * sinX + pz * cosX;
        py = yR;
        pz = zR;
        const xR = px * cosY + pz * sinY;
        const zR2 = -px * sinY + pz * cosY;
        px = xR;
        pz = zR2;
        
        const f = (1 - pz / innerR3) * 0.5;
        const aA = 0.15 + f * 0.5;
        ctx.shadowBlur = 4 + f * 6;
        ctx.shadowColor = "rgba(200,230,255,0.8)";
        ctx.fillStyle = `rgba(210,230,255,${(aA * orbA).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(cx + px, cy + py, 1.2 + f * 1.4, 0, Math.PI * 2);
        ctx.fill();
      }

      // Planet satellites with enhanced orbits
      for (const planet of this.planets) {
        planet.angle += planet.speed * 0.014;
        const a = planet.angle;
        let px = Math.cos(a) * R * planet.dist;
        let py = Math.sin(a) * planet.orbitTilt * R * 0.8;
        let pz = Math.sin(a) * R * planet.dist;
        
        const yR = py * cosX - pz * sinX;
        const zR = py * sinX + pz * cosX;
        py = yR;
        pz = zR;
        
        const f = (1 - pz / (R * planet.dist)) * 0.5;
        const aA = planet.alpha * orbA * (0.4 + f * 0.6);
        
        ctx.shadowBlur = 20;
        ctx.shadowColor = "rgba(255,210,225,0.9)";
        ctx.fillStyle = `rgba(255,220,235,${aA.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(cx + px, cy + py, planet.r * (0.6 + f * 0.7), 0, Math.PI * 2);
        ctx.fill();
        
        // Planet glow
        const glowGrd = ctx.createRadialGradient(cx + px, cy + py, 0, cx + px, cy + py, planet.r * 3);
        glowGrd.addColorStop(0, `rgba(255,230,240,${(aA * 0.4).toFixed(3)})`);
        glowGrd.addColorStop(1, "rgba(255,230,240,0)");
        ctx.fillStyle = glowGrd;
        ctx.beginPath();
        ctx.arc(cx + px, cy + py, planet.r * 3, 0, Math.PI * 2);
        ctx.fill();
        
        if (planet.hasRing) {
          ctx.shadowBlur = 8;
          ctx.strokeStyle = `rgba(255,220,235,${(aA * 0.7).toFixed(3)})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.ellipse(cx + px, cy + py, planet.r * 2.8, planet.r * 0.8, planet.tilt + Math.PI / 5, 0, Math.PI * 2);
          ctx.stroke();
          // Second ring
          ctx.strokeStyle = `rgba(255,220,235,${(aA * 0.4).toFixed(3)})`;
          ctx.lineWidth = 0.6;
          ctx.beginPath();
          ctx.ellipse(cx + px, cy + py, planet.r * 3.4, planet.r * 1, planet.tilt + Math.PI / 5, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }

    ctx.shadowBlur = 0;
    this.rafId = requestAnimationFrame((next) => this.frame(next));
  }
}
