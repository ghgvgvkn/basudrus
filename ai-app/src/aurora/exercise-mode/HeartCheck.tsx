/**
 * HeartCheck — post-workout heart-rate estimate INSIDE AI Exercise.
 *
 * Founder: "the heart beating should be interacted with exercise." Camera
 * rPPG physically needs stillness (motion swamps the pulse signal), so the
 * honest placement is right AFTER the workout: the done screen offers a
 * "Check heart rate" button; the user steps close, holds still ~15s, and
 * gets their post-exercise BPM from the SAME camera + pose tracker that
 * just coached them.
 *
 * The face patch FOLLOWS the pose landmarks (nose + eyes) — no fixed
 * circle to line up with (the standalone Vitals box failed users exactly
 * there). Estimate only; the UI says "not medical" permanently.
 */
import { useEffect, useRef, useState } from "react";
import { RppgEngine } from "../vitals-mode/rppg";
import type { PoseFrame } from "./usePoseTracking";

interface HeartCheckProps {
  videoRef: React.MutableRefObject<HTMLVideoElement | null>;
  landmarksRef: React.MutableRefObject<PoseFrame>;
}

const MOTION_JUMP = 9;

export function HeartCheck({ videoRef, landmarksRef }: HeartCheckProps) {
  const [active, setActive] = useState(false);
  const [bpm, setBpm] = useState<number | null>(null);
  const [secs, setSecs] = useState(0);
  const [hint, setHint] = useState("Step close & hold still");

  const engineRef = useRef(new RppgEngine());
  const lastGreenRef = useRef(-1);

  useEffect(() => {
    if (!active) return;
    engineRef.current.reset();
    lastGreenRef.current = -1;
    setBpm(null);
    setSecs(0);

    let raf = 0;
    let lastUi = 0;
    const off = document.createElement("canvas");
    off.width = 40;
    off.height = 40;
    const octx = off.getContext("2d", { willReadFrequently: true });

    const loop = () => {
      const now = performance.now();
      const video = videoRef.current;
      const lm = landmarksRef.current.landmarks;

      if (video && octx && video.readyState >= 2 && lm) {
        const nose = lm[0];
        const eyeL = lm[2];
        const eyeR = lm[5];
        const vis = Math.min(nose?.visibility ?? 0, eyeL?.visibility ?? 0, eyeR?.visibility ?? 0);
        if (vis > 0.55) {
          const vw = video.videoWidth || 640;
          const vh = video.videoHeight || 480;
          // Landmarks are in MIRRORED screen space (usePoseTracking flips x);
          // the RAW video needs the flip undone for sampling.
          const eyeSpan = Math.abs(eyeL.x - eyeR.x); // normalized width units
          if (eyeSpan < 0.028) {
            if (now - lastUi > 400) setHint("Come closer to the camera");
          } else {
            const cxMirrored = (eyeL.x + eyeR.x) / 2;
            const cx = (1 - cxMirrored) * vw;
            const cy = ((eyeL.y + eyeR.y) / 2 + eyeSpan * 0.9) * vh; // cheeks/nose area
            const side = Math.max(24, eyeSpan * 2.6 * vw);
            try {
              octx.drawImage(video, cx - side / 2, cy - side / 2, side, side, 0, 0, 40, 40);
              const px = octx.getImageData(0, 0, 40, 40).data;
              // Motion check on GREEN; the engine gets CHROMINANCE g-(r+b)/2,
              // which cancels room/monitor light changes that raw green passes
              // straight through (measured: flicker turned raw green into
              // 0/24 locks; chrominance locked 24/24 — see SenseHud).
              let g = 0;
              let chrom = 0;
              for (let i = 0; i < px.length; i += 4) {
                g += px[i + 1];
                chrom += px[i + 1] - (px[i] + px[i + 2]) / 2;
              }
              const count = px.length / 4;
              g /= count;
              chrom /= count;
              if (lastGreenRef.current >= 0 && Math.abs(g - lastGreenRef.current) > MOTION_JUMP) {
                engineRef.current.reset();
                if (now - lastUi > 400) setHint("Hold still…");
              } else {
                engineRef.current.addSample(chrom, now);
              }
              lastGreenRef.current = g;
            } catch {
              /* teardown race — skip */
            }
          }
        } else if (now - lastUi > 400) {
          setHint("Face the camera");
        }
      }

      if (now - lastUi > 500) {
        lastUi = now;
        const est = engineRef.current.estimate();
        setSecs(Math.round(est.seconds));
        if (est.bpm != null) {
          setBpm(est.bpm);
          setHint("Post-workout estimate");
        } else if (est.seconds >= 2) {
          setHint("Measuring — keep steady");
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active, videoRef, landmarksRef]);

  if (!active) {
    return (
      <button className="exr-cta exr-cta-ghost" onClick={() => setActive(true)}>
        ♥ Check heart rate
      </button>
    );
  }

  return (
    <div className="exr-heart">
      <div className="exr-heart-bpm">
        {bpm ?? "--"} <span>bpm</span>
      </div>
      <div className="exr-heart-hint">
        {hint}
        {bpm == null && secs > 0 ? ` · ${Math.min(20, secs)}s` : ""}
      </div>
      <div className="exr-heart-note">Experimental camera estimate — not a medical device.</div>
      <button className="exr-cta exr-cta-ghost" onClick={() => setActive(false)}>Done</button>
    </div>
  );
}
