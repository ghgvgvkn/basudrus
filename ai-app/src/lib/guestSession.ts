/**
 * guestSession.ts — invisible guest access for Aurora (ai-app ONLY).
 *
 * Founder: "remove the sign up and sign in and make it for any user."
 * Deleting the auth wall client-side wouldn't work — every AI endpoint is
 * JWT-gated server-side, so an unauthenticated visitor would just collect
 * 401s. Instead, every visitor gets an AUTOMATIC anonymous Supabase
 * session on first load: a real auth user with no email/password, created
 * silently. isAuthed flips true app-wide, so the sign-up modal and gates
 * simply never appear — while JWT checks, per-user rate limits and RLS
 * all keep working exactly as before.
 *
 * REQUIRES the Supabase dashboard toggle: Authentication → Sign In / Up →
 * "Allow anonymous sign-ins". While it's OFF, signInAnonymously errors
 * and we fall back silently to the classic sign-up-at-send behavior —
 * shipping this is zero-risk either way.
 *
 * A returning visitor keeps their guest session (and its chats/memory)
 * via the persisted token; a signed-in basudrus.com user is untouched —
 * getSession() finds their real session first. basudrus.com itself never
 * loads this module (it lives in ai-app only).
 */
import { supabase } from "@/lib/supabase";

export async function ensureGuestSession(): Promise<void> {
  try {
    const { data } = await supabase.auth.getSession();
    if (data.session) return; // real user or returning guest — keep it
    const { error } = await supabase.auth.signInAnonymously({
      // handle_new_user copies this into profiles.name, so Tony greets
      // guests as "Guest" instead of a blank.
      options: { data: { name: "Guest" } },
    });
    if (error) {
      // Dashboard toggle off / network down → the classic modal flow
      // still works; nothing breaks.
      console.warn("[aurora] guest session unavailable:", error.message);
    }
  } catch {
    /* offline — browsing still works; send prompts as before */
  }
}
