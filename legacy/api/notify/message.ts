export const config = { runtime: "edge" };

/**
 * Email notification for new chat messages.
 *
 * SECURITY MODEL (post-hardening):
 *   - Requires `Authorization: Bearer <supabase_access_token>` from a signed-
 *     in user. We resolve the sender ID from the JWT — the client's
 *     `senderId` field is IGNORED.
 *   - `receiverId` IS accepted from the client but we then look up that
 *     user's email via the service-role Supabase REST API. The client's
 *     `receiverEmail` field is IGNORED. This closes the open email relay
 *     where an attacker could POST {senderId, receiverId, receiverEmail:
 *     "victim@wherever.com"} and spam arbitrary addresses.
 *   - We verify that sender↔receiver have a connection row (i.e. they
 *     actually matched on the platform) before sending. Un-matched pairs
 *     get a silent no-op.
 *   - CORS is restricted to the app's own origins instead of `*`.
 *   - Rate-limited per (sender, receiver) pair via
 *     `email_notifications_log` (10-minute cooldown).
 *
 * Request body:
 *   {
 *     receiverId:     uuid    — target user (required)
 *     messagePreview: string  — first line of the message (optional)
 *   }
 *
 * Response shape: { sent: boolean, reason?: string }
 */

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const RESEND_FROM = process.env.RESEND_FROM || "Bas Udrus <noreply@basudrus.com>";
const APP_URL = process.env.APP_URL || "https://www.basudrus.com";

const RATE_LIMIT_MINUTES = 10;
const MAX_BODY_BYTES = 8 * 1024;

const ALLOWED_ORIGINS = [
  "https://basudrus.com",
  "https://www.basudrus.com",
  "https://basudrus.vercel.app",
];

function exactOriginMatch(origin: string | null | undefined): boolean {
  if (!origin) return false;
  let host: string;
  try {
    const u = new URL(origin);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    host = u.host.toLowerCase();
  } catch { return false; }
  return ALLOWED_ORIGINS.some((a) => {
    try { return new URL(a).host.toLowerCase() === host; } catch { return false; }
  });
}

function corsHeaders(origin: string | null | undefined): Record<string, string> {
  const h: Record<string, string> = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
  };
  if (exactOriginMatch(origin)) {
    h["Access-Control-Allow-Origin"] = origin!;
    h["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    h["Access-Control-Allow-Headers"] = "Content-Type, Authorization";
    h["Vary"] = "Origin";
  }
  return h;
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Verify the Supabase access token and return the authed user's id + email.
 * Uses the anon-key /auth/v1/user endpoint which Supabase designs for this
 * purpose (validates the JWT signature + expiry server-side).
 */
async function getSessionUser(accessToken: string): Promise<{ id: string; email: string } | null> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!res.ok) return null;
    const data = await res.json() as { id?: string; email?: string };
    if (!data.id || !data.email || !UUID_RE.test(data.id)) return null;
    return { id: data.id, email: data.email };
  } catch {
    return null;
  }
}

/** Look up the receiver's profile email + name by id (service role). */
async function getReceiverProfile(receiverId: string): Promise<{ email: string; name: string } | null> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(receiverId)}&select=email,name&limit=1`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
      },
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as Array<{ email?: string; name?: string }>;
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const row = rows[0];
    if (!row.email || !EMAIL_RE.test(row.email)) return null;
    return { email: row.email, name: String(row.name || "").slice(0, 120) };
  } catch {
    return null;
  }
}

/**
 * Verify a connection row exists so strangers can't trigger emails. We don't
 * require a specific direction — either (sender -> receiver) or the reverse
 * is fine, since a match creates rows in both directions.
 */
async function connectionExists(senderId: string, receiverId: string): Promise<boolean> {
  try {
    const url =
      `${SUPABASE_URL}/rest/v1/connections`
      + `?select=user_id`
      + `&user_id=eq.${encodeURIComponent(senderId)}`
      + `&partner_id=eq.${encodeURIComponent(receiverId)}`
      + `&limit=1`;
    const res = await fetch(url, {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    });
    if (!res.ok) return false;
    const rows = (await res.json()) as unknown[];
    return Array.isArray(rows) && rows.length > 0;
  } catch {
    return false;
  }
}

/** Fetch the authed user's display name from their profile. */
async function getSenderName(senderId: string): Promise<string> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(senderId)}&select=name&limit=1`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
      },
    );
    if (!res.ok) return "A student";
    const rows = (await res.json()) as Array<{ name?: string }>;
    return String(rows?.[0]?.name || "A student").slice(0, 120);
  } catch {
    return "A student";
  }
}

export default async function handler(req: Request): Promise<Response> {
  const origin = req.headers.get("origin");
  const cors = corsHeaders(origin);

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return jsonResponse(405, { error: "Method not allowed" }, cors);

  // Reject oversized bodies
  const len = parseInt(req.headers.get("content-length") || "0", 10);
  if (Number.isFinite(len) && len > MAX_BODY_BYTES) {
    return jsonResponse(413, { error: "Payload too large" }, cors);
  }

  // Env must be fully configured — if any key is missing we NO-OP silently so
  // the chat flow doesn't break, but we don't attempt any sends or DB calls.
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !SUPABASE_ANON_KEY) {
    return jsonResponse(200, { sent: false, reason: "email_not_configured" }, cors);
  }

  // Require a valid user session. The attacker used to be able to POST with
  // arbitrary senderId; now the sender is derived from the bearer token.
  const authHeader = req.headers.get("authorization") || "";
  const match = authHeader.match(/^Bearer\s+(\S+)$/);
  if (!match) {
    return jsonResponse(401, { sent: false, reason: "unauthenticated" }, cors);
  }
  const session = await getSessionUser(match[1]);
  if (!session) {
    return jsonResponse(401, { sent: false, reason: "invalid_token" }, cors);
  }
  const senderId = session.id;

  let body: { receiverId?: string; messagePreview?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { error: "Invalid JSON" }, cors);
  }

  const receiverId = String(body.receiverId || "").trim();
  const messagePreview = String(body.messagePreview || "").trim().slice(0, 280);

  if (!receiverId || !UUID_RE.test(receiverId)) {
    return jsonResponse(400, { error: "Missing or invalid receiverId" }, cors);
  }
  if (senderId === receiverId) {
    return jsonResponse(200, { sent: false, reason: "self_message" }, cors);
  }

  // Receiver email is looked up server-side. The client cannot target
  // arbitrary addresses; it can only pick a user ID they already matched with.
  const receiver = await getReceiverProfile(receiverId);
  if (!receiver) {
    return jsonResponse(200, { sent: false, reason: "receiver_not_found" }, cors);
  }

  // Must be a matched pair — strangers can't trigger notifications.
  const paired = await connectionExists(senderId, receiverId);
  if (!paired) {
    return jsonResponse(200, { sent: false, reason: "not_connected" }, cors);
  }

  const senderName = await getSenderName(senderId);

  // Rate-limit via email_notifications_log table (shared between pair)
  const sinceIso = new Date(Date.now() - RATE_LIMIT_MINUTES * 60_000).toISOString();
  try {
    const checkUrl = `${SUPABASE_URL}/rest/v1/email_notifications_log`
      + `?select=sent_at`
      + `&sender_id=eq.${encodeURIComponent(senderId)}`
      + `&receiver_id=eq.${encodeURIComponent(receiverId)}`
      + `&kind=eq.chat_message`
      + `&sent_at=gte.${encodeURIComponent(sinceIso)}`
      + `&limit=1`;
    const checkRes = await fetch(checkUrl, {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    });
    if (checkRes.ok) {
      const rows = (await checkRes.json()) as unknown[];
      if (Array.isArray(rows) && rows.length > 0) {
        return jsonResponse(200, { sent: false, reason: "rate_limited" }, cors);
      }
    }
  } catch {
    // Rate-limit check is best-effort — proceed on failure.
  }

  // If the email provider isn't configured, no-op (but we still ran the
  // authz checks above so an attacker can't use THIS endpoint to probe
  // connection existence for free).
  if (!RESEND_API_KEY) {
    return jsonResponse(200, { sent: false, reason: "email_not_configured" }, cors);
  }

  // Compose
  const firstName = (receiver.name || "there").split(" ")[0];
  const safePreview = escapeHtml(messagePreview);
  const safeSender = escapeHtml(senderName);
  const subject = `${senderName} sent you a message on Bas Udrus`;
  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f5f4f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:520px;margin:32px auto;padding:28px 24px;background:#ffffff;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,0.06)">
    <div style="font-size:24px;font-weight:700;color:#1a1f36;letter-spacing:-0.02em;margin-bottom:4px">Bas Udrus</div>
    <div style="font-size:12px;color:#888;margin-bottom:22px;letter-spacing:0.1em">STUDY SMARTER</div>
    <div style="font-size:16px;color:#1a1f36;line-height:1.55;margin-bottom:10px">
      Hey ${escapeHtml(firstName)} 👋
    </div>
    <div style="font-size:15px;color:#5A6370;line-height:1.65;margin-bottom:18px">
      <strong style="color:#1a1f36">${safeSender}</strong> just sent you a message:
    </div>
    ${safePreview ? `
    <div style="background:#f5f4f0;border-left:3px solid #4F7EF7;padding:14px 16px;border-radius:8px;margin-bottom:22px;font-size:14px;color:#1a1f36;line-height:1.55">
      ${safePreview.replace(/\n/g, "<br>")}
    </div>` : ""}
    <a href="${APP_URL}" style="display:inline-block;background:#1a1f36;color:#fff;padding:12px 28px;border-radius:99px;font-size:14px;font-weight:700;text-decoration:none">Open the chat →</a>
    <div style="font-size:11px;color:#aaa;margin-top:28px;line-height:1.5;border-top:1px solid #eee;padding-top:14px">
      You're receiving this because you matched with ${safeSender} on Bas Udrus.
      <br>Made in Amman, Jordan 🇯🇴
    </div>
  </div>
</body></html>`;

  const text = `${firstName ? `Hi ${firstName},\n\n` : ""}${senderName} sent you a message on Bas Udrus:\n\n${messagePreview}\n\nOpen: ${APP_URL}`;

  // Send via Resend
  try {
    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: [receiver.email],
        subject,
        html,
        text,
      }),
    });
    if (!resendRes.ok) {
      return jsonResponse(200, { sent: false, reason: "provider_error", status: resendRes.status }, cors);
    }
  } catch {
    return jsonResponse(200, { sent: false, reason: "provider_exception" }, cors);
  }

  // Log for rate limiting (fire-and-forget)
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/email_notifications_log`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        sender_id: senderId,
        receiver_id: receiverId,
        kind: "chat_message",
      }),
    });
  } catch {
    // swallow
  }

  return jsonResponse(200, { sent: true }, cors);
}
