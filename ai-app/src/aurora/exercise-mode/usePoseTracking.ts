/**
 * usePoseTracking — webcam + MediaPipe PoseLandmarker for AI Exercise mode.
 *
 * A deliberate clone of jarvis-mode/useHandTracking.ts (same camera
 * acquisition, lazy own-origin→CDN model load, GPU delegate, hard load
 * timeout, adaptive throttle, paused-video watchdog, ref-not-state data
 * flow, camera picker). The ONLY substantive change is HandLandmarker →
 * PoseLandmarker (33 full-body points + per-point visibility) so the coach
 * can read your whole body instead of just your hands.
 *
 * Privacy-first by construction: the camera stream is consumed entirely
 * inside the browser by MediaPipe's WASM runtime. No frame or landmark ever
 * leaves the device — there is NO upload path in this file. Only derived
 * text (rep counts, a form summary) is later sent to Tony, by the caller.
 *
 * Coordinates: MediaPipe returns landmarks normalized to the video frame,
 * x growing rightward in the UNMIRRORED image. The video is shown mirrored
 * (selfie), so we flip x here (1 - x); every consumer works in mirrored
 * screen space, matching what the user sees.
 */
import { useEffect, useRef, useState } from "react";

export interface PosePoint {
  x: number;
  y: number;
  z: number;
  visibility: number;
}

export interface PoseFrame {
  /** 33 normalized landmarks in mirrored screen space, or null if no body. */
  landmarks: PosePoint[] | null;
  /** Metric world landmarks (origin at hips), or null. Kept for future 3D use. */
  world: PosePoint[] | null;
  /** Capture timestamp (performance.now()). */
  t: number;
}

export type PoseCamStatus =
  | "idle"
  | "loading"
  | "running"
  | "denied"
  | "unsupported"
  | "error";

// Keep in lockstep with package.json's @mediapipe/tasks-vision + the vendored
// wasm folder (ai-app/public/mediapipe/wasm), same as useHandTracking.
const TASKS_VISION_VERSION = "0.10.35";
const WASM_CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/wasm`;
const POSE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

// VENDORED copies served from OUR origin (Vercel edge) — own-origin first so a
// stalled regional CDN can't hang "Loading…" forever; CDN is the fallback.
const WASM_LOCAL = "/mediapipe/wasm";
const POSE_MODEL_LOCAL = "/mediapipe/pose_landmarker_lite.task";

const LOAD_TIMEOUT_MS = 20_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("pose-load-timeout")), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

/** Detect at most every ~33ms (≈30fps); backs off under load. */
const DETECT_INTERVAL_MS = 33;

export interface PoseTracking {
  videoRef: React.MutableRefObject<HTMLVideoElement | null>;
  landmarksRef: React.MutableRefObject<PoseFrame>;
  status: PoseCamStatus;
  retry: () => void;
  cameraCount: number;
  cameraIndex: number;
  cameraLabel: string;
  cycleCamera: () => void;
}

export function usePoseTracking(active: boolean): PoseTracking {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const landmarksRef = useRef<PoseFrame>({ landmarks: null, world: null, t: 0 });
  const [status, setStatus] = useState<PoseCamStatus>("idle");
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
    let landmarker: { close(): void; detectForVideo(v: HTMLVideoElement, t: number): unknown } | null = null;

    const cleanup = () => {
      cancelAnimationFrame(raf);
      try {
        landmarker?.close();
      } catch {
        /* already closed */
      }
      landmarker = null;
      stream?.getTracks().forEach((tr) => tr.stop());
      stream = null;
      if (videoRef.current) videoRef.current.srcObject = null;
      landmarksRef.current = { landmarks: null, world: null, t: 0 };
    };

    void (async () => {
      setStatus("loading");

      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus("unsupported");
        return;
      }

      // 1 ── camera permission
      const chosenId = devicesRef.current[camIdx]?.id;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 640 },
            height: { ideal: 480 },
            ...(chosenId ? { deviceId: { exact: chosenId } } : { facingMode: "user" }),
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
      //      both under a hard timeout so a stalled fetch surfaces the error
      //      overlay (Try-again rebuilds the pipeline) instead of spinning.
      try {
        const vision = await import("@mediapipe/tasks-vision");
        if (cancelled) return cleanup();
        const create = async (wasmBase: string, modelUrl: string) => {
          const fileset = await vision.FilesetResolver.forVisionTasks(wasmBase);
          if (cancelled) throw new Error("cancelled");
          return vision.PoseLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: modelUrl, delegate: "GPU" },
            runningMode: "VIDEO",
            numPoses: 1,
            // One clear body. Demand reasonable confidence so the coach
            // doesn't track a coat on a chair; stay forgiving once locked.
            minPoseDetectionConfidence: 0.6,
            minPosePresenceConfidence: 0.6,
            minTrackingConfidence: 0.6,
            outputSegmentationMasks: false,
          });
        };
        try {
          landmarker = await withTimeout(create(WASM_LOCAL, POSE_MODEL_LOCAL), LOAD_TIMEOUT_MS);
        } catch (e) {
          if (cancelled || (e as Error)?.message === "cancelled") return cleanup();
          landmarker = await withTimeout(create(WASM_CDN, POSE_MODEL_URL), LOAD_TIMEOUT_MS);
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
        // Pose (33pt) is heavier than hands (21pt); back off harder when the
        // weak GPU can't keep up. Rep counting at 20fps still feels instant.
        const interval = detectCostMs > 28 ? 55 : DETECT_INTERVAL_MS;
        if (landmarker && video.readyState >= 2 && now - lastDetect >= interval) {
          lastDetect = now;
          try {
            const res = landmarker.detectForVideo(video, now) as {
              landmarks?: Array<Array<{ x: number; y: number; z?: number; visibility?: number }>>;
              worldLandmarks?: Array<Array<{ x: number; y: number; z?: number; visibility?: number }>>;
            };
            const raw = res.landmarks?.[0];
            if (raw && raw.length >= 33) {
              const mapped: PosePoint[] = raw.map((p) => ({
                x: 1 - p.x, // mirror to selfie screen space
                y: p.y,
                z: p.z ?? 0,
                visibility: p.visibility ?? 1,
              }));
              const rawWorld = res.worldLandmarks?.[0];
              const world: PosePoint[] | null = rawWorld
                ? rawWorld.map((p) => ({ x: -p.x, y: p.y, z: p.z ?? 0, visibility: p.visibility ?? 1 }))
                : null;
              landmarksRef.current = { landmarks: mapped, world, t: now };
            } else {
              // No body this frame — clear so consumers show "step into frame".
              landmarksRef.current = { landmarks: null, world: null, t: now };
            }
            detectCostMs += 0.2 * (performance.now() - now - detectCostMs);
            consecutiveFailures = 0;
          } catch {
            consecutiveFailures += 1;
            if (consecutiveFailures > 90) {
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
    landmarksRef,
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
