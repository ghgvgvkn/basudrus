/**
 * AuroraCanvas — React wrapper around the AuroraEngine.
 *
 * Mounts a full-viewport <canvas>, creates an AuroraEngine bound to
 * it, and exposes the engine's imperative API via a forwarded ref.
 * The parent screen calls activate/deactivate/pulse/spark on this
 * ref to drive the visual layer (mic press, send, AI reply, etc.).
 *
 * Cleanup: on unmount, the engine cancels its rAF and removes its
 * resize listener so navigating away doesn't leave a phantom canvas
 * burning frames.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { AuroraEngine, type AuroraMode } from "./AuroraEngine";

export interface AuroraHandle {
  activate: () => void;
  deactivate: () => void;
  toggle: () => void;
  pulse: (x?: number, y?: number, amp?: number) => void;
  pulseFromAll: (amp?: number) => void;
  spark: (x?: number, y?: number, count?: number) => void;
  state: () => AuroraMode;
}

export const AuroraCanvas = forwardRef<AuroraHandle>((_, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<AuroraEngine | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Wait for fonts to load before starting — keeps the first few
    // frames from rendering against fallback metrics. document.fonts
    // resolves immediately if fonts are already cached.
    let cancelled = false;
    const start = () => {
      if (cancelled) return;
      engineRef.current = new AuroraEngine(canvas);
    };
    if (typeof document !== "undefined" && document.fonts && document.fonts.ready) {
      document.fonts.ready.then(start).catch(start);
    } else {
      start();
    }
    return () => {
      cancelled = true;
      engineRef.current?.destroy();
      engineRef.current = null;
    };
  }, []);

  useImperativeHandle(ref, () => ({
    activate: () => engineRef.current?.activate(),
    deactivate: () => engineRef.current?.deactivate(),
    toggle: () => engineRef.current?.toggle(),
    pulse: (x, y, amp) => engineRef.current?.pulse(x, y, amp),
    pulseFromAll: (amp) => engineRef.current?.pulseFromAll(amp),
    spark: (x, y, count) => engineRef.current?.spark(x, y, count),
    state: () => engineRef.current?.state() ?? "idle",
  }), []);

  return <canvas ref={canvasRef} className="aurora-matrix" />;
});

AuroraCanvas.displayName = "AuroraCanvas";
