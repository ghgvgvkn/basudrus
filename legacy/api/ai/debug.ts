export const config = { runtime: "edge" };

// Safe health check — NO key exposure, NO API calls
export default async function handler(req: Request) {
  // Only allow admin (check for a secret header)
  const adminSecret = process.env.ADMIN_DEBUG_SECRET || "";
  const provided = req.headers.get("x-debug-secret") || "";
  if (!adminSecret || provided !== adminSecret) {
    return new Response(JSON.stringify({ status: "ok", version: "2.0", ai: "operational" }), {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  // Admin-only: safe diagnostics (NO key content exposed)
  const key = (process.env.ANTHROPIC_API_KEY || "").trim();
  return new Response(
    JSON.stringify({
      status: "ok",
      keyConfigured: key.length > 0,
      keyLength: key.length,
      timestamp: new Date().toISOString(),
    }, null, 2),
    { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }
  );
}
