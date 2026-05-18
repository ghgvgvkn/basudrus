export const config = { runtime: "edge" };

/**
 * One-click unsubscribe for the Sunday letter.
 *
 * Two paths:
 *   - GET  /api/letter/unsubscribe?u=<uuid>&t=<hmac> → renders an HTML
 *     confirmation page after flipping the flag. Used when the user
 *     clicks the link in the email body.
 *   - POST /api/letter/unsubscribe                → RFC 8058 one-click
 *     unsubscribe (Gmail / Apple Mail). Same {u,t} query params.
 *     We respond with 200 OK and an empty body — that's what the
 *     mail clients expect.
 *
 * Token is HMAC-SHA-256(user_id, UNSUBSCRIBE_SECRET). We re-derive
 * server-side and constant-time compare so an attacker can't unsubscribe
 * arbitrary users by guessing UUIDs. UUIDs aren't secret but the HMAC
 * binding is.
 *
 * Effect: sets profiles.letter_unsubscribed = true via service role.
 * Future cron runs will skip this user. The user can re-subscribe via
 * settings (TODO).
 */

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const UNSUBSCRIBE_SECRET = process.env.UNSUBSCRIBE_SECRET || process.env.CRON_SECRET || "";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function expectedToken(userId: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(UNSUBSCRIBE_SECRET || "fallback-secret-change-me"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(userId));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

async function setUnsubscribed(userId: string): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return false;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`,
      {
        method: "PATCH",
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({ letter_unsubscribed: true }),
      },
    );
    return res.ok;
  } catch (e) {
    console.error("[letter/unsubscribe] patch threw:", e);
    return false;
  }
}

function htmlPage(title: string, body: string, status = 200): Response {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${title}</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;background:#F5F4F0;color:#1A2332;margin:0;padding:48px 24px;}
.card{max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:32px;box-shadow:0 8px 24px rgba(0,0,0,.04);}
h1{margin:0 0 12px;font-size:22px;}
p{margin:0 0 12px;line-height:1.6;color:#3a4250;}
a{color:#5B4BF5;text-decoration:none;}</style></head>
<body><div class="card">${body}</div></body></html>`,
    {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "strict-origin-when-cross-origin",
      },
    },
  );
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "GET" && req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }
  const url = new URL(req.url);
  const userId = (url.searchParams.get("u") || "").trim().toLowerCase();
  const token = (url.searchParams.get("t") || "").trim().toLowerCase();

  if (!UUID_RE.test(userId) || !/^[0-9a-f]{64}$/i.test(token)) {
    if (req.method === "POST") return new Response(null, { status: 400 });
    return htmlPage(
      "Invalid link",
      `<h1>Invalid link</h1><p>This unsubscribe link is malformed or has been edited. Please use the link from your latest Sunday letter, or email us if the issue persists.</p>`,
      400,
    );
  }

  const expected = await expectedToken(userId);
  if (!constantTimeEqual(token, expected)) {
    if (req.method === "POST") return new Response(null, { status: 403 });
    return htmlPage(
      "Invalid link",
      `<h1>Invalid link</h1><p>This unsubscribe link is invalid or has expired. Please use the link from your latest Sunday letter.</p>`,
      403,
    );
  }

  const ok = await setUnsubscribed(userId);
  if (req.method === "POST") {
    // RFC 8058 — minimal response. Mail clients only need 200.
    return new Response(null, { status: ok ? 200 : 500 });
  }
  if (!ok) {
    return htmlPage(
      "Something went wrong",
      `<h1>Something went wrong</h1><p>We couldn't process your unsubscribe right now. Please try again in a moment, or email us.</p>`,
      500,
    );
  }
  return htmlPage(
    "You're unsubscribed",
    `<h1>You're unsubscribed.</h1>
<p>You won't receive Sunday letters from Bas Udrus anymore. The rest of the app keeps working — chat with Tony Starrk and Sherlock whenever you want.</p>
<p>Changed your mind? Toggle Sunday letters back on in <a href="https://www.basudrus.com">your settings</a> any time.</p>`,
  );
}
