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
 *   - inline math: $...$  and \(...\)
 *   - display math: $$...$$  and \[...\]   (own block)
 *
 * Math is rendered by KaTeX, lazy-loaded the first time any bubble
 * contains a formula. Until KaTeX arrives we fall back to a slightly
 * cleaned plain-text view (`\frac{a}{b}` → `a/b`, etc.) so students
 * never see raw `$$` markers — that was the bug this fixes.
 *
 * It does NOT execute HTML. Every char outside a math expression is
 * rendered as text via React (no dangerouslySetInnerHTML), so prompt-
 * injection attempts that include <script> or <img onerror=…> are
 * safe. Math HTML comes from KaTeX itself with `trust: false` — see
 * latexRenderer.ts for why dangerouslySetInnerHTML is OK there.
 *
 * Direction-aware: passes `dir="auto"` on the outer container so
 * Arabic responses lay out RTL automatically and English LTR.
 */
import { useMemo, type ReactNode } from "react";
import { tryRenderMath, useKatexReady } from "./latexRenderer";

interface Props {
  body: string;
  /** Tailwind classes applied to the outermost wrapper. Lets the
   *  parent control color / shadow / max-width without this component
   *  prescribing them. */
  className?: string;
}

// ─────────────────────────────────────────────────────────────────
// Math fallbacks — used when KaTeX hasn't loaded yet OR when the
// LaTeX is malformed. Converts the most common LaTeX commands to
// readable Unicode so the student isn't stuck staring at `\frac`.
// ─────────────────────────────────────────────────────────────────

const GREEK_LETTERS: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε",
  zeta: "ζ", eta: "η", theta: "θ", iota: "ι", kappa: "κ",
  lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π",
  rho: "ρ", sigma: "σ", tau: "τ", phi: "φ", chi: "χ",
  psi: "ψ", omega: "ω",
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ",
  Pi: "Π", Sigma: "Σ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
};

const SYMBOLS: Record<string, string> = {
  infty: "∞", to: "→", rightarrow: "→", leftarrow: "←",
  Rightarrow: "⇒", Leftarrow: "⇐", leftrightarrow: "↔",
  cdot: "·", times: "×", div: "÷", pm: "±", mp: "∓",
  approx: "≈", neq: "≠", ne: "≠", leq: "≤", le: "≤",
  geq: "≥", ge: "≥", ll: "≪", gg: "≫",
  sum: "∑", prod: "∏", int: "∫", oint: "∮",
  partial: "∂", nabla: "∇", forall: "∀", exists: "∃",
  in: "∈", notin: "∉", subset: "⊂", supset: "⊃",
  cup: "∪", cap: "∩", emptyset: "∅",
  hbar: "ℏ", ell: "ℓ", Re: "ℜ", Im: "ℑ",
  degree: "°", circ: "°",
};

/** Best-effort fallback when KaTeX can't render. Won't be perfect for
 *  every formula, but anything is better than `\frac{W}{Q}`. */
function prettifyLatex(src: string): string {
  let out = src;

  // Greek letters and symbols — \alpha → α, \infty → ∞, etc.
  out = out.replace(/\\([a-zA-Z]+)/g, (_match, name: string) => {
    if (GREEK_LETTERS[name]) return GREEK_LETTERS[name];
    if (SYMBOLS[name]) return SYMBOLS[name];
    return name; // strip the backslash for unknown commands
  });

  // \frac{a}{b} → a/b (run twice to catch nested fractions, best-effort)
  for (let i = 0; i < 3; i += 1) {
    const before = out;
    out = out.replace(/frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "($1)/($2)");
    if (out === before) break;
  }

  // \sqrt{x} → √x
  out = out.replace(/sqrt\s*\{([^{}]*)\}/g, "√($1)");

  // ^{...} → superscript with parens, ^x → ^x (already readable)
  out = out.replace(/\^\{([^{}]*)\}/g, "^($1)");
  // _{...} → _{...} (Unicode subscripts vary; keep parens form)
  out = out.replace(/_\{([^{}]*)\}/g, "_($1)");

  // Strip lone braces that survived
  out = out.replace(/[{}]/g, "");

  // Collapse whitespace
  out = out.replace(/\s+/g, " ").trim();

  return out;
}

// ─────────────────────────────────────────────────────────────────
// Math token splitter — runs against an inline string and returns
// a list of segments tagged as plain text, inline math, or "open"
// (an unclosed delimiter we should render as plain text mid-stream).
// ─────────────────────────────────────────────────────────────────

interface InlineSegment {
  kind: "text" | "math";
  content: string;
}

/** Split a string on inline math delimiters. Recognised pairs:
 *    $...$    \(...\)
 *  $$...$$ on a single line is treated as inline display math here
 *  (block-level $$..$$ is handled at the block parser instead).
 *  Unclosed delimiters become plain text — common during streaming. */
function splitInlineMath(line: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  let i = 0;
  let plainStart = 0;

  const flushPlain = (end: number) => {
    if (end > plainStart) {
      segments.push({ kind: "text", content: line.slice(plainStart, end) });
    }
  };

  while (i < line.length) {
    const ch = line[i];

    // \( ... \) — escape-paren form
    if (ch === "\\" && line[i + 1] === "(") {
      const close = line.indexOf("\\)", i + 2);
      if (close !== -1) {
        flushPlain(i);
        segments.push({ kind: "math", content: line.slice(i + 2, close) });
        i = close + 2;
        plainStart = i;
        continue;
      }
    }

    // $...$ — single-dollar form. Skip $$ (handled at block level)
    // and skip when it looks like currency ($ followed by a digit
    // and no closing $ on this line).
    if (ch === "$" && line[i + 1] !== "$") {
      // Find next un-escaped $ that isn't doubled
      let j = i + 1;
      while (j < line.length) {
        if (line[j] === "\\" && line[j + 1]) { j += 2; continue; }
        if (line[j] === "$" && line[j + 1] !== "$") break;
        j += 1;
      }
      if (j < line.length && line[j] === "$") {
        const inner = line.slice(i + 1, j);
        // Skip empty $$ and obvious currency ($5, $1.50 — no math
        // content, just digits / currency formatting).
        const isMathLike = inner.length > 0 && /[\\^_={}/+\-*\sa-zA-Z]/.test(inner);
        if (isMathLike) {
          flushPlain(i);
          segments.push({ kind: "math", content: inner });
          i = j + 1;
          plainStart = i;
          continue;
        }
      }
    }

    i += 1;
  }
  flushPlain(line.length);
  return segments;
}

// ─────────────────────────────────────────────────────────────────
// Inline rendering — handles **bold**, *italic*, `code`, line breaks,
// and inline math. Splits a single line into ReactNode array, never
// returns raw HTML except via KaTeX's safe output.
// ─────────────────────────────────────────────────────────────────

function renderInline(text: string, keyPrefix: string, katexReady: boolean): ReactNode[] {
  // First split off any inline math; markdown formatting only applies
  // outside math regions (KaTeX handles its own internal formatting).
  const mathSegs = splitInlineMath(text);
  const out: ReactNode[] = [];

  mathSegs.forEach((seg, segIdx) => {
    if (seg.kind === "math") {
      const html = katexReady ? tryRenderMath(seg.content, false) : null;
      if (html) {
        out.push(
          <span
            key={`${keyPrefix}-m-${segIdx}`}
            className="inline-block align-middle"
            // KaTeX-produced HTML — safe per latexRenderer's options.
            dangerouslySetInnerHTML={{ __html: html }}
          />,
        );
      } else {
        // Fallback: prettified Unicode while KaTeX loads (or if the
        // formula is broken). Italicised so it visually reads like
        // a math token, not body prose.
        out.push(
          <em
            key={`${keyPrefix}-mp-${segIdx}`}
            className="not-italic font-mono text-[0.95em] px-1 py-0.5 rounded bg-white/10"
          >
            {prettifyLatex(seg.content)}
          </em>,
        );
      }
      return;
    }

    // Plain text — apply markdown tokens as before.
    const inner = seg.content;
    // Token regex: inline code first (greediest), then bold, then italic.
    // Order matters — code blocks shouldn't be parsed as italic/bold.
    const re = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)/g;
    let last = 0;
    let i = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(inner)) !== null) {
      if (m.index > last) out.push(inner.slice(last, m.index));
      const tok = m[0];
      if (m[1]) {
        out.push(
          <code
            key={`${keyPrefix}-c-${segIdx}-${i}`}
            className="px-1.5 py-0.5 rounded bg-white/15 font-mono text-[0.92em] tracking-tight"
          >
            {tok.slice(1, -1)}
          </code>,
        );
      } else if (m[2]) {
        out.push(
          <strong key={`${keyPrefix}-b-${segIdx}-${i}`} className="font-bold">
            {tok.slice(2, -2)}
          </strong>,
        );
      } else if (m[3]) {
        out.push(
          <em key={`${keyPrefix}-i-${segIdx}-${i}`} className="italic">
            {tok.slice(1, -1)}
          </em>,
        );
      }
      last = re.lastIndex;
      i += 1;
    }
    if (last < inner.length) out.push(inner.slice(last));
  });

  return out;
}

// ─────────────────────────────────────────────────────────────────
// Block-level rendering. Splits on blank lines into paragraphs,
// then promotes leading patterns (#, -, 1.) into headers/lists.
// Fenced code blocks are extracted first so their inner content is
// not block-parsed. Display-math blocks ($$..$$ and \[..\]) are also
// hoisted out so they render as a centered formula tile.
// ─────────────────────────────────────────────────────────────────

interface Block {
  kind: "paragraph" | "heading" | "ul" | "ol" | "code" | "math";
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

    // Display-math block: $$ ... $$  or  \[ ... \]
    // Both single-line ($$x = y$$) and multi-line forms are supported.
    // We hoist them to their own block so they render as a centered
    // formula tile, separated from prose. If the closer is missing
    // (mid-stream), we leave the source as plain text — it'll re-parse
    // once the AI emits the closing delimiter.
    const dollarOpen = /^\s*\$\$\s*(.*)$/.exec(line);
    const bracketOpen = /^\s*\\\[\s*(.*)$/.exec(line);
    if (dollarOpen) {
      const firstAfter = dollarOpen[1];
      // Single-line case: $$ x = y $$ on the same line
      const sameLineClose = /^(.*?)\s*\$\$\s*$/.exec(firstAfter);
      if (sameLineClose) {
        const inner = sameLineClose[1].trim();
        if (inner) {
          blocks.push({ kind: "math", lines: [inner] });
          i += 1;
          continue;
        }
      }
      // Multi-line: collect until we see closing $$
      const collected: string[] = firstAfter ? [firstAfter] : [];
      let j = i + 1;
      let foundClose = false;
      while (j < lines.length) {
        const closeMatch = /^(.*?)\s*\$\$\s*$/.exec(lines[j]);
        if (closeMatch) {
          if (closeMatch[1]) collected.push(closeMatch[1]);
          foundClose = true;
          j += 1;
          break;
        }
        collected.push(lines[j]);
        j += 1;
      }
      if (foundClose) {
        blocks.push({ kind: "math", lines: [collected.join("\n").trim()] });
        i = j;
        continue;
      }
      // No closer (probably mid-stream) — fall through and let the
      // line render as a normal paragraph; once the closer arrives
      // the block parser will pick it up.
    }
    if (bracketOpen) {
      const firstAfter = bracketOpen[1];
      const sameLineClose = /^(.*?)\s*\\\]\s*$/.exec(firstAfter);
      if (sameLineClose) {
        const inner = sameLineClose[1].trim();
        if (inner) {
          blocks.push({ kind: "math", lines: [inner] });
          i += 1;
          continue;
        }
      }
      const collected: string[] = firstAfter ? [firstAfter] : [];
      let j = i + 1;
      let foundClose = false;
      while (j < lines.length) {
        const closeMatch = /^(.*?)\s*\\\]\s*$/.exec(lines[j]);
        if (closeMatch) {
          if (closeMatch[1]) collected.push(closeMatch[1]);
          foundClose = true;
          j += 1;
          break;
        }
        collected.push(lines[j]);
        j += 1;
      }
      if (foundClose) {
        blocks.push({ kind: "math", lines: [collected.join("\n").trim()] });
        i = j;
        continue;
      }
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
      if (/^\s*\$\$/.test(peek) || /^\s*\\\[/.test(peek)) break;
      paraLines.push(peek);
      i += 1;
    }
    blocks.push({ kind: "paragraph", lines: paraLines });
  }

  return blocks;
}

// ─────────────────────────────────────────────────────────────────
// Display-math block renderer. Tries KaTeX; falls back to a
// pretty-printed plain version while KaTeX loads or on parse error.
// ─────────────────────────────────────────────────────────────────

function MathBlock({ src, katexReady }: { src: string; katexReady: boolean }) {
  const html = katexReady ? tryRenderMath(src, true) : null;
  if (html) {
    return (
      <div
        // Centered, padded tile so a formula has visual weight in the
        // bubble. The KaTeX HTML provides its own typography.
        dir="ltr"
        className="my-2 rounded-xl bg-white/8 px-4 py-4 overflow-x-auto text-white"
        style={{ textShadow: "none" }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }
  // Fallback while KaTeX loads / on parse error — readable plain
  // text version of the formula in a monospace tile.
  return (
    <div
      dir="ltr"
      className="my-2 rounded-xl bg-white/8 px-4 py-3 overflow-x-auto font-mono text-[15px] text-white/95"
      style={{ textShadow: "none" }}
    >
      {prettifyLatex(src)}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Public component
// ─────────────────────────────────────────────────────────────────

export function TutorMessageBody({ body, className = "" }: Props) {
  const blocks = useMemo(() => parseBlocks(body || ""), [body]);
  // Detect whether this body actually contains math. If it does,
  // subscribe to the KaTeX-ready signal so we re-render when the
  // chunk arrives. Bubbles without math don't pay any cost.
  const hasMath = useMemo(() => {
    if (!body) return false;
    if (body.includes("$$") || body.includes("\\[") || body.includes("\\(")) return true;
    // Cheap heuristic: presence of unescaped $ followed eventually by another $.
    const idx = body.indexOf("$");
    if (idx === -1) return false;
    return body.indexOf("$", idx + 1) !== -1;
  }, [body]);
  // Always call the hook so React's hook order stays stable; it
  // internally short-circuits when the bubble doesn't need math.
  const ready = useKatexReady();
  const katexReady = hasMath && ready;

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
                {renderInline(text, key, katexReady)}
              </div>
            );
          }
          case "ul":
            return (
              <ul key={key} className="ps-5 space-y-1.5 list-disc marker:text-white/80">
                {block.lines.map((line, j) => (
                  <li key={`${key}-${j}`} className="text-[16px] md:text-[17.5px]">
                    {renderInline(line, `${key}-${j}`, katexReady)}
                  </li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={key} className="ps-5 space-y-1.5 list-decimal marker:text-white/80 marker:font-semibold">
                {block.lines.map((line, j) => (
                  <li key={`${key}-${j}`} className="text-[16px] md:text-[17.5px]">
                    {renderInline(line, `${key}-${j}`, katexReady)}
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
          case "math":
            return (
              <MathBlock
                key={key}
                src={block.lines[0] ?? ""}
                katexReady={katexReady}
              />
            );
          case "paragraph":
          default: {
            // Inside a paragraph, internal newlines stay as <br />.
            const merged: ReactNode[] = [];
            block.lines.forEach((line, j) => {
              if (j > 0) merged.push(<br key={`${key}-br-${j}`} />);
              renderInline(line, `${key}-${j}`, katexReady).forEach((node, k) => {
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
