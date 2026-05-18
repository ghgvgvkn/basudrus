/**
 * parseQuickReplies — extract the AI-emitted <<<OPTIONS>>> block
 * from a Bas Udros / Sherlock reply, return the cleaned text + the
 * options list separately so the UI can render them as tappable
 * chips below the message.
 *
 * The AI is instructed (via system prompt) to emit this format
 * whenever it asks a question with 3–5 typical answers:
 *
 *   Some response text the student reads.
 *
 *   <<<OPTIONS>>>
 *   - First option text
 *   - Another option
 *   - Third option
 *   <<<END_OPTIONS>>>
 *
 * We strip the entire block from the visible body and return the
 * options as a clean string array (trimmed, capped to 6 items, each
 * capped to 80 chars to defend against runaway model output).
 *
 * If the markers are missing, malformed, or empty, we return the
 * original text unchanged and `quickReplies: []`. The calling code
 * just shows the message normally.
 *
 * Pure function. No side effects. Testable.
 */

export interface ParsedReply {
  body: string;
  quickReplies: string[];
}

const OPEN_TAG = "<<<OPTIONS>>>";
const CLOSE_TAG = "<<<END_OPTIONS>>>";

/** Cap each option to a reasonable length to defend against the AI
 *  emitting a paragraph in place of a button label. 80 chars handles
 *  even verbose Arabic phrasing without truncating. */
const MAX_OPTION_LENGTH = 80;

/** Max options to render. The system prompt asks for 2–4; this is
 *  the hard ceiling in case the model emits more. */
const MAX_OPTIONS = 6;

export function parseQuickReplies(raw: string): ParsedReply {
  if (!raw || typeof raw !== "string") {
    return { body: raw ?? "", quickReplies: [] };
  }

  const openIdx = raw.indexOf(OPEN_TAG);
  if (openIdx === -1) return { body: raw, quickReplies: [] };

  const closeIdx = raw.indexOf(CLOSE_TAG, openIdx + OPEN_TAG.length);
  if (closeIdx === -1) {
    // Stream is mid-arrival or model emitted only the opener. Don't
    // strip yet — keep the visible body untouched until the closer
    // shows up. Otherwise we'd flicker the bubble while streaming.
    return { body: raw, quickReplies: [] };
  }

  // Pull out the inner block (between the tags) and the cleaned body
  // (everything before the opener + everything after the closer).
  const inner = raw.slice(openIdx + OPEN_TAG.length, closeIdx);
  const before = raw.slice(0, openIdx).trimEnd();
  const after = raw.slice(closeIdx + CLOSE_TAG.length).trimStart();
  // The block usually sits at the very end. If the model puts text
  // after the closer, we keep it joined with the body.
  const cleanedBody = [before, after].filter(Boolean).join("\n\n");

  // Each option is a list-item line: "- option text" or "* option text"
  // or "1. option text". Be generous about formatting because LLMs
  // drift; we just need the content after the bullet.
  const options: string[] = [];
  for (const rawLine of inner.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    // Strip leading bullets / numbering — handles "-", "*", "•",
    // "1.", "1)", " - ", etc.
    const cleaned = line
      .replace(/^[-*•]\s+/, "")
      .replace(/^\d+[.)]\s+/, "")
      .trim();
    if (!cleaned) continue;
    options.push(cleaned.slice(0, MAX_OPTION_LENGTH));
    if (options.length >= MAX_OPTIONS) break;
  }

  // Defensively dedupe — the model occasionally emits identical
  // options when it's confused.
  const seen = new Set<string>();
  const uniq = options.filter((o) => {
    const key = o.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { body: cleanedBody, quickReplies: uniq };
}
