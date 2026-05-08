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

// pdfjs needs a worker. Vite resolves this via its asset handling.
// `?url` returns the URL of the worker file as a string the Worker
// constructor can load. We assign it once on module load.
//
// On older Safari (< 16) the worker setup occasionally fails — pdfjs
// then falls back to a fake worker (slower, but works). That's
// acceptable for our use case.
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

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

/** Extract text from a PDF File. Throws on any pdfjs failure so the
 *  caller can show a friendly message ("That PDF couldn't be read"). */
export async function extractPdf(file: File): Promise<ExtractedPdf> {
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    throw new Error("Not a PDF file.");
  }

  const arrayBuffer = await fileToArrayBuffer(file);
  // pdfjs accepts either a Uint8Array or an object with `data`. We
  // pass the Uint8Array directly because it's the cheaper path.
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) });
  const doc = (await loadingTask.promise) as PdfDocumentLike;

  const pageCount = doc.numPages;
  const pagesToParse = Math.min(pageCount, MAX_PAGES);

  const pages: ExtractedPdfPage[] = [];
  for (let i = 1; i <= pagesToParse; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push({ index: i, text: pageItemsToText(content) });
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
