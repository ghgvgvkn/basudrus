/**
 * messageBg3d — the heavy Three.js renderer for AI message artifacts.
 *
 * Imported via dynamic import() in AIScreen so the ~470 KB Three.js
 * dependency only ships when the user actually views an AI message.
 * messageBg.ts holds the lightweight CSS-fallback path that's used
 * until this module resolves (and permanently if it never does — a
 * defensive fallback for old phones / no-WebGL).
 *
 * Renders ONCE per message ID to an offscreen canvas, snapshots as
 * a PNG data URL, and caches by `${messageId}:${persona}:${subject}`.
 * Long threads stay cheap (no per-frame GPU work) and the same seed
 * always produces the same artifact.
 */
import * as THREE from "three";
import type { AIPersona, AISubject } from "@/shared/types";
import { hash } from "./messageBg";

// ───────────────────────── cache ─────────────────────────

const cache = new Map<string, string>();

// ───────────────────────── util ─────────────────────────

/** Deterministic integer 0..n-1 from a seed + salt string. */
function pickInt(seed: number, salt: string, n: number) {
  const h = hash(`${seed}:${salt}`);
  return Math.floor(h * n);
}

/** Deterministic in-range RNG seeded per scene. */
function rng(seed: number) {
  let s = Math.floor(seed * 1e9) >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s & 0xffff) / 0xffff;
  };
}

// ───────────────────────── palettes ─────────────────────────

function palette(persona: AIPersona) {
  return persona === "omar"
    ? {
        a: new THREE.Color(0x5b4bf5),
        b: new THREE.Color(0x8a5cf7),
        c: new THREE.Color(0xc23f6c),
        bg: new THREE.Color(0x1a1230),
      }
    : {
        a: new THREE.Color(0x0e8a6b),
        b: new THREE.Color(0x3bc79e),
        c: new THREE.Color(0xf5c945),
        bg: new THREE.Color(0x0d3a30),
      };
}

// ───────────────────────── scene mapping ─────────────────────────

type SceneKind = "blob" | "ribbon" | "fractal" | "particles" | "liquid" | "grid" | "molecule";

const SCENE_BY_SUBJECT: Record<AISubject, SceneKind[]> = {
  math:      ["fractal", "grid", "ribbon"],
  cs:        ["grid", "fractal", "particles"],
  biology:   ["blob", "particles", "molecule"],
  chemistry: ["molecule", "blob", "particles"],
  physics:   ["particles", "grid", "ribbon"],
  languages: ["ribbon", "liquid", "blob"],
  history:   ["fractal", "ribbon", "molecule"],
  wellbeing: ["liquid", "blob", "particles"],
  general:   ["blob", "ribbon", "fractal", "particles", "liquid", "grid", "molecule"],
};

// ───────────────────────── public API ─────────────────────────

export function renderMessageBg(
  messageId: string,
  persona: AIPersona,
  subject: AISubject = "general",
  size = { w: 640, h: 400 },
): string {
  const key = `${messageId}:${persona}:${subject}:${size.w}x${size.h}`;
  const cached = cache.get(key);
  if (cached) return cached;

  try {
    const canvas = document.createElement("canvas");
    canvas.width = size.w;
    canvas.height = size.h;
    const renderer = new THREE.WebGLRenderer({
      canvas, alpha: true, antialias: true, preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(1);
    renderer.setSize(size.w, size.h, false);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, size.w / size.h, 0.1, 100);
    camera.position.set(0, 0, 5);

    const seed = hash(messageId);
    const r = rng(seed);
    const p = palette(persona);

    const pool = SCENE_BY_SUBJECT[subject] ?? SCENE_BY_SUBJECT.general;
    const kind = pool[pickInt(seed, "kind", pool.length)];

    const anchorX = (r() - 0.5) * 1.5;
    const anchorY = (r() - 0.5) * 1.0;
    const rootRot = r() * Math.PI * 2;
    camera.position.x = anchorX;
    camera.position.y = anchorY;
    camera.lookAt(0, 0, 0);

    const bg = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40),
      new THREE.MeshBasicMaterial({ color: p.bg }),
    );
    bg.position.z = -8;
    scene.add(bg);

    const root = new THREE.Group();
    root.rotation.z = rootRot;
    scene.add(root);

    const disposables: (THREE.Material | THREE.BufferGeometry)[] = [];
    switch (kind) {
      case "blob":      buildBlob(root, p, seed, r, disposables); break;
      case "ribbon":    buildRibbon(root, p, r, disposables); break;
      case "fractal":   buildFractal(root, p, r, disposables); break;
      case "particles": buildParticles(root, p, r, disposables); break;
      case "liquid":    buildLiquid(root, p, seed, disposables); break;
      case "grid":      buildGrid(root, p, r, disposables); break;
      case "molecule":  buildMolecule(root, p, r, disposables); break;
    }

    scene.add(new THREE.AmbientLight(0xffffff, 0.35));
    const key1 = new THREE.PointLight(p.a.getHex(), 1.4, 20);
    key1.position.set(3, 3, 4);
    scene.add(key1);
    const key2 = new THREE.PointLight(p.c.getHex(), 0.9, 20);
    key2.position.set(-3, -2, 3);
    scene.add(key2);

    renderer.setClearColor(0x000000, 0);
    renderer.render(scene, camera);
    const url = canvas.toDataURL("image/png");

    for (const d of disposables) d.dispose();
    renderer.dispose();

    cache.set(key, url);
    return url;
  } catch (err) {
    console.warn("[messageBg3d] render failed", err);
    const fallback = "";
    cache.set(key, fallback);
    return fallback;
  }
}

// ───────────────────────── scene builders ─────────────────────────

type Pal = ReturnType<typeof palette>;
type Rng = () => number;
type Dis = (THREE.Material | THREE.BufferGeometry)[];

function buildBlob(root: THREE.Group, p: Pal, seed: number, r: Rng, dis: Dis) {
  const geom = new THREE.IcosahedronGeometry(1.4, 30);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uSeed:   { value: seed },
      uAmp:    { value: 0.2 + r() * 0.35 },
      uFreq:   { value: 1.0 + r() * 1.8 },
      uA: { value: p.a }, uB: { value: p.b },
    },
    vertexShader: VS_NOISE,
    fragmentShader: FS_TWO_COLOR,
  });
  const m = new THREE.Mesh(geom, mat);
  m.rotation.set(r() * 6.28, r() * 6.28, r() * 6.28);
  root.add(m);
  dis.push(geom, mat);
}

function buildRibbon(root: THREE.Group, p: Pal, r: Rng, dis: Dis) {
  const curve = new THREE.CatmullRomCurve3(
    Array.from({ length: 6 }, (_, i) => new THREE.Vector3(
      Math.cos((i / 6) * Math.PI * 2 + r() * 2) * (1.5 + r()),
      Math.sin((i / 6) * Math.PI * 2 * 2 + r()) * (1.2 + r() * 0.8),
      (r() - 0.5) * 2,
    )),
    true,
    "catmullrom",
    0.6,
  );
  const geom = new THREE.TubeGeometry(curve, 220, 0.12 + r() * 0.12, 16, true);
  const mat = new THREE.MeshStandardMaterial({
    color: p.b, metalness: 0.4, roughness: 0.35, emissive: p.a, emissiveIntensity: 0.25,
  });
  const m = new THREE.Mesh(geom, mat);
  m.rotation.set(r() * 6.28, r() * 6.28, r() * 6.28);
  root.add(m);
  dis.push(geom, mat);
}

function buildFractal(root: THREE.Group, p: Pal, r: Rng, dis: Dis) {
  const geom = new THREE.TetrahedronGeometry(0.6, 0);
  const mat = new THREE.MeshStandardMaterial({
    color: p.a, metalness: 0.6, roughness: 0.3,
    emissive: p.c, emissiveIntensity: 0.15, flatShading: true,
  });
  dis.push(geom, mat);

  const place = (x: number, y: number, z: number, scale: number, depth: number) => {
    if (depth === 0 || scale < 0.08) return;
    const m = new THREE.Mesh(geom, mat);
    m.position.set(x, y, z);
    m.scale.setScalar(scale);
    m.rotation.set(r() * 6.28, r() * 6.28, r() * 6.28);
    root.add(m);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + r() * 0.4;
      place(
        x + Math.cos(a) * scale * 1.6,
        y + Math.sin(a) * scale * 1.6,
        z + (r() - 0.5) * scale,
        scale * 0.55,
        depth - 1,
      );
    }
  };
  place(0, 0, 0, 1.0, 4);
}

function buildParticles(root: THREE.Group, p: Pal, r: Rng, dis: Dis) {
  const count = 800 + Math.floor(r() * 1200);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const spread = 2.2 + r() * 1.2;
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2;
    const radius = Math.sqrt(1 - y * y);
    const theta = i * 2.399963;
    const rad = (0.5 + Math.pow(r(), 0.6) * 0.5) * spread;
    positions[i * 3 + 0] = Math.cos(theta) * radius * rad;
    positions[i * 3 + 1] = y * rad;
    positions[i * 3 + 2] = Math.sin(theta) * radius * rad;
    const t = r();
    const col = new THREE.Color().lerpColors(p.a, p.c, t);
    colors[i * 3 + 0] = col.r;
    colors[i * 3 + 1] = col.g;
    colors[i * 3 + 2] = col.b;
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geom.setAttribute("color",    new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    size: 0.05, vertexColors: true, transparent: true, opacity: 0.9,
    sizeAttenuation: true, depthWrite: false,
  });
  const pts = new THREE.Points(geom, mat);
  pts.rotation.set(r() * 6.28, r() * 6.28, r() * 6.28);
  root.add(pts);
  dis.push(geom, mat);
}

function buildLiquid(root: THREE.Group, p: Pal, seed: number, dis: Dis) {
  const geom = new THREE.PlaneGeometry(8, 5, 1, 1);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uSeed:   { value: seed },
      uA: { value: p.a }, uB: { value: p.b }, uC: { value: p.c },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: FS_LIQUID,
  });
  const m = new THREE.Mesh(geom, mat);
  m.position.z = -1.5;
  root.add(m);
  dis.push(geom, mat);
}

function buildGrid(root: THREE.Group, p: Pal, r: Rng, dis: Dis) {
  const n = 5 + Math.floor(r() * 4);
  const spacing = 0.45;
  const sphereGeom = new THREE.SphereGeometry(0.07, 12, 10);
  const mat = new THREE.MeshStandardMaterial({
    color: p.b, emissive: p.a, emissiveIntensity: 0.4, metalness: 0.5, roughness: 0.3,
  });
  dis.push(sphereGeom, mat);
  const off = (n - 1) * spacing * 0.5;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < 3; k++) {
    const m = new THREE.Mesh(sphereGeom, mat);
    m.position.set(i * spacing - off, j * spacing - off, (k - 1) * spacing);
    root.add(m);
  }
  const lineMat = new THREE.LineBasicMaterial({ color: p.c, transparent: true, opacity: 0.5 });
  dis.push(lineMat);
  for (let j = 0; j < n; j++) for (let k = 0; k < 3; k++) {
    const pts = [] as THREE.Vector3[];
    for (let i = 0; i < n; i++) pts.push(new THREE.Vector3(i * spacing - off, j * spacing - off, (k - 1) * spacing));
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    root.add(new THREE.Line(g, lineMat));
    dis.push(g);
  }
  root.rotation.set(r() * 0.6, r() * 1.2, r() * 0.5);
}

function buildMolecule(root: THREE.Group, p: Pal, r: Rng, dis: Dis) {
  const atomCount = 5 + Math.floor(r() * 6);
  const atomGeom = new THREE.SphereGeometry(0.24, 20, 16);
  const atomMat = new THREE.MeshStandardMaterial({
    color: p.b, metalness: 0.2, roughness: 0.3, emissive: p.a, emissiveIntensity: 0.25,
  });
  const bondMat = new THREE.MeshStandardMaterial({
    color: p.c, metalness: 0.6, roughness: 0.4,
  });
  dis.push(atomGeom, atomMat, bondMat);

  const atoms: THREE.Vector3[] = [];
  for (let i = 0; i < atomCount; i++) {
    const prev = atoms[atoms.length - 1] ?? new THREE.Vector3(0, 0, 0);
    const pos = prev.clone().add(new THREE.Vector3(
      (r() - 0.5) * 1.6, (r() - 0.5) * 1.6, (r() - 0.5) * 1.0,
    ));
    atoms.push(pos);
    const m = new THREE.Mesh(atomGeom, atomMat);
    m.position.copy(pos);
    root.add(m);
  }
  for (let i = 1; i < atoms.length; i++) {
    const a = atoms[i - 1], b = atoms[i];
    const dir = b.clone().sub(a);
    const len = dir.length();
    const bondGeom = new THREE.CylinderGeometry(0.05, 0.05, len, 8);
    dis.push(bondGeom);
    const bond = new THREE.Mesh(bondGeom, bondMat);
    bond.position.copy(a).add(dir.clone().multiplyScalar(0.5));
    bond.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    root.add(bond);
  }
  const centroid = atoms.reduce((acc, v) => acc.add(v), new THREE.Vector3()).multiplyScalar(1 / atoms.length);
  root.position.sub(centroid);
  root.rotation.set(r() * 6.28, r() * 6.28, r() * 6.28);
}

// ───────────────────────── shaders ─────────────────────────

const VS_NOISE = /* glsl */`
  uniform float uSeed;
  uniform float uAmp;
  uniform float uFreq;
  varying vec3 vNormal;
  varying float vNoise;

  vec3 mod289(vec3 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
  vec4 mod289(vec4 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
  vec4 permute(vec4 x){ return mod289(((x*34.0)+1.0)*x); }
  vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314*r; }

  float snoise(vec3 v){
    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i  = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute(permute(permute(
              i.z + vec4(0.0, i1.z, i2.z, 1.0))
            + i.y + vec4(0.0, i1.y, i2.y, 1.0))
            + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ *ns.x + ns.yyyy;
    vec4 y = y_ *ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0)*2.0 + 1.0;
    vec4 s1 = floor(b1)*2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
  }

  void main() {
    vNormal = normal;
    float n = snoise(normal * uFreq + uSeed * 10.0);
    vNoise = n;
    vec3 pos = position + normal * n * uAmp;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const FS_TWO_COLOR = /* glsl */`
  uniform vec3 uA;
  uniform vec3 uB;
  varying vec3 vNormal;
  varying float vNoise;
  void main() {
    float t = clamp(vNoise * 0.5 + 0.5, 0.0, 1.0);
    vec3 col = mix(uA, uB, t);
    float rim = pow(1.0 - abs(vNormal.z), 2.5);
    col += rim * 0.4;
    gl_FragColor = vec4(col, 1.0);
  }
`;

const FS_LIQUID = /* glsl */`
  uniform float uSeed;
  uniform vec3 uA;
  uniform vec3 uB;
  uniform vec3 uC;
  varying vec2 vUv;

  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float fbm(vec2 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) {
      s += vnoise(p) * a;
      p *= 2.1; a *= 0.5;
    }
    return s;
  }

  void main() {
    vec2 uv = vUv;
    float t = uSeed * 6.28;
    vec2 q = vec2(fbm(uv * 3.0 + t), fbm(uv * 3.0 - t));
    float n = fbm(uv * 4.0 + q * 2.0 + t);
    vec3 col = mix(uA, uB, smoothstep(0.25, 0.75, n));
    col = mix(col, uC, smoothstep(0.55, 0.95, n));
    float d = distance(uv, vec2(0.5, 0.45));
    col *= 1.0 - smoothstep(0.55, 0.9, d) * 0.45;
    gl_FragColor = vec4(col, 1.0);
  }
`;
