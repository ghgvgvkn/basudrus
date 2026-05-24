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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { AuroraSignUpModal } from "./AuroraSignUpModal";
import { useGeoCity } from "./useGeoCity";
import "./aurora.css";

type AuroraMessage = {
  id: string;
  role: "user" | "ai";
  text: string;
};

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
  /** True when the user used the mic for their LAST message — drives
   *  auto-TTS playback of Tony's reply. Reset every time they type. */
  const [lastInputWasVoice, setLastInputWasVoice] = useState(false);
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

  // The text Tony is currently speaking — pulled from the most
  // recent AI message in the thread. The paper renders this so the
  // user sees what Tony's saying as written-on-paper.
  const presentingText = useMemo(() => {
    if (!isPresenting) return "";
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === "ai" && m.text.trim()) return m.text;
    }
    return "";
  }, [isPresenting, messages]);

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
    auroraRef.current?.activate();
    // startRecording wraps navigator.mediaDevices.getUserMedia. If
    // Safari has denied mic permission for this site, this returns
    // { ok: false, error: "Microphone permission denied" }. Surface
    // it visibly in the chat — the previous behavior was to set
    // voice.error state and not show it anywhere, so users hit
    // "tap mic, nothing happens" with no clue why.
    const result = await voice.startRecording({
      handsFree: {
        silenceMs: 1400,
        onSilence: () => { void endVoiceUtteranceRef.current(); },
        onLevel: (rms) => { micLevelRef.current = rms; },
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
    const result = await voice.transcribe(blob);
    if (!stillMine()) return;
    if (!result.ok) {
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: "ai",
          text: `(transcription failed: ${result.error ?? "unknown error"})`,
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
      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: "ai", text: "(didn't catch your voice — try speaking up)" },
      ]);
      if (stillMine()) void beginListening();
      return;
    }
    // Successful transcript — reset the empty-streak counter so the
    // next stretch of silence starts fresh.
    emptyStreakRef.current = 0;
    // Send the transcript to Tony. runSendForText calls voice.speak
    // internally because voice:true is set; it stores the SpeakResult
    // on speakEndedRef so we can await `ended` here for the loop.
    await runSendForTextRef.current(cleaned, { voice: true });
    if (!stillMine()) {
      // User dismissed while Anthropic was streaming. The auto-TTS
      // started inside runSendForText — kill it so they don't hear
      // a reply they explicitly cancelled.
      voice.stopSpeaking();
      return;
    }
    // Wait for Tony's voice to finish before re-opening the mic. If
    // speak failed or returned no ended promise, we still continue —
    // the loop should never get stuck. While Tony speaks, run a
    // barge-in listener: if the user starts talking over him, stop
    // his audio immediately and let the loop fall through to begin
    // a new listening turn.
    const ended = speakEndedRef.current;
    speakEndedRef.current = null;
    let bargeIn: { stop: () => void } | null = null;
    if (ended) {
      bargeIn = await voice.startBargeInListener({
        onDetected: () => {
          // Tony is interrupted — stop his audio. The ended promise
          // resolves (via the speak() pause path), the await below
          // unblocks, and we fall through to beginListening which
          // captures the user's next utterance.
          voice.stopSpeaking();
        },
      });
      try { await ended; } catch { /* noop */ }
    }
    bargeIn?.stop();
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

    const userMsg: AuroraMessage = { id: nextId(), role: "user", text };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");

    const chatHistory: ChatMsg[] = messages.map((m) => ({
      role: m.role === "ai" ? "assistant" : "user",
      content: m.text,
    }));

    // Prefer the explicit param over the (possibly stale) state. The
    // VAD path passes voice:true; typed input falls through to the
    // state value as before.
    const wasVoice = opts?.voice ?? lastInputWasVoice;
    setLastInputWasVoice(false);

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
      setMessages((prev) => [...prev, { id: nextId(), role: "ai", text: result.assistant }]);
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
      if (wasVoice && result.assistant.trim()) {
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
      setMessages((prev) => [...prev, { id: nextId(), role: "ai", text: errMsg }]);
    }
  }, [loading, focusMode, messages, send, profile?.uni, profile?.major, profile?.year, lastInputWasVoice, voice, history]);

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

  // ── Conversation history: resume a session ────────────────────────
  const loadSession = useCallback(async (item: SessionListItem) => {
    // Belt-and-braces: kill any active voice mode BEFORE swapping
    // the conversation context. Otherwise the mic indicator stays
    // up, Tony keeps talking over the new conversation he's not
    // even part of, and the user gets the "going going going" bug.
    shutdownVoiceMode();
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
    // current voice session is OVER, full stop.
    shutdownVoiceMode();
    setMessages([]);
    setActiveSessionId(null);
    setFocusMode(false);
    auroraRef.current?.pulse(60, 80, 0.6);
    inputRef.current?.focus();
  }, [shutdownVoiceMode]);

  // ⌘A / Ctrl+A toggles voice mode
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const inField = document.activeElement === inputRef.current;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a" && !inField) {
        e.preventDefault();
        auroraRef.current?.toggle();
      }
      if (e.key === "Escape" && auroraRef.current?.state() !== "idle") {
        auroraRef.current?.deactivate();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // ── Computed values for the chrome ────────────────────────────────
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
      <AuroraCanvas ref={auroraRef} />
      <div className="aurora-vignette" />

      {/* Presentation panel — JARVIS-style HUD overlay. Slides in
          from the right while Tony is speaking, showing what he's
          saying as readable text. Closes when audio stops. The
          canvas itself slides left (via the body.aurora-presenting-left
          class) to make visual room. Reserved for future: a
          mirror-image panel on the LEFT when Tony shows 3D/map
          content (body.aurora-presenting-right). */}
      {isPresenting && (
        <>
          <div className={`aurora-present-panel aurora-present-${presentingSide}`}>
            <div className="aurora-present-header">
              <div className="aurora-present-dot" />
              <span className="aurora-present-label">
                TONY · {voice.isSpeaking
                  ? "SPEAKING"
                  : voice.isListening
                    ? "LISTENING"
                    : "ACTIVE"}
              </span>
              {/* Dismiss button — closes voice mode and the panel.
                  Uses shutdownVoiceMode (already used by Dismiss
                  button in voice-mode UI + on navigation) so the
                  cleanup is consistent: mic released, TTS stopped,
                  canvas reset. */}
              <button
                type="button"
                className="aurora-present-close"
                onClick={shutdownVoiceMode}
                aria-label="Close voice mode"
                title="Close voice mode"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="aurora-present-body">
              {presentingText || (
                <span style={{ color: "rgba(0,0,0,0.45)", fontStyle: "italic" }}>
                  Tap the mic and start talking — Tony will write his replies here.
                </span>
              )}
            </div>
          </div>
          {/* JARVIS-style glowing ring around the shrunken orb. Pure
              decoration — sits at the orb's final position so the
              dot-matrix animates inside a halo of cyan light, the
              way the JARVIS indicator in the reference photos has
              that iconic glowing circle. The ring's pulse syncs
              with voice.isSpeaking so it visibly reacts when Tony
              is talking. */}
          <div
            className={`aurora-jarvis-ring aurora-jarvis-${presentingSide}${voice.isSpeaking ? " is-speaking" : ""}`}
            aria-hidden
          >
            <span className="aurora-jarvis-text">TONY</span>
          </div>
        </>
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

        {/* LEFT RAIL — conversation history. Only authed users see it
            (anonymous visitors have nothing to display + the rail would
            look awkward without data). */}
        {isAuthed && (
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
              <div className="aurora-who">
                {m.role === "ai" && <span className="aurora-pip-mini" />}
                {m.role === "ai" ? "TONY" : "YOU"}
              </div>
              <div className="aurora-bubble">{m.text}</div>
            </div>
          ))}
          {loading && (
            <div className="aurora-msg aurora-ai">
              <div className="aurora-who">
                <span className="aurora-pip-mini" />
                TONY
              </div>
              {partial ? (
                <div className="aurora-bubble">{partial}</div>
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
            onChange={(e) => {
              setInput(e.target.value);
              // Typing — clear the voice flag so Tony doesn't auto-speak
              // the next reply unless the user mics again.
              if (lastInputWasVoice) setLastInputWasVoice(false);
            }}
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

function formatMeta(d: Date): { day: string; clock: string } {
  const wkLong = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
  const days = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return {
    day: `${wkLong[d.getDay()]} · ${d.getDate()} ${months[d.getMonth()]}`,
    clock: `${days[d.getDay()]} · ${hh}:${mm}`,
  };
}
