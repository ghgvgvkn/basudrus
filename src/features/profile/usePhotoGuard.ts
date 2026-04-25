/**
 * usePhotoGuard — block actions until the user uploads a profile photo.
 *
 * Surface for any feature that needs an identifiable user: posting a
 * help request, creating a room, sending the first message, etc.
 *
 * `requirePhoto(action)` calls `action()` immediately if the user
 * has a real photo; otherwise it pops a modal asking them to upload
 * one and returns false. The modal is mounted once at the Shell
 * level via `<PhotoGateModal />` and listens to the same store.
 */
import { useCallback, useSyncExternalStore } from "react";
import { useRealProfile } from "./useRealProfile";

interface GateState {
  open: boolean;
  reason: string | null;
}

const listeners = new Set<() => void>();
let state: GateState = { open: false, reason: null };

function setState(next: Partial<GateState>) {
  state = { ...state, ...next };
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function getSnapshot(): GateState { return state; }

/** Hook for any place that needs to gate an action on profile photo. */
export function usePhotoGuard() {
  const { profile } = useRealProfile();
  const hasPhoto = profile?.photo_mode === "photo" && !!profile?.photo_url;

  const requirePhoto = useCallback(
    (action: () => void, reason?: string): boolean => {
      if (hasPhoto) {
        action();
        return true;
      }
      setState({
        open: true,
        reason: reason ?? "Please upload your profile photo first so other students can recognize you.",
      });
      return false;
    },
    [hasPhoto],
  );

  return { hasPhoto, requirePhoto };
}

/** Subscribe to the modal-visibility store. Used by the modal component. */
export function usePhotoGateState() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Imperative dismiss — called from the modal's close button. */
export function closePhotoGate() {
  setState({ open: false });
}

/** Imperatively open from anywhere (e.g. Sidebar's "Post for help"). */
export function openPhotoGate(reason?: string) {
  setState({
    open: true,
    reason: reason ?? "Please upload your profile photo first so other students can recognize you.",
  });
}
