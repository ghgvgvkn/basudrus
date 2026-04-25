/**
 * PhotoGateModal — singleton modal mounted in Shell. Shown by
 * usePhotoGuard.requirePhoto when the user tries to post / create a
 * room without a profile photo. Clicking the CTA closes the modal
 * and routes the user to Profile (edit mode).
 */
import { Camera, X } from "lucide-react";
import { useApp } from "@/context/AppContext";
import { closePhotoGate, usePhotoGateState } from "./usePhotoGuard";

export function PhotoGateModal() {
  const { setScreen } = useApp();
  const { open, reason } = usePhotoGateState();
  if (!open) return null;

  const goToProfile = () => {
    closePhotoGate();
    setScreen("profile");
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Upload your profile photo"
      className="fixed inset-0 z-[70] flex items-center justify-center px-4 animate-[fadeIn_120ms_ease-out]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) closePhotoGate(); }}
    >
      <div className="absolute inset-0 bg-ink-1/45 backdrop-blur-sm" aria-hidden />
      <div className="relative w-full max-w-[440px] bg-surface-1 rounded-[28px] border border-line shadow-xl overflow-hidden">
        <button
          onClick={closePhotoGate}
          aria-label="Close"
          className="absolute end-4 top-4 h-9 w-9 rounded-full grid place-items-center text-ink-3 hover:bg-surface-2 z-10"
        ><X className="h-4 w-4" /></button>

        <div className="px-7 pt-9 pb-2 text-center">
          <div className="mx-auto h-16 w-16 rounded-full bg-accent-soft text-accent grid place-items-center mb-5">
            <Camera className="h-7 w-7" />
          </div>
          <h2 className="serif text-2xl text-ink-1 mb-2" style={{ fontStyle: "italic" }}>
            Add your photo first
          </h2>
          <p className="text-ink-3 text-sm leading-relaxed">
            {reason ?? "Please upload your profile photo first so other students can recognize you."}
          </p>
        </div>

        <div className="flex items-center gap-2 px-6 pb-6 pt-5">
          <button
            onClick={closePhotoGate}
            className="h-11 px-4 rounded-full text-sm font-medium text-ink-2 hover:bg-surface-2"
          >Not now</button>
          <button
            onClick={goToProfile}
            className="flex-1 h-11 rounded-full bg-accent text-white text-sm font-semibold hover:bg-accent/90 inline-flex items-center justify-center gap-2"
          >
            <Camera className="h-4 w-4" />
            Upload photo
          </button>
        </div>
      </div>
    </div>
  );
}
