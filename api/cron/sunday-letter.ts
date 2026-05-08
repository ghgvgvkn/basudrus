export const config = { runtime: "edge" };

/**
 * Sunday letter — weekly email, written in Bas Udros's voice, sent to
 * every active student on Sunday morning (08:00 UTC = 11:00 Jordan).
 *
 * The point: a tutor who actually remembers the week. Not a generic
 * "weekly digest." Each letter references the specific subjects the
 * student worked on, their streak, any milestone they crossed, and
 * what to focus on next week. Concrete > generic. Direct > peppy.
 *
 * Flow per cron fire:
 *   1. Authenticate via CRON_SECRET (Vercel sends it as Authorization
 *      header on cron invocations — see vercel.json).
 *   2. Fetch every user with last_active_day in the last 7 days,
 *      not unsubscribed, not already-sent for this ISO week.
 *   3. For each user, aggregate their week's data:
 *        • current_streak + longest_streak (from tutor_streaks)
 *        • top 1-3 subjects (from tutor_sessions in last 7 days)
 *        • milestones crossed this week
 *   4. Generate a personalised letter via Claude Haiku 4.5.
 *   5. Send via Resend.
 *   6. Insert a row into tutor_letters for idempotency.
 *
 * Idempotency: the (user_id, iso_week) primary key on tutor_letters
 * means even if the cron fires twice (Vercel retries, manual trigger)
 * we never double-send. The handler does a SELECT before generating
 * the letter so we don't waste an Anthropic call on a user we've
 * already mailed this week.
 *
 * Failure mode: per-user errors are caught and logged. One user's
 * bad email or RLS issue must never block the whole batch.
 */

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const RESEND_FROM = process.env.RESEND_FROM || "Bas Udrus <noreply@basudrus.com>";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const CRON_SECRET = process.env.CRON_SECRET || "";
const APP_URL = process.env.APP_URL || "https://www.basudrus.com";
const UNSUBSCRIBE_SECRET = process.env.UNSUBSCRIBE_SECRET || process.env.CRON_SECRET || "";

const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";

// Cap on users per cron invocation — protects against runaway costs
// if we ever have 10k+ active users on the free tier and we want to
// stage the rollout. Tunable via env. Edge runtime hard-caps the
// total execution time at 300 s (Pro) so we self-regulate.
const MAX_USERS_PER_RUN = parseInt(process.env.SUNDAY_LETTER_BATCH_MAX || "200", 10);

// Per-user soft cap on Anthropic + Resend latency. If a single user
// takes too long we move on rather than blocking the batch.
const PER_USER_TIMEOUT_MS = 12_000;

// ─────────────────────────────────────────────────────────────────
// Date helpers — ISO 8601 week (used as the idempotency key).
// ─────────────────────────────────────────────────────────────────

/** ISO 8601 week number, formatted "YYYY-Www" (e.g. "2026-W19"). */
function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // Thursday in current week decides the year.
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

/** YYYY-MM-DD in UTC (matches the streak hook's encoding). */
function utcDateStr(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function daysAgoUTC(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return utcDateStr(d);
}

// ─────────────────────────────────────────────────────────────────
// Tiny HTML helpers. We keep the email markup simple + inline-styled
// since most clients (Gmail, Outlook) ignore <style> blocks anyway.
// ─────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Sign a token for the unsubscribe link. We use HMAC-SHA-256 with
 *  the UNSUBSCRIBE_SECRET so the link can be verified by the
 *  /api/letter/unsubscribe endpoint without trusting the URL. */
async function signUnsubToken(userId: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(UNSUBSCRIBE_SECRET || "fallback-secret-change-me"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(userId));
  // Hex encode — short, URL-safe, no padding.
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

interface UserRow {
  id: string;
  email: string;
  name: string;
  major: string | null;
  uni: string | null;
  year: number | null;
  letter_unsubscribed: boolean;
}

interface StreakRow {
  user_id: string;
  current_streak: number;
  longest_streak: number;
  last_active_day: string | null;
  total_sessions: number;
  milestones_reached: number[];
}

interface SessionRow {
  user_id: string;
  subject: string | null;
  started_at: string;
  ended_at: string | null;
  ended_via: string | null;
  summary: string | null;
}

// ─────────────────────────────────────────────────────────────────
// Supabase REST (service role) helpers. We avoid the supabase-js
// client on the edge runtime to keep the bundle tiny.
// ─────────────────────────────────────────────────────────────────

async function fetchEligibleUsers(weekKey: string): Promise<UserRow[]> {
  // Active in last 7 days, not unsubscribed, not already sent for
  // this week. We use a server-side join via tutor_streaks to filter
  // by last_active_day. PostgREST supports inner joins via embedded
  // resources — but the simpler path is two queries.
  const sevenAgo = daysAgoUTC(7);

  // Step 1: streak rows for users active in last 7 days.
  const streakRes = await fetch(
    `${SUPABASE_URL}/rest/v1/tutor_streaks`
    + `?select=user_id`
    + `&last_active_day=gte.${encodeURIComponent(sevenAgo)}`,
    { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } },
  );
  if (!streakRes.ok) {
    console.error("[sunday-letter] streak query failed:", streakRes.status);
    return [];
  }
  const streakRows = (await streakRes.json()) as Array<{ user_id: string }>;
  const activeIds = streakRows.map((r) => r.user_id);
  if (activeIds.length === 0) return [];

  // Step 2: already-sent set for this week. We exclude these so a
  // re-run of the cron skips users we've already mailed.
  const sentRes = await fetch(
    `${SUPABASE_URL}/rest/v1/tutor_letters`
    + `?select=user_id`
    + `&iso_week=eq.${encodeURIComponent(weekKey)}`,
    { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } },
  );
  const sentSet = new Set<string>();
  if (sentRes.ok) {
    const sentRows = (await sentRes.json()) as Array<{ user_id: string }>;
    for (const r of sentRows) sentSet.add(r.user_id);
  }

  // Step 3: profiles for the remaining IDs. PostgREST `in` filter
  // accepts a comma-separated list. We trim to MAX_USERS_PER_RUN.
  const filteredIds = activeIds.filter((id) => !sentSet.has(id)).slice(0, MAX_USERS_PER_RUN);
  if (filteredIds.length === 0) return [];

  const inList = `(${filteredIds.map((id) => `"${id}"`).join(",")})`;
  const profileRes = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles`
    + `?select=id,email,name,major,uni,year,letter_unsubscribed`
    + `&id=in.${encodeURIComponent(inList)}`
    + `&letter_unsubscribed=eq.false`,
    { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } },
  );
  if (!profileRes.ok) {
    console.error("[sunday-letter] profile query failed:", profileRes.status);
    return [];
  }
  const rows = (await profileRes.json()) as UserRow[];
  return rows.filter((r) => r.email && r.id);
}

async function fetchStreak(userId: string): Promise<StreakRow | null> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/tutor_streaks`
    + `?select=user_id,current_streak,longest_streak,last_active_day,total_sessions,milestones_reached`
    + `&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
    { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } },
  );
  if (!res.ok) return null;
  const rows = (await res.json()) as StreakRow[];
  return rows[0] ?? null;
}

async function fetchWeekSessions(userId: string): Promise<SessionRow[]> {
  const sevenAgoIso = new Date(Date.now() - 7 * 86400000).toISOString();
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/tutor_sessions`
    + `?select=user_id,subject,started_at,ended_at,ended_via,summary`
    + `&user_id=eq.${encodeURIComponent(userId)}`
    + `&started_at=gte.${encodeURIComponent(sevenAgoIso)}`
    + `&order=started_at.desc`
    + `&limit=50`,
    { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } },
  );
  if (!res.ok) return [];
  return (await res.json()) as SessionRow[];
}

// ─────────────────────────────────────────────────────────────────
// Letter generation via Anthropic. We deliberately keep this small —
// a single non-streaming call that returns a complete HTML body.
// Voice + structure are pinned in the system prompt.
// ─────────────────────────────────────────────────────────────────

interface LetterContext {
  name: string;
  major: string | null;
  uni: string | null;
  year: number | null;
  current: number;
  longest: number;
  daysActiveThisWeek: number;
  topSubjects: string[];
  milestonesThisWeek: number[];
}

function buildLetterPrompt(ctx: LetterContext): string {
  const lines: string[] = [];
  lines.push(`Student: ${ctx.name}`);
  if (ctx.major) lines.push(`Major: ${ctx.major}`);
  if (ctx.uni) lines.push(`University: ${ctx.uni}`);
  if (ctx.year) lines.push(`Year: ${ctx.year}`);
  lines.push(`Current streak: ${ctx.current} days`);
  lines.push(`Longest streak ever: ${ctx.longest} days`);
  lines.push(`Days active this week: ${ctx.daysActiveThisWeek}/7`);
  if (ctx.topSubjects.length) lines.push(`Top subjects this week: ${ctx.topSubjects.join(", ")}`);
  if (ctx.milestonesThisWeek.length) lines.push(`Milestones crossed this week: ${ctx.milestonesThisWeek.join(", ")} day(s)`);
  return lines.join("\n");
}

const SYSTEM_PROMPT = `You are Bas Udros — the AI tutor at basudrus.com — writing the Sunday letter to one of your students. The student has been studying with you for at least the last week.

Voice rules — non-negotiable:
- Direct. Specific. No filler. No "I hope this email finds you well."
- Reference the actual data you're given (streak count, subjects, milestones). Generic encouragement is forbidden.
- Warm, but not peppy. You sound like a tutor who genuinely remembers them, not a marketing email.
- 150-220 words. Mobile-friendly. No bullet lists unless they read naturally as prose.
- Use "you" generously. First person ("I") sparingly.
- Arabic + English speakers — keep it English unless the name suggests they'd appreciate one Arabic phrase. If in doubt, English.

Structure:
1. Open with the student's first name.
2. One sentence reflecting on THIS week's specific data — the number of days, the subjects, the streak.
3. One concrete observation about what they did right.
4. One specific thing to focus on next week (a subject they worked on, a habit they could deepen).
5. Close with a "see you Sunday" cliffhanger that makes them want to come back tomorrow.

Output only the letter body in HTML. Use <p> for paragraphs, <strong> sparingly for emphasis, no headings, no <html>/<body> wrappers, no inline CSS. Keep paragraphs short (2-3 sentences). The wrapping app handles layout.`;

interface AnthropicMessage {
  role: "user";
  content: string;
}

async function generateLetterHtml(ctx: LetterContext): Promise<string | null> {
  if (!ANTHROPIC_API_KEY) return null;
  try {
    const messages: AnthropicMessage[] = [
      { role: "user", content: buildLetterPrompt(ctx) },
    ];
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 600,
        system: SYSTEM_PROMPT,
        messages,
      }),
    });
    if (!res.ok) {
      console.error("[sunday-letter] anthropic:", res.status, await res.text());
      return null;
    }
    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text = (data.content || [])
      .filter((c) => c.type === "text")
      .map((c) => c.text || "")
      .join("\n")
      .trim();
    if (!text) return null;
    // Sanity strip — if the model wrapped in <html> tags by mistake.
    return text.replace(/<\/?(html|body|head)[^>]*>/gi, "").trim();
  } catch (e) {
    console.error("[sunday-letter] anthropic threw:", e);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────
// Email sending via Resend. We wrap the AI-generated HTML in a
// minimal styled shell + the unsubscribe footer.
// ─────────────────────────────────────────────────────────────────

function buildEmailHtml(bodyHtml: string, unsubUrl: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Sunday letter</title>
</head>
<body style="margin:0;padding:0;background:#F5F4F0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1A2332;">
<div style="max-width:560px;margin:0 auto;padding:32px 24px;">
  <div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#5B4BF5;font-weight:600;margin-bottom:12px;">Sunday letter</div>
  <div style="font-size:17px;line-height:1.65;color:#1A2332;">
    ${bodyHtml}
  </div>
  <hr style="border:none;border-top:1px solid #e5e3dc;margin:32px 0 16px;" />
  <div style="font-size:12px;color:#7a7a7a;line-height:1.5;">
    Bas Udrus · <a href="${escapeHtml(APP_URL)}" style="color:#5B4BF5;text-decoration:none;">basudrus.com</a><br/>
    <a href="${escapeHtml(unsubUrl)}" style="color:#7a7a7a;text-decoration:underline;">Unsubscribe from Sunday letters</a>
  </div>
</div>
</body>
</html>`;
}

async function sendEmail(toEmail: string, subject: string, html: string, listUnsub: string): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  if (!RESEND_API_KEY) return { ok: false, reason: "no_resend_key" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: toEmail,
        subject,
        html,
        // RFC 8058 one-click unsubscribe — Gmail and Apple Mail
        // recognise these headers and surface a native unsubscribe
        // button, which is huge for inbox placement.
        headers: {
          "List-Unsubscribe": `<${listUnsub}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      }),
    });
    if (!res.ok) {
      const txt = await res.text();
      console.error("[sunday-letter] resend:", res.status, txt);
      return { ok: false, reason: `resend_${res.status}` };
    }
    const data = (await res.json()) as { id?: string };
    return { ok: true, id: data.id || "" };
  } catch (e) {
    console.error("[sunday-letter] resend threw:", e);
    return { ok: false, reason: "resend_threw" };
  }
}

async function logSend(userId: string, weekKey: string, messageId: string): Promise<void> {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/tutor_letters`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=ignore-duplicates",
      },
      body: JSON.stringify({ user_id: userId, iso_week: weekKey, message_id: messageId }),
    });
  } catch (e) {
    console.error("[sunday-letter] log threw:", e);
  }
}

// ─────────────────────────────────────────────────────────────────
// Per-user pipeline. Wrapped in a timeout so a single slow user
// can't block the whole batch.
// ─────────────────────────────────────────────────────────────────

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T | null> {
  return await Promise.race<T | null>([
    p,
    new Promise<null>((resolve) => setTimeout(() => {
      console.warn(`[sunday-letter] timeout: ${label}`);
      resolve(null);
    }, ms)),
  ]);
}

async function processUser(user: UserRow, weekKey: string): Promise<"sent" | "skipped" | "error"> {
  // Aggregate the week's data.
  const [streak, sessions] = await Promise.all([
    fetchStreak(user.id),
    fetchWeekSessions(user.id),
  ]);
  if (!streak) return "skipped";

  // Distinct active days this week.
  const dayKeys = new Set<string>();
  const subjectCounts = new Map<string, number>();
  const sevenAgoMs = Date.now() - 7 * 86400000;
  for (const s of sessions) {
    const t = Date.parse(s.started_at);
    if (Number.isFinite(t) && t >= sevenAgoMs) {
      dayKeys.add(utcDateStr(new Date(t)));
      if (s.subject) subjectCounts.set(s.subject, (subjectCounts.get(s.subject) || 0) + 1);
    }
  }
  const topSubjects = Array.from(subjectCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k]) => k);

  // Milestones crossed this week — anything in milestones_reached
  // that's <= current_streak and within the streak window. We
  // approximate "this week" by checking if current_streak - 6 ≤ ms ≤
  // current_streak (a milestone reached during the past 7 streak
  // days). Imperfect but good enough for narrative.
  const ms = streak.milestones_reached || [];
  const milestonesThisWeek = ms.filter(
    (m) => m <= streak.current_streak && m > streak.current_streak - 7,
  );

  const ctx: LetterContext = {
    name: user.name || "there",
    major: user.major,
    uni: user.uni,
    year: user.year,
    current: streak.current_streak,
    longest: streak.longest_streak,
    daysActiveThisWeek: dayKeys.size,
    topSubjects,
    milestonesThisWeek,
  };

  const bodyHtml = await withTimeout(generateLetterHtml(ctx), PER_USER_TIMEOUT_MS, `letter:${user.id}`);
  if (!bodyHtml) return "error";

  const token = await signUnsubToken(user.id);
  const unsubUrl = `${APP_URL}/api/letter/unsubscribe?u=${encodeURIComponent(user.id)}&t=${token}`;

  const fullHtml = buildEmailHtml(bodyHtml, unsubUrl);
  // Subject line — pulls one detail to feel personal.
  const subject = streak.current_streak >= 7
    ? `${streak.current_streak} days in — your Sunday letter`
    : `Your Sunday letter from Bas Udrus`;

  const send = await withTimeout(
    sendEmail(user.email, subject, fullHtml, unsubUrl),
    PER_USER_TIMEOUT_MS,
    `send:${user.id}`,
  );
  if (!send || !send.ok) return "error";

  await logSend(user.id, weekKey, send.id || "");
  return "sent";
}

// ─────────────────────────────────────────────────────────────────
// Vercel cron handler. Vercel sends a special header when the cron
// invokes us — but we additionally accept Authorization: Bearer
// CRON_SECRET so we can also trigger this manually for testing.
// ─────────────────────────────────────────────────────────────────

export default async function handler(req: Request): Promise<Response> {
  // Authenticate. Vercel cron sets `Authorization: Bearer CRON_SECRET`
  // automatically when CRON_SECRET is set in the project env.
  const authHeader = req.headers.get("authorization") || "";
  const expected = `Bearer ${CRON_SECRET}`;
  if (!CRON_SECRET || authHeader !== expected) {
    return new Response("unauthorized", { status: 401 });
  }

  // Sanity: env. If anything's missing we no-op rather than crash.
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !RESEND_API_KEY || !ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ ok: false, reason: "missing_env" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const weekKey = isoWeek(new Date());
  const startedAt = Date.now();

  let users: UserRow[] = [];
  try {
    users = await fetchEligibleUsers(weekKey);
  } catch (e) {
    console.error("[sunday-letter] fetch eligible threw:", e);
    return new Response(JSON.stringify({ ok: false, reason: "fetch_failed" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  let sent = 0;
  let skipped = 0;
  let errored = 0;

  // Sequential processing — keeps Resend rate-limit-safe and avoids
  // burst-fanning Anthropic. 200 users × 4-5 s each = ~15 min worst
  // case which is within Pro's 300 s × multi-invoke cron behaviour;
  // for big batches we'd switch to a queue, but that's a Day-N+1
  // problem, not a Day-5 problem.
  for (const user of users) {
    try {
      const r = await processUser(user, weekKey);
      if (r === "sent") sent += 1;
      else if (r === "skipped") skipped += 1;
      else errored += 1;
    } catch (e) {
      errored += 1;
      console.error("[sunday-letter] user threw:", user.id, e);
    }
  }

  const ms = Date.now() - startedAt;
  return new Response(
    JSON.stringify({
      ok: true,
      week: weekKey,
      eligible: users.length,
      sent, skipped, errored,
      duration_ms: ms,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}
