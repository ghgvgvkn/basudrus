/**
 * JarvisMode — the camera-controlled holodeck layer of Tony's voice mode.
 *
 * THE FOUNDER'S SPEC (his words → behavior):
 *   "the camera inside the camera… screens showing the data"
 *        → mirrored selfie video fills the stage; Tony's data artifacts
 *          float over it as draggable holo-tabs; the orb docks right.
 *   "move the tab with your hand"            → pinch a tab, drag it.
 *   "take the tab with two hands… in smaller, out bigger"
 *        → both hands pinching = resize the held tab.
 *   "two hands together → create a circle"   → clap spawns a mini orb.
 *   "hand to the left → only the AI speaking"→ swipe-left = focus mode
 *          (tabs fly off); swipe-right brings them back.
 *   "click on the data to see resources"     → quick pinch-tap a tab to
 *          expand its detail/source section.
 *   "sometimes without camera"               → this whole layer is an
 *          OPTIONAL mode; classic voice mode is untouched.
 *
 * ARCHITECTURE (three stacked layers, back→front):
 *   1. <video> — mirrored webcam, object-fit cover, dimmed for legibility.
 *   2. Holo-windows — absolutely-positioned tabs rendering Tony's parsed
 *      artifacts (STAT/DATA/QUOTE/COMPARE/SHOW) + user-spawned notes/orbs.
 *   3. <canvas> — hand skeleton, fingertip cursors, pinch sparks. Drawn in
 *      the same rAF that runs the GestureEngine, so cursor and action can
 *      never disagree.
 *
 * PERFORMANCE CONTRACT (weak-MacBook rule):
 *   - No per-frame React state. Live drag/scale mutate element styles via
 *     refs; React state commits only on gesture end (and add/remove).
 *   - Canvas draws strokes only (no shadows/filters per frame).
 *   - MediaPipe runs at ~30fps on the GPU delegate (see useHandTracking).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchMapboxFlyImages, type MapboxFlyImages, type ParsedMessage } from "../auroraVisuals";
import { renderMarkdown } from "../auroraMarkdown";
import { GestureEngine, HAND_WARMUP_MS, isTap, type CursorState, type GestureEvent } from "./gestures";
import { useHandTracking } from "./useHandTracking";
import type { ViewerHandCursor } from "../../jarvis/explode";
import "./jarvis-mode.css";

/** Short commit SHA injected by vite.config define — shown in the
 *  telemetry strip so a screenshot tells us which build is running. */
declare const __BUILD_SHA__: string;

// ── window model ────────────────────────────────────────────────────────────

type HoloPayload =
  | { kind: "stat"; label: string; big: string; sub?: string }
  | { kind: "data"; title: string; rows: Array<{ key: string; value: string }> }
  | { kind: "quote"; text: string; attribution?: string }
  | {
      kind: "compare";
      title: string;
      labelA: string;
      labelB: string;
      rows: Array<{ key: string; valueA: string; valueB: string }>;
    }
  | { kind: "show"; query: string; snippet: string }
  | { kind: "note"; text: string }
  | { kind: "orb" }
  | { kind: "welcome" }
  // Spawned from the hand-tap "+" menu:
  | { kind: "map"; query: string }
  | { kind: "pdf"; name: string; url: string }
  | { kind: "ask"; mode: "tony" | "model3d" };

interface HoloWindow {
  id: number;
  payload: HoloPayload;
  /** Center position in viewport px + uniform scale. */
  x: number;
  y: number;
  scale: number;
  z: number;
  expanded: boolean;
}

const MAX_WINDOWS = 8;
const SCALE_MIN = 0.45;
const SCALE_MAX = 1.8;
/** Flick momentum: release a drag faster than this (workspace px/s) and
 *  the tab keeps gliding with friction instead of stopping dead. */
const FLICK_MIN_SPEED = 650;
/** STRETCH-TO-CREATE (the AR-reel move): two pinches that BEGIN closer
 *  than this (normalized hand distance) are "hands together" — pulling
 *  them apart stretches a new tab into existence instead of zooming. */
// 0.14 (was 0.18): a missed two-hand RESIZE — both pinches landing
// just off the tab — must not read as "create". The deliberate
// hands-together creation sign starts well under this.
const CREATE_START_MAX = 0.14;
/** Spread the pinches past this distance and the ghost frame arms —
 *  release spawns the tab. Release before reaching it cancels. */
const CREATE_MIN_DIST = 0.3;
/** A glide that hits the LEFT or RIGHT wall still moving faster than
 *  this acts (delete / save-to-dock); slower impacts bounce. The
 *  founder threw a tab at the wall expecting the edge action and got
 *  a bounce — release-at-edge and throw-at-edge must agree. */
const FLICK_TOSS_SPEED = 850;
/** Exponential friction (per second) while gliding. 2.2 (was 4) —
 *  ball rules: a good throw should cross the screen and survive a
 *  bounce or two before settling. */
const FLICK_DECAY = 2.2;
/** Glide ends (and commits to React) below this speed. */
const FLICK_STOP_SPEED = 40;
/** Velocity older than this at release is stale — the hand stopped,
 *  hovered, THEN let go. No glide. */
const FLICK_STALE_MS = 120;

/** Spawn slots hug the LEFT edge (and a little top-right), deliberately
 *  avoiding the center ~0.32–0.72 x band where the user sits in frame —
 *  the founder's tabs were landing on their face. Orb owns the bottom-
 *  right corner, so we keep clear of that too. Fractions of viewport. */
const SPAWN_SLOTS: Array<[number, number]> = [
  [0.16, 0.30],
  [0.16, 0.52],
  [0.16, 0.74],
  [0.84, 0.26],
  [0.84, 0.48],
  [0.30, 0.22],
];

// ── audio feedback ───────────────────────────────────────────────────────────
// Tiny synthesized ticks (no audio files): pinch = tick, grab = tock,
// hand-tap on a button = click. Quiet by design —
// feedback, not music. AudioContext is created lazily on the first gesture
// (JARVIS mode itself starts from a user click, so autoplay rules pass).
let audioCtx: AudioContext | null = null;
function blip(freq: number, durMs: number, gain = 0.045, type: OscillatorType = "sine"): void {
  try {
    audioCtx ??= new AudioContext();
    const ctx = audioCtx;
    if (ctx.state === "suspended") void ctx.resume();
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + durMs / 1000);
    osc.connect(g).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + durMs / 1000 + 0.02);
  } catch {
    /* audio is decorative — never let it break gestures */
  }
}

// MediaPipe hand skeleton bone pairs (21-landmark topology).
const BONES: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

interface JarvisModeProps {
  presenting: ParsedMessage;
  presentingImage: string | null;
  onExit: () => void;
  /** Camera-only mode — Tony's mic is released and he stays silent.
   *  Owned by the screen (it owns the voice pipeline); JARVIS just
   *  renders the toggle. */
  micMuted?: boolean;
  onToggleMic?: () => void;
  /** Tony's voice speed (1 / 1.2 / 1.5 / 2) + the cycle action — owned
   *  by the screen (it owns the voice pipeline); JARVIS renders the pill. */
  voiceRate?: number;
  onCycleVoiceRate?: () => void;
  /** EXPLODED VIEW bridge — when the 3D model viewer is open ON TOP of
   *  this camera layer, two-hand pull-apart drives the model's explode
   *  instead of resizing a (now-hidden) holo-tab, and fist→open closes
   *  the viewer. All holo-window gestures are suppressed while it's open.
   *  Owned by the screen; JARVIS just forwards the gesture stream. */
  modelViewerOpen?: boolean;
  onModelExplodeStart?: () => void;
  onModelExplode?: (ratio: number) => void;
  onModelClose?: () => void;
  /** Shared sink for hand cursors (screen-space px) so the viewer can
   *  draw them over the 3D scene — the camera canvas sits behind it. */
  modelCursorsRef?: { current: ViewerHandCursor[] };
  /** "+ ASK TONY" tab — sends the typed question through the screen's
   *  normal send pipeline (Tony's answer lands back in the tab). */
  onAsk?: (text: string) => void;
  /** "+ 3D MODEL" tab — opens the live text-to-3D fabricator. */
  onGenerate3D?: (prompt: string) => void;
}

export function JarvisMode({
  presenting,
  presentingImage,
  onExit,
  micMuted = false,
  onToggleMic,
  voiceRate = 1,
  onCycleVoiceRate,
  modelViewerOpen = false,
  onModelExplodeStart,
  onModelExplode,
  onModelClose,
  modelCursorsRef,
  onAsk,
  onGenerate3D,
}: JarvisModeProps) {
  const { videoRef, landmarksRef, status, retry, cameraCount, cameraIndex, cameraLabel, cycleCamera } =
    useHandTracking(true);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);
  // Telemetry strip — written via textContent from the rAF (real hand
  // count, no per-frame React state).
  const telemetryRef = useRef<HTMLDivElement | null>(null);
  // LAB mode: stream live pose numbers into the telemetry strip.
  const [lab, setLab] = useState(false);
  const labRef = useRef(false);
  labRef.current = lab;

  const [windows, setWindows] = useState<HoloWindow[]>([]);
  /** Gesture cheat-sheet hidden by default (founder: "hide the moves
   *  of the hand — the user should automatically know it"); the INFO
   *  pill toggles it for whoever needs the reminder. */
  const [showGuide, setShowGuide] = useState(false);
  /** SAVE DOCK (founder's Tab 1/Tab 2 mockup): drag a tab off the
   *  RIGHT edge and it tucks into this stack instead of dying; tap a
   *  card to bring it back. LEFT edge stays the delete. */
  const [docked, setDocked] = useState<Array<{ id: number; payload: HoloPayload; title: string }>>([]);
  const [focusMode, setFocusMode] = useState(false);
  const focusModeRef = useRef(false);
  focusModeRef.current = focusMode;
  // PAGE VIEW — founder: "after hitting your tab you could open it".
  // Tap a tab → it zooms into a big centered page (full content, big
  // editable area for notes). Fist→open ("crush and release") closes it.
  const [pageId, setPageId] = useState<number | null>(null);
  const pageIdRef = useRef<number | null>(null);
  pageIdRef.current = pageId;
  // "+" MENU — a hand-tap on empty space drops a plus sign there;
  // tapping the plus reveals add-options (map / 3D / ask / PDF / note).
  // Founder: "when you do a click it's gonna give you a plus sign".
  const [plusMenu, setPlusMenu] = useState<{ x: number; y: number; open: boolean } | null>(null);
  // PDF upload — the "+" menu clicks this hidden input; the picked file
  // becomes a draggable holo-tab at the spot the menu was opened.
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pdfSpawnAtRef = useRef<{ x: number; y: number } | null>(null);

  // Live transform mirror — mutated at 60fps during gestures, committed to
  // React state on gesture end. Map<windowId, {x,y,scale,z}>.
  const liveRef = useRef(new Map<number, { x: number; y: number; scale: number; z: number }>());
  const elsRef = useRef(new Map<number, HTMLDivElement>());
  const idRef = useRef(1);
  const zRef = useRef(10);
  const spawnRef = useRef(0);
  const seenSigsRef = useRef(new Set<string>());
  // Per-hand grab state: which window + cursor offset from its center,
  // plus a velocity EMA (workspace px/s) so a fast release can flick.
  const grabsRef = useRef(
    new Map<
      string,
      // w/lh: angular velocity EMA (rad/s) + last heading of the hand
      // path — a curling wrist at release puts CURVE on the throw.
      { id: number; offX: number; offY: number; vx: number; vy: number; lx: number; ly: number; lt: number; w: number; lh: number | null }
    >(),
  );
  // Windows currently gliding from a flick — stepped every rAF tick.
  // curve: residual spin from the wrist arc, rotates the velocity
  // vector each tick so thrown tabs bend like a curveball.
  const glidesRef = useRef(new Map<number, { vx: number; vy: number; lt: number; curve: number }>());
  // Two-hand resize target + its scale when the gesture started.
  const scalingRef = useRef<{ id: number; baseScale: number } | null>(null);
  // Pinch sparks (decorative): spawn on pinch-start, fade ~360ms.
  const sparksRef = useRef<Array<{ x: number; y: number; t0: number; hue: "cyan" | "gold" }>>([]);
  // Emitter-disc bursts (H.U.D. reference): every new tab "rises" off a
  // radial projector disc that flashes open under it. Pushed by
  // spawnWindow, drawn/pruned by the rAF canvas pass.
  const discFxRef = useRef<Array<{ x: number; y: number; t0: number }>>([]);
  // Mirror of the "+" menu for the rAF pass (it draws the steady palm
  // disc under the open menu without touching React state per frame).
  const plusMenuRef = useRef<{ x: number; y: number; open: boolean } | null>(null);
  plusMenuRef.current = plusMenu;

  // Model-viewer routing read inside the rAF via refs, so toggling the
  // viewer (or swapping its callbacks) never tears down + restarts the
  // GestureEngine (which would reset the per-hand warm-up window).
  const modelViewerOpenRef = useRef(modelViewerOpen);
  modelViewerOpenRef.current = modelViewerOpen;
  const modelHandlersRef = useRef({ onModelExplodeStart, onModelExplode, onModelClose });
  modelHandlersRef.current = { onModelExplodeStart, onModelExplode, onModelClose };
  const modelCursorsSinkRef = useRef(modelCursorsRef);
  modelCursorsSinkRef.current = modelCursorsRef;

  // ── WORKSPACE ZOOM (Vision-Pro style): both hands pinch in EMPTY space
  //    and pull apart/together to zoom the whole tab layer around the
  //    hands' midpoint. Transform lives on the windows container; window
  //    coords stay in "workspace space" and screen px convert via toWs.
  const wsRef = useRef({ tx: 0, ty: 0, z: 1 });
  const wsApply = useCallback(() => {
    const el = layerRef.current;
    if (!el) return;
    const w = wsRef.current;
    el.style.transformOrigin = "0 0";
    el.style.transform = `translate3d(${w.tx}px, ${w.ty}px, 0) scale(${w.z})`;
  }, []);
  const wsReset = useCallback(() => {
    wsRef.current = { tx: 0, ty: 0, z: 1 };
    wsApply();
  }, [wsApply]);
  /** Viewport px → workspace coords (what window x/y are stored in). */
  const toWs = useCallback((x: number, y: number) => {
    const w = wsRef.current;
    return { x: (x - w.tx) / w.z, y: (y - w.ty) / w.z };
  }, []);
  const wsZoomRef = useRef<{ baseZ: number; baseTx: number; baseTy: number; midX: number; midY: number } | null>(null);

  const applyTransform = useCallback((id: number) => {
    const el = elsRef.current.get(id);
    const tr = liveRef.current.get(id);
    if (!el || !tr) return;
    el.style.transform = `translate3d(${tr.x}px, ${tr.y}px, 0) translate(-50%, -50%) scale(${tr.scale})`;
    el.style.zIndex = String(tr.z);
  }, []);

  const spawnWindow = useCallback(
    (payload: HoloPayload, at?: { x: number; y: number }, scale0 = 1) => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const slot = SPAWN_SLOTS[spawnRef.current % SPAWN_SLOTS.length];
      spawnRef.current += 1;
      const id = idRef.current++;
      zRef.current += 1;
      // `at` arrives in viewport px — convert to workspace coords so the
      // tab lands under the hand even when the workspace is zoomed.
      const p = toWs(at ? at.x : slot[0] * vw, at ? at.y : slot[1] * vh);
      // Emitter-disc flash at the birth point — the tab "rises" off a
      // projector disc (H.U.D. reference, photos 6/10).
      discFxRef.current.push({
        x: at ? at.x : slot[0] * vw,
        y: at ? at.y : slot[1] * vh,
        t0: performance.now(),
      });
      const s0 = Math.min(SCALE_MAX, Math.max(SCALE_MIN, scale0));
      const win: HoloWindow = {
        id,
        payload,
        x: p.x,
        y: p.y,
        scale: s0,
        z: zRef.current,
        expanded: false,
      };
      liveRef.current.set(id, { x: win.x, y: win.y, scale: s0, z: win.z });
      setWindows((ws) => {
        const next = [...ws, win];
        // Cap: drop the oldest non-welcome window beyond the limit.
        if (next.length > MAX_WINDOWS) {
          const dropIdx = next.findIndex((w) => w.payload.kind !== "welcome");
          if (dropIdx >= 0) {
            liveRef.current.delete(next[dropIdx].id);
            next.splice(dropIdx, 1);
          }
        }
        return next;
      });
    },
    [toWs],
  );

  const closeWindow = useCallback((id: number) => {
    liveRef.current.delete(id);
    elsRef.current.delete(id);
    glidesRef.current.delete(id);
    setWindows((ws) => ws.filter((w) => w.id !== id));
    // Closing the window that's open as the page also closes the page.
    setPageId((p) => (p === id ? null : p));
  }, []);

  const commitWindow = useCallback((id: number) => {
    const tr = liveRef.current.get(id);
    if (!tr) return;
    setWindows((ws) => ws.map((w) => (w.id === id ? { ...w, x: tr.x, y: tr.y, scale: tr.scale, z: tr.z } : w)));
  }, []);

  // Current windows, readable outside render (prompt router below).
  const windowsRef = useRef<HoloWindow[]>([]);
  windowsRef.current = windows;

  /** Prompt-tab submit router — MAP tabs take a place name, ASK tabs
   *  send to Tony (the tab becomes an empty note so his answer lands
   *  right back in it), 3D tabs hand the prompt to the fabricator. */
  const handlePrompt = useCallback(
    (id: number, text: string) => {
      const w = windowsRef.current.find((x) => x.id === id);
      if (!w) return;
      if (w.payload.kind === "map") {
        setWindows((ws) =>
          ws.map((x) => (x.id === id ? { ...x, payload: { kind: "map", query: text } } : x)),
        );
      } else if (w.payload.kind === "ask") {
        if (w.payload.mode === "tony") {
          onAsk?.(text);
          setWindows((ws) =>
            ws.map((x) => (x.id === id ? { ...x, payload: { kind: "note", text: "" } } : x)),
          );
        } else {
          onGenerate3D?.(text);
          closeWindow(id);
        }
      }
    },
    [onAsk, onGenerate3D, closeWindow],
  );

  const onPdfPicked = useCallback(
    (ev: React.ChangeEvent<HTMLInputElement>) => {
      const f = ev.target.files?.[0];
      ev.target.value = "";
      if (!f) return;
      const url = URL.createObjectURL(f);
      spawnWindow({ kind: "pdf", name: f.name, url }, pdfSpawnAtRef.current ?? undefined);
      pdfSpawnAtRef.current = null;
    },
    [spawnWindow],
  );

  // When the 3D model viewer opens on top, drop any in-flight holo-tab
  // grab/scale so a half-finished window gesture can't keep mutating a
  // hidden tab while the user is now driving the model.
  useEffect(() => {
    if (modelViewerOpen) {
      grabsRef.current.clear();
      scalingRef.current = null;
      setPlusMenu(null);
    }
  }, [modelViewerOpen]);

  // The page view is CSS-pinned in VIEWPORT terms — a zoomed workspace
  // underneath would drag it off-center, so opening a page snaps the
  // workspace back to 1:1 first.
  useEffect(() => {
    if (pageId != null) wsReset();
  }, [pageId, wsReset]);

  // ── Welcome card on first successful camera start ──
  const welcomedRef = useRef(false);
  useEffect(() => {
    if (status === "running" && !welcomedRef.current) {
      welcomedRef.current = true;
      // Top-left, clear of the user's face in frame (not centered).
      spawnWindow({ kind: "welcome" }, { x: window.innerWidth * 0.18, y: window.innerHeight * 0.32 });
    }
  }, [status, spawnWindow]);

  // ── Spawn holo-tabs from Tony's artifacts (deduped per content) ──
  useEffect(() => {
    const sigs = seenSigsRef.current;
    // Cascade: each new tab of one answer lands 160ms after the
    // previous — the spread ASSEMBLES around the user (each off its
    // own emitter disc) instead of popping in as one blob.
    let spawnSeq = 0;
    const spawnOnce = (sig: string, payload: HoloPayload) => {
      if (sigs.has(sig)) return;
      sigs.add(sig);
      const delay = spawnSeq++ * 160;
      if (delay === 0) spawnWindow(payload);
      else setTimeout(() => spawnWindow(payload), delay);
    };
    if (presenting.stat) {
      const s = presenting.stat;
      spawnOnce(`stat:${s.label}|${s.big}`, { kind: "stat", label: s.label, big: s.big, sub: s.sub });
    }
    if (presenting.data) {
      const d = presenting.data;
      spawnOnce(`data:${d.title}|${d.rows.length}`, { kind: "data", title: d.title, rows: d.rows });
    }
    if (presenting.quote) {
      const q = presenting.quote;
      spawnOnce(`quote:${q.text.slice(0, 60)}`, { kind: "quote", text: q.text, attribution: q.attribution });
    }
    if (presenting.compare) {
      const c = presenting.compare;
      spawnOnce(`compare:${c.title}|${c.rows.length}`, {
        kind: "compare",
        title: c.title,
        labelA: c.labelA,
        labelB: c.labelB,
        rows: c.rows,
      });
    }
    if (presenting.show) {
      const q = presenting.show.query;
      spawnOnce(`show:${q}`, {
        kind: "show",
        query: q,
        snippet: presenting.cleanText.trim().slice(0, 220),
      });
    }
    if (presenting.map) {
      // GEO scene (founder: "if anybody asks about any country, any
      // type" — generalized, never hardcoded): Tony's MAP block lands
      // as a live satellite tab with the pulsing location ring.
      const q = presenting.map.query;
      spawnOnce(`map:${q}`, { kind: "map", query: q });
    }

    // Tony's prose ALWAYS lands now (founder: "tab for the description"
    // — before, any artifact in the turn silently dropped the words and
    // the spread felt like "one boring table"). It fills the newest
    // EMPTY note if one is open (the "create a tab, then talk" flow),
    // otherwise it becomes the DESCRIPTION panel of the spread.
    const answer = presenting.cleanText.trim();
    // "(...)" lines are STATUS messages (mic diagnostics, transcription
    // errors) — they belong in the chat log, never as workspace tabs.
    // The founder's screenshot had a mic-diagnosis floating as a tab.
    if (answer.length > 0 && !answer.startsWith("(")) {
      const sig = `answer:${answer.slice(0, 60)}`;
      if (!sigs.has(sig)) {
        sigs.add(sig);
        let targetId = -1;
        let bestZ = -1;
        for (const w of windowsRef.current) {
          if (w.payload.kind === "note" && w.payload.text.trim() === "" && w.z > bestZ) {
            bestZ = w.z;
            targetId = w.id;
          }
        }
        if (targetId !== -1) {
          const tid = targetId;
          setWindows((ws) =>
            ws.map((w) =>
              w.id === tid && w.payload.kind === "note"
                ? { ...w, payload: { kind: "note", text: answer } }
                : w,
            ),
          );
        } else {
          const delay = spawnSeq++ * 160;
          setTimeout(() => spawnWindow({ kind: "note", text: answer }), delay);
        }
      }
    }
  }, [presenting, spawnWindow]);

  // ── Gesture + draw loop (single rAF; reads landmarksRef) ──
  useEffect(() => {
    if (status !== "running") return;
    // Production warm-up: suppress gestures for the first moments after a
    // hand is acquired — fixes phantom new-tabs/page-opens at camera start.
    const engine = new GestureEngine({ warmupMs: HAND_WARMUP_MS });
    let raf = 0;
    let lastT = -1;

    /** Video→viewport mapping under object-fit: cover (the video
     *  overflows the short axis). Constant for a whole frame, so it's
     *  computed once into this scratch object — the 60Hz paths below
     *  read it without allocating. */
    const view = { dispW: 0, dispH: 0, offX: 0, offY: 0 };
    const updateView = () => {
      const video = videoRef.current;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const srcW = video?.videoWidth || 640;
      const srcH = video?.videoHeight || 480;
      const scale = Math.max(vw / srcW, vh / srcH);
      view.dispW = srcW * scale;
      view.dispH = srcH * scale;
      view.offX = (vw - view.dispW) / 2;
      view.offY = (vh - view.dispH) / 2;
    };

    /** Map normalized mirrored video coords → viewport px. Allocates a
     *  point, so it's reserved for discrete gesture events; the
     *  per-frame draw/sink paths inline the math against `view`. */
    const toScreen = (nx: number, ny: number): { x: number; y: number } => {
      updateView();
      return { x: view.offX + nx * view.dispW, y: view.offY + ny * view.dispH };
    };

    const topWindowAt = (px: number, py: number): number | null => {
      // 28px forgiveness margin — the founder's video showed both
      // pinches narrowly MISSING a small tab, which then read as
      // "hands together in empty space" and created a new tab instead
      // of resizing. Hand tracking is ±a-few-px jittery; near the tab
      // should mean ON the tab.
      const PAD = 28;
      let best: { id: number; z: number } | null = null;
      for (const [id, el] of elsRef.current) {
        const r = el.getBoundingClientRect();
        if (px >= r.left - PAD && px <= r.right + PAD && py >= r.top - PAD && py <= r.bottom + PAD) {
          const z = liveRef.current.get(id)?.z ?? 0;
          if (!best || z > best.z) best = { id, z };
        }
      }
      return best?.id ?? null;
    };

    const handleEvent = (e: GestureEvent) => {
      // EXPLODED VIEW takes over the gesture stream while the 3D model
      // viewer is open on top of the camera. Two-hand pull drives the
      // model's explode; fist→open closes it. Every holo-window gesture
      // is suppressed — the tabs are hidden behind the viewer (z 50), so
      // grabbing/scaling them would be invisible and confusing.
      if (modelViewerOpenRef.current) {
        switch (e.type) {
          case "two-hand-scale-start":
            modelHandlersRef.current.onModelExplodeStart?.();
            return;
          case "two-hand-scale":
            modelHandlersRef.current.onModelExplode?.(e.ratio);
            return;
          case "fist-open":
            modelHandlersRef.current.onModelClose?.();
            return;
          default:
            return;
        }
      }
      switch (e.type) {
        case "pinch-start": {
          const { x, y } = toScreen(e.x, e.y);
          sparksRef.current.push({ x, y, t0: performance.now(), hue: "cyan" });
          if (focusModeRef.current) return; // windows are away — nothing to grab
          const hit = topWindowAt(x, y);
          if (hit != null) {
            // MAP DIVE intercept: pinch landing on the MAP IMAGE of an
            // EXPANDED map tab takes the camera (orbit ⇄ ground) instead
            // of grabbing — the tab's header strip still grabs as usual.
            const winEl = elsRef.current.get(hit);
            if (winEl?.classList.contains("is-expanded")) {
              const at = document.elementFromPoint(x, y);
              if (at instanceof Element && at.closest(".jarvis-map")) {
                winEl.classList.add("is-scrubbed");
                mapScrub = { hand: e.hand, id: hit, y0: e.y, k0: mapK };
                blip(640, 60, 0.045);
                break;
              }
            }
            const tr = liveRef.current.get(hit);
            if (tr) {
              zRef.current += 1;
              tr.z = zRef.current;
              const wp = toWs(x, y);
              grabsRef.current.set(e.hand, {
                id: hit,
                offX: tr.x - wp.x,
                offY: tr.y - wp.y,
                vx: 0,
                vy: 0,
                lx: wp.x,
                ly: wp.y,
                lt: performance.now(),
                w: 0,
                lh: null,
              });
              glidesRef.current.delete(hit); // catching a gliding tab stops it
              applyTransform(hit);
              const el = elsRef.current.get(hit);
              el?.classList.add("is-grabbed");
              blip(520, 70, 0.055); // tock — you grabbed something
            }
          } else if (hit == null) {
            blip(1250, 40, 0.03); // soft tick — pinch in air
          }
          break;
        }
        case "pinch-move": {
          // MAP DIVE in flight — vertical hand travel drives the
          // orbit⇄ground crossfade on the expanded map tab.
          if (mapScrub && mapScrub.hand === e.hand) {
            const el = elsRef.current.get(mapScrub.id);
            if (el) {
              mapK = Math.min(1, Math.max(0, mapScrub.k0 + (e.y - mapScrub.y0) * 2.6));
              el.style.setProperty("--mapk", mapK.toFixed(2));
            }
            return;
          }
          const grab = grabsRef.current.get(e.hand);
          if (grab) {
            const { x, y } = toScreen(e.x, e.y);
            const wp = toWs(x, y);
            const tr = liveRef.current.get(grab.id);
            if (!tr) return;
            tr.x = wp.x + grab.offX;
            tr.y = wp.y + grab.offY;
            // Velocity EMA (ws px/s) — read at release to decide a flick.
            const nowMs = performance.now();
            const gdt = (nowMs - grab.lt) / 1000;
            if (gdt > 0.001) {
              grab.vx += 0.4 * ((wp.x - grab.lx) / gdt - grab.vx);
              grab.vy += 0.4 * ((wp.y - grab.ly) / gdt - grab.vy);
              // Angular velocity EMA (rad/s) of the hand path's heading
              // — a curling wrist at release puts CURVE on the throw.
              // Only sampled while moving with intent; tiny jittery
              // steps produce garbage headings.
              const sp = Math.hypot(grab.vx, grab.vy);
              if (sp > 140) {
                const h = Math.atan2(wp.y - grab.ly, wp.x - grab.lx);
                if (grab.lh !== null) {
                  let dh = h - grab.lh;
                  if (dh > Math.PI) dh -= Math.PI * 2;
                  else if (dh < -Math.PI) dh += Math.PI * 2;
                  grab.w += 0.35 * (dh / gdt - grab.w);
                }
                grab.lh = h;
              }
              grab.lx = wp.x;
              grab.ly = wp.y;
              grab.lt = nowMs;
            }
            applyTransform(grab.id);
            return;
          }
          break;
        }
        case "pinch-end": {
          // MAP DIVE release. A quick tap falls through (page buttons
          // like ✕ must still click); a real pull consumes the event.
          if (mapScrub && mapScrub.hand === e.hand) {
            mapScrub = null;
            if (!isTap(e)) {
              blip(900, 70, 0.04);
              break;
            }
          }
          const grab = grabsRef.current.get(e.hand);
          grabsRef.current.delete(e.hand);
          const { x, y } = toScreen(e.x, e.y);

          // HAND-TAP = CLICK. Any button under the tap point gets a real
          // DOM click — close ✕, the "+" menu, CAM/EXIT/mic, overlay
          // buttons — so NOTHING in this mode ever needs the mouse.
          // MAGNETIC: the founder's pinch kept landing ~20px off the
          // small "+" button and nothing fired. A fingertip is not a
          // mouse — probe outward from the tap point so a near-miss
          // still clicks the button it was aimed at (same forgiveness
          // as the 28px grab halo).
          if (isTap(e)) {
            let btn: Element | null = null;
            outer: for (const r of [0, 16, 32, 46]) {
              const probes: Array<[number, number]> =
                r === 0
                  ? [[0, 0]]
                  : [[r, 0], [-r, 0], [0, r], [0, -r], [r * 0.7, r * 0.7], [-r * 0.7, r * 0.7], [r * 0.7, -r * 0.7], [-r * 0.7, -r * 0.7]];
              for (const [dx, dy] of probes) {
                const at = document.elementFromPoint(x + dx, y + dy);
                const b = at instanceof Element ? at.closest("button") : null;
                if (b instanceof HTMLButtonElement && !b.disabled) {
                  btn = b;
                  break outer;
                }
              }
            }
            if (btn instanceof HTMLButtonElement && !btn.disabled) {
              if (grab) {
                elsRef.current.get(grab.id)?.classList.remove("is-grabbed");
                commitWindow(grab.id);
              }
              blip(1650, 55, 0.055); // click — a button fired
              try {
                // Synchronous dispatch into ANY button's onClick — a
                // buggy handler must not take the gesture loop with it.
                btn.click();
              } catch (err) {
                console.error("[jarvis] button handler threw:", err);
              }
              break;
            }
          }

          if (grab) {
            const el = elsRef.current.get(grab.id);
            el?.classList.remove("is-grabbed");
            // EDGE SEMANTICS (founder's mockup): drop a tab off the
            // LEFT edge — deleted; off the RIGHT edge — SAVED into the
            // side dock for later. Top/bottom are neutral. Throws
            // still glide and bounce (ball rules).
            const flickSpeed =
              performance.now() - grab.lt > FLICK_STALE_MS ? 0 : Math.hypot(grab.vx, grab.vy);
            const mX = window.innerWidth * 0.04;
            const atLeft = x < mX;
            const atRight = x > window.innerWidth - mX;
            // A release that was part of a two-hand RESIZE is never a
            // throw or an edge action — the hand naturally moves fast
            // and drifts wide while scaling.
            const justScaled =
              (scalingRef.current !== null && scalingRef.current.id === grab.id) ||
              performance.now() - lastScaleEndT < 400;
            if (!isTap(e) && !justScaled && atLeft) {
              sparksRef.current.push({ x, y, t0: performance.now(), hue: "gold" });
              blip(300, 110, 0.05); // low thunk — deleted
              closeWindow(grab.id);
            } else if (!isTap(e) && !justScaled && atRight) {
              // SAVE — "move it to the right, it just gets saved."
              const w = windowsRef.current.find((win) => win.id === grab.id);
              if (w) {
                setDocked((d) =>
                  [{ id: w.id, payload: w.payload, title: windowTitle(w.payload) }, ...d].slice(0, 8),
                );
                sparksRef.current.push({ x, y, t0: performance.now(), hue: "cyan" });
                blip(880, 70, 0.05);
                setTimeout(() => blip(1180, 90, 0.05), 70); // rising — tucked away
                closeWindow(grab.id);
              } else commitWindow(grab.id);
            } else if (!isTap(e) && !justScaled && flickSpeed > FLICK_MIN_SPEED) {
              // FLICK: released at speed — let it glide (stepped in the
              // rAF loop; commits to React when it stops).
              glidesRef.current.set(grab.id, {
                vx: grab.vx,
                vy: grab.vy,
                lt: performance.now(),
                // Wrist arc → spin. Clamped: a full-effort curl bends
                // the path hard but can't whip the tab into orbit.
                curve: Math.max(-5, Math.min(5, grab.w)),
              });
            } else commitWindow(grab.id);
            // A quick, still pinch on a tab = "click" → the tab GROWS IN
            // PLACE (and a second tap shrinks it back). Founder: "I don't
            // want something to take full screen" — the page takeover is
            // gone; an expanded tab stays draggable and deletable.
            if (isTap(e)) {
              blip(980, 60, 0.045);
              setWindows((ws) => ws.map((w) => (w.id === grab.id ? { ...w, expanded: !w.expanded } : w)));
            }
          } else if (isTap(e)) {
            if (pageIdRef.current != null) {
              // Tap anywhere OUTSIDE the open page closes it — the page
              // must never trap you behind a keyboard (founder: "it should
              // be only moving by hands").
              if (topWindowAt(x, y) !== pageIdRef.current) {
                sparksRef.current.push({ x, y, t0: performance.now(), hue: "cyan" });
                blip(700, 70, 0.05);
                setPageId(null);
              }
            } else if (!focusModeRef.current) {
              // Tap on EMPTY space → drop the "+" sign there (tap again
              // to dismiss).
              setPlusMenu((m) => (m ? null : { x, y, open: false }));
            }
          }
          break;
        }
        case "double-pinch": {
          // No longer creates anything. Founder: "creating a tab should
          // not be by any way except when I bring my hands together and
          // create a rectangle" — single-finger creates kept misfiring
          // into accidental tabs. Creation now lives ONLY in the
          // two-hand stretch and the explicit "+" menu.
          break;
        }
        case "two-hand-scale-start": {
          if (focusModeRef.current) return;
          // Resize target: a currently-grabbed window wins; otherwise the
          // topmost window under either cursor; otherwise nothing.
          const grabbed = [...grabsRef.current.values()][0]?.id ?? null;
          let target: number | null = grabbed;
          if (target == null) {
            for (const c of lastCursors) {
              const { x, y } = toScreen(c.x, c.y);
              const hit = topWindowAt(x, y);
              if (hit != null) {
                target = hit;
                break;
              }
            }
          }
          // The page view is pinned by CSS — scaling it would fight the
          // !important transform and look broken. Skip it.
          if (target === pageIdRef.current) target = null;
          if (target != null) {
            const tr = liveRef.current.get(target);
            if (tr) scalingRef.current = { id: target, baseScale: tr.scale };
          } else if (pageIdRef.current == null && lastCursors.length === 2) {
            if (e.distance < CREATE_START_MAX) {
              // Hands TOGETHER, both pinching → stretch a new tab into
              // existence (the AR-reel move). Pull apart to size the
              // ghost frame; release past the threshold to spawn it.
              creating = {
                ax: lastCursors[0].x,
                ay: lastCursors[0].y,
                bx: lastCursors[1].x,
                by: lastCursors[1].y,
                armed: false,
              };
              blip(520, 70, 0.04);
              break;
            }
            // Both pinches in EMPTY space, hands apart → zoom the whole
            // workspace around the hands' midpoint (Vision-Pro pinch-zoom).
            const a = toScreen(lastCursors[0].x, lastCursors[0].y);
            const b = toScreen(lastCursors[1].x, lastCursors[1].y);
            const w = wsRef.current;
            wsZoomRef.current = {
              baseZ: w.z,
              baseTx: w.tx,
              baseTy: w.ty,
              midX: (a.x + b.x) / 2,
              midY: (a.y + b.y) / 2,
            };
          }
          break;
        }
        case "two-hand-scale": {
          if (creating) {
            const ps = lastCursors.filter((c) => c.pinching);
            if (ps.length === 2) {
              creating.ax = ps[0].x;
              creating.ay = ps[0].y;
              creating.bx = ps[1].x;
              creating.by = ps[1].y;
              const d = Math.hypot(creating.ax - creating.bx, creating.ay - creating.by);
              if (!creating.armed && d >= CREATE_MIN_DIST) {
                creating.armed = true;
                blip(660, 80, 0.045);
              }
            }
            return;
          }
          const sc = scalingRef.current;
          if (sc) {
            const tr = liveRef.current.get(sc.id);
            if (!tr) return;
            const raw = sc.baseScale * e.ratio;
            // BLOW IT UP (movie move): keep spreading past the resize cap
            // and the tab pops into its EXPANDED form — in place, still a
            // draggable tab, never a full-screen takeover.
            if (raw > SCALE_MAX * 1.18) {
              const id = sc.id;
              scalingRef.current = null;
              tr.scale = sc.baseScale; // expanded layout carries the size; restore scale
              commitWindow(id);
              blip(740, 90, 0.05);
              setTimeout(() => blip(1480, 140, 0.05), 70);
              setWindows((ws) => ws.map((w) => (w.id === id ? { ...w, expanded: true } : w)));
              return;
            }
            tr.scale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, raw));
            applyTransform(sc.id);
            return;
          }
          const wz = wsZoomRef.current;
          if (wz) {
            const z = Math.min(2.2, Math.max(0.55, wz.baseZ * e.ratio));
            // Keep the hands' midpoint fixed on screen while scaling.
            const k = z / wz.baseZ;
            wsRef.current.z = z;
            wsRef.current.tx = wz.midX - (wz.midX - wz.baseTx) * k;
            wsRef.current.ty = wz.midY - (wz.midY - wz.baseTy) * k;
            wsApply();
          }
          break;
        }
        case "two-hand-scale-end": {
          lastScaleEndT = performance.now();
          if (creating) {
            if (creating.armed) {
              const { x, y } = toScreen(
                (creating.ax + creating.bx) / 2,
                (creating.ay + creating.by) / 2,
              );
              const now = performance.now();
              const pa = toScreen(creating.ax, creating.ay);
              const pb = toScreen(creating.bx, creating.by);
              sparksRef.current.push(
                { x: pa.x, y: pa.y, t0: now, hue: "gold" },
                { x: pb.x, y: pb.y, t0: now, hue: "gold" },
              );
              blip(740, 90, 0.05);
              setTimeout(() => blip(1480, 140, 0.05), 70);
              // Founder: "I can make it wider or smaller based on my
              // fingers" — the stretched frame's size IS the tab's size.
              const frameDiag = Math.hypot(pa.x - pb.x, pa.y - pb.y);
              spawnWindow({ kind: "note", text: "" }, { x, y }, frameDiag / 420);
            }
            creating = null;
            break;
          }
          if (scalingRef.current) commitWindow(scalingRef.current.id);
          scalingRef.current = null;
          wsZoomRef.current = null;
          break;
        }
        case "clap": {
          const { x, y } = toScreen(e.x, e.y);
          sparksRef.current.push({ x, y, t0: performance.now(), hue: "gold" });
          if (!focusModeRef.current) spawnWindow({ kind: "orb" }, { x, y });
          break;
        }
        case "swipe-left":
          // A wave with the page open SWIPES IT AWAY (movie dismiss) —
          // far easier than fist→open. Otherwise: focus Tony.
          if (pageIdRef.current != null) setPageId(null);
          else setFocusMode(true);
          break;
        case "swipe-right":
          if (pageIdRef.current != null) setPageId(null);
          else setFocusMode(false);
          break;
        case "fist-open":
          // Crush-and-release (fist → five fingers) closes the open page
          // view — founder: "when I do this thing the page should be
          // closed". With no page open it resets a zoomed workspace back
          // to 1:1 (the hand-only escape hatch). A natural fist with
          // nothing open still does nothing.
          if (pageIdRef.current != null) setPageId(null);
          else if (wsRef.current.z !== 1) wsReset();
          break;
        case "palm-menu": {
          // Flip your open palm to the camera and hold — the "+" menu
          // appears right on your hand. Palm again dismisses it.
          if (focusModeRef.current || pageIdRef.current != null) return;
          const { x, y } = toScreen(e.x, e.y);
          blip(980, 80, 0.05);
          setPlusMenu((m) => (m ? null : { x, y, open: true }));
          break;
        }
      }
    };

    let lastCursors: CursorState[] = [];

    /** Stretch-to-create in flight: hands-together double pinch, pulling
     *  apart. Tracks the two pinch points (normalized) for the ghost
     *  frame and the spawn point at release. */
    let creating: {
      ax: number;
      ay: number;
      bx: number;
      by: number;
      armed: boolean;
    } | null = null;

    /** MAP DIVE — pinch on an expanded map tab's image and the hand
     *  takes the camera: pull DOWN to dive from orbit to the ground,
     *  push UP to rise back to space. k: 0 = orbit, 1 = landed. */
    let mapScrub: { hand: string; id: number; y0: number; k0: number } | null = null;
    let mapK = 1;

    /** Stamped whenever a two-hand scale/zoom/create ends. A pinch
     *  released during or right after resizing must NEVER read as a
     *  throw/edge-delete — founder: "while I'm only making it bigger
     *  or smaller, it might get deleted". */
    let lastScaleEndT = 0;

    // ── Proximity glow: the tab under each cursor lights up, brightness
    //    tracking pinch closeness (Ultraleap-style approach feedback).
    //    Direct class/CSS-var writes, every other fresh frame — no React.
    const hovered = new Map<string, number>(); // hand → hovered window id
    let hoverTick = 0;
    const unhover = (id: number, exceptHand?: string) => {
      for (const [h, wid] of hovered) if (h !== exceptHand && wid === id) return; // other hand still on it
      const el = elsRef.current.get(id);
      if (el) {
        el.classList.remove("is-hover");
        el.style.removeProperty("--jpinch");
      }
    };
    const updateHover = (cursors: CursorState[]) => {
      hoverTick++;
      if (hoverTick % 2 || modelViewerOpenRef.current || focusModeRef.current) return;
      updateView();
      for (const c of cursors) {
        const px = view.offX + c.x * view.dispW;
        const py = view.offY + c.y * view.dispH;
        const grab = grabsRef.current.get(c.hand);
        const id = grab ? grab.id : topWindowAt(px, py);
        const prev = hovered.get(c.hand);
        if (prev != null && prev !== id) unhover(prev, c.hand);
        if (id != null && id !== pageIdRef.current) {
          hovered.set(c.hand, id);
          const el = elsRef.current.get(id);
          if (el) {
            el.classList.add("is-hover");
            el.style.setProperty("--jpinch", (c.pinching ? 1 : c.pinchStrength).toFixed(2));
          }
        } else {
          hovered.delete(c.hand);
        }
      }
      // Hands that left the frame release their glow.
      for (const [h, wid] of hovered) {
        if (!cursors.some((c) => c.hand === h)) {
          hovered.delete(h);
          unhover(wid);
        }
      }
    };

    // Scratch buffers reused every frame. The skeleton/cursor passes
    // were the app's biggest steady-state GC allocator (~44 short-lived
    // objects × 60fps with two hands) — real heat on a fanless machine.
    const skelPts = [0, 1].map(() => Array.from({ length: 21 }, () => ({ x: 0, y: 0 })));
    const sinkBuf: ViewerHandCursor[] = [];
    const sinkPts: ViewerHandCursor[] = [
      { x: 0, y: 0, pinching: false },
      { x: 0, y: 0, pinching: false },
    ];

    // ── Movie-pack FX (founder's H.U.D. reference) ──────────────────
    // Every glow is pre-rendered ONCE into a sprite canvas here; the
    // per-frame cost is plain drawImage blits. No gradients, no blurs,
    // no DOM writes inside the rAF — the weak-MacBook rules hold.
    const makeSprite = (
      size: number,
      paint: (c: CanvasRenderingContext2D, s: number) => void,
    ): HTMLCanvasElement => {
      const c = document.createElement("canvas");
      c.width = c.height = size;
      const x = c.getContext("2d");
      if (x) paint(x, size);
      return c;
    };
    // Soft glow dot — light at every fingertip while a hand is on screen.
    const tipSprite = makeSprite(32, (c, s) => {
      const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, "rgba(215, 250, 255, 0.95)");
      g.addColorStop(0.3, "rgba(64, 224, 255, 0.55)");
      g.addColorStop(1, "rgba(64, 224, 255, 0)");
      c.fillStyle = g;
      c.fillRect(0, 0, s, s);
    });
    // Two-lobed molecule mote — the ambient "fireflies" drifting in depth.
    const moteSprite = makeSprite(24, (c, s) => {
      const lobe = (x: number, y: number, r: number, a: number) => {
        const g = c.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(190, 246, 255, ${a})`);
        g.addColorStop(1, "rgba(64, 224, 255, 0)");
        c.fillStyle = g;
        c.beginPath();
        c.arc(x, y, r, 0, Math.PI * 2);
        c.fill();
      };
      lobe(s * 0.38, s * 0.55, s * 0.3, 0.9);
      lobe(s * 0.62, s * 0.42, s * 0.26, 0.8);
    });
    // Palm emitter disc — radial ticks + two rings; the "projector"
    // holograms rise from. Drawn rotated for a slow idle spin.
    const discSprite = makeSprite(240, (c, s) => {
      const cx = s / 2;
      c.translate(cx, cx);
      c.strokeStyle = "rgba(64, 224, 255, 0.5)";
      c.lineWidth = 1;
      for (let i = 0; i < 60; i++) {
        const a = (i / 60) * Math.PI * 2;
        const r0 = s * (i % 5 === 0 ? 0.3 : 0.36);
        const r1 = s * (i % 5 === 0 ? 0.48 : 0.44);
        c.beginPath();
        c.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
        c.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
        c.stroke();
      }
      c.lineWidth = 1.5;
      for (const [r, a] of [
        [0.26, 0.7],
        [0.49, 0.45],
      ] as const) {
        c.strokeStyle = `rgba(64, 224, 255, ${a})`;
        c.beginPath();
        c.arc(0, 0, s * r, 0, Math.PI * 2);
        c.stroke();
      }
    });
    const blitDisc = (
      g: CanvasRenderingContext2D,
      x: number,
      y: number,
      size: number,
      alpha: number,
      angle: number,
    ) => {
      g.save();
      g.translate(x, y);
      g.rotate(angle);
      g.globalAlpha = alpha;
      g.drawImage(discSprite, -size / 2, -size / 2, size, size);
      g.restore();
    };
    // Ambient motes: position/velocity in normalized viewport space so a
    // resize never strands them. 26 blits/frame — cheap.
    const motes = Array.from({ length: 26 }, () => ({
      x: Math.random(),
      y: Math.random(),
      z: 0.3 + Math.random() * 0.7,
      vx: (Math.random() - 0.5) * 0.000045,
      vy: (Math.random() - 0.5) * 0.00003,
      ph: Math.random() * Math.PI * 2,
    }));
    let lastFxT = performance.now();
    const TIPS = [4, 8, 12, 16, 20] as const;

    const draw = (cursors: CursorState[]) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      // DPR capped at 1.5 (not 2): a full-screen Retina canvas redrawn
      // every frame is ~78% more pixels than 1.5x for a difference the
      // eye can't see in 1-2px glow lines over live video.
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      if (canvas.width !== vw * dpr || canvas.height !== vh * dpr) {
        canvas.width = vw * dpr;
        canvas.height = vh * dpr;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, vw, vh);
      const now = performance.now();

      // Ambient molecule motes — drift, wrap, twinkle, behind everything.
      const dtFx = Math.min(50, now - lastFxT);
      lastFxT = now;
      for (const m of motes) {
        m.x += m.vx * dtFx;
        m.y += m.vy * dtFx;
        if (m.x < -0.05) m.x += 1.1;
        else if (m.x > 1.05) m.x -= 1.1;
        if (m.y < -0.05) m.y += 1.1;
        else if (m.y > 1.05) m.y -= 1.1;
        const tw = 0.55 + 0.45 * Math.sin(now * 0.0012 + m.ph);
        ctx.globalAlpha = 0.05 + 0.17 * m.z * tw;
        const sz = 7 + 13 * m.z;
        ctx.drawImage(moteSprite, m.x * vw - sz / 2, m.y * vh - sz / 2, sz, sz);
      }
      ctx.globalAlpha = 1;

      // Palm emitter disc — the "+" menu floats on a slow-spinning
      // projector; every freshly spawned tab flashes one open beneath it.
      const pm = plusMenuRef.current;
      if (pm) blitDisc(ctx, pm.x, pm.y, 150, 0.75, now * 0.00045);
      const discs = discFxRef.current;
      let dkeep = 0;
      for (const d of discs) if (now - d.t0 < 700) discs[dkeep++] = d;
      discs.length = dkeep;
      for (const d of discs) {
        const k = (now - d.t0) / 700;
        blitDisc(ctx, d.x, d.y, 60 + 160 * k, (1 - k) * 0.9, now * 0.0009);
      }

      // Hand skeletons — thin cyan bones + landmark dots. Landmark
      // coords are written in place into skelPts (no per-frame objects).
      updateView();
      const frame = landmarksRef.current;
      for (let h = 0; h < frame.hands.length && h < skelPts.length; h++) {
        const hand = frame.hands[h];
        const pts = skelPts[h];
        const n = Math.min(hand.landmarks.length, pts.length);
        for (let i = 0; i < n; i++) {
          const p = hand.landmarks[i];
          pts[i].x = view.offX + p.x * view.dispW;
          pts[i].y = view.offY + p.y * view.dispH;
        }
        ctx.strokeStyle = "rgba(64, 224, 255, 0.55)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (const [a, b] of BONES) {
          ctx.moveTo(pts[a].x, pts[a].y);
          ctx.lineTo(pts[b].x, pts[b].y);
        }
        ctx.stroke();
        ctx.fillStyle = "rgba(170, 244, 255, 0.9)";
        for (let i = 0; i < n; i++) {
          ctx.beginPath();
          ctx.arc(pts[i].x, pts[i].y, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
        // Fingertip glow nodes — light at all five fingertips, the
        // "power coming out of the hands" read from the reference.
        for (const t of TIPS) {
          if (t < n) ctx.drawImage(tipSprite, pts[t].x - 9, pts[t].y - 9, 18, 18);
        }
      }

      // Leader lines — a thin thread from each pinching hand to the tab
      // it holds, so the grip reads as physical contact.
      if (grabsRef.current.size) {
        ctx.strokeStyle = "rgba(64, 224, 255, 0.35)";
        ctx.lineWidth = 1;
        for (const [hand, grab] of grabsRef.current) {
          const el = elsRef.current.get(grab.id);
          if (!el) continue;
          let hc: CursorState | null = null;
          for (const c of cursors) if (c.hand === hand) { hc = c; break; }
          if (!hc) continue;
          const r = el.getBoundingClientRect();
          ctx.beginPath();
          ctx.moveTo(view.offX + hc.x * view.dispW, view.offY + hc.y * view.dispH);
          ctx.lineTo(r.left + r.width / 2, r.top + r.height / 2);
          ctx.stroke();
        }
      }

      // Cursors — ring at the grab point; pink when pinching.
      for (const c of cursors) {
        const x = view.offX + c.x * view.dispW;
        const y = view.offY + c.y * view.dispH;
        ctx.strokeStyle = c.pinching ? "rgba(255, 96, 168, 0.95)" : "rgba(64, 224, 255, 0.95)";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(x, y, c.pinching ? 9 : 13, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Pinch/clap sparks — expanding fading rings, pruned in place
      // after 360ms (filter() would allocate an array every frame).
      const sparks = sparksRef.current;
      let keep = 0;
      for (const s of sparks) if (now - s.t0 < 360) sparks[keep++] = s;
      sparks.length = keep;
      for (const s of sparks) {
        const k = (now - s.t0) / 360;
        ctx.strokeStyle =
          s.hue === "gold" ? `rgba(255, 208, 96, ${1 - k})` : `rgba(64, 224, 255, ${1 - k})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 10 + k * 42, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Stretch-to-create ghost frame — a dashed holo-rectangle pinned to
      // the two pinch points. Cyan while forming, gold once armed
      // (spread far enough that release will spawn the tab).
      if (creating) {
        const x1 = view.offX + Math.min(creating.ax, creating.bx) * view.dispW;
        const x2 = view.offX + Math.max(creating.ax, creating.bx) * view.dispW;
        const y1 = view.offY + Math.min(creating.ay, creating.by) * view.dispH;
        const y2 = view.offY + Math.max(creating.ay, creating.by) * view.dispH;
        const armed = creating.armed;
        // Stretch progress 0..1 — how close the spread is to arming.
        const spread = Math.hypot(creating.ax - creating.bx, creating.ay - creating.by);
        const prog = Math.min(1, spread / CREATE_MIN_DIST);
        const hue = armed ? "rgba(255, 208, 96, 0.9)" : "rgba(64, 224, 255, 0.7)";
        // DATA VAULT panel outline — dashed, with the top-right corner
        // clipped at 45° (the reference's hexagonal cut).
        const cut = Math.min(16, (x2 - x1) / 4, (y2 - y1) / 4);
        ctx.strokeStyle = hue;
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 6]);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2 - cut, y1);
        ctx.lineTo(x2, y1 + cut);
        ctx.lineTo(x2, y2);
        ctx.lineTo(x1, y2);
        ctx.closePath();
        ctx.stroke();
        ctx.setLineDash([]);
        // Header tag above the frame.
        ctx.fillStyle = hue;
        ctx.font = "10px 'Geist Mono', ui-monospace, monospace";
        ctx.fillText(armed ? "DATA VAULT · RELEASE TO CREATE" : "DATA VAULT · STRETCH", x1, y1 - 8);
        // Loading bar along the bottom edge — fills with the stretch.
        const by = y2 - 8;
        ctx.strokeStyle = "rgba(64, 224, 255, 0.25)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x1 + 6, by);
        ctx.lineTo(x2 - 6, by);
        ctx.stroke();
        ctx.strokeStyle = hue;
        ctx.beginPath();
        ctx.moveTo(x1 + 6, by);
        ctx.lineTo(x1 + 6 + (x2 - x1 - 12) * prog, by);
        ctx.stroke();
        // Corner brackets (top-right skipped — the cut carries it).
        const L = Math.min(18, (x2 - x1) / 3, (y2 - y1) / 3);
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (const [cx2, cy2, dx, dy] of [
          [x1, y1, 1, 1],
          [x1, y2, 1, -1],
          [x2, y2, -1, -1],
        ] as const) {
          ctx.moveTo(cx2 + dx * L, cy2);
          ctx.lineTo(cx2, cy2);
          ctx.lineTo(cx2, cy2 + dy * L);
        }
        ctx.stroke();
        // Center "+" — armed gold means release will create.
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(mx - 10, my);
        ctx.lineTo(mx + 10, my);
        ctx.moveTo(mx, my - 10);
        ctx.lineTo(mx, my + 10);
        ctx.stroke();
      }

    };

    let lastFreshAt = performance.now();
    let lastHandsShown = -1;
    let labTick = 0;
    const step = () => {
      const now = performance.now();
      const frame = landmarksRef.current;
      if (frame.t !== lastT) {
        lastT = frame.t;
        lastFreshAt = now;
        // Telemetry strip: real tracked-hand count, DOM write only on change.
        const hands = frame.hands.length;
        if (hands !== lastHandsShown && telemetryRef.current) {
          lastHandsShown = hands;
          telemetryRef.current.textContent = `OPTICAL FEED · LIVE — HANDS ${hands} · ${__BUILD_SHA__}`;
        }
        const { events, cursors } = engine.update(frame);
        lastCursors = cursors;
        for (const e of events) handleEvent(e);
        updateHover(cursors);
        // LAB: live pose readout in the telemetry strip (~10Hz).
        if (labRef.current && telemetryRef.current) {
          labTick++;
          if (labTick % 3 === 0) {
            let txt = "LAB";
            for (const c of cursors) {
              txt += ` ¦ ${c.hand[0]}: ${c.pinching ? "PINCH" : c.pointing ? "POINT" : "—"} open ${c.open.toFixed(2)} ${c.facing ? "PALM" : "back"} pinch ${c.pinchStrength.toFixed(2)}`;
            }
            if (!cursors.length) txt += " ¦ no hands";
            telemetryRef.current.textContent = txt;
            lastHandsShown = -1; // repaint normal strip when LAB turns off
          }
        }
        // Mirror cursors (screen-space px) to the viewer overlay sink so
        // the 3D model viewer can draw the hands over its scene — the
        // camera's own cursor canvas sits behind the viewer (z 50). Only
        // while the viewer is open: nothing reads the sink otherwise, so
        // skip the coord mapping when it's closed. Written in place into
        // reusable cursors (the overlay re-reads the ref every frame and
        // never retains them, so mutation is safe).
        const sink = modelCursorsSinkRef.current;
        if (sink && modelViewerOpenRef.current) {
          updateView();
          const n = Math.min(cursors.length, sinkPts.length);
          sinkBuf.length = n;
          for (let i = 0; i < n; i++) {
            const c = cursors[i];
            const s = sinkPts[i];
            s.x = view.offX + c.x * view.dispW;
            s.y = view.offY + c.y * view.dispH;
            s.pinching = c.pinching;
            sinkBuf[i] = s;
          }
          sink.current = sinkBuf;
        }
      } else {
        // Frames stalled (tab hidden, camera track ended, tracking
        // wedged): clear the sink so the viewer's overlay doesn't keep
        // drawing frozen rings on the 3D scene indefinitely.
        const sink = modelCursorsSinkRef.current;
        if (sink && sink.current.length && now - lastFreshAt > 500) {
          sink.current = [];
        }
      }
      // FLICK MOMENTUM: glide released-at-speed tabs with friction. Runs
      // every rAF tick (even when camera frames stall) so a glide never
      // freezes mid-air.
      const glides = glidesRef.current;
      if (glides.size) {
        for (const [id, g] of glides) {
          const tr = liveRef.current.get(id);
          if (!tr || id === pageIdRef.current) {
            glides.delete(id);
            continue;
          }
          const gdt = Math.min(0.05, (now - g.lt) / 1000);
          g.lt = now;
          if (gdt <= 0) continue;
          // CURVE: rotate the velocity vector by the residual wrist
          // spin — the throw bends like a curveball. Spin decays so
          // the path straightens out as it slows.
          if (g.curve) {
            const a = g.curve * gdt;
            const ca = Math.cos(a);
            const sa = Math.sin(a);
            const nvx = g.vx * ca - g.vy * sa;
            g.vy = g.vx * sa + g.vy * ca;
            g.vx = nvx;
            g.curve *= Math.exp(-1.4 * gdt);
          }
          tr.x += g.vx * gdt;
          tr.y += g.vy * gdt;
          const tl = toWs(0, 0);
          const br = toWs(window.innerWidth, window.innerHeight);
          // BALL RULES + EDGE SEMANTICS: a FAST glide into the LEFT
          // wall is a throw-to-delete; into the RIGHT wall a throw-to-
          // save (same meaning as releasing the hand at that edge —
          // the founder threw a tab at the wall and rightly expected
          // the edge action, not a bounce). Slow impacts — and the
          // top/bottom walls always — bounce like a ball.
          const gSpeed = Math.hypot(g.vx, g.vy);
          if (g.vx < 0 && tr.x < tl.x && gSpeed > FLICK_TOSS_SPEED) {
            glides.delete(id);
            blip(300, 110, 0.05); // low thunk — deleted
            closeWindow(id);
            continue;
          }
          if (g.vx > 0 && tr.x > br.x && gSpeed > FLICK_TOSS_SPEED) {
            glides.delete(id);
            const w = windowsRef.current.find((win) => win.id === id);
            if (w) {
              setDocked((d) =>
                [{ id: w.id, payload: w.payload, title: windowTitle(w.payload) }, ...d].slice(0, 8),
              );
              blip(880, 70, 0.05);
              setTimeout(() => blip(1180, 90, 0.05), 70); // rising — tucked away
              closeWindow(id);
            } else commitWindow(id);
            continue;
          }
          if (g.vx < 0 && tr.x < tl.x) { tr.x = tl.x; g.vx *= -0.7; blip(240, 50, 0.04); }
          if (g.vx > 0 && tr.x > br.x) { tr.x = br.x; g.vx *= -0.7; blip(240, 50, 0.04); }
          if (g.vy < 0 && tr.y < tl.y) { tr.y = tl.y; g.vy *= -0.7; blip(240, 50, 0.04); }
          if (g.vy > 0 && tr.y > br.y) { tr.y = br.y; g.vy *= -0.7; blip(240, 50, 0.04); }
          const friction = Math.exp(-FLICK_DECAY * gdt);
          g.vx *= friction;
          g.vy *= friction;
          applyTransform(id);
          if (Math.hypot(g.vx, g.vy) < FLICK_STOP_SPEED) {
            glides.delete(id);
            commitWindow(id);
          }
        }
      }
      draw(lastCursors);
    };
    // UNKILLABLE LOOP. The frame body runs gesture handlers, React
    // setters and (via the hand-tap bridge) arbitrary button onClicks —
    // any of them throwing once used to stop the next rAF from ever
    // being scheduled: video kept playing but skeleton/gestures froze
    // for the rest of the session. That was the founder's recurring
    // "it worked, then hands stopped working" — one swallowed
    // exception, mode dead. Now a bad frame is dropped, counted, made
    // visible in the telemetry strip, and the loop keeps running.
    let loopErrs = 0;
    const loop = () => {
      try {
        step();
      } catch (err) {
        loopErrs++;
        lastHandsShown = -1; // next clean frame rewrites the strip
        if (telemetryRef.current) {
          telemetryRef.current.textContent = `OPTICAL FEED · FRAME ERR ×${loopErrs} · ${__BUILD_SHA__}`;
        }
        console.error("[jarvis] frame error (recovered):", err);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [status, applyTransform, closeWindow, commitWindow, spawnWindow, landmarksRef, videoRef, toWs, wsApply, wsReset]);

  // ── Mouse/trackpad fallback so tabs are usable while hands are busy
  //    (or in demos where the camera angle is awkward) ──
  const pointerDrag = useRef<{ id: number; offX: number; offY: number } | null>(null);
  const onWindowPointerDown = useCallback(
    (id: number) => (ev: React.PointerEvent) => {
      const tr = liveRef.current.get(id);
      if (!tr) return;
      zRef.current += 1;
      tr.z = zRef.current;
      const wp = toWs(ev.clientX, ev.clientY);
      pointerDrag.current = { id, offX: tr.x - wp.x, offY: tr.y - wp.y };
      glidesRef.current.delete(id); // mouse-catch stops a gliding tab too
      applyTransform(id);
      (ev.target as HTMLElement).setPointerCapture?.(ev.pointerId);
    },
    [applyTransform, toWs],
  );
  useEffect(() => {
    const move = (ev: PointerEvent) => {
      const d = pointerDrag.current;
      if (!d) return;
      const tr = liveRef.current.get(d.id);
      if (!tr) return;
      const wp = toWs(ev.clientX, ev.clientY);
      tr.x = wp.x + d.offX;
      tr.y = wp.y + d.offY;
      applyTransform(d.id);
    };
    const up = () => {
      if (pointerDrag.current) commitWindow(pointerDrag.current.id);
      pointerDrag.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [applyTransform, commitWindow]);

  const gestureChips = useMemo(
    () => [
      ["PINCH", "grab a tab"],
      ["THROW + CURL WRIST", "curve + bounce"],
      ["DRAG / THROW LEFT", "delete tab"],
      ["DRAG / THROW RIGHT", "save tab"],
      ["TAP", "grow ⇄ shrink tab"],
      ["FIST→OPEN", "reset zoom"],
      ["TWO HANDS", "resize"],
      ["SPREAD WIDE", "grow tab"],
      ["TWO HANDS (AIR)", "zoom space"],
      ["PINCH TOGETHER + STRETCH", "create tab"],
      ["PINCH + PULL (MAP)", "orbit ⇄ ground"],
      ["TAP SPACE", "+ add menu"],
      ["PALM HOLD", "menu on hand"],
      ["CLAP", "new orb"],
      ["SWIPE ←", "focus Tony"],
      ["SWIPE →", "tabs back"],
    ],
    [],
  );

  return (
    <div className="jarvis-root" aria-label="JARVIS camera mode">
      {/* Layer 1 — the mirrored selfie feed ("the camera inside the camera") */}
      <video ref={videoRef} className="jarvis-video" muted playsInline aria-hidden />
      <div className="jarvis-dim" aria-hidden />

      {/* Layer 2 — floating holo-tabs */}
      <div ref={layerRef} className={`jarvis-windows${focusMode ? " is-focus" : ""}`}>
        {windows.map((w) => (
          <div
            key={w.id}
            ref={(el) => {
              if (el) {
                elsRef.current.set(w.id, el);
                if (!liveRef.current.has(w.id))
                  liveRef.current.set(w.id, { x: w.x, y: w.y, scale: w.scale, z: w.z });
                applyTransform(w.id);
              } else {
                elsRef.current.delete(w.id);
              }
            }}
            className={`jarvis-win jarvis-win-${w.payload.kind}${w.expanded ? " is-expanded" : ""}${
              w.payload.kind === "note" && w.payload.text.trim().length > 240 ? " is-reading" : ""
            }${pageId === w.id ? " is-page" : ""}`}
            onPointerDown={pageId === w.id ? undefined : onWindowPointerDown(w.id)}
          >
            <div className="jarvis-win-chrome">
              <span className="jarvis-win-dot" aria-hidden />
              <span className="jarvis-win-title">{windowTitle(w.payload)}</span>
              <button
                type="button"
                className="jarvis-win-close"
                aria-label="Close panel"
                onPointerDown={(ev) => ev.stopPropagation()}
                onClick={() => closeWindow(w.id)}
              >
                ×
              </button>
            </div>
            <div
              className="jarvis-win-body"
              onClick={
                // Notes/ask/empty-map are editable — clicking must NOT
                // hijack focus from their inputs. Other kinds: mouse-click
                // toggles the in-place expanded form, same as a gesture tap.
                w.payload.kind === "note" ||
                w.payload.kind === "ask" ||
                (w.payload.kind === "map" && !w.payload.query)
                  ? undefined
                  : () => {
                      setWindows((ws) => ws.map((x) => (x.id === w.id ? { ...x, expanded: !x.expanded } : x)));
                    }
              }
            >
              <HoloContent
                payload={w.payload}
                expanded={w.expanded}
                image={w.payload.kind === "show" ? presentingImage : null}
                onEditNote={(text) =>
                  setWindows((ws) =>
                    ws.map((x) => (x.id === w.id && x.payload.kind === "note" ? { ...x, payload: { kind: "note", text } } : x)),
                  )
                }
                onPrompt={(text) => handlePrompt(w.id, text)}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Layer 3 — hand skeleton + cursors + sparks */}
      <canvas ref={canvasRef} className="jarvis-cursor-canvas" aria-hidden />

      {/* "+" MENU — tap empty space to summon it, tap the plus for the
          add-options. Every button here is hand-tappable (tap-bridge). */}
      {plusMenu && (
        <div className="jarvis-plus" style={{ left: plusMenu.x, top: plusMenu.y }}>
          {!plusMenu.open ? (
            <button
              type="button"
              className="jarvis-plus-btn"
              aria-label="Add to the scene"
              onClick={() => setPlusMenu((m) => (m ? { ...m, open: true } : m))}
            >
              +
            </button>
          ) : (
            <div className="jarvis-plus-menu">
              {([
                ["MAP", () => spawnWindow({ kind: "map", query: "" }, plusMenu)],
                ["3D MODEL", () => spawnWindow({ kind: "ask", mode: "model3d" }, plusMenu)],
                ["ASK TONY", () => spawnWindow({ kind: "ask", mode: "tony" }, plusMenu)],
                [
                  "UPLOAD PDF",
                  () => {
                    pdfSpawnAtRef.current = { x: plusMenu.x, y: plusMenu.y };
                    fileInputRef.current?.click();
                  },
                ],
                ["NOTE", () => spawnWindow({ kind: "note", text: "" }, plusMenu)],
              ] as Array<[string, () => void]>).map(([label, act]) => (
                <button
                  key={label}
                  type="button"
                  className="jarvis-plus-item"
                  onClick={() => {
                    act();
                    setPlusMenu(null);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf"
        hidden
        onChange={onPdfPicked}
        aria-hidden
      />

      {/* Focus-mode hint (windows are parked off-screen left) */}
      {focusMode && windows.length > 0 && (
        <button type="button" className="jarvis-focus-hint" onClick={() => setFocusMode(false)}>
          ⟶ swipe right (or tap) to bring {windows.length} tab{windows.length === 1 ? "" : "s"} back
        </button>
      )}

      {/* Telemetry strip — real feed state + tracked-hand count */}
      {status === "running" && (
        <div ref={telemetryRef} className="jarvis-telemetry-strip" aria-hidden>
          OPTICAL FEED · LIVE — HANDS 0 · {__BUILD_SHA__}
        </div>
      )}

      {/* HUD — INFO pill (bottom-left) reveals the gesture guide on
          demand; hidden by default so the camera stays clean. */}
      {showGuide && (
        <div className="jarvis-gesture-guide" aria-hidden>
          {gestureChips.map(([k, v]) => (
            <span key={k} className="jarvis-chip">
              <b>{k}</b> {v}
            </span>
          ))}
        </div>
      )}
      <button
        type="button"
        className="jarvis-info-toggle"
        onClick={() => setShowGuide((g) => !g)}
        title="Gesture shortcuts"
      >
        {showGuide ? "✕ HIDE" : "ⓘ SHORTCUTS"}
      </button>

      {/* SAVE DOCK — tabs dropped off the right edge wait here; tap a
          card (hand or mouse) to bring it back to the workspace. */}
      {docked.length > 0 && (
        <div className="jarvis-dock">
          {docked.map((d) => (
            <button
              key={d.id}
              type="button"
              className="jarvis-dock-card"
              title="Tap to bring this tab back"
              onClick={() => {
                setDocked((ds) => ds.filter((c) => c.id !== d.id));
                spawnWindow(d.payload, {
                  x: window.innerWidth - 320,
                  y: window.innerHeight * 0.42,
                });
              }}
            >
              <span className="jarvis-dock-dot" aria-hidden />
              {d.title}
            </button>
          ))}
        </div>
      )}
      <div className="jarvis-privacy">Hands read on-device · camera never uploads</div>
      <button type="button" className="jarvis-exit" onClick={onExit}>
        EXIT JARVIS
      </button>
      {/* Camera picker — founder: "I should choose the camera that I
          want to use." Cycles through every video input; only shows
          when there's actually a choice. */}
      {status === "running" && cameraCount > 1 && (
        <button
          type="button"
          className="jarvis-cam-toggle"
          onClick={cycleCamera}
          title={`Switch camera — now: ${cameraLabel}`}
        >
          CAM {cameraIndex + 1}/{cameraCount}
        </button>
      )}
      {/* LAB — live gesture telemetry in the top strip, so thresholds can
          be tuned against REAL hands (poses can't be tested headless). */}
      {status === "running" && (
        <button
          type="button"
          className={`jarvis-lab-toggle${lab ? " is-on" : ""}`}
          onClick={() => setLab((v) => !v)}
          title="Gesture lab — live pose readouts for tuning"
        >
          LAB
        </button>
      )}
      {/* Camera-only toggle — "a mute if I only want to use the video
          without AI." Mic is physically released while muted. */}
      {onToggleMic && (
        <button
          type="button"
          className={`jarvis-mic-toggle${micMuted ? " is-muted" : ""}`}
          onClick={onToggleMic}
          title={micMuted
            ? "Camera-only mode — Tony isn't listening. Tap to unmute."
            : "Mute Tony — keep the camera and gestures, no AI listening."}
        >
          {micMuted ? "MUTED · CAMERA ONLY" : "MIC LIVE"}
        </button>
      )}
      {/* Voice speed — cycles 1× → 1.2× → 1.5× → 2× (founder: "make
          his voice go faster"). Applies live mid-sentence. */}
      {onCycleVoiceRate && (
        <button
          type="button"
          className="jarvis-rate-toggle"
          onClick={onCycleVoiceRate}
          title="Tony's voice speed — tap to cycle"
        >
          VOICE {(voiceRate ?? 1).toFixed(1).replace(/\.0$/, "")}×
        </button>
      )}

      {/* Status overlays */}
      {/* Loading is a compact, non-dimming pill — the founder saw the
          full-screen dim and thought "the video is not working" while
          the camera was actually live behind it. Let the feed show. */}
      {status === "loading" && (
        <div className="jarvis-overlay jarvis-overlay-loading">
          <div className="jarvis-overlay-card">
            <div className="jarvis-spinner" aria-hidden />
            <div className="jarvis-loading-copy">
              <h3>Camera live — summoning JARVIS…</h3>
              <p>Loading hand tracking (a few seconds on first run).</p>
            </div>
          </div>
        </div>
      )}
      {(status === "denied" || status === "error" || status === "unsupported") && (
        <div className="jarvis-overlay">
          <div className="jarvis-overlay-card">
            <h3>
              {status === "denied"
                ? "Camera permission needed"
                : status === "unsupported"
                  ? "This browser can't do JARVIS mode"
                  : "Camera couldn't start"}
            </h3>
            <p>
              {status === "denied"
                ? "JARVIS mode reads your hand gestures through the camera — entirely on this device, nothing is uploaded. Allow camera access to continue, or keep using classic voice mode."
                : status === "unsupported"
                  ? "Your browser doesn't expose the camera APIs JARVIS mode needs. Classic voice mode works perfectly without it."
                  : "Something interrupted the camera or the hand-tracking engine. You can retry, or keep using classic voice mode."}
            </p>
            <div className="jarvis-overlay-actions">
              {status !== "unsupported" && (
                <button type="button" className="jarvis-btn jarvis-btn-primary" onClick={retry}>
                  Try again
                </button>
              )}
              <button type="button" className="jarvis-btn" onClick={onExit}>
                Back to classic voice
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── content renderers ───────────────────────────────────────────────────────

function windowTitle(p: HoloPayload): string {
  switch (p.kind) {
    case "stat":
      return p.label || "STAT";
    case "data":
      return p.title || "DATA";
    case "quote":
      return "QUOTE";
    case "compare":
      return p.title || "COMPARE";
    case "show":
      return p.query || "BRIEFING";
    case "note": {
      // Once filled (typed or by Tony's answer), the first words become
      // the title so a wall of "NEW TAB"s never piles up.
      const t = p.text.replace(/\*\*/g, "").trim();
      return t ? `${t.slice(0, 26)}${t.length > 26 ? "…" : ""}` : "NEW TAB";
    }
    case "orb":
      return "ORB";
    case "welcome":
      return "JARVIS MODE";
    case "map":
      return p.query ? p.query.slice(0, 26).toUpperCase() : "MAP";
    case "pdf":
      return p.name.slice(0, 26);
    case "ask":
      return p.mode === "tony" ? "ASK TONY" : "FABRICATE 3D";
  }
}

/** One-line prompt input used by MAP / ASK TONY / FABRICATE 3D tabs.
 *  Borderless with the glowing bottom accent (same family as notes). */
function PromptInput({
  placeholder,
  onSubmit,
}: {
  placeholder: string;
  onSubmit: (text: string) => void;
}) {
  const [v, setV] = useState("");
  return (
    <form
      className="jarvis-prompt-form"
      onSubmit={(ev) => {
        ev.preventDefault();
        const t = v.trim();
        if (t) onSubmit(t);
      }}
    >
      <input
        className="jarvis-note-input jarvis-prompt-input"
        value={v}
        placeholder={placeholder}
        onChange={(ev) => setV(ev.target.value)}
        onPointerDown={(ev) => ev.stopPropagation()}
        autoFocus
      />
      <button type="submit" className="jarvis-prompt-go" aria-label="Go">
        ▸
      </button>
    </form>
  );
}

/** MAP tab — type a place, get the Mapbox "fly-in" pair (world → city
 *  crossfade). Static images on purpose: zero WebGL, weak-MacBook safe. */
function MapTabContent({
  query,
  onSetQuery,
}: {
  query: string;
  onSetQuery: (q: string) => void;
}) {
  const [imgs, setImgs] = useState<MapboxFlyImages | null>(null);
  // GEO scene grammar: "place | era" — the optional era becomes the
  // year stamp ("year 300 BC") from the founder's H.U.D. reference.
  // Only the place part is geocoded.
  const sep = query.indexOf("|");
  const place = (sep >= 0 ? query.slice(0, sep) : query).trim();
  const era = sep >= 0 ? query.slice(sep + 1).trim() : "";
  useEffect(() => {
    if (!place) return;
    let cancelled = false;
    const ctl = new AbortController();
    setImgs(null);
    void fetchMapboxFlyImages(place, ctl.signal).then((r) => {
      if (!cancelled) setImgs(r);
    });
    return () => {
      cancelled = true;
      ctl.abort();
    };
  }, [place]);

  if (!query) return <PromptInput placeholder="Where? Type a place, hit enter…" onSubmit={onSetQuery} />;
  if (!imgs) return <div className="jarvis-map-status">LOCATING “{place.toUpperCase()}”…</div>;
  if (!imgs.city && !imgs.world)
    return <div className="jarvis-map-status">NO MAP SIGNAL FOR “{place.toUpperCase()}”</div>;
  return (
    <div className="jarvis-map">
      {imgs.world && <img className="jarvis-map-world" src={imgs.world} alt="" draggable={false} />}
      {imgs.city && <img className="jarvis-map-city" src={imgs.city} alt={place} draggable={false} />}
      {/* Pulsing location ring over the pin (image is centered on it). */}
      <div className="jarvis-geo-halo" aria-hidden />
      <div className="jarvis-geo-mark" aria-hidden />
      {era && (
        <div className="jarvis-geo-era" aria-hidden>
          <i /> {era}
        </div>
      )}
      <div className="jarvis-geo-callout">
        <i aria-hidden />
        <span>{place}</span>
      </div>
      <div className="jarvis-geo-hint" aria-hidden>
        PINCH + PULL · ORBIT ⇄ GROUND
      </div>
    </div>
  );
}

function HoloContent({
  payload,
  expanded,
  image,
  onEditNote,
  onPrompt,
}: {
  payload: HoloPayload;
  expanded: boolean;
  image: string | null;
  onEditNote?: (text: string) => void;
  onPrompt?: (text: string) => void;
}) {
  switch (payload.kind) {
    case "stat":
      return (
        <div className="jarvis-stat">
          <div className="jarvis-stat-big">{payload.big}</div>
          {payload.sub && <div className="jarvis-stat-sub">{payload.sub}</div>}
        </div>
      );
    case "data":
      // List cards (top-10 universities etc.) — numbered ranks, more
      // rows visible by default, the rest one tap away.
      return (
        <table className="jarvis-table jarvis-ranked">
          <tbody>
            {(expanded ? payload.rows : payload.rows.slice(0, 6)).map((r, i) => (
              <tr key={r.key}>
                <td className="jarvis-rank">{String(i + 1).padStart(2, "0")}</td>
                <td>{r.key}</td>
                <td>{r.value}</td>
              </tr>
            ))}
            {!expanded && payload.rows.length > 6 && (
              <tr className="jarvis-table-more">
                <td colSpan={3}>tap for {payload.rows.length - 6} more…</td>
              </tr>
            )}
          </tbody>
        </table>
      );
    case "quote":
      return (
        <blockquote className="jarvis-quote">
          “{payload.text}”{payload.attribution && <cite>— {payload.attribution}</cite>}
        </blockquote>
      );
    case "compare":
      return (
        <table className="jarvis-table jarvis-compare">
          <thead>
            <tr>
              <th />
              <th>{payload.labelA}</th>
              <th>{payload.labelB}</th>
            </tr>
          </thead>
          <tbody>
            {(expanded ? payload.rows : payload.rows.slice(0, 4)).map((r) => (
              <tr key={r.key}>
                <td>{r.key}</td>
                <td>{r.valueA}</td>
                <td>{r.valueB}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    case "show":
      return (
        <div className="jarvis-show">
          {image ? (
            <img className="jarvis-show-img" src={image} alt={payload.query} draggable={false} />
          ) : (
            <div className="jarvis-show-placeholder" aria-hidden>
              {payload.query.slice(0, 1).toUpperCase()}
            </div>
          )}
          <p className="jarvis-show-snippet">
            {expanded || payload.snippet.length <= 120 ? payload.snippet : `${payload.snippet.slice(0, 120)}…`}
          </p>
          {expanded && image && <span className="jarvis-source-chip">image · web search</span>}
        </div>
      );
    case "note": {
      // LONG text (Tony's description panels) renders as a READING
      // panel — proper type, line height and scroll — never an essay
      // crammed into a 4-row textarea (founder: "a very small tab and
      // the information inside is so much").
      if (payload.text.trim().length > 240) {
        return (
          <div className="jarvis-reading" onPointerDown={(ev) => ev.stopPropagation()}>
            {renderMarkdown(payload.text)}
          </div>
        );
      }
      // Short/empty: a real, editable panel. Type into it, or leave it
      // empty and Tony's next answer drops in. onPointerDown
      // stopPropagation so dragging the CHROME moves the tab but
      // interacting with the text doesn't.
      return (
        <textarea
          className="jarvis-note-input"
          value={payload.text}
          placeholder="Type here, or just talk to Tony — his answer lands in this tab…"
          onChange={(ev) => onEditNote?.(ev.target.value)}
          onPointerDown={(ev) => ev.stopPropagation()}
          rows={4}
        />
      );
    }
    case "orb":
      return (
        <div className="jarvis-mini-orb" aria-hidden>
          <span />
        </div>
      );
    case "map":
      return <MapTabContent query={payload.query} onSetQuery={(q) => onPrompt?.(q)} />;
    case "pdf":
      return (
        <div className="jarvis-pdf">
          <embed className="jarvis-pdf-embed" src={payload.url} type="application/pdf" />
          <span className="jarvis-pdf-name">{payload.name}</span>
        </div>
      );
    case "ask":
      return (
        <PromptInput
          placeholder={
            payload.mode === "tony"
              ? "Ask Tony anything — his answer lands here…"
              : "Describe the 3D model to fabricate…"
          }
          onSubmit={(t) => onPrompt?.(t)}
        />
      );
    case "welcome":
      return (
        <div className="jarvis-welcome">
          <p>Your hands are the controller now.</p>
          <ul>
            <li>🤏 <b>Pinch</b> a tab to grab it — move it anywhere</li>
            <li>🙌 <b>Both hands pinch</b> — pull apart to grow, together to shrink</li>
            <li>🪄 <b>Pinch with both hands together, then stretch apart</b> — a frame appears; when it turns gold, release to create the tab <b>at the size you stretched</b></li>
            <li>➕ <b>Tap empty space</b> — a plus appears: map, 3D model, ask Tony, PDF</li>
            <li>✋ <b>Hold your open palm</b> to the camera — the menu lands on your hand</li>
            <li>🤲 <b>Grab with both hands and spread wide</b> — the tab grows to its big form</li>
            <li>🏀 <b>Throw a tab</b> — it glides, curves with your wrist, and bounces off the screen edges like a ball</li>
            <li>🗑️ <b>Drag or throw a tab off the LEFT edge</b> — deleted · <b>off the RIGHT edge</b> — saved in the side dock, tap to bring it back</li>
            <li>🌍 <b>Ask Tony about any place</b> — a live satellite tab lands; grow it, then <b>pinch + pull on the map</b> to fly orbit ⇄ ground</li>
            <li>👆 <b>Tap a tab</b> — it grows in place · tap again to shrink it back (nothing ever takes the full screen)</li>
            <li>👏 <b>Clap</b> — spawn an orb</li>
            <li>👈 <b>Swipe left</b> — just Tony · <b>swipe right</b> — tabs return</li>
          </ul>
        </div>
      );
  }
}
