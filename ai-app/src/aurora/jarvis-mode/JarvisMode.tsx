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
 *   "click your hand twice → new tab"        → double-pinch in space.
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
import { GestureEngine, HAND_WARMUP_MS, isTap, type CursorState, type GestureEvent } from "./gestures";
import { useHandTracking } from "./useHandTracking";
import type { ViewerHandCursor } from "../../jarvis/explode";
import "./jarvis-mode.css";

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
/** DR STRANGE portal: a pinch that starts in EMPTY space and sweeps at
 *  least this far (normalized units) conjures a new tab where it ends —
 *  "bring two fingers together, move them, a tab opens". */
const PORTAL_MIN_TRAVEL = 0.12;

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

  const [windows, setWindows] = useState<HoloWindow[]>([]);
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
  // Per-hand grab state: which window + cursor offset from its center.
  const grabsRef = useRef(new Map<string, { id: number; offX: number; offY: number }>());
  // Two-hand resize target + its scale when the gesture started.
  const scalingRef = useRef<{ id: number; baseScale: number } | null>(null);
  // DR STRANGE portal draw: pinches that started in EMPTY space, per
  // hand — sweeping far enough conjures a new tab at the release point.
  const portalsRef = useRef(new Map<string, { lastSparkT: number }>());
  // Pinch sparks (decorative): spawn on pinch-start, fade ~360ms.
  const sparksRef = useRef<Array<{ x: number; y: number; t0: number; hue: "cyan" | "gold" }>>([]);

  // Model-viewer routing read inside the rAF via refs, so toggling the
  // viewer (or swapping its callbacks) never tears down + restarts the
  // GestureEngine (which would reset the per-hand warm-up window).
  const modelViewerOpenRef = useRef(modelViewerOpen);
  modelViewerOpenRef.current = modelViewerOpen;
  const modelHandlersRef = useRef({ onModelExplodeStart, onModelExplode, onModelClose });
  modelHandlersRef.current = { onModelExplodeStart, onModelExplode, onModelClose };
  const modelCursorsSinkRef = useRef(modelCursorsRef);
  modelCursorsSinkRef.current = modelCursorsRef;

  const applyTransform = useCallback((id: number) => {
    const el = elsRef.current.get(id);
    const tr = liveRef.current.get(id);
    if (!el || !tr) return;
    el.style.transform = `translate3d(${tr.x}px, ${tr.y}px, 0) translate(-50%, -50%) scale(${tr.scale})`;
    el.style.zIndex = String(tr.z);
  }, []);

  const spawnWindow = useCallback(
    (payload: HoloPayload, at?: { x: number; y: number }) => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const slot = SPAWN_SLOTS[spawnRef.current % SPAWN_SLOTS.length];
      spawnRef.current += 1;
      const id = idRef.current++;
      zRef.current += 1;
      const win: HoloWindow = {
        id,
        payload,
        x: at ? at.x : slot[0] * vw,
        y: at ? at.y : slot[1] * vh,
        scale: 1,
        z: zRef.current,
        expanded: false,
      };
      liveRef.current.set(id, { x: win.x, y: win.y, scale: 1, z: win.z });
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
    [],
  );

  const closeWindow = useCallback((id: number) => {
    liveRef.current.delete(id);
    elsRef.current.delete(id);
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
      portalsRef.current.clear();
      setPlusMenu(null);
    }
  }, [modelViewerOpen]);

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
    const spawnOnce = (sig: string, payload: HoloPayload) => {
      if (sigs.has(sig)) return;
      sigs.add(sig);
      spawnWindow(payload);
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

    // Tony's prose answer fills the newest EMPTY note tab (the founder's
    // "create a tab, then talk to fill it" flow). Only when there's no
    // richer artifact for this turn — a STAT/DATA/etc. already became its
    // own tab. Deduped per answer text so it lands once.
    const hasArtifact =
      !!(presenting.stat || presenting.data || presenting.quote || presenting.compare || presenting.show);
    const answer = presenting.cleanText.trim();
    if (!hasArtifact && answer.length > 0) {
      const sig = `answer:${answer.slice(0, 60)}`;
      if (!sigs.has(sig)) {
        sigs.add(sig);
        setWindows((ws) => {
          // Find the most-recently-created empty note (no user text yet).
          let targetId = -1;
          let bestZ = -1;
          for (const w of ws) {
            if (w.payload.kind === "note" && w.payload.text.trim() === "" && w.z > bestZ) {
              bestZ = w.z;
              targetId = w.id;
            }
          }
          if (targetId === -1) return ws; // no empty note open → leave as-is
          return ws.map((w) =>
            w.id === targetId && w.payload.kind === "note"
              ? { ...w, payload: { kind: "note", text: answer } }
              : w,
          );
        });
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
      let best: { id: number; z: number } | null = null;
      for (const [id, el] of elsRef.current) {
        const r = el.getBoundingClientRect();
        if (px >= r.left && px <= r.right && py >= r.top && py <= r.bottom) {
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
          // The opened page is pinned center — it can't be grabbed/dragged
          // (close it with fist→open or its ✕). Other tabs grab as usual.
          if (hit != null && hit !== pageIdRef.current) {
            const tr = liveRef.current.get(hit);
            if (tr) {
              zRef.current += 1;
              tr.z = zRef.current;
              grabsRef.current.set(e.hand, { id: hit, offX: tr.x - x, offY: tr.y - y });
              applyTransform(hit);
              const el = elsRef.current.get(hit);
              el?.classList.add("is-grabbed");
            }
          } else if (hit == null) {
            // Pinch in EMPTY space — candidate Dr Strange portal sweep.
            portalsRef.current.set(e.hand, { lastSparkT: performance.now() });
          }
          break;
        }
        case "pinch-move": {
          const grab = grabsRef.current.get(e.hand);
          if (grab) {
            const { x, y } = toScreen(e.x, e.y);
            const tr = liveRef.current.get(grab.id);
            if (!tr) return;
            tr.x = x + grab.offX;
            tr.y = y + grab.offY;
            applyTransform(grab.id);
            return;
          }
          // Portal sweep — golden ember trail behind the moving pinch.
          const portal = portalsRef.current.get(e.hand);
          if (portal) {
            const now = performance.now();
            if (now - portal.lastSparkT > 70) {
              portal.lastSparkT = now;
              const { x, y } = toScreen(e.x, e.y);
              sparksRef.current.push({ x, y, t0: now, hue: "gold" });
            }
          }
          break;
        }
        case "pinch-end": {
          const portal = portalsRef.current.get(e.hand);
          portalsRef.current.delete(e.hand);
          const grab = grabsRef.current.get(e.hand);
          grabsRef.current.delete(e.hand);
          const { x, y } = toScreen(e.x, e.y);

          // HAND-TAP = CLICK. Any button under the tap point gets a real
          // DOM click — close ✕, the "+" menu, CAM/EXIT/mic, overlay
          // buttons — so NOTHING in this mode ever needs the mouse.
          if (isTap(e)) {
            const at = document.elementFromPoint(x, y);
            const btn = at instanceof Element ? at.closest("button") : null;
            if (btn instanceof HTMLButtonElement && !btn.disabled) {
              if (grab) {
                elsRef.current.get(grab.id)?.classList.remove("is-grabbed");
                commitWindow(grab.id);
              }
              btn.click();
              break;
            }
          }

          if (grab) {
            const el = elsRef.current.get(grab.id);
            el?.classList.remove("is-grabbed");
            // Founder spec: dragging a tab off the LEFT edge dismisses it.
            if (x < window.innerWidth * 0.04) closeWindow(grab.id);
            else commitWindow(grab.id);
            // A quick, still pinch on a tab = "click" → open it as the big
            // centered PAGE (founder: "after hitting your tab you could
            // open it"). Fist→open or ✕ closes it back to a small tab.
            if (isTap(e)) {
              setPageId(grab.id);
              setWindows((ws) => ws.map((w) => (w.id === grab.id ? { ...w, expanded: true } : w)));
            }
          } else if (isTap(e)) {
            // Tap on EMPTY space → drop the "+" sign there (tap again to
            // dismiss). Suppressed while a page is open or in focus mode.
            if (!focusModeRef.current && pageIdRef.current == null) {
              setPlusMenu((m) => (m ? null : { x, y, open: false }));
            }
          } else if (portal && e.moved >= PORTAL_MIN_TRAVEL && !focusModeRef.current) {
            // DR STRANGE: the sweep traveled far enough — open the portal.
            const now = performance.now();
            sparksRef.current.push({ x, y, t0: now, hue: "gold" }, { x, y, t0: now + 120, hue: "gold" });
            spawnWindow({ kind: "note", text: "" }, { x, y });
          }
          break;
        }
        case "double-pinch": {
          if (focusModeRef.current) return;
          const { x, y } = toScreen(e.x, e.y);
          // Only spawn over empty space — double-pinch on a tab is just a
          // fast double-click, not "bury the tab under a new one".
          // Creates a REAL empty note: type into it, or just talk to Tony
          // and his next answer drops into the newest empty note.
          if (topWindowAt(x, y) == null) {
            spawnWindow({ kind: "note", text: "" }, { x, y });
          }
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
          }
          break;
        }
        case "two-hand-scale": {
          const sc = scalingRef.current;
          if (!sc) return;
          const tr = liveRef.current.get(sc.id);
          if (!tr) return;
          tr.scale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, sc.baseScale * e.ratio));
          applyTransform(sc.id);
          break;
        }
        case "two-hand-scale-end": {
          if (scalingRef.current) commitWindow(scalingRef.current.id);
          scalingRef.current = null;
          break;
        }
        case "clap": {
          const { x, y } = toScreen(e.x, e.y);
          sparksRef.current.push({ x, y, t0: performance.now(), hue: "gold" });
          if (!focusModeRef.current) spawnWindow({ kind: "orb" }, { x, y });
          break;
        }
        case "swipe-left":
          setFocusMode(true);
          break;
        case "swipe-right":
          setFocusMode(false);
          break;
        case "fist-open":
          // Crush-and-release (fist → five fingers) closes the open page
          // view — founder: "when I do this thing the page should be
          // closed". Does nothing when no page is open, so a natural
          // fist can never nuke anything by accident.
          if (pageIdRef.current != null) setPageId(null);
          break;
      }
    };

    let lastCursors: CursorState[] = [];

    // Scratch buffers reused every frame. The skeleton/cursor passes
    // were the app's biggest steady-state GC allocator (~44 short-lived
    // objects × 60fps with two hands) — real heat on a fanless machine.
    const skelPts = [0, 1].map(() => Array.from({ length: 21 }, () => ({ x: 0, y: 0 })));
    const sinkBuf: ViewerHandCursor[] = [];
    const sinkPts: ViewerHandCursor[] = [
      { x: 0, y: 0, pinching: false },
      { x: 0, y: 0, pinching: false },
    ];

    const draw = (cursors: CursorState[]) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
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
      const now = performance.now();
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
    };

    let lastFreshAt = performance.now();
    let lastHandsShown = -1;
    const loop = () => {
      const now = performance.now();
      const frame = landmarksRef.current;
      if (frame.t !== lastT) {
        lastT = frame.t;
        lastFreshAt = now;
        // Telemetry strip: real tracked-hand count, DOM write only on change.
        const hands = frame.hands.length;
        if (hands !== lastHandsShown && telemetryRef.current) {
          lastHandsShown = hands;
          telemetryRef.current.textContent = `OPTICAL FEED · LIVE — HANDS ${hands}`;
        }
        const { events, cursors } = engine.update(frame);
        lastCursors = cursors;
        for (const e of events) handleEvent(e);
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
      draw(lastCursors);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [status, applyTransform, closeWindow, commitWindow, spawnWindow, landmarksRef, videoRef]);

  // ── Mouse/trackpad fallback so tabs are usable while hands are busy
  //    (or in demos where the camera angle is awkward) ──
  const pointerDrag = useRef<{ id: number; offX: number; offY: number } | null>(null);
  const onWindowPointerDown = useCallback(
    (id: number) => (ev: React.PointerEvent) => {
      const tr = liveRef.current.get(id);
      if (!tr) return;
      zRef.current += 1;
      tr.z = zRef.current;
      pointerDrag.current = { id, offX: tr.x - ev.clientX, offY: tr.y - ev.clientY };
      applyTransform(id);
      (ev.target as HTMLElement).setPointerCapture?.(ev.pointerId);
    },
    [applyTransform],
  );
  useEffect(() => {
    const move = (ev: PointerEvent) => {
      const d = pointerDrag.current;
      if (!d) return;
      const tr = liveRef.current.get(d.id);
      if (!tr) return;
      tr.x = ev.clientX + d.offX;
      tr.y = ev.clientY + d.offY;
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
      ["TAP", "open page"],
      ["FIST→OPEN", "close page"],
      ["TWO HANDS", "resize"],
      ["DOUBLE PINCH", "new tab"],
      ["TAP SPACE", "+ add menu"],
      ["PINCH SWEEP", "portal tab"],
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
            className={`jarvis-win jarvis-win-${w.payload.kind}${w.expanded ? " is-expanded" : ""}${pageId === w.id ? " is-page" : ""}`}
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
                // opens the big page view, same as a gesture tap.
                w.payload.kind === "note" ||
                w.payload.kind === "ask" ||
                (w.payload.kind === "map" && !w.payload.query)
                  ? undefined
                  : () => {
                      setPageId(w.id);
                      setWindows((ws) => ws.map((x) => (x.id === w.id ? { ...x, expanded: true } : x)));
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
          OPTICAL FEED · LIVE — HANDS 0
        </div>
      )}

      {/* HUD — gesture guide (bottom-left), privacy note, exit */}
      <div className="jarvis-gesture-guide" aria-hidden>
        {gestureChips.map(([k, v]) => (
          <span key={k} className="jarvis-chip">
            <b>{k}</b> {v}
          </span>
        ))}
      </div>
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
      const t = p.text.trim();
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
  useEffect(() => {
    if (!query) return;
    let cancelled = false;
    const ctl = new AbortController();
    setImgs(null);
    void fetchMapboxFlyImages(query, ctl.signal).then((r) => {
      if (!cancelled) setImgs(r);
    });
    return () => {
      cancelled = true;
      ctl.abort();
    };
  }, [query]);

  if (!query) return <PromptInput placeholder="Where? Type a place, hit enter…" onSubmit={onSetQuery} />;
  if (!imgs) return <div className="jarvis-map-status">LOCATING “{query.toUpperCase()}”…</div>;
  if (!imgs.city && !imgs.world)
    return <div className="jarvis-map-status">NO MAP SIGNAL FOR “{query.toUpperCase()}”</div>;
  return (
    <div className="jarvis-map">
      {imgs.world && <img className="jarvis-map-world" src={imgs.world} alt="" draggable={false} />}
      {imgs.city && <img className="jarvis-map-city" src={imgs.city} alt={query} draggable={false} />}
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
    case "note":
      // A real, editable panel. Type into it, or leave it empty and Tony's
      // next answer drops in. onPointerDown stopPropagation so dragging the
      // CHROME moves the tab but interacting with the text doesn't.
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
            <li>⚡ <b>Pinch twice fast</b> in empty space — new tab (type in it, or talk)</li>
            <li>➕ <b>Tap empty space</b> — a plus appears: map, 3D model, ask Tony, PDF</li>
            <li>🌀 <b>Pinch + sweep</b> through empty space — portal opens a new tab</li>
            <li>👆 <b>Tap a tab</b> — opens as a big page · 🤛✋ <b>fist → open hand</b> closes it</li>
            <li>👏 <b>Clap</b> — spawn an orb</li>
            <li>👈 <b>Swipe left</b> — just Tony · <b>swipe right</b> — tabs return</li>
          </ul>
        </div>
      );
  }
}
