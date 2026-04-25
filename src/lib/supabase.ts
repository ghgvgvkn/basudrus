/**
 * Supabase client + cached session helper + shared row types.
 *
 * Ported verbatim from the production repo (`bas-udrus-project`) so
 * the redesign speaks the same types as the live site. When we cut
 * over production to this codebase, every hook keeps compiling.
 *
 * Env vars: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY — both live
 * in `.env`. The anon key is publishable/public by design.
 *
 * getSessionCached() collapses concurrent auth reads onto one
 * in-flight promise (2s TTL). On sign-in, 10+ hot paths race
 * supabase.auth.getSession() — the IndexedDB lock has a "steal"
 * policy that throws AbortError in mobile Safari. Caching fixes it.
 */
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
  realtime: {
    params: { eventsPerSecond: 10 },
  },
  global: {
    headers: { "x-client-info": "bas-udrus-redesign/1.0" },
  },
});

type SessionResult = Awaited<ReturnType<typeof supabase.auth.getSession>>;
let sessionInflight: Promise<SessionResult> | null = null;
let sessionCache: { at: number; result: SessionResult } | null = null;
const SESSION_TTL_MS = 2000;

export function getSessionCached(): Promise<SessionResult> {
  const now = Date.now();
  if (sessionCache && now - sessionCache.at < SESSION_TTL_MS) {
    return Promise.resolve(sessionCache.result);
  }
  if (sessionInflight) return sessionInflight;
  sessionInflight = supabase.auth.getSession()
    .then((result) => { sessionCache = { at: Date.now(), result }; return result; })
    .finally(() => { sessionInflight = null; });
  return sessionInflight;
}

supabase.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_IN" || event === "SIGNED_OUT" ||
      event === "TOKEN_REFRESHED" || event === "USER_UPDATED" ||
      event === "PASSWORD_RECOVERY") {
    sessionCache = null;
    sessionInflight = null;
  }
});

// ── Row types — match the live Supabase schema 1-to-1 ──

export type Profile = {
  id: string;
  name: string;
  /**
   * NOTE: privacy of this field is currently best-effort only — every
   * authenticated user can SELECT email cross-user. A previous
   * column-level revoke broke `select("*")` queries app-wide and was
   * rolled back (see migration `restore_profiles_select_grant`). The
   * fix needs to come back as a public-facing view or a SECURITY
   * DEFINER getter, with all `.select("*")` queries migrated to use
   * the explicit-columns list. Until then, prefer reading the user's
   * own email from `session.user.email` rather than this field.
   */
  email: string;
  uni: string;
  major: string;
  year: string;
  course: string;
  meet_type: string;
  bio: string;
  avatar_emoji: string;
  avatar_color: string;
  photo_mode: string;
  photo_url: string | null;
  streak: number;
  xp: number;
  badges: string[];
  online: boolean;
  sessions: number;
  rating: number;
  subjects: string[];
  can_post?: boolean;
  created_at: string;
  /** Updated by `touch_last_seen` RPC every ~5 min via the heartbeat
   *  in useSupabaseSession. Used to render presence dots on avatars
   *  and to power "active in the last 7 days" feed sorting in
   *  Discover. Nullable for users who haven't been seen yet. */
  last_seen_at?: string | null;
};

export type Connection = {
  id: string;
  user_id: string;
  partner_id: string;
  rating: number | null;
  created_at: string;
  partner?: Profile;
};

export type Message = {
  id: string;
  sender_id: string;
  receiver_id: string;
  text: string;
  message_type: "text" | "voice" | "image" | "file";
  file_url: string | null;
  file_name: string | null;
  client_id?: string | null;
  created_at: string;
};

export type HelpRequest = {
  id: string;
  user_id: string;
  subject: string;
  detail: string;
  meet_type: string;
  created_at: string;
  profile?: Profile;
};

export type GroupRoom = {
  id: string;
  host_id: string;
  subject: string;
  date: string;
  time: string;
  type: string;
  spots: number;
  filled: number;
  link: string;
  location: string;
  created_at: string;
  host?: Profile;
  joined?: boolean;
};

export type RoomMessage = {
  id: string;
  room_id: string;
  sender_id: string;
  text: string;
  message_type: string;            // "text" | "voice" | "file"
  file_url: string | null;
  file_name: string | null;
  client_id?: string | null;       // optimistic dedup key
  created_at: string;
  /** Optional join — present when fetched with profile */
  sender?: Profile;
};

export type Notification = {
  id: string;
  user_id: string;
  from_id: string;
  type: string;
  subject: string;
  post_id: string | null;
  read: boolean;
  created_at: string;
  from_profile?: Profile;
};
