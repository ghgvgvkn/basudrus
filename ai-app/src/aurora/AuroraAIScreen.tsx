/**
 * AuroraAIScreen — the new ai.basudrus.com main screen.
 *
 * Aurora is the PRODUCT name on this site. The AI persona INSIDE the
 * chat is still Tony Starrk (the system prompt in api/ai/tutor.ts is
 * untouched). End users see Aurora branding + chrome; when they
 * actually chat, Tony introduces himself as Tony.
 *
 * What's wired to the real backend:
 *   - Chat send/stream → useStreamingAI (persona = "omar" = Tony)
 *     Hits /api/ai/tutor with SSE streaming. Same code path Bas
 *     Udrus's AIScreen uses on basudrus.com. Zero backend changes.
 *   - Voice input → useVoice (push-to-talk via the mic button)
 *     Hits /api/ai/voice/transcribe (ElevenLabs Scribe). Transcript
 *     auto-fills the composer; user reviews + sends.
 *   - User profile → useApp() (avatar initial + display name)
 *
 * What's deferred from this V1 (TODO comments mark the spots):
 *   - Widget shelf (top-right) — replace with study-relevant widgets
 *     (today's quota, next exam, streak) in a follow-up
 *   - Conversation history rail (left side) — needs useAIHistory wiring
 *   - Sherlock persona toggle — Aurora is Tony-only for V1
 *   - Mode toggle (Explain/Quiz/Solve/Plan)
 *   - File uploads (drag-drop, PDF, image)
 *   - Quota chip + streak chip in top-right
 *
 * The shared AIScreen (used by basudrus.com) is NOT modified.
 * basudrus.com stays exactly as it is today.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/context/AppContext";
import { useStreamingAI, type ChatMsg } from "@/features/ai/useStreamingAI";
import { useVoice } from "@/features/ai/voice/useVoice";
import { SettingsButton } from "@ai/settings/SettingsButton";
import { AuroraCanvas } from "./AuroraCanvas";
import type { AuroraHandle } from "./AuroraCanvas";
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
  const { profile } = useApp();
  const { send, loading, partial } = useStreamingAI();
  const voice = useVoice();
  const auroraRef = useRef<AuroraHandle>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [messages, setMessages] = useState<AuroraMessage[]>([]);
  const [input, setInput] = useState("");
  const [focusMode, setFocusMode] = useState(false);
  // Meta strip values — recomputed every 30s via tickClock.
  const [meta, setMeta] = useState<{ day: string; clock: string }>(() => formatMeta(new Date()));

  // ── Live clock for the top meta strip + footer ────────────────────
  useEffect(() => {
    const tick = () => setMeta(formatMeta(new Date()));
    const id = setInterval(tick, 30 * 1000);
    return () => clearInterval(id);
  }, []);

  // ── Body class management ─────────────────────────────────────────
  // aurora-focus-mode: applied after the first send — shrinks/dims field
  // aurora-typing: applied while the composer is focused — calms dots
  // aurora-active: managed by AuroraEngine itself
  useEffect(() => {
    if (focusMode) document.body.classList.add("aurora-focus-mode");
    else document.body.classList.remove("aurora-focus-mode");
    return () => {
      document.body.classList.remove("aurora-focus-mode");
    };
  }, [focusMode]);

  // Auto-scroll thread to bottom on new content
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, partial]);

  // ── Mic button: hold-to-talk via existing useVoice hook ───────────
  // On press: start mic + activate Aurora orb visually.
  // On release: stop mic, transcribe via /api/ai/voice/transcribe,
  // populate the input. User reviews + sends.
  const startMic = useCallback(async () => {
    auroraRef.current?.activate();
    await voice.startRecording();
  }, [voice]);

  const stopMicAndTranscribe = useCallback(async () => {
    auroraRef.current?.deactivate();
    const blob = await voice.stopRecording();
    if (!blob) return;
    const result = await voice.transcribe(blob);
    if (result.ok && result.transcript) {
      setInput((prev) => (prev ? `${prev} ${result.transcript}` : result.transcript));
      inputRef.current?.focus();
    }
  }, [voice]);

  // ── Send a message ────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    // Enter focus mode after first send — shrinks/dims the field
    // so the chat thread takes center stage.
    if (!focusMode) setFocusMode(true);

    // Ripple effect: waves from all four edges + a local burst at the
    // chat bar. Sells the "AI is reaching for the answer" moment.
    auroraRef.current?.pulseFromAll(0.7);
    const r = inputRef.current?.getBoundingClientRect();
    if (r) {
      auroraRef.current?.pulse(r.left + r.width / 2, r.top + r.height / 2, 0.7);
      auroraRef.current?.spark(r.left + r.width / 2, r.top + r.height / 2, 10);
    }

    // Optimistically render the user message
    const userMsg: AuroraMessage = { id: nextId(), role: "user", text };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");

    // Build history for useStreamingAI in its ChatMsg shape
    const history: ChatMsg[] = messages.map((m) => ({
      role: m.role === "ai" ? "assistant" : "user",
      content: m.text,
    }));

    const result = await send("omar", text, history, {
      lang: "auto",
      subject: "general",
      uni: profile?.uni ?? undefined,
      major: profile?.major ?? undefined,
      year: profile?.year ?? undefined,
    });

    if (result.ok) {
      setMessages((prev) => [...prev, { id: nextId(), role: "ai", text: result.assistant }]);
      // AI reply landing — ripple inward from every direction
      auroraRef.current?.pulseFromAll(0.45);
    } else {
      // Render an error as a system-ish AI message so the user sees
      // what happened without UI noise.
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
  }, [input, loading, focusMode, messages, send, profile?.uni, profile?.major, profile?.year]);

  // ⌘A / Ctrl+A toggles voice mode (matches design's keyboard shortcut)
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

  // Avatar initial from profile name
  const avatarChar = useMemo(() => {
    const n = profile?.name?.trim();
    if (!n) return "A";
    return n[0].toUpperCase();
  }, [profile?.name]);

  return (
    <div className="aurora-app">
      <AuroraCanvas ref={auroraRef} />
      <div className="aurora-vignette" />

      <div className="aurora-ui">
        {/* TOP LEFT — brand */}
        <div className="aurora-top-left">
          <div className="aurora-logo-mark">
            <span className="aurora-ring" />
            <span className="aurora-ring aurora-d" />
            <span className="aurora-pip" />
          </div>
          <div className="aurora-logo-text">
            <b>Aurora</b>
            <small>BAS UDRUS · TONY STARRK</small>
          </div>
        </div>

        {/* TOP CENTER — meta strip */}
        <div className="aurora-top-bar">
          <span>BAS UDRUS</span>
          <span className="aurora-sep" />
          <span>{meta.day}</span>
          <span className="aurora-sep" />
          <span className="aurora-live">LIVE</span>
        </div>

        {/* TOP RIGHT — Pro pill + settings + avatar */}
        <div className="aurora-top-right">
          <button className="aurora-pro-pill" title="Upgrade to Pro" type="button">
            <svg className="aurora-star" viewBox="0 0 12 12" fill="none">
              <path d="M6 1.5L7.2 4.4L10.3 4.8L8.0 6.9L8.6 10L6 8.4L3.4 10L4.0 6.9L1.7 4.8L4.8 4.4Z" fill="currentColor" />
            </svg>
            Upgrade · Pro
          </button>
          {/* The settings button lazy-loads the SettingsModal already
              mounted in App.tsx. Visually adapted with Aurora styling via
              CSS override below — but the underlying component is
              unchanged so all 8 sections work as before. */}
          <div className="aurora-settings-slot">
            <SettingsButton />
          </div>
          <div className="aurora-avatar" title={profile?.name ?? "You"}>
            {avatarChar}
          </div>
        </div>

        {/* CHAT THREAD — only visible after focus mode kicks in */}
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
                <div className="aurora-msg aurora-ai aurora-typing" style={{ display: "contents" }}>
                  <div className="aurora-bubble">
                    <i />
                    <i />
                    <i />
                  </div>
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
            <button
              className="aurora-mic-btn"
              title={voice.isListening ? "Release to send your voice" : "Hold to talk"}
              type="button"
              // Push-to-talk: hold for STT, release to transcribe.
              // Also handles touch/pointer for mobile + desktop.
              onPointerDown={(e) => {
                e.preventDefault();
                void startMic();
              }}
              onPointerUp={() => {
                if (voice.isListening) void stopMicAndTranscribe();
              }}
              onPointerLeave={() => {
                if (voice.isListening) void stopMicAndTranscribe();
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="3" width="6" height="12" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0" />
                <path d="M12 18v3" />
              </svg>
            </button>
          </div>
        </div>

        {/* BACK ARROW — visible only in voice mode */}
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

        {/* ACTIVE STATUS — visible in voice mode */}
        <div className="aurora-status">
          <span className="aurora-pips">
            <i />
            <i />
            <i />
          </span>
          <span>
            {voice.isListening ? "Listening — release to send" :
              voice.isTranscribing ? "Transcribing…" :
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
          <span>AURORA · BAS UDRUS</span>
        </div>
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────

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
