/**
 * API base URL helper — used by both the main basudrus.com site AND
 * the ai-app deployment (basudrus-ai.vercel.app / ai.basudrus.com).
 *
 * THE PROBLEM THIS SOLVES
 * The ai-app is a SEPARATE Vercel project that has no /api/* edge
 * functions of its own. We originally proxied /api/* → basudrus.com
 * via a vercel.json rewrite. Vercel's docs claim external rewrites
 * are transparent proxies, but in practice they return HTTP 307
 * redirects to the destination. Browsers STRIP the Authorization
 * header when following a cross-origin redirect on a POST (security
 * rule baked into fetch). The server then sees `no_auth` and returns
 * 401 → the chat shows "Please sign in to chat with Tony" even
 * though the user IS signed in.
 *
 * THE FIX
 * Skip the proxy entirely. Have the AI app call basudrus.com's
 * /api/* directly as a normal cross-origin request. Authorization
 * survives because there's no redirect — and CORS is already
 * configured server-side (ai-guard.ts ALLOWED_ORIGINS includes
 * https://basudrus-ai.vercel.app and https://ai.basudrus.com).
 *
 * HOW IT DECIDES
 * 1. Env var VITE_API_BASE (build-time override, optional). When set,
 *    wins. Use this for preview deploys pointing to a non-prod backend.
 * 2. Runtime host detection. If the page is loaded under a host that
 *    isn't basudrus.com itself (e.g. basudrus-ai.vercel.app,
 *    ai.basudrus.com, or any vercel.app preview), point at
 *    https://basudrus.com directly. If we're ON basudrus.com,
 *    relative URLs are used (same origin, no CORS).
 * 3. SSR / no-window fallback: empty base = relative URLs. Vite SSR
 *    isn't used in this app but the guard is cheap.
 *
 * Runtime detection means we don't need to set any Vercel env vars
 * to ship the fix — the basudrus-ai deployment auto-targets
 * basudrus.com just from its hostname.
 */

// PROD API HOST — the single source of truth for the cross-origin
// case. MUST be the canonical host (www.basudrus.com), NOT the apex
// basudrus.com: the apex redirects to www, and browsers strip the
// Authorization header on cross-origin redirects, which would re-
// introduce the exact bug this file is solving. Always point at the
// canonical host so there's no redirect hop.
const PROD_API_HOST = "https://www.basudrus.com";

// Hosts where we should use SAME-ORIGIN (relative URLs). Everything
// else falls through to the cross-origin path. We include both apex
// and www so basudrus.com and www.basudrus.com both stay relative.
const SAME_ORIGIN_HOSTS = new Set([
  "basudrus.com",
  "www.basudrus.com",
  // For local dev where /api is served by Vite proxy or vercel dev.
  "localhost",
  "127.0.0.1",
]);

function detectApiBase(): string {
  // 1. Build-time env override — wins if set.
  const envBase = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";
  if (envBase) return envBase.replace(/\/+$/, "");

  // 2. Runtime host detection. typeof check guards against SSR.
  if (typeof window === "undefined") return "";
  const host = window.location.hostname.toLowerCase();
  if (SAME_ORIGIN_HOSTS.has(host)) return "";

  // Everything else — vercel.app deploys, ai.basudrus.com, preview
  // URLs — talks to basudrus.com cross-origin.
  return PROD_API_HOST;
}

const API_BASE = detectApiBase();

/**
 * Convert a /-prefixed API path to a fully-qualified URL when we're
 * on a cross-origin host, or keep it relative on basudrus.com itself.
 *
 * Examples:
 *   apiUrl("/api/ai/tutor")
 *     → "/api/ai/tutor"                        (on basudrus.com)
 *     → "https://basudrus.com/api/ai/tutor"    (on basudrus-ai.vercel.app)
 *
 * Passing an already-absolute URL is allowed — it's returned as-is
 * so callers can mix without worrying about double-prefixing.
 */
export function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  if (!API_BASE) return path;
  if (!path.startsWith("/")) return `${API_BASE}/${path}`;
  return `${API_BASE}${path}`;
}

/** True when this build is talking to a cross-origin API host. */
export const IS_CROSS_ORIGIN_API = API_BASE.length > 0;
