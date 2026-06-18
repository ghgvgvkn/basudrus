/**
 * /api/ai/stylist — AI Stylist vision endpoint.
 *
 * Receives a camera frame (or two) as base64 + a mode, sends it to a multimodal
 * Claude model with the "stylist brain" (stylist-knowledge.ts) as a CACHED
 * system prompt, and returns a STRUCTURED JSON verdict (via output_config) that
 * the Aurora StylistMode UI renders as a card.
 *
 * Modes:
 *   rate     — score the worn outfit (skin-harmony + coordination + style).
 *   complete — given one shown piece, recommend the other piece's colors.
 *   compare  — given two options, say which is the better pick.
 *
 * Auth + fail-closed rate limit mirror api/ai/aurora.ts. Stays on the EDGE
 * runtime (client sends base64 directly, so no Buffer is needed). The rate-limit
 * endpoint key reuses "aurora" because check_ai_rate_limit fails closed on an
 * unknown key (same approach as api/ai/bank/extract.ts).
 */
export const config = { runtime: "edge" };

import {
  ALLOWED_ORIGINS,
  securityHeaders,
  readCappedJson,
  checkRateLimit,
  rateLimitResponse,
  getUserIdFromToken,
  isProUser,
} from "../_lib/ai-guard";
import { STYLIST_SYSTEM } from "./stylist-knowledge";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";

// Primary model — env-overridable. Default to a strong vision+reasoning model
// for quality; fall back to Haiku (proven on this account for vision +
// output_config in api/ai/bank/extract.ts) if the primary call fails.
const STYLIST_MODEL = (process.env.STYLIST_MODEL || "claude-sonnet-4-6").trim();
const FALLBACK_MODEL = "claude-haiku-4-5";

// Two camera frames of ~150-250 KB base64 each + a little JSON.
const MAX_BODY_BYTES = 3 * 1024 * 1024;
const LIMITS = { daily: 50, hourly: 20, minute: 4 };

const ALLOWED_MEDIA = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Forced output shape. All fields required so the client gets a stable object;
 *  the model fills irrelevant fields with defaults (0 / "" / [] / "none"). */
const STYLIST_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    headline: { type: "string" },
    undertone: { type: "string", enum: ["warm", "cool", "neutral", "unsure"] },
    depth: { type: "string", enum: ["light", "medium", "deep", "unsure"] },
    season_guess: { type: "string" },
    detected_upper: { type: "string" },
    detected_lower: { type: "string" },
    aesthetic: { type: "string" },
    skin_harmony: { type: "integer" },
    coordination: { type: "integer" },
    style_coherence: { type: "integer" },
    total_score: { type: "integer" },
    reasoning: { type: "string" },
    top_fix: { type: "string" },
    recommendations: { type: "array", items: { type: "string" } },
    recommended_colors: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          hex: { type: "string" },
          why: { type: "string" },
        },
        required: ["name", "hex", "why"],
      },
    },
    winner: { type: "string", enum: ["A", "B", "tie", "none"] },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    caveat: { type: "string" },
  },
  required: [
    "headline", "undertone", "depth", "season_guess", "detected_upper",
    "detected_lower", "aesthetic", "skin_harmony", "coordination",
    "style_coherence", "total_score", "reasoning", "top_fix",
    "recommendations", "recommended_colors", "winner", "confidence", "caveat",
  ],
} as const;

/** Looks like a plausible base64 image payload (size + charset guard). */
function validFrame(s: unknown): string {
  return typeof s === "string" &&
    s.length > 100 && s.length < 1_400_000 && /^[A-Za-z0-9+/=]+$/.test(s)
    ? s
    : "";
}

function imageBlock(media: string, data: string) {
  return { type: "image", source: { type: "base64", media_type: media, data } };
}

interface StylistBody {
  mode?: string;
  imageBase64?: string;
  imageBase64b?: string;
  imageMediaType?: string;
  targetAesthetic?: string;
  knownPiece?: string;
  gender?: string;
  modesty?: boolean;
}

export default async function handler(req: Request): Promise<Response> {
  const origin = req.headers.get("origin");
  const sHeaders = securityHeaders(origin, ALLOWED_ORIGINS);
  const json = (obj: unknown, status = 200) =>
    new Response(JSON.stringify(obj), {
      status,
      headers: { ...sHeaders, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: sHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!ANTHROPIC_API_KEY) return json({ error: "AI is not configured on the server" }, 503);

  // Auth + rate limit in parallel (mirror aurora).
  const authHeader = req.headers.get("authorization");
  const [userId, rate] = await Promise.all([
    getUserIdFromToken(authHeader, SUPABASE_URL, SUPABASE_ANON_KEY),
    checkRateLimit({
      supabaseUrl: SUPABASE_URL,
      supabaseAnonKey: SUPABASE_ANON_KEY,
      authHeader,
      endpoint: "aurora", // reuse a known key (RPC fails closed on unknown keys)
      daily: LIMITS.daily,
      hourly: LIMITS.hourly,
      minute: LIMITS.minute,
    }),
  ]);
  if (!isProUser(userId) && !rate.allowed) {
    return rateLimitResponse(rate, sHeaders, {
      cooldown: "Give Tony a second to breathe between looks.",
      minute_limit: "A few too many looks this minute — try again shortly.",
      hourly_limit: "Hourly limit reached — back soon.",
      daily_limit: "That's today's styling quota — come back tomorrow!",
    });
  }
  if (!userId) return json({ error: "Please sign in to use the AI Stylist" }, 401);

  // Body.
  const { data, error } = await readCappedJson<StylistBody>(req, MAX_BODY_BYTES, sHeaders);
  if (error) return error;
  const body = data || {};

  const mode = body.mode === "complete" || body.mode === "compare" ? body.mode : "rate";
  const media = ALLOWED_MEDIA.has(body.imageMediaType || "") ? (body.imageMediaType as string) : "image/jpeg";
  const frameA = validFrame(body.imageBase64);
  if (!frameA) return json({ error: "No usable photo — try again in better light." }, 400);
  const frameB = validFrame(body.imageBase64b);

  const target = typeof body.targetAesthetic === "string" ? body.targetAesthetic.slice(0, 60).replace(/[^\w '\-/]/g, "") : "";
  const known = body.knownPiece === "lower" ? "lower" : body.knownPiece === "upper" ? "upper" : "";
  const genderHint =
    body.gender === "men" ? " The wearer is dressing in menswear." :
    body.gender === "women" ? " The wearer is dressing in womenswear." : "";
  const modestyHint = body.modesty ? " Apply modest-fashion styling (coverage, layering, hijab framing) as a first-class mode." : "";
  const targetHint = target ? ` The target aesthetic is "${target}".` : "";

  // Per-mode instruction.
  let instruction: string;
  const content: Array<Record<string, unknown>> = [imageBlock(media, frameA)];
  if (mode === "complete") {
    const shown = known === "lower" ? "BOTTOM / lower piece" : known === "upper" ? "TOP / upper piece" : "single garment";
    instruction = `MODE: complete. The photo shows the wearer's ${shown}. Recommend colors for the OTHER piece (fill recommended_colors; leave the 0-5 scores at 0).${genderHint}${modestyHint}${targetHint}`;
  } else if (mode === "compare") {
    if (frameB) {
      content.push(imageBlock(media, frameB));
      instruction = `MODE: compare. The FIRST image is option A and the SECOND image is option B. Say which is the better pick (set winner A/B/tie; leave the 0-5 scores at 0).${genderHint}${modestyHint}${targetHint}`;
    } else {
      instruction = `MODE: compare. The photo shows two options — treat the LEFT item as A and the RIGHT item as B. Say which is the better pick (set winner A/B/tie; leave the 0-5 scores at 0).${genderHint}${modestyHint}${targetHint}`;
    }
  } else {
    instruction = `MODE: rate. Rate the outfit the person is wearing (fill skin_harmony, coordination, style_coherence each 0-5 and total_score 0-100).${genderHint}${modestyHint}${targetHint}`;
  }
  content.push({ type: "text", text: instruction });

  const messages = [{ role: "user", content }];
  const system = [{ type: "text", text: STYLIST_SYSTEM, cache_control: { type: "ephemeral" } }];

  const callModel = async (model: string): Promise<Response> => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 45_000);
    try {
      return await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          max_tokens: 1600,
          system,
          messages,
          output_config: { format: { type: "json_schema", schema: STYLIST_SCHEMA } },
        }),
        signal: ctl.signal,
      });
    } finally {
      clearTimeout(t);
    }
  };

  // Try the primary model; fall back to a guaranteed-working one on failure.
  let res: Response;
  try {
    res = await callModel(STYLIST_MODEL);
    if (!res.ok && STYLIST_MODEL !== FALLBACK_MODEL) {
      res = await callModel(FALLBACK_MODEL);
    }
  } catch {
    try {
      res = await callModel(FALLBACK_MODEL);
    } catch {
      return json({ error: "The stylist is unavailable right now — try again in a moment." }, 502);
    }
  }
  if (!res.ok) return json({ error: "The stylist couldn't read that — try again with a clearer, well-lit photo." }, 502);

  let out: { content?: Array<{ type: string; text?: string }> };
  try {
    out = (await res.json()) as typeof out;
  } catch {
    return json({ error: "The stylist gave an unexpected answer — try again." }, 502);
  }
  const textBlock = (out.content || []).find((b) => b.type === "text");
  let verdict: Record<string, unknown>;
  try {
    verdict = JSON.parse(textBlock?.text || "{}") as Record<string, unknown>;
  } catch {
    return json({ error: "The stylist gave an unexpected answer — try again." }, 502);
  }

  return json({ ok: true, mode, ...verdict });
}
