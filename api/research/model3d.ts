/**
 * /api/research/model3d — proxy to Meshy text-to-3D.
 *
 * Tony's <<<MODEL:name>>> blocks render six built-in procedural models
 * instantly. Any OTHER name lands here: the client submits the name as
 * a generation prompt, Meshy builds a mesh in ~30-120s, and the client
 * polls until a .glb URL is ready for the JarvisView 3D viewer.
 *
 * WHY A SERVER PROXY (same reasons as research/image.ts)
 *
 *   MESHY_API_KEY is a paid credential — it never ships in the client
 *   bundle. Client → POST here (create) → Meshy; then GET here (poll)
 *   → Meshy task status. Generation is ~50-100x costlier than an
 *   image search, so the create quota is much tighter than image's.
 *
 * TWO ENDPOINTS IN ONE FILE (the async-job shape)
 *
 *   POST {prompt}            → submit job, charge quota ONCE, return
 *                              { jobId, token, status:"created" }
 *   GET  ?jobId=&token=      → poll upstream, return
 *                              { status, progress, modelUrl }
 *
 *   The poll is charged against a separate, loose bucket — a client
 *   polling every ~3s for two minutes must never eat the create
 *   budget. Ownership is enforced WITHOUT a job table: the create
 *   response carries an HMAC token binding (jobId, userId); polls
 *   present it and we recompute with the caller's verified userId
 *   (see _lib/model3d-sign.ts). No DB row, no IDOR.
 *
 * FALLBACK BEHAVIOR
 *
 *   If MESHY_API_KEY is unset → 200 { status:"not_configured" }. The
 *   client shows "generation isn't enabled yet" instead of erroring —
 *   the feature lights up the moment the env var lands on Vercel.
 *
 * RESPONSE STATUS UNION (client's state machine input)
 *
 *   created | not_configured | pending | running | succeeded | failed
 */
export const config = { runtime: "edge" };

import {
  ALLOWED_ORIGINS,
  securityHeaders,
  checkRateLimit,
  rateLimitResponse,
  sanitizeLine,
  getUserIdFromToken,
} from "../_lib/ai-guard";
import { signJobToken, verifyJobToken, isValidJobId } from "../_lib/model3d-sign";

const MESHY_API_KEY = process.env.MESHY_API_KEY || "";
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const MESHY_BASE = "https://api.meshy.ai/openapi/v2/text-to-3d";

// Create quota — REAL money per call (Meshy bills credits per task).
// A student demoing the feature gets a handful per day; the hard
// ceiling is the Meshy account balance.
const CREATE_LIMITS = { daily: 12, hourly: 6, minute: 2 };
// Poll quota — loose. ~3s polling for a 2-minute job ≈ 40 polls; the
// bucket exists only to stop a runaway loop, not to meter usage.
const POLL_LIMITS = { daily: 2400, hourly: 600, minute: 40 };

export default async function handler(req: Request): Promise<Response> {
  const origin = req.headers.get("origin");
  const sHeaders = securityHeaders(origin, ALLOWED_ORIGINS);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: sHeaders });
  }
  if (req.method !== "GET" && req.method !== "POST") {
    return json({ error: "Method not allowed" }, sHeaders, 405);
  }

  // Auth — generation costs money; polls reveal job state. Both gated.
  const authHeader = req.headers.get("authorization");
  const userId = await getUserIdFromToken(authHeader, SUPABASE_URL, SUPABASE_ANON_KEY);
  if (!userId) {
    return json({ error: "unauthorized" }, sHeaders, 401);
  }

  return req.method === "POST"
    ? handleCreate(req, sHeaders, authHeader, userId)
    : handlePoll(req, sHeaders, authHeader, userId);
}

// ── CREATE ──────────────────────────────────────────────────────────

async function handleCreate(
  req: Request,
  sHeaders: Record<string, string>,
  authHeader: string | null,
  userId: string,
): Promise<Response> {
  const rl = await checkRateLimit({
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY,
    authHeader,
    endpoint: "research_model3d",
    daily: CREATE_LIMITS.daily,
    hourly: CREATE_LIMITS.hourly,
    minute: CREATE_LIMITS.minute,
  });
  if (!rl.allowed) {
    return rateLimitResponse(rl, sHeaders, {
      cooldown: "A model is already being generated — give it a moment.",
      minute_limit: "One model at a time — let this one finish first.",
      hourly_limit: "Hourly 3D generation limit reached.",
      daily_limit: "Daily 3D generation limit reached — resets tomorrow.",
    });
  }

  // Prompt comes from Tony's MODEL block (user-influenced). Sanitize +
  // cap. Meshy does its own moderation upstream; this is hygiene.
  let rawPrompt = "";
  try {
    const body = (await req.json()) as { prompt?: string };
    rawPrompt = typeof body?.prompt === "string" ? body.prompt : "";
  } catch {
    /* malformed body → empty prompt → 400 below */
  }
  const prompt = sanitizeLine(rawPrompt, 160);
  if (!prompt) {
    return json({ error: "missing prompt" }, sHeaders, 400);
  }

  // No key = feature dormant. Tell the client plainly (it shows a
  // friendly "not enabled yet" panel, not an error).
  if (!MESHY_API_KEY) {
    return json({ jobId: null, status: "not_configured" }, sHeaders);
  }

  try {
    const ctl = new AbortController();
    const timeoutId = setTimeout(() => ctl.abort(), 15_000);
    const res = await fetch(MESHY_BASE, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${MESHY_API_KEY}`,
      },
      body: JSON.stringify({
        mode: "preview",
        prompt,
        art_style: "realistic",
        // Weak-MacBook rule reaches all the way into the mesh: cap the
        // polycount so the generated model renders smoothly alongside
        // the dot canvas (and JARVIS camera, if active).
        target_polycount: 30_000,
        should_remesh: true,
      }),
      signal: ctl.signal,
    }).finally(() => clearTimeout(timeoutId));

    if (!res.ok) {
      // Log status only — Meshy error bodies can include account/quota
      // details we don't want to hand to the client.
      console.warn(`[research/model3d] Meshy create HTTP ${res.status}`);
      return json({ jobId: null, status: "failed" }, sHeaders, 502);
    }

    const data = (await res.json()) as { result?: string };
    const jobId = typeof data?.result === "string" ? data.result : "";
    if (!isValidJobId(jobId)) {
      console.warn("[research/model3d] Meshy returned unexpected job id shape");
      return json({ jobId: null, status: "failed" }, sHeaders, 502);
    }

    // HMAC keyed on the Meshy API key — already a server-only secret;
    // HMAC output reveals nothing about it. Zero new env vars.
    const token = await signJobToken(jobId, userId, MESHY_API_KEY);
    return json({ jobId, token, status: "created" }, sHeaders);
  } catch (e) {
    console.warn("[research/model3d] create error:", (e as Error).message);
    return json({ jobId: null, status: "failed" }, sHeaders, 502);
  }
}

// ── POLL ────────────────────────────────────────────────────────────

async function handlePoll(
  req: Request,
  sHeaders: Record<string, string>,
  authHeader: string | null,
  userId: string,
): Promise<Response> {
  const rl = await checkRateLimit({
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY,
    authHeader,
    endpoint: "research_model3d_poll",
    daily: POLL_LIMITS.daily,
    hourly: POLL_LIMITS.hourly,
    minute: POLL_LIMITS.minute,
  });
  if (!rl.allowed) {
    return rateLimitResponse(rl, sHeaders, {
      cooldown: "Polling too fast.",
      minute_limit: "Polling too fast — the model is still baking.",
      hourly_limit: "Too many status checks this hour.",
      daily_limit: "Too many status checks today.",
    });
  }

  const url = new URL(req.url);
  const jobId = url.searchParams.get("jobId") || "";
  const token = url.searchParams.get("token") || "";
  if (!isValidJobId(jobId)) {
    return json({ error: "bad jobId" }, sHeaders, 400);
  }
  if (!MESHY_API_KEY) {
    return json({ status: "not_configured" }, sHeaders);
  }
  // Ownership — the token was minted for (jobId, creator) at create
  // time. A different user (or a tampered jobId) fails the HMAC.
  const owned = await verifyJobToken(token, jobId, userId, MESHY_API_KEY);
  if (!owned) {
    return json({ error: "forbidden" }, sHeaders, 403);
  }

  try {
    const ctl = new AbortController();
    const timeoutId = setTimeout(() => ctl.abort(), 10_000);
    const res = await fetch(`${MESHY_BASE}/${jobId}`, {
      headers: { Authorization: `Bearer ${MESHY_API_KEY}` },
      signal: ctl.signal,
    }).finally(() => clearTimeout(timeoutId));

    if (!res.ok) {
      console.warn(`[research/model3d] Meshy poll HTTP ${res.status}`);
      return json({ status: "failed" }, sHeaders, 502);
    }

    const data = (await res.json()) as {
      status?: string;
      progress?: number;
      model_urls?: { glb?: string };
    };
    const upstream = (data?.status || "").toUpperCase();
    const progress = clampProgress(data?.progress);

    if (upstream === "SUCCEEDED") {
      const modelUrl = typeof data?.model_urls?.glb === "string" ? data.model_urls.glb : null;
      // Succeeded with no GLB is a failure from the client's view.
      return json(
        modelUrl
          ? { status: "succeeded", progress: 100, modelUrl }
          : { status: "failed" },
        sHeaders,
      );
    }
    if (upstream === "FAILED" || upstream === "CANCELED") {
      // Generic reason — Meshy task_error strings can leak prompt
      // moderation internals; the client copy is friendlier anyway.
      return json({ status: "failed" }, sHeaders);
    }
    if (upstream === "IN_PROGRESS") {
      return json({ status: "running", progress }, sHeaders);
    }
    // PENDING or anything unrecognized-but-2xx → still waiting.
    return json({ status: "pending", progress }, sHeaders);
  } catch (e) {
    console.warn("[research/model3d] poll error:", (e as Error).message);
    return json({ status: "failed" }, sHeaders, 502);
  }
}

function clampProgress(p: unknown): number {
  const n = typeof p === "number" && Number.isFinite(p) ? p : 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function json(payload: unknown, headers: Record<string, string>, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}
