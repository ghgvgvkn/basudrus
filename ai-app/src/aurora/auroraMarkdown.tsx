/**
 * Aurora mini-markdown renderer.
 *
 * Tiny regex-based markdown → React fragments converter. Handles the
 * 4 patterns Tony actually emits in real replies:
 *
 *   **bold**       — emphasis (rendered as <strong>)
 *   *italic*       — softer emphasis (rendered as <em>)
 *   `code`         — inline literal (rendered as <code>)
 *   [text](url)    — inline link (rendered as <a target="_blank">)
 *
 * Why hand-rolled instead of `react-markdown` or `marked`:
 *
 *   - Bundle size: react-markdown + remark plugins is ~80KB gzipped
 *     for what Tony actually uses — three styling rules and links.
 *   - Tony's text isn't generic markdown. It's conversational prose
 *     with occasional emphasis. He doesn't emit headings, tables,
 *     blockquotes, footnotes, etc. (Those are handled by the
 *     <<<...>>> artifact blocks instead.)
 *   - Newline preservation matters more than full CommonMark
 *     compliance. The CSS uses `white-space: pre-wrap`, so we want
 *     plain text segments returned as React text nodes that the
 *     browser's whitespace handling can pick up — not paragraphs
 *     wrapped in extra <p> tags that would force double-spacing.
 *
 * The output is a React fragment, safe to drop anywhere a text node
 * could go. Empty / null input returns null cleanly so callers can
 * `{renderMarkdown(maybeNull)}` without a guard.
 *
 * No HTML injection risk: we never use dangerouslySetInnerHTML. All
 * output flows through React's text-escaping pipeline. Link hrefs
 * are placed in href= but the value is the captured URL — React
 * escapes it as an attribute value, so a malicious URL would still
 * be serialized as text, not executed.
 */
import { Fragment, type ReactNode } from "react";

// Match the FOUR token types in a single pass. Each alternative
// captures the FULL token text so we can detect which variant we
// matched by inspecting the first character.
//
//   `code`         — backtick + non-backtick non-newline + backtick
//   **bold**       — two stars + content + two stars
//   *italic*       — one star + content + one star
//   [text](url)    — brackets text, parens url (no whitespace in url)
//
// The order MATTERS because regex alternatives match left-to-right:
//   - code first (so backticks inside ** don't accidentally bold)
//   - bold before italic (so ** isn't parsed as two adjacent italics)
//   - link last (so brackets inside other patterns are left alone)
//
// `[^*\n][^*\n]*?` rather than `.+?` because:
//   - `[^\n]` keeps emphasis contained within a single line (a
//     stray `*` in a paragraph below doesn't accidentally pair with
//     one above)
//   - The leading `[^*\n]` ensures we don't match an empty/whitespace-
//     only body (`**` next to itself shouldn't render as bold)
const TOKEN_RE = /(`[^`\n]+?`|\*\*[^*\n][^*\n]*?\*\*|\*[^*\n][^*\n]*?\*|\[([^\]]+)\]\(([^)\s]+)\))/g;

type Segment =
  | { type: "text"; text: string }
  | { type: "bold"; text: string }
  | { type: "italic"; text: string }
  | { type: "code"; text: string }
  | { type: "link"; text: string; href: string };

/**
 * Single-pass tokenizer. Walks the input with the combined regex,
 * emits a text segment for each gap between matches and a typed
 * segment for each match. The regex's `g` flag means lastIndex
 * advances on every call — we reset it on entry so a re-entry
 * mid-string doesn't drift.
 */
function tokenize(input: string): Segment[] {
  const segs: Segment[] = [];
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(input)) !== null) {
    // Push the text BEFORE this match as a plain text segment.
    if (m.index > lastIdx) {
      segs.push({ type: "text", text: input.slice(lastIdx, m.index) });
    }
    const full = m[1];
    if (full.startsWith("`")) {
      segs.push({ type: "code", text: full.slice(1, -1) });
    } else if (full.startsWith("**")) {
      segs.push({ type: "bold", text: full.slice(2, -2) });
    } else if (full.startsWith("*")) {
      segs.push({ type: "italic", text: full.slice(1, -1) });
    } else if (full.startsWith("[")) {
      // m[2] = label inside [], m[3] = url inside ()
      segs.push({ type: "link", text: m[2], href: m[3] });
    }
    lastIdx = m.index + full.length;
  }
  // Trailing text after the last match (or the entire string if
  // there were zero matches).
  if (lastIdx < input.length) {
    segs.push({ type: "text", text: input.slice(lastIdx) });
  }
  return segs;
}

/**
 * Render Tony's text as React nodes with inline markdown applied.
 *
 * Returns null for empty input so callers can drop the result inline
 * without a guard:
 *
 *   <p>{renderMarkdown(text)}</p>
 *
 * Text segments come back as plain React text nodes (not wrapped in
 * spans) so the parent's `white-space: pre-wrap` styling preserves
 * the newlines and spacing Tony intended.
 */
export function renderMarkdown(text: string | null | undefined): ReactNode {
  if (!text) return null;
  const segments = tokenize(text);
  // Fast path: pure text with no markdown — just return the string
  // so React skips an extra Fragment wrapper.
  if (segments.length === 1 && segments[0].type === "text") {
    return segments[0].text;
  }
  return (
    <Fragment>
      {segments.map((seg, i) => {
        switch (seg.type) {
          case "bold":
            return (
              <strong key={i} className="aurora-md-bold">
                {seg.text}
              </strong>
            );
          case "italic":
            return (
              <em key={i} className="aurora-md-italic">
                {seg.text}
              </em>
            );
          case "code":
            return (
              <code key={i} className="aurora-md-code">
                {seg.text}
              </code>
            );
          case "link":
            return (
              <a
                key={i}
                href={seg.href}
                target="_blank"
                rel="noopener noreferrer"
                className="aurora-md-link"
              >
                {seg.text}
              </a>
            );
          default:
            // Use a span-less Fragment so the text node lands directly
            // in the parent's child list — preserves white-space: pre-wrap.
            return <Fragment key={i}>{seg.text}</Fragment>;
        }
      })}
    </Fragment>
  );
}
