export const config = { runtime: "edge" };

/**
 * /api/ai/judgment — two-party arbitration endpoint.
 *
 * One endpoint, three actions (selected via body.action):
 *
 *   "create"  — Party A starts a judgment. Returns the new row
 *               including its invite_code (used to build the
 *               share link).
 *   "join"    — Party B submits their side via invite_code.
 *               Uses the security-definer judgment_join RPC so
 *               it can update a row B doesn't own.
 *   "verdict" — Once both sides are in, runs the AI to generate
 *               the verdict. Writes verdict_text + verdict_sides_with
 *               + verdict_generated_at + status='complete'.
 *               Triggered by either party.
 *
 * AURORA-ONLY. basudrus.com does not call this endpoint and is not
 * affected by anything in this file.
 */

import {
  ALLOWED_ORIGINS,
  securityHeaders,
  readCappedJson,
  checkRateLimit,
  rateLimitResponse,
  getUserIdFromToken,
  isProUser,
  sanitizeLine,
} from "../_lib/ai-guard";
import { buildJudgmentPrompt } from "./_prompts/aurora-judgment";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";

// Tight limits — judgments are heavier per-call than regular chat
// (two sides of text + AI verdict generation) and shouldn't be a
// dripping faucet of free LLM calls.
const LIMITS = { daily: 12, hourly: 6, minute: 2 };

const MAX_BODY_BYTES = 64 * 1024;       // 64 KB — sides cap at 8 KB each
const MAX_SIDE_CHARS = 8000;
const MAX_TITLE_CHARS = 120;
const MAX_LABEL_CHARS = 60;

const RELATIONSHIP_TYPES = new Set([
  "friend", "partner", "family", "colleague", "other",
]);

const RETRYABLE = new Set([429, 502, 503, 504, 529]);
const BACKOFFS = [700, 1700];

interface CreateBody {
  action: "create";
  relationshipType: unknown;
  title?: unknown;
  partyALabel?: unknown;
  partyASide: unknown;
}
interface JoinBody {
  action: "join";
  inviteCode: unknown;
  partyBLabel?: unknown;
  partyBSide: unknown;
}
interface VerdictBody {
  action: "verdict";
  judgmentId: unknown;
}
type ReqBody = CreateBody | JoinBody | VerdictBody;

function json(status: number, body: unknown, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

/** Thin Supabase REST helper for inserts/selects/updates as the user. */
async function supabaseRest(opts: {
  path: string;
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  authHeader: string | null;
  preferReturn?: boolean;
}): Promise<Response> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error("Supabase env not configured");
  }
  const headers: Record<string, string> = {
    apikey: SUPABASE_ANON_KEY,
    "Content-Type": "application/json",
  };
  if (opts.authHeader) headers.Authorization = opts.authHeader;
  if (opts.preferReturn) headers.Prefer = "return=representation";
  return fetch(`${SUPABASE_URL}${opts.path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

export default async function handler(req: Request): Promise<Response> {
  const origin = req.headers.get("origin");
  const sHeaders = securityHeaders(origin, ALLOWED_ORIGINS);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: sHeaders });
  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed" }, sHeaders);
  }
  if (!ANTHROPIC_API_KEY) {
    return json(503, { error: "AI not configured" }, sHeaders);
  }

  const authHeader = req.headers.get("authorization");
  const [userId, rateCheck] = await Promise.all([
    getUserIdFromToken(authHeader, SUPABASE_URL, SUPABASE_ANON_KEY),
    checkRateLimit({
      supabaseUrl: SUPABASE_URL,
      supabaseAnonKey: SUPABASE_ANON_KEY,
      authHeader,
      endpoint: "judgment",
      daily: LIMITS.daily,
      hourly: LIMITS.hourly,
      minute: LIMITS.minute,
    }),
  ]);
  if (!userId) {
    return json(401, { error: "Sign in to use judgment" }, sHeaders);
  }
  if (!isProUser(userId) && !rateCheck.allowed) {
    return rateLimitResponse(rateCheck, sHeaders, {
      cooldown: "Slow down — wait a few seconds between actions",
      minute_limit: "Too many judgment actions in a minute.",
      hourly_limit: "Hourly judgment limit hit. Try again in a bit.",
      daily_limit: "Daily judgment limit reached.",
    });
  }

  const { data: body, error: bodyErr } = await readCappedJson<ReqBody>(req, MAX_BODY_BYTES, sHeaders);
  if (bodyErr) return bodyErr;
  if (!body || typeof (body as { action?: unknown }).action !== "string") {
    return json(400, { error: "Missing action" }, sHeaders);
  }

  const action = (body as { action: string }).action;

  if (action === "create") return handleCreate(body as CreateBody, userId, authHeader, sHeaders);
  if (action === "join")    return handleJoin(body as JoinBody, authHeader, sHeaders);
  if (action === "verdict") return handleVerdict(body as VerdictBody, userId, authHeader, sHeaders);

  return json(400, { error: `Unknown action: ${action}` }, sHeaders);
}

// ──────────────────────────────────────────────────────────────────────
// CREATE
// ──────────────────────────────────────────────────────────────────────

async function handleCreate(
  body: CreateBody,
  userId: string,
  authHeader: string | null,
  sHeaders: Record<string, string>,
): Promise<Response> {
  const relType = String(body.relationshipType ?? "").toLowerCase();
  if (!RELATIONSHIP_TYPES.has(relType)) {
    return json(400, { error: `Invalid relationshipType (must be one of: ${[...RELATIONSHIP_TYPES].join(", ")})` }, sHeaders);
  }
  const partyASide = String(body.partyASide ?? "").trim();
  if (partyASide.length < 5) {
    return json(400, { error: "Your side is too short — tell us what happened" }, sHeaders);
  }
  if (partyASide.length > MAX_SIDE_CHARS) {
    return json(400, { error: `Your side is too long (max ${MAX_SIDE_CHARS} chars)` }, sHeaders);
  }
  const title = sanitizeLine(body.title, MAX_TITLE_CHARS) || null;
  const partyALabel = sanitizeLine(body.partyALabel, MAX_LABEL_CHARS) || null;

  const row = {
    relationship_type: relType,
    title,
    party_a_user_id: userId,
    party_a_label: partyALabel,
    party_a_side: partyASide,
  };

  const res = await supabaseRest({
    path: "/rest/v1/judgments",
    method: "POST",
    body: row,
    authHeader,
    preferReturn: true,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return json(res.status, { error: `Could not create judgment: ${detail.slice(0, 200)}` }, sHeaders);
  }
  const created = await res.json() as Array<Record<string, unknown>>;
  return json(200, { judgment: created[0] }, sHeaders);
}

// ──────────────────────────────────────────────────────────────────────
// JOIN — Party B submits their side via invite_code
// ──────────────────────────────────────────────────────────────────────

async function handleJoin(
  body: JoinBody,
  authHeader: string | null,
  sHeaders: Record<string, string>,
): Promise<Response> {
  const inviteCode = sanitizeLine(body.inviteCode, 40);
  if (!inviteCode) return json(400, { error: "Missing inviteCode" }, sHeaders);

  const partyBSide = String(body.partyBSide ?? "").trim();
  if (partyBSide.length < 5) {
    return json(400, { error: "Your side is too short — tell us what happened" }, sHeaders);
  }
  if (partyBSide.length > MAX_SIDE_CHARS) {
    return json(400, { error: `Your side is too long (max ${MAX_SIDE_CHARS} chars)` }, sHeaders);
  }
  const partyBLabel = sanitizeLine(body.partyBLabel, MAX_LABEL_CHARS);

  const res = await supabaseRest({
    path: "/rest/v1/rpc/judgment_join",
    method: "POST",
    body: {
      p_invite_code: inviteCode,
      p_party_b_label: partyBLabel,
      p_party_b_side: partyBSide,
    },
    authHeader,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    // Translate the named errors from the RPC into nicer messages.
    if (detail.includes("judgment_not_found")) {
      return json(404, { error: "That invite link doesn't match an active judgment" }, sHeaders);
    }
    if (detail.includes("judgment_not_joinable")) {
      return json(409, { error: "This judgment isn't open for new participants" }, sHeaders);
    }
    if (detail.includes("cannot_judge_yourself")) {
      return json(403, { error: "You started this judgment — share the link with the other person" }, sHeaders);
    }
    if (detail.includes("side_too_short") || detail.includes("side_too_long")) {
      return json(400, { error: "Your side didn't fit the size limits" }, sHeaders);
    }
    return json(res.status, { error: `Could not join: ${detail.slice(0, 200)}` }, sHeaders);
  }
  const joined = await res.json() as Record<string, unknown>;
  return json(200, { judgment: joined }, sHeaders);
}

// ──────────────────────────────────────────────────────────────────────
// VERDICT — generate the AI judgment once both sides are in
// ──────────────────────────────────────────────────────────────────────

async function handleVerdict(
  body: VerdictBody,
  userId: string,
  authHeader: string | null,
  sHeaders: Record<string, string>,
): Promise<Response> {
  const judgmentId = sanitizeLine(body.judgmentId, 40);
  if (!judgmentId) return json(400, { error: "Missing judgmentId" }, sHeaders);

  // Read the row (RLS ensures the caller is one of the parties).
  const fetchRes = await supabaseRest({
    path: `/rest/v1/judgments?id=eq.${encodeURIComponent(judgmentId)}&select=*`,
    authHeader,
  });
  if (!fetchRes.ok) {
    return json(500, { error: "Failed to load judgment" }, sHeaders);
  }
  const rows = await fetchRes.json() as Array<Record<string, unknown>>;
  if (rows.length === 0) {
    return json(404, { error: "Judgment not found or you're not a participant" }, sHeaders);
  }
  const row = rows[0];

  // Guard: must have both sides AND not be already complete.
  if (typeof row.party_b_side !== "string" || !row.party_b_side) {
    return json(409, { error: "Waiting for the other person to submit their side" }, sHeaders);
  }
  if (row.status === "complete" && typeof row.verdict_text === "string" && row.verdict_text) {
    // Idempotent: return the already-generated verdict.
    return json(200, { judgment: row, alreadyComplete: true }, sHeaders);
  }
  if (row.party_a_user_id !== userId && row.party_b_user_id !== userId) {
    // RLS should prevent this; defensive double-check.
    return json(403, { error: "Not a participant in this judgment" }, sHeaders);
  }

  // Build the prompt and call Anthropic.
  const systemPrompt = buildJudgmentPrompt({
    relationshipType: String(row.relationship_type ?? "other"),
    title: typeof row.title === "string" ? row.title : undefined,
    partyALabel: typeof row.party_a_label === "string" ? row.party_a_label : undefined,
    partyBLabel: typeof row.party_b_label === "string" ? row.party_b_label : undefined,
    partyASide: String(row.party_a_side ?? ""),
    partyBSide: String(row.party_b_side ?? ""),
  });

  // Non-streaming Anthropic call (verdict is a single complete
  // response, no need for SSE). req.signal isn't available here
  // because handleVerdict doesn't receive the Request object; the
  // call is short (~2-5s) so omitting client-abort propagation is
  // fine for v1.
  const callAnthropic = (): Promise<Response> =>
    fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1500,
        system: systemPrompt,
        messages: [{ role: "user", content: "Write the verdict now." }],
      }),
    });

  let resp = await callAnthropic();
  for (const delay of BACKOFFS) {
    if (!resp.ok && RETRYABLE.has(resp.status)) {
      await new Promise((r) => setTimeout(r, delay));
      try { await resp.body?.cancel(); } catch { /* noop */ }
      resp = await callAnthropic();
    }
  }

  if (!resp.ok) {
    let detail = `Anthropic ${resp.status}`;
    try {
      const j = await resp.json() as { error?: { message?: string } };
      if (j?.error?.message) detail = j.error.message;
    } catch { /* keep default */ }
    return json(502, { error: `Verdict generation failed: ${detail}` }, sHeaders);
  }

  const payload = await resp.json() as {
    content?: Array<{ type?: string; text?: string }>;
  };
  const verdictText = (payload.content ?? [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n\n")
    .trim();

  if (!verdictText) {
    return json(502, { error: "Empty verdict from AI" }, sHeaders);
  }

  // Heuristic: which way did the verdict lean? Cheap text scan of
  // the first ~250 chars to pick a label for the UI badge. The
  // text itself is the source of truth; this is just metadata.
  const head = verdictText.slice(0, 300).toLowerCase();
  const aLabel = String(row.party_a_label ?? "party a").toLowerCase();
  const bLabel = String(row.party_b_label ?? "party b").toLowerCase();
  const mentionsBothWrong = /both/.test(head) && /wrong|off/.test(head);
  const mentionsNeitherWrong = /neither.*wrong|no one.*wrong|nobody.*wrong/.test(head);
  let sidesWith: "a" | "b" | "both" | "neither" = "neither";
  if (mentionsNeitherWrong) sidesWith = "neither";
  else if (mentionsBothWrong) sidesWith = "both";
  else if (head.includes(`${aLabel}, you`) || head.includes(`${aLabel} — you`)) sidesWith = "b";
  else if (head.includes(`${bLabel}, you`) || head.includes(`${bLabel} — you`)) sidesWith = "a";

  // Persist via the security-definer RPC. The standard UPDATE RLS
  // policy only allows updates while status='waiting' — verdicts
  // need to write into a 'both_in' row, which is what
  // judgment_save_verdict() is for. It validates the caller is one
  // of the participants and the row is in the right state.
  const updateRes = await supabaseRest({
    path: "/rest/v1/rpc/judgment_save_verdict",
    method: "POST",
    body: {
      p_judgment_id: judgmentId,
      p_verdict_text: verdictText,
      p_verdict_sides_with: sidesWith,
    },
    authHeader,
  });
  if (!updateRes.ok) {
    const detail = await updateRes.text().catch(() => "");
    // Surface the verdict text even if persistence failed — the user
    // shouldn't lose what the AI just produced. They can refresh
    // and the verdict will regenerate from the (still-present)
    // both-sides data.
    return json(200, {
      judgment: { ...row, verdict_text: verdictText, verdict_sides_with: sidesWith, status: "complete" },
      warning: `Verdict generated but could not persist: ${detail.slice(0, 200)}`,
    }, sHeaders);
  }
  const updated = await updateRes.json() as Record<string, unknown>;
  return json(200, { judgment: updated }, sHeaders);
}
