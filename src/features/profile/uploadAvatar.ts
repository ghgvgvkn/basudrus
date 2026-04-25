/**
 * uploadAvatar — push a File to Supabase Storage's `avatars` bucket
 * and return its public URL. Bumps the user's profile.photo_url +
 * photo_mode so the UI flips to the photo immediately.
 *
 * Naming: `avatars/<user-id>/<timestamp>.<ext>` so old uploads stay
 * accessible while new ones supersede them. We don't bother
 * cleaning up old ones in this slice — Supabase Storage lifecycle
 * rules handle that on the backend if configured.
 *
 * Strict client-side guards:
 *   - file must be an image
 *   - max 8 MB (matches the avatar storage policy)
 *
 * The DB trigger (profiles_set_updated_at) automatically bumps
 * photo_updated_at when photo_url changes, which is what powers
 * the Discover "recently photographed" sort.
 */
import { supabase } from "@/lib/supabase";
import { getSessionCached } from "@/lib/supabase";

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED_TYPES = /^image\/(png|jpe?g|webp|heic|heif|gif)$/i;

export interface UploadResult {
  ok: boolean;
  url?: string;
  error?: string;
}

export async function uploadAvatar(file: File): Promise<UploadResult> {
  if (!supabase) return { ok: false, error: "Storage unavailable" };
  if (!ALLOWED_TYPES.test(file.type)) {
    return { ok: false, error: "Pick an image (PNG, JPG, WEBP)." };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: "Image is over 8 MB. Try a smaller one." };
  }

  const { data: { session } } = await getSessionCached();
  if (!session?.user) return { ok: false, error: "Sign in first." };

  // Path matches the avatar RLS policy: users can write under
  // their own user-id prefix.
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const safeExt = /^(png|jpe?g|webp|heic|heif|gif)$/i.test(ext) ? ext : "jpg";
  const path = `${session.user.id}/${Date.now()}.${safeExt}`;

  const { error: upErr } = await supabase.storage
    .from("avatars")
    .upload(path, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type,
    });
  if (upErr) return { ok: false, error: upErr.message };

  const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
  if (!pub?.publicUrl) return { ok: false, error: "Couldn't get public URL." };

  // Patch the profiles row — the DB trigger handles photo_updated_at.
  const { error: profErr } = await supabase
    .from("profiles")
    .update({ photo_url: pub.publicUrl, photo_mode: "photo" })
    .eq("id", session.user.id);
  if (profErr) return { ok: false, error: profErr.message };

  return { ok: true, url: pub.publicUrl };
}
