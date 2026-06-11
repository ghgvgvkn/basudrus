/**
 * Animal cell — stylized cross-section view.
 *
 * Procedural construction:
 *   - Outer membrane: large translucent sphere
 *   - Nucleus: dense sphere with a nucleolus inside
 *   - Mitochondria (3): elongated capsule-like ellipsoids
 *   - Endoplasmic reticulum: a folded ribbon (approximated as
 *     several small tube segments)
 *   - Ribosomes: small dots scattered on the ER + nuclear envelope
 *   - Golgi apparatus: stacked flat discs
 *   - Vacuoles (2): small translucent spheres
 *
 * NOT anatomically precise — the goal is "recognizable cell mental
 * model" for a student, not biology textbook accuracy.
 *
 * EXPLODED VIEW (explodeRef, 0..1): the organelles radiate outward
 * from the cell center along their own resting-position rays while
 * the membrane fades, so a student can see each part on its own.
 * The nucleus stays anchored at center as the reference point.
 */
import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import type { Group, Mesh, Material, Vector3 } from "three";
import type { ModelExplodeProps } from "../explode";

const CELL_RADIUS = 3.5;

/** EXPLODED VIEW: organelles radiate outward from the cell center by
 *  this factor of their resting distance at t=1. */
const ORGANELLE_EXPLODE_GAIN = 0.95;

export function AnimalCell({ explodeRef }: ModelExplodeProps) {
  const groupRef = useRef<Group>(null);
  const organellesRef = useRef<Group>(null);
  const membraneRef = useRef<Group>(null);
  // Base positions of each organelle, captured once on first frame so
  // the explode push is relative to the resting layout (not cumulative).
  const basePosRef = useRef<Vector3[] | null>(null);

  // Stable random positions for ribosomes so they don't move each
  // frame. Computed once at mount, scattered on the surface of a
  // nuclear envelope and along the ER ribbon path.
  const ribosomePositions = useMemo(() => {
    const out: Array<[number, number, number]> = [];
    // Around nucleus (radius 1.1)
    for (let i = 0; i < 18; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 1.15;
      out.push([
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.sin(phi) * Math.sin(theta) + 0.2,
        r * Math.sin(phi) * Math.sin(theta) * 0 + r * Math.cos(phi),
      ]);
    }
    return out;
  }, []);

  useFrame((_, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 0.10;
    }
    const t = explodeRef?.current ?? 0;
    if (organellesRef.current) {
      const kids = organellesRef.current.children;
      // Capture resting positions once, in JSX child order.
      if (!basePosRef.current) {
        basePosRef.current = kids.map((k) => k.position.clone());
      }
      const bases = basePosRef.current;
      const f = 1 + t * ORGANELLE_EXPLODE_GAIN;
      for (let i = 0; i < kids.length && i < bases.length; i++) {
        kids[i].position.copy(bases[i]).multiplyScalar(f);
      }
    }
    if (membraneRef.current) {
      // The membrane fades as the cell comes apart, so it doesn't hide
      // the now-separated organelles behind a boundary sphere.
      const fade = Math.max(0, 1 - t * 1.4);
      for (const child of membraneRef.current.children) {
        const mat = (child as Mesh).material as Material & {
          opacity: number;
          userData: { baseOpacity?: number };
        };
        if (mat.userData.baseOpacity == null) mat.userData.baseOpacity = mat.opacity;
        mat.opacity = mat.userData.baseOpacity * fade;
        child.visible = mat.opacity > 0.005;
      }
    }
  });

  return (
    <group ref={groupRef}>
      {/* Cell membrane — fades out in the exploded view. */}
      <group ref={membraneRef}>
        {/* Large translucent sphere. Bigger than anything inside so
            we see the boundary. */}
        <mesh>
          <sphereGeometry args={[CELL_RADIUS, 32, 32]} />
          <meshStandardMaterial
            color="#88a0c4"
            transparent
            opacity={0.10}
            emissive="#2a4070"
            emissiveIntensity={0.20}
            roughness={0.40}
            metalness={0.10}
          />
        </mesh>
        {/* Thin outer membrane line — slightly bigger transparent
            sphere with no fill (basic material at low opacity). */}
        <mesh>
          <sphereGeometry args={[CELL_RADIUS * 1.005, 24, 24]} />
          <meshBasicMaterial color="#4a90e2" transparent opacity={0.18} wireframe />
        </mesh>
      </group>

      {/* Nucleus — center sphere. Stays anchored as the reference
          point while everything else flies outward. */}
      <group position={[0, 0.2, 0]}>
        <mesh>
          <sphereGeometry args={[1.0, 28, 28]} />
          <meshStandardMaterial
            color="#7e6cc4"
            emissive="#3a2a78"
            emissiveIntensity={0.45}
            roughness={0.55}
            metalness={0.15}
          />
        </mesh>
        {/* Nucleolus — denser dot inside */}
        <mesh position={[0.25, 0.1, 0.20]}>
          <sphereGeometry args={[0.30, 18, 18]} />
          <meshStandardMaterial
            color="#bda5ff"
            emissive="#7e5fcf"
            emissiveIntensity={0.55}
            roughness={0.55}
          />
        </mesh>
        {/* Nuclear-envelope ribosomes — small particles around */}
        {ribosomePositions.map((p, i) => (
          <mesh key={`r-${i}`} position={p}>
            <sphereGeometry args={[0.06, 8, 8]} />
            <meshStandardMaterial
              color="#a8d1ff"
              emissive="#4a90e2"
              emissiveIntensity={0.8}
            />
          </mesh>
        ))}
      </group>

      {/* Organelles — each a direct child of this group so the
          explode loop can radiate them by index. Order here IS the
          capture order (mito ×3, ER, golgi, vacuole ×2). */}
      <group ref={organellesRef}>
        {/* Mitochondria (3) — elongated capsules. */}
        {[
          { pos: [1.8, 0.6, 0.5] as [number, number, number], rot: [0.3, 0.5, 0.4] as [number, number, number] },
          { pos: [-1.6, -0.3, 1.0] as [number, number, number], rot: [0.1, -0.8, -0.2] as [number, number, number] },
          { pos: [0.3, -1.5, -1.0] as [number, number, number], rot: [0.6, 0.2, 0.7] as [number, number, number] },
        ].map((m, i) => (
          <mesh key={`mito-${i}`} position={m.pos} rotation={m.rot}>
            <capsuleGeometry args={[0.30, 0.8, 8, 16]} />
            <meshStandardMaterial
              color="#ff9b6e"
              emissive="#7a3a18"
              emissiveIntensity={0.50}
              roughness={0.55}
            />
          </mesh>
        ))}

        {/* Endoplasmic reticulum — folded ribbon of tube segments. */}
        <group position={[1.5, -0.5, -1.2]} rotation={[0.4, 0.7, 0.1]}>
          {[0, 1, 2, 3].map((i) => (
            <mesh key={`er-${i}`} position={[i * 0.40 - 0.6, Math.sin(i) * 0.15, 0]}>
              <torusGeometry args={[0.35, 0.06, 8, 24]} />
              <meshStandardMaterial
                color="#6ed0c4"
                emissive="#2a6e60"
                emissiveIntensity={0.40}
                roughness={0.55}
              />
            </mesh>
          ))}
        </group>

        {/* Golgi apparatus — stacked flat discs. */}
        <group position={[-1.8, 1.0, -0.5]} rotation={[0.3, 0.4, -0.2]}>
          {[0, 1, 2, 3].map((i) => (
            <mesh key={`golgi-${i}`} position={[0, i * 0.15 - 0.225, 0]}>
              <cylinderGeometry args={[0.45 - i * 0.05, 0.45 - i * 0.05, 0.06, 32]} />
              <meshStandardMaterial
                color="#ffd58a"
                emissive="#7a5018"
                emissiveIntensity={0.40}
                roughness={0.55}
              />
            </mesh>
          ))}
        </group>

        {/* Vacuoles — translucent bubbles. */}
        {[
          [-1.0, -1.5, 1.3] as [number, number, number],
          [1.4, 1.7, 0.8] as [number, number, number],
        ].map((p, i) => (
          <mesh key={`vac-${i}`} position={p}>
            <sphereGeometry args={[0.45, 20, 20]} />
            <meshStandardMaterial
              color="#a0e0f5"
              transparent
              opacity={0.45}
              emissive="#3a7a90"
              emissiveIntensity={0.30}
              roughness={0.20}
            />
          </mesh>
        ))}
      </group>
    </group>
  );
}
