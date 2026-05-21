/**
 * SpeakButton — small 🔊 control that reads any text aloud.
 *
 * Shared component (lives in src/features/ai/voice/) so any screen can
 * drop it next to an AI-generated string and let the user hear it.
 * Today ai-app uses it inline next to assistant messages.
 *
 * Behavior:
 *   - Idle: speaker icon, click to start.
 *   - Playing: pulsing icon + stop affordance (click again to abort).
 *   - Error: surfaces inline via title (keeps the UI quiet — the main
 *     useVoice() error state covers loud surfacing).
 *
 * The hook is created by the caller (so multiple speak buttons share
 * one playback queue — clicking a second one stops the first). If
 * you pass `voice={undefined}`, the button is hidden — handy for
 * conditionally rendering only on the AI-app surface without an
 * outer guard.
 */
import { Loader2, Square, Volume2 } from "lucide-react";
import { useState } from "react";
import type { UseVoiceResult } from "./useVoice";

export interface SpeakButtonProps {
  /** The text to read aloud when clicked. */
  text: string;
  /** Shared voice hook from useVoice(). Passing undefined hides the button. */
  voice: UseVoiceResult | undefined;
  /** Optional voice ID override (e.g. a per-persona voice). */
  voiceId?: string;
  /** Optional className passthrough for layout tweaks. */
  className?: string;
  /** Optional accessible label. Defaults to "Read aloud". */
  ariaLabel?: string;
}

export function SpeakButton({ text, voice, voiceId, className, ariaLabel }: SpeakButtonProps) {
  // Local "is THIS button the one that's playing" flag — useful when
  // multiple speak buttons share one hook (clicking a different one
  // shouldn't make us look active).
  const [localActive, setLocalActive] = useState(false);

  if (!voice) return null;
  const trimmed = text?.trim();
  if (!trimmed) return null;

  const isThisPlaying = voice.isSpeaking && localActive;

  const handle = async () => {
    if (isThisPlaying) {
      voice.stopSpeaking();
      setLocalActive(false);
      return;
    }
    setLocalActive(true);
    const out = await voice.speak(trimmed, voiceId ? { voiceId } : undefined);
    if (!out.ok) {
      setLocalActive(false);
      return;
    }
    // When playback finishes, drop the active flag so the icon
    // returns to the idle state.
    out.ended?.finally(() => setLocalActive(false));
  };

  return (
    <button
      type="button"
      onClick={handle}
      aria-label={ariaLabel ?? (isThisPlaying ? "Stop reading" : "Read aloud")}
      title={isThisPlaying ? "Stop" : "Read aloud"}
      className={
        "inline-flex items-center justify-center h-7 w-7 rounded-full text-ink-3 hover:text-ink-1 hover:bg-surface-2/60 transition disabled:opacity-50 " +
        (className ?? "")
      }
      disabled={voice.isSpeaking && !isThisPlaying}
    >
      {isThisPlaying
        ? <Square className="h-3.5 w-3.5 fill-current" />
        : (voice.isSpeaking
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
            : <Volume2 className="h-3.5 w-3.5" />)}
    </button>
  );
}
