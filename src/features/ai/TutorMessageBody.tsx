/**
 * TutorMessageBody — read-friendly renderer for AI tutor responses.
 *
 * The system prompt already instructs Bas Udros to use markdown
 * formatting (**bold** for key terms, bullet lists for breakdowns,
 * `inline code`, ### headers for sections). Without rendering,
 * students saw the literal asterisks + hashes and had to mentally
 * parse them — a real readability hit.
 *
 * This component is a small, focused renderer:
 *   - **bold**, *italic*, `inline code`, ```fenced code blocks```
 *   - # / ## / ### headers
 *   - - / * / 1. bullet + ordered lists
 *   - paragraphs split on double newline
 *   - line breaks within paragraphs
 *
 * It does NOT execute HTML. Every char is rendered as text via React
 * (no dangerouslySetInnerHTML), so prompt-injection attempts that
 * include <script> or <img onerror=…> are safe.
 *
 * Direction-aware: passes `dir="auto"` on the outer container so
 * Arabic responses lay out RTL automatically and English LTR.
 */
import { useMemo, type ReactNode } from "react";

interface Props {
  body: string;
  /** Tailwind classes applied to the outermost wrapper. Lets the
   *  parent control color / shadow / max-width without this component
   *  prescribing them. */
  className?: string;
}

// ─────────────────────────────────────────────────────────────────
// Inline rendering — handles **bold**, *italic*, `code`, line breaks.
// Splits a single line into ReactNode array, never returns raw HTML.
// ─────────────────────────────────────────────────────────────────

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  // Token regex: inline code first (greediest), then bold, then italic.
  // Order matters — code blocks shouldn't be parsed as italic/bold.
  const re = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)/g;
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (m[1]) {
      // inline code
      out.push(
        <code
          key={`${keyPrefix}-c-${i}`}
          className="px-1.5 py-0.5 rounded bg-white/15 font-mono text-[0.92em] tracking-tight"
        >
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (m[2]) {
      // bold
      out.push(
        <strong key={`${keyPrefix}-b-${i}`} className="font-bold">
          {tok.slice(2, -2)}
        </strong>,
      );
    } else if (m[3]) {
      // italic
      out.push(
        <em key={`${keyPrefix}-i-${i}`} className="italic">
          {tok.slice(1, -1)}
        </em>,
      );
    }
    last = re.lastIndex;
    i += 1;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// ─────────────────────────────────────────────────────────────────
// Block-level rendering. Splits on blank lines into paragraphs,
// then promotes leading patterns (#, -, 1.) into headers/lists.
// Fenced code blocks are extracted first so their inner content is
// not block-parsed.
// ─────────────────────────────────────────────────────────────────

interface Block {
  kind: "paragraph" | "heading" | "ul" | "ol" | "code";
  level?: number;          // for heading: 1/2/3
  language?: string;       // for code fence
  lines: string[];
}

function parseBlocks(src: string): Block[] {
  const blocks: Block[] = [];
  const lines = src.replace(/\r\n/g, "\n").split("\n");

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Code fence — capture until closing ```
    const fenceMatch = /^```(\w+)?\s*$/.exec(line.trim());
    if (fenceMatch) {
      const language = fenceMatch[1];
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i].trim())) {
        codeLines.push(lines[i]);
        i += 1;
      }
      // Skip the closing fence (or the EOF if missing)
      if (i < lines.length) i += 1;
      blocks.push({ kind: "code", language, lines: codeLines });
      continue;
    }

    // Skip blank lines between blocks
    if (line.trim() === "") {
      i += 1;
      continue;
    }

    // Heading — # / ## / ###
    const headingMatch = /^(#{1,3})\s+(.+)$/.exec(line);
    if (headingMatch) {
      blocks.push({
        kind: "heading",
        level: headingMatch[1].length,
        lines: [headingMatch[2]],
      });
      i += 1;
      continue;
    }

    // Unordered list — `- item` or `* item`
    if (/^[-*]\s+/.test(line)) {
      const listLines: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        listLines.push(lines[i].replace(/^[-*]\s+/, ""));
        i += 1;
      }
      blocks.push({ kind: "ul", lines: listLines });
      continue;
    }

    // Ordered list — `1.` `2.` …
    if (/^\d+\.\s+/.test(line)) {
      const listLines: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        listLines.push(lines[i].replace(/^\d+\.\s+/, ""));
        i += 1;
      }
      blocks.push({ kind: "ol", lines: listLines });
      continue;
    }

    // Paragraph — collect consecutive non-blank lines that aren't
    // any of the above patterns.
    const paraLines: string[] = [line];
    i += 1;
    while (i < lines.length) {
      const peek = lines[i];
      if (peek.trim() === "") break;
      if (/^(#{1,3})\s+/.test(peek)) break;
      if (/^[-*]\s+/.test(peek)) break;
      if (/^\d+\.\s+/.test(peek)) break;
      if (/^```/.test(peek.trim())) break;
      paraLines.push(peek);
      i += 1;
    }
    blocks.push({ kind: "paragraph", lines: paraLines });
  }

  return blocks;
}

// ─────────────────────────────────────────────────────────────────
// Public component
// ─────────────────────────────────────────────────────────────────

export function TutorMessageBody({ body, className = "" }: Props) {
  const blocks = useMemo(() => parseBlocks(body || ""), [body]);

  return (
    <div
      // dir="auto" lets the browser pick LTR vs RTL per paragraph
      // based on the first strong directional character — Arabic
      // replies render right-aligned automatically without us having
      // to plumb a `lang` prop through.
      dir="auto"
      className={`text-white space-y-3 leading-[1.65] tracking-[0.005em] ${className}`}
      style={{ textShadow: "0 1px 3px rgba(0,0,0,0.55)" }}
    >
      {blocks.map((block, idx) => {
        const key = `b-${idx}`;
        switch (block.kind) {
          case "heading": {
            const level = block.level ?? 2;
            const text = block.lines[0] ?? "";
            const sizeCls =
              level === 1 ? "text-[20px] md:text-[22px] font-bold mt-1"
              : level === 2 ? "text-[18px] md:text-[19px] font-bold mt-1"
              :              "text-[16px] md:text-[17px] font-semibold mt-0.5";
            return (
              <div key={key} className={`${sizeCls} text-white`}>
                {renderInline(text, key)}
              </div>
            );
          }
          case "ul":
            return (
              <ul key={key} className="ps-5 space-y-1.5 list-disc marker:text-white/80">
                {block.lines.map((line, j) => (
                  <li key={`${key}-${j}`} className="text-[16px] md:text-[17.5px]">
                    {renderInline(line, `${key}-${j}`)}
                  </li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={key} className="ps-5 space-y-1.5 list-decimal marker:text-white/80 marker:font-semibold">
                {block.lines.map((line, j) => (
                  <li key={`${key}-${j}`} className="text-[16px] md:text-[17.5px]">
                    {renderInline(line, `${key}-${j}`)}
                  </li>
                ))}
              </ol>
            );
          case "code":
            return (
              <pre
                key={key}
                dir="ltr"
                className="rounded-xl bg-black/40 backdrop-blur-sm px-4 py-3 overflow-x-auto text-[14px] leading-[1.55] font-mono"
                style={{ textShadow: "none" }}
              >
                <code>{block.lines.join("\n")}</code>
              </pre>
            );
          case "paragraph":
          default: {
            // Inside a paragraph, internal newlines stay as <br />.
            const merged: ReactNode[] = [];
            block.lines.forEach((line, j) => {
              if (j > 0) merged.push(<br key={`${key}-br-${j}`} />);
              renderInline(line, `${key}-${j}`).forEach((node, k) => {
                merged.push(
                  // String children need a wrapper to attach a key.
                  typeof node === "string"
                    ? <span key={`${key}-${j}-${k}`}>{node}</span>
                    : node,
                );
              });
            });
            return (
              <p key={key} className="text-[16.5px] md:text-[18px]">
                {merged}
              </p>
            );
          }
        }
      })}
    </div>
  );
}
