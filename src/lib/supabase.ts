import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,        // Keep sessions alive (prevents 401s)
    persistSession: true,          // Survive page refreshes
    detectSessionInUrl: true,      // Handle OAuth redirects
  },
  realtime: {
    params: {
      eventsPerSecond: 10,         // Rate-limit realtime events (prevents flooding at 2000 users)
    },
  },
  global: {
    headers: {
      "x-client-info": "bas-udrus/1.0",  // Identify app in Supabase logs
    },
  },
});

// ── Session access helper ──────────────────────────────────────────────────
// supabase-js serializes auth reads through an IndexedDB lock with a "steal"
// acquisition policy. When multiple hot paths call `getSession()` in parallel
// (and this app has 12+ such call sites — profile load, rooms, notify relay,
// AI endpoints, messaging, etc.) the lock gets stolen mid-read and throws
// `AbortError: Lock was stolen by another request`. On slow mobile Safari this
// was the top runtime error.
//
// `getSessionCached()` collapses concurrent callers onto a single in-flight
// promise and caches the result for a short TTL so burst reads (e.g. the 10
// parallel loaders fired from BasUdrus.tsx on sign-in) share one lock cycle.
// `onAuthStateChange` invalidates the cache on sign-in/out/token-refresh so we
// never serve a stale token.
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
  // Any auth transition invalidates the cache. TOKEN_REFRESHED is included
  // because the access_token changes — stale cache would hand out the old JWT.
  if (event === "SIGNED_IN" || event === "SIGNED_OUT" ||
      event === "TOKEN_REFRESHED" || event === "USER_UPDATED" ||
      event === "PASSWORD_RECOVERY") {
    sessionCache = null;
    sessionInflight = null;
  }
});

export type Profile = {
  id: string;
  name: string;
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

export type SubjectHistory = {
  id: string;
  user_id: string;
  subject: string;
  status: string;
  note: string;
  created_at: string;
};

export type Report = {
  id: string;
  reporter_id: string;
  reported_id: string;
  reason: string;
  created_at: string;
  reporter?: Profile;
  reported?: Profile;
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
