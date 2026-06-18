/**
 * /api/account/delete — REAL account deletion (GDPR right-to-erasure).
 *
 * Why this exists: the client can only DELETE its own RLS-visible rows, and
 * (a) those deletes silently "succeed" when RLS blocks them, and (b) the
 * client can NEVER remove the `auth.users` row (no admin key in the browser).
 * So "Delete my account" used to falsely confirm while leaving the auth
 * identity — and possibly data — behind.
 *
 * This endpoint fixes both: it verifies the caller's JWT, then uses the
 * SERVICE ROLE (bypasses RLS) to wipe every table the user owns and finally
 * deletes the auth user via the Admin API. It only ever deletes the CALLER's
 * own account — the user id comes from their verified token, never from input.
 */
export const config = { runtime: "edge" };

import { ALLOWED_ORIGINS, securityHeaders } from "../_lib/ai-guard";

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

// Tables the user owns. `profiles` is keyed on `id`; everything else on
// `user_id`. Best-effort: a missing table just reports as "failed" and we
// continue — the load-bearing step is deleting the auth.users row.
const TABLES_BY_ID = ["profiles"];
const TABLES_BY_USER_ID = [
  "student_memory", "tutor_sessions", "tutor_progress", "tutor_streaks",
  "tutor_saved_messages", "wellbeing_sessions", "mh_screen_results", "ai_usage",
  "chat_history", "match_quiz", "study_plans", "user_study_plans",
  "subject_history", "help_requests", "user_integrations",
  // client_errors.user_id is an ON DELETE NO ACTION foreign key to auth.users:
  // if any of the user's rows survive, the final auth.users admin-delete is
  // REJECTED with a FK violation, leaving a half-deleted account (data gone,
  // login orphaned). `events` has no FK at all, so its rows would orphan with
  // the user's id attached. Both must be wiped here for a complete, working
  // erasure. (Every other user-owned table CASCADEs or SET NULLs on auth
  // delete; these two are the only ones that need an explicit purge.)
  "client_errors", "events",
];

/** Verify the caller's bearer token → their own user id (or null). */
async function getCallerId(authHeader: string | null): Promise<string | null> {
  if (!authHeader || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: authHeader },
    });
    if (!res.ok) return null;
    const d = (await res.json()) as { id?: string };
    return d?.id ?? null;
  } catch {
    return null;
  }
}

/** Service-role delete of a user's rows from one table. */
async function svcDelete(table: string, col: string, userId: string): Promise<boolean> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/${table}?${col}=eq.${encodeURIComponent(userId)}`,
      {
        method: "DELETE",
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          Prefer: "return=minimal",
        },
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}

export default async function handler(req: Request) {
  const origin = req.headers.get("origin");
  const sHeaders = securityHeaders(origin, ALLOWED_ORIGINS);
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...sHeaders, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: sHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return json(503, { error: "Account deletion is temporarily unavailable. Please contact support." });
  }

  const userId = await getCallerId(req.headers.get("authorization"));
  if (!userId) return json(401, { error: "Please sign in again to delete your account." });

  // 1. Wipe owned rows (service role → actually deletes, even RLS-locked rows).
  const failed: string[] = [];
  for (const t of TABLES_BY_ID) if (!(await svcDelete(t, "id", userId))) failed.push(t);
  for (const t of TABLES_BY_USER_ID) if (!(await svcDelete(t, "user_id", userId))) failed.push(t);
  // Surface partial row-delete failures for support follow-up (no PII beyond the
  // user id, which is not a secret). A non-cascading table that fails here can
  // block the auth.users delete below.
  if (failed.length) console.warn(`[account/delete] row-delete failed for: ${failed.join(", ")} (user ${userId})`);

  // 2. Delete the auth.users row — the step the browser cannot do.
  let authDeleted = false;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
      method: "DELETE",
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    authDeleted = res.ok;
  } catch {
    authDeleted = false;
  }

  if (!authDeleted) {
    return json(500, {
      error: "We couldn't fully delete your account. Please contact support and we'll finish it.",
      partial: true,
    });
  }
  return json(200, { ok: true });
}
