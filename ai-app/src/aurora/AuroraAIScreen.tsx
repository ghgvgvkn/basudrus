/**
 * AuroraAIScreen — the new ai.basudrus.com main screen (V2).
 *
 * Aurora is the PRODUCT name on this site. The AI persona INSIDE the
 * chat is still Tony Starrk — system prompt in api/ai/tutor.ts is
 * untouched. End users see Aurora branding; Tony introduces himself
 * as Tony in his replies.
 *
 * V2 connects EVERY available data source to the design:
 *   - Real chat via useStreamingAI (persona="omar"=Tony) → /api/ai/tutor
 *   - Real STT via useVoice (push-to-talk mic) → /api/ai/voice/transcribe
 *   - Real TTS auto-speak via useVoice.speak → /api/ai/voice/speak
 *     (fires only when the user used the mic for input — preserves
 *     text-only UX for users who type)
 *   - Conversation history via useAIHistory → grouped today/yesterday/
 *     last-7/earlier. Clicking a session resumes that thread.
 *   - User's city via useGeoCity → /api/geo (Vercel geo or ipapi)
 *   - Daily quota widget via useApp().subscription
 *   - Streak widget via useStreak
 *   - Pro pill reflects real subscription.tier (Free → "Upgrade · Pro",
 *     Pro → "PRO ∞")
 *   - Avatar uses photo_url when photo_mode === "photo", otherwise
 *     initials on user's chosen avatar_color
 *
 * What's deferred (V3 candidates):
 *   - Mode toggle (Explain/Quiz/Solve/Plan)
 *   - File uploads (drag-drop PDF/image)
 *   - Sherlock persona toggle
 *   - Memory hint widget
 *
 * basudrus.com (the main tutoring platform) is COMPLETELY untouched.
 * Only ai-app's files have changed.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/context/AppContext";
import { useStreamingAI, type ChatMsg } from "@/features/ai/useStreamingAI";
import { useVoice } from "@/features/ai/voice/useVoice";
import { useAIHistory, fetchSessionById, type SessionListItem } from "@/features/ai/useAIHistory";
import { useStreak } from "@/features/ai/useStreak";
import { useSupabaseSession } from "@/features/auth/useSupabaseSession";
import { supabase } from "@/lib/supabase";
import { apiUrl } from "@/lib/apiBase";
import { openSettings } from "@ai/settings/useSettingsState";
import { AuroraCanvas, type AuroraHandle } from "./AuroraCanvas";
import type { AuroraTheme } from "./AuroraEngine";
import { AuroraSignUpModal } from "./AuroraSignUpModal";
import { useGeoCity } from "./useGeoCity";
import { parseArtifacts, fetchBriefingImage, fetchMapboxFlyImages, type MapboxFlyImages } from "./auroraVisuals";
import { renderMarkdown } from "./auroraMarkdown";
// JarvisView is lazy-loaded — the R3F/Drei/Three.js bundle is ~850KB
// and we only need it when the user actually opens a 3D model. Most
// sessions never trigger one, so don't ship it on the initial paint.
// resolveModelKey is a tiny string-lookup function with no Three.js
// dependency, so it's imported eagerly from its own module.
import { resolveModelKey, type ModelKey } from "../jarvis/modelKeys";
import { explodeTargetFromRatio, type ViewerHandCursor } from "../jarvis/explode";
const JarvisView = lazy(() => import("../jarvis/JarvisView").then((m) => ({ default: m.JarvisView })));
// GeneratedView — same lazy treatment. Opens when Tony names a model
// that ISN'T one of the six built-ins: the name becomes a Meshy
// text-to-3D prompt and the viewer plays a fabricator sequence.
const GeneratedView = lazy(() => import("../jarvis/GeneratedView").then((m) => ({ default: m.GeneratedView })));
// JARVIS MODE — the camera + hand-gesture holodeck layer: an OPTIONAL second
// way to use voice mode (classic voice mode is untouched). Lazy so the
// gesture engine + CSS never load unless the user turns it on; MediaPipe
// itself loads even later, inside the layer's own hook.
const JarvisMode = lazy(() =>
  import("./jarvis-mode/JarvisMode").then((m) => ({ default: m.JarvisMode })),
);
import "./aurora.css";

type AuroraMessage = {
  id: string;
  role: "user" | "ai";
  text: string;
  /** Epoch ms when the message landed — drives the REAL timestamp in
   *  the telemetry meta row. Optional so restored sessions (saved
   *  before this field existed) render without a stamp. */
  at?: number;
  /** Round-trip latency in ms for AI replies — real measured data,
   *  never decorative. Shown as "· 1.8s" next to the stamp. */
  ms?: number;
};

/** "10:32:15 AM" — matches the topbar's 12-hour clock convention. */
function formatStamp(at: number): string {
  return new Date(at).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

function nextId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function AuroraAIScreen() {
  const { profile, subscription } = useApp();
  const { send, loading, partial } = useStreamingAI();
  const voice = useVoice();
  const history = useAIHistory();
  const streak = useStreak();
  const geo = useGeoCity();
  // Auth state. The page renders without a session — Aurora is
  // publicly browsable. Only chat send / mic require a real user;
  // those actions open the sign-up modal instead when user is null.
  const { user } = useSupabaseSession();
  const isAuthed = !!user;

  /**
   * Cross-subdomain session refresh — keeps the cookie hot.
   *
   * The auth cookie is scoped to .basudrus.com so a user signed in on
   * basudrus.com should automatically appear authed here. In practice
   * we've seen cases where the initial cookie read by the supabase
   * client misses it (timing, browser cookie policies, etc.) and the
   * user looks unauthed even though their session is valid.
   *
   * This effect:
   *   1. On mount, force a refreshSession() — re-reads the cookie
   *      and revalidates the token with Supabase.
   *   2. On tab focus / visibility-change-to-visible, refresh again
   *      so a user who signed in on another tab/site sees their
   *      session here without needing to manually reload.
   *
   * Safe to run unconditionally — refreshSession is idempotent and
   * cheap (one short network call to Supabase auth). If there's no
   * session at all, it silently no-ops.
   */
  /**
   * Session-refresh on visibility / focus changes ONLY.
   *
   * Previously this effect fired refreshSession 4 times in the first
   * 4 seconds (mount + 800ms + 2s + 4s). The intent was to recover
   * from the cross-subdomain cookie missing on initial paint. In
   * practice this was racing with the auth state machine — if the
   * user JUST signed in, an aggressive refresh could hit Supabase
   * mid-handshake and (in edge cases) clear the session entirely
   * via an invalid_grant response. The user would see "signed in"
   * in the chrome but the chat would fail with "Please sign in."
   *
   * New behavior: NO aggressive retries. We rely on the supabase
   * client's own auto-refresh (autoRefreshToken: true in the client
   * config). We just listen for visibility/focus and refresh once
   * each — that catches the "signed in another tab, come back to
   * this one" case without ever running while the auth state is
   * mid-transition.
   */
  useEffect(() => {
    const refreshOnce = () => {
      // Only refresh when we have a current session — calling
      // refreshSession on an empty client can return an error that
      // clears the (already empty) session state, which then races
      // with any in-progress sign-in attempt.
      void supabase.auth.getSession().then(({ data }) => {
        if (!data.session) return;
        // Have a session — try to refresh it silently. Errors are
        // swallowed; the auto-refresh inside supabase-js handles
        // the real token rotation.
        void supabase.auth.refreshSession().catch(() => { /* silent */ });
      });
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshOnce();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", refreshOnce);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", refreshOnce);
    };
  }, []);

  const auroraRef = useRef<AuroraHandle>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [messages, setMessages] = useState<AuroraMessage[]>([]);
  const [input, setInput] = useState("");
  const [focusMode, setFocusMode] = useState(false);
  /** True when the user is hiding the conversation rail. */
  const [railHidden, setRailHidden] = useState(false);
  // Note: previously had a `lastInputWasVoice` state here that drove
  // auto-TTS playback. It was dead code — nothing ever set it to
  // `true`; the voice path uses runSendForText's opts.voice flag
  // directly. Removed in the perf-audit cleanup pass.
  /** Currently-loaded session id (when resumed from history). null
   *  means "new conversation, no session yet." */
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  /** Local 30s tick for the footer clock + meta strip day label. */
  const [meta, setMeta] = useState<{ day: string; clock: string }>(() => formatMeta(new Date()));

  /** Sign-up modal state. When the anonymous user tries to send a
   *  message (or use the mic), we stash the message here and open
   *  the modal. After auth succeeds (detected via user becoming
   *  truthy), we auto-send the pending message. */
  const [signUpOpen, setSignUpOpen] = useState(false);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);

  // Note: an earlier version of this screen looked up the user's
  // most-recently-active tutor subject and passed it as `subject` to
  // the chat endpoint so Aurora would inherit the right per-subject
  // tutor_session memory_context. That mechanism is now obsolete:
  // Aurora calls api/ai/aurora.ts (life-mode), which has no concept
  // of "subject" and reads the SHARED student_memory rows directly.
  // The cross-surface continuity the user experiences ("Tony knows
  // me") comes from student_memory now, not session sharding.
  // Keeping this note here as a tombstone — if you bring back per-
  // subject keying for Aurora later, do it in api/ai/aurora.ts, not
  // by spreading subject state through the client.

  useEffect(() => {
    const id = setInterval(() => setMeta(formatMeta(new Date())), 30 * 1000);
    return () => clearInterval(id);
  }, []);

  // Body class management — drives Aurora canvas state transitions.
  useEffect(() => {
    if (focusMode) document.body.classList.add("aurora-focus-mode");
    else document.body.classList.remove("aurora-focus-mode");
    if (railHidden) document.body.classList.add("aurora-rail-hidden");
    else document.body.classList.remove("aurora-rail-hidden");
    return () => {
      document.body.classList.remove("aurora-focus-mode");
      document.body.classList.remove("aurora-rail-hidden");
    };
  }, [focusMode, railHidden]);

  // (Presentation-mode block — body class + presentingText derivation
  //  — moved to AFTER the voiceModeActive useState declaration further
  //  down. JS hoisting doesn't apply to `const` so we had to put the
  //  derivation in the same scope, below the state it reads.)

  // Pre-warm the Aurora edge function on mount so the user's first
  // message doesn't pay the cold-start tax. GET / is a cheap no-auth
  // ping that returns 200 + spins up the V8 isolate + imports the
  // module graph. Fire-and-forget — failure here is silent because
  // the actual chat send has its own retry-with-backoff anyway.
  useEffect(() => {
    void fetch(apiUrl("/api/ai/aurora"), { method: "GET" }).catch(() => {
      /* warm-up failure is harmless — first message will just be slow */
    });
  }, []);

  // (Removed the global click → primeAudio handler. Safari's
  //  transient user-activation is single-use per gesture, and
  //  having primeAudio fire on EVERY click was consuming the
  //  activation that getUserMedia needed for the mic button.
  //  Tony's speak() now does its own suspended-context detection
  //  and surfaces a clear "tap to enable audio" error if needed —
  //  that's enough recovery without stealing every click's gesture.)

  // Auto-scroll thread to bottom on new content
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, partial]);

  /**
   * Post-auth retry: when an anonymous user opens the sign-up modal
   * with a pending message and successfully authenticates, this fires
   * the moment user becomes truthy. We:
   *   1. Restore the message into the composer (so handleSend can see it)
   *   2. Close the modal
   *   3. Trigger send on the next tick — small delay lets the modal's
   *      exit animation play out + the session token to settle
   *
   * Falls through quietly when the user signed in without a pending
   * message (e.g. they manually opened the modal from the avatar).
   */
  useEffect(() => {
    if (!isAuthed || !pendingMessage) return;
    const message = pendingMessage;
    setPendingMessage(null);
    setSignUpOpen(false);
    setInput(message);
    // Small delay so the modal close animation finishes + the user
    // sees their message appear in the composer right before the
    // send fires. Feels intentional, not jarring.
    const t = setTimeout(() => {
      // Read the latest send function via ref so this effect doesn't
      // depend on runSendForText's identity (which changes per render).
      void runSendForTextRef.current(message);
    }, 240);
    return () => clearTimeout(t);
  }, [isAuthed, pendingMessage]);

  // ── Mic: hands-free voice mode via useVoice + VAD ─────────────────
  // Anonymous visitors can NOT use the mic — transcribe needs an
  // authed JWT. Tapping the mic while unauthed opens the sign-up modal.
  //
  // Tap-to-toggle behavior:
  //   - Tap (not listening) → start hands-free recording. Canvas
  //     activates so the dots react. VAD watches the mic input and
  //     fires endVoiceUtterance when the user stops talking.
  //   - Tap (listening)     → cancel: stop the recording, drop the
  //     audio, deactivate the canvas. Used when the user wants to
  //     abort mid-sentence.
  //
  // endVoiceUtterance is the natural "I finished talking" path. It
  // pulls the recorded blob, transcribes it via /api/ai/voice/transcribe,
  // and IMMEDIATELY dispatches the transcript to runSendForText so Tony
  // replies without the user having to click send. lastInputWasVoice
  // is flipped so the auto-TTS pipeline reads Tony's reply aloud.

  /** Live mic level 0–1, set by the VAD onLevel callback every frame.
   *  Reserved for canvas reactivity — read by AuroraCanvas via ref. */
  const micLevelRef = useRef(0);
  /** Loudest mic level seen during the current utterance (0–1 scaled).
   *  Read when a transcript comes back EMPTY to tell the user what
   *  actually happened: mic barely heard them (device/volume problem)
   *  vs. heard plenty of sound but no words (noise). */
  const peakLevelRef = useRef(0);

  /**
   * Continuous voice-mode state machine.
   *
   * Held in a ref (not state) so the async pipeline can check it
   * synchronously without depending on a render. State diagram:
   *
   *   OFF  ──user taps mic──▶  ON (listening)
   *     ▲                          │
   *     │                          ▼ user speaks then goes silent
   *     │                       (transcribe + Tony reply + TTS)
   *     │                          │
   *     │                          ▼ Tony finishes speaking
   *     │                       ON (listening — automatic restart)
   *     │                          │
   *     └─────user taps mic again──┘
   *
   * The user controls open/close. The system controls the loop in
   * between. ON means: keep the mic going after each Tony reply.
   * Tapping the mic at any sub-stage (listening, thinking, speaking)
   * closes voice mode entirely.
   */
  const voiceModeActiveRef = useRef(false);
  const [voiceModeActive, setVoiceModeActive] = useState(false);

  // ── THEME (Stark Daylight → dark void → Frosted Silicon) ──
  // Founder ask: "I want the website to be white and the dot should be
  // yellow." Light (gold) is the DEFAULT; the dark void and the optional
  // cool-blue "frost" lab look cycle on the topbar toggle. The toggle
  // icon always shows what you'll GET next (moon → snowflake → sun).
  // CSS reads body.aurora-theme-{light|frost} plus the shared
  // aurora-theme-bright marker (component re-skins common to both
  // bright themes); the canvas engine gets the value as a prop.
  const [theme, setTheme] = useState<AuroraTheme>(() => {
    try {
      const saved = localStorage.getItem("aurora-theme");
      return saved === "dark" || saved === "light" || saved === "frost" ? saved : "light";
    } catch {
      return "light";
    }
  });
  useEffect(() => {
    const cls = document.body.classList;
    cls.toggle("aurora-theme-light", theme === "light");
    cls.toggle("aurora-theme-frost", theme === "frost");
    cls.toggle("aurora-theme-bright", theme !== "dark");
    try {
      localStorage.setItem("aurora-theme", theme);
    } catch {
      /* private mode — theme just won't persist */
    }
    return () => {
      cls.remove("aurora-theme-light", "aurora-theme-frost", "aurora-theme-bright");
    };
  }, [theme]);
  const nextTheme: AuroraTheme = theme === "light" ? "dark" : theme === "dark" ? "frost" : "light";

  // ── JARVIS MODE (camera + hand gestures) ──
  // Founder spec: an ADDITIVE option inside voice mode — "we're not gonna
  // leave the old option, we're just gonna add a new option." When on, the
  // selfie camera fills the stage, Tony's artifacts float as grabbable
  // holo-tabs, and the orb docks right (via the proven content-mode corner
  // dock). Voice keeps running untouched underneath.
  const [jarvisActive, setJarvisActive] = useState(false);
  useEffect(() => {
    // Leaving voice mode always exits JARVIS mode too (camera released by
    // the layer's unmount cleanup).
    if (!voiceModeActive && jarvisActive) setJarvisActive(false);
  }, [voiceModeActive, jarvisActive]);

  // ── JARVIS camera-only mode (mic mute) ──
  // Founder: "add a mute if I only want to use the video without AI."
  // While muted: the mic is RELEASED (not just ignored — the OS mic
  // indicator goes off), VAD utterances can't start a pipeline, the
  // auto-relisten loop stays closed, and Tony doesn't speak. Camera +
  // hand gestures keep working untouched. Cleared on JARVIS exit.
  const [jarvisMicMuted, setJarvisMicMuted] = useState(false);
  const jarvisMicMutedRef = useRef(false);
  jarvisMicMutedRef.current = jarvisMicMuted;
  useEffect(() => {
    if (!jarvisActive && jarvisMicMuted) setJarvisMicMuted(false);
  }, [jarvisActive, jarvisMicMuted]);

  // One-tap JARVIS entry from the ALWAYS-VISIBLE composer camera button.
  // Without this, JARVIS could only be reached via a pill that appears
  // *after* you're already inside voice mode — so a first-time user saw
  // no "camera" anywhere (the bug the founder hit). This handler enters
  // voice mode first if needed (Safari-critical: the tap is the user
  // gesture that unlocks the mic), then flips JARVIS on.
  useEffect(() => {
    if (jarvisActive) document.body.classList.add("aurora-jarvis-mode");
    else document.body.classList.remove("aurora-jarvis-mode");
    // The dot-field canvas sits at opacity 0 behind the camera but its
    // rAF keeps painting ~4000 dots at full orb rate — suspend it; the
    // weak GPU belongs to the hand tracker while JARVIS is up.
    auroraRef.current?.suspend(jarvisActive);
    return () => {
      document.body.classList.remove("aurora-jarvis-mode");
      auroraRef.current?.suspend(false);
    };
  }, [jarvisActive]);

  // ── Presentation mode (JARVIS-style HUD: A4 paper + corner orb) ─
  //
  // Founder's spec: while voice MODE is open (not just while Tony
  // is speaking), the central orb shrinks and tucks under the
  // widgets on the right side, and an A4-shaped white paper opens
  // in the middle showing what Tony is saying. The paper persists
  // for the WHOLE voice session — it doesn't flash on and off as
  // Tony pauses between sentences.
  //
  // Direction convention (matches the reference photos):
  //   - "left"  (default) → A4 PAPER in center, orb shrunk to
  //     the bottom-right under the widget shelf. Used for text
  //     presentation (Tony's reply rendered like writing on paper).
  //   - "right" → reserved for future 3D / map / visualization
  //     content where the orb moves to the LEFT instead so the
  //     visualization can use the right side of the screen.
  //
  // Tied to voiceModeActive (not voice.isSpeaking) so the paper
  // stays open through the whole conversation — opens on mic tap,
  // closes only when the user dismisses voice mode.
  const isPresenting = voiceModeActive;
  const presentingSide: "left" | "right" = "left";
  useEffect(() => {
    if (isPresenting) {
      document.body.classList.add("aurora-presenting");
      document.body.classList.add(`aurora-presenting-${presentingSide}`);
    } else {
      document.body.classList.remove("aurora-presenting");
      document.body.classList.remove("aurora-presenting-left");
      document.body.classList.remove("aurora-presenting-right");
    }
    return () => {
      document.body.classList.remove("aurora-presenting");
      document.body.classList.remove("aurora-presenting-left");
      document.body.classList.remove("aurora-presenting-right");
    };
  }, [isPresenting, presentingSide]);

  // Pull the latest AI message + parse Tony's artifact blocks out of it.
  //   SHOW  → Wikipedia thumbnail
  //   MAP   → Mapbox dark static image
  //   STAT  → big-number tile  (no network)
  //   DATA  → key-value table   (no network)
  //   QUOTE → pull-quote        (no network)
  //   MODEL → full-screen 3D viewer overlay
  // All render around Tony's text on the workspace. Text is the
  // CLEANED version with all blocks stripped — users never see raw
  // markers, even if Tony emits duplicates.
  const EMPTY_PARSE = {
    show: null,
    map: null,
    stat: null,
    data: null,
    quote: null,
    compare: null,
    model: null,
    cleanText: "",
  } as const;
  const presenting = useMemo(() => {
    if (!isPresenting) return EMPTY_PARSE;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === "ai" && m.text.trim()) {
        return parseArtifacts(m.text);
      }
    }
    return EMPTY_PARSE;
  // EMPTY_PARSE is a const declared at function-scope, doesn't change
  // between renders — no need to list as a dep.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPresenting, messages]);
  const presentingText = presenting.cleanText;

  // True when in voice mode AND Tony's current reply has ANY visual
  // artifact attached (photo, map, stat, data, quote). Triggers the
  // @huwprosser-style "corner-shift" pattern: the centered orb +
  // arc-reactor ring shrink to the bottom-right corner, and the
  // artifact content fills the main area as the hero. When false,
  // the standard centered-orb-with-text-below layout is used.
  // MODEL artifacts are excluded here because they open the
  // separate full-screen 3D viewer which handles its own takeover.
  const hasHeroContent = isPresenting && !!(
    presenting.show
    || presenting.map
    || presenting.stat
    || presenting.data
    || presenting.quote
    || presenting.compare
  );
  useEffect(() => {
    // JARVIS mode rides the same proven corner-dock: while the camera layer
    // is up, the ring stays parked bottom-right even with no artifact on
    // screen (the holo-tabs own the center; founder wants the orb right).
    if (hasHeroContent || jarvisActive) document.body.classList.add("aurora-content-mode");
    else document.body.classList.remove("aurora-content-mode");
    return () => document.body.classList.remove("aurora-content-mode");
  }, [hasHeroContent, jarvisActive]);

  // True when the user is in voice mode and Tony is mid-reply — i.e.
  // the last message in the thread is still from the USER, or the
  // streaming `loading` flag is set, or Tony's reply is still empty.
  // Drives the workspace's "thinking" indicator so the paper isn't
  // a dead blank rectangle while the user waits. Matches the chat-
  // thread typing-bubble behavior.
  const presentingThinking = useMemo(() => {
    if (!isPresenting) return false;
    if (loading) return true;
    // If no messages yet, we're waiting for the first user utterance.
    if (messages.length === 0) return false;
    // If the most recent message is from the USER, we're waiting on Tony.
    const last = messages[messages.length - 1];
    if (last.role === "user") return true;
    // Otherwise we have a Tony reply — but if it parsed to empty
    // text + no artifacts, treat as still loading (defensive — the
    // streaming path can transiently hand us an empty assistant msg).
    if (
      !presenting.cleanText.trim()
      && !presenting.show
      && !presenting.map
      && !presenting.stat
      && !presenting.data
      && !presenting.quote
      && !presenting.compare
    ) {
      return true;
    }
    return false;
  }, [isPresenting, loading, messages, presenting]);

  // Lazy-fetch the briefing hero image for Tony's current SHOW
  // block. Re-runs whenever the AI message's SHOW query changes.
  //
  // Two-tier fallback inside fetchBriefingImage:
  //   1. Brave Image Search (via our /api/research/image proxy) —
  //      real image-search quality, comparable to Google. Needs the
  //      user's access token because the proxy is auth-gated.
  //   2. Wikipedia summary thumb — free fallback when Brave isn't
  //      configured or returns nothing. Used to be the primary
  //      source before we added Brave.
  //
  // Cached at the module level so flipping between messages with
  // the same query doesn't re-hit either source.
  const [presentingImage, setPresentingImage] = useState<string | null>(null);
  useEffect(() => {
    if (!presenting.show) {
      setPresentingImage(null);
      return;
    }
    let cancelled = false;
    const ctl = new AbortController();
    void (async () => {
      // Fetch the current session token so the auth-gated Brave
      // proxy will accept us. Anonymous users (no token) skip Brave
      // entirely and go straight to Wikipedia inside fetchBriefingImage.
      let token: string | null = null;
      try {
        const { data } = await supabase.auth.getSession();
        token = data.session?.access_token ?? null;
      } catch { /* no session → Wikipedia path */ }
      if (cancelled) return;
      const url = await fetchBriefingImage(
        presenting.show!.query,
        token,
        ctl.signal,
      );
      if (cancelled) return;
      setPresentingImage(url);
    })();
    return () => {
      cancelled = true;
      ctl.abort();
    };
  }, [presenting.show?.query]);

  // Lazy-fetch the Mapbox TWO-FRAME fly-in images for Tony's current
  // MAP block. Founder wanted a Google-Earth-style "from space, dive
  // in to the location" effect — but on a weak MacBook so no WebGL.
  // Solution: fetch TWO static images per map (wide world view +
  // tight city view) and let CSS crossfade-and-scale between them
  // for the "fly-in" feeling. ~Zero perf cost on any device.
  // Null result = either no token configured, or geocode failed.
  const [presentingMap, setPresentingMap] = useState<MapboxFlyImages>({ city: null, world: null });
  useEffect(() => {
    if (!presenting.map) {
      setPresentingMap({ city: null, world: null });
      return;
    }
    let cancelled = false;
    const ctl = new AbortController();
    void fetchMapboxFlyImages(presenting.map.query, ctl.signal).then((result) => {
      if (cancelled) return;
      setPresentingMap(result);
    });
    return () => {
      cancelled = true;
      ctl.abort();
    };
  }, [presenting.map?.query]);

  // 3D Jarvis viewer state. When Tony emits a <<<MODEL:name>>>
  // block AND the name resolves to a known model in MODEL_REGISTRY,
  // we open the full-screen 3D viewer. The user can dismiss via
  // the overlay's Close button OR Esc key. Tracked as a separate
  // state (not derived from `presenting`) so the user can close
  // the viewer without it re-opening on the next render — once
  // dismissed for the current message, it stays dismissed until
  // a NEW model block comes through.
  const [activeJarvisModel, setActiveJarvisModel] = useState<ModelKey | null>(null);
  // Live-generated model viewer (Meshy text-to-3D). Opens when the
  // MODEL name does NOT resolve to a built-in — the raw name becomes
  // the generation prompt. Mutually exclusive with activeJarvisModel.
  const [activeGeneratedPrompt, setActiveGeneratedPrompt] = useState<string | null>(null);
  // Track which AI-message text we've already "opened" so a single
  // message only auto-opens the viewer once. Re-mount safe via the
  // message text comparison (cleanText fragment is stable per
  // message).
  const lastAutoOpenedRef = useRef<string>("");
  useEffect(() => {
    if (!presenting.model) {
      lastAutoOpenedRef.current = "";
      return;
    }
    const key = resolveModelKey(presenting.model.name);
    // Use the cleanText as the "message fingerprint" so each
    // distinct AI reply only auto-opens once. Re-opens cleanly
    // if Tony emits a new model later in the conversation.
    const fingerprint = `${key ?? presenting.model.name}::${presenting.cleanText.slice(0, 60)}`;
    if (lastAutoOpenedRef.current === fingerprint) return;
    lastAutoOpenedRef.current = fingerprint;
    if (key) {
      setActiveGeneratedPrompt(null);
      setActiveJarvisModel(key);
    } else {
      // Unknown name → live generation. The fabricator view owns the
      // whole lifecycle (auth nudge, quota copy, retry).
      setActiveJarvisModel(null);
      setActiveGeneratedPrompt(presenting.model.name);
    }
  }, [presenting.model, presenting.cleanText]);
  // Esc closes whichever 3D viewer is open (plus their own buttons).
  useEffect(() => {
    if (!activeJarvisModel && !activeGeneratedPrompt) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setActiveJarvisModel(null);
        setActiveGeneratedPrompt(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeJarvisModel, activeGeneratedPrompt]);

  // ── EXPLODED VIEW plumbing ──
  // The target the 3D model eases toward (0..1). Written by the
  // viewer's slider AND, in JARVIS camera mode, by the two-hand
  // pull-apart gesture. A ref (not state) so per-frame gesture writes
  // never re-render the screen.
  const modelExplodeTargetRef = useRef(0);
  // Explode-t captured at the moment a two-hand gesture starts, so the
  // gesture composes on top of the current explosion (pull → more,
  // push → less) exactly like the holo-tab resize feels.
  const modelExplodeBaseRef = useRef(0);
  // Hand cursors mirrored from JarvisMode → drawn over the 3D scene.
  const modelCursorsRef = useRef<ViewerHandCursor[]>([]);
  // A model always opens assembled — reset the target whenever the
  // active model changes (open, close, or swap).
  useEffect(() => {
    modelExplodeTargetRef.current = 0;
    modelExplodeBaseRef.current = 0;
    modelCursorsRef.current = [];
  }, [activeJarvisModel, activeGeneratedPrompt]);

  /**
   * Monotonic counter bumped every time the user opens (or closes)
   * voice mode. Async pipeline stages capture the generation at start
   * and compare on each await — if it's changed, they're stale and
   * silently bail. Belt + suspenders alongside voiceModeActiveRef:
   * the bool tells you "is voice mode on RIGHT NOW," the gen tells
   * you "is this specific utterance's chain still the current one."
   * Without the gen, a fast cancel-then-restart could let stage-A
   * from utterance #1 still write into utterance #2.
   */
  const voiceSessionGenRef = useRef(0);

  // ── HUD around the centered orb (JARVIS-style status frame) ───────
  //
  // The stage gets a unified --audio-level CSS variable that combines
  // BOTH the user's mic level AND Tony's TTS playback level. Wired to
  // every reactive element (orb scale, ring glow, mic bars, vignette
  // pulse) so the whole UI breathes with whoever is speaking — your
  // voice OR Tony's. Founder asked: "make the points inside the
  // circle or the wall move with the sound when he's speaking and
  // when I'm speaking."
  //
  // Implementation:
  //   - mic level comes from VAD via micLevelRef (already wired)
  //   - TTS level sampled from voice.analyserRef when isSpeaking
  //   - Both written to the SAME CSS variable; whichever is louder
  //     drives the visuals — clean from the user's POV
  const jarvisRingRef = useRef<HTMLDivElement>(null);
  const [hudClock, setHudClock] = useState(() => formatHudClock(new Date()));
  useEffect(() => {
    if (!isPresenting) return;
    setHudClock(formatHudClock(new Date()));
    const id = window.setInterval(() => {
      setHudClock(formatHudClock(new Date()));
    }, 1000);
    return () => window.clearInterval(id);
  }, [isPresenting]);

  // Reusable byte buffer for the TTS analyser. Hoisted so we don't
  // allocate ~2KB per animation frame (the GC churn would show up
  // on low-end devices the founder explicitly called out).
  // Typed as Uint8Array<ArrayBuffer> explicitly because TS 5.7+
  // narrowed the WebAudio analyser signature to require the
  // non-shared variant.
  const ttsByteBufRef = useRef<Uint8Array<ArrayBuffer> | null>(null);

  // Smoothing state for the combined audio level. We low-pass the
  // raw RMS so the visuals don't twitch on every transient. Tunable:
  //   - SMOOTH_ATTACK   how fast we ramp UP toward a louder peak
  //   - SMOOTH_RELEASE  how fast we ramp DOWN when sound stops
  // Slower release = the orb keeps "breathing" briefly after a word
  // ends, which reads as more natural than snapping to zero.
  const smoothedLevelRef = useRef(0);
  const SMOOTH_ATTACK = 0.45;
  const SMOOTH_RELEASE = 0.10;

  // Audio-driven canvas pulse — triggers a real ripple inside the
  // dot field when the audio level crosses a threshold, so the orb
  // visibly reacts to each syllable like a character speaking. The
  // CSS scale + bob handles SUSTAINED loudness; this pulse handles
  // ATTACK transients (the punch of a new syllable). Throttled to
  // 180ms minimum gap so a sustained loud passage doesn't spam
  // pulses every frame.
  const lastPulseAtRef = useRef(0);
  const wasAboveRef = useRef(false);
  const PULSE_THRESHOLD = 0.35;
  const PULSE_COOLDOWN_MS = 180;

  // Stable refs to the bits of `voice` the rAF loop needs. Reading
  // through refs (instead of listing `voice` in deps) prevents the
  // whole rAF loop from being torn down and rebuilt every time any
  // unrelated useVoice state flips — which it does ~10 times during
  // a single voice turn (isTranscribing toggling, isSpeaking
  // toggling, etc.). Each rebuild reset --audio-level and dropped
  // a frame of reactivity. Refs fix that.
  const voiceAnalyserRef = voice.analyserRef;
  const voiceIsSpeakingRef = useRef(voice.isSpeaking);
  useEffect(() => { voiceIsSpeakingRef.current = voice.isSpeaking; }, [voice.isSpeaking]);

  useEffect(() => {
    if (!isPresenting) return;
    let raf = 0;
    // Counter for consecutive idle frames (no audio AND not playing
    // TTS). When we cross IDLE_FRAMES_TO_SLEEP, we drop from
    // requestAnimationFrame (60fps) to setTimeout (10fps). Wakes back
    // up the moment audio activity returns. Cuts steady-state CPU
    // during silence by ~85% — directly addresses the founder's
    // "low-end laptop" performance concern.
    let idleFrames = 0;
    const IDLE_FRAMES_TO_SLEEP = 30; // ~0.5s of silence before sleep
    const SLEEP_MS = 100; // 10fps poll during silence

    const tick = () => {
      // Sample TTS playback level if Tony is currently speaking.
      // analyserRef is set up lazily by useVoice's ensureAudioContext;
      // it's only non-null after the first speak() call has wired the
      // playback chain.
      let ttsLevel = 0;
      const analyser = voiceAnalyserRef.current;
      if (voiceIsSpeakingRef.current && analyser) {
        const len = analyser.fftSize;
        let buf = ttsByteBufRef.current;
        if (!buf || buf.length !== len) {
          // Allocate via a dedicated ArrayBuffer (not SharedArrayBuffer)
          // so the Uint8Array<ArrayBuffer> narrowing TS 5.7+ requires
          // for analyser.getByteTimeDomainData() satisfies the
          // signature without a cast.
          buf = new Uint8Array(new ArrayBuffer(len));
          ttsByteBufRef.current = buf;
        }
        // getByteTimeDomainData returns 0-255 centered at 128. Subtract
        // 128 to get signed -128..127, square, average, square-root →
        // RMS. Divide by 128 → 0..1.
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        // Stride 4 — sampling every 4th value is plenty for level
        // tracking (we're not running an FFT) and cuts the per-frame
        // cost by 75%.
        for (let i = 0; i < len; i += 4) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / (len / 4));
        // TTS comes out a lot quieter raw than mic input; boost so
        // visuals react comparably to the user's voice. Clamp to
        // 0..1.
        ttsLevel = Math.min(1, rms * 3.5);
      }
      // Take the louder of mic vs TTS. Whoever is talking drives the
      // visuals — clean and intuitive.
      const target = Math.max(micLevelRef.current, ttsLevel);
      // Smooth the value with asymmetric attack/release. Attack is
      // fast so peaks pop; release is slow so the orb keeps
      // "breathing" briefly after a word ends.
      const prev = smoothedLevelRef.current;
      const coef = target > prev ? SMOOTH_ATTACK : SMOOTH_RELEASE;
      const smoothed = prev + (target - prev) * coef;
      smoothedLevelRef.current = smoothed;
      // Write to BOTH the ring (for local-element reactions like the
      // mic bars) AND the body (so global elements — vignette,
      // canvas scale — can read the same value). Two-decimal clamp
      // keeps the CSS var from churning on floating-point noise.
      const out = smoothed.toFixed(2);
      const el = jarvisRingRef.current;
      if (el) el.style.setProperty("--mic-level", out);
      document.body.style.setProperty("--audio-level", out);

      // Audio-driven canvas pulse — fire a real ripple in the dot
      // field on every audio peak above PULSE_THRESHOLD. Edge-trigger
      // (only on transitions from below→above the threshold) +
      // 180ms cooldown so a sustained loud passage doesn't spam
      // pulses. This is what makes the orb feel like a CHARACTER
      // speaking instead of just a static breathing sphere — each
      // new syllable punches a visible ripple through the dots.
      const above = smoothed > PULSE_THRESHOLD;
      const now = performance.now();
      if (above && !wasAboveRef.current && now - lastPulseAtRef.current > PULSE_COOLDOWN_MS) {
        const cx = window.innerWidth / 2;
        // Orb's screen position is 46% from top (CSS translateY of
        // -4vh from viewport-center). Keep this in sync with the
        // ring + canvas CSS or pulses will fire at the wrong spot.
        const cy = window.innerHeight * 0.46;
        // Pulse intensity scales with the peak — softer ripples on
        // quieter syllables, bigger ripples on emphasis.
        auroraRef.current?.pulse(cx, cy, Math.min(0.8, smoothed * 1.2));
        lastPulseAtRef.current = now;
      }
      wasAboveRef.current = above;

      // Adaptive frame scheduling. When there's no audio activity
      // (mic silent AND TTS not playing) for ~0.5s, drop to a slow
      // setTimeout poll. When activity returns, bounce back to
      // requestAnimationFrame for smooth 60fps reactivity.
      const isQuiet = smoothed < 0.02 && !voiceIsSpeakingRef.current;
      if (isQuiet) {
        idleFrames++;
      } else {
        idleFrames = 0;
      }
      if (idleFrames > IDLE_FRAMES_TO_SLEEP) {
        raf = window.setTimeout(tick, SLEEP_MS) as unknown as number;
      } else {
        raf = window.requestAnimationFrame(tick);
      }
    };
    raf = window.requestAnimationFrame(tick);
    return () => {
      // Cancel BOTH possible scheduler types since we switch between
      // them. Calling the wrong one is a no-op so this is safe.
      window.cancelAnimationFrame(raf);
      window.clearTimeout(raf);
      // Reset on exit so the next entry starts from a clean state.
      document.body.style.removeProperty("--audio-level");
      smoothedLevelRef.current = 0;
      idleFrames = 0;
    };
  // Deliberately exclude `voice` from deps — we read it via refs
  // (voiceAnalyserRef, voiceIsSpeakingRef) so we don't need to tear
  // down + rebuild this loop every time useVoice re-renders. See
  // the ref declarations just above this effect for the why.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPresenting]);
  // Status word for the HUD label. Mirrors the present-panel
  // header label but lives down by the corner orb. "READY" is the
  // intermediate state between Tony finishing a reply and the mic
  // re-opening for the next turn.
  const hudStatus = voice.isSpeaking
    ? "SPEAKING"
    : voice.isListening
      ? "LISTENING"
      : voice.isTranscribing
        ? "PROCESSING"
        : "READY";

  /**
   * Counter for how many consecutive empty utterances we've seen
   * inside the current voice mode. Resets to 0 the moment the user
   * says something the server actually transcribes. If we hit
   * MAX_EMPTY_STREAK in a row, voice mode shuts itself down instead
   * of restarting the listen loop forever — that was the bug behind
   * the user's screenshot showing "didn't catch your voice — try
   * speaking up" repeated 5 times in a row.
   *
   * Common cause: silent room, mic muted at the OS level, AirPods
   * dropped, user walked away from the laptop. In all of those, the
   * AI spamming the chat with "didn't catch you" doesn't help —
   * it's just noise.
   */
  const emptyStreakRef = useRef(0);
  const MAX_EMPTY_STREAK = 2;

  /**
   * Kicks off (or restarts) the mic-listening leg of the loop. Called
   * once when the user enters voice mode AND again automatically each
   * time Tony finishes speaking. Bails out cleanly if voice mode has
   * been closed in the meantime.
   */
  const beginListening = useCallback(async () => {
    if (!voiceModeActiveRef.current) return;
    // Camera-only mode: the relisten loop stays closed while muted —
    // the unmute effect below reopens it.
    if (jarvisMicMutedRef.current) return;
    auroraRef.current?.activate();
    // startRecording wraps navigator.mediaDevices.getUserMedia. If
    // Safari has denied mic permission for this site, this returns
    // { ok: false, error: "Microphone permission denied" }. Surface
    // it visibly in the chat — the previous behavior was to set
    // voice.error state and not show it anywhere, so users hit
    // "tap mic, nothing happens" with no clue why.
    // silenceMs = 2500 — founder explicitly asked: "I don't want him
    // to speak until I finish." Previous 1400ms cut users off mid-
    // thought during natural pauses ("Tell me about... uh... iPhone"
    // — the 1400ms window expired on the "uh" pause and Tony jumped
    // in before the user could finish). 2.5 seconds is generous enough
    // for a thoughtful pause, fast enough that the conversation
    // doesn't feel laggy when the user IS done. If they want shorter
    // replies they just talk faster — the mic won't punish them for
    // stopping to think.
    peakLevelRef.current = 0; // fresh utterance, fresh peak
    const result = await voice.startRecording({
      handsFree: {
        silenceMs: 2500,
        onSilence: () => { void endVoiceUtteranceRef.current(); },
        onLevel: (rms) => {
          micLevelRef.current = rms;
          if (rms > peakLevelRef.current) peakLevelRef.current = rms;
        },
      },
    });
    if (!result.ok) {
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: "ai",
          text: `(mic unavailable: ${result.error ?? "unknown error"}). ` +
            (result.error?.includes("denied")
              ? "On Safari: tap aA in the address bar → Website Settings → set Microphone to Allow, then reload."
              : "Check your browser's mic permission for this site."),
        },
      ]);
      // Reset voice-mode state so the orb returns to idle and the
      // next mic tap can try again from a clean slate.
      voiceModeActiveRef.current = false;
      setVoiceModeActive(false);
      auroraRef.current?.deactivate();
    }
  }, [voice]);

  // Apply/release camera-only mute. Muting physically stops the
  // recorder (mic indicator off) and cuts any in-flight speech;
  // unmuting re-enters the listening loop if voice mode is still on.
  useEffect(() => {
    if (!jarvisActive) return;
    if (jarvisMicMuted) {
      try { voice.stopSpeaking(); } catch { /* noop */ }
      void voice.stopRecording().catch(() => { /* discard */ });
    } else if (voiceModeActiveRef.current) {
      void beginListening();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jarvisMicMuted, jarvisActive]);

  /**
   * Post-utterance flow: stop recording, transcribe, send to Tony,
   * speak Tony's reply, then (if still in voice mode) loop back to
   * listening. This is the heart of the continuous conversation.
   *
   * Surfaces transcribe failures inline as a chat message. Without
   * this, a 400 from /api/ai/voice/transcribe (unsupported audio
   * type, empty audio, etc.) would silently bail and the user would
   * see "nothing happened" with no clue why.
   *
   * Uses runSendForTextRef so the closure stays fresh; passes
   * voice:true explicitly so runSendForText doesn't have to read
   * the (always-stale at this point) lastInputWasVoice state.
   *
   * The continuation step (auto-restart listening) waits on
   * voice.speak's `ended` promise — that's the precise moment the
   * audio finishes playing, so the mic doesn't open while Tony is
   * still talking (which would feed Tony's voice back as input).
   */
  const endVoiceUtterance = useCallback(async () => {
    // Capture the session generation NOW. If the user dismisses mid-
    // pipeline, voiceSessionGenRef gets bumped — any later check that
    // sees a different gen knows this chain is stale and bails. Without
    // this guard, a tap-to-dismiss made AFTER VAD fired but BEFORE
    // transcribe completed would still produce a Tony reply + voice
    // playback for the discarded utterance.
    const myGen = voiceSessionGenRef.current;
    const stillMine = () => voiceModeActiveRef.current && voiceSessionGenRef.current === myGen;

    // Muted = camera-only: drop the utterance on the floor. (Covers the
    // race where VAD silence fires in the same tick as the mute tap.)
    if (jarvisMicMutedRef.current) {
      void voice.stopRecording().catch(() => {});
      return;
    }

    const blob = await voice.stopRecording();
    if (!stillMine()) return;
    if (!blob) {
      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: "ai", text: "(couldn't capture audio — try again)" },
      ]);
      if (stillMine()) void beginListening();
      return;
    }
    // Pass "en" as a hard language hint to Scribe. Without a hint,
    // Scribe auto-detects and routinely mistranscribes English into
    // Arabic (the founder reported this — they spoke English and got
    // Arabic text back). Aurora's main audience is English-speaking
    // for now; if we add a per-user language preference later, swap
    // this to read from profile.
    const result = await voice.transcribe(blob, "en");
    if (!stillMine()) return;
    if (!result.ok) {
      // Translate raw failure strings into something a human can act
      // on. "Load failed" / "Failed to fetch" are the browser's words
      // for a dropped network request (already retried inside
      // transcribe()); 4xx text from the server is passed through.
      const raw = result.error ?? "unknown error";
      const friendly = /load failed|failed to fetch|network/i.test(raw)
        ? "connection blipped — say that again?"
        : /empty audio|too short/i.test(raw)
          ? "I didn't catch that — try speaking a little longer"
          : raw;
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: "ai",
          text: `(transcription failed: ${friendly})`,
        },
      ]);
      if (stillMine()) void beginListening();
      return;
    }
    // ElevenLabs Scribe transcribes ambient sounds as parenthesized
    // descriptions like "(slurps)", "(heavy breathing)", "(microphone
    // thumps)". These are noise — Tony shouldn't see them and treat
    // them as questions. Strip them, then check what's actual speech
    // remains. If nothing is left, the user didn't really say
    // anything (mic too far / room too noisy / hot mic between
    // utterances). Re-open the mic for another attempt.
    const cleaned = result.transcript
      .replace(/\([^)]*\)/g, " ") // drop "(sound description)" segments
      .replace(/\s+/g, " ")        // collapse the spaces left behind
      .trim();
    if (!cleaned) {
      // Increment the streak. If we've hit too many empties in a
      // row, just close voice mode instead of looping — that prevents
      // the chat from spamming the same "didn't catch you" message
      // over and over when the mic is muted / room is silent.
      emptyStreakRef.current += 1;
      if (emptyStreakRef.current >= MAX_EMPTY_STREAK) {
        setMessages((prev) => [
          ...prev,
          {
            id: nextId(),
            role: "ai",
            text: "(closing voice mode — tap the mic to start again)",
          },
        ]);
        shutdownVoiceMode();
        emptyStreakRef.current = 0;
        return;
      }
      // Diagnose instead of the old generic "try speaking up": the
      // peak level says whether the mic barely heard anything (wrong
      // device / input volume too low / too far) or heard plenty of
      // sound that just wasn't words (background noise).
      const mic = voice.micLabelRef.current ? ` · mic: ${voice.micLabelRef.current}` : "";
      const diagnosis =
        peakLevelRef.current < 0.12
          ? `(your mic is barely picking you up${mic} — move closer, or raise the input volume in System Settings → Sound → Input)`
          : `(heard sound but no words${mic} — if that mic is far away or it's noisy, switch mics in System Settings → Sound)`;
      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: "ai", text: diagnosis },
      ]);
      if (stillMine()) void beginListening();
      return;
    }
    // Successful transcript — reset the empty-streak counter so the
    // next stretch of silence starts fresh.
    emptyStreakRef.current = 0;

    // PRE-WARM BARGE-IN — founder's spec: "if I interrupt between
    // time to say something you should stop talking and listen to
    // me." Old flow opened the barge-in mic AFTER speak() resolved,
    // which meant the first ~300-800ms of Tony's reply had no
    // listener (the time it took for getUserMedia to acquire the
    // mic). User couldn't reliably interrupt his first sentence.
    //
    // New flow: kick off the mic IN PARALLEL with the LLM+TTS
    // pipeline. By the time runSendForText resolves (Tony's audio
    // has started playing), the listener has been opening for the
    // entire Anthropic stream + TTS fetch — usually ~1-3s — and is
    // already hot. The user's first interrupting word triggers
    // immediately instead of getting lost in the warm-up window.
    //
    // Tunings (overridden from useVoice defaults):
    //   threshold: 0.020 (was 0.025) — slightly more sensitive,
    //     catches the first phoneme not the second.
    //   durationMs: 140  (was 250)  — quarter of a syllable, not
    //     half. Feels INSTANT instead of "did it hear me?"
    //
    // The 220ms head-of-line delay lets the user's trailing breath
    // from the just-completed utterance die down before the listener
    // starts paying attention — without it, we'd trigger barge-in on
    // the user's own exhale (false positive).
    const bargeInPromise = (async () => {
      await new Promise<void>((r) => setTimeout(r, 220));
      // stillMine guard: if user dismissed during the 220ms, don't
      // even open the mic stream.
      if (!stillMine()) return null;
      return voice.startBargeInListener({
        onDetected: () => {
          // Tony is interrupted — stop his audio. The ended promise
          // resolves (via the speak() pause path), the await below
          // unblocks, and we fall through to beginListening which
          // captures the user's next utterance.
          voice.stopSpeaking();
          // Say WHY he went quiet. The founder's report — "it stopped
          // talking for no reason, there was no error" — was this
          // firing invisibly.
          setMessages((prev) => [
            ...prev,
            { id: nextId(), role: "ai", text: "(you interrupted — go ahead, I'm listening)" },
          ]);
        },
        // threshold 0.045 / 400ms (was 0.020 / 140ms). The hair-trigger
        // tuning made Tony interrupt HIMSELF: on speakers his own voice
        // — or a single JARVIS gesture blip (40-140ms) — crossed 0.020
        // and cut his reply mid-sentence with no error shown. Barge-in
        // now needs sustained, speech-loud input: a real spoken word
        // still triggers in under half a second; echoes and UI ticks
        // don't.
        threshold: 0.045,
        durationMs: 400,
      });
    })();

    // Send the transcript to Tony. runSendForText calls voice.speak
    // internally because voice:true is set; it stores the SpeakResult
    // on speakEndedRef so we can await `ended` here for the loop.
    await runSendForTextRef.current(cleaned, { voice: true });
    if (!stillMine()) {
      // User dismissed while Anthropic was streaming. The auto-TTS
      // started inside runSendForText — kill it so they don't hear
      // a reply they explicitly cancelled. Also drop the bargeIn
      // mic if it managed to open during the cancelled run.
      voice.stopSpeaking();
      try {
        const bi = await bargeInPromise;
        bi?.stop();
      } catch { /* noop */ }
      return;
    }

    // Wait for Tony's voice to finish before re-opening the mic. If
    // speak failed or returned no ended promise, we still continue —
    // the loop should never get stuck. The bargeIn listener (started
    // in parallel above) is now mature and will fire instantly if
    // the user starts talking over Tony.
    const ended = speakEndedRef.current;
    speakEndedRef.current = null;
    // Resolve the pre-warmed listener. Even if it's still opening
    // (very fast LLM reply), the await here will be brief — and by
    // the time Tony has actually emitted his first audible word, the
    // mic graph is wired.
    const bargeIn = await bargeInPromise;

    if (ended) {
      // try/finally guarantees the bargeIn mic stream is released
      // even if the user shuts down voice mode mid-await. Previously
      // the bargeIn?.stop() below was unreachable in that path, so
      // the bargeIn mic stream would stay hot forever (red mic dot
      // in the browser bar).
      try {
        try { await ended; } catch { /* noop */ }
      } finally {
        bargeIn?.stop();
      }
    } else {
      // No ended promise (speak failed or returned text-only). Still
      // need to release the pre-warmed mic.
      bargeIn?.stop();
    }
    if (stillMine()) void beginListening();
  }, [voice, beginListening]);

  // Stable ref for endVoiceUtterance so the VAD callback (set up once
  // per startRecording call) always invokes the latest version. Without
  // this, the closure inside startRecording would pin a stale callback.
  const endVoiceUtteranceRef = useRef(endVoiceUtterance);
  useEffect(() => { endVoiceUtteranceRef.current = endVoiceUtterance; }, [endVoiceUtterance]);

  // Holds the `ended` promise from the most recent voice.speak call so
  // the loop can await it from outside runSendForText. Set inside
  // runSendForText, consumed in endVoiceUtterance.
  const speakEndedRef = useRef<Promise<void> | null>(null);

  const toggleVoiceMode = useCallback(async () => {
    if (!isAuthed) {
      setSignUpOpen(true);
      return;
    }
    if (voiceModeActiveRef.current) {
      // Second tap — user wants to close voice mode entirely. Stop
      // recording (drops any in-progress utterance), stop any current
      // TTS playback, deactivate the canvas. Bump the session gen
      // FIRST so any in-flight endVoiceUtterance chain that's about
      // to write a Tony reply sees the gen change at its next stillMine()
      // check and exits silently. Without that bump, the user's
      // dismiss could be "too late" — Tony's reply for the just-spoken
      // utterance would still queue up and play.
      voiceSessionGenRef.current += 1;
      voiceModeActiveRef.current = false;
      setVoiceModeActive(false);
      auroraRef.current?.deactivate();
      voice.stopSpeaking();
      await voice.stopRecording();
      return;
    }
    // SAFARI-CRITICAL ORDERING: get the mic IMMEDIATELY, with as few
    // async hops as possible between the click and the
    // getUserMedia() call. Safari's transient user-activation window
    // is short and easily consumed. Anything that adds an await
    // before getUserMedia risks Safari losing the activation and
    // either (a) refusing the call silently or (b) never showing
    // the permission prompt.
    //
    // The previous structure routed through `void beginListening()`
    // which itself had multiple await boundaries before reaching
    // getUserMedia — that's what caused Safari to "thinking thinking
    // thinking" with no permission prompt and no recording.
    //
    // Now: synchronous setup → kick beginListening directly in this
    // same tick (still uses the existing await chain inside
    // beginListening, but minimizing the gap before getUserMedia).
    // primeAudio happens AFTER mic acquisition so it doesn't compete
    // for the gesture activation.
    voiceSessionGenRef.current += 1;
    voiceModeActiveRef.current = true;
    setVoiceModeActive(true);
    // WAKE-UP ANIMATION — founder feedback was that clicking the
    // mic produced no visible reaction beyond the chrome fading.
    // Fire a sequence of pulses from the orb center so the dots
    // visibly "wake up" + a spark for extra punch. The orb sits
    // at 46% from top (matches the ring's pinned position).
    auroraRef.current?.pulseFromAll(0.9);
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight * 0.46;
    auroraRef.current?.pulse(cx, cy, 0.95);
    auroraRef.current?.spark(cx, cy, 26);
    // A second smaller pulse a beat later so the orb feels alive
    // beyond a single flash.
    window.setTimeout(() => {
      auroraRef.current?.pulse(cx, cy, 0.55);
    }, 320);
    // Fire-and-forget; beginListening surfaces errors directly into
    // the chat thread now (see the result.ok check inside it).
    void beginListening().then(() => {
      // primeAudio AFTER mic is acquired — needed for the TTS reply
      // playback later. It's idempotent and gesture-safe to call
      // from inside an async chain because by this point the AudioContext
      // creation cost is borne and we're just making sure it's running.
      voice.primeAudio();
    });
  }, [voice, isAuthed, beginListening]);

  // One-tap entry into JARVIS (camera + hands) from the composer button.
  // If voice mode isn't open yet, open it first (this same click is the
  // user gesture that lets Safari grant the mic), then turn JARVIS on.
  // If already in voice mode, just flip JARVIS on.
  const enterJarvis = useCallback(async () => {
    if (!isAuthed) {
      setSignUpOpen(true);
      return;
    }
    if (!voiceModeActiveRef.current) {
      await toggleVoiceMode();
    }
    setJarvisActive(true);
  }, [isAuthed, toggleVoiceMode]);

  // Belt-and-braces cleanup: if Aurora unmounts mid-conversation,
  // tear down voice mode so the mic releases and TTS stops. useVoice
  // also has its own unmount cleanup; this just clears the loop flag
  // so any in-flight beginListening() bails on its voiceModeActiveRef
  // check before trying to restart the mic.
  useEffect(() => {
    return () => {
      voiceModeActiveRef.current = false;
    };
  }, []);

  /**
   * Core send logic — takes the text as a parameter so it can be
   * called either from handleSend (user clicked send / hit enter)
   * OR from the post-auth retry effect (user just signed up with
   * a queued message) OR from the VAD onSilence path (hands-free
   * voice). Assumes auth is already established.
   *
   * The optional `voice` flag forces the auto-TTS branch on. Without
   * it we'd fall back to reading `lastInputWasVoice` state — but
   * that's set via setState right before this is called from
   * endVoiceUtterance, which means the closure still sees the old
   * value (state updates are async and don't take effect until the
   * next render). Passing it explicitly avoids the stale-closure
   * race entirely.
   */
  const runSendForText = useCallback(async (text: string, opts?: { voice?: boolean }) => {
    if (!text || loading) return;

    if (!focusMode) setFocusMode(true);

    auroraRef.current?.pulseFromAll(0.7);
    const r = inputRef.current?.getBoundingClientRect();
    if (r) {
      auroraRef.current?.pulse(r.left + r.width / 2, r.top + r.height / 2, 0.7);
      auroraRef.current?.spark(r.left + r.width / 2, r.top + r.height / 2, 10);
    }

    const sentAt = Date.now();
    const userMsg: AuroraMessage = { id: nextId(), role: "user", text, at: sentAt };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");

    const chatHistory: ChatMsg[] = messages.map((m) => ({
      role: m.role === "ai" ? "assistant" : "user",
      content: m.text,
    }));

    // The VAD path passes voice:true to trigger auto-TTS. Typed input
    // never triggers TTS (founder spec: only voice-mode replies are
    // spoken aloud, typed replies stay text-only).
    const wasVoice = opts?.voice ?? false;

    // Aurora uses the "aurora" persona → routes to api/ai/aurora.ts
    // (Tony in life-mode). The tutor brain on basudrus.com is a
    // different endpoint with a completely separate system prompt —
    // see the AIPersona doc in @/shared/types. The aurora endpoint
    // ignores `subject` (life-mode has no subject keying); we still
    // pass profile fields for context grounding.
    const sendOnce = () => send("aurora", text, chatHistory, {
      lang: "auto",
      uni: profile?.uni ?? undefined,
      major: profile?.major ?? undefined,
      year: profile?.year ?? undefined,
    });

    let result = await sendOnce();

    // Defensive recovery: useSupabaseSession may say authed (we got
    // here because isAuthed was true) but the internal session-cache
    // inside useStreamingAI can race — a stale "no session" entry
    // populated pre-sign-in, with the SIGNED_IN cache bust not yet
    // observable. If we hit auth error in that exact state, force a
    // refreshSession (which fires TOKEN_REFRESHED → cache bust) and
    // try one more time. After this, if still auth, it's a real
    // missing session.
    if (!result.ok && result.reason === "auth") {
      try {
        await supabase.auth.refreshSession();
      } catch { /* fall through — retry will reveal real state */ }
      result = await sendOnce();
    }

    if (result.ok) {
      const doneAt = Date.now();
      setMessages((prev) => [...prev, { id: nextId(), role: "ai", text: result.assistant, at: doneAt, ms: doneAt - sentAt }]);
      auroraRef.current?.pulseFromAll(0.45);

      // Auto-TTS: speak Tony's reply when the user used voice input.
      // If speak fails (autoplay blocked, missing API key, network),
      // surface a short hint in the chat so the user understands why
      // they didn't hear anything — better than silent failure.
      //
      // The `ended` promise is stashed on speakEndedRef so the
      // continuous voice-mode loop can wait for it to resolve before
      // re-opening the mic. Without that gate, the mic would open
      // while Tony is still talking and capture his voice as input.
      if (wasVoice && result.assistant.trim() && !jarvisMicMutedRef.current) {
        try {
          const speakRes = await voice.speak(result.assistant);
          if (speakRes.ok) {
            speakEndedRef.current = speakRes.ended ?? null;
          } else {
            speakEndedRef.current = null;
            if (speakRes.error) {
              setMessages((prev) => [
                ...prev,
                { id: nextId(), role: "ai", text: `(voice unavailable: ${speakRes.error})` },
              ]);
            }
          }
        } catch (e) {
          speakEndedRef.current = null;
          const msg = e instanceof Error ? e.message : "playback failed";
          setMessages((prev) => [
            ...prev,
            { id: nextId(), role: "ai", text: `(voice unavailable: ${msg})` },
          ]);
        }
      } else {
        speakEndedRef.current = null;
      }

      // Refresh history sidebar so the new session row shows up.
      window.setTimeout(() => { void history.refresh(); }, 600);
    } else {
      const errMsg = result.reason === "auth"
        ? "Please sign in to chat with Tony."
        : result.reason === "daily_limit"
          ? "Daily limit reached — come back tomorrow or upgrade to Pro."
          : result.reason === "hourly_limit"
            ? "Hourly limit reached — wait a moment and try again."
            : result.reason === "cooldown"
              ? "Slow down for a second — too many messages."
              : result.reason === "network"
                ? "Network issue — check your connection and try again."
                : "Something went wrong. Try again in a moment.";
      setMessages((prev) => [...prev, { id: nextId(), role: "ai", text: errMsg, at: Date.now() }]);
    }
  }, [loading, focusMode, messages, send, profile?.uni, profile?.major, profile?.year, voice, history]);

  // ── Send a message (button / enter) ───────────────────────────────
  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    // Defensive: if useSupabaseSession is still resolving (cookie
    // read in flight), force a refresh + re-check before showing the
    // modal. This catches the case where the user IS authed cross-
    // subdomain but our local state hasn't caught up.
    if (!isAuthed) {
      try {
        const { data } = await supabase.auth.refreshSession();
        if (data?.session) {
          // The auth-state-change listener will update isAuthed on
          // the next render; for THIS turn we know we're good now.
          await runSendForText(text);
          return;
        }
      } catch { /* fall through to modal */ }

      // Still no session after a fresh refresh — they're genuinely
      // anonymous. Stash the message and open the modal.
      setPendingMessage(text);
      setSignUpOpen(true);
      return;
    }

    await runSendForText(text);
  }, [input, loading, isAuthed, runSendForText]);

  // Stable ref to the latest runSendForText so the post-auth retry
  // effect can call it without listing it as a dep (which would
  // cause the effect to re-fire on every render).
  const runSendForTextRef = useRef(runSendForText);
  useEffect(() => {
    runSendForTextRef.current = runSendForText;
  }, [runSendForText]);

  /**
   * Hard-shutdown of every voice-related thing.
   *
   * The user reported "after I dismiss the voice it's supposed to
   * stop working and the mic stopped working and it keeps just
   * going going going even when I click next conversation or
   * something it does not stop." This helper is the single place
   * that flips the kill switch on:
   *   1. The voice-mode loop flag (so the VAD chain bails on its
   *      next stillMine() check)
   *   2. The session generation counter (so any in-flight chain
   *      sees a generation mismatch and exits silently)
   *   3. MediaRecorder stop (releases the browser mic indicator)
   *   4. TTS playback abort (stops Tony mid-sentence)
   *   5. Canvas deactivation (visual exit from voice mode)
   *
   * Safe to call unconditionally — every step no-ops when the
   * relevant resource isn't active. We call it from any navigation
   * away from the current conversation: history click, new chat,
   * unmount.
   */
  const shutdownVoiceMode = useCallback(() => {
    voiceSessionGenRef.current += 1;
    voiceModeActiveRef.current = false;
    setVoiceModeActive(false);
    auroraRef.current?.deactivate();
    try { voice.stopSpeaking(); } catch { /* noop */ }
    void voice.stopRecording().catch(() => { /* noop */ });
  }, [voice]);

  /**
   * Autonomous memory write — fires Tony's after-conversation
   * extraction. Pulls the LAST N messages from the in-memory thread,
   * POSTs them to /api/ai/extract-memory with persona="aurora", and
   * the endpoint Claude-summarizes 0-3 durable facts into the
   * student_memory table for the signed-in user.
   *
   * Next conversation, student-memory.ts loads those facts into the
   * Aurora system prompt → Tony "remembers." This is what gives
   * Tony the "alive" feeling — without it, every chat starts from
   * zero context.
   *
   * Fire-and-forget. The endpoint is rate-limited, deduplicates
   * against existing facts, and returns 200 with extracted=0 if
   * nothing durable surfaced. Failure modes:
   *   - User signed out → no JWT, endpoint 401s, silently dropped
   *   - Anthropic outage → endpoint returns extracted=0, no harm done
   *   - Rate-limited → endpoint returns 429, silently dropped
   *
   * Uses `keepalive: true` so the request survives the page unload
   * path (newChat/loadSession close one conversation context to open
   * another — without keepalive, the browser would cancel the fetch
   * as soon as the React state update fires).
   *
   * Guards against waste: needs at least 2 messages (one full
   * exchange) to be worth extracting from. Empty thread = no-op.
   * Caps at the last 24 messages so even very long conversations
   * stay under the endpoint's 256KB body cap.
   *
   * Tracks the count of messages we've ALREADY extracted from in
   * `extractedFromCountRef` so we don't re-extract the same prefix
   * twice — e.g. user has 4 messages, we extract; user adds 2 more,
   * we extract from the full 6 (Claude will dedupe against existing
   * student_memory rows). Resets on conversation switch.
   */
  const extractedFromCountRef = useRef(0);
  const extractMemoryNow = useCallback(async (msgs: AuroraMessage[]) => {
    if (msgs.length < 2) return;
    // If nothing NEW since the last extract, skip — we don't want
    // to re-fire the same conversation as the page hidden/refocused
    // event cycle ticks.
    if (msgs.length === extractedFromCountRef.current) return;
    extractedFromCountRef.current = msgs.length;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) return;
      const payload = msgs.slice(-24).map((m) => ({
        role: m.role === "ai" ? "assistant" : "user",
        content: m.text,
      }));
      await fetch(apiUrl("/api/ai/extract-memory"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ messages: payload, persona: "aurora" }),
        keepalive: true,
      });
    } catch {
      /* Best-effort memory write. Failure is silent — the user
         never sees this fire either way. */
    }
  }, []);

  // Use a ref to the latest extract function so the effects below
  // don't need to re-bind when extractMemoryNow's identity changes.
  // The messages snapshot inside each call is captured at the
  // moment of firing — so we always extract from the FRESH thread.
  const messagesRef = useRef(messages);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  const extractMemoryNowRef = useRef(extractMemoryNow);
  useEffect(() => { extractMemoryNowRef.current = extractMemoryNow; }, [extractMemoryNow]);

  // Fire memory extraction when the page goes hidden (user switched
  // tabs, locked their device, navigated away in another tab).
  // visibilitychange is the most reliable "user is leaving" signal
  // across desktop + mobile. We also fire on pagehide as a backup
  // for browsers that skip visibilitychange on full navigation.
  useEffect(() => {
    const onHide = () => {
      // Snapshot once via the ref so async getSession + fetch
      // doesn't race a fast state update.
      void extractMemoryNowRef.current(messagesRef.current);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") onHide();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onHide);
    };
  }, []);

  // Fire on component unmount — covers the SPA route-change case
  // (user clicks Judgment, back to home, etc.) where neither
  // visibilitychange nor pagehide fires.
  useEffect(() => {
    return () => {
      void extractMemoryNowRef.current(messagesRef.current);
    };
  }, []);

  // Periodic in-conversation extraction. Fires after every 8 new
  // messages (4 full exchanges) so a long active chat doesn't have
  // to wait until the user navigates away for Tony to start
  // remembering things. The endpoint dedupes against existing
  // student_memory rows so re-firing on overlapping prefixes is
  // wasteful but harmless — Claude returns the same facts, insert
  // skips them. (Cost: one ~200-token Haiku extraction per ~8
  // messages — pennies even in heavy use.)
  useEffect(() => {
    const PERIODIC_EVERY = 8;
    if (messages.length === 0) return;
    if (messages.length - extractedFromCountRef.current < PERIODIC_EVERY) return;
    // Debounce: wait 3s after the latest message before firing —
    // user is probably still typing/talking. If they fire another
    // message in that window, this effect re-runs and the timer resets.
    const t = window.setTimeout(() => {
      void extractMemoryNowRef.current(messagesRef.current);
    }, 3000);
    return () => window.clearTimeout(t);
  }, [messages]);

  // ── Conversation history: resume a session ────────────────────────
  const loadSession = useCallback(async (item: SessionListItem) => {
    // Belt-and-braces: kill any active voice mode BEFORE swapping
    // the conversation context. Otherwise the mic indicator stays
    // up, Tony keeps talking over the new conversation he's not
    // even part of, and the user gets the "going going going" bug.
    shutdownVoiceMode();
    // Fire memory extraction on the OUTGOING conversation BEFORE
    // we wipe messages. Without this, the user could chat for an
    // hour and never have a single fact saved if they then click a
    // history row to switch conversations. Reset the "already
    // extracted from N messages" counter so the loaded history
    // session can extract fresh.
    void extractMemoryNowRef.current(messagesRef.current);
    extractedFromCountRef.current = 0;
    setActiveSessionId(item.id);
    setMessages([]);
    setFocusMode(true);
    auroraRef.current?.pulse(60, 80, 0.5);

    const row = await fetchSessionById(item.id, item.persona);
    if (!row || !row.messages.length) return;
    setMessages(
      row.messages.map((m) => ({
        id: nextId(),
        role: m.role === "assistant" ? "ai" : "user",
        text: typeof m.content === "string" ? m.content : "",
      })),
    );
  }, [shutdownVoiceMode]);

  const newChat = useCallback(() => {
    // Same shutdown reason as loadSession — new chat means
    // current voice session is OVER, full stop. Fire memory
    // extraction on the conversation we're leaving behind.
    shutdownVoiceMode();
    void extractMemoryNowRef.current(messagesRef.current);
    extractedFromCountRef.current = 0;
    setMessages([]);
    setActiveSessionId(null);
    setFocusMode(false);
    auroraRef.current?.pulse(60, 80, 0.6);
    inputRef.current?.focus();
  }, [shutdownVoiceMode]);

  // ⌘A / Ctrl+A toggles voice mode. Esc closes voice mode entirely
  // (now uses the same hard-shutdown as the dismiss button so the
  // mic actually releases — previous behavior only deactivated the
  // canvas which left the mic recording silently).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const inField = document.activeElement === inputRef.current;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a" && !inField) {
        e.preventDefault();
        auroraRef.current?.toggle();
      }
      if (e.key === "Escape") {
        if (voiceModeActiveRef.current) {
          shutdownVoiceMode();
        } else if (auroraRef.current?.state() !== "idle") {
          auroraRef.current?.deactivate();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [shutdownVoiceMode]);

  // ── Computed values for the chrome ────────────────────────────────
  // Lock-screen takeover REMOVED — founder feedback: "We deleted
  // everything before. Can you return the chat and these things."
  // The chat (with all its chrome: chat-bar, history rail, widgets,
  // footer) is the DEFAULT mode again. The @huwprosser arc-reactor
  // ring now only appears INSIDE voice mode, layered with the
  // existing dot orb. lockClock was a separate state that rendered
  // a second HH:MM:SS below the ring — but founder screenshot
  // showed a duplicate-clock bug (the .aurora-stage-clock element
  // already shows time above the ring). lockClock removed; only
  // lockDate stays to render the day-of-week + date string the
  // arc-reactor displays below itself.
  const [lockDate, setLockDate] = useState(() => formatLockDate(new Date()));
  useEffect(() => {
    // Tick the date string while voice mode is open. Cheap (1Hz)
    // and lets the date roll over if a user keeps voice mode open
    // past midnight without burning a setInterval the rest of the
    // time.
    if (!voiceModeActive) return;
    const update = () => setLockDate(formatLockDate(new Date()));
    update();
    const id = window.setInterval(update, 1000);
    return () => window.clearInterval(id);
  }, [voiceModeActive]);

  const isPro = subscription.tier === "pro";
  const quotaCurrent = Number.isFinite(subscription.aiQuota) ? subscription.aiQuota : null;
  const quotaCap = Number.isFinite(subscription.aiCap) ? subscription.aiCap : null;
  const cityLabel = useMemo(() => {
    if (geo.city) return geo.city.toUpperCase();
    if (geo.country) return geo.country.toUpperCase();
    return "BAS UDRUS";
  }, [geo.city, geo.country]);

  // Only show tutor sessions (persona === "omar") — Aurora is Tony-only.
  const tutorSessions = useMemo(
    () => history.sessions.filter((s) => s.persona === "omar"),
    [history.sessions],
  );
  const tutorGrouped = useMemo(() => {
    return {
      today: history.sessionsGrouped.today.filter((s) => s.persona === "omar"),
      yesterday: history.sessionsGrouped.yesterday.filter((s) => s.persona === "omar"),
      lastSeven: history.sessionsGrouped.lastSeven.filter((s) => s.persona === "omar"),
      earlier: history.sessionsGrouped.earlier.filter((s) => s.persona === "omar"),
    };
  }, [history.sessionsGrouped]);

  // Avatar — photo when user has one set, otherwise their initial on
  // the chosen avatar_color (or a default).
  const avatarChar = useMemo(() => {
    const n = profile?.name?.trim();
    if (!n) return "A";
    return n[0].toUpperCase();
  }, [profile?.name]);
  const hasPhoto = profile?.photo_mode === "photo" && !!profile.photo_url;

  return (
    <div className="aurora-app">
      <AuroraCanvas ref={auroraRef} theme={theme} />
      <div className="aurora-vignette" />

      {/* ── @huwprosser JARVIS arc-reactor — appears in VOICE MODE
          only. Layered with the existing dot orb so users get both
          aesthetics at once: the colorful particle field + the
          glowing cyan ring frame with "TONY STARRK" inside.
          When in content mode (artifact showing), the corner-shift
          CSS handles the move to bottom-right corner. */}
      {voiceModeActive && (
        <div className="aurora-lock" aria-hidden="false">
          <div className="aurora-lock-ring">
            <div className="aurora-lock-ring-outer" />
            <div className="aurora-lock-ring-inner" />
            <div className="aurora-lock-ring-ticks" />
            <span className="aurora-lock-ring-label">TONY<br />STARRK</span>
            <div className="aurora-lock-ring-core" />
          </div>
          {/* Date + time block below the ring. The .aurora-stage-clock
              element ALREADY shows HH:MM:SS above the ring — so this
              block shows DATE only to avoid the duplicate-clock bug
              from the founder's screenshot. */}
          <div className="aurora-lock-clock-block">
            <div className="aurora-lock-date">{lockDate}</div>
          </div>
        </div>
      )}

      {/* 3D Jarvis View overlay — full-screen 3D model viewer that
          appears when Tony emits a <<<MODEL:name>>> block. Sits
          ABOVE everything (z-index 50 in jarvis.css) so it takes
          over the screen completely. Dismissed via the overlay's
          Close button or Esc key. Lazy-loaded — R3F+Three=~850KB
          bundle only fetched the moment the user opens a model. */}
      {activeJarvisModel && (
        <Suspense fallback={null}>
          <JarvisView
            modelKey={activeJarvisModel}
            onClose={() => setActiveJarvisModel(null)}
            voiceActive={voiceModeActive}
            voiceStatus={
              voice.isSpeaking ? "speaking"
                : voice.isListening ? "listening"
                : voice.isTranscribing ? "processing"
                : "ready"
            }
            explodeTargetRef={modelExplodeTargetRef}
            handCursorsRef={modelCursorsRef}
            gestureActive={jarvisActive}
          />
        </Suspense>
      )}

      {/* Live-generated 3D viewer — same overlay slot, for MODEL
          names with no built-in. Plays the fabricator sequence while
          Meshy bakes the mesh, then materializes it. */}
      {!activeJarvisModel && activeGeneratedPrompt && (
        <Suspense fallback={null}>
          <GeneratedView
            prompt={activeGeneratedPrompt}
            onClose={() => setActiveGeneratedPrompt(null)}
            voiceActive={voiceModeActive}
            voiceStatus={
              voice.isSpeaking ? "speaking"
                : voice.isListening ? "listening"
                : voice.isTranscribing ? "processing"
                : "ready"
            }
            handCursorsRef={modelCursorsRef}
            gestureActive={jarvisActive}
            onRequestSignIn={() => {
              setActiveGeneratedPrompt(null);
              setSignUpOpen(true);
            }}
          />
        </Suspense>
      )}

      {/* JARVIS CENTER STAGE — voice mode redesign.
          The A4 paper concept is GONE (founder feedback: "delete the
          four paper because I don't find it nice or bring anything").
          The orb stays in the CENTER of the screen and IS the experience.
          Around/under it we render a HUD ring (clock, status, mic
          level), Tony's words as floating glowing typography, and any
          artifact cards (photo, map, stat, data, quote) as a floating
          row beneath the text — all sitting in dark space, no paper
          underneath.

          The full-screen orb canvas stays running BEHIND this stage —
          we don't shrink it to a corner anymore. The stage layer
          floats on top via z-index, all elements positioned absolutely
          so the orb gets to breathe behind the text. */}
      {isPresenting && (
        <div className="aurora-stage" aria-live="polite">
          {/* HUD frame that wraps the orb — sits at the center,
              concentric with the main canvas orb. Pure SVG/CSS,
              no positioning math against the canvas (the canvas
              centers itself on viewport; so does this).
              Contains: clock, status word, mic-level signal bars,
              brand label, dismiss button, radar tick marks. */}
          <div
            ref={jarvisRingRef}
            className={`aurora-stage-ring${voice.isSpeaking ? " is-speaking" : ""}${voice.isListening ? " is-listening" : ""}${voice.isTranscribing ? " is-processing" : ""}`}
          >
            {/* 12-tick radar bezel around the orb. */}
            <div className="aurora-stage-radar" aria-hidden />
            {/* Slow-spinning cyan sweep arc inside the bezel. */}
            <div className="aurora-stage-sweep" aria-hidden />
            {/* Inner thin border ring — visually frames the orb. */}
            <div className="aurora-stage-ring-inner" aria-hidden />
            {/* Mic-level bars — vertical columns flanking the ring
                on BOTH sides for visual symmetry. Both columns are
                driven by the same --mic-level CSS variable (set
                via rAF on the parent ring) so they react in
                perfect sync to whoever is talking. Mirrors the
                "audio waveform spike" feel. */}
            <div className="aurora-stage-bars aurora-stage-bars-left" aria-hidden>
              <i /><i /><i /><i /><i /><i /><i />
            </div>
            <div className="aurora-stage-bars aurora-stage-bars-right" aria-hidden>
              <i /><i /><i /><i /><i /><i /><i />
            </div>
            {/* Echo rings — three concentric rings that scale outward
                on every audio peak. Reads as "the sound is rippling
                away from the orb." Pure CSS-driven by --audio-level,
                no JS needed. The rings live just outside the radar
                bezel so they don't clash with the inner ring border. */}
            <div className="aurora-stage-echo aurora-stage-echo-1" aria-hidden />
            <div className="aurora-stage-echo aurora-stage-echo-2" aria-hidden />
            <div className="aurora-stage-echo aurora-stage-echo-3" aria-hidden />
            {/* Clock above the ring. */}
            <span className="aurora-stage-clock" aria-hidden>{hudClock}</span>
            {/* Status word below the ring. */}
            <span className="aurora-stage-status" aria-hidden>{hudStatus}</span>
            {/* Brand label, mono caps, below status. */}
            <span className="aurora-stage-brand" aria-hidden>TONY · STARRK</span>
          </div>

          {/* BACK TO CHAT button — prominent floating pill, top-left
              of the stage. Closes voice mode entirely and returns
              the user to the conventional chat view (with the
              keyboard / send / history rail). Founder wanted this
              to be CLEARLY labeled and visible — previous "Close"
              X-icon was too cryptic for the moment. */}
          <button
            type="button"
            className="aurora-stage-close"
            onClick={shutdownVoiceMode}
            aria-label="Back to chat"
            title="Back to chat (Esc)"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            <span>Back to chat</span>
          </button>

          {/* JARVIS MODE toggle — top-right twin of Back-to-chat. Turns on
              the camera + hand-gesture holodeck layer. Hidden while the
              layer is up (its own EXIT JARVIS button takes the same spot,
              so there's exactly one control there at a time). */}
          {!jarvisActive && (
            <button
              type="button"
              className="aurora-jarvis-toggle"
              onClick={() => setJarvisActive(true)}
              aria-label="Activate JARVIS camera mode"
              title="JARVIS mode — control Tony with your hands"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M23 7l-7 5 7 5V7z" />
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
              </svg>
              <span>JARVIS MODE</span>
            </button>
          )}

          {/* JARVIS MODE layer — camera feed + holo-tabs + hand cursors.
              Sits at z-index 3, under this stage's chrome (z 4), so the
              ring, Tony's words and both pill buttons stay visible above
              the camera. Unmounting releases the camera + MediaPipe. */}
          {jarvisActive && (
            <Suspense fallback={null}>
              <JarvisMode
                presenting={presenting}
                presentingImage={presentingImage}
                onExit={() => setJarvisActive(false)}
                micMuted={jarvisMicMuted}
                onToggleMic={() => setJarvisMicMuted((m) => !m)}
                modelViewerOpen={!!activeJarvisModel || !!activeGeneratedPrompt}
                onModelExplodeStart={() => {
                  // Capture the current explosion so the pull composes
                  // on top of it (matches the holo-tab resize feel).
                  modelExplodeBaseRef.current = modelExplodeTargetRef.current;
                }}
                onModelExplode={(ratio) => {
                  modelExplodeTargetRef.current = explodeTargetFromRatio(
                    modelExplodeBaseRef.current,
                    ratio,
                  );
                }}
                onModelClose={() => {
                  setActiveJarvisModel(null);
                  setActiveGeneratedPrompt(null);
                }}
                modelCursorsRef={modelCursorsRef}
                onAsk={(text) => {
                  void runSendForText(text);
                }}
                onGenerate3D={(prompt) => {
                  setActiveJarvisModel(null);
                  setActiveGeneratedPrompt(prompt);
                }}
              />
            </Suspense>
          )}

          {/* TONY'S WORDS — floating glowing typography below the
              orb. No paper. No card. Just the words breathing in
              dark space, like JARVIS speaking onscreen. Cyan glow
              ties into the rest of the HUD palette. Auto-fades
              long replies behind a gradient mask so even a paragraph
              feels light. */}
          <div className="aurora-stage-text-wrap">
            {presentingThinking ? (
              <div className="aurora-stage-thinking" aria-live="polite">
                <span className="aurora-stage-thinking-dots">
                  <i /><i /><i />
                </span>
                <span className="aurora-stage-thinking-text">
                  {voice.isTranscribing
                    ? "Listening to you"
                    : "Tony is thinking"}
                </span>
              </div>
            ) : presentingText ? (
              <p className="aurora-stage-text">{renderMarkdown(presentingText)}</p>
            ) : (
              <p className="aurora-stage-text aurora-stage-text-idle">
                Tap the mic and talk — Tony's reply will appear here.
              </p>
            )}
          </div>

          {/* ARTIFACT ROW — floating horizontal lineup of any
              media cards Tony emitted. Photo / map / stat / data
              / quote — only the ones present render, in a flex
              row, equal heights. Empty row when Tony's reply has
              no artifacts (most replies). All cards are semi-
              transparent dark glass — matches the JARVIS
              holographic feel, no white paper backgrounds. */}
          {/* GOOGLE KNOWLEDGE-PANEL style unified InfoCard.
              Founder feedback after the floating-cards design:
              "redesign it in the Google card panel like I would put
              the name of the subject and then details and then when
              it where and when was it depends on the subject."
              ONE card, all the artifacts consolidated inside it:
                - Hero image at top (from SHOW Wikipedia thumb)
                - Subject title (the SHOW query, big serif)
                - Description (Tony's clean text)
                - Quick-facts table (STAT + DATA combined)
                - Map sub-card (if MAP present)
                - Quote callout (if QUOTE present)
              Renders ONLY when at least one visual artifact exists. */}
          {(presentingImage || presentingMap.city || presenting.stat || presenting.data || presenting.quote || presenting.compare) && (
            <div className="aurora-infocard" role="region" aria-label="Knowledge panel">
              {/* Hero image — top, full width. Falls back to a
                  gradient placeholder with subject name if Wikipedia
                  returned no thumbnail (iPhone disambiguation case). */}
              <div className="aurora-infocard-hero">
                {presentingImage ? (
                  <img
                    src={presentingImage}
                    alt={presenting.show?.query ?? ""}
                    loading="eager"
                    className="aurora-infocard-hero-img"
                  />
                ) : (
                  <div className="aurora-infocard-hero-placeholder" aria-hidden>
                    <span className="aurora-infocard-hero-placeholder-mark">
                      {(presenting.show?.query || "TONY STARRK").slice(0, 1).toUpperCase()}
                    </span>
                  </div>
                )}
                {/* Subject title overlaid bottom-left of hero */}
                {presenting.show?.query && (
                  <h2 className="aurora-infocard-title">
                    {presenting.show.query}
                  </h2>
                )}
              </div>

              <div className="aurora-infocard-body">
                {/* Description — first 1-2 sentences from Tony's
                    cleaned reply, pulled into the card so users
                    see the WHAT before the receipts. Synthesized
                    upgrade #1 from the imagined CEO review:
                    Sam's critique was "no description before the
                    stat." Now description leads the body, then
                    stat, then facts. */}
                {presentingText && (
                  <p className="aurora-infocard-description">
                    {renderMarkdown(extractLeadingSentences(presentingText, 2))}
                  </p>
                )}
                {/* Stat row — big headline number, like Google's
                    knowledge panel "key fact" line. Sits AFTER the
                    description now, not before. */}
                {presenting.stat && (
                  <div className="aurora-infocard-stat">
                    <span className="aurora-infocard-stat-label">
                      {presenting.stat.label}
                    </span>
                    <span className="aurora-infocard-stat-big">
                      {presenting.stat.big}
                    </span>
                    {presenting.stat.sub && (
                      <span className="aurora-infocard-stat-sub">
                        {presenting.stat.sub}
                      </span>
                    )}
                  </div>
                )}

                {/* Key-value facts table — DATA rows rendered as the
                    "Quick facts" section of a Google knowledge panel.
                    Sits under the stat / above the map / quote. */}
                {presenting.data && (
                  <div className="aurora-infocard-facts">
                    <div className="aurora-infocard-facts-title">
                      {presenting.data.title}
                    </div>
                    <dl className="aurora-infocard-facts-list">
                      {presenting.data.rows.map((r, i) => (
                        <div className="aurora-infocard-facts-row" key={i}>
                          <dt>{r.key}</dt>
                          <dd>{r.value}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                )}

                {/* Side-by-side comparison table — Google "spec sheet"
                    pattern. Header row with the two contestant labels,
                    then attribute rows with valueA / valueB cells.
                    Renders for any "X vs Y" question Tony lays out.
                    Sits between facts and map so the comparison reads
                    as the answer's "receipts" before the map context. */}
                {presenting.compare && (
                  <div className="aurora-infocard-compare">
                    <div className="aurora-infocard-compare-title">
                      {presenting.compare.title}
                    </div>
                    <table className="aurora-infocard-compare-table">
                      <thead>
                        <tr>
                          <th scope="col" />
                          <th scope="col" className="aurora-infocard-compare-head">
                            {presenting.compare.labelA}
                          </th>
                          <th scope="col" className="aurora-infocard-compare-head">
                            {presenting.compare.labelB}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {presenting.compare.rows.map((r, i) => (
                          <tr key={i}>
                            <th scope="row" className="aurora-infocard-compare-key">
                              {r.key}
                            </th>
                            <td className="aurora-infocard-compare-val">
                              {r.valueA}
                            </td>
                            <td className="aurora-infocard-compare-val">
                              {r.valueB}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Map sub-section — Google-Earth-style fly-in.
                    Two layered images: the "world" view (zoom 2,
                    satellite, no labels) loads first, then the
                    "city" view (zoom 14, satellite-streets) fades
                    in on top with a scale animation. Reads as
                    flying from orbit down to the destination.
                    Zero WebGL = friendly to weak hardware. */}
                {presentingMap.city && (
                  <div className="aurora-infocard-map aurora-fly-in">
                    {/* World layer — starts visible, fades out as
                        the city layer rises in. */}
                    {presentingMap.world && (
                      <img
                        src={presentingMap.world}
                        alt=""
                        loading="eager"
                        className="aurora-infocard-map-img aurora-fly-world"
                        aria-hidden
                      />
                    )}
                    {/* City layer — destination shot. Animates in
                        with scale (so it looks like the camera is
                        descending) and opacity (so it crossfades
                        from the world view). */}
                    <img
                      src={presentingMap.city}
                      alt={presenting.map?.query ?? ""}
                      loading="eager"
                      className="aurora-infocard-map-img aurora-fly-city"
                    />
                    {presenting.map?.query && (
                      <span className="aurora-infocard-map-label">
                        {presenting.map.query}
                      </span>
                    )}
                  </div>
                )}

                {/* Quote — pulled to the side as a callout, like a
                    Google "Did you know" or pull-quote. */}
                {presenting.quote && (
                  <blockquote className="aurora-infocard-quote">
                    <span className="aurora-infocard-quote-text">
                      &ldquo;{presenting.quote.text}&rdquo;
                    </span>
                    {presenting.quote.attribution && (
                      <cite className="aurora-infocard-quote-attr">
                        — {presenting.quote.attribution}
                      </cite>
                    )}
                  </blockquote>
                )}

                {/* Footer — source attribution + "ask more" hint.
                    Synthesized upgrades from the imagined CEO review:
                    Dario flagged "where's the source?" and "every
                    response is a dead-end." Footer addresses both:
                    cites Wikipedia when an image actually loaded
                    (honest about provenance), and invites a
                    follow-up question to keep the conversation
                    breathing forward instead of feeling like a
                    one-shot answer. */}
                <div className="aurora-infocard-footer">
                  {presentingImage && (
                    <span className="aurora-infocard-source">
                      Image via web search
                    </span>
                  )}
                  {presenting.show?.query && (
                    <span className="aurora-infocard-ask-more">
                      Ask Tony anything else about {presenting.show.query}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="aurora-ui">
        {/* TOP LEFT — rail toggle + brand */}
        <div className="aurora-top-left">
          <button
            className="aurora-icon-btn aurora-rail-toggle"
            type="button"
            onClick={() => setRailHidden((v) => !v)}
            title={railHidden ? "Show conversation history" : "Hide conversation history"}
            aria-label="Toggle conversation history"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18M3 12h18M3 18h18" />
            </svg>
          </button>
          <div className="aurora-logo-mark">
            <span className="aurora-ring" />
            <span className="aurora-ring aurora-d" />
            <span className="aurora-pip" />
          </div>
          <div className="aurora-logo-text">
            <b>Aurora AI</b>
            <small>basudrus.com</small>
          </div>
        </div>

        {/* TOP CENTER — meta strip with REAL city */}
        <div className="aurora-top-bar">
          <span>AURORA AI</span>
          <span className="aurora-sep" />
          <span>{cityLabel}</span>
          <span className="aurora-sep" />
          <span>{meta.day}</span>
          <span className="aurora-sep" />
          <span className="aurora-live">LIVE</span>
        </div>

        {/* TOP RIGHT — Pro pill (tier-aware) + settings + avatar */}
        <div className="aurora-top-right">
          {/* Theme cycle — Stark Daylight (gold) → dark void → Frosted
              Silicon (cobalt) → back. The icon previews the NEXT theme:
              moon in light, snowflake in dark, sun in frost. */}
          <button
            className="aurora-icon-btn"
            type="button"
            onClick={() => setTheme(nextTheme)}
            title={`Switch to ${nextTheme === "dark" ? "dark" : nextTheme === "frost" ? "frost (cool blue)" : "light"} theme`}
            aria-label={`Switch to ${nextTheme} theme`}
          >
            {nextTheme === "dark" ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
              </svg>
            ) : nextTheme === "frost" ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2v20M4 6l16 12M20 6L4 18M12 6l-2.5-2.5M12 6l2.5-2.5M12 18l-2.5 2.5M12 18l2.5 2.5M6.4 7.8 3 6.9M6.4 16.2 3 17.1M17.6 7.8 21 6.9M17.6 16.2l3.4.9" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
              </svg>
            )}
          </button>
          {isPro ? (
            <div className="aurora-pro-pill aurora-pro-active" title="Pro tier active">
              <svg className="aurora-star" viewBox="0 0 12 12" fill="none">
                <path d="M6 1.5L7.2 4.4L10.3 4.8L8.0 6.9L8.6 10L6 8.4L3.4 10L4.0 6.9L1.7 4.8L4.8 4.4Z" fill="currentColor" />
              </svg>
              PRO · ∞
            </div>
          ) : (
            <button
              className="aurora-pro-pill"
              title="Upgrade to Pro for unlimited Tony"
              type="button"
              onClick={() => openSettings("subscription")}
            >
              <svg className="aurora-star" viewBox="0 0 12 12" fill="none">
                <path d="M6 1.5L7.2 4.4L10.3 4.8L8.0 6.9L8.6 10L6 8.4L3.4 10L4.0 6.9L1.7 4.8L4.8 4.4Z" fill="currentColor" />
              </svg>
              Upgrade · Pro
            </button>
          )}
          {/* Judgment — opens the two-party verdict feature.
              Authed-only (judgment requires both parties to sign in
              and the API gates on JWT). For anonymous users we let
              the sign-in pill below handle it. */}
          {isAuthed && (
            <button
              className="aurora-icon-btn"
              type="button"
              onClick={() => {
                window.history.pushState(null, "", "/judgment");
                window.dispatchEvent(new PopStateEvent("popstate"));
              }}
              title="Get a verdict — two-party AI judgment"
              aria-label="Open Judgment"
            >
              {/* Gavel icon */}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 4l6 6M11 7l6 6M9 9l6 6M5 21l4-4M3 19l8-8" />
                <path d="M11 17l-4 4" />
              </svg>
            </button>
          )}
          {/* Settings cog — visible when authed. Anonymous users
              don't have settings to manage; we show a Sign-in button
              in the same slot instead. */}
          {isAuthed ? (
            <button
              className="aurora-icon-btn"
              type="button"
              onClick={() => openSettings("account")}
              title="Settings"
              aria-label="Open settings"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.9 2.9l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.9-2.9l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.9-2.9l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.9 2.9l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
              </svg>
            </button>
          ) : null}
          {/* Avatar — only when authed. Anonymous users see a
              compact "Sign in" pill instead that opens the modal. */}
          {!isAuthed ? (
            <button
              type="button"
              onClick={() => setSignUpOpen(true)}
              className="aurora-signin-pill"
              title="Sign up or sign in"
            >
              Sign in
            </button>
          ) : hasPhoto ? (
            <div
              className="aurora-avatar aurora-avatar-photo"
              title={profile?.name ?? "You"}
              onClick={() => openSettings("account")}
              style={{ cursor: "pointer" }}
            >
              <img src={profile!.photo_url!} alt={profile?.name ?? "You"} />
            </div>
          ) : (
            <div
              className="aurora-avatar"
              title={profile?.name ?? "You"}
              onClick={() => openSettings("account")}
              style={profile?.avatar_color
                ? { background: profile.avatar_color, cursor: "pointer" }
                : { cursor: "pointer" }}
            >
              {avatarChar}
            </div>
          )}
        </div>

        {/* IDLE GATEWAY RETICLES — the two flagship modes used to hide
            in small composer buttons while the center stage sat empty.
            On a fresh idle screen, two low-opacity targets invite the
            user straight into voice or JARVIS; they vanish the moment
            conversation starts (or voice mode opens). Shown to
            anonymous visitors too — the mode handlers themselves
            raise the sign-up modal when needed. */}
        {!voiceModeActive && messages.length === 0 && (
          <div className="aurora-gateways">
            <button
              type="button"
              className="aurora-gateway aurora-gateway-jarvis"
              onClick={() => { void enterJarvis(); }}
              title="JARVIS mode — camera + hand gestures"
            >
              <span className="aurora-gateway-ring">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z" />
                  <circle cx="12" cy="13" r="3.5" />
                </svg>
              </span>
              <span className="aurora-gateway-label">JARVIS MODE</span>
              <span className="aurora-gateway-sub">camera + hand gestures</span>
            </button>
            <button
              type="button"
              className="aurora-gateway aurora-gateway-voice"
              onClick={() => { void toggleVoiceMode(); }}
              title="Talk to Tony — voice mode"
            >
              <span className="aurora-gateway-ring aurora-gateway-ring-dashed">
                <span className="aurora-gateway-core" />
              </span>
              <span className="aurora-gateway-label">TALK TO TONY</span>
              <span className="aurora-gateway-sub">voice commander</span>
            </button>
          </div>
        )}

        {/* LEFT RAIL — conversation history. Only authed users see it
            (anonymous visitors have nothing to display + the rail would
            look awkward without data). */}
        {isAuthed && (
        <>
        {/* EDGE SEAM — when the rail is hidden, a thin instrument-panel
            handle stays on the left edge so history is always one click
            away (before this, the only way back was the ☰ in the topbar). */}
        {railHidden && (
          <button
            type="button"
            className="aurora-rail-seam"
            onClick={() => setRailHidden(false)}
            title="Show conversation history"
            aria-label="Show conversation history"
          >
            <span className="aurora-rail-seam-grip" />
          </button>
        )}
        <aside className="aurora-chat-rail">
          <div className="aurora-rail-card">
            <h3>
              <span>Conversations</span>
              <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span className="aurora-count">{tutorSessions.length}</span>
                <button
                  className="aurora-rail-close"
                  type="button"
                  onClick={() => setRailHidden(true)}
                  title="Hide history"
                  aria-label="Hide conversation history"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M15 6l-6 6 6 6" />
                  </svg>
                </button>
              </span>
            </h3>
            <button className="aurora-new-chat" type="button" onClick={newChat}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
              New conversation
            </button>
          </div>
          <div
            className="aurora-rail-card"
            style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, paddingBottom: "8px" }}
          >
            <h3>
              <span>History</span>
              <span className="aurora-count">{history.loading ? "…" : "all"}</span>
            </h3>
            <div className="aurora-history">
              {history.loading && tutorSessions.length === 0 && (
                <div className="aurora-h-divider" style={{ opacity: 0.6 }}>Loading…</div>
              )}
              {!history.loading && tutorSessions.length === 0 && (
                <div className="aurora-h-divider" style={{ textTransform: "none", letterSpacing: 0, padding: "12px 10px" }}>
                  No conversations yet — say hi to Tony to start.
                </div>
              )}
              <HistoryGroup label="Today"     items={tutorGrouped.today}     active={activeSessionId} onPick={loadSession} />
              <HistoryGroup label="Yesterday" items={tutorGrouped.yesterday} active={activeSessionId} onPick={loadSession} />
              <HistoryGroup label="Last 7 days" items={tutorGrouped.lastSeven} active={activeSessionId} onPick={loadSession} />
              <HistoryGroup label="Earlier"   items={tutorGrouped.earlier}   active={activeSessionId} onPick={loadSession} />
            </div>
          </div>
        </aside>
        </>
        )}

        {/* TOP WIDGET SHELF — Quota + Streak (authed only). Anonymous
            visitors see clean chrome; widgets appear after sign-up. */}
        {isAuthed && (
        <section className="aurora-widgets">
          {/* Today's AI quota widget — pulled from useApp().subscription */}
          <div className="aurora-widget aurora-w-quota">
            <div className="aurora-w-label">
              <span style={{ display: "inline-block", width: "6px", height: "6px", borderRadius: "50%", background: "#b8f5d1", marginRight: "4px" }} />
              Today · Tony
            </div>
            <div className="aurora-w-big">
              {isPro ? "∞" : (quotaCurrent ?? 0)}
            </div>
            <div className="aurora-w-sub">
              {isPro ? "Pro tier — unlimited" : `of ${quotaCap ?? 0} left today`}
            </div>
            {!isPro && quotaCap && quotaCap > 0 && (
              <div className="aurora-w-bar">
                <div
                  className="aurora-w-bar-fill"
                  style={{ width: `${Math.max(0, Math.min(100, ((quotaCurrent ?? 0) / quotaCap) * 100))}%` }}
                />
              </div>
            )}
          </div>

          {/* Streak widget — pulled from useStreak */}
          <div className="aurora-widget aurora-w-streak">
            <div className="aurora-w-label">
              <span style={{ display: "inline-block", width: "6px", height: "6px", borderRadius: "50%", background: "#ff8aa6", marginRight: "4px" }} />
              Study streak
            </div>
            <div className="aurora-w-big">
              {streak.loading ? "—" : streak.current}
            </div>
            <div className="aurora-w-sub">
              {streak.current === 1 ? "day" : "days"} · best {streak.longest}
            </div>
            <div className="aurora-w-foot">
              <span style={{ fontSize: "9px", letterSpacing: "0.24em", textTransform: "uppercase", fontFamily: "'Geist Mono', monospace", color: "rgba(255,255,255,0.45)" }}>
                {streak.totalSessions} sessions
              </span>
            </div>
          </div>
        </section>
        )}

        {/* CHAT THREAD */}
        <div className="aurora-chat-thread" ref={threadRef}>
          {messages.map((m) => (
            <div
              key={m.id}
              className={`aurora-msg ${m.role === "user" ? "aurora-user" : "aurora-ai"}`}
            >
              {/* Telemetry meta row — REAL data only: sender, the actual
                  send/arrival time, and (for Tony) the measured round-trip
                  latency. No decorative metrics, ever. */}
              <div className="aurora-who">
                <span className="aurora-who-id">
                  {m.role === "ai" && <span className="aurora-pip-mini" />}
                  {m.role === "ai" ? "TONY" : "YOU"}
                </span>
                {m.at !== undefined && (
                  <span className="aurora-msg-stamp">
                    {formatStamp(m.at)}
                    {m.ms !== undefined && ` · ${(m.ms / 1000).toFixed(1)}s`}
                  </span>
                )}
              </div>
              <div className="aurora-bubble">
                {m.role === "ai" ? renderMarkdown(m.text) : m.text}
              </div>
            </div>
          ))}
          {loading && (
            <div className="aurora-msg aurora-ai">
              <div className="aurora-who">
                <span className="aurora-who-id">
                  <span className="aurora-pip-mini" />
                  TONY
                </span>
                <span className="aurora-msg-stamp">processing</span>
              </div>
              {partial ? (
                <div className="aurora-bubble">{renderMarkdown(partial)}</div>
              ) : (
                <div className="aurora-bubble aurora-typing-bubble">
                  <i /><i /><i />
                </div>
              )}
            </div>
          )}
        </div>

        {/* BOTTOM CHAT BAR */}
        <div className="aurora-chat-bar">
          <div className="aurora-pip-mark">
            <span className="aurora-ring" />
            <span className="aurora-ring aurora-d" />
            <span className="aurora-pip" />
          </div>
          <input
            ref={inputRef}
            className="aurora-chat-input"
            placeholder="Ask Tony anything — your study tutor is listening…"
            autoComplete="off"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleSend();
              }
            }}
            onFocus={() => document.body.classList.add("aurora-typing")}
            onBlur={() => document.body.classList.remove("aurora-typing")}
          />
          <div className="aurora-chat-actions">
            <button
              className="aurora-send-btn"
              title="Send"
              type="button"
              onClick={() => void handleSend()}
              disabled={!input.trim() || loading}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 12l16-8-6 16-2-6-8-2z" />
              </svg>
            </button>
            {/* JARVIS camera button — ALWAYS visible in the composer so the
                hand-gesture mode is discoverable without first digging into
                voice mode. One tap opens voice mode (if needed) + JARVIS. */}
            <button
              className={`aurora-cam-btn${jarvisActive ? " is-active" : ""}`}
              title="JARVIS mode — control Tony with your hands"
              aria-label="Start JARVIS camera mode"
              type="button"
              aria-pressed={jarvisActive}
              onClick={() => { void enterJarvis(); }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 7l-7 5 7 5V7z" />
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
              </svg>
            </button>
            <button
              className={`aurora-mic-btn${voiceModeActive ? " is-listening" : ""}`}
              title={
                !voiceModeActive
                  ? "Tap to start a voice conversation"
                  : voice.isSpeaking
                    ? "Tony is speaking — tap to end"
                    : voice.isListening
                      ? "Listening — keep talking, or tap to end"
                      : "Thinking — tap to end"
              }
              type="button"
              aria-pressed={voiceModeActive}
              onClick={() => { void toggleVoiceMode(); }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="3" width="6" height="12" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0" />
                <path d="M12 18v3" />
              </svg>
            </button>
          </div>
        </div>

        {/* BACK ARROW — voice mode only */}
        <button
          className="aurora-back-btn"
          type="button"
          onClick={() => auroraRef.current?.deactivate()}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          <span>Back</span>
          <span className="aurora-label">ESC</span>
        </button>

        {/* ACTIVE STATUS — voice mode */}
        <div className="aurora-status">
          <span className="aurora-pips">
            <i /><i /><i />
          </span>
          <span>
            {voice.isListening ? "Listening — talk to Tony, pause when you're done" :
              voice.isTranscribing ? "Transcribing…" :
                voice.isSpeaking ? "Tony is speaking…" :
                  voiceModeActive ? "Voice mode — thinking…" :
                    "Voice mode — tap the mic to start"}
          </span>
          <button
            className="aurora-dismiss"
            type="button"
            // shutdownVoiceMode kills EVERYTHING — mic recording, in-
            // flight TTS playback, the voice-mode loop flag, canvas
            // animation. The old onClick only called deactivate(),
            // which animated the canvas back to idle but left the
            // mic recording and Tony still trying to speak — exact
            // bug the founder reported ("Dismiss is supposed to stop
            // everything but it doesn't").
            onClick={shutdownVoiceMode}
          >
            Dismiss
          </button>
        </div>

        {/* FOOTER */}
        <div className="aurora-footer-info">
          <span>{meta.clock}</span>
          <span className="aurora-dot" />
          <span>AURORA AI · basudrus.com</span>
        </div>
      </div>

      {/* Sign-up modal — opens only when an anonymous visitor tries
          to send a message or use the mic. Authed users never see it. */}
      <AuroraSignUpModal
        open={signUpOpen}
        onClose={() => {
          setSignUpOpen(false);
          // Don't clear pendingMessage — user might dismiss the modal
          // by accident; keeping the message means the next send
          // attempt re-prompts with the same text.
        }}
        pendingMessage={pendingMessage ?? undefined}
      />
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────

function HistoryGroup({
  label, items, active, onPick,
}: {
  label: string;
  items: SessionListItem[];
  active: string | null;
  onPick: (s: SessionListItem) => void;
}) {
  if (items.length === 0) return null;
  return (
    <>
      <div className="aurora-h-divider">{label}</div>
      {items.map((s) => (
        <button
          key={s.id}
          className={`aurora-h-item ${active === s.id ? "aurora-h-active" : ""}`}
          type="button"
          onClick={() => onPick(s)}
        >
          <span className="aurora-dotmark" />
          <span className="aurora-h-label">{s.title || s.subject}</span>
          <span className="aurora-h-when">{relativeWhen(s.updated_at || s.created_at)}</span>
        </button>
      ))}
    </>
  );
}

function relativeWhen(iso: string): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const diff = Date.now() - t;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Locale-aware clock for the JARVIS HUD. Updates at 1Hz via
 * setInterval. Founder spec: "make it based on the country not 24
 * hour like 12:00" — defaults to 12-hour AM/PM format for most
 * users worldwide. Uses the browser's locale to pick the natural
 * format for that user (Intl.DateTimeFormat respects regional
 * conventions like 12-hour with AM/PM for US/UK/Jordan or 24-hour
 * for European users who prefer it).
 *
 * Format: "3:42:18 PM" (US/Jordan default) or "15:42:18" (de-DE etc).
 * The 'numeric' hour avoids zero-padding the hour ("3" not "03"),
 * which reads more like a wall clock and less like a server timer.
 */
function formatHudClock(d: Date): string {
  try {
    return d.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      // Force 12-hour for the JARVIS aesthetic — most cinema/TV AI
      // UIs use 12-hour even in 24-hour-default locales because
      // "3:42 PM" reads more human than "15:42:18".
      hour12: true,
    });
  } catch {
    // Fallback to manual format if Intl throws (very old browsers).
    const hh = String(d.getHours() % 12 || 12);
    const mm = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    const ampm = d.getHours() >= 12 ? "PM" : "AM";
    return `${hh}:${mm}:${ss} ${ampm}`;
  }
}

/**
 * Pull the first N sentences out of a longer reply for the
 * InfoCard's description field. Stops at the Nth sentence
 * terminator (. ! ?) or at the end of the text. Caps output at
 * 240 chars as a hard ceiling so we never blow out the card
 * layout with a rambling reply.
 *
 * Synthesized upgrade #1 from the imagined CEO review — Sam
 * Altman flagged "no description before the stat." The Knowledge
 * Panel pattern is photo → title → 1-sentence description, THEN
 * the receipts. We extract that one sentence from Tony's reply
 * so users see the WHAT before the HOW MUCH.
 */
function extractLeadingSentences(text: string, n: number): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  // Match sentence-terminator + trailing whitespace. Greedy enough
  // to handle "..." correctly (counts as one stop, not three).
  const re = /[^.!?]+[.!?]+(?:\s|$)/g;
  const matches = trimmed.match(re);
  if (!matches || matches.length === 0) {
    // No terminator found — return the first 240 chars + ellipsis
    return trimmed.length > 240 ? trimmed.slice(0, 237).trimEnd() + "…" : trimmed;
  }
  const slice = matches.slice(0, n).join("").trim();
  return slice.length > 240 ? slice.slice(0, 237).trimEnd() + "…" : slice;
}

/**
 * Date readout for the JARVIS lock-screen below the clock.
 * "WEDNESDAY · 28 APRIL" style matching the @huwprosser reference.
 */
function formatLockDate(d: Date): string {
  const days = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
  const months = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
  return `${days[d.getDay()]} · ${d.getDate()} ${months[d.getMonth()]}`;
}

function formatMeta(d: Date): { day: string; clock: string } {
  const wkLong = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
  const days = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  // 12-hour clock with AM/PM — matches the JARVIS HUD clock format
  // change (founder request: "make it based on the country not 24
  // hour like 12:00"). The footer caption shows "MON · 3:42 PM"
  // instead of the previous "MON · 15:42".
  let timeStr: string;
  try {
    timeStr = d.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    const hh = d.getHours() % 12 || 12;
    const mm = String(d.getMinutes()).padStart(2, "0");
    const ampm = d.getHours() >= 12 ? "PM" : "AM";
    timeStr = `${hh}:${mm} ${ampm}`;
  }
  return {
    day: `${wkLong[d.getDay()]} · ${d.getDate()} ${months[d.getMonth()]}`,
    clock: `${days[d.getDay()]} · ${timeStr}`,
  };
}
