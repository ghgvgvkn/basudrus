/**
 * pdfMetaPeek — extract lightweight metadata from a PDF without using
 * a full parser. Uses byte-level regex on the raw file content.
 *
 * Why no parser:
 *   pdfjs-dist crashes on iOS Safari WebKit (known v5/legacy issue
 *   with iterables in module workers). Rather than chase that, we
 *   read the spec-defined keys we care about directly from the bytes.
 *
 * What we extract (all best-effort, all nullable):
 *   • pageCount       — sum of `/Type /Pages /Count N` entries
 *   • title           — `/Title (...)` from the Info dictionary
 *   • author          — `/Author (...)`
 *   • producer        — `/Producer (...)`  ("Microsoft Word 2021", "pdfTeX-1.40.25", etc.)
 *   • creator         — `/Creator (...)`   (the originating application)
 *
 * If extraction fails (corrupt PDF, compressed metadata, anything
 * weird), we return all-null and the caller falls back to filename
 * + size for display. No throw.
 *
 * This is bytes-only — does NOT render pages, does NOT parse content.
 * Strictly metadata peeking, ~milliseconds, no async, no worker.
 */

export interface PdfMetaPeek {
  pageCount: number | null;
  title: string | null;
  author: string | null;
  producer: string | null;
  creator: string | null;
}

/** Read the PDF bytes, return metadata. Defensive — any error gives
 *  an all-null result. The caller decides whether to render based on
 *  which fields are present. */
export function peekPdfMeta(bytes: Uint8Array): PdfMetaPeek {
  const empty: PdfMetaPeek = { pageCount: null, title: null, author: null, producer: null, creator: null };
  try {
    // Decode as Latin-1 so byte positions match string positions.
    // PDFs are NOT UTF-8 in the catalog area; this is the safe choice.
    // We only look at the first ~256 KB + the last ~256 KB — Info /
    // Pages entries live near the trailer and the catalog. This keeps
    // the regex cost bounded even on a 1 MB PDF.
    const text = decodeLatin1Windows(bytes);
    return {
      pageCount: extractPageCount(text),
      title: extractInfoField(text, "Title"),
      author: extractInfoField(text, "Author"),
      producer: extractInfoField(text, "Producer"),
      creator: extractInfoField(text, "Creator"),
    };
  } catch {
    return empty;
  }
}

/** Latin-1 view of the head + tail of the file. Catalog + trailer
 *  almost always live in these regions; sampling avoids stringifying
 *  the entire byte stream. */
function decodeLatin1Windows(bytes: Uint8Array): string {
  const WINDOW = 256 * 1024;
  const head = bytes.subarray(0, Math.min(WINDOW, bytes.length));
  const tail = bytes.length > WINDOW * 2
    ? bytes.subarray(bytes.length - WINDOW)
    : new Uint8Array(0);
  // Concat through fromCharCode (chunked to avoid the arg-count limit
  // — same trick the base64 helper uses).
  return latin1Chunk(head) + (tail.length ? latin1Chunk(tail) : "");
}

function latin1Chunk(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let out = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
    out += String.fromCharCode.apply(null, Array.from(slice));
  }
  return out;
}

/** Page count: sum of `/Type /Pages /Count <int>` entries. A simple
 *  one-pager has one Pages dict with Count N; tree-structured PDFs
 *  use intermediate Pages nodes — summing gives the correct total
 *  for most real-world files. If nothing matches, return null. */
function extractPageCount(text: string): number | null {
  // Match `/Type /Pages` followed (in either order) by `/Count <int>`.
  // PDFs allow whitespace + arbitrary order of dict entries, so we
  // do two passes: find each `/Type /Pages` block, then look for
  // `/Count <int>` within ~200 chars of that occurrence.
  const re = /\/Type\s*\/Pages\b/g;
  let m: RegExpExecArray | null;
  let bestCount: number | null = null;
  while ((m = re.exec(text))) {
    const windowEnd = Math.min(m.index + 400, text.length);
    const slice = text.slice(m.index, windowEnd);
    const cm = /\/Count\s+(\d+)/.exec(slice);
    if (cm) {
      const n = parseInt(cm[1], 10);
      if (Number.isFinite(n) && n > 0) {
        // Take the LARGEST Count seen — root Pages node has the total.
        bestCount = bestCount === null ? n : Math.max(bestCount, n);
      }
    }
  }
  return bestCount;
}

/** Extract a string value from the Info dictionary. PDF strings can
 *  be in (parentheses) — literal — or <hex>. We handle both. Returns
 *  the cleaned string, or null when not present. */
function extractInfoField(text: string, name: string): string | null {
  // Try literal-string form first: /Name (value)
  // Parentheses inside the string are escaped with backslash, so a
  // tolerant pattern stops at the FIRST unescaped close-paren.
  const litRe = new RegExp(`/${escapeRegex(name)}\\s*\\(((?:[^\\\\()]|\\\\.)*)\\)`);
  const litMatch = litRe.exec(text);
  if (litMatch) {
    const cleaned = unescapePdfLiteral(litMatch[1]);
    if (cleaned && cleaned.trim().length > 0) return cleaned.slice(0, 200);
  }
  // Hex-string form: /Name <FEFF... >
  const hexRe = new RegExp(`/${escapeRegex(name)}\\s*<([0-9A-Fa-f\\s]+)>`);
  const hexMatch = hexRe.exec(text);
  if (hexMatch) {
    const cleaned = decodePdfHexString(hexMatch[1]);
    if (cleaned && cleaned.trim().length > 0) return cleaned.slice(0, 200);
  }
  return null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Resolve PDF literal-string escapes: \n, \r, \t, \\, \(, \), \ooo (octal). */
function unescapePdfLiteral(s: string): string {
  return s.replace(/\\(?:([nrtbf\\()])|([0-7]{1,3}))/g, (_, simple, oct) => {
    if (simple) {
      switch (simple) {
        case "n": return "\n";
        case "r": return "\r";
        case "t": return "\t";
        case "b": return "\b";
        case "f": return "\f";
        case "(": return "(";
        case ")": return ")";
        case "\\": return "\\";
      }
    }
    if (oct) return String.fromCharCode(parseInt(oct, 8));
    return "";
  });
}

/** Hex string: pairs of hex digits → chars. Handles UTF-16BE BOM
 *  (FEFF) which is the PDF spec's way to mark a Unicode string. */
function decodePdfHexString(hex: string): string {
  const clean = hex.replace(/\s+/g, "");
  if (!clean || clean.length % 2 !== 0) return "";
  // UTF-16BE if starts with FEFF.
  if (clean.toUpperCase().startsWith("FEFF") && clean.length >= 4) {
    let out = "";
    for (let i = 4; i + 3 < clean.length; i += 4) {
      const code = parseInt(clean.slice(i, i + 4), 16);
      if (Number.isFinite(code)) out += String.fromCharCode(code);
    }
    return out;
  }
  // Plain Latin-1 bytes.
  let out = "";
  for (let i = 0; i + 1 < clean.length; i += 2) {
    const code = parseInt(clean.slice(i, i + 2), 16);
    if (Number.isFinite(code)) out += String.fromCharCode(code);
  }
  return out;
}

/** Map a /Producer string to a short, friendly label.
 *  "Microsoft Word 2021 for Mac"          → "Microsoft Word"
 *  "pdfTeX-1.40.25"                        → "LaTeX (pdfTeX)"
 *  "Skia/PDF m120 Google Docs Renderer"   → "Google Docs"
 *  "macOS 14 (Pages 13.2)"                 → "Apple Pages"
 *  Returns the original string trimmed if no friendly mapping matches. */
export function friendlyProducer(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;
  const lower = s.toLowerCase();
  if (lower.includes("microsoft word") || lower.includes("ms word") || /\bword\s+\d+/i.test(lower)) return "Microsoft Word";
  if (lower.includes("pdftex") || lower.includes("xetex") || lower.includes("luatex")) return "LaTeX";
  if (lower.includes("google docs") || lower.includes("google-docs")) return "Google Docs";
  if (lower.includes("pages") && (lower.includes("apple") || lower.includes("macos"))) return "Apple Pages";
  if (lower.includes("powerpoint")) return "Microsoft PowerPoint";
  if (lower.includes("keynote")) return "Apple Keynote";
  if (lower.includes("openoffice") || lower.includes("libreoffice")) return "LibreOffice";
  if (lower.includes("adobe acrobat") || lower.includes("acrobat distiller")) return "Adobe Acrobat";
  if (lower.includes("adobe indesign")) return "Adobe InDesign";
  if (lower.includes("canva")) return "Canva";
  if (lower.includes("notion")) return "Notion";
  if (lower.includes("overleaf")) return "Overleaf";
  if (lower.includes("preview") && lower.includes("mac")) return "macOS Preview";
  if (lower.includes("scan")) return "Scanned";
  // Unknown — return the original, trimmed and capped, so the card
  // can still show something meaningful.
  return s.slice(0, 30);
}
