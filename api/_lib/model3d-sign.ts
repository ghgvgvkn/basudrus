/**
 * model3d-sign — stateless job-ownership tokens for /api/research/model3d.
 *
 * A text-to-3D job runs upstream (Meshy) for 30-120s, so the client
 * must poll. Polling needs an IDOR check — user A must not read user
 * B's job — but a Supabase job table is overkill for a fire-and-watch
 * job with no other persisted state. Instead the CREATE response
 * carries an HMAC token binding (jobId, userId); the POLL request
 * presents it, and we recompute server-side with the caller's
 * verified userId. Forging a token for someone else's job requires
 * the server secret.
 *
 * Pure WebCrypto (globalThis.crypto.subtle) — works on Vercel Edge
 * AND under Node 24, so scripts/tests/ can import this REAL source
 * via type stripping (same zero-drift pattern as gestures.ts).
 */

function b64url(bytes: ArrayBuffer): string {
  let s = "";
  const view = new Uint8Array(bytes);
  for (let i = 0; i < view.length; i++) s += String.fromCharCode(view[i]);
  // btoa exists on Edge and Node >= 16
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

/** Token binding a job to the user who created it. */
export async function signJobToken(jobId: string, userId: string, secret: string): Promise<string> {
  const key = await hmacKey(secret);
  // \n separator — neither jobId (validated UUID-ish) nor userId
  // (Supabase UUID) can contain it, so the pair can't be ambiguous.
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${jobId}\n${userId}`));
  return b64url(mac);
}

/** Constant-time-ish comparison — avoids early-exit timing leaks. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyJobToken(
  token: string,
  jobId: string,
  userId: string,
  secret: string,
): Promise<boolean> {
  if (!token || !jobId || !userId || !secret) return false;
  const expected = await signJobToken(jobId, userId, secret);
  return timingSafeEqual(token, expected);
}

/** Meshy task ids are UUID-shaped. Reject anything else BEFORE it is
 *  interpolated into the upstream URL — no path traversal, ever. */
export function isValidJobId(jobId: string): boolean {
  return /^[0-9a-zA-Z-]{8,64}$/.test(jobId);
}
