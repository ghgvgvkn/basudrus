/**
 * aiQuota — daily free-tier message cap for the AI tab.
 *
 * Non-Pro users get `MAX_FREE_MESSAGES_PER_DAY` (currently 10) sends
 * across both Tony Starrk and Sherlock per local calendar day. The
 * count rolls over at local midnight (storage key embeds today's
 * YYYY-MM-DD) so there's no "did the server tick over to a new day
 * yet?" timing window — the next morning, the user gets a fresh 10.
 *
 * Why client-side AsyncStorage and not server enforcement:
 *   - Server enforcement is the right long-term answer (a determined
 *     user can clear app storage to reset). This module is the v1 —
 *     it surfaces the cap to honest users immediately while we wire
 *     up the server-side check separately. Comment on every call site
 *     reflects this so it doesn't get forgotten.
 *   - Mobile already has AsyncStorage primed for the magic-prefill
 *     hand-off, so no new dependencies.
 *
 * Per-user keys (not per-device) — so a user who signs in on two
 * phones doesn't accidentally double their quota by alternating.
 * Anonymous (signed-out) users return count=0 and a no-op increment
 * so the chat keeps working until they sign in; we treat persistence
 * gaps as "best effort" rather than blocking the UI.
 *
 * Why per-user-per-day rather than per-session or lifetime:
 *   - Lifetime is too punishing for trial users.
 *   - Per-session is gameable (close + reopen chat).
 *   - Daily is the standard SaaS pattern, matches what students
 *     intuitively expect from a freemium AI app.
 * If product wants to switch to "10 lifetime then forced upgrade"
 * later, swap `todayKey` for a fixed user-scoped key. The call sites
 * don't need to change.
 *
 * Storage shape:
 *   key   = `ai_quota_v1_<userId>_<YYYY-MM-DD>`
 *   value = decimal integer string ("0", "1", ..., "10", ...)
 * v1 suffix is there so a future schema change (e.g. moving to a
 * JSON object that also tracks Tony vs Sherlock split) can bump to v2
 * without colliding with old keys.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

/** Cap on free-tier messages per local calendar day. Single source of
 *  truth — both the gate in `send()` and the "X of N today" UI read
 *  from this constant. */
export const MAX_FREE_MESSAGES_PER_DAY = 10;

/** Build today's YYYY-MM-DD in the device's local timezone. The user
 *  thinks of "today" in their wall-clock terms, so we don't use UTC. */
function todayString(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function todayKey(userId: string): string {
  return `ai_quota_v1_${userId}_${todayString()}`;
}

/**
 * Read today's count. Returns 0 for any failure mode (missing key,
 * malformed value, AsyncStorage error, signed-out user). Caller can
 * trust the returned number to be a non-negative integer.
 */
export async function getTodayCount(
  userId: string | null | undefined,
): Promise<number> {
  if (!userId) return 0;
  try {
    const raw = await AsyncStorage.getItem(todayKey(userId));
    if (!raw) return 0;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

/**
 * Bump today's count by 1 and return the new value. No-ops to 0 for
 * signed-out users and on storage failure so callers can use the
 * returned number for UI updates without a separate error path.
 *
 * NOTE: this is best-effort persistence — the gate in `send()` should
 * read the latest count via `getTodayCount` before each new turn rather
 * than trusting any in-memory value alone. AsyncStorage on iOS can
 * occasionally race when the app is backgrounded mid-write.
 */
export async function incrementTodayCount(
  userId: string | null | undefined,
): Promise<number> {
  if (!userId) return 0;
  try {
    const current = await getTodayCount(userId);
    const next = current + 1;
    await AsyncStorage.setItem(todayKey(userId), String(next));
    return next;
  } catch {
    return 0;
  }
}

/**
 * True when a non-Pro user has hit (or exceeded) the daily cap. Pro
 * users always return false. Caller still passes `isPro` so this
 * helper stays the only place that knows the rule.
 */
export function isOverFreeQuota(count: number, isPro: boolean): boolean {
  if (isPro) return false;
  return count >= MAX_FREE_MESSAGES_PER_DAY;
}
