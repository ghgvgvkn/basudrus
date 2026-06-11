/**
 * GeneratedView — full-screen viewer for LIVE-GENERATED 3D models.
 *
 * Opens when Tony emits a <<<MODEL:name>>> whose name is NOT one of
 * the six procedural built-ins. The name becomes a Meshy text-to-3D
 * prompt; while the mesh bakes (~30-120s) this view plays a JARVIS
 * "fabricator" sequence — REAL progress from upstream, never a fake
 * spinner — then materializes the model in the same dark-void stage
 * as JarvisView.
 *
 * FUI rules applied here (founder's Stark-aesthetic reference):
 *   - no solid panels: glassmorphic backdrop-blur containers only
 *   - bracketed corners instead of full borders
 *   - uppercase, letter-spaced monospace micro-labels
 *   - scanning-line animation over the fabricator panel
 *   - telemetry is REAL (Meshy progress %, parsed vertex/mesh counts)
 */
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Stars } from "@react-three/drei";
import { useGenerate3D } from "./useGenerate3D";
import { GeneratedModel } from "./GeneratedModel";
import { HandCursorOverlay } from "./HandCursorOverlay";
import type { ViewerHandCursor } from "./explode";
import type { Gen3DStep } from "./generate3d";
import "./jarvis.css";

export interface GeneratedViewProps {
  /** Free-form model name from Tony's MODEL block — used as the
   *  generation prompt AND the HUD title. */
  prompt: string;
  onClose: () => void;
  voiceActive?: boolean;
  voiceStatus?: "speaking" | "listening" | "processing" | "ready";
  handCursorsRef?: { current: ViewerHandCursor[] };
  gestureActive?: boolean;
  /** Opens the sign-up modal (unauthorized state CTA). */
  onRequestSignIn?: () => void;
}

/** Status line for the fabricator panel — phase → uppercase telemetry. */
function phaseLabel(step: Gen3DStep): string {
  switch (step.phase) {
    case "creating":   return "UPLINK · SUBMITTING BUILD";
    case "pending":    return "QUEUED · AWAITING FABRICATOR";
    case "generating": return "FABRICATING MESH";
    case "loading":    return "MATERIALIZING · DOWNLOADING GEOMETRY";
    case "ready":      return "RENDER COMPLETE";
    default:           return "OFFLINE";
  }
}

export function GeneratedView({
  prompt,
  onClose,
  voiceActive,
  voiceStatus,
  handCursorsRef,
  gestureActive,
  onRequestSignIn,
}: GeneratedViewProps) {
  const { step, retry, markReady } = useGenerate3D(prompt);
  const [stats, setStats] = useState<{ vertices: number; meshes: number } | null>(null);

  // GLTF parse finished → stats arrive → flip loading → ready.
  const onStats = useCallback((s: { vertices: number; meshes: number }) => {
    setStats(s);
    markReady();
  }, [markReady]);

  // Elapsed-seconds ticker for the fabricator panel — runs only while
  // the job is in flight (cheap 1Hz interval, removed once terminal).
  const startedAtRef = useRef(Date.now());
  const [elapsed, setElapsed] = useState(0);
  const inFlight =
    step.phase === "creating" || step.phase === "pending" ||
    step.phase === "generating" || step.phase === "loading";
  useEffect(() => {
    if (!inFlight) return;
    const id = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000)),
      1000,
    );
    return () => window.clearInterval(id);
  }, [inFlight]);

  const handleRetry = useCallback(() => {
    startedAtRef.current = Date.now();
    setElapsed(0);
    setStats(null);
    retry();
  }, [retry]);

  const showScene = (step.phase === "loading" || step.phase === "ready") && !!step.modelUrl;
  const isTerminalError =
    step.phase === "failed" || step.phase === "not_configured" ||
    step.phase === "unauthorized" || step.phase === "rate_limited";

  return (
    <div className="jarvis-view" role="dialog" aria-modal="true" aria-label={`3D model: ${prompt}`}>
      <div className="jarvis-hud">
        <div className="jarvis-hud-corner jarvis-hud-tl" aria-hidden />
        <div className="jarvis-hud-corner jarvis-hud-tr" aria-hidden />
        <div className="jarvis-hud-corner jarvis-hud-bl" aria-hidden />
        <div className="jarvis-hud-corner jarvis-hud-br" aria-hidden />

        <div className="jarvis-hud-header">
          <span className="jarvis-hud-tag">JARVIS · FABRICATOR</span>
          <h2 className="jarvis-hud-title">{prompt}</h2>
          <p className="jarvis-hud-subtitle">{phaseLabel(step)}</p>
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

        {step.phase === "ready" && (
          <div className="jarvis-hud-hint">
            {gestureActive ? "Pinch to grab · drag to rotate" : "Drag to rotate · Scroll to zoom"}
          </div>
        )}

        {/* Fabricator panel — center stage while the mesh bakes.
            Real progress only; the bar tracks Meshy's reported %. */}
        {inFlight && !showScene && (
          <div className="jarvis-fab-panel" role="status" aria-live="polite">
            <div className="jarvis-fab-scanline" aria-hidden />
            <div className="jarvis-fab-row">
              <span className="jarvis-fab-label">{phaseLabel(step)}</span>
              <span className="jarvis-fab-readout">
                {step.phase === "generating" ? `${step.progress}%` : `${elapsed}s`}
              </span>
            </div>
            <div className="jarvis-fab-track">
              <div
                className={`jarvis-fab-bar${step.phase !== "generating" ? " is-indeterminate" : ""}`}
                style={step.phase === "generating" ? { width: `${Math.max(2, step.progress)}%` } : undefined}
              />
            </div>
            <div className="jarvis-fab-meta">
              <span>SRC · MESHY TEXT-TO-3D</span>
              <span>T+{elapsed}s</span>
            </div>
          </div>
        )}

        {/* Terminal errors — same glass panel, no scanline, one CTA. */}
        {isTerminalError && (
          <div className="jarvis-fab-panel is-error" role="alert">
            <div className="jarvis-fab-row">
              <span className="jarvis-fab-label">
                {step.phase === "failed" ? "FABRICATION FAILED"
                  : step.phase === "rate_limited" ? "QUOTA REACHED"
                  : step.phase === "unauthorized" ? "AUTH REQUIRED"
                  : "MODULE OFFLINE"}
              </span>
            </div>
            <p className="jarvis-fab-message">{step.message ?? "Something went wrong."}</p>
            {step.phase === "failed" && (
              <button type="button" className="jarvis-fab-action" onClick={handleRetry}>
                TRY AGAIN
              </button>
            )}
            {step.phase === "unauthorized" && onRequestSignIn && (
              <button type="button" className="jarvis-fab-action" onClick={onRequestSignIn}>
                SIGN IN
              </button>
            )}
          </div>
        )}

        {/* Telemetry chip — REAL parsed geometry counts, bottom-left. */}
        {step.phase === "ready" && stats && (
          <div className="jarvis-fab-telemetry" aria-hidden>
            <span>VTX {stats.vertices.toLocaleString()}</span>
            <span>MESH {stats.meshes}</span>
            <span>POLY-CAP 30K</span>
          </div>
        )}

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

      {gestureActive && handCursorsRef && <HandCursorOverlay cursorsRef={handCursorsRef} />}

      {/* The 3D stage — mounted as soon as the .glb URL lands so the
          GLTF download/parse happens under Suspense while the
          fabricator panel still shows "MATERIALIZING". */}
      {showScene && (
        <Canvas
          className="jarvis-canvas"
          camera={{ position: [0, 1.2, 6], fov: 50, near: 0.1, far: 100 }}
          dpr={[1, 2]}
          gl={{ antialias: true, alpha: true, preserveDrawingBuffer: false }}
        >
          <Suspense fallback={null}>
            <ambientLight intensity={0.45} />
            <directionalLight position={[5, 8, 5]} intensity={0.7} />
            <directionalLight position={[-5, -3, -5]} intensity={0.25} color="#8aaad0" />
            <Stars radius={50} depth={60} count={2400} factor={3} fade saturation={0.5} speed={0.4} />
            <GeneratedModel url={step.modelUrl!} onStats={onStats} />
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
      )}
    </div>
  );
}
