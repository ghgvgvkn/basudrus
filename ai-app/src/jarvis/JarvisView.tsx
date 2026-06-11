/**
 * JarvisView — full-screen overlay that hosts a 3D model viewer.
 *
 * Triggered when Tony emits a <<<MODEL:name>>> artifact block. The
 * overlay fills the viewport, dims the rest of the UI, and renders
 * the matching procedural model from src/jarvis/models/.
 *
 * Architecture:
 *   - <Canvas> sets up the Three.js renderer + camera + lights
 *   - <OrbitControls> lets the user drag to rotate, scroll to zoom
 *   - <Stars> draws a starfield background (the "dark void" the
 *     founder asked for)
 *   - The model itself comes from the MODEL_REGISTRY below
 *
 * EXPLODED VIEW:
 *   Every model takes an explodeRef (0..1, smoothed). Two inputs
 *   drive it: the EXPLODED VIEW slider in the HUD, and — when the
 *   JARVIS camera is on — the two-hand pull-apart gesture (the
 *   parent writes the target into explodeTargetRef). <ExplodeRig>
 *   lives inside the Canvas and eases the rendered value toward the
 *   target every frame, then reflects it back onto the slider so the
 *   two controls stay in sync. Smoothing is the pure approachExplode
 *   from explode.ts (tested).
 *
 * Lazy-loading: each model component is imported eagerly here for
 * simplicity. If the bundle grows past acceptable, switch to
 * React.lazy + Suspense — but with 6 procedural models the total
 * code is well under 30KB so eager is fine.
 *
 * Performance: r3f's <Canvas> only renders on demand by default —
 * useFrame triggers re-render, OrbitControls events too. When the
 * overlay isn't open, nothing animates.
 */
import { Suspense, useEffect, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Stars } from "@react-three/drei";
import { Atom } from "./models/Atom";
import { SolarSystem } from "./models/SolarSystem";
import { DNA } from "./models/DNA";
import { Water } from "./models/Water";
import { AnimalCell } from "./models/AnimalCell";
import { Heart } from "./models/Heart";
import { approachExplode, type ViewerHandCursor } from "./explode";
import { HandCursorOverlay } from "./HandCursorOverlay";
import type { ModelKey } from "./modelKeys";
import "./jarvis.css";

export { resolveModelKey, type ModelKey } from "./modelKeys";

/**
 * Canonical model registry. Keys are the strings Tony emits inside
 * <<<MODEL:atom>>> etc. — keep this lowercase + dash-free so the
 * artifact parser can do simple lookup.
 *
 * Each entry includes:
 *   - component: the React Three Fiber scene component
 *   - title: human-readable label for the HUD chrome
 *   - subtitle: small tagline shown under the title
 *   - cameraPos: initial camera position [x, y, z]
 *   - explodeVerb: HUD label for what "exploding" reveals (per model)
 *
 * Adding a new model: add the .tsx under models/, import it, add
 * an entry here. The parser and prompt list pull from these keys.
 */
export const MODEL_REGISTRY = {
  atom: {
    component: Atom,
    title: "Atom",
    subtitle: "Carbon · 6 protons, 6 neutrons, 6 electrons",
    cameraPos: [0, 1.5, 7] as [number, number, number],
    explodeVerb: "separate nucleus & shells",
  },
  "solar-system": {
    component: SolarSystem,
    title: "Solar System",
    subtitle: "Sun and 8 planets (not to scale)",
    cameraPos: [0, 6, 14] as [number, number, number],
    explodeVerb: "spread the orbits",
  },
  dna: {
    component: DNA,
    title: "DNA",
    subtitle: "Double helix · base-pair connections",
    cameraPos: [0, 0, 8] as [number, number, number],
    explodeVerb: "unzip the strands",
  },
  water: {
    component: Water,
    title: "Water",
    subtitle: "H₂O · H-O-H bond angle 104.5°",
    cameraPos: [0, 0, 6] as [number, number, number],
    explodeVerb: "break the bonds",
  },
  "animal-cell": {
    component: AnimalCell,
    title: "Animal Cell",
    subtitle: "Membrane, nucleus, organelles",
    cameraPos: [0, 2, 9] as [number, number, number],
    explodeVerb: "lift out the organelles",
  },
  heart: {
    component: Heart,
    title: "Human Heart",
    subtitle: "Four chambers, beating at 72 BPM",
    cameraPos: [0, 0, 7] as [number, number, number],
    explodeVerb: "separate the chambers",
  },
} as const;

// ModelKey and resolveModelKey live in ./modelKeys (separate file)
// so callers can resolve names WITHOUT importing the whole R3F
// bundle. We re-export them above for convenience.

export interface JarvisViewProps {
  modelKey: ModelKey;
  /** Closes the overlay. Wired to the dismiss button + Escape key. */
  onClose: () => void;
  /** True when Aurora's voice mode is active in the background.
   *  Drives the corner presence indicator — a small "TONY STARRK"
   *  arc-reactor that appears bottom-right of the 3D viewer so the
   *  user knows Tony is still alive in there while the model
   *  takes the main stage. Founder request: "the 3-D model design
   *  should be connected when he goes to the right corner." */
  voiceActive?: boolean;
  /** Tony's current voice state — drives the corner indicator's
   *  status label (SPEAKING / LISTENING / READY). Optional; falls
   *  back to a generic "ACTIVE" string when not provided. */
  voiceStatus?: "speaking" | "listening" | "processing" | "ready";
  /** Parent-owned EXPLODED-VIEW target (0..1). The JARVIS two-hand
   *  gesture writes here; the slider also writes here. If omitted,
   *  the viewer manages its own target (slider-only). */
  explodeTargetRef?: { current: number };
  /** Hand cursors mirrored from JARVIS camera mode (screen-space px),
   *  drawn as rings over the 3D scene so the user can see where their
   *  hands are while exploding. Only provided when the camera is on. */
  handCursorsRef?: { current: ViewerHandCursor[] };
  /** True when JARVIS camera mode is active behind this viewer —
   *  shows the gesture hint + the hand-cursor overlay. */
  gestureActive?: boolean;
}

export function JarvisView({
  modelKey,
  onClose,
  voiceActive,
  voiceStatus,
  explodeTargetRef,
  handCursorsRef,
  gestureActive,
}: JarvisViewProps) {
  const meta = MODEL_REGISTRY[modelKey];
  const ModelComponent = meta.component;

  // Target the rig eases toward. Parent-owned if provided (so gestures
  // can drive it), otherwise local to this viewer (slider-only).
  const ownTargetRef = useRef(0);
  const targetRef = explodeTargetRef ?? ownTargetRef;
  // The smoothed value the model actually renders — read inside its
  // useFrame, never React state (weak-MacBook rule).
  const smoothRef = useRef(0);

  const sliderRef = useRef<HTMLInputElement | null>(null);
  const readoutRef = useRef<HTMLSpanElement | null>(null);
  // While the user drags the slider, the rig must not fight them by
  // writing the smoothed value back into the thumb.
  const draggingRef = useRef(false);

  // Reset explosion whenever the model changes — a fresh model should
  // always open assembled.
  useEffect(() => {
    targetRef.current = 0;
    smoothRef.current = 0;
    if (sliderRef.current) sliderRef.current.value = "0";
    if (readoutRef.current) readoutRef.current.textContent = "0%";
  }, [modelKey, targetRef]);

  return (
    <div className="jarvis-view" role="dialog" aria-modal="true" aria-label={`3D model: ${meta.title}`}>
      {/* HUD overlay chrome — title, subtitle, dismiss button.
          Pointer-events: none on the root so users can drag the
          model behind it; specific children opt in. */}
      <div className="jarvis-hud">
        <div className="jarvis-hud-corner jarvis-hud-tl" aria-hidden />
        <div className="jarvis-hud-corner jarvis-hud-tr" aria-hidden />
        <div className="jarvis-hud-corner jarvis-hud-bl" aria-hidden />
        <div className="jarvis-hud-corner jarvis-hud-br" aria-hidden />

        <div className="jarvis-hud-header">
          <span className="jarvis-hud-tag">JARVIS · LIVE 3D</span>
          <h2 className="jarvis-hud-title">{meta.title}</h2>
          <p className="jarvis-hud-subtitle">{meta.subtitle}</p>
        </div>

        <button
          type="button"
          className="jarvis-hud-close"
          onClick={onClose}
          aria-label="Close 3D view"
          title="Close (Esc)"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
          <span>Close</span>
        </button>

        <div className="jarvis-hud-hint">
          {gestureActive ? "Pull hands apart to explode · drag to rotate" : "Drag to rotate · Scroll to zoom"}
        </div>

        {/* EXPLODED VIEW control — slider drives the explode target;
            the rig keeps it in sync with gesture-driven changes. */}
        <div className="jarvis-explode-control">
          <div className="jarvis-explode-label">
            <span>EXPLODED VIEW</span>
            <span className="jarvis-explode-readout" ref={readoutRef}>0%</span>
          </div>
          <input
            ref={sliderRef}
            type="range"
            min={0}
            max={100}
            defaultValue={0}
            className="jarvis-explode-slider"
            aria-label={`Exploded view — ${meta.explodeVerb}`}
            onPointerDown={() => { draggingRef.current = true; }}
            onPointerUp={() => { draggingRef.current = false; }}
            onPointerCancel={() => { draggingRef.current = false; }}
            onInput={(e) => {
              const v = Number((e.target as HTMLInputElement).value) / 100;
              targetRef.current = v;
              if (readoutRef.current) readoutRef.current.textContent = `${Math.round(v * 100)}%`;
            }}
          />
          <div className="jarvis-explode-verb">{meta.explodeVerb}</div>
        </div>

        {/* Corner presence — when voice mode is active in the
            background, show a small TONY STARRK arc-reactor in the
            bottom-right corner so the user knows the conversation
            is still alive while the 3D model takes the main stage.
            Pure CSS — matches the aesthetic of the main voice-mode
            arc-reactor ring. */}
        {voiceActive && (
          <div className="jarvis-corner-presence" aria-hidden>
            <div className="jarvis-corner-ring">
              <div className="jarvis-corner-ring-inner" />
              <div className="jarvis-corner-ring-ticks" />
              <span className="jarvis-corner-ring-label">TONY</span>
            </div>
            <span className="jarvis-corner-status">
              {voiceStatus === "speaking" ? "SPEAKING"
                : voiceStatus === "listening" ? "LISTENING"
                : voiceStatus === "processing" ? "PROCESSING"
                : "READY"}
            </span>
          </div>
        )}
      </div>

      {/* Hand-cursor overlay — only when the camera is driving the
          scene. Drawn on a 2D canvas above the WebGL scene. */}
      {gestureActive && handCursorsRef && <HandCursorOverlay cursorsRef={handCursorsRef} />}

      {/* The actual 3D scene */}
      <Canvas
        className="jarvis-canvas"
        camera={{ position: meta.cameraPos, fov: 50, near: 0.1, far: 100 }}
        dpr={[1, 2]}
        gl={{
          antialias: true,
          alpha: true,
          // High-quality color output. Without this, emissive materials
          // look washed out in dark scenes.
          preserveDrawingBuffer: false,
        }}
      >
        <Suspense fallback={null}>
          {/* Lighting — soft ambient + a directional rim so the
              models don't go flat against the void background.
              The Sun in SolarSystem adds its own point light. */}
          <ambientLight intensity={0.45} />
          <directionalLight position={[5, 8, 5]} intensity={0.7} />
          <directionalLight position={[-5, -3, -5]} intensity={0.25} color="#8aaad0" />

          {/* Starfield background — "dark void" feel. Drei's <Stars>
              is GPU-cheap (single buffer-geometry) and gives the
              scene proper depth instead of a flat black bg. */}
          <Stars
            radius={50}
            depth={60}
            count={2400}
            factor={3}
            fade
            saturation={0.5}
            speed={0.4}
          />

          {/* Eases the rendered explode value toward the target each
              frame and mirrors it onto the slider. Renders nothing. */}
          <ExplodeRig
            targetRef={targetRef}
            smoothRef={smoothRef}
            sliderRef={sliderRef}
            readoutRef={readoutRef}
            draggingRef={draggingRef}
          />

          {/* The model itself — reads smoothRef each frame. */}
          <ModelComponent explodeRef={smoothRef} />

          {/* Orbit controls — drag/zoom interaction. enablePan is OFF
              because the model is centered and pan would let the user
              "lose" it. autoRotate gives a gentle drift even when
              they're not touching it. */}
          <OrbitControls
            enablePan={false}
            enableDamping
            dampingFactor={0.08}
            rotateSpeed={0.8}
            zoomSpeed={0.8}
            minDistance={3}
            maxDistance={25}
            autoRotate
            autoRotateSpeed={0.6}
          />
        </Suspense>
      </Canvas>
    </div>
  );
}

/**
 * ExplodeRig — lives inside the Canvas so it gets r3f's useFrame.
 * Eases smoothRef toward targetRef every frame (pure approachExplode)
 * and reflects the value back onto the slider + readout DOM (unless
 * the user is actively dragging). Renders nothing.
 */
function ExplodeRig({
  targetRef,
  smoothRef,
  sliderRef,
  readoutRef,
  draggingRef,
}: {
  targetRef: { current: number };
  smoothRef: { current: number };
  sliderRef: { current: HTMLInputElement | null };
  readoutRef: { current: HTMLSpanElement | null };
  draggingRef: { current: boolean };
}) {
  useFrame((_, delta) => {
    const next = approachExplode(smoothRef.current, targetRef.current, delta);
    if (next === smoothRef.current) return; // settled — no DOM churn
    smoothRef.current = next;
    // Mirror onto the slider unless the user is dragging it.
    if (!draggingRef.current) {
      const pct = Math.round(next * 100);
      if (sliderRef.current) sliderRef.current.value = String(pct);
      if (readoutRef.current) readoutRef.current.textContent = `${pct}%`;
    }
  });
  return null;
}

