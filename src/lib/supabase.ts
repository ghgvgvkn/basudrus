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

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string)?.trim() || '';
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string)?.trim() || '';

// Allow the app to run without Supabase in development when keys are missing
const SUPABASE_CONFIGURED = Boolean(supabaseUrl && supabaseAnonKey);

// ── Cross-subdomain SSO storage ────────────────────────────────────────────
// We're about to launch a second front-door at ai.basudrus.com that shares
// the same Supabase project as basudrus.com. For "sign in once, use both"
// to work, the auth token must live in a cookie scoped to `.basudrus.com`
// (with the leading dot), NOT in localStorage which is per-origin.
//
// Supabase JS by default stores the session in localStorage. Setting a
// custom storage adapter that mirrors writes to a `.basudrus.com` cookie
// (and still writes localStorage for backward compat) is the minimum-touch
// way to unlock SSO without breaking the 691 existing users on the live
// site — they keep their session through the transition.
//
// Behaviour:
//   * basudrus.com / *.basudrus.com  → cookie (Domain=.basudrus.com) + localStorage
//   * localhost / Vercel previews    → localStorage only (no cookie domain trick)
//
// Reads prefer the cookie when present (cross-tab and cross-subdomain
// updates are visible immediately), fall back to localStorage for users
// whose session predates this change.
const COOKIE_DOMAIN = ".basudrus.com";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365; // 1 year — Supabase refreshes token internally

function isBasudrusHost(): boolean {
  if (typeof window === "undefined") return false;
  // Matches basudrus.com, www.basudrus.com, ai.basudrus.com, etc.
  // Does NOT match localhost or *.vercel.app — those fall back to localStorage.
  return /(^|\.)basudrus\.com$/i.test(window.location.hostname);
}

const ssoStorage: Storage | { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void; removeItem: (k: string) => void } = {
  getItem: (key: string): string | null => {
    // Cookie first (lets ai.basudrus.com see a session set by basudrus.com)
    if (typeof document !== "undefined") {
      const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const match = document.cookie.match(new RegExp("(?:^|; )" + escaped + "=([^;]*)"));
      if (match) {
        try { return decodeURIComponent(match[1]); } catch { return match[1]; }
      }
    }
    // Fallback: legacy localStorage (users who signed in before this change)
    try { return typeof window !== "undefined" ? window.localStorage.getItem(key) : null; }
    catch { return null; }
  },
  setItem: (key: string, value: string): void => {
    // Always write localStorage for backward compatibility and same-tab speed
    try { window.localStorage.setItem(key, value); } catch { /* private mode */ }
    // Mirror into a cross-subdomain cookie when on a real basudrus host
    if (typeof document === "undefined" || !isBasudrusHost()) return;
    const encoded = encodeURIComponent(value);
    // 4KB is the per-cookie browser limit; Supabase v2 sessions are typically
    // ~1.5-2.5KB so this fits. If it ever exceeds 4KB the cookie is silently
    // dropped — we still have localStorage as a fallback, so SSO degrades to
    // same-origin but auth keeps working.
    const secure = window.location.protocol === "https:" ? "; secure" : "";
    document.cookie =
      `${key}=${encoded}; path=/; max-age=${COOKIE_MAX_AGE_SECONDS}; ` +
      `samesite=lax; domain=${COOKIE_DOMAIN}${secure}`;
  },
  removeItem: (key: string): void => {
    try { window.localStorage.removeItem(key); } catch { /* ignore */ }
    if (typeof document === "undefined" || !isBasudrusHost()) return;
    document.cookie = `${key}=; path=/; max-age=0; domain=${COOKIE_DOMAIN}`;
  },
};

// Only create the Supabase client if both URL and key are configured
// This allows the app to run in development without Supabase
export const supabase = SUPABASE_CONFIGURED 
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
        // Custom storage: cookie on *.basudrus.com (cross-subdomain SSO),
        // localStorage on everything else. See ssoStorage above.
        storage: ssoStorage as Storage,
      },
      realtime: {
        params: { eventsPerSecond: 10 },
      },
      global: {
        headers: { "x-client-info": "bas-udrus-redesign/1.0" },
      },
    })
  : null as unknown as ReturnType<typeof createClient>;

type SessionResult = Awaited<ReturnType<typeof supabase.auth.getSession>>;
let sessionInflight: Promise<SessionResult> | null = null;
let sessionCache: { at: number; result: SessionResult } | null = null;
const SESSION_TTL_MS = 2000;

export function getSessionCached(): Promise<SessionResult> {
  if (!SUPABASE_CONFIGURED) {
    return Promise.resolve({ data: { session: null }, error: null });
  }
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

if (SUPABASE_CONFIGURED) {
  supabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_IN" || event === "SIGNED_OUT" ||
        event === "TOKEN_REFRESHED" || event === "USER_UPDATED" ||
        event === "PASSWORD_RECOVERY") {
      sessionCache = null;
      sessionInflight = null;
    }
  });
}

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
