export const config = { runtime: "edge" };

/**
 * /api/ai/aurora — Tony Starrk in LIFE mode.
 *
 * Powers ai.basudrus.com (the Aurora app) ONLY. basudrus.com uses
 * api/ai/tutor.ts — never this one.
 *
 * Deliberately separated from tutor.ts so that:
 *   1. Edits to Aurora's personality / scope / guardrails happen in
 *      one place (api/ai/_prompts/aurora-prompt.ts) and physically
 *      cannot affect the tutoring brain.
 *   2. The tutoring brain stays academic-focused without bloat from
 *      life-coach concerns it doesn't need.
 *   3. Rate limits, models, and infrastructure choices can diverge
 *      between the two surfaces without cross-impact.
 *
 * What's SHARED with tutor.ts (intentionally):
 *   - Same Supabase project, same user accounts, same JWT
 *   - Same student_memory table — Aurora knows whatever Tony the
 *     tutor knows about the user (name, uni, year, durable facts)
 *     and vice versa. One unified you.
 *   - Same ai-guard helpers (auth, rate limit, CORS, body cap)
 *
 * What's UNIQUE to Aurora:
 *   - The system prompt (life-mode scope + non-negotiable safety
 *     guardrails for legal / medical / mental-health / money)
 *   - This endpoint's rate limits (tuned for conversational use,
 *     including hands-free voice mode)
 *   - No academic context: no subjects, modes, ground truth fetches,
 *     past papers, professor cache, spaced repetition — none of it
 *     belongs here.
 */

import {
  ALLOWED_ORIGINS,
  securityHeaders,
  readCappedJson,
  checkRateLimit,
  rateLimitResponse,
  sanitizeMessages,
  sanitizeLine,
  getUserIdFromToken,
  isProUser,
} from "../_lib/ai-guard";
import { fetchStudentMemoryRelevant, renderMemoryBlock } from "../_lib/student-memory";
import { buildAuroraPrompt } from "./_prompts/aurora-prompt";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";

// Aurora is conversational + voice-driven so we lean a bit more
// generous than tutor.ts but still cost-bounded.
const LIMITS = { daily: 50, hourly: 20, minute: 4 };

// 256 KB body cap. Aurora has no file uploads (yet) so we don't need
// the multi-MB allowance tutor.ts needs for PDFs. Keeping it tight
// reduces the cost-amplification surface.
const MAX_BODY_BYTES = 256 * 1024;

// Transient upstream Anthropic statuses worth one retry on. 529 is
// the "overloaded" code Anthropic returns when the cluster is hot.
// Retryable upstream Anthropic statuses. EXPLICITLY EXCLUDES 429
// (rate-limited / quota-exhausted) — the previous policy retried
// 429s with backoff, which AMPLIFIED quota burn 3x when an account
// was already over its plan. Anthropic's standard guidance for
// quota responses is "back off, don't immediately retry"; 5xx and
// 529 (overload) are the only legitimate transient errors here.
const RETRYABLE_STATUSES = new Set([502, 503, 504, 529]);
const RETRY_BACKOFF_MS = [700, 1700];

interface AuroraBody {
  messages?: unknown;
  uni?: unknown;
  major?: unknown;
  year?: unknown;
  studentName?: unknown;
  personality?: unknown;
  lang?: unknown;
}

function isTransient(status: number): boolean {
  return RETRYABLE_STATUSES.has(status);
}

export default async function handler(req: Request): Promise<Response> {
  const origin = req.headers.get("origin");
  const sHeaders = securityHeaders(origin, ALLOWED_ORIGINS);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: sHeaders });
  }
  // GET = pre-warm ping. The client fires this on Aurora mount so the
  // edge function spins up its cold-start (V8 isolate, module imports,
  // SDK initialization) WHILE the user is still reading the page,
  // instead of paying the cold-start tax on the first real message.
  // No auth, no rate limit — just a 200 OK that proves the function
  // is hot. Negligible cost; massive UX win on first send.
  if (req.method === "GET") {
    return new Response(JSON.stringify({ ok: true, warm: true }), {
      status: 200,
      headers: { ...sHeaders, "Content-Type": "application/json" },
    });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...sHeaders, "Content-Type": "application/json" },
    });
  }

  if (!ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ error: "AI is not configured on the server" }), {
      status: 503,
      headers: { ...sHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const authHeader = req.headers.get("authorization");

    // Auth + rate limit in parallel — same pattern tutor.ts uses to
    // avoid an extra serial RTT for free-tier users (the common case).
    const [userId, rateCheck] = await Promise.all([
      getUserIdFromToken(authHeader, SUPABASE_URL, SUPABASE_ANON_KEY),
      checkRateLimit({
        supabaseUrl: SUPABASE_URL,
        supabaseAnonKey: SUPABASE_ANON_KEY,
        authHeader,
        endpoint: "aurora",
        daily: LIMITS.daily,
        hourly: LIMITS.hourly,
        minute: LIMITS.minute,
      }),
    ]);

    if (!isProUser(userId) && !rateCheck.allowed) {
      return rateLimitResponse(rateCheck, sHeaders, {
        cooldown: "Slow down — wait a few seconds between messages",
        minute_limit: "You're sending messages too fast. Take a breath and try again in a minute.",
        hourly_limit: "Hourly limit reached. Take a short break and come back soon.",
        daily_limit: "You've reached today's limit. Come back tomorrow!",
      });
    }

    const { data: body, error: bodyErr } = await readCappedJson<AuroraBody>(req, MAX_BODY_BYTES, sHeaders);
    if (bodyErr) return bodyErr;
    if (!body) {
      return new Response(JSON.stringify({ error: "Missing body" }), {
        status: 400,
        headers: { ...sHeaders, "Content-Type": "application/json" },
      });
    }

    const apiMessages = sanitizeMessages(body.messages);
    if (apiMessages.length === 0) {
      return new Response(JSON.stringify({ error: "No valid messages in request" }), {
        status: 400,
        headers: { ...sHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Per-user context, sanitized ──
    // Same fields the tutor brain uses so the two share grounding
    // even though their prompts diverge. Missing fields fall through
    // as empty strings — buildAuroraPrompt omits empty lines so the
    // prompt doesn't leak placeholder noise to the model.
    const studentName = sanitizeLine(body.studentName, 120);
    const uni = sanitizeLine(body.uni, 200);
    const major = sanitizeLine(body.major, 120);
    const year = sanitizeLine(body.year, 20);
    const personality = sanitizeLine(body.personality, 1200);
    const langRaw = sanitizeLine(body.lang, 4).toLowerCase();
    const lang: "en" | "ar" | "auto" =
      langRaw === "en" || langRaw === "ar" ? langRaw : "auto";

    // ── Shared student_memory ──
    // Aurora reads the SAME memory rows the tutor reads. This is the
    // mechanism that makes Tony feel like one continuous friend across
    // both surfaces — durable facts the user told him on basudrus.com
    // surface here automatically. Best-effort: if the read fails we
    // still answer with no memory block.
    const lastUserMsg = [...apiMessages].reverse().find((m) => m.role === "user");
    const lastUserText = typeof lastUserMsg?.content === "string"
      ? lastUserMsg.content
      : "";
    const memoryRows = await fetchStudentMemoryRelevant({
      supabaseUrl: SUPABASE_URL,
      supabaseAnonKey: SUPABASE_ANON_KEY,
      authHeader,
      limit: 12,
      signal: req.signal,
      query: lastUserText,
      minConfidence: 0,
    }).catch(() => [] as Awaited<ReturnType<typeof fetchStudentMemoryRelevant>>);
    const memoryBlock = renderMemoryBlock(memoryRows);

    // ── Intent detection (cost lever) ──
    // The full tutoring (~113KB) + deep wellbeing (~43KB) prompt
    // blocks together represent ~155KB / ~40k input tokens that
    // Anthropic was being billed for on EVERY message including
    // "hey what's up." Reading the last user message + matching
    // simple keyword regexes lets us include those blocks only when
    // the user is actually asking for help with academics or
    // expressing emotional distress.
    //
    // Why keyword regex and not a classifier LLM call: the
    // classifier itself would cost tokens + add latency. A regex
    // sweep of one sentence is essentially free, and false-negatives
    // are gentle — Tony still has the lightweight scope blocks
    // (mental-health, relationships, productivity) always included
    // so he can handle the topic reasonably even without the deep
    // capability text. The deep blocks add depth, not basic
    // competence.
    //
    // False-positive bias: when ambiguous, include the block.
    // Anthropic billing pain < user-feels-shorthanded pain.
    const ACADEMIC_RE = /\b(homework|exam|test|quiz|study|tutor|teach|explain|professor|syllabus|chapter|textbook|midterm|final|assignment|essay|thesis|paper|grade|gpa|math|calculus|algebra|geometry|statistics|physics|chemistry|biology|history|geography|economics|programming|code|algorithm|equation|formula|theorem|derivative|integral|matrix|vector|function|concept|definition|solve|prove|derive|class|lecture|course|subject|major|cs|engineering|medicine|law|business|finance|marketing|psychology|sociology)\b/i;
    const EMOTIONAL_RE = /\b(sad|sadness|depress|anxious|anxiety|panic|scared|afraid|fear|lonely|alone|overwhelm|stress|stressed|tired|exhausted|burn(?:ed|t)?\s*out|cry|crying|hate myself|hopeless|worthless|useless|failing|failed|broken|lost|grief|grieve|grieving|died|death|breakup|broke up|heart\s?br?oken?|miss(?:ing)?\s+(?:my|him|her|them)|self[- ]?harm|hurt myself|want to die|kill myself|suicid|cant cope|can'?t cope|no point|nothing matters|feel\s+(?:bad|awful|terrible|empty|nothing|numb)|feeling\s+(?:bad|awful|terrible|empty|nothing|numb))\b/i;
    // Quick Arabic-script detection — when the user writes in Arabic,
    // our English keyword regexes won't match, and we'd misclassify
    // genuine asks as "casual." Default to including BOTH blocks
    // when Arabic script is present and the message has any
    // substantive length (>20 chars). Cheap fallback that protects
    // Arabic-speaking users from getting shallow replies.
    const hasArabic = /[؀-ۿ]/.test(lastUserText);
    const wantsTutoring = ACADEMIC_RE.test(lastUserText) || (hasArabic && lastUserText.length > 20);
    const wantsWellbeing = EMOTIONAL_RE.test(lastUserText) || (hasArabic && lastUserText.length > 20);

    // ── System prompt ──
    // buildAuroraPrompt is the ONLY entry point into the personality
    // text. To edit Tony-on-Aurora, edit aurora-prompt.ts.
    const systemPrompt = buildAuroraPrompt({
      studentName,
      uni,
      major,
      year,
      personality,
      memory: memoryBlock || undefined,
      lang,
      // Cost-control flags — gate the giant capability blocks
      includeTutoring: wantsTutoring,
      includeWellbeing: wantsWellbeing,
    });

    // ── Call Anthropic with retry-with-backoff + upstream timeout ──
    // Same transient-status policy as tutor.ts (529 overload, 5xx).
    // Streaming SSE response so the client can render words as they
    // arrive — feels alive in voice mode where every second matters.
    // 25s timeout covers normal streaming responses comfortably;
    // anything longer than that is upstream stuck and should fail
    // fast rather than hold an edge invocation hostage.
    const callAnthropic = () => {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(new Error("Anthropic timeout (25s)")), 25_000);
      // Mirror the client's signal so a user-side disconnect also
      // cancels the upstream request (saves tokens + invocation time).
      if (req.signal.aborted) ctl.abort(req.signal.reason);
      else req.signal.addEventListener("abort", () => ctl.abort(req.signal.reason), { once: true });
      return fetch("https://api.anthropic.com/v1/messages", {
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
          messages: apiMessages,
          stream: true,
        }),
        signal: ctl.signal,
      }).finally(() => clearTimeout(t));
    };

    let response = await callAnthropic();
    for (const delay of RETRY_BACKOFF_MS) {
      if (!response.ok && isTransient(response.status)) {
        await new Promise((r) => setTimeout(r, delay));
        try { await response.body?.cancel(); } catch { /* noop */ }
        response = await callAnthropic();
      }
    }

    if (!response.ok || !response.body) {
      let upstreamMsg = `Anthropic returned ${response.status}`;
      try {
        const j = await response.clone().json();
        if (typeof (j as { error?: { message?: string } })?.error?.message === "string") {
          upstreamMsg = (j as { error: { message: string } }).error.message;
        }
      } catch { /* keep default */ }
      return new Response(JSON.stringify({ error: upstreamMsg }), {
        status: response.status === 529 ? 503 : 500,
        headers: { ...sHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Translate Anthropic SSE → the simpler `data: {content}` shape
    //    the client (useStreamingAI) parses ──
    // Anthropic streams "event: content_block_delta" / "data: {...}"
    // pairs. The client just wants `data: {"content":"chunk"}` lines
    // it can JSON.parse. We translate on the fly, swallowing
    // metadata events the client doesn't need.
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const reader = response.body.getReader();

    const stream = new ReadableStream({
      async start(controller) {
        let buf = "";
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split("\n");
            buf = lines.pop() ?? "";
            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              try {
                const obj = JSON.parse(line.slice(6));
                // content_block_delta is the chunk we forward. Everything
                // else (message_start, ping, message_delta usage stats,
                // message_stop) is upstream noise to the client.
                if (obj?.type === "content_block_delta") {
                  const text = obj?.delta?.text;
                  if (typeof text === "string" && text.length > 0) {
                    controller.enqueue(
                      encoder.encode(`data: ${JSON.stringify({ content: text })}\n\n`),
                    );
                  }
                }
              } catch { /* tolerate malformed chunks at tail */ }
            }
          }
        } catch {
          // Upstream aborted / network blip. Close the stream cleanly —
          // the client's catch will surface "network" to the user.
        } finally {
          try { controller.close(); } catch { /* already closed */ }
        }
      },
      async cancel() {
        // Client disconnected mid-stream. Cancel the upstream read so
        // Anthropic stops billing tokens for a stream nobody can see.
        try { await reader.cancel(); } catch { /* noop */ }
      },
    });

    return new Response(stream, {
      headers: {
        ...sHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internal error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...sHeaders, "Content-Type": "application/json" },
    });
  }
}
