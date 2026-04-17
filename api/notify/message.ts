export const config = { runtime: "edge" };

/**
 * Email notification for new chat messages.
 *
 * Body:
 *   {
 *     senderId:       uuid   — the author of the message (required, for rate limit)
 *     receiverId:     uuid   — target user (required, for rate limit)
 *     senderName:     string — display name to show in subject
 *     receiverEmail:  string — where to deliver
 *     receiverName:   string — used to greet
 *     messagePreview: string — first line of the message
 *   }
 *
 * Behaviour:
 *   - Rate-limited: skip if we've already emailed this (sender, receiver) pair
 *     for a chat message within the last 10 minutes. Prevents flooding when
 *     Alice sends 5 messages in a row.
 *   - Requires RESEND_API_KEY + RESEND_FROM env vars on Vercel. If either is
 *     missing, the endpoint silently returns 200 {sent:false,reason:"..."} so
 *     the client fetch never fails the user flow.
 *   - Runs on Vercel Edge: no cold starts, 250ms target.
 */

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const RESEND_FROM = process.env.RESEND_FROM || "Bas Udrus <noreply@basudrus.com>";
const APP_URL = process.env.APP_URL || "https://www.basudrus.com";

const RATE_LIMIT_MINUTES = 10;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
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

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  let body: {
    senderId?: string;
    receiverId?: string;
    senderName?: string;
    receiverEmail?: string;
    receiverName?: string;
    messagePreview?: string;
  };
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { error: "Invalid JSON" });
  }

  const senderId = String(body.senderId || "").trim();
  const receiverId = String(body.receiverId || "").trim();
  const senderName = String(body.senderName || "A student").trim().slice(0, 120);
  const receiverEmail = String(body.receiverEmail || "").trim();
  const receiverName = String(body.receiverName || "").trim().slice(0, 120);
  const messagePreview = String(body.messagePreview || "").trim().slice(0, 280);

  if (!senderId || !receiverId || !receiverEmail || !receiverEmail.includes("@")) {
    return jsonResponse(400, { error: "Missing required fields" });
  }
  if (senderId === receiverId) {
    return jsonResponse(200, { sent: false, reason: "self_message" });
  }

  // Short-circuit if email provider isn't configured — don't fail the client.
  if (!RESEND_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return jsonResponse(200, { sent: false, reason: "email_not_configured" });
  }

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
        return jsonResponse(200, { sent: false, reason: "rate_limited" });
      }
    }
    // If the check request itself fails we still attempt to send — better to
    // risk a duplicate email than miss the notification entirely.
  } catch {
    // swallow — rate-limit is best-effort
  }

  // Compose email
  const firstName = (receiverName || "there").split(" ")[0];
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
        to: [receiverEmail],
        subject,
        html,
        text,
      }),
    });
    if (!resendRes.ok) {
      const errTxt = await resendRes.text().catch(() => "");
      return jsonResponse(200, { sent: false, reason: "provider_error", status: resendRes.status, detail: errTxt.slice(0, 200) });
    }
  } catch (e) {
    return jsonResponse(200, { sent: false, reason: "provider_exception", detail: String(e).slice(0, 200) });
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

  return jsonResponse(200, { sent: true });
}
