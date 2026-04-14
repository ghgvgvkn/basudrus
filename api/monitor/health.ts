export const config = { runtime: "edge" };

// Vercel Cron calls this every 15 minutes
// Also callable manually: GET /api/monitor/health?secret=YOUR_SECRET

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const MONITOR_SECRET = process.env.MONITOR_SECRET || "";
const ADMIN_EMAIL = "ahm20250898@std.psut.edu.jo";

export default async function handler(req: Request) {
  // Auth: either Vercel Cron (has special header) or manual with secret
  const isVercelCron = req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;
  const url = new URL(req.url);
  const isManual = MONITOR_SECRET && url.searchParams.get("secret") === MONITOR_SECRET;

  if (!isVercelCron && !isManual) {
    return new Response(JSON.stringify({ status: "ok" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return new Response(JSON.stringify({ error: "Missing config" }), { status: 500 });
  }

  try {
    // Call the health check function (uses service role to bypass RLS)
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/check_health_alerts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
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

    // If there are critical/high alerts, send email via Supabase Edge or log
    if (Array.isArray(alerts) && alerts.length > 0) {
      const highAlerts = alerts.filter((a: { severity?: string }) => a.severity === "high" || a.severity === "critical");

      // Try to send email alert if there are high-severity alerts
      if (highAlerts.length > 0) {
        // Use Supabase's built-in auth.admin to send a "magic link" style email
        // This is a lightweight hack — sends a password reset email with the alert in metadata
        // For proper email: add Resend/SendGrid later
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
