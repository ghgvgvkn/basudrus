/**
 * readPdfAsBase64 — read a PDF File and return base64 + metadata.
 *
 * Architecture decision (2026-05-08): we no longer extract PDF text
 * on the client. Instead we send the raw PDF bytes to Anthropic as
 * a `document` content block — Claude reads it natively, including
 * scanned PDFs (built-in OCR) and complex layouts (figures, tables,
 * equations, multi-column).
 *
 * The previous pdfjs-dist path crashed on iOS Safari with
 * "undefined is not a function (near '...i of t...')" — a known
 * v5/legacy-build incompatibility with WebKit's iterable handling
 * in module workers. Rather than chase a moving target through
 * pdfjs internals, we just hand the bytes to Claude. Same end
 * result for the student, no parser to break.
 *
 * Trade-off: Anthropic accepts up to 32 MB / 100 pages, but our
 * edge function caps requests at 1.5 MB. A 1 MB raw PDF base64-
 * encodes to ~1.33 MB, which leaves ~170 KB for the system prompt,
 * messages history, and other context. So we cap inputs at 1 MB.
 * Larger PDFs surface a friendly "split it or send a screenshot"
 * message — covers ~95% of real homework / chapter / past-paper
 * uploads. Long textbooks need to be split anyway because Claude's
 * context window benefits from focused chunks.
 */

export interface ReadPdfResult {
  /** Base64 string with no prefix — what the API needs in the
   *  `data` field of an Anthropic document content block. */
  base64: string;
  /** Original filename (e.g. "midterm-2024.pdf") for display. */
  filename: string;
  /** Raw bytes of the PDF as the user uploaded it. */
  sizeBytes: number;
}

/** Hard cap on PDF input size. 1 MB raw → ~1.33 MB base64, leaving
 *  ~170 KB inside our 1.5 MB edge-function body cap for the rest
 *  of the request. Keep these numbers in sync if MAX_BODY_BYTES on
 *  the server changes. */
export const MAX_PDF_BYTES = 1 * 1024 * 1024;

export class PdfTooLargeError extends Error {
  constructor(public readonly sizeMb: number) {
    super(`PDF is ${sizeMb.toFixed(1)} MB; cap is 1 MB.`);
    this.name = "PdfTooLargeError";
  }
}

/** Read a File into an ArrayBuffer. */
function fileToArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error("PDF read failed"));
    reader.readAsArrayBuffer(file);
  });
}

/** Convert an ArrayBuffer to base64 in chunks. The naïve
 *  `btoa(String.fromCharCode(...new Uint8Array(buf)))` blows the
 *  argument-length limit on large buffers (Safari throws around
 *  100 KB). Chunking keeps memory + arg counts safe up to several
 *  MB. */
function bufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000; // 32 KB per chunk — safe in every browser
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
    // String.fromCharCode.apply works for the chunked size.
    binary += String.fromCharCode.apply(null, Array.from(slice));
  }
  return btoa(binary);
}

/** Read a PDF File, validate size, return base64 + metadata.
 *  Throws PdfTooLargeError if over the cap so the caller can show
 *  a precise message. Other errors propagate as-is. */
export async function readPdfAsBase64(file: File): Promise<ReadPdfResult> {
  if (file.size > MAX_PDF_BYTES) {
    throw new PdfTooLargeError(file.size / (1024 * 1024));
  }
  const buf = await fileToArrayBuffer(file);
  const base64 = bufferToBase64(buf);
  return {
    base64,
    filename: file.name,
    sizeBytes: file.size,
  };
}
