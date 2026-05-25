export const config = { runtime: "edge" };

/**
 * /api/ai/judgment — live multi-party arbitration.
 *
 * Three parties in the conversation: Party A, Party B, and Tony
 * (the AI). Both humans + the AI post into a shared message
 * stream on the judgment row. It's a small group chat.
 *
 * Actions (selected via body.action):
 *
 *   "create"        — A creates a judgment + posts their first
 *                     message (their side, blind to B). Returns
 *                     the judgment row including invite_code.
 *
 *   "join"          — B opens the invite link, signs in, posts
 *                     their first message blind. Server stitches
 *                     them in as party_b and sets status='both_in'.
 *
 *   "post_message"  — Either A or B posts a follow-up message
 *                     in the live conversation.
 *
 *   "ai_respond"    — Either party asks Tony to weigh in. Server
 *                     reads the whole transcript, runs Anthropic
 *                     with the arbitration prompt, and posts
 *                     Tony's reply into the message stream.
 *
 *   "list_messages" — Fetch the full message list for a judgment
 *                     (RLS-gated: only participants can read).
 *
 * AURORA-ONLY. basudrus.com does not call this endpoint.
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
import { buildJudgmentPrompt, type JudgmentMessage } from "./_prompts/aurora-judgment";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";

// Per-user rate limits. AI responses are the expensive action;
// posting messages is cheap so we don't gate it as tightly.
// (One global bucket for all actions — splitting is more code
// than it's worth at this scale.)
const LIMITS = { daily: 40, hourly: 20, minute: 4 };

const MAX_BODY_BYTES = 64 * 1024;
const MAX_MESSAGE_CHARS = 8000;
const MAX_TITLE_CHARS = 120;
const MAX_LABEL_CHARS = 60;

const RELATIONSHIP_TYPES = new Set([
  "friend", "partner", "family", "colleague", "other",
]);

// Excludes 429 deliberately — see aurora.ts for the cost-amplification
// rationale. Quota-exhausted responses should NOT be retried; that
// just burns the quota faster the moment it refills.
const RETRYABLE = new Set([502, 503, 504, 529]);
const BACKOFFS = [700, 1700];

interface ReqBody {
  action: "create" | "join" | "post_message" | "ai_respond" | "list_messages" | "list_my";
  // create
  relationshipType?: unknown;
  title?: unknown;
  partyALabel?: unknown;
  // join
  inviteCode?: unknown;
  partyBLabel?: unknown;
  // create / join / post_message
  text?: unknown;
  // post_message / ai_respond / list_messages
  judgmentId?: unknown;
}

function json(status: number, body: unknown, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

async function supabaseRest(opts: {
  path: string;
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  authHeader: string | null;
}): Promise<Response> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error("Supabase env not configured");
  }
  const headers: Record<string, string> = {
    apikey: SUPABASE_ANON_KEY,
    "Content-Type": "application/json",
  };
  if (opts.authHeader) headers.Authorization = opts.authHeader;
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
  if (req.method !== "POST") return json(405, { error: "Method not allowed" }, sHeaders);
  if (!ANTHROPIC_API_KEY) return json(503, { error: "AI not configured" }, sHeaders);

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
  if (!userId) return json(401, { error: "Sign in to use judgment" }, sHeaders);
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
  if (!body || typeof body.action !== "string") {
    return json(400, { error: "Missing action" }, sHeaders);
  }

  switch (body.action) {
    case "create":        return handleCreate(body, authHeader, sHeaders);
    case "join":          return handleJoin(body, authHeader, sHeaders);
    case "post_message":  return handlePostMessage(body, authHeader, sHeaders);
    case "ai_respond":    return handleAiRespond(body, userId, authHeader, sHeaders);
    case "list_messages": return handleListMessages(body, authHeader, sHeaders);
    case "list_my":       return handleListMy(userId, authHeader, sHeaders);
    default:              return json(400, { error: `Unknown action: ${body.action}` }, sHeaders);
  }
}

// ──────────────────────────────────────────────────────────────────────
// CREATE — A creates the judgment + posts their first message
// ──────────────────────────────────────────────────────────────────────

async function handleCreate(
  body: ReqBody,
  authHeader: string | null,
  sHeaders: Record<string, string>,
): Promise<Response> {
  const relType = String(body.relationshipType ?? "").toLowerCase();
  if (!RELATIONSHIP_TYPES.has(relType)) {
    return json(400, { error: `Invalid relationshipType` }, sHeaders);
  }
  const text = String(body.text ?? "").trim();
  if (text.length < 5) return json(400, { error: "Your first message is too short" }, sHeaders);
  if (text.length > MAX_MESSAGE_CHARS) return json(400, { error: "Your first message is too long" }, sHeaders);

  const title = sanitizeLine(body.title, MAX_TITLE_CHARS);
  const partyALabel = sanitizeLine(body.partyALabel, MAX_LABEL_CHARS);

  const res = await supabaseRest({
    path: "/rest/v1/rpc/judgment_create",
    method: "POST",
    body: {
      p_relationship_type: relType,
      p_title: title || null,
      p_party_a_label: partyALabel || null,
      p_first_message: text,
    },
    authHeader,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    if (detail.includes("message_too_short")) {
      return json(400, { error: "Your message is too short" }, sHeaders);
    }
    if (detail.includes("invalid_relationship_type")) {
      return json(400, { error: "Invalid relationship type" }, sHeaders);
    }
    return json(res.status, { error: `Could not create judgment: ${detail.slice(0, 200)}` }, sHeaders);
  }
  const created = await res.json() as Record<string, unknown>;

  // Auto-acknowledgment from Tony. The user just poured out their
  // side and is now sitting on a screen with a share link. Without
  // an ack, it feels empty. We post a brief, hardcoded Tony reply
  // (no AI call needed — it's the same message every time and the
  // point is just to be present, not to be clever).
  //
  // Best-effort: if this insert fails, the judgment still works —
  // we just skip the ack and the user sees only their own message.
  const ackText =
    "Heard you. I'm not going to weigh in yet — I want to hear " +
    "their side first, blind, so I'm fair to both of you. Send " +
    "them the link below. The second they're in I'll come back " +
    "with my read.";
  try {
    if (typeof created.id === "string") {
      await supabaseRest({
        path: "/rest/v1/rpc/judgment_post_ai_message",
        method: "POST",
        body: { p_judgment_id: created.id, p_text: ackText },
        authHeader,
      });
    }
  } catch { /* ack is best-effort */ }

  return json(200, { judgment: created }, sHeaders);
}

// ──────────────────────────────────────────────────────────────────────
// JOIN — B submits their first message via invite_code (blind to A)
// ──────────────────────────────────────────────────────────────────────

async function handleJoin(
  body: ReqBody,
  authHeader: string | null,
  sHeaders: Record<string, string>,
): Promise<Response> {
  const inviteCode = sanitizeLine(body.inviteCode, 40);
  if (!inviteCode) return json(400, { error: "Missing inviteCode" }, sHeaders);
  const text = String(body.text ?? "").trim();
  if (text.length < 5) return json(400, { error: "Your message is too short" }, sHeaders);
  if (text.length > MAX_MESSAGE_CHARS) return json(400, { error: "Your message is too long" }, sHeaders);
  const partyBLabel = sanitizeLine(body.partyBLabel, MAX_LABEL_CHARS);

  const res = await supabaseRest({
    path: "/rest/v1/rpc/judgment_join",
    method: "POST",
    body: {
      p_invite_code: inviteCode,
      p_party_b_label: partyBLabel || null,
      p_first_message: text,
    },
    authHeader,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    if (detail.includes("judgment_not_found")) {
      return json(404, { error: "Invite link doesn't match an active judgment" }, sHeaders);
    }
    if (detail.includes("judgment_not_joinable")) {
      return json(409, { error: "This judgment isn't open for new participants" }, sHeaders);
    }
    if (detail.includes("cannot_judge_yourself")) {
      return json(403, { error: "You started this — share the link with the other person" }, sHeaders);
    }
    if (detail.includes("message_too_short") || detail.includes("message_too_long")) {
      return json(400, { error: "Your message didn't fit the size limits" }, sHeaders);
    }
    return json(res.status, { error: `Could not join: ${detail.slice(0, 200)}` }, sHeaders);
  }
  const joined = await res.json() as Record<string, unknown>;
  return json(200, { judgment: joined }, sHeaders);
}

// ──────────────────────────────────────────────────────────────────────
// POST_MESSAGE — A or B sends a follow-up message in the live convo
// ──────────────────────────────────────────────────────────────────────

async function handlePostMessage(
  body: ReqBody,
  authHeader: string | null,
  sHeaders: Record<string, string>,
): Promise<Response> {
  const judgmentId = sanitizeLine(body.judgmentId, 40);
  if (!judgmentId) return json(400, { error: "Missing judgmentId" }, sHeaders);
  const text = String(body.text ?? "").trim();
  if (text.length < 1) return json(400, { error: "Empty message" }, sHeaders);
  if (text.length > MAX_MESSAGE_CHARS) return json(400, { error: "Message too long" }, sHeaders);

  // First, load the judgment to determine the caller's sender_type.
  const judgRes = await supabaseRest({
    path: `/rest/v1/judgments?id=eq.${encodeURIComponent(judgmentId)}&select=id,party_a_user_id,party_b_user_id,status`,
    authHeader,
  });
  if (!judgRes.ok) return json(500, { error: "Failed to load judgment" }, sHeaders);
  const rows = await judgRes.json() as Array<{
    id: string;
    party_a_user_id: string;
    party_b_user_id: string | null;
    status: string;
  }>;
  if (rows.length === 0) {
    return json(404, { error: "Judgment not found or you're not a participant" }, sHeaders);
  }
  const j = rows[0];
  if (j.status !== "both_in" && j.status !== "active") {
    return json(409, { error: "Conversation isn't open for messages" }, sHeaders);
  }

  // We can't read auth.uid() from this edge function, but the RLS
  // INSERT policy will enforce it. The client passes whichever
  // sender_type matches them; if they lie, RLS rejects. We trust
  // and let the database enforce.
  // The simpler approach: derive sender_type from which user_id slot
  // matches the auth.uid() implicit in the JWT. We don't have
  // auth.uid() here, so we have to rely on the client telling us OR
  // we can call a tiny RPC. For simplicity, infer from judgment row:
  // if both slots are filled, the caller is whichever matches via
  // an RPC-style check. Actually we already verified the caller is
  // a participant via the RLS-gated SELECT above — but we don't
  // know WHICH party. Easiest: call who_am_i RPC OR have client send
  // their userId. For now, infer at insert-time by trying both:
  //   - try party_a insert; if RLS rejects, try party_b
  // Wasteful — use a tiny helper RPC instead.

  const insertRes = await supabaseRest({
    path: "/rest/v1/rpc/judgment_post_self_message",
    method: "POST",
    body: { p_judgment_id: judgmentId, p_text: text },
    authHeader,
  });
  if (!insertRes.ok) {
    const detail = await insertRes.text().catch(() => "");
    if (detail.includes("not_a_participant")) {
      return json(403, { error: "You're not a participant in this judgment" }, sHeaders);
    }
    return json(insertRes.status, { error: `Could not post: ${detail.slice(0, 200)}` }, sHeaders);
  }
  const inserted = await insertRes.json() as Record<string, unknown>;
  return json(200, { message: inserted }, sHeaders);
}

// ──────────────────────────────────────────────────────────────────────
// AI_RESPOND — read the whole transcript, run Tony, post his reply
// ──────────────────────────────────────────────────────────────────────

async function handleAiRespond(
  body: ReqBody,
  userId: string,
  authHeader: string | null,
  sHeaders: Record<string, string>,
): Promise<Response> {
  const judgmentId = sanitizeLine(body.judgmentId, 40);
  if (!judgmentId) return json(400, { error: "Missing judgmentId" }, sHeaders);

  // Load the judgment metadata.
  const judgRes = await supabaseRest({
    path: `/rest/v1/judgments?id=eq.${encodeURIComponent(judgmentId)}&select=*`,
    authHeader,
  });
  if (!judgRes.ok) return json(500, { error: "Failed to load judgment" }, sHeaders);
  const judRows = await judgRes.json() as Array<Record<string, unknown>>;
  if (judRows.length === 0) {
    return json(404, { error: "Judgment not found or you're not a participant" }, sHeaders);
  }
  const j = judRows[0];
  if (j.status !== "both_in" && j.status !== "active") {
    return json(409, { error: "Conversation isn't open" }, sHeaders);
  }
  // Defensive participant check.
  if (j.party_a_user_id !== userId && j.party_b_user_id !== userId) {
    return json(403, { error: "Not a participant" }, sHeaders);
  }

  // Load the full message transcript in order.
  const msgRes = await supabaseRest({
    path: `/rest/v1/judgment_messages?judgment_id=eq.${encodeURIComponent(judgmentId)}&order=created_at.asc&select=sender_type,text`,
    authHeader,
  });
  if (!msgRes.ok) return json(500, { error: "Failed to load messages" }, sHeaders);
  const msgRows = await msgRes.json() as Array<{ sender_type: string; text: string }>;
  if (msgRows.length === 0) {
    return json(409, { error: "No messages yet — write your sides first" }, sHeaders);
  }
  const messages: JudgmentMessage[] = msgRows.map((m) => ({
    sender: (m.sender_type === "party_a" || m.sender_type === "party_b" || m.sender_type === "ai")
      ? m.sender_type
      : "party_a",
    text: m.text,
  }));

  // Is this the AI's first response? (Used by the prompt to pick
  // between "opening verdict" instructions and "follow-up" instructions.)
  const isOpeningVerdict = !messages.some((m) => m.sender === "ai");

  const systemPrompt = buildJudgmentPrompt({
    relationshipType: String(j.relationship_type ?? "other"),
    title: typeof j.title === "string" ? j.title : undefined,
    partyALabel: typeof j.party_a_label === "string" ? j.party_a_label : undefined,
    partyBLabel: typeof j.party_b_label === "string" ? j.party_b_label : undefined,
    messages,
    isOpeningVerdict,
  });

  // Anthropic call with retry-with-backoff.
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
        max_tokens: 1000,
        system: systemPrompt,
        messages: [{
          role: "user",
          content: isOpeningVerdict
            ? "Both sides are in. Write your opening verdict."
            : "Write your next message in the discussion.",
        }],
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
      const j2 = await resp.json() as { error?: { message?: string } };
      if (j2?.error?.message) detail = j2.error.message;
    } catch { /* keep default */ }
    return json(502, { error: `Tony couldn't respond: ${detail}` }, sHeaders);
  }
  const payload = await resp.json() as { content?: Array<{ type?: string; text?: string }> };
  const aiText = (payload.content ?? [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n\n")
    .trim();
  if (!aiText) return json(502, { error: "Empty response from AI" }, sHeaders);

  // Persist the AI message via the security-definer RPC. The standard
  // INSERT policy requires sender_user_id = auth.uid(), but AI rows
  // have sender_user_id = null — so the RPC bypass is necessary.
  const aiInsertRes = await supabaseRest({
    path: "/rest/v1/rpc/judgment_post_ai_message",
    method: "POST",
    body: { p_judgment_id: judgmentId, p_text: aiText },
    authHeader,
  });
  if (!aiInsertRes.ok) {
    const detail = await aiInsertRes.text().catch(() => "");
    // Return the text anyway so the user sees Tony's reply; persistence
    // can be retried client-side or on next refresh.
    return json(200, {
      message: { sender_type: "ai", text: aiText, persisted: false },
      warning: `Tony spoke but message couldn't save: ${detail.slice(0, 200)}`,
    }, sHeaders);
  }
  const aiMsgRow = await aiInsertRes.json() as Record<string, unknown>;
  return json(200, { message: aiMsgRow }, sHeaders);
}

// ──────────────────────────────────────────────────────────────────────
// LIST_MESSAGES — fetch the conversation transcript
// ──────────────────────────────────────────────────────────────────────

async function handleListMessages(
  body: ReqBody,
  authHeader: string | null,
  sHeaders: Record<string, string>,
): Promise<Response> {
  const judgmentId = sanitizeLine(body.judgmentId, 40);
  if (!judgmentId) return json(400, { error: "Missing judgmentId" }, sHeaders);

  const res = await supabaseRest({
    path: `/rest/v1/judgment_messages?judgment_id=eq.${encodeURIComponent(judgmentId)}&order=created_at.asc&select=id,sender_type,sender_user_id,text,created_at`,
    authHeader,
  });
  if (!res.ok) return json(500, { error: "Failed to load messages" }, sHeaders);
  const messages = await res.json() as Array<Record<string, unknown>>;
  return json(200, { messages }, sHeaders);
}

// ──────────────────────────────────────────────────────────────────────
// LIST_MY — past judgments the caller participated in (A or B)
// ──────────────────────────────────────────────────────────────────────

async function handleListMy(
  userId: string,
  authHeader: string | null,
  sHeaders: Record<string, string>,
): Promise<Response> {
  // RLS already restricts the rows to participants, so a plain
  // ordering+limit query is all we need. We OR on the two party
  // columns because PostgREST's "or" filter syntax is awkward;
  // simpler to do two queries and union them client-side.
  const baseCols = "id,invite_code,relationship_type,title,party_a_label,party_b_label,status,created_at,updated_at,party_a_user_id,party_b_user_id";
  const asA = await supabaseRest({
    path: `/rest/v1/judgments?party_a_user_id=eq.${encodeURIComponent(userId)}&order=updated_at.desc&limit=50&select=${baseCols}`,
    authHeader,
  });
  const asB = await supabaseRest({
    path: `/rest/v1/judgments?party_b_user_id=eq.${encodeURIComponent(userId)}&order=updated_at.desc&limit=50&select=${baseCols}`,
    authHeader,
  });
  if (!asA.ok || !asB.ok) {
    return json(500, { error: "Failed to load your judgments" }, sHeaders);
  }
  const aRows = (await asA.json()) as Array<Record<string, unknown>>;
  const bRows = (await asB.json()) as Array<Record<string, unknown>>;
  // Merge + dedupe by id (a row only appears in one of the two
  // queries since A and B are different user IDs, but defensive
  // dedupe is cheap).
  const seen = new Set<string>();
  const merged: Array<Record<string, unknown>> = [];
  for (const r of [...aRows, ...bRows]) {
    const id = typeof r.id === "string" ? r.id : "";
    if (id && !seen.has(id)) {
      seen.add(id);
      merged.push(r);
    }
  }
  // Re-sort by updated_at desc.
  merged.sort((a, b) => {
    const ta = Date.parse(String(a.updated_at ?? "")) || 0;
    const tb = Date.parse(String(b.updated_at ?? "")) || 0;
    return tb - ta;
  });
  return json(200, { judgments: merged }, sHeaders);
}
