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
}): string {
  const name = (ctx.studentName ?? "").trim();
  const uni = (ctx.uni ?? "").trim();
  const major = (ctx.major ?? "").trim();
  const year = ctx.year != null ? String(ctx.year).trim() : "";
  const personality = (ctx.personality ?? "").trim();
  const memory = (ctx.memory ?? "").trim();
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
  const sections = [
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
    includeWellbeing && "# Mental-health depth (use when the user needs serious emotional support)",
    includeWellbeing && AURORA_WELLBEING,
    ctxBlock.trim() ? ctxBlock.trim() : "",
    langLock.trim(),
    AURORA_SAFETY,
  ].filter((s): s is string => typeof s === "string" && s.length > 0);

  return sections.join("\n\n");
}
