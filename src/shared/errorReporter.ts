/**
 * errorReporter — minimal Sentry-equivalent. Logs runtime errors to
 * the Supabase `client_errors` table so they're queryable from the
 * admin console without needing a third-party SaaS.
 *
 * Captures three event sources:
 *   1. window "error" — uncaught exceptions and resource errors
 *   2. window "unhandledrejection" — promise rejections nobody caught
 *   3. ErrorBoundary componentDidCatch (via reportError() public API)
 *
 * Each event is rate-limited per session — at most one report per
 * unique (type + message) tuple per minute, capped at 30 reports
 * total per page load. Stops error storms from logged loops or
 * extension noise from filling the table.
 *
 * RLS: client_errors_insert_own requires user_id = auth.uid(). For
 * unauthenticated visitors the user_id is left null (and the policy
 * still admits the row because the WITH CHECK uses auth.uid() which
 * returns null too — nope, doesn't work, see below).
 *
 * Actually the existing policy is `(auth.uid() = user_id)` which
 * fails when both are null. So pre-auth errors are silently dropped
 * client-side rather than triggering RLS errors that themselves
 * become noise. The browser console still logs them.
 */
import { supabase } from "@/lib/supabase";

const MAX_REPORTS_PER_SESSION = 30;
const DEDUP_WINDOW_MS = 60_000;

let reportCount = 0;
const recentSignatures = new Map<string, number>();

function shouldReport(signature: string): boolean {
  if (reportCount >= MAX_REPORTS_PER_SESSION) return false;
  const lastSeen = recentSignatures.get(signature);
  const now = Date.now();
  if (lastSeen && now - lastSeen < DEDUP_WINDOW_MS) return false;
  recentSignatures.set(signature, now);
  reportCount++;
  return true;
}

interface ReportOptions {
  /** "ErrorBoundary" | "unhandledRejection" | "windowError" | custom string */
  type: string;
  /** Short human-readable headline. */
  message: string;
  /** Component or context the error happened in. */
  context?: string;
  /** Stack trace if available — capped at 2KB to keep rows small. */
  stack?: string;
}

/**
 * Public API — call this from any try/catch where you want the
 * error captured. Safe to call from anywhere; gracefully no-ops if
 * the user isn't authed or Supabase isn't configured.
 */
export async function reportError(opts: ReportOptions): Promise<void> {
  const sig = `${opts.type}:${opts.message}`.slice(0, 200);
  if (!shouldReport(sig)) return;

  // eslint-disable-next-line no-console
  console.error(`[${opts.type}] ${opts.message}`, opts.context ?? "");

  if (!supabase) return;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const user_id = session?.user?.id ?? null;
    // RLS requires auth.uid() = user_id. Pre-auth errors won't insert
    // because neither side has a uuid. We accept that — those errors
    // surface in the console, just not the DB.
    if (!user_id) return;

    const stackTrimmed = opts.stack ? opts.stack.slice(0, 2000) : null;
    const userAgent = typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 200) : null;

    await supabase.from("client_errors").insert({
      user_id,
      error_type: opts.type.slice(0, 60),
      context: opts.context?.slice(0, 200) ?? null,
      message: `${opts.message.slice(0, 500)}${stackTrimmed ? `\n\n${stackTrimmed}` : ""}`,
      user_agent: userAgent,
    });
  } catch {
    // Don't let reporter errors loop into more reports.
  }
}

/**
 * Install global handlers for window-level errors. Call once on
 * app boot (main.tsx). Safe to call multiple times — guarded by
 * an idempotency flag.
 */
let installed = false;
export function installGlobalErrorReporter() {
  if (installed) return;
  installed = true;

  window.addEventListener("error", (ev) => {
    const err = ev.error as Error | undefined;
    void reportError({
      type: "windowError",
      message: err?.message ?? ev.message ?? "Uncaught error",
      stack: err?.stack,
      context: `${ev.filename ?? ""}:${ev.lineno ?? 0}:${ev.colno ?? 0}`,
    });
  });

  window.addEventListener("unhandledrejection", (ev) => {
    const reason = ev.reason as unknown;
    let message = "Unhandled promise rejection";
    let stack: string | undefined;
    if (reason instanceof Error) {
      message = reason.message || message;
      stack = reason.stack;
    } else if (typeof reason === "string") {
      message = reason;
    } else if (reason && typeof reason === "object") {
      message = String((reason as { message?: unknown }).message ?? message);
    }
    void reportError({
      type: "unhandledRejection",
      message,
      stack,
    });
  });
}
