/**
 * Atom — Carbon (6 protons, 6 neutrons, 6 electrons in 2 shells).
 *
 * Procedural construction:
 *   - Nucleus = cluster of 12 small spheres (red protons + grey neutrons)
 *     packed tightly using a simple golden-angle distribution on a sphere
 *   - Electron shells = three torus rings tilted at different angles
 *   - Electrons = small glowing cyan spheres orbiting along the rings
 *
 * Why Carbon: smallest atom with multiple shells (so the visualization
 * actually shows "shells"), without being so big the geometry feels
 * cramped at viewer scale.
 *
 * Cyan glow on electrons via emissive material — keeps the JARVIS
 * aesthetic consistent with the rest of Aurora.
 */
import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { Group, Mesh } from "three";
import type { ModelExplodeProps } from "../explode";

/** Cyan accent that ties the model into Aurora's JARVIS palette. */
const ACCENT_CYAN = "#4a90e2";
const ACCENT_CYAN_HOT = "#a8d1ff";

/** Generate N evenly-distributed points on a unit sphere using the
 *  Fibonacci-spiral algorithm. Cheap, deterministic, and good
 *  enough for a stylized nucleus where we don't need physics. */
function fibSphere(n: number): Array<[number, number, number]> {
  const pts: Array<[number, number, number]> = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / Math.max(1, n - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const a = golden * i;
    pts.push([Math.cos(a) * r, y, Math.sin(a) * r]);
  }
  return pts;
}

const NUCLEUS_RADIUS = 0.55;
// Nucleus particle radius — sized so 12 particles tile snugly inside
// the nucleus volume without too much overlap.
const PARTICLE_R = 0.22;
const NUCLEON_PACK = 0.35; // distance from center for the particles

const PROTONS = 6;
const NEUTRONS = 6;
// Pre-compute the proton + neutron positions once at module load.
// Doing this in render would re-allocate ~12 arrays per frame for
// no visual benefit.
const NUCLEONS = fibSphere(PROTONS + NEUTRONS).map(([x, y, z], i) => ({
  pos: [x * NUCLEON_PACK, y * NUCLEON_PACK, z * NUCLEON_PACK] as [number, number, number],
  /** Unit direction from nucleus center — the EXPLODED VIEW scatters
   *  each nucleon outward along its own ray. */
  dir: [x, y, z] as [number, number, number],
  isProton: i < PROTONS,
}));

/** Exploded-view travel: how far a nucleon scatters at t=1. */
const NUCLEON_EXPLODE_TRAVEL = 1.15;

interface ElectronShell {
  radius: number;
  tiltX: number;
  tiltZ: number;
  /** Electron positions on this ring, as fractions of 2π */
  electronPhases: number[];
  /** rad/sec — speed of electrons around this ring */
  speed: number;
}

const SHELLS: ElectronShell[] = [
  // Inner shell — 2 electrons (Carbon's K shell)
  { radius: 1.5, tiltX: 0, tiltZ: 0, electronPhases: [0, 0.5], speed: 1.6 },
  // Outer shell — 4 electrons (Carbon's L shell)
  { radius: 2.6, tiltX: 1.1, tiltZ: 0.7, electronPhases: [0, 0.25, 0.5, 0.75], speed: 1.0 },
];

export function Atom({ explodeRef }: ModelExplodeProps) {
  const groupRef = useRef<Group>(null);
  const nucleonsRef = useRef<Group>(null);
  const glowRef = useRef<Mesh>(null);

  // Gentle whole-model rotation so even when the user isn't dragging
  // with OrbitControls, the atom doesn't sit perfectly still.
  // EXPLODED VIEW (t = explodeRef.current, 0..1): nucleons scatter
  // outward along their own sphere rays; the core glow fades as the
  // nucleus comes apart. All imperative ref mutation — no React
  // state at frame rate (weak-MacBook rule).
  useFrame((_, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 0.12;
    }
    const t = explodeRef?.current ?? 0;
    if (nucleonsRef.current) {
      const kids = nucleonsRef.current.children;
      const d = NUCLEON_PACK + t * NUCLEON_EXPLODE_TRAVEL;
      for (let i = 0; i < kids.length && i < NUCLEONS.length; i++) {
        const dir = NUCLEONS[i].dir;
        kids[i].position.set(dir[0] * d, dir[1] * d, dir[2] * d);
      }
    }
    if (glowRef.current) {
      const s = Math.max(0.001, 1 - t * 0.85);
      glowRef.current.scale.setScalar(s);
    }
  });

  return (
    <group ref={groupRef}>
      {/* Nucleus particles */}
      <group ref={nucleonsRef}>
        {NUCLEONS.map((n, i) => (
          <mesh key={`nucleon-${i}`} position={n.pos}>
            <sphereGeometry args={[PARTICLE_R, 18, 18]} />
            <meshStandardMaterial
              color={n.isProton ? "#ff6b8a" : "#bcbcc4"}
              emissive={n.isProton ? "#7a2e3f" : "#3a3a40"}
              emissiveIntensity={0.45}
              roughness={0.55}
              metalness={0.20}
            />
          </mesh>
        ))}
      </group>

      {/* Soft inner glow at the nucleus center — gives the cluster
          a "core energy" feel without needing a heavy bloom pass. */}
      <mesh ref={glowRef}>
        <sphereGeometry args={[NUCLEUS_RADIUS * 0.7, 16, 16]} />
        <meshBasicMaterial color={ACCENT_CYAN_HOT} transparent opacity={0.20} />
      </mesh>

      {/* Each shell: a torus ring + the orbiting electron spheres.
          Exploded: shells push outward in tiers (outer travels more)
          so the K/L structure reads at a glance. */}
      {SHELLS.map((shell, si) => (
        <ElectronShellG
          key={`shell-${si}`}
          shell={shell}
          explodeRef={explodeRef}
          explodeGain={0.45 + si * 0.4}
        />
      ))}
    </group>
  );
}

function ElectronShellG({
  shell,
  explodeRef,
  explodeGain,
}: { shell: ElectronShell; explodeGain: number } & ModelExplodeProps) {
  const ringRef = useRef<Group>(null);
  const electronsRef = useRef<Group>(null);

  // Each shell rotates the entire ring (so the visual "tilt" sweeps)
  // and orbits its electrons around the ring's center. Exploded view
  // scales the whole shell group — ring AND electrons push out
  // together, so electrons never leave their orbit line.
  useFrame((state, delta) => {
    if (ringRef.current) {
      ringRef.current.rotation.x = shell.tiltX;
      ringRef.current.rotation.z = shell.tiltZ;
      const t = explodeRef?.current ?? 0;
      ringRef.current.scale.setScalar(1 + t * explodeGain);
    }
    if (electronsRef.current) {
      electronsRef.current.rotation.y += delta * shell.speed;
      // unused but kept for future "wobble" if we want it
      void state.clock;
    }
  });

  return (
    <group ref={ringRef}>
      {/* Faint orbital ring — drawn as a thin torus so it has actual
          geometry (lines don't shade with the rest of the scene). */}
      <mesh>
        <torusGeometry args={[shell.radius, 0.012, 8, 96]} />
        <meshBasicMaterial color={ACCENT_CYAN} transparent opacity={0.30} />
      </mesh>

      {/* Electron group — rotated as one so all electrons on this
          shell orbit at the same speed but at fixed phase offsets. */}
      <group ref={electronsRef}>
        {shell.electronPhases.map((phase, i) => {
          const a = phase * Math.PI * 2;
          const x = Math.cos(a) * shell.radius;
          const z = Math.sin(a) * shell.radius;
          return (
            <mesh key={`e-${i}`} position={[x, 0, z]}>
              <sphereGeometry args={[0.14, 16, 16]} />
              <meshStandardMaterial
                color={ACCENT_CYAN_HOT}
                emissive={ACCENT_CYAN}
                emissiveIntensity={1.6}
                roughness={0.20}
                metalness={0.60}
              />
            </mesh>
          );
        })}
      </group>
    </group>
  );
}
