/**
 * HandCursorOverlay — a 2D canvas above a 3D scene that draws the
 * JARVIS hand cursors (mirrored from JarvisMode via a shared ref) so
 * the user can see where their hands are while controlling a model.
 * Used by both the procedural viewer (JarvisView) and the generated
 * viewer (GeneratedView). Runs its own rAF; cheap (two rings).
 */
import { useEffect, useRef } from "react";
import type { ViewerHandCursor } from "./explode";

export function HandCursorOverlay({ cursorsRef }: { cursorsRef: { current: ViewerHandCursor[] } }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let raf = 0;
    const draw = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      if (canvas.width !== vw * dpr || canvas.height !== vh * dpr) {
        canvas.width = vw * dpr;
        canvas.height = vh * dpr;
      }
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, vw, vh);
        for (const c of cursorsRef.current) {
          ctx.strokeStyle = c.pinching ? "rgba(255, 96, 168, 0.95)" : "rgba(64, 224, 255, 0.9)";
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.arc(c.x, c.y, c.pinching ? 9 : 13, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [cursorsRef]);
  return <canvas ref={canvasRef} className="jarvis-hand-overlay" aria-hidden />;
}
