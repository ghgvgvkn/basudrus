/**
 * Aurora prompt ASSEMBLER — composes the per-scope files into
 * the full system prompt sent to Anthropic on every Aurora chat.
 *
 * THIS FILE DOES NOT HOLD PROMPT TEXT. It only imports + arranges
 * other files. To edit what Tony says or how he behaves on Aurora,
 * open the right scope file:
 *
 *   aurora-core.ts             ← Identity (who Tony Starrk IS)
 *   aurora-tony-voice.ts       ← Tony-specific speech patterns
 *                                (nicknames, pop-culture, joke-rhythm)
 *   aurora-mental-health.ts    ← Wellbeing / emotional support
 *   aurora-relationships.ts    ← Friendships, family, dating, social
 *   aurora-legal.ts            ← Legal concepts (NOT advice)
 *   aurora-business.ts         ← Career, business, money concepts
 *   aurora-productivity.ts     ← Planning, time, habits
 *   aurora-honesty.ts          ← Direct-not-cruel calibration
 *   aurora-safety.ts           ← Hard guardrails (CRITICAL — read first)
 *   aurora-style.ts            ← Universal output format (length,
 *                                audio, no emoji, no markdown)
 *
 * SINGLE-PERSONA CONTRACT
 * Tony Starrk is the only voice on Aurora. There is no "generic mode,"
 * no separate "tutor persona," no "Sherlock." All the topic files
 * below — tutoring, wellbeing, legal, etc. — describe SKILLS Tony
 * draws on. They are not separate identities that activate by topic.
 * aurora-core.ts states this rule explicitly at the very top of the
 * composed prompt so it anchors before any skill block.
 *
 * Per-call context (user's name, university, memory rows, language
 * lock) is built and appended here so the scope files stay pure prose
 * and don't need to know about runtime data.
 *
 * ORDER MATTERS. The current order is:
 *   CORE → SCOPE files → HONESTY → STYLE → context → SAFETY (last)
 *
 * SAFETY comes last on purpose: when two rules in the prompt conflict,
 * later instructions tend to win with Anthropic's models. By placing
 * safety last we make it harder for an earlier instruction (or for the
 * user, via prompt injection in chat history / attached docs) to
 * override a safety rule.
 *
 * basudrus.com is COMPLETELY UNAFFECTED by anything in this folder.
 * That product uses api/ai/tutor.ts which doesn't import any of these
 * files.
 */

import { AURORA_CORE } from "./aurora-core";
import { AURORA_TONY_VOICE } from "./aurora-tony-voice";
import { AURORA_MENTAL_HEALTH } from "./aurora-mental-health";
import { AURORA_WELLBEING } from "./aurora-wellbeing";
import { AURORA_RELATIONSHIPS } from "./aurora-relationships";
import { AURORA_LEGAL } from "./aurora-legal";
import { AURORA_BUSINESS } from "./aurora-business";
import { AURORA_PRODUCTIVITY } from "./aurora-productivity";
import { AURORA_HONESTY } from "./aurora-honesty";
import { AURORA_VISUALS } from "./aurora-visuals";
import { AURORA_CINEMATIC } from "./aurora-cinematic";
import { AURORA_SAFETY } from "./aurora-safety";
import { AURORA_STYLE } from "./aurora-style";
import { AURORA_TUTORING_CORE } from "./aurora-tutoring-core";
import { AURORA_TUTORING_ENRICHMENT } from "./aurora-tutoring-enrichment";
import { AURORA_TOOL_REALITY_OVERRIDE } from "./aurora-tool-reality";

/**
 * Build the full Aurora system prompt for a single chat call.
 *
 * @param ctx Per-user context block. All fields optional — the prompt
 *            adapts gracefully when they're missing (e.g. first-time
 *            user with no profile yet).
 */
export function buildAuroraPrompt(ctx: {
  /** Student's display name, sanitized. Empty string = unknown. */
  studentName?: string;
  /** University / major / year — Aurora uses these for grounding
   *  ("with a CS degree in your final year..."). Same fields the
   *  tutor brain uses; single source of truth in the profiles table. */
  uni?: string;
  major?: string;
  year?: string | number;
  /** Personality summary from match_quiz. Drives tone calibration. */
  personality?: string;
  /** Pre-rendered durable-memory block (or empty). The aurora.ts
   *  endpoint already formats this via renderMemoryBlock — we just
   *  paste it through. */
  memory?: string;
  /** Locale lock (en | ar | auto). When "auto", Tony matches the
   *  user's most recent message language. */
  lang?: "en" | "ar" | "auto";
  /** When true, include AURORA_TUTORING_CORE + _ENRICHMENT (~113KB).
   *  When false, skip them. Default true (preserves old behavior on
   *  callers that don't pass the flag). The aurora.ts endpoint sets
   *  this based on whether the user's last message looks academic;
   *  see the intent-detection block there for the cost rationale. */
  includeTutoring?: boolean;
  /** When true, include AURORA_WELLBEING (~43KB deep capability).
   *  When false, skip it. Default true. The aurora.ts endpoint
   *  gates this on emotional keywords detected in the last user
   *  message. */
  includeWellbeing?: boolean;
  /** Pre-rendered Tavily "RECENT WEB CONTEXT" block (or empty).
   *  When non-empty, the model can read live web results inline in
   *  the prompt — the same retrieval pattern tutor.ts uses. The
   *  aurora.ts endpoint formats this via renderTavilyBlock; we just
   *  paste it through. The block already contains "MUST cite source
   *  domain" instructions so Tony attributes claims honestly. */
  webContext?: string;
  /** When true, the API call includes mcp_servers (currently Zapier).
   *  Tells Tony in the system prompt that he genuinely has callable
   *  action tools — send email, create calendar event, etc. — and
   *  to USE them when the user asks for an action, not just to
   *  describe what they'd do. Without this flag, Tony defaults to
   *  the no-tools behavior (talk-only). */
  hasMcpTools?: boolean;
}): string {
  const halves = buildAuroraPromptHalves(ctx);
  return [...halves.staticSections, ...halves.dynamicSections].join("\n\n");
}

/**
 * Internal: build the prompt as two arrays — the STATIC (cacheable) prefix
 * and the DYNAMIC (per-turn) suffix. Both buildAuroraPrompt (string) and
 * buildAuroraSystemField (cache-aware) consume this so there is ONE source
 * of truth for ordering/content and zero drift between the two paths.
 */
function buildAuroraPromptHalves(ctx: Parameters<typeof buildAuroraPrompt>[0]): {
  staticSections: string[];
  dynamicSections: string[];
} {
  const name = (ctx.studentName ?? "").trim();
  const uni = (ctx.uni ?? "").trim();
  const major = (ctx.major ?? "").trim();
  const year = ctx.year != null ? String(ctx.year).trim() : "";
  const personality = (ctx.personality ?? "").trim();
  const memory = (ctx.memory ?? "").trim();
  const webContext = (ctx.webContext ?? "").trim();
  const hasMcpTools = ctx.hasMcpTools === true;
  const lang = ctx.lang ?? "auto";
  // Default the giant capability blocks to INCLUDED if a caller
  // doesn't pass the flag — preserves the legacy behavior for any
  // call site that hasn't been updated to do intent detection.
  // The aurora.ts endpoint sets these explicitly based on keyword
  // detection on the user's last message; see the [Intent detection]
  // block there for the cost rationale.
  const includeTutoring = ctx.includeTutoring !== false;
  const includeWellbeing = ctx.includeWellbeing !== false;

  // Per-user context block — only includes the fields we actually have,
  // so empty profile values don't leak placeholder noise to the model.
  const ctxLines: string[] = [];
  if (name) ctxLines.push(`Their name is ${name}.`);
  if (uni) ctxLines.push(`They go to ${uni}.`);
  if (major) ctxLines.push(`They study ${major}.`);
  if (year) ctxLines.push(`They're in year ${year}.`);
  if (personality) ctxLines.push(`Personality cues: ${personality}.`);
  if (memory) ctxLines.push(`What you remember about them:\n${memory}`);
  const ctxBlock = ctxLines.length > 0
    ? `\n\n# About the person you're talking to\n${ctxLines.join("\n")}`
    : "";

  const langLock = lang === "ar"
    ? "\n\nLANGUAGE: Reply in Arabic."
    : lang === "en"
      ? "\n\nLANGUAGE: Reply in English."
      : "\n\nLANGUAGE: Match the user's most recent message language.";

  // Compose. Each block is separated by a blank line so Anthropic
  // sees them as distinct sections rather than a wall of text.
  // SAFETY is placed LAST — see the file header for why.
  //
  // ORDERING NOTE for tutoring + wellbeing blocks:
  // AURORA_TUTORING_* and AURORA_WELLBEING are copies of basudrus.com's
  // own prompts. They include their own "You are Tony Starrk / You are
  // Sherlock" identity lines. Placed AFTER the core/scope sections,
  // they read as additional CAPABILITY blocks ("when teaching mode is
  // active, here's how..." / "when mental-health support is needed,
  // here's the deep approach..."). If they ever start to dominate
  // unexpectedly, consider gating them in the endpoint (only inject
  // when the last user message looks academic/emotional).
  // STATIC sections — identical text on every turn for a given
  // tutoring/wellbeing gate combination. These form the cacheable prefix
  // (see buildAuroraSystemField): big persona prose that doesn't change
  // turn-to-turn. The DYNAMIC sections (per-user context, live web,
  // MCP awareness, language lock, safety) follow and are never cached
  // because they change every turn / must stay last.
  const staticSections = [
    // Identity FIRST — this establishes who Tony is before anything
    // else (capabilities, topic rules, voice patterns). The model
    // anchors to whatever's at the top.
    AURORA_CORE,
    // Then the voice — HOW Tony talks. Placed right after identity
    // so cadence/nicknames/joke-rhythm are set before any scope
    // file tries to define behavior for itself.
    AURORA_TONY_VOICE,
    "# What you help with",
    AURORA_MENTAL_HEALTH,
    AURORA_RELATIONSHIPS,
    AURORA_LEGAL,
    AURORA_BUSINESS,
    AURORA_PRODUCTIVITY,
    AURORA_HONESTY,
    AURORA_STYLE,
    AURORA_VISUALS,
    // Cinematic direction — when/how to use the workspace artifacts
    // for that "JARVIS pulls it up while he talks" feel. Sits AFTER
    // visuals so it reinforces those rules with stage-direction
    // cues without contradicting the underlying when-to-emit logic.
    AURORA_CINEMATIC,
    // Capability deep-dives. These are LARGE (~155KB total) and
    // gated by the includeTutoring/includeWellbeing flags so they
    // only ship when the user's last message actually warrants
    // them. Without gating, every "hey" exchange was billing the
    // full block — see the file header for why.
    includeTutoring && "# Tutoring capability (use when the user asks about academic work)",
    includeTutoring && AURORA_TUTORING_CORE,
    includeTutoring && AURORA_TUTORING_ENRICHMENT,
    // AURORA-MODE OVERRIDE — corrects a capability lie in
    // AURORA_TUTORING_CORE. That prompt is shared with tutor.ts and
    // says "you have a web_search tool" with a MANDATORY professor
    // research protocol. tutor.ts actually configures the Anthropic
    // native web_search tool — Aurora does NOT. Aurora uses the
    // pre-fetched Tavily pattern (shouldSearchAurora → renderTavily
    // → RECENT WEB CONTEXT block below). Without this override,
    // Tony would promise "let me search" and never deliver because
    // there's no tool to call. Only injected when tutoring is in
    // scope (the only block that lies about web_search). When the
    // override is silent, Tony's behavior is unchanged.
    includeTutoring && AURORA_TOOL_REALITY_OVERRIDE,
    includeWellbeing && "# Mental-health depth (use when the user needs serious emotional support)",
    includeWellbeing && AURORA_WELLBEING,
  ].filter((s): s is string => typeof s === "string" && s.length > 0);

  // DYNAMIC sections — change per turn (user context, live web/links,
  // MCP awareness which depends on the user's connection, language lock)
  // or must stay LAST (safety). Never part of the cached prefix.
  const dynamicSections = [
    ctxBlock.trim() ? ctxBlock.trim() : "",
    // Web context lands among the data blocks (right before langLock +
    // safety) so Tony sees live retrieval AFTER his persona is anchored —
    // search results are tools the persona uses, not the persona itself.
    webContext,
    // Zapier MCP tools awareness — only shown when the API call actually
    // wired up mcp_servers. Tells Tony he genuinely has callable actions.
    hasMcpTools && buildMcpAwarenessBlock(),
    // INVERSE — when MCP is NOT wired, teach Tony to invite the user to
    // connect Zapier in Settings rather than refuse or hallucinate.
    !hasMcpTools && buildMcpUnconnectedHintBlock(),
    langLock.trim(),
    AURORA_SAFETY,
  ].filter((s): s is string => typeof s === "string" && s.length > 0);

  return { staticSections, dynamicSections };
}

/**
 * Cache-aware system field for the Anthropic call.
 *
 * WHY (the "deep inside, how it works" upgrade): Tony's persona prose is
 * 40–155KB and identical turn-to-turn, but today it's re-sent and re-billed
 * on EVERY message — the way an un-optimized assistant works. Anthropic's
 * prompt caching lets us send the big static prefix once and have it reused:
 * dramatically lower time-to-first-word and input cost on follow-up turns.
 * This is standard practice in production assistants (ChatGPT/Claude do the
 * equivalent internally).
 *
 * BEHAVIOR-NEUTRAL: the model sees the EXACT same text either way. We only
 * change the request SHAPE:
 *   - cache off → a single system STRING (current behavior, byte-identical)
 *   - cache on  → an array of text blocks; the last STATIC block carries
 *     `cache_control: { type: "ephemeral" }` so everything up to and
 *     including it is cached. Dynamic blocks (user context, live web, MCP,
 *     language lock, safety) follow UNCACHED so they stay fresh + safety
 *     stays last.
 *
 * Concatenating the returned blocks' text with "\n\n" reproduces
 * buildAuroraPrompt(ctx) exactly — verified by scripts/tests/aurora-prompt-cache.test.mjs.
 *
 * @param enableCache when false (default), returns the plain string — zero
 *        behavior change, the safe default. The caller flips this on via the
 *        AURORA_PROMPT_CACHE env flag so it can be enabled/reverted without a
 *        code change.
 */
export type AnthropicSystemBlock = {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
};

export function buildAuroraSystemField(
  ctx: Parameters<typeof buildAuroraPrompt>[0],
  enableCache = false,
): string | AnthropicSystemBlock[] {
  const halves = buildAuroraPromptHalves(ctx);
  const staticText = halves.staticSections.join("\n\n");
  const dynamicText = halves.dynamicSections.join("\n\n");

  // Default / disabled path: identical to buildAuroraPrompt — one string.
  if (!enableCache) {
    return [staticText, dynamicText].filter(Boolean).join("\n\n");
  }

  // Enabled path: static prefix as a cached block, dynamic as a fresh block.
  const blocks: AnthropicSystemBlock[] = [];
  if (staticText) {
    blocks.push({ type: "text", text: staticText, cache_control: { type: "ephemeral" } });
  }
  if (dynamicText) {
    blocks.push({ type: "text", text: dynamicText });
  }
  // Edge case: if somehow both empty, return an empty string (Anthropic
  // rejects an empty system array). Won't happen in practice (CORE is always
  // present) but defensive.
  return blocks.length > 0 ? blocks : "";
}

/**
 * Tells Tony to nudge the user toward connecting Zapier when they
 * ask for an action but haven't connected anything yet. Without
 * this, Tony will either refuse ("I can't send emails") or
 * hallucinate ("I sent the email"). Both are worse than "you can
 * unlock this in Settings → Integrations."
 */
function buildMcpUnconnectedHintBlock(): string {
  return `# Action requests when no tools are connected

You do NOT have any callable action tools wired in for this user
right now — they haven't connected anything in Settings →
Integrations yet. So you can talk, research, remember, show
things — but you can't actually send messages, modify calendars,
post anywhere, etc.

If the user asks you to DO something that would require a tool
(send an email, check their calendar, post to Slack, add a
reminder, create a task), the right move is:

  1. Acknowledge what they're asking for in one short sentence.
  2. Tell them the path to unlock it — naturally, not as a
     marketing pitch. Something like:
       "I can do that the moment you connect Zapier. Tap your
        avatar → Settings → Integrations → Zapier, paste the
        URL Zapier gives you, and I'll handle it from then on."
  3. Offer the next-best thing you CAN do (draft the email
     text for them to copy, write out the calendar event details,
     etc.) so they're not stranded.

Do NOT:
  - Pretend you sent / created / posted something. You can't.
  - Apologize at length or make it feel like the product is
    broken. It's a one-time setup, not a missing feature.
  - Recite the steps in a way that sounds like a help article.
    One natural sentence, then move on.

EXAMPLES

User: "Send mom an email asking her if she needs anything from
       the store on my way home"
You:  "Sweet. I can fire that the moment Zapier's connected —
       Settings → Integrations → paste your Zapier URL. Until
       then, here's the draft so you can send it from your
       phone:

       Subject: store run
       Body: heading to the store in a bit, want me to grab
       anything for you?

       Want me to make it warmer / shorter / different?"

User: "what's on my calendar tomorrow"
You:  "Can't see your calendar yet — connect Zapier under
       Settings → Integrations and I will. Once that's done,
       'what's on my calendar' becomes one of my favorite
       questions. Want me to teach you the setup in 30 seconds?"

This is one-time friction the user pays ONCE. After that, you can
do everything they ask. Be honest about the gate, helpful through
it, then it's gone forever.`;
}

/**
 * Tells Tony he has real action tools when MCP is wired.
 *
 * Injected only when aurora.ts passed hasMcpTools=true (which it
 * does when ZAPIER_MCP_URL is configured). Without this block, Tony
 * sees the tools in his tool list but doesn't have prompt-level
 * guidance on WHEN to use them vs. just describe what would happen
 * — leading him to describe the email he'd send instead of
 * actually drafting it via the tool.
 */
function buildMcpAwarenessBlock(): string {
  return `# Action tools — you can actually DO things

You have callable tools wired in (via Zapier MCP — names look like
"gmail_send_email," "google_calendar_create_event," "slack_send_
direct_message"). These aren't descriptions of what's possible;
they're actions you can invoke right now in this conversation.

When the user asks for an action:
  - "send John an email saying I'll be late" → call gmail_send_email
  - "what's on my calendar tomorrow" → call the calendar list tool
  - "DM Ahmed on Slack 'meeting moved to 4pm'" → call slack_send_direct_message
  - "remind me to email Sara on Friday" → calendar event or reminder tool
DO IT. Don't just describe what you'd do. The user expects action.

Before destructive actions (send email, post message, create event,
delete anything), CONFIRM the details in one line: "Sending to
john@x.com: 'I'll be 20 min late, see you at 3' — fire it?" Wait
for "yes/go/send" before calling the tool. Read-only actions
(check calendar, search inbox) you can do without asking.

When you call a tool, the server runs it and gives you back the
result. Then respond in YOUR voice — confirm what happened in one
short line, don't recite the full tool output:
  ✓ "Sent. Anything else?"
  ✓ "You're free 2-4pm tomorrow. Want me to block 3pm for the call?"
  ✗ "Tool returned: { status: 'success', messageId: '...', ... }"

If a tool fails or isn't connected, say so plainly: "I tried to
send it but Gmail isn't connected — can you connect it in Zapier?"
Don't pretend it worked.

You do NOT have tools for: anything Zapier doesn't expose. If the
user asks for something that needs a tool you don't see in your
available list, say "I don't have that one wired in yet" — don't
hallucinate a call.`;
}
