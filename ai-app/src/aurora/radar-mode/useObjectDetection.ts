/**
 * useObjectDetection — webcam + MediaPipe ObjectDetector for AI Radar mode.
 *
 * A deliberate clone of exercise-mode/usePoseTracking.ts (same camera
 * acquisition, lazy own-origin→CDN model load, GPU delegate, hard load
 * timeout, adaptive throttle, ref-not-state data flow, camera picker).
 * The substantive changes: PoseLandmarker → ObjectDetector (EfficientDet-
 * Lite0, 80 everyday COCO classes incl. "person"), and the DEFAULT camera
 * faces the ENVIRONMENT (you scan the room, not yourself) so the video is
 * NOT mirrored and boxes are reported in raw normalized frame coords.
 *
 * Privacy-first by construction: frames are consumed entirely inside the
 * browser by MediaPipe's WASM runtime. No frame or detection ever leaves
 * the device — there is NO upload path in this file.
 */
import { useEffect, useRef, useState } from "react";

export interface DetectedItem {
  /** COCO class name, e.g. "person", "chair", "laptop". */
  label: string;
  /** 0..1 confidence. */
  score: number;
  /** Normalized [0..1] box in RAW (unmirrored) frame coords. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DetectionFrame {
  items: DetectedItem[];
  /** Video intrinsic size the boxes were normalized against. */
  videoW: number;
  videoH: number;
  /** Capture timestamp (performance.now()); 0 = nothing yet. */
  t: number;
}

export type RadarCamStatus =
  | "idle"
  | "loading"
  | "running"
  | "denied"
  | "unsupported"
  | "error";

// Keep in lockstep with package.json's @mediapipe/tasks-vision + the vendored
// wasm folder (ai-app/public/mediapipe/wasm), same as usePoseTracking.
const TASKS_VISION_VERSION = "0.10.35";
const WASM_CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/wasm`;
const DETECT_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite";

// VENDORED copies served from OUR origin — own-origin first so a stalled
// regional CDN can't hang "Loading…" forever; CDN is the fallback.
const WASM_LOCAL = "/mediapipe/wasm";
const DETECT_MODEL_LOCAL = "/mediapipe/efficientdet_lite0.tflite";

const LOAD_TIMEOUT_MS = 20_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("radar-load-timeout")), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

/** Room scanning doesn't need pose-level frame rates — ~7fps reads as live
 *  and leaves the GPU alone. Backs off further under load. */
const DETECT_INTERVAL_MS = 140;

export interface ObjectDetection {
  videoRef: React.MutableRefObject<HTMLVideoElement | null>;
  detectionsRef: React.MutableRefObject<DetectionFrame>;
  status: RadarCamStatus;
  retry: () => void;
  cameraCount: number;
  cameraIndex: number;
  cameraLabel: string;
  cycleCamera: () => void;
}

export function useObjectDetection(active: boolean): ObjectDetection {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const detectionsRef = useRef<DetectionFrame>({ items: [], videoW: 0, videoH: 0, t: 0 });
  const [status, setStatus] = useState<RadarCamStatus>("idle");
  const [attempt, setAttempt] = useState(0);
  const [devices, setDevices] = useState<Array<{ id: string; label: string }>>([]);
  const [camIdx, setCamIdx] = useState(0);
  const devicesRef = useRef(devices);
  devicesRef.current = devices;

  useEffect(() => {
    if (!active) {
      setStatus("idle");
      return;
    }
    let cancelled = false;
    let raf = 0;
    let stream: MediaStream | null = null;
    let detector: { close(): void; detectForVideo(v: HTMLVideoElement, t: number): unknown } | null = null;

    const cleanup = () => {
      cancelAnimationFrame(raf);
      try {
        detector?.close();
      } catch {
        /* already closed */
      }
      detector = null;
      stream?.getTracks().forEach((tr) => tr.stop());
      stream = null;
      if (videoRef.current) videoRef.current.srcObject = null;
      detectionsRef.current = { items: [], videoW: 0, videoH: 0, t: 0 };
    };

    void (async () => {
      setStatus("loading");

      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus("unsupported");
        return;
      }

      // 1 ── camera permission. Environment-facing by default: radar scans
      //      the ROOM. Laptops with only a user-facing camera still work —
      //      facingMode is a preference, not a constraint.
      const chosenId = devicesRef.current[camIdx]?.id;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 640 },
            height: { ideal: 480 },
            ...(chosenId ? { deviceId: { exact: chosenId } } : { facingMode: "environment" }),
          },
          audio: false,
        });
      } catch (e) {
        if (cancelled) return;
        const name = (e as DOMException)?.name ?? "";
        if (chosenId && (name === "OverconstrainedError" || name === "NotFoundError")) {
          setDevices([]);
          setCamIdx(0);
          setAttempt((n) => n + 1);
          return;
        }
        setStatus(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "error");
        return;
      }
      if (cancelled) return cleanup();

      void navigator.mediaDevices.enumerateDevices().then((all) => {
        if (cancelled) return;
        const cams = all
          .filter((d) => d.kind === "videoinput")
          .map((d, i) => ({ id: d.deviceId, label: d.label || `Camera ${i + 1}` }));
        setDevices((prev) =>
          prev.length === cams.length && prev.every((p, i) => p.id === cams[i].id) ? prev : cams,
        );
      }).catch(() => {});

      const video = videoRef.current;
      if (!video) {
        cleanup();
        return;
      }
      video.srcObject = stream;
      try {
        await video.play();
      } catch {
        /* autoplay quirk — element is muted+playsInline */
      }
      if (cancelled) return cleanup();

      // 2 ── load MediaPipe lazily: own-origin wasm+model first, CDN fallback,
      //      both under a hard timeout (same rationale as usePoseTracking).
      try {
        const vision = await import("@mediapipe/tasks-vision");
        if (cancelled) return cleanup();
        const create = async (wasmBase: string, modelUrl: string) => {
          const fileset = await vision.FilesetResolver.forVisionTasks(wasmBase);
          if (cancelled) throw new Error("cancelled");
          return vision.ObjectDetector.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: modelUrl, delegate: "GPU" },
            runningMode: "VIDEO",
            scoreThreshold: 0.45,
            maxResults: 16,
          });
        };
        try {
          detector = await withTimeout(create(WASM_LOCAL, DETECT_MODEL_LOCAL), LOAD_TIMEOUT_MS);
        } catch (e) {
          if (cancelled || (e as Error)?.message === "cancelled") return cleanup();
          detector = await withTimeout(create(WASM_CDN, DETECT_MODEL_URL), LOAD_TIMEOUT_MS);
        }
      } catch {
        if (!cancelled) setStatus("error");
        cleanup();
        return;
      }
      if (cancelled) return cleanup();

      setStatus("running");

      // 3 ── detection loop (throttled; writes the ref only)
      let lastDetect = 0;
      let detectCostMs = 0;
      let consecutiveFailures = 0;
      const loop = () => {
        if (cancelled) return;
        const now = performance.now();
        if (video.paused) void video.play().catch(() => {});
        const interval = detectCostMs > 80 ? 260 : DETECT_INTERVAL_MS;
        if (detector && video.readyState >= 2 && now - lastDetect >= interval) {
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
            const items: DetectedItem[] = [];
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
            detectionsRef.current = { items, videoW: vw, videoH: vh, t: now };
            detectCostMs += 0.2 * (performance.now() - now - detectCostMs);
            consecutiveFailures = 0;
          } catch {
            consecutiveFailures += 1;
            if (consecutiveFailures > 60) {
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
  }, [active, attempt, camIdx]);

  return {
    videoRef,
    detectionsRef,
    status,
    retry: () => setAttempt((n) => n + 1),
    cameraCount: devices.length,
    cameraIndex: camIdx,
    cameraLabel: devices[camIdx]?.label ?? "",
    cycleCamera: () => {
      const n = devicesRef.current.length;
      if (n > 1) setCamIdx((i) => (i + 1) % n);
    },
  };
}
