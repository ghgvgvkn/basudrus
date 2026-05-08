/**
 * extractPdf — pull text out of a PDF in the browser using pdfjs-dist.
 *
 * Why this exists: the AI's vision input handles photos of single
 * pages, but most students upload entire PDFs (lecture slides, past
 * papers, syllabi, textbook chapters). pdfjs lets us parse them
 * client-side, extract the text, and feed it to Bas Udros as context
 * — the same flow ChatGPT uses for "upload a PDF" but built to
 * preserve our Socratic guardrails.
 *
 * Output: { pages: Array<{ index, text }>, plainText, characterCount,
 *           pageCount, filename, sizeBytes }. The plain text is what
 * we send to the AI as context; the per-page array is kept for the
 * preview card UI ("12 pages — tap a page to jump to it" — future).
 *
 * Limits + safety:
 *   - Worker is loaded from the same origin (vite serves it from
 *     pdfjs-dist) so there's no third-party fetch to break offline.
 *   - We cap extraction at 80 pages — past that, the prompt budget
 *     blows up and the AI doesn't benefit. Students with longer
 *     books can split their PDF.
 *   - We cap the joined plain text at 60 KB before sending to the
 *     API. Anything longer gets truncated with a "[...truncated]"
 *     marker. This matches the past_papers.transcribed_text cap
 *     in Supabase so the same content can be saved into the DB.
 *   - Errors throw; the caller swallows or surfaces a toast.
 */

import * as pdfjsLib from "pdfjs-dist";

// pdfjs needs a worker. Two viable Vite imports:
//   (a) `?url`    → string URL pdfjs uses to construct its own Worker.
//   (b) `?worker` → Worker constructor; we instantiate directly and
//                   pass the port to pdfjs via `workerPort`.
//
// Path (b) is more reliable for production module workers — the
// previous (a)-only setup silently failed for some students on what
// looked like normal PDFs because the URL-based worker construction
// hit edge cases (CSP nuances, redirects, missing module type),
// after which pdfjs fell back to its internal "fake worker" which
// throws on otherwise-valid PDFs.
//
// Setup runs lazily on first extraction so module load never blocks
// and we can fall through gracefully on environments where neither
// import works (very old browsers, ad-blockers that nuke workers).

let workerInitPromise: Promise<void> | null = null;

async function ensureWorker(): Promise<void> {
  if (workerInitPromise) return workerInitPromise;
  workerInitPromise = (async () => {
    // Try the Worker-constructor path first.
    try {
      const mod = await import("pdfjs-dist/build/pdf.worker.min.mjs?worker");
      const WorkerCtor = (mod as { default: new () => Worker }).default;
      pdfjsLib.GlobalWorkerOptions.workerPort = new WorkerCtor();
      return;
    } catch {
      // Fall through to the URL path.
    }
    // URL path — older / non-module-worker fallback.
    try {
      const mod = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
      const url = (mod as { default: string }).default;
      pdfjsLib.GlobalWorkerOptions.workerSrc = url;
    } catch {
      // Both paths failed — pdfjs will surface a clear error when
      // getDocument() is called; the caller will show "couldn't
      // initialize PDF reader".
    }
  })();
  return workerInitPromise;
}

export interface ExtractedPdfPage {
  /** 1-indexed page number, matching how humans cite PDFs. */
  index: number;
  /** Concatenated text for this page. Whitespace normalised but
   *  newlines preserved between text items. */
  text: string;
}

export interface ExtractedPdf {
  filename: string;
  sizeBytes: number;
  pageCount: number;
  /** Pages we actually parsed — capped at MAX_PAGES. */
  pages: ExtractedPdfPage[];
  /** All page text joined with double newlines, capped at MAX_TEXT_BYTES.
   *  This is what gets sent to the AI as context. */
  plainText: string;
  /** Pre-truncation length, so the UI can tell the user "we read
   *  the first N characters of an N-character document". */
  characterCount: number;
  /** True when we truncated because the document was bigger than
   *  the text budget — the preview card shows a hint. */
  truncated: boolean;
}

/** Cap how many pages we attempt to extract. 80 covers most lecture
 *  slide decks and exam papers; bigger textbooks should be split. */
const MAX_PAGES = 80;

/** Cap the joined text payload. 60 KB ≈ ~12k tokens — fits in our
 *  prompt budget alongside the 8.5k-word system prompt comfortably. */
const MAX_TEXT_BYTES = 60_000;

const TRUNCATION_MARKER = "\n\n[...content truncated, document was longer than the AI context window...]";

interface PdfTextItemLike {
  str?: string;
  hasEOL?: boolean;
}
interface PdfTextContentLike {
  items?: PdfTextItemLike[];
}
interface PdfPageLike {
  getTextContent: () => Promise<PdfTextContentLike>;
}
interface PdfDocumentLike {
  numPages: number;
  getPage: (n: number) => Promise<PdfPageLike>;
}

/** Pull a File into an ArrayBuffer for pdfjs. We read the whole
 *  file into memory because pdfjs needs it that way; for our 10 MB
 *  cap that's fine on every device a Jordanian student uses. */
async function fileToArrayBuffer(file: File): Promise<ArrayBuffer> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error("PDF read failed"));
    reader.readAsArrayBuffer(file);
  });
}

/** Convert a single page's text content into a clean string. We
 *  collapse runs of whitespace but preserve hard line breaks (signaled
 *  via `hasEOL` on each item) so equations / lists / tables don't
 *  collapse into one long line. */
function pageItemsToText(content: PdfTextContentLike): string {
  if (!content.items || content.items.length === 0) return "";
  const out: string[] = [];
  for (const item of content.items) {
    const raw = (item.str ?? "").trim();
    if (raw) out.push(raw);
    if (item.hasEOL) out.push("\n");
  }
  return out
    .join(" ")
    // Multiple spaces → single space (keep \n)
    .replace(/[^\S\n]+/g, " ")
    // Collapse 3+ newlines down to 2
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Custom error names so the caller can show a precise message
 *  instead of a generic "couldn't read this PDF" guess. */
export class PdfPasswordError extends Error {
  constructor(msg = "PDF is password-protected.") { super(msg); this.name = "PdfPasswordError"; }
}
export class PdfInvalidError extends Error {
  constructor(msg = "PDF file is invalid or corrupted.") { super(msg); this.name = "PdfInvalidError"; }
}
export class PdfWorkerError extends Error {
  constructor(msg = "PDF reader could not initialize.") { super(msg); this.name = "PdfWorkerError"; }
}

/** Map a raw pdfjs throw into one of our typed errors. pdfjs uses
 *  string-named exception classes (PasswordException etc.) — we read
 *  `e.name` to classify, then fall through to a generic
 *  PdfInvalidError if we can't recognise it. */
function classifyPdfError(e: unknown): Error {
  if (e instanceof Error) {
    const name = e.name || "";
    if (name === "PasswordException") return new PdfPasswordError(e.message || undefined);
    if (name === "InvalidPDFException") return new PdfInvalidError(e.message || undefined);
    if (name === "MissingPDFException") return new PdfInvalidError("PDF file is empty or missing.");
    // Worker-init failures sometimes manifest as a generic Error with
    // a "Setting up fake worker failed" message. Treat as worker error.
    if (/fake worker|workerSrc|workerPort|setting up worker|importScripts/i.test(e.message || "")) {
      return new PdfWorkerError(e.message);
    }
    // Re-wrap as InvalidPDF with the original message preserved so
    // ops can see WHY it failed in DEV — without making the user think
    // their unprotected PDF is somehow protected.
    return new PdfInvalidError(e.message || "PDF could not be parsed.");
  }
  return new PdfInvalidError("PDF could not be parsed.");
}

/** Extract text from a PDF File. Throws a typed error so the caller
 *  can render a precise message:
 *    PdfPasswordError → "This PDF is password-protected. Unlock it…"
 *    PdfInvalidError  → "This PDF is corrupted or unsupported. …"
 *    PdfWorkerError   → "Couldn't initialize the PDF reader. …" */
export async function extractPdf(file: File): Promise<ExtractedPdf> {
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    throw new PdfInvalidError("Not a PDF file.");
  }

  // Initialize the worker on first call. Idempotent + cached.
  await ensureWorker();

  const arrayBuffer = await fileToArrayBuffer(file);

  // pdfjs accepts either a Uint8Array or an object with `data`. We
  // pass the Uint8Array directly because it's the cheaper path.
  // Wrapping the load in try/catch lets us classify password vs
  // corrupted vs worker-init failures separately.
  let doc: PdfDocumentLike;
  try {
    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(arrayBuffer),
      // Don't try to use system fonts — speeds up load and avoids
      // a class of "missing font" errors on cheap Android browsers.
      disableFontFace: true,
      // Tell pdfjs we want errors thrown synchronously rather than
      // surfaced via the async password callback (the alternative
      // would hang waiting for a password we never provide).
    });
    doc = (await loadingTask.promise) as PdfDocumentLike;
  } catch (e) {
    if (import.meta.env.DEV) console.warn("[extractPdf] getDocument failed:", e);
    throw classifyPdfError(e);
  }

  const pageCount = doc.numPages;
  const pagesToParse = Math.min(pageCount, MAX_PAGES);

  // Per-page extraction is wrapped — a single bad page (e.g. a
  // malformed text stream on page 7 of an otherwise-fine 80-page
  // textbook) shouldn't kill the whole extraction. We skip the bad
  // page and continue. If EVERY page fails we bubble up the last
  // error so the caller can show "couldn't read this PDF".
  const pages: ExtractedPdfPage[] = [];
  let lastPageErr: unknown = null;
  for (let i = 1; i <= pagesToParse; i++) {
    try {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      pages.push({ index: i, text: pageItemsToText(content) });
    } catch (e) {
      lastPageErr = e;
      if (import.meta.env.DEV) console.warn(`[extractPdf] page ${i} failed:`, e);
      // Push an empty page so the page-count book-keeping stays right.
      pages.push({ index: i, text: "" });
    }
  }
  if (pages.length === 0 || pages.every((p) => p.text.length === 0)) {
    // Couldn't read any page — almost certainly worker or corruption.
    throw classifyPdfError(lastPageErr ?? new Error("Every page failed to extract."));
  }

  const joined = pages.map((p) => `[Page ${p.index}]\n${p.text}`).join("\n\n");
  const characterCount = joined.length;
  const truncated = characterCount > MAX_TEXT_BYTES;
  const plainText = truncated
    ? joined.slice(0, MAX_TEXT_BYTES - TRUNCATION_MARKER.length) + TRUNCATION_MARKER
    : joined;

  return {
    filename: file.name,
    sizeBytes: file.size,
    pageCount,
    pages,
    plainText,
    characterCount,
    truncated,
  };
}
