/**
 * RadarMode — "AI Radar": full-screen camera takeover that SEES the room.
 *
 * Point the camera around: MediaPipe ObjectDetector (on-device, EfficientDet)
 * finds people + everyday objects, draws JARVIS-style holo boxes over the live
 * video, counts people, lists what it can see, and plots everything on a
 * top-down radar map with APPROXIMATE positions (angle from where the object
 * sits in frame, distance estimated from apparent size — honest estimate,
 * not measurement; through-wall sensing needs radio hardware, not a webcam).
 *
 * Mirrors the ExerciseMode/StylistMode shape (props { onExit, speak,
 * stopSpeaking }), and the same privacy stance: every frame is processed
 * on-device; nothing is uploaded.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useObjectDetection, type DetectionFrame, type DetectedItem } from "./useObjectDetection";
import "./radar-mode.css";

interface RadarModeProps {
  onExit: () => void;
  /** Speak a short line in Tony's voice (TTS). */
  speak: (text: string) => void;
  /** Stop any in-flight speech (on exit / mute). */
  stopSpeaking?: () => void;
}

/** Rough real-world heights (meters) per COCO class, for the pinhole
 *  distance estimate. Anything unlisted falls back to 0.5m. */
const REF_HEIGHT_M: Record<string, number> = {
  person: 1.65,
  chair: 0.9,
  couch: 0.85,
  "potted plant": 0.5,
  bed: 0.6,
  "dining table": 0.75,
  tv: 0.55,
  laptop: 0.24,
  mouse: 0.04,
  keyboard: 0.04,
  "cell phone": 0.15,
  book: 0.24,
  bottle: 0.25,
  cup: 0.11,
  backpack: 0.45,
  handbag: 0.3,
  refrigerator: 1.7,
  microwave: 0.3,
  oven: 0.75,
  sink: 0.4,
  clock: 0.3,
  vase: 0.3,
  "teddy bear": 0.3,
  dog: 0.5,
  cat: 0.28,
  bicycle: 1.0,
  umbrella: 0.8,
  suitcase: 0.6,
};

/** Pinhole estimate: distance ≈ realHeight / boxHeightFraction, with the
 *  ~55° vertical FOV a phone/laptop camera typically has baked into the
 *  constant. Clamped — beyond ~8m a webcam guess is noise. */
function estimateDistanceM(item: DetectedItem): number {
  const ref = REF_HEIGHT_M[item.label] ?? 0.5;
  const frac = Math.max(0.02, Math.min(1, item.h));
  return Math.max(0.4, Math.min(8, (ref * 0.96) / frac));
}

/** Horizontal angle from frame position, mapped onto a ~±32° camera FOV. */
function estimateAngleDeg(item: DetectedItem): number {
  const cx = item.x + item.w / 2;
  return (cx - 0.5) * 65;
}

/** Cover-fit mapping: normalized video coords → screen px (object-fit: cover). */
function coverMap(vw: number, vh: number, sw: number, sh: number) {
  const scale = Math.max(sw / vw, sh / vh);
  const ox = (sw - vw * scale) / 2;
  const oy = (sh - vh * scale) / 2;
  return (nx: number, ny: number): [number, number] => [ox + nx * vw * scale, oy + ny * vh * scale];
}

export function RadarMode({ onExit, speak, stopSpeaking }: RadarModeProps) {
  const det = useObjectDetection(true);
  const { videoRef, detectionsRef, status } = det;
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const mapRef = useRef<HTMLCanvasElement | null>(null);

  const [muted, setMuted] = useState(false);
  const [peopleCount, setPeopleCount] = useState(0);
  const [labels, setLabels] = useState<Array<{ label: string; n: number }>>([]);

  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const spokenCountRef = useRef(-1);
  const lastSpeakRef = useRef(0);
  const stableCountRef = useRef<{ count: number; frames: number }>({ count: -1, frames: 0 });

  const speakSafe = useCallback(
    (text: string) => {
      if (mutedRef.current) return;
      try {
        speak(text);
      } catch {
        /* TTS optional */
      }
    },
    [speak],
  );

  // Greeting once the detector is live.
  const greetedRef = useRef(false);
  useEffect(() => {
    if (status === "running" && !greetedRef.current) {
      greetedRef.current = true;
      speakSafe("Radar online. Pan the camera around the room.");
    }
  }, [status, speakSafe]);

  // ════════════ the single rAF loop (draw boxes + radar map + announce) ════════════
  useEffect(() => {
    let raf = 0;
    let lastUiSync = 0;
    const overlay = overlayRef.current;
    const octx = overlay?.getContext("2d") ?? null;
    const map = mapRef.current;
    const mctx = map?.getContext("2d") ?? null;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (overlay) {
        overlay.width = Math.round(window.innerWidth * dpr);
        overlay.height = Math.round(window.innerHeight * dpr);
      }
      if (map) {
        // CSS size is fixed by the stylesheet; render at dpr for crispness.
        const rect = map.getBoundingClientRect();
        map.width = Math.round(rect.width * dpr);
        map.height = Math.round(rect.height * dpr);
      }
    };
    resize();
    window.addEventListener("resize", resize);

    const loop = () => {
      const now = performance.now();
      const frame: DetectionFrame = detectionsRef.current;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      // ── holo boxes over the live video ──
      if (octx && overlay) {
        octx.clearRect(0, 0, overlay.width, overlay.height);
        if (frame.t && frame.videoW && frame.videoH) {
          const toScreen = coverMap(frame.videoW, frame.videoH, overlay.width / dpr, overlay.height / dpr);
          octx.save();
          octx.scale(dpr, dpr);
          octx.font = "600 12px Geist, system-ui, sans-serif";
          octx.textBaseline = "top";
          for (const it of frame.items) {
            const [x, y] = toScreen(it.x, it.y);
            const [x2, y2] = toScreen(it.x + it.w, it.y + it.h);
            const w = x2 - x;
            const h = y2 - y;
            const person = it.label === "person";
            const col = person ? "#7ce0b6" : "#7cc7e8";
            octx.strokeStyle = col;
            octx.lineWidth = person ? 2 : 1.4;
            octx.globalAlpha = 0.9;
            // Corner-bracket box (JARVIS look) instead of a full rectangle.
            const c = Math.min(18, w * 0.25, h * 0.25);
            octx.beginPath();
            octx.moveTo(x, y + c); octx.lineTo(x, y); octx.lineTo(x + c, y);
            octx.moveTo(x2 - c, y); octx.lineTo(x2, y); octx.lineTo(x2, y + c);
            octx.moveTo(x2, y2 - c); octx.lineTo(x2, y2); octx.lineTo(x2 - c, y2);
            octx.moveTo(x + c, y2); octx.lineTo(x, y2); octx.lineTo(x, y2 - c);
            octx.stroke();
            // Label chip with distance estimate.
            const dist = estimateDistanceM(it);
            const text = `${it.label} · ~${dist.toFixed(1)}m`;
            const tw = octx.measureText(text).width + 10;
            octx.globalAlpha = 0.72;
            octx.fillStyle = "#08131f";
            octx.fillRect(x, Math.max(0, y - 18), tw, 16);
            octx.globalAlpha = 1;
            octx.fillStyle = col;
            octx.fillText(text, x + 5, Math.max(0, y - 18) + 2);
          }
          octx.restore();
        }
      }

      // ── top-down radar map ──
      if (mctx && map && map.width > 0) {
        const W = map.width;
        const H = map.height;
        mctx.clearRect(0, 0, W, H);
        const cx = W / 2;
        const cy = H * 0.92; // camera sits at the bottom-center
        const R = H * 0.84;
        // Range rings at 1 / 2 / 4 / 8 m (log spacing keeps close range readable).
        mctx.strokeStyle = "rgba(124, 199, 232, 0.28)";
        mctx.fillStyle = "rgba(124, 199, 232, 0.55)";
        mctx.lineWidth = 1;
        mctx.font = `${Math.round(9 * (W / 200))}px Geist, system-ui, sans-serif`;
        const rFor = (d: number) => R * (Math.log2(1 + d) / Math.log2(9));
        for (const d of [1, 2, 4, 8]) {
          const r = rFor(d);
          mctx.beginPath();
          mctx.arc(cx, cy, r, Math.PI, 2 * Math.PI);
          mctx.stroke();
          mctx.fillText(`${d}m`, cx + 4, cy - r + 2);
        }
        // FOV wedge.
        const half = (35 * Math.PI) / 180;
        mctx.strokeStyle = "rgba(124, 224, 182, 0.35)";
        mctx.beginPath();
        mctx.moveTo(cx, cy);
        mctx.lineTo(cx + R * Math.sin(-half), cy - R * Math.cos(-half));
        mctx.moveTo(cx, cy);
        mctx.lineTo(cx + R * Math.sin(half), cy - R * Math.cos(half));
        mctx.stroke();
        // Sweep line.
        const sweep = -half + ((now / 1400) % 1) * 2 * half;
        mctx.strokeStyle = "rgba(124, 224, 182, 0.6)";
        mctx.beginPath();
        mctx.moveTo(cx, cy);
        mctx.lineTo(cx + R * Math.sin(sweep), cy - R * Math.cos(sweep));
        mctx.stroke();
        // Blips.
        for (const it of frame.items) {
          const d = estimateDistanceM(it);
          const a = (estimateAngleDeg(it) * Math.PI) / 180;
          const r = rFor(d);
          const bx = cx + r * Math.sin(a);
          const by = cy - r * Math.cos(a);
          const person = it.label === "person";
          mctx.fillStyle = person ? "#7ce0b6" : "#7cc7e8";
          mctx.beginPath();
          mctx.arc(bx, by, person ? 4.5 * (W / 200) : 3 * (W / 200), 0, 2 * Math.PI);
          mctx.fill();
          if (person) {
            // soft pulse ring
            mctx.strokeStyle = "rgba(124, 224, 182, 0.5)";
            mctx.beginPath();
            mctx.arc(bx, by, (5 + ((now / 90) % 10)) * (W / 200) * 0.6, 0, 2 * Math.PI);
            mctx.stroke();
          }
        }
        // Camera marker.
        mctx.fillStyle = "#eaf4ff";
        mctx.beginPath();
        mctx.arc(cx, cy, 3 * (W / 200), 0, 2 * Math.PI);
        mctx.fill();
      }

      // ── low-frequency UI sync + voice announcements (4x/sec) ──
      if (now - lastUiSync > 250) {
        lastUiSync = now;
        const people = frame.items.filter((i) => i.label === "person").length;
        setPeopleCount(people);
        const byLabel = new Map<string, number>();
        for (const it of frame.items) byLabel.set(it.label, (byLabel.get(it.label) ?? 0) + 1);
        const list = [...byLabel.entries()]
          .map(([label, n]) => ({ label, n }))
          .sort((a, b) => b.n - a.n)
          .slice(0, 8);
        setLabels((prev) =>
          prev.length === list.length && prev.every((p, i) => p.label === list[i].label && p.n === list[i].n)
            ? prev
            : list,
        );
        // Announce people-count changes once the count is STABLE for ~1s
        // (4 consecutive syncs) so a flickery detection doesn't chatter.
        const st = stableCountRef.current;
        if (people === st.count) st.frames += 1;
        else stableCountRef.current = { count: people, frames: 1 };
        if (
          st.frames === 4 &&
          people !== spokenCountRef.current &&
          now - lastSpeakRef.current > 5000
        ) {
          spokenCountRef.current = people;
          lastSpeakRef.current = now;
          if (people > 0) {
            speakSafe(people === 1 ? "One person in view." : `${people} people in view.`);
          }
        }
      }

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [detectionsRef, speakSafe]);

  const handleExit = () => {
    try {
      stopSpeaking?.();
    } catch {
      /* noop */
    }
    onExit();
  };

  const loading = status === "loading" || status === "idle";
  const denied = status === "denied" || status === "unsupported";
  const errored = status === "error";

  return (
    <div className="rad-root">
      <video ref={videoRef} className="rad-video" muted playsInline autoPlay />
      <canvas ref={overlayRef} className="rad-overlay" />
      <div className="rad-scrim" />

      {/* top bar */}
      <div className="rad-topbar">
        <div className="rad-brand">
          <span className="rad-dot" /> AI Radar
        </div>
        <div className="rad-top-actions">
          <button className="rad-icon" onClick={() => setMuted((m) => !m)} title={muted ? "Unmute Tony" : "Mute Tony"}>
            {muted ? "🔇" : "🔊"}
          </button>
          {det.cameraCount > 1 && (
            <button className="rad-icon" onClick={det.cycleCamera} title={det.cameraLabel || "Switch camera"}>
              ⟳
            </button>
          )}
          <button className="rad-icon rad-exit" onClick={handleExit} title="Exit" aria-label="Exit AI Radar">
            ✕
          </button>
        </div>
      </div>

      {/* live readouts */}
      {status === "running" && (
        <>
          <div className="rad-people">
            <span className="rad-people-num">{peopleCount}</span>
            <span className="rad-people-label">{peopleCount === 1 ? "person" : "people"} in view</span>
          </div>
          {labels.length > 0 && (
            <div className="rad-chips">
              {labels.map((l) => (
                <span key={l.label} className={`rad-chip ${l.label === "person" ? "is-person" : ""}`}>
                  {l.label}
                  {l.n > 1 ? ` ×${l.n}` : ""}
                </span>
              ))}
            </div>
          )}
          <div className="rad-map-wrap">
            <canvas ref={mapRef} className="rad-map" />
            <div className="rad-map-note">approximate positions · camera view only</div>
          </div>
        </>
      )}

      {/* states */}
      {loading && (
        <div className="rad-overlay-state">
          <div className="rad-spinner" />
          <div className="rad-state-title">Bringing radar online…</div>
          <div className="rad-state-sub">Loading the on-device detector. Nothing is uploaded.</div>
        </div>
      )}
      {denied && (
        <div className="rad-overlay-state">
          <div className="rad-state-title">Camera needed</div>
          <div className="rad-state-sub">Allow camera access so Tony can scan the room, then try again.</div>
          <button className="rad-cta" onClick={det.retry}>Try again</button>
          <button className="rad-cta rad-cta-ghost" onClick={handleExit}>Exit</button>
        </div>
      )}
      {errored && (
        <div className="rad-overlay-state">
          <div className="rad-state-title">Radar hiccup</div>
          <div className="rad-state-sub">Something interrupted the camera or the detector.</div>
          <button className="rad-cta" onClick={det.retry}>Try again</button>
          <button className="rad-cta rad-cta-ghost" onClick={handleExit}>Exit</button>
        </div>
      )}
    </div>
  );
}
