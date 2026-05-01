/**
 * uploadVoice — push a recorded voice blob to the chat-files bucket
 * and return a public URL.
 *
 * Path convention matches production: `{user_id}/{timestamp}-{random}.webm`
 * The bucket is public, so the returned URL plays directly in an
 * <audio> element with no signed URL refresh.
 *
 * The 10 MiB bucket cap is enforced at the Storage layer; the
 * client also caps recordings at ~3 minutes via the recorder UI.
 *
 * Path includes the calling user's id as the first folder component
 * because the storage RLS policy requires it (Users can upload chat
 * files: `(storage.foldername(name))[1] = auth.uid()::text`).
 */
import { supabase } from "@/lib/supabase";

export interface VoiceUploadResult {
  publicUrl: string;
  storagePath: string;
  /** Convenience for messages.file_name (the basename). */
  fileName: string;
  /** Reported by MediaRecorder. */
  mimeType: string;
  /** Bytes. */
  size: number;
}

const BUCKET = "chat-files";

/** Storage-side cap is 10 MiB; we mirror it client-side so a slow
 *  network doesn't waste time on a doomed upload AND we get a useful
 *  error before the request fires. The recorder UI already caps
 *  duration at ~3 min, but a 3-min Opus blob is well under the cap so
 *  this guard is mostly defense-in-depth. */
const MAX_BYTES = 10 * 1024 * 1024;

/** Audio MIME types we know the bucket accepts and the playback path
 *  can decode. Anything outside this list is rejected client-side
 *  rather than landing in Storage with the wrong contentType. */
const ALLOWED_MIME = /^audio\/(webm|ogg|mp4|mpeg|wav|x-m4a)(?:;|$)/i;

/** Upload a Blob/File from MediaRecorder. Returns a public URL ready
 *  to write into messages.file_url. Throws on permission, size, or
 *  network errors — caller should show a toast. */
export async function uploadVoice(blob: Blob, userId: string): Promise<VoiceUploadResult> {
  if (!supabase) throw new Error("Storage unavailable.");
  if (!blob || blob.size === 0) throw new Error("Empty recording — try again.");
  if (blob.size > MAX_BYTES) {
    throw new Error("That recording is over 10 MiB. Trim it and try again.");
  }

  // Pick a friendly extension from the recorder MIME, defaulting to
  // .webm because that's what Chrome/Firefox/Edge produce by default
  // and what production has stored historically.
  const mimeType = blob.type || "audio/webm";
  if (!ALLOWED_MIME.test(mimeType)) {
    // Reject non-audio blobs at the gate. The bucket also rejects them
    // server-side, but failing fast saves a round-trip and gives the
    // user a clearer error than Supabase's generic 415.
    throw new Error("Unsupported audio format.");
  }
  const ext =
    /audio\/webm/i.test(mimeType) ? "webm" :
    /audio\/ogg/i.test(mimeType)  ? "ogg" :
    /audio\/(mp4|x-m4a)/i.test(mimeType)  ? "m4a" :
    /audio\/mpeg/i.test(mimeType) ? "mp3" :
    /audio\/wav/i.test(mimeType)  ? "wav" :
    "webm";

  // {user_id}/{timestamp}-{random}.ext — same shape production uses.
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const storagePath = `${userId}/${filename}`;

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, blob, {
      contentType: mimeType,
      cacheControl: "3600",
      upsert: false,
    });
  if (upErr) {
    // Common errors: 413 (too big), 415 (mime not allowed), 401 (no
    // session). Re-throw so the caller can surface a friendly toast.
    throw new Error(upErr.message || "Voice upload failed.");
  }

  // Bucket is public, so we can compose the URL deterministically
  // (or use getPublicUrl which does the same thing). We use the SDK
  // helper so future bucket renames don't break this.
  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);

  return {
    publicUrl: urlData.publicUrl,
    storagePath,
    fileName: filename,
    mimeType,
    size: blob.size,
  };
}
