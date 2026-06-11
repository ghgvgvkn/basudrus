/**
 * Water molecule — H₂O.
 *
 * Procedural construction:
 *   - 1 oxygen sphere at origin (larger, red)
 *   - 2 hydrogen spheres positioned at the real bond angle of
 *     104.5° relative to oxygen (smaller, white)
 *   - Bond cylinders connecting O to each H
 *
 * The 104.5° angle is the actual experimentally-measured H-O-H
 * angle. Bond length is stylized for visibility.
 */
import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import type { Group, Mesh, MeshStandardMaterial } from "three";
import type { ModelExplodeProps } from "../explode";

const BOND_LENGTH = 1.6;
const BOND_ANGLE_DEG = 104.5;
const O_RADIUS = 0.65;
const H_RADIUS = 0.38;
const BOND_R = 0.07;

/** EXPLODED VIEW: how far each hydrogen drifts along its own O-H
 *  bond direction at t=1 (in addition to the bond length). */
const H_EXPLODE_TRAVEL = 1.5;

export function Water({ explodeRef }: ModelExplodeProps) {
  const groupRef = useRef<Group>(null);
  const hydrogensRef = useRef<Group>(null);
  const bondsRef = useRef<Group>(null);

  // Hydrogen positions — symmetric around the Y axis, in the XY plane.
  // Half-angle from vertical = (180° - 104.5°) / 2 = 37.75°
  // Wait: actually the H-O-H angle is the angle BETWEEN the two
  // bonds. So each bond is half that angle off-axis from the
  // bisector. Bisector points DOWN from O (we put H's below O so
  // the molecule reads "open mouth" facing the viewer).
  // Half angle from down-axis = 104.5° / 2 = 52.25°
  const positions = useMemo(() => {
    const halfRad = (BOND_ANGLE_DEG / 2) * (Math.PI / 180);
    // Bisector points in -Y direction; H positions = -Y rotated by ±halfRad around Z.
    // Working in 2D (XY plane), starting from (0, -1) and rotating by halfRad:
    //   x = sin(halfRad), y = -cos(halfRad)
    const hx = Math.sin(halfRad) * BOND_LENGTH;
    const hy = -Math.cos(halfRad) * BOND_LENGTH;
    const h1: [number, number, number] = [hx, hy, 0];
    const h2: [number, number, number] = [-hx, hy, 0];
    return { h1, h2 };
  }, []);

  // EXPLODED VIEW: hydrogens drift outward along their own real bond
  // directions (dissociation), the covalent bonds fade as they break.
  // Oxygen anchors the center.
  useFrame((_, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 0.30;
    }
    const t = explodeRef?.current ?? 0;
    if (hydrogensRef.current) {
      const stretch = 1 + (t * H_EXPLODE_TRAVEL) / BOND_LENGTH;
      const kids = hydrogensRef.current.children;
      const bases = [positions.h1, positions.h2];
      for (let i = 0; i < kids.length && i < bases.length; i++) {
        const b = bases[i];
        kids[i].position.set(b[0] * stretch, b[1] * stretch, b[2] * stretch);
      }
    }
    if (bondsRef.current) {
      const opacity = Math.max(0, 1 - t * 1.9);
      for (const child of bondsRef.current.children) {
        const mat = (child as Mesh).material as MeshStandardMaterial;
        if (mat.opacity !== opacity) mat.opacity = opacity;
        child.visible = opacity > 0.01;
      }
    }
  });

  return (
    <group ref={groupRef}>
      {/* Oxygen — red, slightly bigger */}
      <mesh>
        <sphereGeometry args={[O_RADIUS, 32, 32]} />
        <meshStandardMaterial
          color="#ff5b6e"
          emissive="#7a1f2f"
          emissiveIntensity={0.50}
          roughness={0.35}
          metalness={0.30}
        />
      </mesh>

      {/* Hydrogens — white-ish, smaller */}
      <group ref={hydrogensRef}>
        {[positions.h1, positions.h2].map((p, i) => (
          <mesh key={`h-${i}`} position={p}>
            <sphereGeometry args={[H_RADIUS, 24, 24]} />
            <meshStandardMaterial
              color="#f0f4ff"
              emissive="#8ea8d0"
              emissiveIntensity={0.45}
              roughness={0.35}
              metalness={0.30}
            />
          </mesh>
        ))}
      </group>

      {/* O-H bonds — cylinders from origin to each hydrogen */}
      <group ref={bondsRef}>
        <Bond from={[0, 0, 0]} to={positions.h1} />
        <Bond from={[0, 0, 0]} to={positions.h2} />
      </group>
    </group>
  );
}

/** Y-axis-aligned cylinder rotated to lie along an arbitrary vector. */
function Bond({ from, to }: { from: [number, number, number]; to: [number, number, number] }) {
  const { pos, len, rot } = useMemo(() => {
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const dz = to[2] - from[2];
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const midpoint: [number, number, number] = [
      (from[0] + to[0]) / 2,
      (from[1] + to[1]) / 2,
      (from[2] + to[2]) / 2,
    ];
    // Cylinders are Y-aligned. We need to rotate so the Y axis
    // points along (to - from). Compute the rotation that takes
    // (0,1,0) to the normalized direction. Using axis-angle math:
    // axis = (0,1,0) × dir, angle = acos((0,1,0) · dir).
    const dirX = dx / length;
    const dirY = dy / length;
    const dirZ = dz / length;
    // Axis = (1*dirZ - 0*dirY, 0*dirX - 0*dirZ, 0*dirY - 1*dirX) = (dirZ, 0, -dirX)
    const axisX = dirZ;
    const axisZ = -dirX;
    const axisLen = Math.hypot(axisX, axisZ);
    const angle = Math.acos(Math.max(-1, Math.min(1, dirY)));
    // If axis is zero (dir is parallel to Y), no rotation needed
    if (axisLen < 1e-6) {
      // dir is exactly +Y or -Y. If -Y, rotate π around X.
      const rot0: [number, number, number] = dirY > 0 ? [0, 0, 0] : [Math.PI, 0, 0];
      return { pos: midpoint, len: length, rot: rot0 };
    }
    // Convert axis-angle to Euler-XYZ (approximate — for our use
    // case the bond directions are well-defined and this gives
    // visually correct results).
    // Quaternion: q = (cos(a/2), sin(a/2) * axis_normalized)
    const ax = axisX / axisLen;
    const az = axisZ / axisLen;
    const half = angle / 2;
    const s = Math.sin(half);
    const qw = Math.cos(half);
    const qx = ax * s;
    const qy = 0;
    const qz = az * s;
    // Convert to Euler XYZ
    const sinp = 2 * (qw * qy - qz * qx);
    const pitch = Math.abs(sinp) >= 1
      ? (Math.PI / 2) * Math.sign(sinp)
      : Math.asin(sinp);
    const yaw = Math.atan2(2 * (qw * qz + qx * qy), 1 - 2 * (qy * qy + qz * qz));
    const roll = Math.atan2(2 * (qw * qx + qy * qz), 1 - 2 * (qx * qx + qy * qy));
    return { pos: midpoint, len: length, rot: [roll, pitch, yaw] as [number, number, number] };
  }, [from, to]);

  return (
    <mesh position={pos} rotation={rot}>
      <cylinderGeometry args={[BOND_R, BOND_R, len, 12]} />
      {/* transparent so the exploded view can fade the bond as it
          breaks (opacity driven per-frame by Water). */}
      <meshStandardMaterial
        color="#a8d1ff"
        emissive="#4a90e2"
        emissiveIntensity={0.35}
        roughness={0.5}
        transparent
        opacity={1}
      />
    </mesh>
  );
}
