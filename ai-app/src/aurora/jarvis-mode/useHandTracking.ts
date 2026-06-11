/**
 * useHandTracking — webcam + MediaPipe HandLandmarker for JARVIS Mode.
 *
 * Privacy-first by construction: the camera stream is consumed entirely
 * inside the browser by MediaPipe's WASM runtime. No frame, landmark, or
 * any derivative ever leaves the device — there is no upload path in this
 * file at all. (The UI states this; it must remain true.)
 *
 * Performance (the founder's MacBook is weak — this must stay light):
 *   - 640×480 capture, never larger.
 *   - The HandLandmarker bundle + model load lazily via dynamic import,
 *     ONLY when JARVIS mode activates — zero cost to the normal app.
 *   - Detection throttled to ~30fps (every other frame at 60Hz), with
 *     the GPU delegate so the weak CPU isn't doing the convolutions.
 *   - Results land in a REF (landmarksRef), never per-frame React state —
 *     no render storms; consumers read the ref inside their own rAF.
 *
 * Coordinates: MediaPipe returns landmarks normalized to the VIDEO frame
 * with x growing rightward in the unmirrored image. The JARVIS video is
 * displayed mirrored (selfie view), so we flip x here (1 - x) — every
 * consumer downstream works in WYSIWYG mirrored screen space.
 *
 * Handedness: likewise reported from the image's perspective; after
 * mirroring, MediaPipe's "Left" is the user's RIGHT hand on screen. We
 * swap labels so HandData.id matches what the user sees.
 */
import { useEffect, useRef, useState } from "react";
import type { HandFrame } from "./gestures";

export type JarvisCamStatus =
  | "idle" // mode off
  | "loading" // permissions + model load in flight
  | "running" // tracking live
  | "denied" // user refused camera permission
  | "unsupported" // no getUserMedia (old browser / non-secure context)
  | "error"; // model/camera failed for another reason

// Keep this version in lockstep with package.json's @mediapipe/tasks-vision.
// The wasm fileset MUST match the installed JS API version or the worker
// silently mismatches. (npm i bumps → update here.)
const TASKS_VISION_VERSION = "0.10.35";
const WASM_CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/wasm`;
// Google-hosted float16 hand model (~7.5 MB, cached by the browser).
const HAND_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

/** Detect at most every DETECT_INTERVAL_MS (≈30fps). */
const DETECT_INTERVAL_MS = 33;

export interface HandTracking {
  /** Attach to the <video> element that shows the mirrored selfie feed. */
  videoRef: React.MutableRefObject<HTMLVideoElement | null>;
  /** Latest hand landmarks in mirrored screen space — read inside rAF. */
  landmarksRef: React.MutableRefObject<HandFrame>;
  status: JarvisCamStatus;
  /** Re-request the camera after a denial (must be user-gesture-driven). */
  retry: () => void;
}

export function useHandTracking(active: boolean): HandTracking {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const landmarksRef = useRef<HandFrame>({ hands: [], t: 0 });
  const [status, setStatus] = useState<JarvisCamStatus>("idle");
  // Bump to force the effect to re-run after a permission denial.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!active) {
      setStatus("idle");
      return;
    }
    let cancelled = false;
    let raf = 0;
    let stream: MediaStream | null = null;
    // `close()` is the only API we need — keep the type loose so the
    // dynamically-imported module doesn't leak its types everywhere.
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
      landmarksRef.current = { hands: [], t: 0 };
    };

    void (async () => {
      setStatus("loading");

      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus("unsupported");
        return;
      }

      // 1 ── camera permission first (fast feedback for the user)
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
          audio: false,
        });
      } catch (e) {
        if (cancelled) return;
        const name = (e as DOMException)?.name ?? "";
        setStatus(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "error");
        return;
      }
      if (cancelled) return cleanup();

      const video = videoRef.current;
      if (!video) {
        cleanup();
        return;
      }
      video.srcObject = stream;
      try {
        await video.play();
      } catch {
        /* autoplay quirk — the element is muted+playsInline, retry below is moot */
      }
      if (cancelled) return cleanup();

      // 2 ── load MediaPipe lazily (code-split chunk + CDN wasm + model)
      try {
        const vision = await import("@mediapipe/tasks-vision");
        if (cancelled) return cleanup();
        const fileset = await vision.FilesetResolver.forVisionTasks(WASM_CDN);
        if (cancelled) return cleanup();
        landmarker = await vision.HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: HAND_MODEL_URL, delegate: "GPU" },
          runningMode: "VIDEO",
          numHands: 2,
        });
      } catch {
        if (!cancelled) setStatus("error");
        cleanup();
        return;
      }
      if (cancelled) return cleanup();

      setStatus("running");

      // 3 ── detection loop (throttled; writes to the ref only)
      let lastDetect = 0;
      const loop = () => {
        if (cancelled) return;
        const now = performance.now();
        if (landmarker && video.readyState >= 2 && now - lastDetect >= DETECT_INTERVAL_MS) {
          lastDetect = now;
          try {
            const res = landmarker.detectForVideo(video, now) as {
              landmarks?: Array<Array<{ x: number; y: number }>>;
              handedness?: Array<Array<{ categoryName?: string }>>;
            };
            const hands: HandFrame["hands"] = [];
            const lms = res.landmarks ?? [];
            for (let i = 0; i < lms.length && hands.length < 2; i++) {
              const raw = lms[i];
              if (!raw || raw.length < 21) continue;
              // Image-perspective label; swapped + mirrored for screen space.
              const imageLabel = res.handedness?.[i]?.[0]?.categoryName === "Left" ? "Left" : "Right";
              const screenId = imageLabel === "Left" ? "Right" : "Left";
              // One hand per id — if both map to the same label (rare
              // misdetection), keep the first.
              if (hands.some((h) => h.id === screenId)) continue;
              hands.push({
                id: screenId,
                landmarks: raw.map((p) => ({ x: 1 - p.x, y: p.y })),
              });
            }
            landmarksRef.current = { hands, t: now };
          } catch {
            /* transient detector hiccup — keep last good frame */
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
  }, [active, attempt]);

  return {
    videoRef,
    landmarksRef,
    status,
    retry: () => setAttempt((n) => n + 1),
  };
}
