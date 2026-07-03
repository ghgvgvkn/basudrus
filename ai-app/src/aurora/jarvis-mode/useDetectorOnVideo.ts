/**
 * useDetectorOnVideo — MediaPipe ObjectDetector running on an EXISTING
 * <video> element (JARVIS already owns the camera — acquiring a second
 * stream would fight it). Loads lazily (own-origin model → CDN fallback,
 * same pattern as useHandTracking/usePoseTracking), detects ~5×/sec, and
 * writes results to a ref — no per-frame React state.
 *
 * Detection is tuned for "see the room": scoreThreshold 0.20 (0.45 then 0.30
 * still showed people-only in real rooms — founder feedback; a few ghost
 * boxes are the accepted price of seeing furniture) and up to 24 results.
 * NOTE the model's vocabulary is COCO's 80 everyday classes — chairs,
 * laptops, bottles, TVs, phones, beds… it can NEVER see wall AC units or
 * punching bags; that's vocabulary, not sensitivity.
 * Coordinates are normalized [0..1] in RAW (unmirrored) frame space — the
 * consumer flips x when the video is displayed mirrored.
 *
 * Privacy: frames are consumed on-device by the WASM runtime; nothing leaves.
 */
import { useEffect, useRef, useState } from "react";

export interface SensedItem {
  label: string;
  score: number;
  /** Normalized [0..1] box in RAW (unmirrored) frame coords. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SenseFrame {
  items: SensedItem[];
  t: number; // performance.now() of the detection; 0 = none yet
}

const TASKS_VISION_VERSION = "0.10.35";
const WASM_CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/wasm`;
const MODEL_CDN =
  "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite";
const WASM_LOCAL = "/mediapipe/wasm";
const MODEL_LOCAL = "/mediapipe/efficientdet_lite0.tflite";

const LOAD_TIMEOUT_MS = 20_000;
const DETECT_INTERVAL_MS = 200; // ~5fps — plenty for a HUD, gentle on the GPU

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("sense-load-timeout")), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

export type SenseStatus = "idle" | "loading" | "running" | "error";

export function useDetectorOnVideo(
  videoRef: React.MutableRefObject<HTMLVideoElement | null>,
  active: boolean,
): { frameRef: React.MutableRefObject<SenseFrame>; status: SenseStatus } {
  const frameRef = useRef<SenseFrame>({ items: [], t: 0 });
  const [status, setStatus] = useState<SenseStatus>("idle");

  useEffect(() => {
    if (!active) {
      setStatus("idle");
      return;
    }
    let cancelled = false;
    let raf = 0;
    let detector: { close(): void; detectForVideo(v: HTMLVideoElement, t: number): unknown } | null = null;

    const cleanup = () => {
      cancelAnimationFrame(raf);
      try {
        detector?.close();
      } catch {
        /* already closed */
      }
      detector = null;
      frameRef.current = { items: [], t: 0 };
    };

    void (async () => {
      setStatus("loading");
      try {
        const vision = await import("@mediapipe/tasks-vision");
        if (cancelled) return cleanup();
        const create = async (wasmBase: string, modelUrl: string) => {
          const fileset = await vision.FilesetResolver.forVisionTasks(wasmBase);
          if (cancelled) throw new Error("cancelled");
          return vision.ObjectDetector.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: modelUrl, delegate: "GPU" },
            runningMode: "VIDEO",
            scoreThreshold: 0.2,
            maxResults: 24,
          });
        };
        try {
          detector = await withTimeout(create(WASM_LOCAL, MODEL_LOCAL), LOAD_TIMEOUT_MS);
        } catch (e) {
          if (cancelled || (e as Error)?.message === "cancelled") return cleanup();
          detector = await withTimeout(create(WASM_CDN, MODEL_CDN), LOAD_TIMEOUT_MS);
        }
      } catch {
        if (!cancelled) setStatus("error");
        cleanup();
        return;
      }
      if (cancelled) return cleanup();
      setStatus("running");

      let lastDetect = 0;
      let failures = 0;
      const loop = () => {
        if (cancelled) return;
        const video = videoRef.current;
        const now = performance.now();
        if (detector && video && video.readyState >= 2 && now - lastDetect >= DETECT_INTERVAL_MS) {
          lastDetect = now;
          try {
            const vw = video.videoWidth || 640;
            const vh = video.videoHeight || 480;
            const res = detector.detectForVideo(video, now) as {
              detections?: Array<{
                boundingBox?: { originX: number; originY: number; width: number; height: number };
                categories?: Array<{ categoryName?: string; score?: number }>;
              }>;
            };
            const items: SensedItem[] = [];
            for (const d of res.detections ?? []) {
              const bb = d.boundingBox;
              const cat = d.categories?.[0];
              if (!bb || !cat?.categoryName) continue;
              items.push({
                label: cat.categoryName,
                score: cat.score ?? 0,
                x: bb.originX / vw,
                y: bb.originY / vh,
                w: bb.width / vw,
                h: bb.height / vh,
              });
            }
            frameRef.current = { items, t: now };
            failures = 0;
          } catch {
            failures += 1;
            if (failures > 40) {
              if (!cancelled) setStatus("error");
              cleanup();
              return;
            }
          }
        }
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    })();

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [active, videoRef]);

  return { frameRef, status };
}
