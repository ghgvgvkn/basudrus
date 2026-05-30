/**
 * parseChoices — extracts a tappable "pick one of these options" block
 * from a streaming assistant reply.
 *
 * Design goal: when Tony Starrk or Sherlock asks the student a question
 * with a small set of likely answers, the mobile UI should render those
 * answers as tappable buttons (like Claude Code's AskUserQuestion UI in
 * the screenshot the user shared) rather than forcing the student to
 * type one back. Cuts friction on phones where typing is slow and
 * matches the "feels like a real conversation" goal.
 *
 * Primary marker format (what the server prompt teaches):
 *
 *   I think you'd benefit from a quick check-in. Want to do one?
 *
 *   <<option>>
 *   Yes, 2-minute check-in
 *   Maybe later
 *   Tell me more first
 *   <<end option>>
 *
 * Why plain-text markers instead of fenced JSON:
 *   - Lower cognitive load for the model: just list answers, one per
 *     line, between two sentinels. No JSON quoting / escaping mistakes,
 *     no quote-character-mismatch failures mid-stream.
 *   - Robust to streaming: each line is whole the moment its newline
 *     arrives. The parser waits for the closing tag before showing the
 *     card, so a partial mid-stream emit just shows the prose until
 *     the model finishes the block.
 *   - Human-readable on degraded clients: the web (which doesn't have
 *     the parser yet) will show the literal `<<option>>` lines as plain
 *     text — ugly but legible, and the user can still type a reply.
 *
 * DEFENSIVE PARSING (lessons from real model output):
 * Models — even Claude — drift from the strict format. Real failures
 * we've seen:
 *   - Plural form: `<<options>>` / `<<end options>>` instead of singular
 *   - XML-style closing: `<</option>>` or `<</options>>`
 *   - Code-fenced equivalents: ```option / ```options / ```choices with
 *     one item per line (some models lean on code fences when told
 *     "this is a structured block")
 * To make cards reliable even when the model is sloppy, the parser
 * accepts ALL of these. The primary `<<option>>...<<end option>>` shape
 * is still what the server prompt teaches — the rest are belt-and-braces
 * so the UX doesn't break on a single bad emit.
 *
 * Streaming behaviour:
 *   The block may be incomplete while the message is still streaming
 *   — we explicitly return `choices: null` for partial markers (no
 *   closing tag yet) so the bubble shows just the prose until the model
 *   finishes writing the block. The caller renders the card only after
 *   `streaming` flips false, so this short window is invisible to the
 *   user.
 *
 * Backward-compatible: messages without an options block return
 * `{ prose: text, choices: null }` — the bubble renders identically to
 * before, no UI churn for existing chats.
 */

export interface ChoiceItem {
  /** The exact text the user is choosing — also what we'll send as
   *  their next message when they tap the button. Keep short. */
  label: string;
  /** Optional one-line clarifier under the label. Not currently used by
   *  the `<<option>>` marker format (each line is just a label) but
   *  preserved on the type so future formats can populate it without
   *  breaking the renderer. */
  hint?: string;
}

export interface ParsedAssistantMessage {
  /** The assistant prose with the options block (if any) stripped
   *  out, ready to render in a bubble. */
  prose: string;
  /** Parsed options, or null when the message has no options block
   *  (or it's still streaming the block — never throws). */
  choices: ChoiceItem[] | null;
}

// Primary marker: `<<option(s)>>` … `<<end option(s)>>` OR `<</option(s)>>`.
// - Optional whitespace inside the markers (`<< option >>`, `<<End Option>>`).
// - Optional plural `s` (the model sometimes writes "options").
// - Closing tag accepts either `<<end option>>` (the format we teach) or
//   the XML-style `<</option>>` / `<</options>>` (Claude defaults to this
//   when it thinks of `<<option>>` as a tag).
// - Dotall via `[\s\S]` so the lazy capture spans newlines.
// - Case-insensitive (the model sometimes capitalises mid-sentence).
const OPTION_BLOCK_RE =
  /<<\s*options?\s*>>\s*([\s\S]*?)\s*<<\s*(?:end\s+options?|\/\s*options?)\s*>>/i;

// Fallback marker: a fenced code block whose info string is
// `option`, `options`, or `choices` (any case). One item per line
// inside. Some models prefer code fences whenever they hear "structured
// block", and we want the card to render either way.
//
// Match e.g.:
//   ```options
//   Yes
//   Maybe later
//   ```
const FENCED_BLOCK_RE = /```\s*(?:options?|choices)\s*\n([\s\S]*?)\n```/i;

// Detect a partial opening sentinel (any form) for the mid-stream hide.
const PARTIAL_OPEN_RE = /<<\s*options?\s*>>|```\s*(?:options?|choices)\s*\n/i;

function linesFromBlock(inner: string): string[] {
  // One option per line. Strip blank lines and trim each row. Some
  // models like to prefix options with a dash, bullet, or number —
  // ("- Yes", "• Yes", "1. Yes") — so we peel off common bullets at the
  // start of the line. Anything past the first bullet/number stays
  // as-is. Quote characters at the very start/end also get peeled —
  // models sometimes wrap each option in quotes.
  return inner
    .split('\n')
    .map(l =>
      l
        .replace(/^\s*(?:[-•*]|\d+\.)\s+/, '')
        .replace(/^["'`]+|["'`]+$/g, '')
        .trim(),
    )
    .filter(l => l.length > 0);
}

/**
 * Walk an assistant reply for an options block, parse the lines inside,
 * and return both the surrounding prose (block stripped) and the
 * parsed options. Pure — no side effects — so the result is safe to
 * memoise per message id.
 *
 * Returns `{ prose: text, choices: null }` for any of:
 *   - No options marker in the text.
 *   - Opening marker seen but closing marker not yet emitted (still
 *     streaming — the bubble shows the prose so far, no card yet).
 *   - Block present but contains zero non-empty lines.
 *
 * This permissive failure mode is deliberate — a bad emit shouldn't
 * blank the bubble or throw. The user just sees the prose, and the
 * model can self-correct on the next turn.
 */
export function parseAssistantMessage(text: string): ParsedAssistantMessage {
  if (!text) return { prose: '', choices: null };

  // Try the primary `<<option>>` marker first.
  let match = text.match(OPTION_BLOCK_RE);
  let blockRe: RegExp = OPTION_BLOCK_RE;

  // Fallback to fenced code block if the primary marker didn't match.
  if (!match) {
    match = text.match(FENCED_BLOCK_RE);
    blockRe = FENCED_BLOCK_RE;
  }

  if (!match) {
    // No fully-closed block. We might still be mid-stream — if the text
    // contains an OPENING marker but no closing tag yet, hide the partial
    // marker line so the user doesn't see the literal `<<option>>` (or a
    // dangling ```options) while the model is still writing.
    const partialIdx = text.search(PARTIAL_OPEN_RE);
    if (partialIdx >= 0) {
      const prose = text.slice(0, partialIdx).trimEnd();
      return { prose, choices: null };
    }
    return { prose: text, choices: null };
  }

  const inner = match[1] ?? '';
  const lines = linesFromBlock(inner);

  if (lines.length === 0) return { prose: text, choices: null };

  const choices: ChoiceItem[] = lines.map(label => ({ label }));

  // Strip the entire options block (plus any leftover blank lines) so
  // the bubble only shows the prose preamble.
  const prose = text
    .replace(blockRe, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { prose, choices };
}
