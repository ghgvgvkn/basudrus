export const config = { runtime: "edge" };

/**
 * /api/ai/voice/speak — text-to-speech via ElevenLabs Creative.
 *
 * Client POSTs:
 *   { text: string, voiceId?: string }
 *
 * Server streams back audio/mpeg (MP3, 128kbps, 44.1kHz). First byte
 * arrives ~75ms after upstream (Flash v2.5 model). The browser can
 * pipe the response body straight into an <audio> element or
 * AudioContext for FFT-driven animations.
 *
 * NOT using ElevenLabs Conversational AI (Agents) — see elevenlabs.ts
 * for the architectural rationale. This endpoint is a pure proxy:
 * Tony's brain (api/ai/tutor.ts) generates the text, this endpoint
 * just turns text into audio.
 *
 * Security:
 *   - Auth required (rate limiter checks JWT, same as tutor.ts).
 *   - Per-user rate limit: 30/min, 200/hr, 1000/day. TTS is per-message,
 *     so the minute cap matters most — protects against a runaway client
 *     that re-speaks the same message in a loop.
 *   - 16 KB body cap (just a text string + voice ID).
 *   - CORS exact-host match.
 *   - Voice ID validated against allowlist (see resolveVoiceId).
 *
 * Caching:
 *   - We don't cache TTS responses today. Same input → same output, so
 *     a future optimization is hashing (text + voiceId) → S3 audio file
 *     and serving cached. For now, every speak() costs ElevenLabs credits.
 */

import {
  ALLOWED_ORIGINS,
  securityHeaders,
  readCappedJson,
  checkRateLimit,
  rateLimitResponse,
  sanitizeLine,
} from "../../_lib/ai-guard";
import {
  resolveVoiceId,
  synthesizeSpeechStream,
} from "../../_lib/elevenlabs";

const ELEVENLABS_API_KEY     = process.env.ELEVENLABS_API_KEY || "";
const ELEVENLABS_VOICE_ID    = process.env.ELEVENLABS_DEFAULT_VOICE_ID || "";
const SUPABASE_URL           = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY      = process.env.SUPABASE_ANON_KEY || "";

const MAX_BODY_BYTES = 16 * 1024;          // 16 KB — text-only request
const MAX_TTS_CHARS  = 4000;               // ElevenLabs hard cap on a single Flash v2.5 request
const LIMITS = { daily: 1000, hourly: 200, minute: 30 };

interface SpeakBody {
  text?: unknown;
  voiceId?: unknown;
}

function jsonError(status: number, body: unknown, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

export default async function handler(req: Request): Promise<Response> {
  const origin = req.headers.get("origin");
  const sHeaders = securityHeaders(origin, ALLOWED_ORIGINS);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: sHeaders });
  if (req.method !== "POST") return jsonError(405, { error: "Method not allowed" }, sHeaders);

  if (!ELEVENLABS_API_KEY) {
    return jsonError(503, { error: "Voice unavailable (server misconfigured)" }, sHeaders);
  }

  const authHeader = req.headers.get("authorization");
  const rl = await checkRateLimit({
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY,
    authHeader,
    endpoint: "ai/voice/speak",
    daily: LIMITS.daily,
    hourly: LIMITS.hourly,
    minute: LIMITS.minute,
  });
  if (!rl.allowed) {
    return rateLimitResponse(rl, sHeaders, {
      cooldown:     "Slow down — please retry in a moment.",
      minute_limit: "Too many voice plays in a minute — try again shortly.",
      hourly_limit: "Hourly voice quota reached.",
      daily_limit:  "Daily voice quota reached.",
    });
  }

  const { data: body, error: bodyErr } = await readCappedJson<SpeakBody>(req, MAX_BODY_BYTES, sHeaders);
  if (bodyErr) return bodyErr;
  if (!body) return jsonError(400, { error: "Missing body" }, sHeaders);

  // We sanitize lightly — TTS doesn't go through the LLM so prompt-
  // injection concerns don't apply, but we still cap length and strip
  // most control chars so a malformed input can't produce surprise
  // audio (e.g. minutes of silence from a giant whitespace run).
  const rawText = typeof body.text === "string" ? body.text : "";
  // sanitizeLine collapses newlines into spaces, which is wrong for
  // TTS (the model uses them for natural pauses). So we do a lighter
  // pass: strip nulls + DEL + most C0 controls, keep \n / \t, cap length.
  // eslint-disable-next-line no-control-regex
  const cleaned = rawText.replace(/[\u0000-\u0008\u000B-\u001F\u007F]+/g, " ").trim().slice(0, MAX_TTS_CHARS);
  if (cleaned.length === 0) {
    return jsonError(400, { error: "Empty text" }, sHeaders);
  }

  const clientVoice = typeof body.voiceId === "string" ? sanitizeLine(body.voiceId, 40) : undefined;
  const voiceId = resolveVoiceId(clientVoice, ELEVENLABS_VOICE_ID);

  const result = await synthesizeSpeechStream({
    apiKey: ELEVENLABS_API_KEY,
    voiceId,
    text: cleaned,
  });

  if (!result.ok || !result.response) {
    // Log the FULL upstream error to the Vercel function logs so
    // we can debug what ElevenLabs actually returned (their error
    // body often says exactly what's wrong — "invalid voice_id",
    // "quota_exceeded", "concurrent_request_limit", etc.). The
    // founder kept hitting "Voice synthesis failed" with no clue
    // why; the answer is in result.error which we just dump here.
    // Safe to log server-side — Vercel logs are private to the
    // project owner, no end-user PII is exposed.
    console.error("[speak] ElevenLabs error", {
      status: result.status,
      error: result.error,
      voiceId,
      // Don't log full text — could be sensitive. Length is enough
      // to confirm we actually sent something.
      textLen: cleaned.length,
    });

    // Map the upstream HTTP status to a SAFE category for the
    // CLIENT response (we still don't echo ElevenLabs's raw body
    // since it can contain plan / usage info that's private to us).
    // ElevenLabs sometimes returns 401 for both auth AND quota
    // problems — disambiguate by sniffing the body content.
    let friendly: string;
    const code = result.status;
    const rawError = result.error || "";
    const looksLikeQuota = /quota[_ ]exceeded|out of credits|insufficient credits/i.test(rawError);

    if (looksLikeQuota) {
      friendly = "Voice service credits exhausted — refill needed";
    } else if (code === 401 || code === 403) {
      friendly = "Voice service authentication failed — API key issue";
    } else if (code === 402) {
      friendly = "Voice service credits exhausted";
    } else if (code === 422) {
      // Common cause: invalid voice_id. The voice we configured
      // doesn't exist in the user's ElevenLabs workspace.
      friendly = "Voice service rejected the request — check voice ID";
    } else if (code === 429) {
      friendly = "Voice service rate-limited — try again in a moment";
    } else if (code >= 500 && code < 600) {
      friendly = `Voice service is down (HTTP ${code})`;
    } else {
      friendly = `Voice synthesis failed (HTTP ${code || "unknown"})`;
    }
    return jsonError(
      code >= 400 && code < 600 ? code : 502,
      { error: friendly, code },
      sHeaders,
    );
  }

  // Pipe the upstream body straight through. Returning the Response's
  // body as the ReadableStream lets the browser receive the audio
  // chunks as they arrive — no buffering in the edge function.
  return new Response(result.response.body, {
    status: 200,
    headers: {
      ...sHeaders,
      "Content-Type": "audio/mpeg",
      "Cache-Control": "private, no-store",
      // Hint to the client that this is streamable; some buggy
      // proxies otherwise buffer the whole response before forwarding.
      "X-Accel-Buffering": "no",
    },
  });
}
