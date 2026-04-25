/**
 * Compat re-export — shared/supabase used to own the client, now it
 * lives at src/lib/supabase.ts (matches production layout). Existing
 * imports of `@/shared/supabase` keep working via this shim.
 *
 * `isDemoMode` is always false now — we always have the env vars
 * in the committed `.env`. Kept as a const for compatibility with
 * any caller that still checks.
 */
export { supabase, getSessionCached } from "@/lib/supabase";
export type {
  Profile, Connection, Message, HelpRequest, GroupRoom, Notification,
} from "@/lib/supabase";

export const isDemoMode = false;
