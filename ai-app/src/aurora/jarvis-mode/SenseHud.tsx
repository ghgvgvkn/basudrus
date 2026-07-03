/**
 * SenseHud — the ruview-style "sensing observatory" layer INSIDE JARVIS.
 *
 * Founder feedback on the first standalone AI Radar/Vitals boxes: "it should
 * be integrated with JARVIS, in the camera, not another box" + "it does not
 * try to see the objects" + the ruview screenshot as the visual bar. This
 * layer renders over the live JARVIS feed:
 *
 *   · corner-bracket holo boxes on every detected person/object
 *   · VITAL SIGNS panel (left) — heart rate via rPPG sampled from the
 *     DETECTED person's face region (follows you; no fixed circle),
 *     respiration + confidence, honest states ("hold still", "come closer")
 *   · SENSE panel (right) — PRESENCE badge, persons count, motion level,
 *     what it sees (top objects with ~distance), mini radar map
 *
 * It consumes the video element JARVIS already owns (no second camera
 * stream) via useDetectorOnVideo. Purely visual — pointer-events: none —
 * so gestures/holo-tabs keep working through it. All on-device.
 */
import { useEffect, useRef, useState } from "react";
import { useDetectorOnVideo, type SenseFrame, type SensedItem } from "./useDetectorOnVideo";
import { RppgEngine } from "../vitals-mode/rppg";
import "./sense-hud.css";

interface SenseHudProps {
  videoRef: React.MutableRefObject<HTMLVideoElement | null>;
  /** The JARVIS video is CSS-mirrored (selfie). Boxes must flip to match. */
  mirrored?: boolean;
}

/** Rough real-world heights (m) per COCO class for the pinhole distance
 *  estimate; anything unlisted falls back to 0.5m. Honest approximation. */
const REF_HEIGHT_M: Record<string, number> = {
  person: 1.65, chair: 0.9, couch: 0.85, "potted plant": 0.5, bed: 0.6,
  "dining table": 0.75, tv: 0.55, laptop: 0.24, keyboard: 0.04, mouse: 0.04,
  "cell phone": 0.15, book: 0.24, bottle: 0.25, cup: 0.11, backpack: 0.45,
  handbag: 0.3, refrigerator: 1.7, microwave: 0.3, oven: 0.75, sink: 0.4,
  clock: 0.3, vase: 0.3, "teddy bear": 0.3, dog: 0.5, cat: 0.28,
  bicycle: 1.0, umbrella: 0.8, suitcase: 0.6,
};

function distanceM(it: SensedItem): number {
  const ref = REF_HEIGHT_M[it.label] ?? 0.5;
  const frac = Math.max(0.02, Math.min(1, it.h));
  return Math.max(0.4, Math.min(8, (ref * 0.96) / frac));
}

/** Cover-fit mapping: normalized RAW frame coords → screen px, honoring the
 *  CSS mirror (screen x flips) when the selfie feed is mirrored. */
function makeMapper(video: HTMLVideoElement, sw: number, sh: number, mirrored: boolean) {
  const vw = video.videoWidth || 640;
  const vh = video.videoHeight || 480;
  const scale = Math.max(sw / vw, sh / vh);
  const ox = (sw - vw * scale) / 2;
  const oy = (sh - vh * scale) / 2;
  return (nx: number, ny: number): [number, number] => {
    const px = ox + nx * vw * scale;
    return [mirrored ? sw - px : px, oy + ny * vh * scale];
  };
}

const MOTION_JUMP = 9;      // mean-green jump that reads as "moved" → reset
const HEART_PATCH_MIN = 0.16; // person box height below which we say "come closer"

export function SenseHud({ videoRef, mirrored = true }: SenseHudProps) {
  const { frameRef, status } = useDetectorOnVideo(videoRef, true);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const mapRef = useRef<HTMLCanvasElement | null>(null);

  // Low-frequency UI state (synced ~3×/sec from the rAF)
  const [persons, setPersons] = useState(0);
  const [labels, setLabels] = useState<Array<{ label: string; n: number; d: number }>>([]);
  const [motion, setMotion] = useState(0);
  const [heart, setHeart] = useState<{ bpm: number | null; brpm: number | null; conf: number; secs: number; hint: string }>({
    bpm: null, brpm: null, conf: 0, secs: 0, hint: "looking for you…",
  });

  const engineRef = useRef(new RppgEngine());
  const lastGreenRef = useRef(-1);
  const prevCentersRef = useRef<Array<[number, number]>>([]);

  useEffect(() => {
    let raf = 0;
    let lastUi = 0;
    const off = document.createElement("canvas");
    off.width = 40;
    off.height = 40;
    const octx = off.getContext("2d", { willReadFrequently: true });

    const resize = () => {
      const overlay = overlayRef.current;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (overlay) {
        overlay.width = Math.round(window.innerWidth * dpr);
        overlay.height = Math.round(window.innerHeight * dpr);
      }
      const map = mapRef.current;
      if (map) {
        const rect = map.getBoundingClientRect();
        map.width = Math.round(rect.width * dpr);
        map.height = Math.round(rect.height * dpr);
      }
    };
    resize();
    window.addEventListener("resize", resize);

    const loop = () => {
      const now = performance.now();
      const video = videoRef.current;
      const frame: SenseFrame = frameRef.current;
      const overlay = overlayRef.current;
      const octx2 = overlay?.getContext("2d") ?? null;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      // ── corner-bracket overlays ──
      if (octx2 && overlay && video) {
        octx2.clearRect(0, 0, overlay.width, overlay.height);
        if (frame.t) {
          const toScreen = makeMapper(video, overlay.width / dpr, overlay.height / dpr, mirrored);
          octx2.save();
          octx2.scale(dpr, dpr);
          octx2.font = "600 11px 'Geist Mono', ui-monospace, monospace";
          octx2.textBaseline = "top";
          for (const it of frame.items) {
            const [xa, y] = toScreen(it.x, it.y);
            const [xb, y2] = toScreen(it.x + it.w, it.y + it.h);
            const x = Math.min(xa, xb);
            const x2 = Math.max(xa, xb);
            const w = x2 - x;
            const h = y2 - y;
            const person = it.label === "person";
            const col = person ? "#7ce0b6" : "#7cc7e8";
            octx2.strokeStyle = col;
            octx2.lineWidth = person ? 1.8 : 1.2;
            octx2.globalAlpha = 0.85;
            const c = Math.min(16, w * 0.22, h * 0.22);
            octx2.beginPath();
            octx2.moveTo(x, y + c); octx2.lineTo(x, y); octx2.lineTo(x + c, y);
            octx2.moveTo(x2 - c, y); octx2.lineTo(x2, y); octx2.lineTo(x2, y + c);
            octx2.moveTo(x2, y2 - c); octx2.lineTo(x2, y2); octx2.lineTo(x2 - c, y2);
            octx2.moveTo(x + c, y2); octx2.lineTo(x, y2); octx2.lineTo(x, y2 - c);
            octx2.stroke();
            const text = `${it.label.toUpperCase()} ~${distanceM(it).toFixed(1)}M`;
            const tw = octx2.measureText(text).width + 8;
            octx2.globalAlpha = 0.68;
            octx2.fillStyle = "#060d16";
            octx2.fillRect(x, Math.max(0, y - 16), tw, 14);
            octx2.globalAlpha = 1;
            octx2.fillStyle = col;
            octx2.fillText(text, x + 4, Math.max(0, y - 16) + 2);
          }
          octx2.restore();
        }
      }

      // ── rPPG: sample the face region of the LARGEST person box ──
      const people = frame.items.filter((i) => i.label === "person");
      const main = people.sort((a, b) => b.h - a.h)[0];
      if (video && octx && main && video.readyState >= 2) {
        if (main.h < HEART_PATCH_MIN) {
          if (now - lastUi > 300) setHeart((p) => ({ ...p, hint: "come closer for vitals" }));
        } else {
          // face ≈ top-center of the person box (raw/unmirrored coords are fine
          // — we sample the RAW video, mirroring is display-only)
          const vw = video.videoWidth || 640;
          const vh = video.videoHeight || 480;
          const side = Math.max(24, main.w * 0.34 * vw);
          const cx = (main.x + main.w / 2) * vw;
          const cy = (main.y + main.h * 0.12) * vh;
          try {
            octx.drawImage(video, cx - side / 2, cy - side / 2, side, side, 0, 0, 40, 40);
            const px = octx.getImageData(0, 0, 40, 40).data;
            let g = 0;
            for (let i = 0; i < px.length; i += 4) g += px[i + 1];
            g /= px.length / 4;
            if (lastGreenRef.current >= 0 && Math.abs(g - lastGreenRef.current) > MOTION_JUMP) {
              engineRef.current.reset();
            } else {
              engineRef.current.addSample(g, now);
            }
            lastGreenRef.current = g;
          } catch {
            /* teardown race — skip frame */
          }
        }
      } else if (!main) {
        engineRef.current.reset();
        lastGreenRef.current = -1;
      }

      // ── mini radar ──
      const map = mapRef.current;
      const mctx = map?.getContext("2d") ?? null;
      if (mctx && map && map.width > 0) {
        const W = map.width;
        const H = map.height;
        mctx.clearRect(0, 0, W, H);
        const cx = W / 2;
        const cy = H * 0.9;
        const R = H * 0.8;
        const rFor = (d: number) => R * (Math.log2(1 + d) / Math.log2(9));
        mctx.strokeStyle = "rgba(124,199,232,0.3)";
        mctx.lineWidth = 1;
        for (const d of [1, 2, 4, 8]) {
          mctx.beginPath();
          mctx.arc(cx, cy, rFor(d), Math.PI, 2 * Math.PI);
          mctx.stroke();
        }
        const half = (35 * Math.PI) / 180;
        const sweep = -half + ((now / 1500) % 1) * 2 * half;
        mctx.strokeStyle = "rgba(124,224,182,0.55)";
        mctx.beginPath();
        mctx.moveTo(cx, cy);
        mctx.lineTo(cx + R * Math.sin(sweep), cy - R * Math.cos(sweep));
        mctx.stroke();
        for (const it of frame.items) {
          const d = distanceM(it);
          const cxN = it.x + it.w / 2;
          const a = ((cxN - 0.5) * 65 * Math.PI) / 180 * (mirrored ? -1 : 1);
          const r = rFor(d);
          mctx.fillStyle = it.label === "person" ? "#7ce0b6" : "#7cc7e8";
          mctx.beginPath();
          mctx.arc(cx + r * Math.sin(a), cy - r * Math.cos(a), it.label === "person" ? 3.4 * (W / 160) : 2.2 * (W / 160), 0, 2 * Math.PI);
          mctx.fill();
        }
        mctx.fillStyle = "#eaf4ff";
        mctx.beginPath();
        mctx.arc(cx, cy, 2.4 * (W / 160), 0, 2 * Math.PI);
        mctx.fill();
      }

      // ── low-frequency UI sync (~3×/sec) ──
      if (now - lastUi > 320) {
        lastUi = now;
        setPersons(people.length);
        // motion: mean center displacement between syncs
        const centers: Array<[number, number]> = frame.items.map((i) => [i.x + i.w / 2, i.y + i.h / 2]);
        const prev = prevCentersRef.current;
        let m = 0;
        const n = Math.min(centers.length, prev.length);
        for (let i = 0; i < n; i++) m += Math.hypot(centers[i][0] - prev[i][0], centers[i][1] - prev[i][1]);
        prevCentersRef.current = centers;
        setMotion(n > 0 ? Math.min(1, (m / n) * 8) : 0);

        const byLabel = new Map<string, { n: number; d: number }>();
        for (const it of frame.items) {
          const cur = byLabel.get(it.label);
          const d = distanceM(it);
          if (cur) { cur.n += 1; cur.d = Math.min(cur.d, d); }
          else byLabel.set(it.label, { n: 1, d });
        }
        const list = [...byLabel.entries()]
          .map(([label, v]) => ({ label, n: v.n, d: v.d }))
          .sort((a, b) => (a.label === "person" ? -1 : b.label === "person" ? 1 : a.d - b.d))
          .slice(0, 6);
        setLabels((prevL) =>
          prevL.length === list.length && prevL.every((p, i) => p.label === list[i].label && p.n === list[i].n)
            ? prevL
            : list,
        );

        const est = engineRef.current.estimate();
        const hint = !main
          ? "looking for you…"
          : main.h < HEART_PATCH_MIN
            ? "come closer for vitals"
            : est.bpm
              ? "locked"
              : est.seconds < 2
                ? "hold still…"
                : `measuring ${Math.round(est.seconds)}s`;
        setHeart({ bpm: est.bpm, brpm: est.brpm, conf: est.bpmConfidence, secs: est.seconds, hint });
      }

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [frameRef, videoRef, mirrored]);

  if (status === "error") return null; // degrade silently — JARVIS stays intact

  const confPct = Math.max(0, Math.min(100, Math.round((heart.conf / 12) * 100)));

  return (
    <div className="shud-root" aria-hidden>
      <canvas ref={overlayRef} className="shud-overlay" />

      {/* VITAL SIGNS — left panel (ruview reference) */}
      <div className="shud-panel shud-vitals">
        <div className="shud-title">VITAL SIGNS</div>
        <div className="shud-row">
          <span className="shud-ico shud-heart">♥</span>
          <span className="shud-label">HEART RATE</span>
        </div>
        <div className="shud-big shud-red">
          {heart.bpm ?? "--"} <span className="shud-unit">BPM</span>
        </div>
        <div className="shud-row">
          <span className="shud-ico">☼</span>
          <span className="shud-label">RESPIRATION</span>
        </div>
        <div className="shud-mid">
          {heart.brpm ?? "--"} <span className="shud-unit">RPM</span>
        </div>
        <div className="shud-label">CONFIDENCE</div>
        <div className="shud-bar">
          <span style={{ width: `${confPct}%` }} />
        </div>
        <div className="shud-hint">{heart.hint} · estimate, not medical</div>
      </div>

      {/* SENSE — right panel */}
      <div className="shud-panel shud-sense">
        <div className="shud-title">SENSE</div>
        <div className="shud-kv"><span>PERSONS</span><b>{persons}</b></div>
        <div className="shud-kv"><span>MOTION</span><b>{motion.toFixed(2)}</b></div>
        <div className={`shud-presence ${persons > 0 ? "is-on" : ""}`}>
          {persons > 0 ? "PRESENT" : "NO PRESENCE"}
        </div>
        {labels.length > 0 && (
          <div className="shud-objects">
            {labels.map((l) => (
              <div key={l.label} className={`shud-obj ${l.label === "person" ? "is-person" : ""}`}>
                {l.label.toUpperCase()}{l.n > 1 ? ` ×${l.n}` : ""} <i>~{l.d.toFixed(1)}m</i>
              </div>
            ))}
          </div>
        )}
        <canvas ref={mapRef} className="shud-map" />
        <div className="shud-note">approximate · camera view only</div>
      </div>
    </div>
  );
}
