/**
 * Human heart — stylized 4-chamber model with a beating pulse.
 *
 * Procedural construction:
 *   - Main body: union of two large rounded chambers (left + right
 *     ventricles), approximated as two scaled spheres positioned
 *     side-by-side and slightly intersecting
 *   - Atria: two smaller spheres atop the ventricles
 *   - Aorta arch: torus segment exiting the top
 *   - Pulmonary trunk: smaller torus segment
 *   - Vena cava: cylinder entering the right atrium
 *
 * NOT anatomically precise. The goal is "recognizable heart shape
 * with the four chambers" for a student. The beating pulse is a
 * uniform scale animation on the whole group, simulating a single
 * scaled-down systolic squeeze every ~0.85s (≈70 bpm at rest).
 */
import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { Group, Mesh } from "three";

const BPM = 72;
const BEAT_PERIOD = 60 / BPM; // seconds per beat

export function Heart() {
  const groupRef = useRef<Group>(null);
  const innerRef = useRef<Group>(null);

  useFrame((state, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 0.15;
    }
    if (innerRef.current) {
      // Beating pulse — a sharp contraction + slow release per cycle.
      // Wave shape: spike at the start of the cycle, falling back to
      // resting. We use Math.exp on a phase value for the rapid
      // contract-then-relax curve.
      const phase = (state.clock.elapsedTime % BEAT_PERIOD) / BEAT_PERIOD;
      // Exponential decay from a peak; gives the "thump" feel
      const beat = Math.exp(-phase * 6) * 0.10;
      const scale = 1 - beat;
      innerRef.current.scale.set(scale, scale, scale);
    }
  });

  return (
    <group ref={groupRef}>
      <group ref={innerRef}>
        {/* Left ventricle — larger lower-left chamber */}
        <ChamberSphere
          position={[-0.55, -0.3, 0]}
          scale={[1.2, 1.5, 1.1]}
          color="#d04848"
          emissive="#7a1818"
        />
        {/* Right ventricle — smaller lower-right chamber */}
        <ChamberSphere
          position={[0.55, -0.3, 0]}
          scale={[1.05, 1.4, 1.0]}
          color="#b03838"
          emissive="#6a1414"
        />
        {/* Left atrium */}
        <ChamberSphere
          position={[-0.5, 1.0, 0]}
          scale={[0.85, 0.75, 0.85]}
          color="#9b3030"
          emissive="#5a1010"
        />
        {/* Right atrium */}
        <ChamberSphere
          position={[0.55, 1.0, 0]}
          scale={[0.85, 0.75, 0.85]}
          color="#9b3030"
          emissive="#5a1010"
        />

        {/* Aorta arch — large torus segment over the left atrium,
            curving toward the back of the body. */}
        <mesh position={[-0.7, 1.65, 0]} rotation={[Math.PI / 2, 0, Math.PI / 6]}>
          <torusGeometry args={[0.55, 0.18, 12, 24, Math.PI]} />
          <meshStandardMaterial
            color="#e0a5a5"
            emissive="#7a4848"
            emissiveIntensity={0.40}
            roughness={0.55}
          />
        </mesh>

        {/* Pulmonary trunk — smaller arch on the right */}
        <mesh position={[0.55, 1.55, 0]} rotation={[Math.PI / 2, 0, -Math.PI / 8]}>
          <torusGeometry args={[0.40, 0.14, 10, 20, Math.PI]} />
          <meshStandardMaterial
            color="#a0b8e0"
            emissive="#3858a0"
            emissiveIntensity={0.40}
            roughness={0.55}
          />
        </mesh>

        {/* Superior vena cava — cylinder entering right atrium */}
        <mesh position={[0.95, 1.7, 0]} rotation={[0, 0, Math.PI / 12]}>
          <cylinderGeometry args={[0.18, 0.18, 0.9, 16]} />
          <meshStandardMaterial
            color="#7090c4"
            emissive="#284870"
            emissiveIntensity={0.40}
            roughness={0.55}
          />
        </mesh>

        {/* Inferior vena cava — smaller cylinder under right atrium */}
        <mesh position={[0.95, -1.7, 0]} rotation={[0, 0, Math.PI / 10]}>
          <cylinderGeometry args={[0.15, 0.15, 0.7, 16]} />
          <meshStandardMaterial
            color="#7090c4"
            emissive="#284870"
            emissiveIntensity={0.40}
            roughness={0.55}
          />
        </mesh>

        {/* Soft red halo for the "heart glow" feel */}
        <mesh>
          <sphereGeometry args={[2.4, 16, 16]} />
          <meshBasicMaterial color="#ff4848" transparent opacity={0.06} />
        </mesh>
      </group>
    </group>
  );
}

interface ChamberProps {
  position: [number, number, number];
  scale: [number, number, number];
  color: string;
  emissive: string;
}

function ChamberSphere({ position, scale, color, emissive }: ChamberProps) {
  const meshRef = useRef<Mesh>(null);
  return (
    <mesh ref={meshRef} position={position} scale={scale}>
      <sphereGeometry args={[1, 32, 32]} />
      <meshStandardMaterial
        color={color}
        emissive={emissive}
        emissiveIntensity={0.45}
        roughness={0.50}
        metalness={0.20}
      />
    </mesh>
  );
}
