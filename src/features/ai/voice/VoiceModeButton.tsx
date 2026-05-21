/**
 * VoiceModeButton — push-to-talk mic that captures, transcribes, and
 * hands the resulting text back to the caller.
 *
 * Two interaction modes:
 *   - **Press-and-hold** (default on mouse/touch): hold the button to
 *     record, release to stop + transcribe. Mirrors a walkie-talkie.
 *   - **Tap-toggle**: a single tap starts recording, another tap stops.
 *     We auto-detect by tracking whether the press was held >300ms;
 *     <300ms = toggle, >=300ms = walkie-talkie.
 *
 * On a successful transcription, calls onTranscript(text). The caller
 * decides what to do with it (set it as the composer draft, auto-send,
 * append to draft, etc.). We don't couple to AIScreen.
 *
 * UI states:
 *   - idle:        mic icon
 *   - listening:   red pulsing ring + mic icon
 *   - transcribing: spinner
 *
 * Accessibility: pointer events fall back to keyboard via Space/Enter
 * (browser converts those to click events for <button>, which the
 * onClick path handles in toggle mode).
 */
import { Mic, Loader2, MicOff } from "lucide-react";
import { useRef } from "react";
import type { UseVoiceResult } from "./useVoice";

export interface VoiceModeButtonProps {
  voice: UseVoiceResult;
  /** Called with the transcribed text once Scribe returns. */
  onTranscript: (text: string) => void;
  /** Locale hint for STT. "en"|"ar"; omit for auto-detect. */
  languageCode?: "en" | "ar";
  className?: string;
  /** Visual size — default 11 (44px). The composer typically uses 11,
   *  floating mic UIs use 14 (56px). */
  size?: 10 | 11 | 14 | 16;
}

const SIZE_CLASS: Record<NonNullable<VoiceModeButtonProps["size"]>, string> = {
  10: "h-10 w-10",
  11: "h-11 w-11",
  14: "h-14 w-14",
  16: "h-16 w-16",
};
const ICON_CLASS: Record<NonNullable<VoiceModeButtonProps["size"]>, string> = {
  10: "h-4 w-4",
  11: "h-4.5 w-4.5",
  14: "h-5 w-5",
  16: "h-6 w-6",
};

export function VoiceModeButton({
  voice, onTranscript, languageCode, className, size = 11,
}: VoiceModeButtonProps) {
  // Press timestamp — used to detect tap vs. hold (<300ms = tap).
  const pressedAtRef = useRef<number>(0);
  // True if the current press has already triggered start() — prevents
  // a click event from re-triggering after pointerup.
  const recordingStartedRef = useRef<boolean>(false);

  const isBusy = voice.isTranscribing;
  const isOn = voice.isListening;

  const finishAndTranscribe = async () => {
    const blob = await voice.stopRecording();
    if (!blob) return;
    const result = await voice.transcribe(blob, languageCode);
    if (result.ok && result.transcript) {
      onTranscript(result.transcript);
    }
  };

  const onPointerDown = async (e: React.PointerEvent<HTMLButtonElement>) => {
    if (isBusy) return;
    e.preventDefault();
    pressedAtRef.current = Date.now();
    recordingStartedRef.current = false;
    if (isOn) {
      // Toggle: pointerdown while listening = stop.
      await finishAndTranscribe();
      return;
    }
    const r = await voice.startRecording();
    if (r.ok) recordingStartedRef.current = true;
  };

  const onPointerUp = async () => {
    if (isBusy) return;
    if (!recordingStartedRef.current) return;
    const heldMs = Date.now() - pressedAtRef.current;
    // Held >=300ms → walkie-talkie semantics: release stops.
    // Held <300ms  → tap-toggle: leave recording running until next tap.
    if (heldMs >= 300) {
      await finishAndTranscribe();
    }
    // For taps, do nothing — the next pointerdown will toggle off.
  };

  const onPointerCancel = async () => {
    // Defensive: pointer left the button without a clean up event
    // (drag out of viewport, lost focus). Treat as "stop and transcribe."
    if (isOn && recordingStartedRef.current) {
      await finishAndTranscribe();
    }
  };

  const label = isBusy
    ? "Transcribing"
    : isOn
      ? "Stop recording"
      : "Hold to talk, or tap to start";

  return (
    <button
      type="button"
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onPointerLeave={onPointerCancel}
      aria-label={label}
      title={label}
      aria-pressed={isOn}
      className={
        "relative inline-flex items-center justify-center rounded-full transition-all duration-150 shrink-0 " +
        SIZE_CLASS[size] + " " +
        (isOn
          ? "bg-red-500 text-white scale-105"
          : "bg-surface-2 text-ink-2 hover:bg-surface-3 hover:text-ink-1") +
        " " + (className ?? "")
      }
      disabled={isBusy}
    >
      {/* Pulsing ring while actively listening — purely decorative,
          drives Tony-is-hearing-you affordance. */}
      {isOn && (
        <span className="absolute inset-0 rounded-full bg-red-500/40 animate-ping pointer-events-none" />
      )}
      {isBusy
        ? <Loader2 className={`${ICON_CLASS[size]} animate-spin`} />
        : (isOn
            ? <MicOff className={ICON_CLASS[size]} />
            : <Mic className={ICON_CLASS[size]} />)}
    </button>
  );
}
