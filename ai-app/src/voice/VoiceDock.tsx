/**
 * VoiceDock — ai-app's floating voice control panel.
 *
 * Why a floating dock instead of inline AIScreen controls?
 *   AIScreen is 2,000+ LOC of shared code rendered by both basudrus.com
 *   and ai-app. Splicing voice UI directly into it (per-message speak
 *   buttons, mic in the composer toolbar) is desirable long-term but
 *   risks introducing bugs in the main site's chat. The floating dock
 *   gives us a working voice loop TODAY without touching AIScreen, and
 *   keeps voice opt-in (a small mic affordance at bottom-right, easy
 *   to ignore for text-only users).
 *
 * Voice loop:
 *   1. User taps the dock toggle (bottom-right mic) → panel expands.
 *   2. User holds the big mic → captures audio via MediaRecorder.
 *   3. User releases → audio uploads to /api/ai/voice/transcribe.
 *   4. Transcript appears in the panel + is written into aiPrefill on
 *      AppContext, which AIScreen consumes to populate the draft.
 *   5. User reviews the text (corrects STT mistakes if needed) and
 *      hits Send in the existing composer.
 *   6. Tony's text reply renders normally; the panel exposes a
 *      "Speak Tony's last reply" affordance — user taps to hear it.
 *
 * "Auto-speak" + "per-message 🔊 buttons" are intentionally NOT in
 * this version — they require AIScreen integration which is a
 * follow-up. The plumbing (useVoice + endpoints + components) is in
 * place to support them; the dock can be replaced/augmented later
 * without changing the server side.
 *
 * Lives at ai-app/src/voice/ rather than shared src/ because the
 * floating dock UX is AI-app specific. The reusable bits (hook +
 * SpeakButton + VoiceModeButton) live in shared src/features/ai/voice/.
 */
import { useState } from "react";
import { useVoice } from "@/features/ai/voice/useVoice";
import { VoiceModeButton } from "@/features/ai/voice/VoiceModeButton";
import { SpeakButton } from "@/features/ai/voice/SpeakButton";
import { useApp } from "@/context/AppContext";
import { useLocale } from "@/context/LocaleContext";
import { X, AudioLines } from "lucide-react";

export function VoiceDock() {
  const voice = useVoice();
  const { setAIPrefill } = useApp();
  const { lang } = useLocale();
  const [open, setOpen] = useState(false);
  // Last successful transcript — surfaced in the panel so the user
  // can see what Tony "heard" them say. Cleared when they send a
  // new utterance.
  const [lastTranscript, setLastTranscript] = useState<string>("");
  // Free-form test text — proves the TTS path works end-to-end
  // before wiring it into the chat thread. Hidden behind a small
  // disclosure to keep the panel uncluttered for normal use.
  const [testText, setTestText] = useState("");
  const [showTest, setShowTest] = useState(false);

  const handleTranscript = (text: string) => {
    setLastTranscript(text);
    // Write into aiPrefill — AIScreen's existing useEffect picks it up
    // and populates the composer draft. User reviews + hits Send.
    setAIPrefill(text);
  };

  return (
    <>
      {/* Toggle button — always visible bottom-right above the safe
          area. Pulsing dot when the dock is actively listening or
          speaking, even while collapsed. */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open voice mode"
          title="Open voice mode"
          className="fixed bottom-4 end-4 z-40 h-12 w-12 rounded-full bg-ink-1 text-surface-1 shadow-lg flex items-center justify-center hover:scale-105 transition"
        >
          {(voice.isSpeaking || voice.isListening) && (
            <span className="absolute inset-0 rounded-full bg-accent/60 animate-ping pointer-events-none" />
          )}
          <AudioLines className="h-5 w-5 relative" />
        </button>
      )}

      {open && (
        <div
          className="fixed bottom-4 end-4 z-40 w-[340px] max-w-[calc(100vw-2rem)] bg-surface-1 border border-line/60 rounded-2xl shadow-2xl p-4 space-y-3"
          dir={lang === "ar" ? "rtl" : "ltr"}
        >
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="h-7 w-7 grid place-items-center rounded-lg bg-accent/10 text-accent">
                <AudioLines className="h-4 w-4" />
              </span>
              <span className="text-sm font-semibold text-ink-1">Voice mode</span>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close voice mode"
              className="h-7 w-7 grid place-items-center rounded-full text-ink-3 hover:text-ink-1 hover:bg-surface-2/60"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Primary control: push-to-talk mic. Auto-detect hold-vs-tap. */}
          <div className="flex items-center gap-3">
            <VoiceModeButton
              voice={voice}
              onTranscript={handleTranscript}
              languageCode={lang === "ar" ? "ar" : "en"}
              size={14}
            />
            <div className="flex-1 min-w-0 text-xs leading-relaxed">
              {voice.isListening ? (
                <span className="text-red-600 dark:text-red-400 font-medium">
                  Listening — release to send
                </span>
              ) : voice.isTranscribing ? (
                <span className="text-ink-2">Transcribing…</span>
              ) : voice.isSpeaking ? (
                <span className="text-accent">Tony is speaking…</span>
              ) : (
                <span className="text-ink-3">
                  Hold to talk, or tap to start.
                  <br />
                  Your words land in the composer — review &amp; send.
                </span>
              )}
            </div>
          </div>

          {/* Last transcript echo — gives the user confidence that
              STT worked AND warns them to look at the composer
              before hitting Send. */}
          {lastTranscript && (
            <div className="rounded-xl bg-surface-2/60 border border-line/40 p-2.5 text-[12px] leading-relaxed text-ink-2">
              <div className="text-[10px] uppercase tracking-wider font-semibold text-ink-3 mb-1">
                You said
              </div>
              <div className="break-words">{lastTranscript}</div>
            </div>
          )}

          {/* Error surface — clean text, no toast required. */}
          {voice.error && (
            <div className="text-[12px] text-red-700 dark:text-red-300">
              {voice.error}
            </div>
          )}

          {/* Test-speak disclosure: proves TTS works without going
              through the chat thread. Useful for the founder smoke
              test, hidden by default so the panel stays minimal. */}
          <div className="pt-1 border-t border-line/40">
            <button
              type="button"
              onClick={() => setShowTest((v) => !v)}
              className="text-[11px] text-ink-3 hover:text-ink-1"
            >
              {showTest ? "Hide test speaker" : "Test speaker…"}
            </button>
            {showTest && (
              <div className="mt-2 space-y-2">
                <textarea
                  value={testText}
                  onChange={(e) => setTestText(e.target.value)}
                  placeholder="Type anything — tap the speaker to hear it."
                  rows={2}
                  className="w-full px-2.5 py-2 rounded-lg border border-line/60 bg-surface-2/40 text-[12px] focus:outline-none focus:ring-2 focus:ring-accent/30"
                />
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-ink-3">Voice: Adam</span>
                  <SpeakButton text={testText} voice={voice} />
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
