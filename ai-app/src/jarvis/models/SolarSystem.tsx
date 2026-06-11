/**
 * Solar System — Sun + 8 planets with orbital paths.
 *
 * Distances and sizes are NOT to scale (real proportions would put
 * the inner planets invisibly close to the Sun and the outer ones
 * off-screen). They're log-compressed for legibility — the goal is
 * a recognizable mental model, not an astronomy simulator.
 *
 * Each planet orbits at a speed inversely related to its distance
 * (rough Kepler proxy), so the inner planets visibly zip while the
 * outer ones drift slowly. Saturn gets a ring; the rest are spheres.
 */
import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import type { Group } from "three";
import type { ModelExplodeProps } from "../explode";

/** EXPLODED VIEW: how much the orbital radii grow at t=1. Planets
 *  and their orbit rings scale by the SAME factor so a planet never
 *  drifts off its painted orbit line. */
const ORBIT_EXPLODE_GAIN = 0.55;

interface PlanetSpec {
  name: string;
  radius: number;        // visual sphere radius
  distance: number;      // orbital radius (log-scaled, not AU)
  color: string;         // surface color
  emissive: string;      // glow color
  emissiveIntensity: number;
  orbitSpeed: number;    // rad/sec
  spinSpeed: number;     // rad/sec around own axis
  ring?: {
    inner: number;
    outer: number;
  };
}

const SUN_RADIUS = 1.4;

// Distances log-compressed: real AU values would put Neptune at
// 30× Mercury's distance, but visually that's a tiny dot in the
// center and a faint dot at the edge. We use a gentler growth.
const PLANETS: PlanetSpec[] = [
  { name: "Mercury", radius: 0.18, distance: 2.4,  color: "#a89c8e", emissive: "#3a342c", emissiveIntensity: 0.20, orbitSpeed: 0.95, spinSpeed: 0.40 },
  { name: "Venus",   radius: 0.30, distance: 3.0,  color: "#e8c98a", emissive: "#7a6238", emissiveIntensity: 0.25, orbitSpeed: 0.78, spinSpeed: 0.30 },
  { name: "Earth",   radius: 0.32, distance: 3.7,  color: "#4a90e2", emissive: "#1a3760", emissiveIntensity: 0.35, orbitSpeed: 0.65, spinSpeed: 0.90 },
  { name: "Mars",    radius: 0.22, distance: 4.4,  color: "#c46a3d", emissive: "#5a2a18", emissiveIntensity: 0.30, orbitSpeed: 0.55, spinSpeed: 0.70 },
  { name: "Jupiter", radius: 0.85, distance: 5.6,  color: "#d4a373", emissive: "#6a4e30", emissiveIntensity: 0.30, orbitSpeed: 0.38, spinSpeed: 1.40 },
  { name: "Saturn",  radius: 0.75, distance: 6.8,  color: "#e3c08f", emissive: "#6a5230", emissiveIntensity: 0.30, orbitSpeed: 0.30, spinSpeed: 1.20,
    ring: { inner: 1.0, outer: 1.55 } },
  { name: "Uranus",  radius: 0.50, distance: 7.9,  color: "#7ec0c0", emissive: "#2a5050", emissiveIntensity: 0.30, orbitSpeed: 0.22, spinSpeed: 0.50 },
  { name: "Neptune", radius: 0.48, distance: 8.9,  color: "#4d6dc7", emissive: "#1a2858", emissiveIntensity: 0.35, orbitSpeed: 0.16, spinSpeed: 0.60 },
];

export function SolarSystem({ explodeRef }: ModelExplodeProps) {
  const wholeRef = useRef<Group>(null);
  const orbitPathsRef = useRef<Group>(null);

  // Very slow whole-system rotation so the camera always sees a
  // slightly different orbit configuration. Exploded view: the orbit
  // path rings scale up in lockstep with the planets' radial push
  // (see Planet below) — the system spreads, Kepler speeds intact.
  useFrame((_, delta) => {
    if (wholeRef.current) {
      wholeRef.current.rotation.y += delta * 0.05;
    }
    if (orbitPathsRef.current) {
      const t = explodeRef?.current ?? 0;
      const s = 1 + t * ORBIT_EXPLODE_GAIN;
      for (const ring of orbitPathsRef.current.children) {
        ring.scale.setScalar(s);
      }
    }
  });

  return (
    <group ref={wholeRef}>
      {/* Sun — emissive sphere with a soft halo. */}
      <mesh>
        <sphereGeometry args={[SUN_RADIUS, 48, 48]} />
        <meshStandardMaterial
          color="#ffd770"
          emissive="#ff9430"
          emissiveIntensity={2.2}
          roughness={0.4}
        />
      </mesh>
      {/* Sun halo — bigger transparent sphere for the glow bloom. */}
      <mesh>
        <sphereGeometry args={[SUN_RADIUS * 1.6, 24, 24]} />
        <meshBasicMaterial color="#ffb050" transparent opacity={0.10} />
      </mesh>
      {/* Point light at the Sun's position to actually illuminate
          the planets from the center — the directional light from the
          scene wouldn't capture this "sun lighting up the system" vibe. */}
      <pointLight position={[0, 0, 0]} intensity={2.0} distance={20} decay={1.4} color="#ffd770" />

      {/* Orbital paths — thin torus rings at each planet's distance. */}
      <group ref={orbitPathsRef}>
        {PLANETS.map((p) => (
          <mesh key={`orbit-${p.name}`} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[p.distance, 0.008, 6, 96]} />
            <meshBasicMaterial color="#4a90e2" transparent opacity={0.20} />
          </mesh>
        ))}
      </group>

      {/* Planets — each one in its own orbiting group. */}
      {PLANETS.map((p) => (
        <Planet key={p.name} spec={p} explodeRef={explodeRef} />
      ))}
    </group>
  );
}

function Planet({ spec, explodeRef }: { spec: PlanetSpec } & ModelExplodeProps) {
  const orbitRef = useRef<Group>(null);
  const spinRef = useRef<Group>(null);
  const radialRef = useRef<Group>(null);

  // Stable random starting phase per planet so they don't all line
  // up on first paint. useMemo with empty deps locks the value
  // for this planet's lifetime.
  const startPhase = useMemo(() => Math.random() * Math.PI * 2, []);

  useFrame((state, delta) => {
    if (orbitRef.current) {
      // Initial position uses startPhase; subsequent frames just add
      // delta * speed. We could set absolute rotation each frame,
      // but additive is cheaper and the phase accumulates naturally.
      orbitRef.current.rotation.y += delta * spec.orbitSpeed;
      // Also apply the start phase once via a hidden trick: if this
      // is the first frame, rotation.y will be 0 + first delta. To
      // get phase variety, we offset rotation.y in the first useFrame
      // call using clock time (which started at 0 when the scene
      // mounted — same for all planets — but startPhase varies).
      if (state.clock.elapsedTime < 0.05) {
        orbitRef.current.rotation.y = startPhase;
      }
    }
    if (spinRef.current) {
      spinRef.current.rotation.y += delta * spec.spinSpeed;
    }
    if (radialRef.current) {
      // Exploded view — push the planet outward along its orbital
      // radius. Same factor as the painted orbit ring's scale.
      const t = explodeRef?.current ?? 0;
      radialRef.current.position.x = spec.distance * (1 + t * ORBIT_EXPLODE_GAIN);
    }
  });

  return (
    <group ref={orbitRef}>
      <group ref={radialRef} position={[spec.distance, 0, 0]}>
        <group ref={spinRef}>
          <mesh>
            <sphereGeometry args={[spec.radius, 28, 28]} />
            <meshStandardMaterial
              color={spec.color}
              emissive={spec.emissive}
              emissiveIntensity={spec.emissiveIntensity}
              roughness={0.85}
              metalness={0.10}
            />
          </mesh>
          {spec.ring && (
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <ringGeometry args={[
                spec.radius * spec.ring.inner,
                spec.radius * spec.ring.outer,
                64,
              ]} />
              <meshBasicMaterial
                color="#d4b88a"
                transparent
                opacity={0.65}
                side={2 /* DoubleSide */}
              />
            </mesh>
          )}
        </group>
      </group>
    </group>
  );
}
