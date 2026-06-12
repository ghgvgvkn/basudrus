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
import {
  searchTavily,
  shouldSearchAurora,
  renderTavilyBlock,
  extractUrls,
  extractTavily,
  renderExtractBlock,
} from "../_lib/tavily";
import { decideModelTier, strongTierModel } from "../_lib/modelTiering";
import { detectSafetySeverityAcrossMessages, tutorCrisisBlock } from "../_lib/safety";
import { buildAuroraPrompt, buildAuroraSystemField } from "./_prompts/aurora-prompt";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
// Tavily web search (free tier: 1k calls/month). Aurora fires it
// on a broader heuristic than the tutor — see shouldSearchAurora in
// tavily.ts. Missing key = web context silently empty, Tony answers
// from training (degrades gracefully).
const TAVILY_API_KEY = process.env.TAVILY_API_KEY || "";

// PER-USER Zapier MCP wiring.
//
// Each Aurora user has their OWN Zapier MCP server URL stored in
// the user_integrations table (provider='zapier'). On every chat
// turn we look up the calling user's row and pass THEIR URL into
// Anthropic's mcp_servers field — so when client A asks Tony to
// "send Sarah an email," the email goes from CLIENT A's Gmail,
// not anyone else's.
//
// The env var ZAPIER_MCP_URL still exists as a DEVELOPMENT FALLBACK
// only (founder uses it locally to verify wiring without going
// through the full per-user flow). In production, leave it unset
// and every user gets isolated tools via their own row.
//
// SECURITY: the URL is a bearer credential. We fetch it through
// fetchUserZapierUrl which uses the user's JWT — so RLS scopes the
// SELECT to their own row. No service-role bypass. No cross-user
// leakage possible from this code path.
const ZAPIER_MCP_URL_DEV_FALLBACK = process.env.ZAPIER_MCP_URL || "";
// Prompt caching (off by default). When "1"/"true", Tony's big static persona
// prefix is sent as an Anthropic cached block (cache_control: ephemeral) —
// lower latency + input cost on follow-up turns. Behavior-neutral: the model
// sees the identical prompt text either way. Flag-guarded so it can be enabled
// AND instantly reverted via env without a code change (high blast radius:
// this changes the request shape on the live main AI). See buildAuroraSystemField.
const AURORA_PROMPT_CACHE = /^(1|true|yes|on)$/i.test(process.env.AURORA_PROMPT_CACHE || "");

// Aurora is conversational + voice-driven so we lean a bit more
// generous than tutor.ts but still cost-bounded.
const LIMITS = { daily: 50, hourly: 20, minute: 4 };

// 256 KB body cap. Aurora has no file uploads (yet) so we don't need
// the multi-MB allowance tutor.ts needs for PDFs. Keeping it tight
// reduces the cost-amplification surface.
// 1.5 MB (was 256 KB): JARVIS "eyes" attaches a camera frame as
// base64 JPEG (~100-200 KB) alongside the chat history.
const MAX_BODY_BYTES = 1536 * 1024;

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
  /** JARVIS "eyes": base64 JPEG (no data: prefix) of the camera frame
   *  the user asked Tony to look at. Attached to the last user turn.
   *  Same field name as the tutor endpoint's image attachments. */
  imageBase64?: unknown;
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

    // ── JARVIS "eyes" ──
    // A camera frame (base64 JPEG, no data: prefix) rides along when
    // the user asked Tony to LOOK at something. Same field name the
    // tutor endpoint uses (imageBase64) — useStreamingAI already
    // forwards it for every persona, so the client wiring is shared.
    // It becomes an image content block on the LAST user turn. Guards:
    // base64 charset only, ~1 MB cap.
    const frameRaw = typeof body.imageBase64 === "string" ? body.imageBase64 : "";
    const frameBase64 =
      frameRaw.length > 100 && frameRaw.length < 1_400_000 && /^[A-Za-z0-9+/=]+$/.test(frameRaw)
        ? frameRaw
        : "";
    const messagesForApi: Array<Record<string, unknown>> = apiMessages.map((m, i) => {
      if (frameBase64 && i === apiMessages.length - 1 && m.role === "user") {
        return {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/jpeg", data: frameBase64 },
            },
            { type: "text", text: m.content },
          ],
        };
      }
      return { role: m.role, content: m.content };
    });

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

    // ── Shared student_memory + Tavily web search (parallel) ──
    // Aurora reads the SAME memory rows the tutor reads — Tony feels
    // like one continuous friend across both surfaces. The Tavily
    // lookup runs in parallel because it's also cold I/O; serializing
    // them would add ~300-1000ms of unnecessary latency on the
    // research-flavored turns (which are the ones that already feel
    // slow because the model has to read the extra context).
    //
    // Both are best-effort: a failure on either path yields an empty
    // block, and the model answers from training / no-memory. No
    // visible error to the user.
    const lastUserMsg = [...apiMessages].reverse().find((m) => m.role === "user");
    const lastUserText = typeof lastUserMsg?.content === "string"
      ? lastUserMsg.content
      : "";

    // shouldSearchAurora returns null when this turn doesn't warrant
    // a search (most casual messages: "hey," "thanks," "what's up").
    // When non-null, it's the refined query string to hand to Tavily.
    // Skip entirely if TAVILY_API_KEY isn't configured.
    const searchQuery = TAVILY_API_KEY ? shouldSearchAurora(lastUserText) : null;

    // "Send Tony a link, he reads it." Detect pasted URL(s) and fetch their
    // cleaned page text via Tavily /extract. This capability was fully built in
    // tavily.ts but aurora never called it — so a pasted link sat unread and
    // Tony hallucinated about it. Capped at 2 to bound latency + context.
    const linkedUrls = TAVILY_API_KEY ? extractUrls(lastUserText, 2) : [];

    // Fetch THIS USER's Zapier MCP URL in PARALLEL with memory/search/extract
    // instead of after them — removes a full Supabase round-trip from the
    // critical path of every turn. (Was a serial await below.)
    const [memoryRows, tavilyResults, extractResults, userZapierUrl] = await Promise.all([
      fetchStudentMemoryRelevant({
        supabaseUrl: SUPABASE_URL,
        supabaseAnonKey: SUPABASE_ANON_KEY,
        authHeader,
        limit: 12,
        signal: req.signal,
        query: lastUserText,
        minConfidence: 0,
      }).catch(() => [] as Awaited<ReturnType<typeof fetchStudentMemoryRelevant>>),
      searchQuery
        ? searchTavily({
            apiKey: TAVILY_API_KEY,
            query: searchQuery,
            searchDepth: "basic",
            maxResults: 4,
            // No country bias for Aurora — life mode covers the whole
            // world. Tutor uses "jordan" because Bas Udrus is JO-
            // focused; Aurora users ask about anywhere.
            signal: req.signal,
          }).catch(() => [])
        : Promise.resolve([]),
      linkedUrls.length > 0
        ? extractTavily({ apiKey: TAVILY_API_KEY, urls: linkedUrls, signal: req.signal }).catch(() => [])
        : Promise.resolve([]),
      fetchUserZapierUrl(authHeader, req.signal).catch(() => ""),
    ]);

    const memoryBlock = renderMemoryBlock(memoryRows);
    const tavilyBlock = searchQuery ? renderTavilyBlock(searchQuery, tavilyResults) : "";
    const extractBlock = linkedUrls.length > 0 ? renderExtractBlock(extractResults) : "";

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

    // ── ALWAYS-ON SAFETY CHECK (shared with tutor.ts) ──
    // Aurora is the general "open for anything" Tony, so it especially must
    // catch a crisis no matter what the user was talking about. We scan the
    // last few user turns (not just the latest) so a crisis disclosed across
    // two messages — "i've been thinking about something" → "...ending it" —
    // still triggers. On crisis/abuse we prepend a safety block (overrides
    // everything) and force the strong model.
    const recentUserTexts = apiMessages
      .filter((m) => m.role === "user" && typeof m.content === "string")
      .map((m) => m.content as string);
    const safetySeverity = detectSafetySeverityAcrossMessages(recentUserTexts, 3);
    const crisisBlock = tutorCrisisBlock(safetySeverity);
    const inCrisis = crisisBlock.length > 0;
    if (inCrisis) {
      console.log(`[aurora] SAFETY OVERRIDE → ${safetySeverity}`);
    }

    // ── Model tiering ── hard questions, substantive emotional/advice turns,
    // or a crisis use the strong model when SMART_TIER_MODEL is configured;
    // everyday chat stays on fast Haiku. `emotional` lets a wellbeing turn
    // escalate so someone struggling doesn't get a shallow reply.
    const tierDecision = decideModelTier(lastUserText, { emotional: wantsWellbeing });
    const smartModel = strongTierModel();
    const useSmartTier = (tierDecision.escalate || inCrisis) && smartModel.length > 0;
    if (useSmartTier) {
      console.log(`[aurora] model tier → strong (${inCrisis ? "crisis" : tierDecision.reason})`);
    }

    // ── System prompt ──
    // buildAuroraPrompt is the ONLY entry point into the personality
    // text. To edit Tony-on-Aurora, edit aurora-prompt.ts.
    // userZapierUrl was fetched in the Promise.all above (parallel with
    // memory/search) so both consumers — the prompt builder (needs to know
    // whether action tools exist) and the Anthropic call (needs the URL) —
    // stay in lockstep on "does Tony have tools right now?".
    const effectiveZapierUrl = userZapierUrl || ZAPIER_MCP_URL_DEV_FALLBACK;
    const willUseMcp = !!effectiveZapierUrl;

    const promptCtx = {
      studentName,
      uni,
      major,
      year,
      personality,
      memory: memoryBlock || undefined,
      // Live web context: search results (Tavily) + any pasted-link page
      // content (extract). Both carry their own citation rules so Tony
      // attributes facts to the source. Empty when neither applies.
      webContext: [tavilyBlock, extractBlock].filter(Boolean).join("\n\n") || undefined,
      // Action tools awareness — Tony only sees this block when MCP
      // is actually wired (i.e. ZAPIER_MCP_URL is set). Without it,
      // he reverts to talk-only behavior.
      hasMcpTools: willUseMcp,
      lang,
      // Cost-control flags — gate the giant capability blocks
      includeTutoring: wantsTutoring,
      includeWellbeing: wantsWellbeing,
    };

    // Build the system field. On normal turns we can use the cache-aware
    // field (big static persona prefix cached when AURORA_PROMPT_CACHE is on).
    // On CRISIS turns we keep it dead simple: a plain string with the crisis
    // block prepended FIRST — safety must never interact with a caching edge
    // case, and crisis turns are rare so there's nothing to optimize.
    // `system` is either a string or Anthropic system-block array; both are
    // valid request shapes.
    const systemPrompt: string | ReturnType<typeof buildAuroraSystemField> = inCrisis
      ? `${crisisBlock}\n\n${buildAuroraPrompt(promptCtx)}`
      : buildAuroraSystemField(promptCtx, AURORA_PROMPT_CACHE);

    // ── Call Anthropic with retry-with-backoff + upstream timeout ──
    // Same transient-status policy as tutor.ts (529 overload, 5xx).
    // Streaming SSE response so the client can render words as they
    // arrive — feels alive in voice mode where every second matters.
    // 25s timeout covers normal streaming responses comfortably;
    // anything longer than that is upstream stuck and should fail
    // fast rather than hold an edge invocation hostage.
    // ── PER-USER MCP wiring ──
    // effectiveZapierUrl was resolved up front (before the prompt
    // builder) so both consumers see the same truth. See the fetch
    // block ~50 lines above for the lookup logic + dev fallback.

    // MCP servers — Anthropic's MCP client takes the URL, connects,
    // lists the tools the server exposes, hands them to Claude as
    // callable tools, and runs the request/response loop internally.
    // The "anthropic-beta: mcp-client-2025-04-04" header opts in to
    // this feature — Anthropic returns a clear 400 if you try to
    // use mcp_servers without it.
    //
    // When the user hasn't connected Zapier (and the dev fallback
    // is also unset), mcpServers stays empty and the request is
    // identical to the pre-MCP path. Zero new failure modes for
    // users without it configured.
    const mcpServers: Array<{
      type: "url";
      url: string;
      name: string;
    }> = [];
    if (effectiveZapierUrl) {
      mcpServers.push({ type: "url", url: effectiveZapierUrl, name: "zapier" });
    }
    const useMcp = mcpServers.length > 0;

    const callAnthropic = () => {
      const ctl = new AbortController();
      // 25s default; bump to 45s when MCP is in play because the
      // round-trip is server→Anthropic→MCP-server→tool→...→Anthropic
      // →stream, and the per-tool latency stacks. Vercel edge has a
      // 30s default — we'll cap at 28s in that case so the function
      // doesn't get killed mid-stream by the platform.
      const timeoutMs = useMcp ? 28_000 : 25_000;
      const t = setTimeout(
        () => ctl.abort(new Error(`Anthropic timeout (${timeoutMs / 1000}s)`)),
        timeoutMs,
      );
      // Mirror the client's signal so a user-side disconnect also
      // cancels the upstream request (saves tokens + invocation time).
      if (req.signal.aborted) ctl.abort(req.signal.reason);
      else req.signal.addEventListener("abort", () => ctl.abort(req.signal.reason), { once: true });
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      };
      if (useMcp) {
        // Required beta header for the mcp_servers field. Without
        // this, Anthropic responds 400 "unknown field mcp_servers".
        headers["anthropic-beta"] = "mcp-client-2025-04-04";
      }
      const body: Record<string, unknown> = {
        // Model tiering: hard questions / crisis → strong model when configured;
        // everyday chat stays on fast Haiku. useSmartTier already required a
        // non-empty smartModel.
        model: useSmartTier ? smartModel : "claude-haiku-4-5-20251001",
        max_tokens: useSmartTier ? 3000 : 1500,
        system: systemPrompt,
        messages: messagesForApi,
        stream: true,
      };
      if (useMcp) {
        body.mcp_servers = mcpServers;
      }
      return fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: ctl.signal,
      }).finally(() => clearTimeout(t));
    };

    let response = await callAnthropic();
    for (const delay of RETRY_BACKOFF_MS) {
      // Stop the moment we have a usable response — no point iterating the
      // remaining backoffs once we're ok.
      if (response.ok) break;
      // Only retry transient upstream failures (529 overload / 5xx).
      if (!isTransient(response.status)) break;
      // Don't re-fire the EXPENSIVE smart-tier turn (Fable/Sonnet at 3000
      // tokens) up to 3×: one strong attempt, then fall through to the error
      // path. Cheap Haiku turns still get the full retry budget.
      if (useSmartTier) break;
      await new Promise((r) => setTimeout(r, delay));
      try { await response.body?.cancel(); } catch { /* noop */ }
      response = await callAnthropic();
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
        // Track whether we've already injected an "[invoking <tool>]"
        // hint for the current tool_use block, so we don't print
        // the line on every chunk of the same tool's serialized args.
        let lastToolHinted = "";
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
                // Plain text deltas — the main content stream.
                if (obj?.type === "content_block_delta") {
                  const text = obj?.delta?.text;
                  if (typeof text === "string" && text.length > 0) {
                    controller.enqueue(
                      encoder.encode(`data: ${JSON.stringify({ content: text })}\n\n`),
                    );
                  }
                  continue;
                }

                // MCP tool-use events — when Tony decides to call a
                // Zapier integration. The streaming sequence looks
                // like:
                //   content_block_start  { content_block: {type: "mcp_tool_use", name, server_name, ...} }
                //   content_block_delta  { delta: { partial_json: "..." } }   (tool args building up)
                //   content_block_stop
                //   content_block_start  { content_block: {type: "mcp_tool_result", is_error, content: [...]} }
                //   content_block_stop
                //
                // We surface a single human-readable hint when each
                // tool call starts ("[Pulling up your calendar…]")
                // so the user sees Tony "doing" things instead of a
                // silent pause. Result blocks are forwarded silently
                // (Tony's NEXT text reply already incorporates them).
                if (obj?.type === "content_block_start") {
                  const block = obj?.content_block;
                  if (block?.type === "mcp_tool_use" && block?.name) {
                    const toolName = String(block.name);
                    const serverName = String(block.server_name ?? "tools");
                    const hintKey = `${serverName}:${toolName}`;
                    if (hintKey !== lastToolHinted) {
                      lastToolHinted = hintKey;
                      const friendly = friendlyToolHint(serverName, toolName);
                      controller.enqueue(
                        encoder.encode(
                          `data: ${JSON.stringify({ content: `\n_${friendly}_\n` })}\n\n`,
                        ),
                      );
                    }
                  }
                  continue;
                }
                // Anthropic also emits a top-level mcp_tool_use event
                // shape in some SDK versions; handle that too so we
                // don't miss the hint.
                if (obj?.type === "mcp_tool_use" && obj?.name) {
                  const toolName = String(obj.name);
                  const serverName = String(obj.server_name ?? "tools");
                  const hintKey = `${serverName}:${toolName}`;
                  if (hintKey !== lastToolHinted) {
                    lastToolHinted = hintKey;
                    const friendly = friendlyToolHint(serverName, toolName);
                    controller.enqueue(
                      encoder.encode(
                        `data: ${JSON.stringify({ content: `\n_${friendly}_\n` })}\n\n`,
                      ),
                    );
                  }
                  continue;
                }
                // Everything else (message_start, ping, content_block_stop
                // for text blocks, message_delta usage stats,
                // message_stop, tool result blocks) is upstream
                // noise to the client.
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
    // Don't leak internal exception detail to the client — log it
    // server-side and return a generic message (matches tutor.ts /
    // wellbeing.ts, which both return a static "Server error"). A raw
    // e.message can expose Supabase URLs, upstream fetch failures, and
    // other internals to anyone hitting the endpoint.
    console.error("[aurora] request failed:", e);
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
      headers: { ...sHeaders, "Content-Type": "application/json" },
    });
  }
}

/**
 * Fetch THIS USER's Zapier MCP URL from user_integrations.
 *
 * Uses the caller's JWT as the auth header — Supabase RLS scopes
 * the SELECT to their own row, so this can ONLY ever return the
 * calling user's URL. No cross-user leakage possible from this
 * function. If the user has no row (hasn't connected Zapier yet),
 * returns null and aurora.ts skips the mcp_servers field entirely.
 *
 * Best-effort. Network errors / missing config / Supabase down all
 * resolve to null — Tony just operates without action tools rather
 * than failing the whole chat turn. The user can connect Zapier
 * in Settings > Integrations and try again.
 *
 * IMPORTANT: never logs the URL. The URL is a bearer credential
 * for the user's Zapier integrations; logging it would be a leak.
 */
async function fetchUserZapierUrl(
  authHeader: string | null,
  signal: AbortSignal,
): Promise<string> {
  if (!authHeader || !SUPABASE_URL || !SUPABASE_ANON_KEY) return "";
  const url =
    `${SUPABASE_URL}/rest/v1/user_integrations` +
    `?provider=eq.zapier&select=endpoint_url&limit=1`;
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: authHeader,
        apikey: SUPABASE_ANON_KEY,
      },
      signal,
    });
    if (!res.ok) return "";
    const rows = (await res.json()) as Array<{ endpoint_url?: string }>;
    if (!Array.isArray(rows) || rows.length === 0) return "";
    const u = rows[0]?.endpoint_url;
    if (typeof u !== "string" || u.length < 10) return "";
    // Defense in depth: the value is user-supplied (stored per-user), so
    // validate scheme + host by PARSING the URL. A substring check like
    // `u.includes("zapier.com")` would wrongly accept a spoof such as
    // `https://evil.com/?x=zapier.com` and hand a bearer-credentialed
    // endpoint to the MCP client. Require https and a hostname that is
    // exactly `zapier.com` or a `*.zapier.com` subdomain (mcp.zapier.com,
    // hooks.zapier.com, …). The settings UI also validates on save.
    try {
      const parsed = new URL(u);
      const host = parsed.hostname.toLowerCase();
      const hostOk = host === "zapier.com" || host.endsWith(".zapier.com");
      if (parsed.protocol !== "https:" || !hostOk) return "";
    } catch {
      return ""; // unparseable URL
    }
    return u;
  } catch {
    // Network / abort / parse error — return empty (talk-only mode).
    return "";
  }
}

/**
 * Friendly inline hint for an MCP tool invocation.
 *
 * Zapier tool names are machine-keyed slugs like
 * "gmail_send_email" / "google_calendar_create_event" /
 * "slack_send_channel_message". Showing the slug in the chat would
 * leak implementation details. We map common Zapier action stems to
 * a "Tony's doing X" phrase that matches his voice (action verbs,
 * present continuous — "pulling up your calendar," "drafting an
 * email…"). Falls back to a generic "running <tool>…" for anything
 * we don't have a specific phrase for.
 *
 * Keep these SHORT — they appear inline mid-reply, italicized, and
 * shouldn't pull attention from Tony's actual answer.
 */
function friendlyToolHint(serverName: string, toolName: string): string {
  const t = toolName.toLowerCase();
  // Gmail
  if (t.includes("gmail") && t.includes("send")) return "drafting an email…";
  if (t.includes("gmail") && (t.includes("find") || t.includes("search"))) return "checking your inbox…";
  if (t.includes("gmail") && t.includes("reply")) return "drafting a reply…";
  // Calendar
  if (t.includes("calendar") && t.includes("create")) return "creating a calendar event…";
  if (t.includes("calendar") && (t.includes("find") || t.includes("list") || t.includes("get"))) return "pulling up your calendar…";
  if (t.includes("calendar") && t.includes("update")) return "updating your calendar…";
  // Slack
  if (t.includes("slack") && t.includes("send")) return "sending the Slack message…";
  if (t.includes("slack") && (t.includes("find") || t.includes("search"))) return "searching Slack…";
  // Notion
  if (t.includes("notion") && (t.includes("create") || t.includes("add"))) return "writing to Notion…";
  if (t.includes("notion") && (t.includes("find") || t.includes("query") || t.includes("search"))) return "checking Notion…";
  // Sheets / Docs
  if (t.includes("sheet") && (t.includes("add") || t.includes("create") || t.includes("update"))) return "updating your spreadsheet…";
  if (t.includes("sheet") && (t.includes("get") || t.includes("find") || t.includes("lookup"))) return "checking your spreadsheet…";
  if (t.includes("doc") && (t.includes("create") || t.includes("add"))) return "writing the doc…";
  // Reminders / tasks
  if (t.includes("todoist") || t.includes("task") || t.includes("reminder")) return "adding to your list…";
  // SMS / WhatsApp
  if (t.includes("sms") || t.includes("twilio") || t.includes("whatsapp")) return "sending the text…";
  // Generic fallback — use the server name so the user at least
  // knows it's Zapier doing it and not Tony hallucinating.
  return `running ${serverName} ${t.replace(/_/g, " ")}…`;
}
