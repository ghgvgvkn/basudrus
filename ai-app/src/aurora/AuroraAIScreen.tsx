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
import { findLatestActiveSubject } from "@/features/ai/tutorSession";
import { useStreak } from "@/features/ai/useStreak";
import { useSupabaseSession } from "@/features/auth/useSupabaseSession";
import { supabase } from "@/lib/supabase";
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

  /**
   * Resumed subject — keeps Tony's memory shared between Aurora and
   * basudrus.com. tutor_sessions are keyed by (user_id, subject), so
   * if Aurora always sent "general" we'd silo from whatever subject
   * the user was working on at basudrus.com. Instead we look up their
   * most recent active subject (within 24h) and pass that. Falls back
   * to "general" for first-time users or users whose last activity is
   * stale. Note: student_memory (long-term durable facts like the
   * user's name, university, year, persistent preferences) is loaded
   * server-side regardless of subject — those are ALREADY shared
   * across both surfaces. This fix specifically reconciles the
   * short-term per-subject session memory.
   */
  const [resumedSubject, setResumedSubject] = useState<string>("general");
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    void findLatestActiveSubject(user.id).then((subj) => {
      if (cancelled || !subj) return;
      setResumedSubject(subj);
    });
    return () => { cancelled = true; };
  }, [user?.id]);

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

  /** Wraps the post-utterance flow so it can be invoked from the VAD
   *  callback. Uses runSendForTextRef so the closure stays fresh, and
   *  passes voice:true explicitly so runSendForText doesn't have to
   *  read the (always-stale at this point) lastInputWasVoice state.
   *
   *  Surfaces transcribe failures inline as a chat message. Without
   *  this, a 400 from /api/ai/voice/transcribe (unsupported audio
   *  type, empty audio, etc.) would silently bail and the user would
   *  see "nothing happened" with no clue why. */
  const endVoiceUtterance = useCallback(async () => {
    const blob = await voice.stopRecording();
    auroraRef.current?.deactivate();
    if (!blob) {
      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: "ai", text: "(couldn't capture audio — try again)" },
      ]);
      return;
    }
    const result = await voice.transcribe(blob);
    if (!result.ok) {
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: "ai",
          text: `(transcription failed: ${result.error ?? "unknown error"})`,
        },
      ]);
      return;
    }
    if (!result.transcript.trim()) {
      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: "ai", text: "(didn't catch that — try speaking again)" },
      ]);
      return;
    }
    // Skip the composer hop — go straight to send so the conversation
    // flows like a real voice call. voice:true forces auto-TTS in
    // runSendForText regardless of state.
    void runSendForTextRef.current(result.transcript.trim(), { voice: true });
  }, [voice]);

  /** Cancel an in-progress voice utterance without transcribing. */
  const cancelVoiceMode = useCallback(async () => {
    auroraRef.current?.deactivate();
    await voice.stopRecording();
  }, [voice]);

  const toggleVoiceMode = useCallback(async () => {
    if (!isAuthed) {
      setSignUpOpen(true);
      return;
    }
    if (voice.isListening) {
      // Second tap while already recording — user wants to cancel.
      await cancelVoiceMode();
      return;
    }
    // CRITICAL: prime the audio pipeline NOW, inside the click handler's
    // synchronous gesture stack. The TTS reply arrives 5–8 seconds later
    // (record → silence → STT → Anthropic stream → TTS fetch), well
    // past the autoplay-policy gesture window. Without this prime call,
    // audio.play() throws NotAllowedError and Tony stays silent. Calling
    // it before any async work guarantees the gesture is still fresh.
    voice.primeAudio();
    auroraRef.current?.activate();
    await voice.startRecording({
      handsFree: {
        silenceMs: 1400,
        onSilence: () => { void endVoiceUtterance(); },
        onLevel: (rms) => { micLevelRef.current = rms; },
      },
    });
  }, [voice, isAuthed, endVoiceUtterance, cancelVoiceMode]);

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

    const sendOnce = () => send("omar", text, chatHistory, {
      lang: "auto",
      // Use the user's most recently active subject so Aurora resumes
      // the same tutor_session memory as basudrus.com (set by the
      // findLatestActiveSubject effect above). Falls back to "general"
      // for first-time users.
      subject: resumedSubject,
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
      if (wasVoice && result.assistant.trim()) {
        void voice
          .speak(result.assistant)
          .then((r) => {
            if (!r.ok && r.error) {
              setMessages((prev) => [
                ...prev,
                { id: nextId(), role: "ai", text: `(voice unavailable: ${r.error})` },
              ]);
            }
          })
          .catch((e) => {
            const msg = e instanceof Error ? e.message : "playback failed";
            setMessages((prev) => [
              ...prev,
              { id: nextId(), role: "ai", text: `(voice unavailable: ${msg})` },
            ]);
          });
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
  }, [loading, focusMode, messages, send, profile?.uni, profile?.major, profile?.year, lastInputWasVoice, voice, history, resumedSubject]);

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

  // ── Conversation history: resume a session ────────────────────────
  const loadSession = useCallback(async (item: SessionListItem) => {
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
  }, []);

  const newChat = useCallback(() => {
    setMessages([]);
    setActiveSessionId(null);
    setFocusMode(false);
    auroraRef.current?.pulse(60, 80, 0.6);
    inputRef.current?.focus();
  }, []);

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
              className={`aurora-mic-btn${voice.isListening ? " is-listening" : ""}`}
              title={voice.isListening ? "Listening — tap to cancel" : "Tap to talk"}
              type="button"
              aria-pressed={voice.isListening}
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
            {voice.isListening ? "Listening — release to send" :
              voice.isTranscribing ? "Transcribing…" :
                voice.isSpeaking ? "Tony is speaking…" :
                  "Voice mode — hold the mic to speak"}
          </span>
          <button
            className="aurora-dismiss"
            type="button"
            onClick={() => auroraRef.current?.deactivate()}
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
