/**
 * attachments — turn a picked photo or PDF into the base64 payload the
 * `/api/ai/tutor` endpoint already accepts.
 *
 * WHY THIS EXISTS:
 *   The web tutor (src/features/ai/) lets students attach photos
 *   (compressImage.ts) and PDFs (readPdfAsBase64.ts) so Tony can read
 *   homework. The backend (api/ai/tutor.ts) already accepts both:
 *     images: [{ base64, mediaType }]   // jpeg/png/webp/gif
 *     pdfs:   [{ base64, name }]         // application/pdf
 *   Mobile just never sent them — the attach button was a paywall stub.
 *   This module is the mobile equivalent of the web's two helpers.
 *
 * CONTRACT (must match tutor.ts validation):
 *   - base64 has NO `data:` prefix (raw base64 only).
 *   - PER_FILE_MAX on the server is ~5.5M base64 chars (~4 MB raw); we
 *     keep images well under that by resizing to 1280px long-side and
 *     JPEG-compressing, and we reject PDFs over MAX_PDF_BYTES (4 MB)
 *     before reading so a huge file never wedges the request.
 *   - mediaType for camera/library photos is normalised to image/jpeg
 *     because we always re-encode to JPEG (smallest, universally
 *     accepted by Anthropic).
 *
 * Everything returns a typed result or throws a friendly Error the
 * caller can surface in an Alert — no silent failures here, because the
 * user explicitly asked to attach something and deserves to know if it
 * didn't work.
 */
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import {
  manipulateAsync,
  SaveFormat,
} from 'expo-image-manipulator';
import { File } from 'expo-file-system';

/** One attachment ready to send + render. */
export interface StagedAttachment {
  kind: 'image' | 'pdf';
  /** Raw base64, no data: prefix. */
  base64: string;
  /** image/jpeg for photos; application/pdf for docs. */
  mediaType: string;
  /** For images: a local uri to render a thumbnail. For PDFs: undefined. */
  uri?: string;
  /** For PDFs: the filename to show + send. */
  name?: string;
}

/** Server rejects PDFs that are too large; reject early with a clear msg.
 *  4 MB matches the web's MAX_PDF_BYTES (src/features/ai/readPdfAsBase64). */
export const MAX_PDF_BYTES = 4 * 1024 * 1024;

/** Long-side cap for photos before upload — matches web compressImage. */
const IMAGE_MAX_DIMENSION = 1280;
/** JPEG quality for re-encode (0..1). 0.7 is a good size/quality balance
 *  on a phone photo of a textbook page — text stays crisp, bytes small. */
const IMAGE_COMPRESS = 0.7;

/**
 * Resize + compress a picked image and return it as base64 JPEG.
 * `width`/`height` are the picker-reported dimensions (used to decide
 * whether the long side needs shrinking — we never upscale).
 */
async function processImage(
  uri: string,
  width?: number,
  height?: number,
): Promise<StagedAttachment> {
  // Only resize when the long side exceeds the cap (avoid upscaling a
  // small image, which just wastes bytes for no quality gain).
  const longSide = Math.max(width ?? 0, height ?? 0);
  const actions =
    longSide > IMAGE_MAX_DIMENSION
      ? [
          // Resize by the LONGER axis so the result fits within the cap
          // in both dimensions, preserving aspect ratio.
          (width ?? 0) >= (height ?? 0)
            ? { resize: { width: IMAGE_MAX_DIMENSION } }
            : { resize: { height: IMAGE_MAX_DIMENSION } },
        ]
      : [];

  const result = await manipulateAsync(uri, actions, {
    compress: IMAGE_COMPRESS,
    format: SaveFormat.JPEG,
    base64: true,
  });
  if (!result.base64) {
    throw new Error('Could not process that image. Try another photo.');
  }
  return {
    kind: 'image',
    base64: result.base64,
    mediaType: 'image/jpeg',
    uri: result.uri,
  };
}

/** Launch the camera, return a processed attachment (or null if cancelled). */
export async function capturePhoto(): Promise<StagedAttachment | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) {
    throw new Error('Allow camera access to snap your homework.');
  }
  const res = await ImagePicker.launchCameraAsync({ quality: 1 });
  if (res.canceled || !res.assets?.[0]) return null;
  const a = res.assets[0];
  return processImage(a.uri, a.width, a.height);
}

/** Launch the photo library, return a processed attachment (or null). */
export async function pickPhoto(): Promise<StagedAttachment | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    throw new Error('Allow photo access to attach an image.');
  }
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 1,
  });
  if (res.canceled || !res.assets?.[0]) return null;
  const a = res.assets[0];
  return processImage(a.uri, a.width, a.height);
}

/** Launch the document picker for a PDF, read it as base64 (or null). */
export async function pickPdf(): Promise<StagedAttachment | null> {
  const res = await DocumentPicker.getDocumentAsync({
    type: ['application/pdf'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (res.canceled || !res.assets?.[0]) return null;
  const a = res.assets[0];

  // Size gate BEFORE reading bytes into memory.
  if (typeof a.size === 'number' && a.size > MAX_PDF_BYTES) {
    throw new Error('That PDF is over 4 MB — try a smaller file or a single chapter.');
  }

  // expo-file-system v19: read the file's base64 via the File class.
  const file = new File(a.uri);
  const base64 = await file.base64();
  // Guard against a file that slipped past the size check (e.g. size was
  // unknown). base64 is ~4/3 the raw byte count.
  if (base64.length > MAX_PDF_BYTES * 1.4) {
    throw new Error('That PDF is too large — try a smaller file or a single chapter.');
  }
  return {
    kind: 'pdf',
    base64,
    mediaType: 'application/pdf',
    name: a.name ?? 'document.pdf',
  };
}
