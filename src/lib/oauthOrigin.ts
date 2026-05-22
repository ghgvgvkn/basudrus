/**
 * oauthOrigin.ts — cross-subdomain memory of "which origin did the
 * user start OAuth from" so we can bounce them back there.
 *
 * Why a cookie + not localStorage:
 *   The Aurora sign-in modal (ai.basudrus.com) and SignInGate
 *   (basudrus.com) need to share this value. localStorage is scoped
 *   per origin — a value set on ai.basudrus.com isn't visible to
 *   basudrus.com (and vice versa). After Google OAuth, Supabase may
 *   redirect the user to whichever origin matches its Site URL
 *   fallback — they could land on the OTHER subdomain from where
 *   they started. We need the marker to survive that cross.
 *
 * A cookie with Domain=.basudrus.com travels between subdomains
 * automatically. Same trick used for the supabase auth token cookie
 * in src/lib/supabase.ts.
 *
 * Lifetime: 5 minutes. The OAuth round-trip takes seconds; anything
 * older is a stale attempt from a previous tab the user forgot about.
 */

const COOKIE_NAME = "bu_oauth_origin";
const COOKIE_DOMAIN = ".basudrus.com";
const TTL_SECONDS = 300; // 5 minutes

/** True iff we're on a real *.basudrus.com host (not localhost or
 *  a Vercel preview .vercel.app URL). Cookie with Domain=.basudrus.com
 *  only writes successfully when the current hostname matches. */
function isBasudrusHost(): boolean {
  if (typeof window === "undefined") return false;
  return /(^|\.)basudrus\.com$/i.test(window.location.hostname);
}

export interface OauthOriginEntry {
  /** The window.location.origin the user clicked Sign-in from. */
  origin: string;
  /** Unix ms — for TTL expiry. */
  ts: number;
}

/** Persist the calling origin so we can bounce the user back after
 *  Supabase redirects them somewhere else (typically the Site URL). */
export function setOauthOrigin(origin: string): void {
  if (typeof document === "undefined") return;
  const payload = encodeURIComponent(JSON.stringify({ origin, ts: Date.now() } satisfies OauthOriginEntry));
  if (isBasudrusHost()) {
    // Cross-subdomain cookie — the production case. domain=.basudrus.com
    // makes it readable by basudrus.com, ai.basudrus.com, www.basudrus.com.
    const secure = window.location.protocol === "https:" ? "; secure" : "";
    document.cookie = `${COOKIE_NAME}=${payload}; path=/; max-age=${TTL_SECONDS}; samesite=lax; domain=${COOKIE_DOMAIN}${secure}`;
  } else {
    // Local dev / Vercel previews — no .basudrus.com cookie domain
    // possible. Fall back to localStorage so testing still works.
    try { window.localStorage.setItem(COOKIE_NAME, payload); } catch { /* noop */ }
  }
}

/** Read the saved origin (if any) — checks the cookie first, falls
 *  back to localStorage for the dev/preview path. */
export function readOauthOrigin(): OauthOriginEntry | null {
  if (typeof document === "undefined") return null;
  // Cookie first (production cross-subdomain path)
  const match = document.cookie.match(new RegExp("(?:^|; )" + COOKIE_NAME + "=([^;]*)"));
  let raw: string | null = match ? match[1] : null;
  if (!raw) {
    try { raw = window.localStorage.getItem(COOKIE_NAME); } catch { /* noop */ }
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as Partial<OauthOriginEntry>;
    if (!parsed.origin || typeof parsed.ts !== "number") return null;
    // TTL expiry — old entry from a previous abandoned sign-in.
    if (Date.now() - parsed.ts > TTL_SECONDS * 1000) return null;
    return { origin: parsed.origin, ts: parsed.ts };
  } catch {
    return null;
  }
}

/** Clear the marker after use — single-use so we don't keep bouncing. */
export function clearOauthOrigin(): void {
  if (typeof document === "undefined") return;
  // Clear cookie
  if (isBasudrusHost()) {
    document.cookie = `${COOKIE_NAME}=; path=/; max-age=0; domain=${COOKIE_DOMAIN}`;
  }
  // Also clear localStorage fallback
  try { window.localStorage.removeItem(COOKIE_NAME); } catch { /* noop */ }
}
