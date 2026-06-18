/**
 * uploadAvatar — mobile twin of the web `uploadAvatar` helper.
 *
 * Pushes an image picked via expo-image-picker into the Supabase
 * Storage `avatars` bucket, then patches `profiles.photo_url` so
 * the new picture shows everywhere instantly (Discover, Profile,
 * Chat headers — anywhere Avatar is rendered with photoUrl).
 *
 * Web reference: /src/features/profile/uploadAvatar.ts
 *
 * Differences for React Native:
 *   - We don't have a `File` object. expo-image-picker gives us a
 *     local `uri` plus a guessed `mimeType`. We pull the bytes via
 *     `fetch(uri).then(r => r.arrayBuffer())` — this is the same
 *     trick the Supabase RN docs recommend, and works on both iOS
 *     and Android (the iOS file:// URI is exposed to fetch).
 *   - Path matches the avatars bucket RLS: `<userId>/<timestamp>.<ext>`
 *     so users can only write under their own prefix.
 *   - We pass `contentType` explicitly so Supabase serves the right
 *     header back; otherwise the bucket would label the upload
 *     `application/octet-stream` and some image tags won't render it.
 *
 * 8 MB cap matches the storage policy on the server. Anything larger
 * gets rejected client-side so we don't waste bandwidth.
 *
 * ── 0-row bug fix (Aug 2026) ─────────────────────────────────────
 * The previous version used `.update().eq(id)` WITHOUT `.select().single()`
 * which returns `{ error: null }` even when ZERO rows matched (RLS
 * mismatch, or no profile row at all). The storage upload succeeded,
 * `setProfile(prev => ({...prev, photo_url}))` flipped the UI to the
 * new pic, but nothing was actually written to `profiles.photo_url` —
 * so pull-to-refresh restored the OLD pic. That's the "I have to
 * press on it again to make it save" bug the user reported.
 *
 * Fix mirrors the same defensive pattern `profile.tsx#saveField` uses
 * for text fields:
 *   1. Append `.select().single()` so a 0-row match surfaces as a
 *      real PGRST116 error instead of silent success.
 *   2. On PGRST116, fall back to `.upsert({id, photo_url, photo_mode})`
 *      which seeds a profile row if it doesn't exist yet (handles
 *      the rare case where the handle_new_user trigger didn't fire).
 */
import { supabase } from './supabase';

const MAX_BYTES = 8 * 1024 * 1024;

export type AvatarAsset = {
  uri: string;
  mimeType?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
};

export type UploadResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

function extFromMime(mime?: string | null): string {
  if (!mime) return 'jpg';
  if (/jpeg|jpg/i.test(mime)) return 'jpg';
  if (/png/i.test(mime)) return 'png';
  if (/webp/i.test(mime)) return 'webp';
  if (/heic|heif/i.test(mime)) return 'heic';
  if (/gif/i.test(mime)) return 'gif';
  return 'jpg';
}

/**
 * Patch the profile's photo_url + photo_mode. Uses the same
 * `select().single()` + `upsert` fallback as the rest of the profile
 * save paths so a missing row OR an RLS mismatch surfaces as a real
 * error instead of a silent success.
 */
async function patchProfilePhoto(
  userId: string,
  patch: { photo_url: string | null; photo_mode: 'photo' | 'emoji' },
): Promise<{ ok: true } | { ok: false; error: string }> {
  // Path 1 — normal update. `.select().single()` surfaces 0-row
  // matches as PGRST116 so we can rescue with upsert below.
  const { error: upErr } = await supabase
    .from('profiles')
    .update(patch)
    .eq('id', userId)
    .select('id')
    .single();
  if (!upErr) return { ok: true };

  // Path 2 — row doesn't exist. Seed it with id + the photo patch so
  // future loads see the right pic. Mirrors saveField's upsert fallback.
  if (upErr.code === 'PGRST116' || /no rows/i.test(upErr.message)) {
    const { error: seedErr } = await supabase
      .from('profiles')
      .upsert({ id: userId, ...patch }, { onConflict: 'id' })
      .select('id')
      .single();
    if (seedErr) return { ok: false, error: seedErr.message };
    return { ok: true };
  }

  return { ok: false, error: upErr.message };
}

export async function uploadAvatar(
  userId: string,
  asset: AvatarAsset,
): Promise<UploadResult> {
  if (!userId) return { ok: false, error: 'Sign in first.' };
  if (!asset?.uri) return { ok: false, error: 'No image selected.' };

  // Early size guard if the picker reported it.
  if (typeof asset.fileSize === 'number' && asset.fileSize > MAX_BYTES) {
    return { ok: false, error: 'Image is over 8 MB. Try a smaller one.' };
  }

  // Pull bytes. fetch() handles both `file://` (iOS/Android local
  // picker URIs) and `content://` (Android scoped storage).
  let bytes: ArrayBuffer;
  let contentType = asset.mimeType ?? 'image/jpeg';
  try {
    const res = await fetch(asset.uri);
    contentType = res.headers.get('content-type') ?? contentType;
    bytes = await res.arrayBuffer();
  } catch (e) {
    return { ok: false, error: 'Could not read that image.' };
  }

  if (bytes.byteLength > MAX_BYTES) {
    return { ok: false, error: 'Image is over 8 MB. Try a smaller one.' };
  }

  const ext = extFromMime(contentType);
  const path = `${userId}/${Date.now()}.${ext}`;

  const { error: stoErr } = await supabase.storage
    .from('avatars')
    .upload(path, bytes, {
      cacheControl: '3600',
      upsert: false,
      contentType,
    });
  if (stoErr) return { ok: false, error: stoErr.message };

  const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
  if (!pub?.publicUrl) return { ok: false, error: "Couldn't get public URL." };

  // Flip the profile to photo mode so the UI swaps from emoji → photo.
  // photo_mode mirrors the web schema; if the column doesn't exist on
  // mobile-only deploys, Supabase will surface that as an error and
  // we'll see it in the toast.
  const patch = await patchProfilePhoto(userId, {
    photo_url: pub.publicUrl,
    photo_mode: 'photo',
  });
  if (!patch.ok) return { ok: false, error: patch.error };

  return { ok: true, url: pub.publicUrl };
}

/**
 * Reset to the emoji avatar. We don't delete the uploaded file (the
 * URL might still be cached by old clients) — we just clear the
 * profile pointer so the Avatar component falls back to the emoji.
 *
 * Same `.select().single()` + upsert fallback as `uploadAvatar` so a
 * missing profile row or an RLS mismatch doesn't fail silently.
 */
export async function clearAvatarPhoto(userId: string): Promise<UploadResult> {
  if (!userId) return { ok: false, error: 'Sign in first.' };
  const patch = await patchProfilePhoto(userId, {
    photo_url: null,
    photo_mode: 'emoji',
  });
  if (!patch.ok) return { ok: false, error: patch.error };
  return { ok: true, url: '' };
}
