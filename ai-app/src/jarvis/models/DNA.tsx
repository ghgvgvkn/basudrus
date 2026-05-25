/**
 * DNA — double helix with base-pair connectors.
 *
 * Procedural construction:
 *   - 60 vertical "steps" stacked along the Y axis
 *   - At each step, two backbone spheres on opposite sides of the
 *     helix (one for each strand) + a thin cylinder connecting them
 *     (the base pair)
 *   - The helix rotation is built directly into the step positioning
 *     using cos/sin around the y-axis; no Three.js helpers needed
 *
 * Color coding:
 *   - Strand A: cyan (Aurora's accent)
 *   - Strand B: warm rose (complementary)
 *   - Base pairs: muted blue with subtle glow
 */
import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import type { Group } from "three";

const STEPS = 64;             // vertical samples
const HELIX_RADIUS = 1.0;     // radius of each backbone
const HELIX_HEIGHT = 6.0;     // total height of the helix
const TURNS = 4;              // full rotations across the height
const BACKBONE_R = 0.18;      // sphere radius for backbone particles
const BASE_R = 0.05;          // bond cylinder radius

export function DNA() {
  const groupRef = useRef<Group>(null);

  // Stable per-step data — only computed once.
  const steps = useMemo(() => {
    const out: Array<{
      y: number;
      a: [number, number, number];
      b: [number, number, number];
    }> = [];
    for (let i = 0; i < STEPS; i++) {
      const t = i / (STEPS - 1); // 0..1
      const y = (t - 0.5) * HELIX_HEIGHT; // center vertically
      const angle = t * Math.PI * 2 * TURNS;
      const ax = Math.cos(angle) * HELIX_RADIUS;
      const az = Math.sin(angle) * HELIX_RADIUS;
      out.push({
        y,
        a: [ax, y, az],
        b: [-ax, y, -az],
      });
    }
    return out;
  }, []);

  useFrame((_, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 0.25;
    }
  });

  return (
    <group ref={groupRef}>
      {/* Backbone spheres — Strand A (cyan) */}
      {steps.map((s, i) => (
        <mesh key={`a-${i}`} position={s.a}>
          <sphereGeometry args={[BACKBONE_R, 12, 12]} />
          <meshStandardMaterial
            color="#a8d1ff"
            emissive="#4a90e2"
            emissiveIntensity={0.55}
            roughness={0.4}
            metalness={0.30}
          />
        </mesh>
      ))}
      {/* Backbone spheres — Strand B (rose) */}
      {steps.map((s, i) => (
        <mesh key={`b-${i}`} position={s.b}>
          <sphereGeometry args={[BACKBONE_R, 12, 12]} />
          <meshStandardMaterial
            color="#ff9eb5"
            emissive="#c46a8a"
            emissiveIntensity={0.55}
            roughness={0.4}
            metalness={0.30}
          />
        </mesh>
      ))}
      {/* Base pairs — thin cylinders connecting opposite strands.
          We draw them only every-other-step to reduce visual noise
          and match the stylized look (not anatomical). */}
      {steps.map((s, i) => {
        if (i % 2 !== 0) return null;
        return <BasePair key={`bp-${i}`} a={s.a} b={s.b} />;
      })}
    </group>
  );
}

/**
 * Renders a thin cylinder between two arbitrary points. Three.js
 * cylinders are Y-axis aligned by default, so we compute the
 * midpoint, the length, and the rotation needed to orient the
 * cylinder along the AB vector.
 */
function BasePair({ a, b }: { a: [number, number, number]; b: [number, number, number] }) {
  const { mid, length, rotation } = useMemo(() => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dz = b[2] - a[2];
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const midpoint: [number, number, number] = [
      (a[0] + b[0]) / 2,
      (a[1] + b[1]) / 2,
      (a[2] + b[2]) / 2,
    ];
    // Aim the Y-axis-aligned cylinder along (b - a).
    // For our use case (a and b are mirror-positioned around y-axis
    // with same y), the bond is horizontal — rotate around Z by 90°
    // then around Y by the angle of the projected vector.
    const ang = Math.atan2(dz, dx);
    const rot: [number, number, number] = [0, ang, Math.PI / 2];
    return { mid: midpoint, length: len, rotation: rot };
  }, [a, b]);

  return (
    <mesh position={mid} rotation={rotation}>
      <cylinderGeometry args={[BASE_R, BASE_R, length, 8]} />
      <meshStandardMaterial
        color="#7ec0c0"
        emissive="#2a5050"
        emissiveIntensity={0.35}
        roughness={0.6}
      />
    </mesh>
  );
}
