/**
 * Haptics — thin wrapper so screens don't import expo-haptics
 * directly. Centralizing here means we can add a global "haptics off"
 * preference later without grepping the codebase.
 *
 * Use:
 *   import { tap, success, warn } from '@/lib/haptics';
 *   onPress={() => { tap(); doThing(); }}
 *
 * On iOS these map to the Taptic Engine (real hardware feel).
 * On Android they're software vibration patterns (less crisp).
 */
import * as Haptics from 'expo-haptics';

/** Lightest possible bump — for list-row taps, tab presses. */
export function tap(): void {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

/** Medium thump — for confirming a meaningful action (send, save). */
export function thump(): void {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}

/** Sharp tick — for selection changes (segmented controls, pickers). */
export function select(): void {
  Haptics.selectionAsync().catch(() => {});
}

/** Success pattern — for completed actions (signed in, sent OK). */
export function success(): void {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

/** Warning pattern — for soft errors the user should notice. */
export function warn(): void {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
}

/** Error pattern — for failures (auth rejected, network died). */
export function error(): void {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
}
