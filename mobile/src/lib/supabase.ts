/**
 * Supabase client — mobile.
 *
 * Differences from the web client:
 *   1. Storage adapter is AsyncStorage (React Native has no
 *      localStorage and no IndexedDB). The Supabase team's official
 *      RN guide uses AsyncStorage; we follow that.
 *   2. No SSO cookie trick — mobile is a single app, not multiple
 *      subdomains. Tokens stay in AsyncStorage scoped to the app.
 *   3. `detectSessionInUrl: false` — the web client uses this to
 *      pick up magic-link tokens from window.location. On RN we
 *      handle deep links explicitly via expo-linking.
 *
 * Env values come from app.json `extra` (read via Constants), not
 * import.meta.env (that's Vite-only). This means changing the URL
 * requires editing app.json + rebuilding the JS bundle — fine for
 * a single-tenant client.
 */
import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { createClient } from '@supabase/supabase-js';

const extra = (Constants.expoConfig?.extra ?? {}) as {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
};

const supabaseUrl = extra.supabaseUrl ?? '';
const supabaseAnonKey = extra.supabaseAnonKey ?? '';

if (!supabaseUrl || !supabaseAnonKey) {
  // Don't throw — let the app boot so the user sees a clear error
  // screen instead of a hard crash on launch.
  console.warn(
    '[supabase] Missing supabaseUrl or supabaseAnonKey in app.json extra. ' +
      'Auth and DB calls will fail until you set them.',
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  global: {
    headers: { 'x-client-info': 'basudrus-mobile/0.1.0' },
  },
});

/** Convenience: get the current access token (or null). */
export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/**
 * Hand-rolled row types — mirror the Supabase `profiles` and `group_rooms`
 * tables (same columns the web app uses, see /src/lib/supabase.ts). We
 * don't run `supabase gen types` from the mobile project, so these stay
 * manual. Keep field nullability matching the actual DB so the UI doesn't
 * silently render "undefined".
 *
 * `pro` is mobile-only and may not exist in the DB yet — query is tolerant
 * (treats undefined as false), so adding the column later is non-breaking.
 */
export type Profile = {
  id: string;
  name: string | null;
  email?: string | null;
  uni: string | null;
  major: string | null;
  year: string | null;
  course?: string | null;
  meet_type?: string | null;
  bio: string | null;
  avatar_emoji: string | null;
  avatar_color: string | null;
  photo_mode?: string | null;
  photo_url: string | null;
  streak: number | null;
  xp: number | null;
  badges?: string[] | null;
  online: boolean | null;
  sessions?: number | null;
  rating?: number | null;
  subjects: string[] | null;
  can_post?: boolean | null;
  /** Pro / paid-tier flag. Optional in mobile until billing ships. */
  pro?: boolean | null;
  last_seen_at: string | null;
  created_at?: string | null;
};

/**
 * Explicit column list for EVERY `profiles` read — deliberately OMITS `email`.
 * The `email` column's SELECT is revoked from the anon/authenticated roles in
 * the live DB (migration `revoke_profiles_email_select`), so a `select('*')`
 * here would 400 AND no signed-in user could harvest other users' emails. Use
 * this in place of `select('*')`. (`pro` is intentionally excluded — it may not
 * exist in the DB yet and the query treats its absence as false.)
 */
export const PROFILE_COLUMNS =
  "id, name, uni, major, year, course, meet_type, bio, avatar_emoji, avatar_color, photo_mode, photo_url, streak, xp, badges, online, sessions, rating, subjects, can_post, last_seen_at, created_at";

export type GroupRoom = {
  id: string;
  host_id: string;
  subject: string;
  date: string;
  time: string;
  type: string; // "online" | "in_person"
  spots: number;
  filled: number;
  link: string;
  location: string;
  created_at?: string;
  host?: Profile;
  joined?: boolean;
};

export type Message = {
  id: string;
  sender_id: string;
  receiver_id: string;
  text: string;
  message_type: 'text' | 'voice' | 'image' | 'file';
  file_url?: string | null;
  file_name?: string | null;
  client_id?: string | null;
  created_at: string;
};

export type Connection = {
  id: string;
  user_id: string;
  partner_id: string;
  rating?: number | null;
  created_at: string;
  partner?: Profile;
};

/**
 * help_requests row — a public "I need help with X" post.
 *
 * Schema (per /sql/20260513_link_help_requests_to_catalog.sql + the
 * original migration that created the table):
 *   - id, user_id, subject (display text), detail (multi-line body)
 *   - meet_type: 'online' | 'in_person' | 'either'
 *   - catalog_id (FK to course_catalog, optional — auto-resolved via
 *     trigger on insert/update if subject matches a known course)
 *   - created_at
 *
 * The web's PostComposer folds the user-typed title and detail into
 * the single `detail` column as "title\n\ndetail", so the feed card
 * can render the headline first. Mobile mirrors that convention.
 */
export type HelpRequest = {
  id: string;
  user_id: string;
  subject: string;
  detail: string;
  meet_type: 'online' | 'in_person' | 'either' | null;
  catalog_id?: string | null;
  created_at: string;
  /** Joined profile of the poster — present when the query selects it. */
  profile?: Profile;
};
