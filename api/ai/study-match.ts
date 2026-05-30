export const config = { runtime: "edge" };

/**
 * /api/ai/study-match — AI-to-AI study partner compatibility verdict.
 *
 * The flagship "two Tonys talking" feature. Caller authenticates with
 * their JWT and passes `{ candidateUserId }`. Server:
 *
 *   1. Loads BOTH students' profiles + top student_memory rows
 *      (using the service-role key so it can read the candidate's
 *      data — see "Privacy" below for why that's the right call).
 *   2. Filters / sanitizes the memories to remove anything that
 *      reads as personal-life rather than academic / study-style.
 *   3. Builds a single prompt that frames the situation as Tony-A
 *      (representing student A) meeting Tony-B (representing
 *      student B) for a study-partner compatibility evaluation.
 *   4. Calls Claude Haiku 4.5 with a strict JSON output schema:
 *        { score: 0..100, summary, strengths[], concerns[], suggested_plan }
 *   5. Returns the verdict to the caller. The candidate is NOT
 *      notified at this step — the caller decides whether to send
 *      a connect request based on the verdict (existing Connect flow).
 *
 * Privacy:
 *   The service-role read of the candidate's data is intentional.
 *   The PURPOSE of an AI-to-AI matchmaker is that the AI can reason
 *   over private data on both sides WITHOUT exposing raw memory to
 *   either user. The verdict that comes back contains only
 *   sanitized, study-focused reasoning — no quoted memories, no
 *   personal facts. The prompt explicitly instructs the model to
 *   stay academic.
 *
 *   Future hardening (post-MVP):
 *     - `profiles.study_match_opt_in` column (default true once we
 *       have the user-facing toggle in Settings)
 *     - Per-memory "matchable=false" flag the user can set
 *     - PII detection on memory contents before they enter the prompt
 *
 * Cost:
 *   Claude Haiku 4.5 at ~$0.20 / 1M input tokens, ~$0.80 / 1M output.
 *   Typical prompt: ~2.5 KB input + ~400 tokens output ≈ $0.0008 per
 *   match. Even at heavy use (200 matches/day per user), that's
 *   pennies. Cheap enough to NOT premium-gate today; future:
 *   tighter rate limit + Pro unlimited.
 *
 * Security:
 *   - Auth required (rate limiter checks JWT, fail-closed).
 *   - 1 KB body cap (just one UUID + maybe a hint flag).
 *   - Per-user rate limit: 5/min, 25/hr, 100/day. Each call is an
 *     LLM run, so the minute cap matters most.
 *   - CORS exact-host match.
 *   - Validates the candidate UUID format before any DB lookup.
 *   - Refuses self-match (candidateUserId == caller's id).
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

const ANTHROPIC_API_KEY      = process.env.ANTHROPIC_API_KEY || "";
const SUPABASE_URL           = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY      = process.env.SUPABASE_ANON_KEY || "";
const SUPABASE_SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const MAX_BODY_BYTES = 1024;
const LIMITS = { daily: 100, hourly: 25, minute: 5 };

// UUID regex — basic v4-ish check. Defensive against the candidateId
// being something weird that we don't want to interpolate into a
// PostgREST URL.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `profiles.year` is stored as TEXT in the database (legacy decision —
 * the column was added before we knew students might want to enter
 * "Year 2" or "Foundation Year" alongside plain numerics). The Profile
 * type in TypeScript declares `year: number | null` but the actual
 * row payload arrives as a string. This parser bridges that gap so
 * the eligibility check ("does this student have a year set?") works
 * regardless of how the user entered it.
 *
 * Handles:
 *   - 3                  → 3        (already a number)
 *   - "3"                → 3        (numeric string)
 *   - "Year 2"           → 2        (text with embedded number)
 *   - "2nd"              → 2
 *   - ""                 → null     (genuinely empty)
 *   - null / undefined   → null
 *   - "Foundation"       → null     (no extractable number)
 *
 * Returns null for years that fall outside 1..11 so a typo like
 * "Year 99" doesn't pass eligibility.
 */
function parseYearText(val: unknown): number | null {
  if (typeof val === "number" && Number.isFinite(val) && val >= 1 && val <= 11) {
    return val;
  }
  if (typeof val !== "string") return null;
  const m = val.match(/\d+/);
  if (!m) return null;
  const n = parseInt(m[0], 10);
  if (!Number.isFinite(n) || n < 1 || n > 11) return null;
  return n;
}

// Memory categories we DO include in the AI-to-AI prompt. Anything
// outside this list is filtered out as too personal for matchmaking.
// "uncategorized" is included because most legacy memories don't have
// a category yet — the prompt also has a soft instruction to skip
// non-academic content.
const MATCHABLE_MEMORY_CATEGORIES = new Set([
  "academic",
  "study",
  "preferences",
  "schedule",
  "goals",
  "uncategorized",
  "",
  null as unknown as string,
]);

interface MatchBody {
  candidateUserId?: unknown;
}

interface StudentProfile {
  id: string;
  name: string;
  uni: string | null;
  major: string | null;
  year: number | null;
  bio: string | null;
  /** subjects = the user's list of courses they're taking / interested in.
   *  Stored on profiles as a string[] (text array) — primary signal for
   *  whether two students share academic context. */
  subjects: string[] | null;
  personality: Record<string, string> | null;
}

interface StudentMemoryRow {
  fact: string;
  category: string | null;
  importance: number | null;
}

interface MatchVerdict {
  ok: boolean;
  /** 0..100 compatibility score. 0 = poor match, 100 = exceptional. */
  score?: number;
  /** One-sentence headline the user reads first. */
  summary?: string;
  /** Specific things that would make this match work. */
  strengths?: string[];
  /** Specific things that might make this match awkward. */
  concerns?: string[];
  /** Concrete suggestion if they choose to study together. */
  suggested_plan?: string;
  /** UX label the client maps to a color treatment. */
  verdict?: "excellent" | "good" | "fair" | "poor";
  /** Short staged dialogue between Tony-A (caller's tutor) and Tony-B
   *  (candidate's tutor). 4-6 alternating messages, each 1-2 sentences,
   *  referencing specific academic details about the two students.
   *  This is presentation theater that lets the user SEE the AIs
   *  "talking" — under the hood it's still one LLM call producing the
   *  full transcript at once, but UX-wise it animates in like real
   *  back-and-forth. Same single-call cost as before. */
  dialogue?: Array<{ speaker: "tony_a" | "tony_b"; text: string }>;
  error?: string;
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

/** Fetch a profile row by user id using the service-role key.
 *  Service role bypasses RLS — necessary here because the caller
 *  doesn't have direct SELECT permission on a stranger's profile
 *  in our policies, but the AI-to-AI matchmaker needs to read both
 *  to function. Output never returns the row to the caller —
 *  only the AI's sanitized verdict. */
async function fetchProfileServiceRole(userId: string): Promise<Omit<StudentProfile, "personality"> | null> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return null;
  try {
    // Personality answers live in a SEPARATE table (`match_quiz`) so
    // they're not selected here — see fetchPersonalityServiceRole.
    const url = `${SUPABASE_URL}/rest/v1/profiles?select=id,name,uni,major,year,bio,subjects&id=eq.${encodeURIComponent(userId)}&limit=1`;
    const res = await fetch(url, {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    });
    if (!res.ok) return null;
    const rows = await res.json() as Array<{
      id: string;
      name?: string | null;
      uni?: string | null;
      major?: string | null;
      // DB stores year as text — parser below normalizes to number|null.
      year?: unknown;
      bio?: string | null;
      subjects?: string[] | null;
    }>;
    const row = rows?.[0];
    if (!row) return null;
    return {
      id: row.id,
      name: row.name ?? "Student",
      // Treat empty-string uni as missing — same UX intent as null.
      uni: row.uni && row.uni.trim().length > 0 ? row.uni : null,
      major: row.major && row.major.trim().length > 0 ? row.major : null,
      year: parseYearText(row.year),
      bio: row.bio ?? null,
      subjects: Array.isArray(row.subjects) ? row.subjects.filter((s) => typeof s === "string") : null,
    };
  } catch {
    return null;
  }
}

/** Fetch personality quiz answers for a user (from match_quiz table).
 *  Returns null if the user hasn't completed the quiz yet — the AI
 *  handles that gracefully by skipping the personality factor. */
async function fetchPersonalityServiceRole(userId: string): Promise<Record<string, string> | null> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return null;
  try {
    const url = `${SUPABASE_URL}/rest/v1/match_quiz?select=answers&user_id=eq.${encodeURIComponent(userId)}&limit=1`;
    const res = await fetch(url, {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    });
    if (!res.ok) return null;
    const rows = await res.json() as Array<{ answers?: Record<string, string> | null }>;
    const ans = rows?.[0]?.answers;
    if (!ans || typeof ans !== "object") return null;
    return ans;
  } catch {
    return null;
  }
}

/** Fetch top N matchable memories for a user. Service-role read. */
async function fetchMemoryServiceRole(userId: string, limit = 8): Promise<StudentMemoryRow[]> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return [];
  try {
    // Most-important first; we'll filter categories client-side.
    const url = `${SUPABASE_URL}/rest/v1/student_memory?user_id=eq.${encodeURIComponent(userId)}&select=fact,category,importance&order=importance.desc&limit=${limit * 2}`;
    const res = await fetch(url, {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    });
    if (!res.ok) return [];
    const rows = await res.json() as StudentMemoryRow[];
    return rows
      .filter((r) => MATCHABLE_MEMORY_CATEGORIES.has(r.category ?? ""))
      .slice(0, limit);
  } catch {
    return [];
  }
}

/**
 * Whether a user has opted into having their PRIVATE tutor memory
 * (student_memory — which can include wellbeing-derived emotional facts)
 * used to enrich AI study-partner matching.
 *
 * Privacy fix: without this gate, ANY signed-in user could trigger a
 * service-role read of a stranger's memory into the matchmaker prompt.
 * Profile-based matching (uni / major / year / subjects / personality
 * quiz / bio) is unaffected and always runs — only the memory enrichment
 * is gated.
 *
 * Defensive by design: any failure — network, or the column not existing
 * yet because the migration (sql/20260530_match_privacy_optins.sql) hasn't
 * been applied — returns FALSE, the privacy-safe default. So deploying
 * this code before the migration simply means "no memory enrichment,"
 * never a broken match.
 */
async function fetchStudyMatchOptIn(userId: string): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return false;
  try {
    const url = `${SUPABASE_URL}/rest/v1/profiles?select=study_match_opt_in&id=eq.${encodeURIComponent(userId)}&limit=1`;
    const res = await fetch(url, {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    });
    if (!res.ok) return false;
    const rows = await res.json() as Array<{ study_match_opt_in?: boolean | null }>;
    return rows?.[0]?.study_match_opt_in === true;
  } catch {
    return false;
  }
}

/** Render a student's profile + memory as a Markdown block for the
 *  AI prompt. Kept compact — the matchmaker reasons over comparison,
 *  not biography. */
function renderStudentBlock(label: string, p: StudentProfile, mem: StudentMemoryRow[]): string {
  const lines: string[] = [];
  lines.push(`## ${label}`);
  lines.push(`- Name: ${p.name}`);
  if (p.uni)   lines.push(`- University: ${p.uni}`);
  if (p.major) lines.push(`- Major: ${p.major}`);
  if (p.year !== null) lines.push(`- Year: ${p.year}`);
  if (p.bio && p.bio.trim()) {
    lines.push(`- Bio (their own words): "${sanitizeLine(p.bio, 240)}"`);
  }
  if (p.subjects && p.subjects.length > 0) {
    const subs = p.subjects
      .filter((s): s is string => typeof s === "string" && s.length > 0)
      .slice(0, 12)
      .map((s) => sanitizeLine(s, 80));
    if (subs.length > 0) {
      lines.push(`- Courses / subjects: ${subs.join(", ")}`);
    }
  }
  if (p.personality) {
    const flat = Object.entries(p.personality)
      .filter(([k, v]) => typeof v === "string" && v.length > 0 && k.length > 0)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
    if (flat) lines.push(`- Personality (5-axis quiz): ${flat}`);
  }
  if (mem.length > 0) {
    lines.push(`- Facts Tony has learned about them:`);
    for (const m of mem) {
      lines.push(`  - ${sanitizeLine(m.fact, 200)}`);
    }
  } else {
    lines.push(`- Facts Tony has learned about them: (none yet — new user or hasn't used the tutor enough)`);
  }
  return lines.join("\n");
}

const MATCHMAKER_PROMPT = `You are an academic matchmaker. Two AI tutors — both named Tony Starrk, one representing each of two university students — have brought their students together to ask: "Should these two study together?"

Your job is to assess STUDY-PARTNER compatibility, not friendship or dating. Focus exclusively on:
- Do they share courses / programs / a current academic context where studying together helps?
- Do their strengths and weaknesses COMPLEMENT (one is strong where the other is weak)?
- Do their learning styles / personalities mesh? (introvert-introvert pairs can still work; learning style mismatches need a heads-up)
- Are their schedules / goals / pace aligned?
- Is there anything that might make this awkward or unproductive?

PRIVACY RULES — CRITICAL:
- The "Facts Tony has learned" section may contain personal information. DO NOT quote it verbatim in your verdict.
- Translate everything you reason about into ACADEMIC framing. E.g. instead of "Student A mentioned anxiety", say "Student A prefers calm, structured sessions." Instead of "Student B mentioned family issues", omit entirely — that's not relevant to study matching.
- Never reveal one student's private details to suggest they would benefit the other. Reason internally, surface only the study-compatibility conclusion.
- If a memory looks deeply personal (health, family, finances, relationships), DO NOT use it as input. Skip it silently.

VERDICT SCORE GUIDE:
- 85-100 (excellent): Same course, complementary strengths, compatible study styles, similar schedules. They should study together.
- 65-84 (good): Some overlap (same year/major/uni), some complement, no major friction. Worth trying.
- 40-64 (fair): Limited overlap; could work for general motivation/accountability but won't dramatically help each other on coursework.
- 0-39 (poor): No meaningful academic overlap, or styles clearly clash. Politely steer them apart.

DIALOGUE — also produce a SHORT staged conversation between the two AI tutors:
- 4 to 6 messages total, alternating speakers
- Each message 1-2 sentences max, conversational tone
- speaker "tony_a" = Student A's tutor (the caller)
- speaker "tony_b" = Student B's tutor (the candidate)
- Reference SPECIFIC academic details — course names, year, complementary strengths, exam timing if known. Vague generalities ("they study together") are forbidden.
- Sound like real colleagues comparing notes — natural conversational cues are welcome ("oh, that's interesting", "wait, then...", "hmm, but...", "I think they could...")
- They can disagree, build on each other's points, or revise
- The dialogue should naturally arrive at the score you assigned — the final message should signal the conclusion
- Same PRIVACY RULES as the verdict: NEVER quote private memory verbatim; translate to academic framing; omit deeply personal facts entirely

OUTPUT — JSON ONLY, no commentary, no code fences:

{
  "dialogue": [
    { "speaker": "tony_a", "text": "..." },
    { "speaker": "tony_b", "text": "..." },
    { "speaker": "tony_a", "text": "..." },
    { "speaker": "tony_b", "text": "..." }
  ],
  "score": integer 0-100,
  "summary": "one sentence the user reads first — what's the gist",
  "strengths": ["specific reason this could work", "another specific reason"],
  "concerns": ["specific friction point", "another friction point"],
  "suggested_plan": "one short paragraph: IF they study together, what should it look like? Topics, frequency, format."
}

If you have very little data on one or both students, lower the confidence (score 30-50), be honest in the summary ("limited data so far — both new to the platform"), and keep strengths/concerns short. The dialogue should also reflect the limited data — the tutors should acknowledge it.

Be specific. "They both study CS" is weak. "They're both in CS340 Operating Systems with Prof. Hamdan and the midterm is in 11 days" is what you should aim for. Same for the dialogue — concrete references, not platitudes.`;

function extractJson(raw: string): unknown {
  let s = raw.trim();
  if (s.startsWith("```")) s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first >= 0 && last > first) s = s.slice(first, last + 1);
  try { return JSON.parse(s); } catch { return null; }
}

function classifyVerdict(score: number): MatchVerdict["verdict"] {
  if (score >= 85) return "excellent";
  if (score >= 65) return "good";
  if (score >= 40) return "fair";
  return "poor";
}

export default async function handler(req: Request): Promise<Response> {
  const origin = req.headers.get("origin");
  const sHeaders = securityHeaders(origin, ALLOWED_ORIGINS);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: sHeaders });
  if (req.method !== "POST") return jsonResponse(405, { ok: false, error: "Method not allowed" }, sHeaders);

  if (!ANTHROPIC_API_KEY) {
    return jsonResponse(503, { ok: false, error: "Matchmaker unavailable (server misconfigured)" }, sHeaders);
  }
  if (!SUPABASE_SERVICE_KEY) {
    return jsonResponse(503, { ok: false, error: "Matchmaker unavailable (service key missing)" }, sHeaders);
  }

  const authHeader = req.headers.get("authorization");
  const rl = await checkRateLimit({
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY,
    authHeader,
    endpoint: "ai/study-match",
    daily: LIMITS.daily,
    hourly: LIMITS.hourly,
    minute: LIMITS.minute,
  });
  if (!rl.allowed) {
    return rateLimitResponse(rl, sHeaders, {
      cooldown:     "Slow down — please retry in a few seconds.",
      minute_limit: "Too many match attempts in a minute — try again shortly.",
      hourly_limit: "Hourly match quota reached.",
      daily_limit:  "Daily match quota reached.",
    });
  }

  // Resolve caller's user id from JWT (we trust this — the rate
  // limiter already verified the token against /auth/v1/user).
  const callerId = await getUserIdFromToken(authHeader, SUPABASE_URL, SUPABASE_ANON_KEY);
  if (!callerId) {
    return jsonResponse(401, { ok: false, error: "Please sign in to use Study Match." }, sHeaders);
  }

  const { data: body, error: bodyErr } = await readCappedJson<MatchBody>(req, MAX_BODY_BYTES, sHeaders);
  if (bodyErr) return bodyErr;
  if (!body) return jsonResponse(400, { ok: false, error: "Missing body" }, sHeaders);

  const candidateId = typeof body.candidateUserId === "string" ? body.candidateUserId.trim() : "";
  if (!UUID_RE.test(candidateId)) {
    return jsonResponse(400, { ok: false, error: "Invalid candidate id" }, sHeaders);
  }
  if (candidateId === callerId) {
    return jsonResponse(400, { ok: false, error: "Can't match yourself with yourself!" }, sHeaders);
  }

  // ── Load both students in parallel ─────────────────────────────────
  const [
    callerProfileRaw,
    candidateProfileRaw,
    callerMem,
    candidateMem,
    callerPersonality,
    candidatePersonality,
    callerOptIn,
    candidateOptIn,
  ] = await Promise.all([
    fetchProfileServiceRole(callerId),
    fetchProfileServiceRole(candidateId),
    fetchMemoryServiceRole(callerId, 8),
    fetchMemoryServiceRole(candidateId, 8),
    fetchPersonalityServiceRole(callerId),
    fetchPersonalityServiceRole(candidateId),
    fetchStudyMatchOptIn(callerId),
    fetchStudyMatchOptIn(candidateId),
  ]);

  // Merge profile + personality so renderStudentBlock has the full
  // shape. Personality is optional — null is fine.
  const callerProfile: StudentProfile | null = callerProfileRaw
    ? { ...callerProfileRaw, personality: callerPersonality }
    : null;
  const candidateProfile: StudentProfile | null = candidateProfileRaw
    ? { ...candidateProfileRaw, personality: candidatePersonality }
    : null;

  if (!callerProfile) {
    return jsonResponse(400, {
      ok: false,
      error: "We couldn't find your profile. Complete your profile first.",
    }, sHeaders);
  }
  if (!candidateProfile) {
    return jsonResponse(404, {
      ok: false,
      error: "That student's profile is unavailable.",
    }, sHeaders);
  }

  // Soft eligibility check — the user-facing rule from §FEATURE was
  // "if no data, never start." We require at least uni+year on both
  // sides; memory is preferred but not required (we let the AI handle
  // the "limited data" case in its verdict).
  if (!callerProfile.uni || callerProfile.year === null) {
    return jsonResponse(400, {
      ok: false,
      error: "Add your university and year to your profile to use Study Match.",
    }, sHeaders);
  }
  if (!candidateProfile.uni || candidateProfile.year === null) {
    return jsonResponse(400, {
      ok: false,
      error: "That student's profile is too incomplete to match against.",
    }, sHeaders);
  }

  // ── Build prompt + call Claude Haiku 4.5 ───────────────────────────
  // Privacy gate: only fold a student's private tutor memory into the
  // prompt if THAT student opted in. Profile-based matching always runs;
  // a non-opted-in user simply contributes profile signals only.
  const userPrompt = [
    MATCHMAKER_PROMPT,
    "",
    renderStudentBlock("Student A (the one asking)", callerProfile, callerOptIn ? callerMem : []),
    "",
    renderStudentBlock("Student B (the candidate)", candidateProfile, candidateOptIn ? candidateMem : []),
    "",
    "Output the JSON verdict now.",
  ].join("\n");

  /**
   * Anthropic call with retry-on-overload.
   *
   * Anthropic returns 529 ("overloaded") and occasionally 503 / 502
   * when their infrastructure is temporarily slammed. These are
   * transient — retrying in a moment usually succeeds. Without
   * retry, a single 529 surfaces straight to the user as
   * "Matchmaker upstream failed (529)" — confusing and unfair (they
   * did nothing wrong).
   *
   * Schedule: 3 attempts total — original + 2 retries — with
   * exponential backoff (700ms, 1700ms). Total worst case ~3s added
   * latency on a fully-overloaded cluster; in practice the second
   * attempt almost always wins.
   *
   * Only retries on these transient statuses:
   *   529 — overloaded (Anthropic-specific)
   *   503 — service unavailable
   *   502 — bad gateway (rare, usually edge transport)
   *   504 — gateway timeout
   * 4xx (400, 401, 429, etc.) are NOT retried — those are real
   * errors that need fixing, not transient overload.
   */
  const RETRYABLE_STATUSES = new Set([502, 503, 504, 529]);
  const BACKOFF_MS = [0, 700, 1700];
  let modelText = "";
  let lastStatus = 0;
  let lastDetail = "";
  let networkErr: string | null = null;

  for (let attempt = 0; attempt < BACKOFF_MS.length; attempt++) {
    if (BACKOFF_MS[attempt] > 0) {
      await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt]));
    }
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 1100,
          temperature: 0.35,
          messages: [{ role: "user", content: userPrompt }],
        }),
      });
      if (res.ok) {
        const json = await res.json() as { content?: Array<{ type: string; text?: string }> };
        modelText = (json.content || [])
          .filter((b) => b.type === "text")
          .map((b) => b.text ?? "")
          .join("\n").trim();
        networkErr = null;
        lastStatus = 200;
        break; // Success — exit retry loop
      }
      lastStatus = res.status;
      lastDetail = await res.text().catch(() => "");
      if (!RETRYABLE_STATUSES.has(res.status)) break; // Hard error, don't retry
    } catch (e) {
      networkErr = e instanceof Error ? e.message : "Network error reaching the matchmaker";
      // Network errors are usually transient — fall through to retry
    }
  }

  if (!modelText) {
    // All retries exhausted — surface a user-friendly message that
    // doesn't expose the upstream status code (which confuses users)
    // but does map specific codes to specific guidance.
    if (networkErr) {
      return jsonResponse(502, { ok: false, error: networkErr }, sHeaders);
    }
    const userMessage = lastStatus === 529 || lastStatus === 503
      ? "AI is overloaded right now — please try again in a moment."
      : lastStatus === 504
        ? "The matchmaker timed out — try again."
        : `Matchmaker failed (${lastStatus}).`;
    return jsonResponse(502, {
      ok: false,
      error: userMessage,
      detail: lastDetail.slice(0, 200),
    }, sHeaders);
  }

  // ── Parse + sanitize verdict ──────────────────────────────────────
  const parsed = extractJson(modelText) as Record<string, unknown> | null;
  if (!parsed || typeof parsed !== "object") {
    return jsonResponse(200, {
      ok: false,
      error: "Couldn't parse the matchmaker's verdict.",
    } satisfies MatchVerdict, sHeaders);
  }

  const rawScore = parsed.score;
  const score = typeof rawScore === "number"
    ? Math.max(0, Math.min(100, Math.round(rawScore)))
    : (typeof rawScore === "string" ? Math.max(0, Math.min(100, Math.round(Number(rawScore) || 0))) : 0);

  const summary = typeof parsed.summary === "string" ? sanitizeLine(parsed.summary, 300) : "";
  const suggested_plan = typeof parsed.suggested_plan === "string" ? sanitizeLine(parsed.suggested_plan, 500) : "";

  const strengths = Array.isArray(parsed.strengths)
    ? (parsed.strengths as unknown[])
        .filter((s): s is string => typeof s === "string" && s.length > 0 && s.length < 250)
        .slice(0, 5)
        .map((s) => sanitizeLine(s, 240))
    : [];

  const concerns = Array.isArray(parsed.concerns)
    ? (parsed.concerns as unknown[])
        .filter((s): s is string => typeof s === "string" && s.length > 0 && s.length < 250)
        .slice(0, 5)
        .map((s) => sanitizeLine(s, 240))
    : [];

  // Parse + sanitize the dialogue. Each turn must have a recognized
  // speaker and non-empty text. Cap to 8 turns defensively (the
  // prompt asks for 4-6, but be robust to over-generation).
  const dialogue = Array.isArray(parsed.dialogue)
    ? (parsed.dialogue as unknown[])
        .map((m): { speaker: "tony_a" | "tony_b"; text: string } | null => {
          if (!m || typeof m !== "object") return null;
          const obj = m as Record<string, unknown>;
          const sp = obj.speaker;
          if (sp !== "tony_a" && sp !== "tony_b") return null;
          if (typeof obj.text !== "string" || obj.text.length === 0) return null;
          return { speaker: sp, text: sanitizeLine(obj.text, 400) };
        })
        .filter((m): m is { speaker: "tony_a" | "tony_b"; text: string } => m !== null)
        .slice(0, 8)
    : [];

  return jsonResponse(200, {
    ok: true,
    score,
    verdict: classifyVerdict(score),
    summary: summary || "Matchmaker returned a verdict.",
    strengths,
    concerns,
    suggested_plan,
    dialogue,
  } satisfies MatchVerdict, sHeaders);
}
