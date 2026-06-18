/**
 * StylistMode — full-screen AI Stylist camera takeover.
 *
 * Mirrors the ExerciseMode/BankMode shape (props { onExit, speak, stopSpeaking }).
 * Acquires the camera, lets the user pick a mode (Rate my outfit / Complete the
 * look / Compare two pieces), captures a still JPEG, POSTs it to /api/ai/stylist,
 * and renders the structured verdict as a card. No MediaPipe — the vision model
 * does the seeing.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { apiUrl } from "@/lib/apiBase";
import "./stylist-mode.css";

interface StylistModeProps {
  onExit: () => void;
  speak: (text: string) => void;
  stopSpeaking?: () => void;
}

type Mode = "rate" | "complete" | "compare";
type CamStatus = "loading" | "running" | "denied" | "error";

interface RecColor { name: string; hex: string; why: string }
interface StylistResult {
  headline: string;
  undertone: string;
  depth: string;
  season_guess: string;
  detected_upper: string;
  detected_lower: string;
  aesthetic: string;
  skin_harmony: number;
  coordination: number;
  style_coherence: number;
  total_score: number;
  reasoning: string;
  top_fix: string;
  recommendations: string[];
  recommended_colors: RecColor[];
  winner: string;
  confidence: string;
  caveat: string;
}

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function StylistMode({ onExit, speak, stopSpeaking }: StylistModeProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [camStatus, setCamStatus] = useState<CamStatus>("loading");

  const [mode, setMode] = useState<Mode>("rate");
  const [knownPiece, setKnownPiece] = useState<"upper" | "lower">("lower");
  const [target, setTarget] = useState("");
  const [modesty, setModesty] = useState(false);

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<StylistResult | null>(null);
  const [error, setError] = useState("");

  // ── Camera acquisition ──────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setCamStatus("loading");
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCamStatus("error");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: facing },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          try { await video.play(); } catch { /* autoplay quirk — muted+playsInline */ }
        }
        setCamStatus("running");
      } catch (e) {
        if (cancelled) return;
        const name = (e as DOMException)?.name ?? "";
        setCamStatus(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "error");
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [facing]);

  // ── Capture a base64 JPEG still from the live video ─────────────────
  const captureFrame = useCallback((): string | null => {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || !video.videoWidth) return null;
    const w = Math.min(960, video.videoWidth);
    const h = Math.round((video.videoHeight / video.videoWidth) * w);
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, w, h);
    try {
      return c.toDataURL("image/jpeg", 0.72).split(",")[1] ?? null;
    } catch {
      return null;
    }
  }, []);

  const analyze = useCallback(async () => {
    if (loading) return;
    setError("");
    const frame = captureFrame();
    if (!frame) {
      setError("Couldn't grab the camera — give it a second and try again.");
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch(apiUrl("/api/ai/stylist"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({
          mode,
          imageBase64: frame,
          imageMediaType: "image/jpeg",
          targetAesthetic: target.trim() || undefined,
          knownPiece: mode === "complete" ? knownPiece : undefined,
          modesty: modesty || undefined,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as Partial<StylistResult> & { error?: string };
      if (!res.ok) {
        setError(body.error || "The stylist couldn't read that — try a clearer, well-lit photo.");
        return;
      }
      setResult(body as StylistResult);
      if (body.headline) {
        try { speak(body.headline); } catch { /* TTS optional */ }
      }
    } catch {
      setError("Network hiccup — try again.");
    } finally {
      setLoading(false);
    }
  }, [loading, captureFrame, mode, target, knownPiece, modesty, speak]);

  const handleExit = useCallback(() => {
    try { stopSpeaking?.(); } catch { /* noop */ }
    onExit();
  }, [stopSpeaking, onExit]);

  const ctaLabel =
    mode === "complete" ? "Get matching colors" :
    mode === "compare" ? "Compare them" : "Rate my outfit";

  const denied = camStatus === "denied";
  const errored = camStatus === "error";

  return (
    <div className="sty-root">
      <video ref={videoRef} className={`sty-video${facing === "user" ? " is-mirror" : ""}`} muted playsInline autoPlay />
      <div className="sty-scrim" />

      {/* top bar */}
      <div className="sty-topbar">
        <div className="sty-brand">
          <span className="sty-dot" /> AI Stylist
        </div>
        <div className="sty-top-actions">
          <button type="button" className="sty-icon" title="Flip camera" onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))}>⟳</button>
          <button type="button" className="sty-icon sty-exit" title="Exit" onClick={handleExit}>✕</button>
        </div>
      </div>

      {/* camera problem overlay */}
      {(denied || errored) && (
        <div className="sty-camfail">
          <p className="sty-camfail-title">{denied ? "Camera access needed" : "Camera unavailable"}</p>
          <p className="sty-camfail-sub">
            {denied
              ? "Allow camera access in your browser, then reopen the Stylist."
              : "I couldn't start the camera on this device."}
          </p>
          <button type="button" className="sty-btn-ghost" onClick={handleExit}>Close</button>
        </div>
      )}

      {/* controls (hidden while a result is up) */}
      {!result && !denied && !errored && (
        <div className="sty-controls">
          <div className="sty-modes">
            {(["rate", "complete", "compare"] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                className={`sty-mode${mode === m ? " is-active" : ""}`}
                onClick={() => { setMode(m); setResult(null); setError(""); }}
              >
                {m === "rate" ? "Rate my outfit" : m === "complete" ? "Complete the look" : "Compare two"}
              </button>
            ))}
          </div>

          {mode === "complete" && (
            <div className="sty-segment">
              <span className="sty-seg-label">I'm showing my</span>
              <button type="button" className={`sty-seg${knownPiece === "upper" ? " is-active" : ""}`} onClick={() => setKnownPiece("upper")}>Top</button>
              <button type="button" className={`sty-seg${knownPiece === "lower" ? " is-active" : ""}`} onClick={() => setKnownPiece("lower")}>Bottom</button>
            </div>
          )}
          {mode === "compare" && (
            <p className="sty-hint">Hold both pieces up — left vs right.</p>
          )}

          <div className="sty-row">
            <input
              className="sty-input"
              value={target}
              onChange={(e) => setTarget(e.target.value.slice(0, 40))}
              placeholder="Target look? e.g. old money (optional)"
            />
            <button
              type="button"
              className={`sty-modest${modesty ? " is-on" : ""}`}
              title="Modesty-aware styling"
              onClick={() => setModesty((v) => !v)}
            >
              Modest {modesty ? "✓" : ""}
            </button>
          </div>

          <button type="button" className="sty-cta" disabled={loading || camStatus !== "running"} onClick={() => void analyze()}>
            {loading ? "Tony's looking…" : ctaLabel}
          </button>
          {error && <p className="sty-error">{error}</p>}
        </div>
      )}

      {/* result card */}
      {result && (
        <div className="sty-result">
          <div className="sty-result-card">
            <p className="sty-headline">{result.headline}</p>

            {mode === "rate" && result.total_score > 0 && (
              <>
                <div className="sty-score-total">
                  <span className="sty-score-num">{result.total_score}</span>
                  <span className="sty-score-den">/100</span>
                </div>
                <div className="sty-bars">
                  <Bar label="Skin match" value={result.skin_harmony} />
                  <Bar label="Coordination" value={result.coordination} />
                  <Bar label="Style" value={result.style_coherence} />
                </div>
              </>
            )}

            {mode === "compare" && result.winner && result.winner !== "none" && (
              <p className="sty-winner">Winner: <strong>{result.winner === "tie" ? "It's a tie" : `Option ${result.winner}`}</strong></p>
            )}

            {mode === "complete" && result.recommended_colors?.length > 0 && (
              <div className="sty-swatches">
                {result.recommended_colors.map((c, i) => (
                  <div className="sty-swatch" key={i}>
                    <span className="sty-chip" style={{ background: /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c.hex) ? c.hex : "#888" }} />
                    <div className="sty-swatch-text">
                      <span className="sty-swatch-name">{c.name}</span>
                      <span className="sty-swatch-why">{c.why}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {result.reasoning && <p className="sty-reason">{result.reasoning}</p>}
            {result.top_fix && (
              <p className="sty-fix"><span className="sty-fix-tag">Tip</span>{result.top_fix}</p>
            )}
            {result.recommendations?.length > 0 && (
              <ul className="sty-recs">
                {result.recommendations.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            )}
            {result.caveat && <p className="sty-caveat">{result.caveat}</p>}

            <div className="sty-result-actions">
              <button type="button" className="sty-cta sty-cta-sm" onClick={() => { setResult(null); setError(""); }}>Try another</button>
              <button type="button" className="sty-btn-ghost" onClick={handleExit}>Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Bar({ label, value }: { label: string; value: number }) {
  const pct = Math.max(0, Math.min(5, value)) / 5 * 100;
  return (
    <div className="sty-bar">
      <span className="sty-bar-label">{label}</span>
      <span className="sty-bar-track"><span className="sty-bar-fill" style={{ width: `${pct}%` }} /></span>
      <span className="sty-bar-val">{value}/5</span>
    </div>
  );
}
