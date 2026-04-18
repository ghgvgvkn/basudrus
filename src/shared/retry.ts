// Retry helper for Supabase / fetch calls that hit transient network errors.
//
// Context: production logs show 9+ users per day hitting `TypeError: Load failed`
// on their very first data load (iOS Safari drops connections when the app is
// backgrounded, cold DNS, flaky mobile networks). A single retry with a short
// backoff recovers almost all of these silently — users see no error instead
// of a broken screen.
//
// Usage:
//   const { data, error } = await withRetry(() => supabase.from("profiles").select("*"));

type RetryResult<T> = { data: T | null; error: unknown | null };

// Error messages that indicate a transient network problem worth retrying.
// These are safe to retry because they mean "the request never reached the
// server" or "the server closed the connection" — NOT "the server rejected it".
const TRANSIENT_PATTERNS = [
  /Load failed/i,                                  // iOS Safari generic fetch drop
  /Failed to fetch/i,                              // Chrome / Firefox network error
  /NetworkError/i,                                 // Firefox network error
  /network request failed/i,                       // React Native / misc.
  /upstream request timeout/i,                     // Supabase pooler timeout
  /The network connection was lost/i,              // iOS Safari
  /ECONNRESET|ETIMEDOUT|EAI_AGAIN/i,               // Node-ish errors surfacing
  /AbortError.*Lock (was stolen|broken)/i,         // Supabase auth cross-tab retry
];

function isTransient(err: unknown): boolean {
  if (!err) return false;
  const msg = typeof err === "string"
    ? err
    : err instanceof Error
    ? err.message
    : (err as { message?: string })?.message || JSON.stringify(err).slice(0, 300);
  return TRANSIENT_PATTERNS.some(re => re.test(msg));
}

/**
 * Retry a Supabase-style call once with a short backoff when it fails with a
 * transient network error. Returns the same `{ data, error }` shape Supabase
 * returns, so callers don't need to change any downstream logic.
 *
 * Accepts a PromiseLike (not just Promise) because Supabase PostgrestBuilder
 * objects are thenable — they have `.then` but lack `.catch` / `.finally`.
 *
 * @param fn         The call to run (usually a Supabase query)
 * @param maxRetries How many EXTRA attempts to make (default 1 — so 2 total tries)
 * @param baseDelayMs Backoff base (default 400ms → retries at 400, 800, 1600...)
 */
export async function withRetry<T = unknown>(
  fn: () => PromiseLike<{ data: T | null; error: unknown | null } | RetryResult<T>>,
  maxRetries = 1,
  baseDelayMs = 400,
): Promise<{ data: T | null; error: unknown | null }> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = (await fn()) as { data: T | null; error: unknown | null };
      // Supabase returns error in the object, not thrown — check it too
      if (result.error && attempt < maxRetries && isTransient(result.error)) {
        lastErr = result.error;
        await sleep(baseDelayMs * Math.pow(2, attempt));
        continue;
      }
      return result;
    } catch (e) {
      lastErr = e;
      if (attempt >= maxRetries || !isTransient(e)) {
        return { data: null, error: e };
      }
      await sleep(baseDelayMs * Math.pow(2, attempt));
    }
  }
  return { data: null, error: lastErr };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
