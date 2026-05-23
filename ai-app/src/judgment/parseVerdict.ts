/**
 * Parse Tony's structured verdict header out of an AI message.
 *
 * The prompt instructs Tony to open a verdict message with:
 *   <<<VERDICT>>>
 *   sides_with: a | b | both | neither
 *   confidence: clear | leaning | close_call
 *   <<<END_VERDICT>>>
 *
 * This helper finds that block, returns the parsed fields, and gives
 * the caller the message body with the block stripped — so the chat
 * UI can render a badge above + clean text below without showing
 * the raw <<<VERDICT>>> markers to the user.
 */

export interface ParsedVerdict {
  sidesWith: "a" | "b" | "both" | "neither" | null;
  confidence: "clear" | "leaning" | "close_call" | null;
}

export interface ParseResult {
  verdict: ParsedVerdict | null;
  /** Message body with the <<<VERDICT>>>...<<<END_VERDICT>>> block
   *  removed. If no block was found, this is the original text. */
  cleanText: string;
}

const SIDES_WITH_VALUES = new Set(["a", "b", "both", "neither"]);
const CONFIDENCE_VALUES = new Set(["clear", "leaning", "close_call"]);

export function parseVerdict(rawText: string): ParseResult {
  if (typeof rawText !== "string" || rawText.length === 0) {
    return { verdict: null, cleanText: rawText ?? "" };
  }

  // Find the FIRST <<<VERDICT>>>...<<<END_VERDICT>>> block. (Tony
  // shouldn't emit more than one per message, but if he does we
  // honor the first and strip them all.)
  const blockRegex = /<<<VERDICT>>>([\s\S]*?)<<<END_VERDICT>>>/i;
  const match = blockRegex.exec(rawText);

  if (!match) {
    return { verdict: null, cleanText: rawText };
  }

  const blockContent = match[1];
  const sidesWithMatch = /sides_with\s*:\s*([a-z_]+)/i.exec(blockContent);
  const confidenceMatch = /confidence\s*:\s*([a-z_]+)/i.exec(blockContent);

  const sidesWithRaw = sidesWithMatch?.[1]?.toLowerCase() ?? "";
  const confidenceRaw = confidenceMatch?.[1]?.toLowerCase() ?? "";

  const verdict: ParsedVerdict = {
    sidesWith: SIDES_WITH_VALUES.has(sidesWithRaw)
      ? (sidesWithRaw as ParsedVerdict["sidesWith"])
      : null,
    confidence: CONFIDENCE_VALUES.has(confidenceRaw)
      ? (confidenceRaw as ParsedVerdict["confidence"])
      : null,
  };

  // Strip ALL verdict blocks from the visible message (in case Tony
  // accidentally emitted more than one), plus normalize trailing
  // whitespace left behind.
  const cleanText = rawText
    .replace(/<<<VERDICT>>>[\s\S]*?<<<END_VERDICT>>>/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { verdict, cleanText };
}

/**
 * Walk a message list and return the most recent AI-issued verdict
 * (if any). Used by the chat UI to show the CURRENT verdict badge
 * — which may change as Tony re-issues across the discussion.
 */
export function latestVerdict(
  messages: Array<{ sender_type: string; text: string }>,
): ParsedVerdict | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.sender_type !== "ai") continue;
    const { verdict } = parseVerdict(m.text);
    if (verdict && verdict.sidesWith) return verdict;
  }
  return null;
}
