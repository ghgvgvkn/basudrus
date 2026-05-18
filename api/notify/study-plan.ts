export const config = { runtime: "edge" };

/**
 * Email a generated study plan to the authenticated user.
 *
 * Pipeline:
 *   1. Verify the Supabase access token → resolves authed user's
 *      email server-side (we IGNORE any client-supplied address).
 *   2. Per-user rate limit (5/hour, 10/day) via the shared
 *      check_ai_rate_limit RPC — endpoint key: "study-plan-email".
 *   3. Validate the StudyPlanArtifact body shape (cheap structural
 *      checks; the AI generates these so we trust shape but not
 *      content for HTML rendering — every text field gets escaped).
 *   4. Render the plan to a polished HTML email.
 *   5. Send via Resend.
 *
 * Auth is REQUIRED — anonymous senders would let an attacker spam
 * the email service.
 */

import { checkRateLimit } from "../_lib/ai-guard";

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const RESEND_FROM = process.env.RESEND_FROM || "Bas Udrus <noreply@basudrus.com>";
const APP_URL = process.env.APP_URL || "https://www.basudrus.com";

const MAX_BODY_BYTES = 64 * 1024;

const ALLOWED_ORIGINS = [
  "https://basudrus.com",
  "https://www.basudrus.com",
  "https://basudrus.vercel.app",
  "https://basudrus-redesign.vercel.app",
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

interface PlanBlock {
  start?: unknown; end?: unknown; subject?: unknown; kind?: unknown; topic?: unknown;
}
interface PlanDay {
  label?: unknown; date?: unknown; blocks?: unknown;
}
interface StudyPlanArtifactInput {
  kind?: unknown;
  title?: unknown;
  examDate?: unknown;
  examLabel?: unknown;
  subtitle?: unknown;
  totalStudyHours?: unknown;
  days?: unknown;
}

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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

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
    const data = (await res.json()) as { id?: string; email?: string };
    if (!data.id || !data.email || !UUID_RE.test(data.id) || !EMAIL_RE.test(data.email)) return null;
    return { id: data.id, email: data.email };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────
// HTML rendering — palette inline (can't import the client palette
// from edge), kept in sync with src/features/ai/subjectPalette.ts.
// ─────────────────────────────────────────────────────────────────

const PALETTE: Record<string, { accent: string; emoji: string; label: string }> = {
  math:      { accent: "#5B4BF5", emoji: "📐", label: "Math" },
  cs:        { accent: "#1F8FFF", emoji: "💻", label: "Computer Science" },
  physics:   { accent: "#7E5BFF", emoji: "⚛️", label: "Physics" },
  chemistry: { accent: "#0E8A6B", emoji: "🧪", label: "Chemistry" },
  biology:   { accent: "#1F9D55", emoji: "🧬", label: "Biology" },
  languages: { accent: "#E8743B", emoji: "💬", label: "Languages" },
  history:   { accent: "#A1652C", emoji: "📜", label: "History" },
  wellbeing: { accent: "#0E8A6B", emoji: "🌿", label: "Wellbeing" },
  general:   { accent: "#6B6B7A", emoji: "✦",  label: "General" },
};

function paletteFor(subject: string | null | undefined): { accent: string; emoji: string; label: string } {
  if (!subject) return PALETTE.general;
  return PALETTE[subject.toLowerCase()] ?? PALETTE.general;
}

interface SafePlan {
  title: string;
  examDate?: string;
  examLabel?: string;
  subtitle?: string;
  totalStudyHours?: number;
  days: Array<{
    label: string;
    date?: string;
    blocks: Array<{
      start: string; end: string; subject: string;
      kind: "study" | "break" | "class" | "sleep" | "exam";
      topic?: string;
    }>;
  }>;
}

/** Validate + sanitize the AI-generated plan into a SafePlan we can
 *  render. Returns null on invalid input — we'd rather refuse than
 *  email a malformed plan. */
function validatePlan(raw: StudyPlanArtifactInput): SafePlan | null {
  if (raw.kind !== "studyPlan") return null;
  if (typeof raw.title !== "string" || !raw.title.trim()) return null;
  if (!Array.isArray(raw.days) || raw.days.length === 0) return null;
  const days: SafePlan["days"] = [];
  for (const dRaw of raw.days as PlanDay[]) {
    if (!dRaw || typeof dRaw.label !== "string") continue;
    if (!Array.isArray(dRaw.blocks)) continue;
    const blocks: SafePlan["days"][number]["blocks"] = [];
    for (const bRaw of dRaw.blocks as PlanBlock[]) {
      if (!bRaw) continue;
      if (typeof bRaw.start !== "string" || typeof bRaw.end !== "string") continue;
      if (typeof bRaw.subject !== "string") continue;
      const kind = bRaw.kind === "break" || bRaw.kind === "class" || bRaw.kind === "sleep" || bRaw.kind === "exam"
        ? bRaw.kind
        : "study";
      blocks.push({
        start: bRaw.start.slice(0, 5),
        end: bRaw.end.slice(0, 5),
        subject: bRaw.subject.slice(0, 60),
        kind,
        topic: typeof bRaw.topic === "string" ? bRaw.topic.slice(0, 200) : undefined,
      });
    }
    if (blocks.length === 0) continue;
    days.push({
      label: dRaw.label.slice(0, 60),
      date: typeof dRaw.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dRaw.date) ? dRaw.date : undefined,
      blocks,
    });
  }
  if (days.length === 0) return null;
  return {
    title: raw.title.slice(0, 200),
    examDate: typeof raw.examDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.examDate) ? raw.examDate : undefined,
    examLabel: typeof raw.examLabel === "string" ? raw.examLabel.slice(0, 200) : undefined,
    subtitle: typeof raw.subtitle === "string" ? raw.subtitle.slice(0, 280) : undefined,
    totalStudyHours: typeof raw.totalStudyHours === "number" && Number.isFinite(raw.totalStudyHours) ? raw.totalStudyHours : undefined,
    days,
  };
}

function daysUntil(iso: string): number {
  const target = new Date(`${iso}T00:00:00Z`).getTime();
  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((target - todayUtc) / 86400000);
}

function renderPlanHtml(plan: SafePlan, recipientFirstName: string): string {
  // Dominant subject for header gradient.
  const subjCount = new Map<string, number>();
  for (const day of plan.days) for (const b of day.blocks) {
    if (b.kind === "study") subjCount.set(b.subject.toLowerCase(), (subjCount.get(b.subject.toLowerCase()) || 0) + 1);
  }
  let dominant = "general";
  let bestN = 0;
  for (const [k, n] of subjCount) if (n > bestN) { dominant = k; bestN = n; }
  const head = paletteFor(dominant);

  // Stats.
  let totalMin = 0;
  let sessions = 0;
  const subjects = new Set<string>();
  for (const day of plan.days) for (const b of day.blocks) {
    if (b.kind === "study") {
      const [hs, ms] = b.start.split(":").map((n) => parseInt(n, 10));
      const [he, me] = b.end.split(":").map((n) => parseInt(n, 10));
      const mins = (he * 60 + me) - (hs * 60 + ms);
      if (Number.isFinite(mins) && mins > 0) totalMin += mins;
      sessions += 1;
      if (b.subject) subjects.add(b.subject.toLowerCase());
    }
  }
  const totalHours = plan.totalStudyHours ?? Math.round((totalMin / 60) * 10) / 10;

  const countdown = plan.examDate ? daysUntil(plan.examDate) : null;
  const countdownLabel = countdown == null ? null
    : countdown < 0 ? "PAST EXAM"
    : countdown === 0 ? "TODAY"
    : countdown === 1 ? "1 DAY"
    : `${countdown} DAYS`;

  const dayHtml = plan.days.map((day) => {
    const blocksHtml = day.blocks.map((b) => {
      if (b.kind === "sleep") {
        return `<span style="display:inline-block;margin:0 4px 4px 0;padding:4px 8px;background:#f0eee8;color:#9a9a9a;font-size:11px;border-radius:6px;font-style:italic;">Sleep ${escapeHtml(b.start)}–${escapeHtml(b.end)}</span>`;
      }
      if (b.kind === "break") {
        return `<span style="display:inline-block;margin:0 4px 4px 0;padding:4px 8px;background:#f0eee8;color:#7a7a7a;font-size:11px;border-radius:6px;">☕ Break ${escapeHtml(b.start)}–${escapeHtml(b.end)}</span>`;
      }
      const p = paletteFor(b.subject);
      const isExam = b.kind === "exam";
      const isClass = b.kind === "class";
      const bg = isExam ? p.accent : isClass ? `${p.accent}26` : `${p.accent}33`;
      const fg = isExam ? "#ffffff" : p.accent;
      const border = isExam ? p.accent : `${p.accent}55`;
      const prefix = isExam ? "📝 " : isClass ? "🏫 " : "";
      const label = escapeHtml(p.label);
      const topic = b.topic ? `<br/><span style="font-size:10px;opacity:0.85;">${escapeHtml(b.topic)}</span>` : "";
      return `<span style="display:inline-block;margin:0 4px 4px 0;padding:6px 10px;background:${bg};color:${fg};border:1px solid ${border};font-size:12px;border-radius:6px;font-weight:600;">${prefix}${label}${topic}<br/><span style="font-size:10px;opacity:0.8;font-weight:400;">${escapeHtml(b.start)}–${escapeHtml(b.end)}</span></span>`;
    }).join("");
    return `<tr>
      <td style="vertical-align:top;width:100px;padding:14px 16px 14px 0;border-top:1px solid #e5e3dc;">
        <div style="font-size:11px;color:#7a7a7a;text-transform:uppercase;letter-spacing:0.06em;font-weight:600;">${escapeHtml(day.label)}</div>
        ${day.date ? `<div style="font-size:10px;color:#a0a0a0;margin-top:2px;">${escapeHtml(day.date)}</div>` : ""}
      </td>
      <td style="padding:10px 0;border-top:1px solid #e5e3dc;">${blocksHtml}</td>
    </tr>`;
  }).join("");

  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${escapeHtml(plan.title)}</title></head>
<body style="margin:0;padding:0;background:#F5F4F0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1A2332;">
<div style="max-width:600px;margin:0 auto;padding:24px 16px;">
  <div style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,.04);">
    <!-- Header -->
    <div style="padding:24px;background:linear-gradient(135deg,${head.accent} 0%,${head.accent}cc 60%,${head.accent}99 100%);color:#ffffff;">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.18em;opacity:0.9;font-weight:600;">📅 Study Plan</div>
      <h1 style="margin:6px 0 0;font-size:22px;line-height:1.2;font-style:italic;font-family:Georgia,serif;">${escapeHtml(plan.title)}</h1>
      ${plan.subtitle ? `<p style="margin:8px 0 0;font-size:13px;opacity:0.95;">${escapeHtml(plan.subtitle)}</p>` : ""}
      ${countdownLabel ? `<div style="margin-top:16px;display:inline-block;background:rgba(255,255,255,0.18);padding:8px 14px;border-radius:8px;"><span style="font-size:10px;letter-spacing:0.18em;text-transform:uppercase;opacity:0.85;">${countdown != null && countdown >= 0 ? "Until exam" : ""}</span><br/><span style="font-size:18px;font-weight:700;">${countdownLabel}</span>${plan.examLabel ? ` · <span style="font-size:11px;opacity:0.85;">${escapeHtml(plan.examLabel)}</span>` : ""}</div>` : ""}
    </div>
    <!-- Stats -->
    <div style="padding:14px 24px;border-bottom:1px solid #e5e3dc;font-size:12px;color:#5a6068;">
      <strong style="color:#1A2332;">${totalHours}</strong> hr study &nbsp;·&nbsp;
      <strong style="color:#1A2332;">${sessions}</strong> ${sessions === 1 ? "session" : "sessions"} &nbsp;·&nbsp;
      <strong style="color:#1A2332;">${subjects.size}</strong> ${subjects.size === 1 ? "subject" : "subjects"}
    </div>
    <!-- Greeting -->
    ${recipientFirstName ? `<div style="padding:18px 24px 0;font-size:14px;line-height:1.5;color:#3a4250;">Hey ${escapeHtml(recipientFirstName)} — here's the plan, saved so you have it on hand. You can also add it straight to your calendar from the chat.</div>` : ""}
    <!-- Day grid -->
    <table style="width:100%;border-collapse:collapse;padding:18px 24px;" cellpadding="0" cellspacing="0">
      <tbody>
        <tr><td colspan="2" style="padding:18px 24px 0;"></td></tr>
        ${dayHtml}
      </tbody>
    </table>
    <!-- Footer -->
    <div style="padding:18px 24px;border-top:1px solid #e5e3dc;font-size:11.5px;color:#7a7a7a;line-height:1.5;">
      Bas Udrus · <a href="${escapeHtml(APP_URL)}" style="color:${head.accent};text-decoration:none;">basudrus.com</a><br/>
      Adjust the plan anytime — chat with Tony Starrk and ask for changes.
    </div>
  </div>
</div>
</body>
</html>`;
}

async function getRecipientFirstName(userId: string): Promise<string> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return "";
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=name&limit=1`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } },
    );
    if (!res.ok) return "";
    const rows = (await res.json()) as Array<{ name?: string }>;
    const full = rows?.[0]?.name || "";
    return full.split(/\s+/)[0] || "";
  } catch {
    return "";
  }
}

export default async function handler(req: Request): Promise<Response> {
  const origin = req.headers.get("origin");
  const cors = corsHeaders(origin);

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return jsonResponse(405, { ok: false, reason: "method" }, cors);

  const len = parseInt(req.headers.get("content-length") || "0", 10);
  if (Number.isFinite(len) && len > MAX_BODY_BYTES) {
    return jsonResponse(413, { ok: false, reason: "too_large" }, cors);
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !RESEND_API_KEY) {
    return jsonResponse(200, { ok: false, reason: "email_not_configured" }, cors);
  }

  const authHeader = req.headers.get("authorization") || "";
  const m = authHeader.match(/^Bearer\s+(\S+)$/);
  if (!m) return jsonResponse(401, { ok: false, reason: "unauthenticated" }, cors);
  const session = await getSessionUser(m[1]);
  if (!session) return jsonResponse(401, { ok: false, reason: "invalid_token" }, cors);

  // Per-user rate limit (audit P2 #2). 10/day, 5/hour, 2/min — covers
  // legitimate use (a student tweaking a plan and resending a few
  // times) without letting a compromised account spam Resend until
  // the budget burns.
  const rateCheck = await checkRateLimit({
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY,
    authHeader: req.headers.get("authorization"),
    endpoint: "study-plan-email",
    daily: 10,
    hourly: 5,
    minute: 2,
  });
  if (!rateCheck.allowed) {
    const reason = rateCheck.reason || "rate_limited";
    return jsonResponse(429, { ok: false, reason }, cors);
  }

  let body: { plan?: StudyPlanArtifactInput };
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { ok: false, reason: "invalid_json" }, cors);
  }
  if (!body?.plan) return jsonResponse(400, { ok: false, reason: "missing_plan" }, cors);
  const plan = validatePlan(body.plan);
  if (!plan) return jsonResponse(400, { ok: false, reason: "invalid_plan" }, cors);

  const firstName = await getRecipientFirstName(session.id);
  const html = renderPlanHtml(plan, firstName);
  const subject = plan.examLabel
    ? `Your study plan — ${plan.title} (until ${plan.examLabel})`
    : `Your study plan — ${plan.title}`;

  try {
    const sendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: session.email,
        subject,
        html,
      }),
    });
    if (!sendRes.ok) {
      const txt = await sendRes.text().catch(() => "");
      console.error("[notify/study-plan] resend:", sendRes.status, txt);
      return jsonResponse(200, { ok: false, reason: `resend_${sendRes.status}` }, cors);
    }
    return jsonResponse(200, { ok: true }, cors);
  } catch (e) {
    console.error("[notify/study-plan] resend threw:", e);
    return jsonResponse(200, { ok: false, reason: "send_failed" }, cors);
  }
}
