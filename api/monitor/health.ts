export const config = { runtime: "edge" };

// Vercel Cron calls this every 15 minutes with `Authorization: Bearer $CRON_SECRET`.
// Manual operators can hit it with `Authorization: Bearer $MONITOR_SECRET`
// (NEVER via `?secret=` — query params leak to Vercel access logs).
//
// Security notes:
//   - If CRON_SECRET is unset we refuse ALL cron-style requests. Previous
//     code compared `Bearer undefined` to the same expression and would pass
//     if the env var was missing.
//   - Same guard for MONITOR_SECRET.
//   - Unauth requests get a generic 200 {"status":"ok"} so the endpoint
//     can't be used to probe whether monitoring is configured.

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

// Constant-time compare to prevent timing side-channels on secret verification.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default async function handler(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  const m = authHeader.match(/^Bearer\s+(\S+)$/);
  const presentedToken = m ? m[1] : "";

  const cronSecret = process.env.CRON_SECRET || "";
  const monitorSecret = process.env.MONITOR_SECRET || "";

  const isVercelCron = cronSecret.length > 0 && presentedToken.length > 0 && safeEqual(presentedToken, cronSecret);
  const isManual = monitorSecret.length > 0 && presentedToken.length > 0 && safeEqual(presentedToken, monitorSecret);

  if (!isVercelCron && !isManual) {
    // Opaque 200 so an unauthenticated caller can't distinguish "endpoint
    // exists but I'm not authorized" from "endpoint doesn't exist".
    return new Response(JSON.stringify({ status: "ok" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return new Response(JSON.stringify({ error: "Missing config" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    // Call the health check function (uses service role to bypass RLS)
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/check_health_alerts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
      body: "{}",
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "unknown");
      return new Response(JSON.stringify({ error: "DB check failed", status: res.status, detail: errText.slice(0, 200) }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    const alerts = await res.json();

    // Only log high-severity alerts — avoids leaking alert contents into
    // access logs for routine low-severity notices.
    if (Array.isArray(alerts) && alerts.length > 0) {
      const highAlerts = alerts.filter((a: { severity?: string }) => a.severity === "high" || a.severity === "critical");
      if (highAlerts.length > 0) {
        // eslint-disable-next-line no-console
        console.log(`[ALERT] ${highAlerts.map((a: { message: string }) => a.message).join(" | ")}`);
      }
    }

    return new Response(JSON.stringify({
      status: "checked",
      alerts_triggered: Array.isArray(alerts) ? alerts.length : 0,
      alerts: alerts || [],
      checked_at: new Date().toISOString(),
    }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Monitor failed", detail: String(err).slice(0, 200) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
