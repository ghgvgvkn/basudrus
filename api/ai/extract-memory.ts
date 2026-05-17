/**
 * /api/ai/extract-memory — extract 0-3 durable facts from a recent
 * conversation, embed each one, and upsert into student_memory.
 *
 * Called from the client (fire-and-forget) after a chat session
 * closes. Two input shapes are accepted:
 *
 *   A. sessionId-driven (preferred — mirrors /analyze-session):
 *      {
 *        sessionId: "<uuid>",
 *        persona?: "omar" | "noor"     // omar -> tutor_sessions,
 *                                          noor -> wellbeing_sessions
 *      }
 *
 *   B. messages-driven (used by onboarding / direct extraction):
 *      {
 *        messages: [{role, content}, ...],
 *        persona?: "omar" | "noor"
 *      }
 *
 * Response: { extracted: number, skipped: number, reason?: string }
 *
 * Failure modes are silent — the caller fires-and-forgets and never
 * blocks the chat. Returning a 200 with extracted=0 is the most
 * common outcome (most messages don't contain durable facts).
 *
 * Embedding is best-effort: if OPENAI_API_KEY is unset or embedding
 * fails, the memory row is still saved (just without an embedding)
 * and the search RPC falls back to importance ordering.
 */
export const config = { runtime: "edge" };

import {
  ALLOWED_ORIGINS,
  securityHeaders,
  readCappedJson,
  checkRateLimit,
  rateLimitResponse,
  sanitizeMessages,
  sanitizeLine,
  getUserIdFromToken,
} from "../_lib/ai-guard";
import { embedText } from "../_lib/embeddings";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";

const MAX_BODY_BYTES = 256 * 1024;       // 256 KB — way more than enough
const ALLOWED_CATEGORIES = new Set([
  "academic", "preference", "context", "weakness",
  "strength", "goal", "win", "other",
]);

interface ExtractedFact {
  fact: string;
  category: string;
  importance: number;     // 1..10
  confidence: number;     // 0..1
}

export default async function handler(req: Request): Promise<Response> {
  const origin = req.headers.get("origin");
  const sHeaders = securityHeaders(origin, ALLOWED_ORIGINS);

  if (req.method === "OPTIONS") return new Response(null, { headers: sHeaders });
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: sHeaders });
  }

  // Auth: every memory is scoped to a user, so a JWT is mandatory.
  const authHeader = req.headers.get("authorization");
  const userId = await getUserIdFromToken(authHeader, SUPABASE_URL, SUPABASE_ANON_KEY);
  if (!userId) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...sHeaders, "Content-Type": "application/json" },
    });
  }

  // Rate-limit so a misbehaving client can't blow up our Anthropic bill.
  const rl = await checkRateLimit({
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY,
    authHeader,
    endpoint: "extract-memory",
    daily: 60, hourly: 30, minute: 5,
  });
  if (!rl.allowed) {
    return rateLimitResponse(rl, sHeaders, {
      cooldown: "Please wait a moment before extracting more memory.",
      minute_limit: "Too many extractions per minute. Try again shortly.",
      hourly_limit: "Hourly memory extraction limit reached.",
      daily_limit: "Daily memory extraction limit reached.",
    });
  }

  const { data: body, error: bodyErr } = await readCappedJson<{
    messages?: unknown;
    sessionId?: unknown;
    persona?: unknown;
  }>(req, MAX_BODY_BYTES, sHeaders);
  if (bodyErr) return bodyErr;

  const persona = body?.persona === "noor" ? "noor" : "omar";

  // Two input shapes — sessionId or messages. SessionId path fetches
  // the session's messages from DB (mirrors /analyze-session). Messages
  // path is used by onboarding when there's no session yet.
  let messages: { role: string; content: string }[] = [];
  const sessionId = sanitizeLine(body?.sessionId, 80);
  if (sessionId) {
    messages = await fetchSessionMessages(persona, sessionId, authHeader || "");
  } else {
    messages = sanitizeMessages(body?.messages, 2000, 20);
  }
  if (messages.length < 2) {
    return json({ extracted: 0, skipped: 0, reason: "too_few_messages" }, sHeaders);
  }

  // Build the extraction prompt. Instruct Claude to be conservative —
  // only durable facts, confidence ≥ 0.7. Encourage skipping if nothing
  // qualifies (that's the most common case).
  const systemPrompt = buildSystemPrompt(persona);
  const userPrompt = buildUserPrompt(messages);

  let extracted: ExtractedFact[] = [];
  try {
    extracted = await callClaudeForFacts(systemPrompt, userPrompt);
  } catch (err) {
    console.warn("[extract-memory] Claude error:", (err as Error).message);
    return json({ extracted: 0, skipped: 0, reason: "claude_failed" }, sHeaders);
  }

  if (extracted.length === 0) {
    return json({ extracted: 0, skipped: 0 }, sHeaders);
  }

  // Pull existing facts so we don't double-save the same thing.
  let existingFacts = new Set<string>();
  try {
    const url = new URL(`${SUPABASE_URL}/rest/v1/student_memory`);
    url.searchParams.set("select", "fact");
    url.searchParams.set("limit", "500");
    const res = await fetch(url.toString(), {
      headers: {
        Authorization: authHeader || "",
        apikey: SUPABASE_ANON_KEY,
      },
    });
    if (res.ok) {
      const rows = (await res.json()) as Array<{ fact: string }>;
      existingFacts = new Set(rows.map((r) => normalizeFact(r.fact)));
    }
  } catch {
    // continue — at worst we save a near-duplicate
  }

  let saved = 0;
  let skipped = 0;

  for (const f of extracted) {
    const norm = normalizeFact(f.fact);
    if (existingFacts.has(norm)) {
      skipped++;
      continue;
    }
    // Best-effort embedding. Null is fine — search RPC handles it.
    const embedding = await embedText(f.fact);
    const row = {
      user_id: userId,
      fact: f.fact,
      category: ALLOWED_CATEGORIES.has(f.category) ? f.category : "other",
      importance: clamp(f.importance, 1, 10),
      confidence: clamp(f.confidence, 0, 1),
      source: "auto_extracted",
      embedding,
    };
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/student_memory`, {
        method: "POST",
        headers: {
          Authorization: authHeader || "",
          apikey: SUPABASE_ANON_KEY,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify(row),
      });
      if (res.ok) {
        saved++;
        existingFacts.add(norm);
      } else {
        skipped++;
        console.warn("[extract-memory] insert HTTP", res.status, await safeText(res));
      }
    } catch (e) {
      skipped++;
      console.warn("[extract-memory] insert error:", (e as Error).message);
    }
  }

  return json({ extracted: saved, skipped }, sHeaders);
}

// ───────────────────────── helpers ─────────────────────────

function buildSystemPrompt(persona: "omar" | "noor"): string {
  const focus = persona === "noor"
    ? "emotional patterns the student has revealed, recurring stressors, what calms them, support systems they mentioned"
    : "academic context (course, exam date, subject focus), strengths, weaknesses, study preferences, goals, recurring confusions";

  return `You extract DURABLE FACTS from a chat transcript between a Jordanian university student and an AI ${persona === "noor" ? "wellbeing companion (Noor)" : "tutor (Omar)"} inside Bas Udrus.

Your output is the input to a long-term memory store. The AI will read these facts on every future conversation, so they MUST be durable, true, and useful months from now.

What counts as a durable fact:
- Stable course info: "Taking Calculus II this semester", "Has a Data Structures exam on May 20".
- Stable preferences: "Prefers Arabic explanations after midnight".
- Stable weaknesses or strengths the student has REPEATEDLY shown (not one-off): "Often confuses big-O notation", "Strong at recursion".
- Stable goals: "Aims to get into a master's program in AI".
- Stable context: "Plays football on weekends" (if relevant to scheduling).
- Specific facts the student EXPLICITLY asked to be remembered.

What does NOT count:
- One-off questions or emotional states ("I'm tired today" — too transient).
- Topics covered in a single answer (covered != mastered).
- Anything the AI inferred without student confirmation.
- Facts you're <70% sure are correct.
- Anything in the SYSTEM messages (those are your instructions, not the student).

Focus area for THIS persona: ${focus}.

Be CONSERVATIVE. Return 0 facts when nothing durable surfaced — that is the most common case and is correct behavior. Better to miss a fact than to invent one.

OUTPUT FORMAT — strict JSON, no prose, no markdown:
{
  "facts": [
    {
      "fact": "<one-sentence fact in third person, e.g. 'Has a Calculus II midterm on May 20'>",
      "category": "<academic | preference | context | weakness | strength | goal | win | other>",
      "importance": <1-10, where 10 = exam-tomorrow critical, 5 = ongoing context, 1 = trivial>,
      "confidence": <0.0-1.0, how sure you are this is durable and correct — minimum 0.7 to include>
    }
  ]
}

Hard rules:
- Output ONLY the JSON object. No markdown fences. No explanation.
- 0 to 3 facts maximum per extraction.
- Every fact 4-600 chars.
- Skip any fact with confidence < 0.7.`;
}

function buildUserPrompt(messages: { role: string; content: string }[]): string {
  const transcript = messages
    .map((m) => `${m.role === "assistant" ? "AI" : "STUDENT"}: ${m.content}`)
    .join("\n\n");
  return `Here is the recent conversation. Extract 0-3 durable facts.\n\n---\n${transcript}\n---`;
}

async function callClaudeForFacts(systemPrompt: string, userPrompt: string): Promise<ExtractedFact[]> {
  if (!ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY missing");
  }
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 800,
      temperature: 0.2,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${await safeText(res)}`);
  }
  const json = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const text = json?.content?.find((b) => b.type === "text")?.text || "";
  return parseFacts(text);
}

/** Tolerant JSON parser — strips markdown fences, finds the JSON object. */
function parseFacts(raw: string): ExtractedFact[] {
  if (!raw) return [];
  let cleaned = raw.trim();
  // Drop markdown fences if Claude wrapped the JSON despite instructions.
  cleaned = cleaned.replace(/^```(?:json|JSON)?\s*\n?/m, "").replace(/\n?```\s*$/m, "");
  // Find the first `{` and last `}` to handle prose around the JSON.
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return [];
  const slice = cleaned.slice(start, end + 1);
  try {
    const obj = JSON.parse(slice) as { facts?: unknown };
    if (!Array.isArray(obj.facts)) return [];
    const out: ExtractedFact[] = [];
    for (const item of obj.facts) {
      if (!item || typeof item !== "object") continue;
      const it = item as Record<string, unknown>;
      const fact = typeof it.fact === "string" ? it.fact.trim() : "";
      if (fact.length < 4 || fact.length > 600) continue;
      const category = typeof it.category === "string" ? it.category.toLowerCase().trim() : "other";
      const importance = typeof it.importance === "number" ? it.importance : 5;
      const confidence = typeof it.confidence === "number" ? it.confidence : 0;
      if (confidence < 0.7) continue;
      out.push({ fact, category, importance, confidence });
    }
    return out.slice(0, 3);
  } catch {
    return [];
  }
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function normalizeFact(s: string): string {
  return (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

async function safeText(res: Response): Promise<string> {
  try { return await res.text(); } catch { return "<unreadable>"; }
}

function json(payload: unknown, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

/** Fetch the messages JSONB column from the appropriate session table.
 *  Runs as the user via RLS, so this can only return rows the caller
 *  owns. Returns [] on any failure. */
async function fetchSessionMessages(
  persona: "omar" | "noor",
  sessionId: string,
  authHeader: string,
): Promise<{ role: string; content: string }[]> {
  if (!authHeader || !SUPABASE_URL || !SUPABASE_ANON_KEY) return [];
  const table = persona === "noor" ? "wellbeing_sessions" : "tutor_sessions";
  const url = `${SUPABASE_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(sessionId)}&select=messages&limit=1`;
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: authHeader,
        apikey: SUPABASE_ANON_KEY,
      },
    });
    if (!res.ok) return [];
    const rows = (await res.json()) as Array<{ messages?: unknown }>;
    if (!Array.isArray(rows) || rows.length === 0) return [];
    const raw = rows[0]?.messages;
    if (!Array.isArray(raw)) return [];
    // Same shape the chat endpoints store: [{role, content, ts}].
    // We use only role + content; ts is irrelevant for extraction.
    // Cap at the last 20 turns to keep the Haiku call small.
    return raw
      .filter((m): m is { role?: unknown; content?: unknown } =>
        !!m && typeof m === "object")
      .slice(-20)
      .map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: typeof m.content === "string" ? m.content.slice(0, 2000) : "",
      }))
      .filter((m) => m.content.length > 0);
  } catch {
    return [];
  }
}
