export const config = { runtime: "edge" };

/**
 * /api/ai/match-lookup — privacy-careful "find a student by email"
 * lookup for the Study Match feature.
 *
 * Why this endpoint exists separately from /api/ai/study-match:
 *   Study Match accepts a UUID (id) of the candidate. To LET users
 *   target a specific person they know — a friend, a classmate they
 *   met IRL — we need an email → user_id resolver. The profiles
 *   table no longer carries email (privacy refactor), so this lookup
 *   needs the service-role key to query auth.users. That's a
 *   sensitive operation: an unrestricted endpoint would let anyone
 *   enumerate which emails belong to Bas Udrus users.
 *
 * Anti-enumeration design:
 *   1. Hard rate limit: 10/hr per user. A bot can probe at most 10
 *      emails per hour per account — orders of magnitude too slow
 *      to harvest the user list.
 *   2. Same generic "no eligible match" error for: user-not-found,
 *      user-found-but-profile-incomplete, user-found-but-opted-out.
 *      The endpoint never reveals "this email IS registered" alone.
 *   3. Self-lookup refused.
 *   4. Output identical to the candidate-row shape used by the
 *      Suggested-list query, so the screen UX is uniform.
 *
 * Future hardening:
 *   - `profiles.discoverable_by_email` opt-in column once we have
 *     a Settings toggle for it
 *   - Captcha after N failed lookups in a row
 *   - Slow-equal timing on success vs not-found (the current
 *     implementation has a small timing diff, low priority)
 *
 * Security:
 *   - Auth required (rate limiter checks JWT)
 *   - 512 B body cap
 *   - CORS exact-host match
 *   - Email format validated; max 254 chars per RFC 5321
 */

import {
  ALLOWED_ORIGINS,
  securityHeaders,
  readCappedJson,
  checkRateLimit,
  rateLimitResponse,
  sanitizeLine,
  getUserIdFromToken,
} from "../_lib/ai-guard";

const SUPABASE_URL           = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY      = process.env.SUPABASE_ANON_KEY || "";
const SUPABASE_SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const MAX_BODY_BYTES = 512;
// Intentionally restrictive — see "Anti-enumeration design" above.
const LIMITS = { daily: 30, hourly: 10, minute: 5 };

// Conservative email validator. Doesn't try to be RFC-perfect; just
// catches obvious nonsense before we make an upstream call. Real
// validation happens in Supabase's auth layer anyway.
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,189}\.[^\s@]{1,40}$/;

interface LookupBody {
  email?: unknown;
}

interface CandidateRow {
  id: string;
  name: string;
  uni: string | null;
  major: string | null;
  year: number | null;
  bio: string | null;
  avatar_color: string | null;
  photo_url: string | null;
  photo_mode: "avatar" | "photo" | null;
}

interface LookupResponse {
  ok: boolean;
  /** Present iff the email maps to an eligible candidate. */
  candidate?: CandidateRow;
  /** Always generic on failure (anti-enumeration). */
  error?: string;
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

const GENERIC_NOT_FOUND: LookupResponse = {
  ok: false,
  error: "No eligible student with that email. They might not be on Bas Udrus yet, or they haven't completed their profile.",
};

/** Look up a user by email via the Supabase Admin API. Returns null
 *  on any failure (network, not found, malformed response). */
async function findUserIdByEmail(email: string): Promise<string | null> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return null;
  try {
    // Supabase Auth Admin API: GET /auth/v1/admin/users supports an
    // `email` query param that returns the matching user (one row).
    // If the user doesn't exist, returns an error JSON; we treat
    // that as "not found" without distinguishing the failure mode.
    const res = await fetch(
      `${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
      },
    );
    if (!res.ok) return null;
    const json = await res.json().catch(() => null) as
      | null
      | { id?: string; users?: Array<{ id?: string; email?: string }> }
      | Array<{ id?: string; email?: string }>;
    if (!json) return null;
    // Two known response shapes across Supabase versions:
    //   - { id, email, ... }                       (single user)
    //   - { users: [{ id, email, ... }, ...] }     (paged list)
    //   - [{ id, email, ... }]                     (older versions)
    if (Array.isArray(json)) {
      const hit = json.find((u) => (u.email || "").toLowerCase() === email.toLowerCase());
      return hit?.id ?? null;
    }
    if ("users" in json && Array.isArray(json.users)) {
      const hit = json.users.find((u) => (u.email || "").toLowerCase() === email.toLowerCase());
      return hit?.id ?? null;
    }
    if ("id" in json && typeof json.id === "string") {
      return json.id;
    }
    return null;
  } catch {
    return null;
  }
}

/** Fetch the candidate row for a given user_id via service role. */
async function fetchCandidate(userId: string): Promise<CandidateRow | null> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return null;
  try {
    const url = `${SUPABASE_URL}/rest/v1/profiles?select=id,name,uni,major,year,bio,avatar_color,photo_url,photo_mode&id=eq.${encodeURIComponent(userId)}&limit=1`;
    const res = await fetch(url, {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    });
    if (!res.ok) return null;
    const rows = await res.json() as CandidateRow[];
    return rows?.[0] ?? null;
  } catch {
    return null;
  }
}

export default async function handler(req: Request): Promise<Response> {
  const origin = req.headers.get("origin");
  const sHeaders = securityHeaders(origin, ALLOWED_ORIGINS);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: sHeaders });
  if (req.method !== "POST") return jsonResponse(405, { ok: false, error: "Method not allowed" }, sHeaders);

  if (!SUPABASE_SERVICE_KEY) {
    return jsonResponse(503, { ok: false, error: "Lookup unavailable (server misconfigured)" }, sHeaders);
  }

  const authHeader = req.headers.get("authorization");
  const rl = await checkRateLimit({
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY,
    authHeader,
    endpoint: "ai/match-lookup",
    daily: LIMITS.daily,
    hourly: LIMITS.hourly,
    minute: LIMITS.minute,
  });
  if (!rl.allowed) {
    return rateLimitResponse(rl, sHeaders, {
      cooldown:     "Slow down — please retry in a moment.",
      minute_limit: "Too many email lookups in a minute.",
      hourly_limit: "Hourly email-lookup quota reached. Try search by name instead.",
      daily_limit:  "Daily email-lookup quota reached.",
    });
  }

  // Identify the caller (used for self-lookup refusal).
  const callerId = await getUserIdFromToken(authHeader, SUPABASE_URL, SUPABASE_ANON_KEY);
  if (!callerId) {
    return jsonResponse(401, { ok: false, error: "Please sign in." }, sHeaders);
  }

  const { data: body, error: bodyErr } = await readCappedJson<LookupBody>(req, MAX_BODY_BYTES, sHeaders);
  if (bodyErr) return bodyErr;
  if (!body) return jsonResponse(400, { ok: false, error: "Missing body" }, sHeaders);

  const rawEmail = typeof body.email === "string" ? sanitizeLine(body.email, 254).toLowerCase() : "";
  if (!EMAIL_RE.test(rawEmail)) {
    return jsonResponse(400, { ok: false, error: "Please enter a valid email." }, sHeaders);
  }

  // ── Lookup ────────────────────────────────────────────────────────
  const targetId = await findUserIdByEmail(rawEmail);
  if (!targetId) {
    return jsonResponse(200, GENERIC_NOT_FOUND, sHeaders);
  }

  // Self-lookup gets a specific message — no enumeration concern
  // since the caller is asking about their own email.
  if (targetId === callerId) {
    return jsonResponse(400, { ok: false, error: "That's your own email!" }, sHeaders);
  }

  // Eligibility: candidate must have uni + year filled in. Otherwise
  // a successful match attempt would fail at /api/ai/study-match
  // anyway, so we fold the same check here to give the caller a
  // useful error without wasting an LLM call.
  const candidate = await fetchCandidate(targetId);
  if (!candidate || !candidate.uni || candidate.year === null) {
    // Same generic copy as "user not found" — anti-enumeration.
    return jsonResponse(200, GENERIC_NOT_FOUND, sHeaders);
  }

  return jsonResponse(200, { ok: true, candidate } satisfies LookupResponse, sHeaders);
}
