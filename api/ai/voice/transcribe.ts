export const config = { runtime: "edge" };

/**
 * /api/ai/voice/transcribe — speech-to-text via ElevenLabs Scribe.
 *
 * Client POSTs:
 *   { audioBase64: string, mediaType: string, languageCode?: "en"|"ar" }
 *
 * Server returns:
 *   { ok: boolean, transcript: string, detectedLanguage?: string }
 *
 * Typical mediaTypes from MediaRecorder: "audio/webm;codecs=opus",
 * "audio/mp4" (Safari fallback), "audio/ogg;codecs=opus" (Firefox).
 * Scribe handles all of them.
 *
 * NOT using ElevenLabs Conversational AI (Agents) — same rationale as
 * speak.ts. This is a pure STT proxy; the transcript flows back to
 * the client, which then feeds it into the existing tutor.ts chat
 * (the orchestration + persona + DATABASE CONTEXT stay there).
 *
 * Security:
 *   - Auth required (rate limiter checks JWT).
 *   - Per-user rate limit: 20/min, 100/hr, 400/day. STT is per-utterance,
 *     so a normal voice conversation lands well under minute cap.
 *   - 5 MB body cap — enough for ~3 min of Opus-encoded speech at
 *     32 kbps, which is more than any single utterance should be.
 *   - CORS exact-host match.
 */

import {
  ALLOWED_ORIGINS,
  securityHeaders,
  readCappedJson,
  checkRateLimit,
  rateLimitResponse,
  sanitizeLine,
} from "../../_lib/ai-guard";
import { transcribeAudio } from "../../_lib/elevenlabs";

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || "";
const SUPABASE_URL       = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY  = process.env.SUPABASE_ANON_KEY || "";

const MAX_BODY_BYTES = 6 * 1024 * 1024; // 6 MB — base64 inflates ~33% so 5 MB raw audio fits
const LIMITS = { daily: 400, hourly: 100, minute: 20 };

// Allowed audio mediaTypes from common browser MediaRecorder outputs.
// We don't accept arbitrary content types — a bogus type might still
// be uploaded but at least the client surface is constrained to what
// Scribe is known to handle.
const ALLOWED_MEDIA_TYPES = new Set([
  "audio/webm",
  "audio/webm;codecs=opus",
  "audio/ogg",
  "audio/ogg;codecs=opus",
  "audio/mp4",
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
]);

interface TranscribeBody {
  audioBase64?: unknown;
  mediaType?: unknown;
  languageCode?: unknown;
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

export default async function handler(req: Request): Promise<Response> {
  const origin = req.headers.get("origin");
  const sHeaders = securityHeaders(origin, ALLOWED_ORIGINS);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: sHeaders });
  if (req.method !== "POST") return jsonResponse(405, { ok: false, error: "Method not allowed" }, sHeaders);

  if (!ELEVENLABS_API_KEY) {
    return jsonResponse(503, { ok: false, error: "Voice unavailable (server misconfigured)" }, sHeaders);
  }

  const authHeader = req.headers.get("authorization");
  const rl = await checkRateLimit({
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY,
    authHeader,
    endpoint: "ai/voice/transcribe",
    daily: LIMITS.daily,
    hourly: LIMITS.hourly,
    minute: LIMITS.minute,
  });
  if (!rl.allowed) {
    return rateLimitResponse(rl, sHeaders, {
      cooldown:     "Slow down — please retry in a moment.",
      minute_limit: "Too many voice messages in a minute — try again shortly.",
      hourly_limit: "Hourly voice quota reached.",
      daily_limit:  "Daily voice quota reached.",
    });
  }

  const { data: body, error: bodyErr } = await readCappedJson<TranscribeBody>(req, MAX_BODY_BYTES, sHeaders);
  if (bodyErr) return bodyErr;
  if (!body) return jsonResponse(400, { ok: false, error: "Missing body" }, sHeaders);

  const audioBase64 = typeof body.audioBase64 === "string" ? body.audioBase64 : "";
  const mediaType = typeof body.mediaType === "string"
    ? sanitizeLine(body.mediaType, 80).toLowerCase()
    : "";
  // Optional 2-letter ISO language hint. We accept "en", "ar", "fr",
  // etc.; anything longer is dropped (Scribe interprets full BCP-47
  // tags but our usage is limited to bare ISO 639-1 codes).
  const langRaw = typeof body.languageCode === "string" ? sanitizeLine(body.languageCode, 8) : "";
  const languageCode = /^[a-z]{2}$/i.test(langRaw) ? langRaw.toLowerCase() : null;

  if (audioBase64.length < 100) {
    return jsonResponse(400, { ok: false, error: "Empty audio" }, sHeaders);
  }
  if (!ALLOWED_MEDIA_TYPES.has(mediaType)) {
    return jsonResponse(400, {
      ok: false,
      error: `Unsupported audio type: ${mediaType || "(none)"}`,
    }, sHeaders);
  }

  const result = await transcribeAudio({
    apiKey: ELEVENLABS_API_KEY,
    audioBase64,
    mediaType,
    languageCode,
  });

  if (!result.ok) {
    return jsonResponse(
      result.status && result.status >= 400 && result.status < 600 ? result.status : 502,
      { ok: false, error: "Transcription failed", code: result.status },
      sHeaders,
    );
  }

  return jsonResponse(200, {
    ok: true,
    transcript: result.transcript,
    detectedLanguage: result.detectedLanguage,
  }, sHeaders);
}
