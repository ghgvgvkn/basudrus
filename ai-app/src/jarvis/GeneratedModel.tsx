/**
 * GeneratedModel — renders a runtime .glb from the text-to-3D pipeline
 * inside JarvisView's existing Canvas.
 *
 * HOLO TREATMENT: Meshy preview meshes arrive as untextured gray clay.
 * Instead of apologizing for that, we lean in — every mesh gets the
 * JARVIS hologram material (cyan-tinted, emissive, slightly metallic),
 * so a generated engine looks like Tony pulled it out of the workshop
 * archive, not like a half-finished asset.
 *
 * AUTO-FIT: generated models come at arbitrary scale/offset. We
 * compute the bounding box once after parse, recenter to origin, and
 * scale the longest side to a fixed stage size so EVERY generation
 * fills the viewer the same way the procedural models do.
 *
 * REAL TELEMETRY: vertex count is summed from the actual parsed
 * geometry and reported up for the HUD chip — never decorative.
 */
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { Box3, Color, Group, Mesh, MeshStandardMaterial, Vector3 } from "three";

/** Longest dimension of the fitted model, in scene units — sized so
 *  the default camera (z≈6) frames it like the procedural models. */
const STAGE_SIZE = 4;

const HOLO_COLOR = new Color("#9fd8ff");
const HOLO_EMISSIVE = new Color("#1a5f8a");

export function GeneratedModel({
  url,
  onStats,
}: {
  url: string;
  onStats?: (stats: { vertices: number; meshes: number }) => void;
}) {
  const groupRef = useRef<Group>(null);
  const { scene } = useGLTF(url);

  // Fit + reskin once per parsed scene. useMemo (not useEffect) so the
  // transform is in place before the first paint — no pop.
  const stats = useMemo(() => {
    let vertices = 0;
    let meshes = 0;
    scene.traverse((obj) => {
      if ((obj as Mesh).isMesh) {
        const mesh = obj as Mesh;
        meshes += 1;
        const pos = mesh.geometry?.attributes?.position;
        if (pos) vertices += pos.count;
        // Holo reskin — replace whatever Meshy shipped.
        mesh.material = new MeshStandardMaterial({
          color: HOLO_COLOR,
          emissive: HOLO_EMISSIVE,
          emissiveIntensity: 0.55,
          roughness: 0.45,
          metalness: 0.35,
        });
      }
    });
    // Recenter + normalize scale.
    const box = new Box3().setFromObject(scene);
    const size = box.getSize(new Vector3());
    const center = box.getCenter(new Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const fit = STAGE_SIZE / maxDim;
    scene.position.set(-center.x * fit, -center.y * fit, -center.z * fit);
    scene.scale.setScalar(fit);
    return { vertices, meshes };
  }, [scene]);

  useEffect(() => {
    onStats?.(stats);
  }, [stats, onStats]);

  // Same gentle idle drift as the procedural models.
  useFrame((_, delta) => {
    if (groupRef.current) groupRef.current.rotation.y += delta * 0.18;
  });

  return (
    <group ref={groupRef}>
      <primitive object={scene} />
    </group>
  );
}
