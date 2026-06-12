/**
 * elevenlabs.ts — thin wrapper around ElevenLabs Creative REST API.
 *
 * Same pattern as tavily.ts: pure stateless helpers, Edge-runtime safe,
 * no SDK dependency (the official @elevenlabs/elevenlabs-js SDK pulls
 * in Node-only deps that don't run in Vercel Edge).
 *
 * We use Creative — NOT the "Conversational AI" / Agents product.
 * Decision rationale lives in CLAUDE.md / chat history, summarized:
 *   - Tony Starrk's brain lives in api/ai/tutor.ts with DATABASE CONTEXT
 *     pre-fetch from professors + past_papers per turn. Agents would
 *     require migrating that orchestration into ElevenLabs' dashboard
 *     and losing per-user RLS-gated DB reads.
 *   - Creative API is ~18× cheaper at our usage shape (TTS chars +
 *     Scribe minutes vs. Agent's flat per-minute).
 *   - Future Jarvis (V3 WebSocket streaming) still works on Creative
 *     via the streaming TTS endpoint and signed URLs.
 *
 * Endpoints used:
 *   - POST /v1/text-to-speech/{voice_id}                 (V1 TTS)
 *   - POST /v1/text-to-speech/{voice_id}/stream          (V1 TTS streaming — what we use)
 *   - POST /v1/speech-to-text                            (V2 STT — "Scribe")
 *
 * Voice/model defaults:
 *   - Default voice = Adam (deep, calm, Jarvis-adjacent male baritone).
 *     ElevenLabs public voice ID, no custom-voice billing.
 *   - Default model = eleven_flash_v2_5 — ~75ms time-to-first-byte,
 *     32 languages (incl. Arabic), 50% cheaper than Multilingual v2.
 *   - VOICE_ALLOWLIST gates which voice IDs the server will synthesize.
 *     Clients can pass voiceId in the request body but the server
 *     refuses anything outside the allowlist — prevents a misbehaving
 *     client from billing us against a premium Cloned voice.
 */

const ELEVENLABS_BASE_URL = "https://api.elevenlabs.io";

// Stock ElevenLabs voice IDs we explicitly permit. Add new entries
// here (and only here) when we want to expose a new persona voice.
// Custom-cloned voices ARE allowed via env var below — this guards
// against a client passing a random voice_id and racking up cost on
// a voice we haven't validated.
const PUBLIC_VOICE_ALLOWLIST: ReadonlySet<string> = new Set([
  // Daniel + George added for the Tony Stark-style deep British male
  // tier — Daniel is the new default, George is the formal alternative.
  "onwK4e9ZLuTAKqWW03F9", // Daniel — DEFAULT Tony voice (deep British)
  "JBFqnCBsd6RMkjVDRZzb", // George — formal deep British, alternative
  "nPczCjzI2devNBz1zQrb", // Brian — American calm narrator (previous default)
  "29vD33N1CtxCmqQRPOHJ", // Drew — friendly American male, well-paced
  "2EiwWnXFnvU5JabPnv8n", // Clyde — energetic American male, characterful
  "IKne3meq5aSn9XLyUdCD", // Charlie — casual Australian male
  "TX3LPaxmHKxFdv7VOQHJ", // Liam — articulate American male
  "pNInz6obpgDQGcFmaJgB", // Adam — deep, calm male (legacy default)
  "21m00Tcm4TlvDq8ikWAM", // Rachel — clear female, neutral US
  "AZnzlk1XvdvUeBnXmlld", // Domi — strong, confident female
  "EXAVITQu4vr4xnSDxMaL", // Bella — warm, friendly female
  "ErXwobaYiN019PkySvjV", // Antoni — well-rounded male
  "VR6AewLTigWG4xSOukaG", // Arnold — crisp, narrative male
  "MF3mGyEYCl7XYWbV9V6O", // Elli — youthful, emotive female
  "TxGEqnHWrfWFTfGW9XjX", // Josh — calm, deep male
]);

// FOUNDER'S PICK (2026-06-12): the ElevenLabs voice he chose for Tony
// ("this is the voice I wanna use for the Tony Stark"). To override
// per-deploy without code, set ELEVENLABS_DEFAULT_VOICE_ID in Vercel
// env — note the env var WINS over this constant if both exist.
//
// Previous/alternative voices if this one doesn't fit:
//   - Daniel  "onwK4e9ZLuTAKqWW03F9" — deep British, dry-wit (old default)
//   - Brian   "nPczCjzI2devNBz1zQrb" — American, calm narrator
//   - Adam    "pNInz6obpgDQGcFmaJgB" — deep American, professional
//   - Antoni  "ErXwobaYiN019PkySvjV" — well-rounded American
//   - George  "JBFqnCBsd6RMkjVDRZzb" — deep British, formal
export const DEFAULT_VOICE_ID = "QbrR6b6YCLjyBkFKH5Xz"; // founder's Tony voice (2nd pick)
export const DEFAULT_TTS_MODEL = "eleven_flash_v2_5";
export const DEFAULT_STT_MODEL = "scribe_v1";

// Voice settings tuned for Tony Starrk's persona: confident, witty,
// slightly dry, formal-but-warm. Compared to the previous Brian
// settings:
//   - stability bumped 0.35 → 0.45 (less inconsistent across turns —
//     a "dry wit" voice needs to land jokes the same way every time)
//   - similarity_boost up 0.75 → 0.80 (keeps Daniel sounding like
//     Daniel even when voice_settings push the style further)
//   - style up 0.45 → 0.60 (more character, leans into Daniel's
//     natural reserve — less "audiobook narrator," more "spoken
//     with conviction")
//   - speaker_boost stays on (cuts through low-volume playback)
export const DEFAULT_VOICE_SETTINGS = {
  stability: 0.45,        // consistent dry-wit landing
  similarity_boost: 0.80, // recognizable Daniel timbre
  style: 0.60,            // more character / conviction
  use_speaker_boost: true,
} as const;

/**
 * Pick the effective voice ID for a request:
 *   1. If client passed a voiceId AND it's in the public allowlist → use it.
 *   2. If env ELEVENLABS_DEFAULT_VOICE_ID is set → use it (escape hatch for
 *      a custom-cloned Tony voice without code changes).
 *   3. Otherwise fall back to DEFAULT_VOICE_ID (Adam).
 *
 * We deliberately don't let the client pick a custom voice ID — only the
 * env-configured one is allowed. This means the founder can swap to a
 * cloned voice in Vercel settings without exposing the cloned voice ID
 * to client-side code (it would otherwise be visible in network tab).
 */
export function resolveVoiceId(
  clientVoiceId: string | undefined,
  envDefaultVoiceId: string | undefined,
): string {
  if (clientVoiceId && PUBLIC_VOICE_ALLOWLIST.has(clientVoiceId)) {
    return clientVoiceId;
  }
  if (envDefaultVoiceId && envDefaultVoiceId.length > 5) {
    return envDefaultVoiceId;
  }
  return DEFAULT_VOICE_ID;
}

export interface SynthesizeArgs {
  apiKey: string;
  voiceId: string;
  text: string;
  modelId?: string;
  /** Output format. mp3_44100_128 is the smallest decent-quality option
   *  (~16 KB/s) — fine for chat playback. Use pcm_44100 only if you're
   *  feeding the bytes directly into the Web Audio API for FFT analysis
   *  WITHOUT decoding through an Audio element. */
  outputFormat?: "mp3_44100_128" | "mp3_44100_192" | "pcm_44100";
  /** ElevenLabs voice_settings — pass null to use the voice's defaults. */
  voiceSettings?: {
    stability?: number;
    similarity_boost?: number;
    style?: number;
    use_speaker_boost?: boolean;
  };
  signal?: AbortSignal;
}

/**
 * Stream text-to-speech audio from ElevenLabs. Returns the upstream
 * fetch Response so the route handler can pipe its body straight to
 * the client — no buffering, first audio byte reaches the browser in
 * ~75ms with Flash v2.5.
 *
 * On non-2xx upstream, the body is consumed into a short error string
 * for the caller to surface (we don't want to leak the upstream JSON
 * verbatim — it sometimes contains plan / quota detail).
 */
export async function synthesizeSpeechStream(args: SynthesizeArgs): Promise<{
  ok: boolean;
  status: number;
  response?: Response;
  error?: string;
}> {
  const {
    apiKey, voiceId, text,
    modelId = DEFAULT_TTS_MODEL,
    outputFormat = "mp3_44100_128",
    voiceSettings,
    signal,
  } = args;
  if (!apiKey) return { ok: false, status: 500, error: "Missing ElevenLabs API key" };
  if (!text || text.length === 0) return { ok: false, status: 400, error: "Empty text" };

  // optimize_streaming_latency=3 = ElevenLabs' max-speed setting.
  // Bytes start arriving before the full sentence is synthesized —
  // dramatically reduces time-to-first-audio. We pair it with the
  // smallest output format (mp3 128kbps) so the bytes are small too.
  const url = `${ELEVENLABS_BASE_URL}/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream` +
              `?output_format=${encodeURIComponent(outputFormat)}` +
              `&optimize_streaming_latency=3`;
  const body: Record<string, unknown> = {
    text,
    model_id: modelId,
    // Apply per-call settings if provided; otherwise the
    // conversational defaults (lower stability + style boost) so
    // Tony's voice has actual character instead of flat narration.
    voice_settings: voiceSettings ?? DEFAULT_VOICE_SETTINGS,
  };

  // Hard timeout — if ElevenLabs hangs, our edge function hangs
  // until Vercel's 30s kill. Wrap with an AbortController that
  // fires at 15s. Also honor caller's signal if one was passed,
  // so a client disconnect short-circuits the upstream call too.
  const ctl = new AbortController();
  const timeoutId = setTimeout(() => ctl.abort(new Error("Upstream timeout (15s)")), 15_000);
  if (signal) {
    if (signal.aborted) ctl.abort(signal.reason);
    else signal.addEventListener("abort", () => ctl.abort(signal.reason), { once: true });
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": apiKey,
        Accept: "audio/mpeg",
      },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return {
        ok: false,
        status: res.status,
        error: `ElevenLabs ${res.status}: ${detail.slice(0, 200)}`,
      };
    }
    return { ok: true, status: 200, response: res };
  } catch (e) {
    return {
      ok: false,
      status: 502,
      error: e instanceof Error ? e.message : "Network error reaching ElevenLabs",
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export interface TranscribeArgs {
  apiKey: string;
  audioBase64: string;
  mediaType: string;
  modelId?: string;
  /** ISO language code hint. Pass "ar" / "en" to bias detection when
   *  we know the user's locale; omit for auto-detect. Scribe handles
   *  both reliably without a hint at the cost of ~100ms extra. */
  languageCode?: string | null;
  signal?: AbortSignal;
}

export interface TranscribeResult {
  ok: boolean;
  transcript: string;
  detectedLanguage?: string;
  /** When the upstream call fails, status & error are populated. */
  status?: number;
  error?: string;
}

/**
 * Transcribe a base64-encoded audio clip via ElevenLabs Scribe.
 * Scribe accepts a multipart/form-data request — we decode the
 * base64 in-edge into a Blob, build a FormData, and POST.
 *
 * Returns the transcript text. Errors are surfaced as { ok:false }
 * so the route handler can shape a clean JSON response for the client.
 *
 * Latency: ~1-2s for a 10-second clip with `scribe_v1`. There's no
 * streaming STT in Scribe today; if/when ElevenLabs ships realtime
 * STT we'd add a /stream variant here.
 */
export async function transcribeAudio(args: TranscribeArgs): Promise<TranscribeResult> {
  const {
    apiKey, audioBase64, mediaType,
    modelId = DEFAULT_STT_MODEL,
    languageCode,
    signal,
  } = args;
  if (!apiKey) return { ok: false, transcript: "", status: 500, error: "Missing ElevenLabs API key" };
  if (!audioBase64 || audioBase64.length < 100) {
    return { ok: false, transcript: "", status: 400, error: "Empty audio" };
  }

  // Decode base64 → ArrayBuffer → Blob. We allocate the ArrayBuffer
  // directly (not via Uint8Array.from) so the Blob constructor's TS
  // signature accepts it without the SharedArrayBuffer narrowing
  // complaint introduced in TS 5.7+.
  let buf: ArrayBuffer;
  try {
    const bin = atob(audioBase64);
    buf = new ArrayBuffer(bin.length);
    const view = new Uint8Array(buf);
    for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
  } catch {
    return { ok: false, transcript: "", status: 400, error: "Invalid base64 audio" };
  }
  const blob = new Blob([buf], { type: mediaType });

  const form = new FormData();
  form.append("file", blob, "audio");
  form.append("model_id", modelId);
  if (languageCode) form.append("language_code", languageCode);

  // Hard timeout — STT can hang on large audio uploads. 25s ceiling
  // covers ~30s clips comfortably; longer and the user should be
  // sent to a chunked path anyway.
  const ctl = new AbortController();
  const timeoutId = setTimeout(() => ctl.abort(new Error("Upstream timeout (25s)")), 25_000);
  if (signal) {
    if (signal.aborted) ctl.abort(signal.reason);
    else signal.addEventListener("abort", () => ctl.abort(signal.reason), { once: true });
  }
  try {
    const res = await fetch(`${ELEVENLABS_BASE_URL}/v1/speech-to-text`, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        // Do NOT set Content-Type — fetch sets it with the multipart
        // boundary automatically. Setting it manually breaks the upload.
      },
      body: form,
      signal: ctl.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return {
        ok: false,
        transcript: "",
        status: res.status,
        error: `ElevenLabs ${res.status}: ${detail.slice(0, 200)}`,
      };
    }
    const json = await res.json() as { text?: string; language_code?: string };
    const transcript = typeof json.text === "string" ? json.text.trim() : "";
    return {
      ok: true,
      transcript,
      detectedLanguage: json.language_code,
    };
  } catch (e) {
    return {
      ok: false,
      transcript: "",
      status: 502,
      error: e instanceof Error ? e.message : "Network error reaching ElevenLabs",
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
