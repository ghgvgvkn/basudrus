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
 *
 * Grandfather clause:
 *   The photo-required policy was introduced on 2026-04-29. Users who
 *   signed up BEFORE this date keep their existing posting privileges
 *   even without a photo — we don't want to retroactively lock out
 *   the ~324 existing users who never uploaded one. New signups
 *   (created_at >= cutoff) DO need a photo before they can post a
 *   help request, create a room, etc.
 *   The cutoff is one-way: once it's deployed in production we never
 *   move it backward, because that would re-block users who have come
 *   to expect they can post.
 */
import { useCallback, useSyncExternalStore } from "react";
import { useRealProfile } from "./useRealProfile";

/** Profiles whose `created_at` is BEFORE this ISO timestamp are
 *  grandfathered — they can post without a photo. Everyone created
 *  on or after this point must upload a photo first. */
const PHOTO_REQUIRED_AFTER = "2026-04-29T00:00:00Z";

/** True when the profile pre-dates the photo-required policy.
 *  Defaults to TRUE on missing/unparseable timestamps — we never
 *  want a data hiccup to silently lock someone out. */
function isGrandfathered(createdAt: string | null | undefined): boolean {
  if (!createdAt) return true;
  const t = Date.parse(createdAt);
  if (!Number.isFinite(t)) return true;
  return t < Date.parse(PHOTO_REQUIRED_AFTER);
}

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
  // Grandfather check — pre-cutoff profiles bypass the gate.
  const grandfathered = isGrandfathered(profile?.created_at);

  const requirePhoto = useCallback(
    (action: () => void, reason?: string): boolean => {
      // Real photo always wins.
      if (hasPhoto) {
        action();
        return true;
      }
      // Existing users who signed up before the policy change keep
      // posting privileges — same UX as before for them.
      if (grandfathered) {
        action();
        return true;
      }
      // Fresh signup with no photo → gate.
      setState({
        open: true,
        reason: reason ?? "Please upload your profile photo first so other students can recognize you.",
      });
      return false;
    },
    [hasPhoto, grandfathered],
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
