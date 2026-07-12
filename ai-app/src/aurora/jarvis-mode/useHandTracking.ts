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
// silently mismatches. (npm i bumps → update here AND re-copy the wasm
// folder into public/mediapipe/wasm.)
const TASKS_VISION_VERSION = "0.10.35";
const WASM_CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/wasm`;
// Google-hosted float16 hand model (~7.5 MB, cached by the browser).
const HAND_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

// VENDORED copies served from OUR origin (ai-app/public/mediapipe/) —
// the founder got stuck on "Summoning JARVIS…" forever because the
// Google/jsdelivr CDNs can stall from his region and the old code had
// no timeout. Own-origin rides Vercel's edge network; the CDN pair
// above stays as the fallback if the local fetch ever fails.
const WASM_LOCAL = "/mediapipe/wasm";
const HAND_MODEL_LOCAL = "/mediapipe/hand_landmarker.task";

/** Hard ceiling per load attempt — a stalled fetch is NOT an error,
 *  so without this the loading overlay can spin forever. */
const LOAD_TIMEOUT_MS = 20_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("jarvis-load-timeout")), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

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
  /** How many cameras the device exposes (0 until permission granted). */
  cameraCount: number;
  /** Index of the camera currently in use (into the device list). */
  cameraIndex: number;
  /** Human label of the active camera ("FaceTime HD Camera", …). */
  cameraLabel: string;
  /** Switch to the next camera — restarts the stream on the new device. */
  cycleCamera: () => void;
}

export function useHandTracking(active: boolean): HandTracking {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const landmarksRef = useRef<HandFrame>({ hands: [], t: 0 });
  const [status, setStatus] = useState<JarvisCamStatus>("idle");
  // Bump to force the effect to re-run after a permission denial.
  const [attempt, setAttempt] = useState(0);
  // Camera picker — the founder wants to choose WHICH camera drives
  // JARVIS (laptops with iPhone Continuity / external webcams expose
  // several). Device list fills in after the first permission grant
  // (labels are empty before that, per spec). Cycling restarts the
  // stream on the chosen deviceId.
  const [devices, setDevices] = useState<Array<{ id: string; label: string }>>([]);
  const [camIdx, setCamIdx] = useState(0);
  // Read inside the effect via a ref so refreshing the device LIST never
  // restarts a healthy stream — only camIdx/attempt changes do.
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
      const chosenId = devicesRef.current[camIdx]?.id;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 640 },
            height: { ideal: 480 },
            // Specific device once the user picked one; selfie cam otherwise.
            ...(chosenId ? { deviceId: { exact: chosenId } } : { facingMode: "user" }),
          },
          audio: false,
        });
      } catch (e) {
        if (cancelled) return;
        const name = (e as DOMException)?.name ?? "";
        if (chosenId && (name === "OverconstrainedError" || name === "NotFoundError")) {
          // The picked camera unplugged — fall back to the default.
          setDevices([]);
          setCamIdx(0);
          setAttempt((n) => n + 1);
          return;
        }
        setStatus(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "error");
        return;
      }
      if (cancelled) return cleanup();

      // Permission granted → labels are now readable. Refresh the picker
      // list (fire-and-forget; the UI only needs it for the CAM button).
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
        /* autoplay quirk — the element is muted+playsInline, retry below is moot */
      }
      if (cancelled) return cleanup();

      // 2 ── load MediaPipe lazily (code-split chunk + wasm + model).
      // Own-origin assets first (fast everywhere Vercel is), public
      // CDNs as fallback, and BOTH attempts under a hard timeout so a
      // stalled network shows the error overlay (with its Try-again
      // that rebuilds the whole pipeline) instead of spinning forever.
      try {
        const vision = await import("@mediapipe/tasks-vision");
        if (cancelled) return cleanup();
        const create = async (wasmBase: string, modelUrl: string) => {
          const fileset = await vision.FilesetResolver.forVisionTasks(wasmBase);
          if (cancelled) throw new Error("cancelled");
          return vision.HandLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: modelUrl, delegate: "GPU" },
            runningMode: "VIDEO",
            numHands: 2,
            // Defaults (0.5) hallucinate "hands" in busy textures — the
            // founder's shirt print got tracked as a hand while his real
            // hand went ignored. Demand a much more confident detection
            // before a hand enters the scene; once locked, tracking stays
            // forgiving so real hands don't drop mid-gesture.
            minHandDetectionConfidence: 0.75,
            minHandPresenceConfidence: 0.6,
            minTrackingConfidence: 0.55,
          });
        };
        try {
          landmarker = await withTimeout(create(WASM_LOCAL, HAND_MODEL_LOCAL), LOAD_TIMEOUT_MS);
        } catch (e) {
          if (cancelled || (e as Error)?.message === "cancelled") return cleanup();
          landmarker = await withTimeout(create(WASM_CDN, HAND_MODEL_URL), LOAD_TIMEOUT_MS);
        }
      } catch {
        if (!cancelled) setStatus("error");
        cleanup();
        return;
      }
      if (cancelled) return cleanup();

      setStatus("running");

      // 3 ── detection loop (throttled; writes to the ref only)
      let lastDetect = 0;
      // Adaptive back-off: if inference itself is slow on this machine
      // (GPU delegate fell back to CPU, thermal throttle, weak iGPU),
      // detecting at 30fps saturates the main thread and EVERYTHING
      // lags — gestures included. Track an EMA of detectForVideo cost
      // and drop to ~20fps when it can't keep up; tracking at 20fps
      // still feels instant, a starved main thread does not.
      let detectCostMs = 0;
      // Watchdog: the founder saw tracking silently die mid-session
      // ("it just stopped showing these icons"). Two defenses:
      //   a) If the <video> gets paused by the browser (audio-session
      //      changes during TTS, tab visibility flaps), nudge it back
      //      to playing — a paused video feeds MediaPipe frozen frames.
      //   b) If detectForVideo throws persistently (detector wedged),
      //      stop pretending: flip to the error overlay, whose Try-again
      //      rebuilds the whole pipeline.
      let consecutiveFailures = 0;
      // ── Identity continuity ── MediaPipe's per-frame handedness label
      // flips easily (palm turns, crossed hands, motion blur); trusting it
      // every frame SWAPPED the Left/Right state machines mid-gesture —
      // cursors teleported and grabs jumped hands (founder: "switching
      // from left to right"). An id now FOLLOWS the physical hand: each
      // detection is matched to last frame's palm positions first; the
      // MediaPipe label only seeds hands we haven't seen recently.
      const prevPos: Partial<Record<"Left" | "Right", { x: number; y: number; t: number }>> = {};
      const PREV_TTL_MS = 600;
      const loop = () => {
        if (cancelled) return;
        const now = performance.now();
        if (video.paused) {
          // Fire-and-forget resume; if it fails we keep looping (the
          // detector simply sees no fresh frames until it recovers).
          void video.play().catch(() => {});
        }
        const interval = detectCostMs > 22 ? 50 : DETECT_INTERVAL_MS;
        if (landmarker && video.readyState >= 2 && now - lastDetect >= interval) {
          lastDetect = now;
          try {
            const res = landmarker.detectForVideo(video, now) as {
              landmarks?: Array<Array<{ x: number; y: number }>>;
              handedness?: Array<Array<{ categoryName?: string }>>;
            };
            // Collect detections first (mirrored landmarks + palm anchor +
            // MediaPipe's screen-space label kept only as the seed).
            const dets: Array<{
              mp: "Left" | "Right";
              x: number;
              y: number;
              landmarks: Array<{ x: number; y: number }>;
            }> = [];
            const lms = res.landmarks ?? [];
            for (let i = 0; i < lms.length && dets.length < 2; i++) {
              const raw = lms[i];
              if (!raw || raw.length < 21) continue;
              // Image-perspective label; swapped + mirrored for screen space.
              const imageLabel = res.handedness?.[i]?.[0]?.categoryName === "Left" ? "Left" : "Right";
              const mp: "Left" | "Right" = imageLabel === "Left" ? "Right" : "Left";
              const landmarks = raw.map((p) => ({ x: 1 - p.x, y: p.y }));
              // Palm anchor ≈ wrist↔middle-MCP midpoint — stable under
              // finger motion, moves with the whole hand.
              dets.push({
                mp,
                x: (landmarks[0].x + landmarks[9].x) / 2,
                y: (landmarks[0].y + landmarks[9].y) / 2,
                landmarks,
              });
            }

            // Expire anchors of hands not seen recently — after a real
            // absence the MediaPipe label re-seeds identity.
            for (const id of ["Left", "Right"] as const) {
              const p = prevPos[id];
              if (p && now - p.t > PREV_TTL_MS) delete prevPos[id];
            }

            // Assign ids: continuity with last frame's anchors wins; a
            // missing anchor costs a neutral 0.5 so real proximity always
            // dominates. Only fully-fresh hands trust MediaPipe labels
            // (with the old both-labeled-the-same dedupe — a phantom
            // detection stealing the label used to DROP the real hand).
            const cost = (d: { x: number; y: number }, id: "Left" | "Right") => {
              const p = prevPos[id];
              return p ? Math.hypot(d.x - p.x, d.y - p.y) : 0.5;
            };
            const hands: HandFrame["hands"] = [];
            if (dets.length === 1) {
              const det = dets[0];
              const id: "Left" | "Right" =
                !prevPos.Left && !prevPos.Right
                  ? det.mp
                  : cost(det, "Left") <= cost(det, "Right")
                    ? "Left"
                    : "Right";
              hands.push({ id, landmarks: det.landmarks });
            } else if (dets.length === 2) {
              const [a, b] = dets;
              if (!prevPos.Left && !prevPos.Right) {
                const aId = a.mp;
                const bId: "Left" | "Right" =
                  b.mp === aId ? (aId === "Left" ? "Right" : "Left") : b.mp;
                hands.push({ id: aId, landmarks: a.landmarks });
                hands.push({ id: bId, landmarks: b.landmarks });
              } else {
                // Pick the pairing with the smaller total anchor distance.
                const costLR = cost(a, "Left") + cost(b, "Right");
                const costRL = cost(a, "Right") + cost(b, "Left");
                const aId: "Left" | "Right" = costLR <= costRL ? "Left" : "Right";
                hands.push({ id: aId, landmarks: a.landmarks });
                hands.push({ id: aId === "Left" ? "Right" : "Left", landmarks: b.landmarks });
              }
            }
            // Refresh anchors for the ids just assigned.
            for (const h of hands) {
              prevPos[h.id] = {
                x: (h.landmarks[0].x + h.landmarks[9].x) / 2,
                y: (h.landmarks[0].y + h.landmarks[9].y) / 2,
                t: now,
              };
            }
            landmarksRef.current = { hands, t: now };
            detectCostMs += 0.2 * (performance.now() - now - detectCostMs);
            consecutiveFailures = 0;
          } catch {
            // Transient hiccup → keep the last good frame. But ~3s of
            // nonstop failures (90 ticks @30fps) means the detector is
            // wedged — surface the error overlay so Try-again can
            // rebuild the camera + landmarker instead of a dead UI.
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
