/**
 * compressImage — client-side image preparation for AI vision input.
 *
 * Why we compress before upload:
 *   1. Anthropic Haiku 4.5 with vision charges per image — bigger images
 *      cost slightly more.
 *   2. Our edge function has a body-size cap (defends against DoS).
 *      Raw 12-megapixel phone photos are 3-5 MB JPEGs, base64 inflates
 *      to ~5-7 MB — too big to ship in a single request.
 *   3. The model doesn't gain accuracy from above ~1024 px on the long
 *      side for most homework / textbook / equation photos. Bigger
 *      images just mean more upload latency.
 *
 * Output: a JPEG data URL ("data:image/jpeg;base64,...") capped to
 * roughly ~700 KB. Plus the raw base64 string and the media type, so
 * the API can build Anthropic's image content block directly.
 *
 * Failure modes are silent — if compression fails (very rare —
 * decoding a corrupt file, or running out of memory on a low-end
 * phone), we throw and the caller should swallow the error and let
 * the user resend / try a smaller image.
 */

export interface CompressedImage {
  /** "data:image/jpeg;base64,..." — for client-side preview */
  dataUrl: string;
  /** The base64 portion only (no `data:image/jpeg;base64,` prefix).
   *  This is what Anthropic's API expects in the `data` field. */
  base64: string;
  /** Always "image/jpeg" since we re-encode to JPEG. */
  mediaType: "image/jpeg";
  /** Final byte count (post-compression). */
  bytes: number;
  /** Width × height of the encoded image. */
  width: number;
  height: number;
}

/** Max long-side dimension. Above this, accuracy gains are marginal
 *  for the kinds of images students upload (homework photos,
 *  textbook pages, equations, handwriting). */
const MAX_DIMENSION = 1280;

/** JPEG quality. 0.85 is the sweet spot — visually indistinguishable
 *  from the source for photographic content, ~30% smaller than 0.95. */
const JPEG_QUALITY = 0.85;

/** Hard cap on the output size — if compression at 0.85 still
 *  exceeds this, we re-encode at lower quality until we fit. */
const MAX_OUTPUT_BYTES = 700 * 1024;

/** Read a File into an HTMLImageElement so we can draw it to canvas. */
async function fileToImageElement(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Could not decode image."));
      img.src = url;
    });
  } finally {
    // Revoke the object URL once the image has loaded — frees memory.
    URL.revokeObjectURL(url);
  }
}

/** Pick output dimensions: scale down so the long side equals
 *  MAX_DIMENSION; otherwise keep original size. Never upscale. */
function pickDimensions(srcW: number, srcH: number): { w: number; h: number } {
  const longest = Math.max(srcW, srcH);
  if (longest <= MAX_DIMENSION) return { w: srcW, h: srcH };
  const scale = MAX_DIMENSION / longest;
  return { w: Math.round(srcW * scale), h: Math.round(srcH * scale) };
}

/** Encode a canvas to a JPEG data URL, retrying with lower quality
 *  if we exceed MAX_OUTPUT_BYTES. We rarely need the retry — a
 *  1024 px JPEG at 0.85 is almost always under 500 KB — but the
 *  retry guards against pathological inputs (uniform-color regions
 *  that compress poorly, or content with extreme detail). */
function canvasToCompressedDataUrl(canvas: HTMLCanvasElement): string {
  let quality = JPEG_QUALITY;
  for (let attempt = 0; attempt < 4; attempt++) {
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    // base64 inflates by ~33%; bytes ≈ length × 0.75 minus the prefix.
    const approxBytes = (dataUrl.length - "data:image/jpeg;base64,".length) * 0.75;
    if (approxBytes <= MAX_OUTPUT_BYTES) return dataUrl;
    quality -= 0.15;
    if (quality < 0.4) return dataUrl; // give up — return what we have
  }
  return canvas.toDataURL("image/jpeg", 0.4);
}

/** Compress an arbitrary image file (PNG, JPEG, HEIC if browser
 *  supports it, etc.) into a vision-ready JPEG data URL.
 *  Throws on decode failure so the caller can surface a friendly
 *  message ("That image couldn't be read — try another one"). */
export async function compressImage(file: File): Promise<CompressedImage> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Not an image file.");
  }
  const img = await fileToImageElement(file);
  const { w, h } = pickDimensions(img.naturalWidth, img.naturalHeight);

  // Draw to canvas at the target size. We use createElement rather
  // than OffscreenCanvas because the latter isn't supported on Safari
  // < 16 and we want this to work on the older Jordanian student
  // phones too.
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Canvas not available.");
  // White background — JPEG has no alpha, so transparent regions
  // would otherwise turn black.
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, w, h);
  // High-quality downscale.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, w, h);

  const dataUrl = canvasToCompressedDataUrl(canvas);
  const base64 = dataUrl.replace(/^data:image\/jpeg;base64,/, "");
  // Approximate byte count from the base64 length (every 4 base64 chars
  // = 3 raw bytes). Close enough for telemetry / UI hints.
  const bytes = Math.floor((base64.length * 3) / 4);

  return { dataUrl, base64, mediaType: "image/jpeg", bytes, width: w, height: h };
}
