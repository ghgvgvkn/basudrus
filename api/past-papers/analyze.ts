export const config = { runtime: "edge" };

/**
 * /api/past-papers/analyze — AI validation + metadata extraction.
 *
 * Takes a base64-encoded PDF or image plus the user's claimed
 * metadata, and returns:
 *   {
 *     ok: boolean,
 *     isPastPaper: boolean,
 *     confidence: 0..1,
 *     extracted: {
 *       courseName?, courseCode?, professorName?, year?,
 *       semester?, examType?, topicsCovered: string[],
 *       difficulty?,
 *     },
 *     reasoning: string,
 *   }
 *
 * Client uses this BEFORE inserting the past_papers row to:
 *   1. Refuse files that clearly aren't exam papers (random screenshots,
 *      lecture slides without exam questions, blank pages, memes).
 *   2. Auto-fill the form fields the user left blank.
 *   3. Suggest corrections to fields the user filled in if the AI sees
 *      something different on the paper.
 *
 * Calls Claude Sonnet with vision — Sonnet (not Haiku) because the
 * extraction task is small but high-precision: a wrong year or
 * professor name persists in our shared library forever. The cost
 * is ~$0.005 per analysis, which is fine for the upload path.
 *
 * Security:
 *   - Auth required (matches every other AI endpoint pattern).
 *   - Rate-limited fail-closed via check_ai_rate_limit RPC.
 *   - 4 MB body cap (matches the client PDF cap + small JSON overhead).
 *   - CORS exact-host match.
 *   - Output JSON parsed defensively; malformed responses → ok:false.
 */

import {
  ALLOWED_ORIGINS,
  securityHeaders,
  readCappedJson,
  checkRateLimit,
  rateLimitResponse,
  sanitizeLine,
} from "../_lib/ai-guard";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const SUPABASE_URL      = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";

// 8 MB body cap — same as tutor.ts so a single ~4 MB PDF (5.3 MB
// base64) fits with room for the JSON envelope.
const MAX_BODY_BYTES = 8 * 1024 * 1024;
// Per-file cap matching tutor.ts.
const PER_FILE_MAX = 5_500_000;
// Rate limit budget. Upload analyses are uncommon vs chat turns,
// so a more relaxed cap is fine. (daily / hourly / minute)
const LIMITS = { daily: 50, hourly: 25, minute: 5 };

type AllowedImageMedia = "image/jpeg" | "image/png" | "image/webp" | "image/gif";
const ALLOWED_IMAGE_MEDIA: AllowedImageMedia[] = ["image/jpeg", "image/png", "image/webp", "image/gif"];

interface AnalyzeBody {
  /** Either `imageBase64`+`imageMediaType` OR `pdfBase64`. */
  imageBase64?: unknown;
  imageMediaType?: unknown;
  pdfBase64?: unknown;
  pdfName?: unknown;
  /** Optional context the user already filled in — Sonnet uses this
   *  to focus its extraction (e.g. it doesn't have to guess the uni
   *  from cover-page text when the user already said which uni). */
  hint?: unknown;
}

interface AnalyzeResult {
  ok: boolean;
  isPastPaper: boolean;
  confidence: number;
  extracted: {
    courseName?: string;
    courseCode?: string;
    professorName?: string;
    year?: number;
    semester?: "fall" | "spring" | "summer";
    examType?: "midterm" | "final" | "quiz" | "practice" | "other";
    topicsCovered: string[];
    difficulty?: "easy" | "medium" | "hard";
  };
  reasoning: string;
  error?: string;
}

const EXTRACTION_PROMPT = `You are an exam paper analyzer for Bas Udrus, a study platform.

Your job: look at the attached document and decide if it's a UNIVERSITY EXAM PAST PAPER (or something close to one — like a practice exam, sample quiz, or formative assessment from a course).

A real past paper typically has:
  - Header with university name, course name/code, professor, and/or year/semester
  - Numbered questions or problems
  - Point values or grading rubric
  - Instructions ("Time: 90 minutes", "Answer 4 of 5 questions", etc.)

What it is NOT (refuse these as is_past_paper=false):
  - Lecture slides without questions
  - Random screenshots, memes, or selfies
  - Solved homework assignments (unless they're clearly mock exams)
  - Personal notes / mind maps
  - Course outlines or syllabi without questions
  - Cover pages alone with no exam content

If it IS a past paper, extract these fields. Use null when not visible. Be conservative — only fill a field when you can actually see the answer on the page.

Return JSON. ONLY JSON, no commentary. Schema:

{
  "is_past_paper": boolean,
  "confidence": number between 0 and 1,
  "extracted": {
    "course_name": string or null,
    "course_code": string or null,
    "professor_name": string or null,
    "year": integer (e.g. 2024) or null,
    "semester": "fall" | "spring" | "summer" | null,
    "exam_type": "midterm" | "final" | "quiz" | "practice" | "other" | null,
    "topics_covered": array of strings (up to 8 short topic names, e.g. ["TLB", "Virtual Memory", "Page Replacement"]),
    "difficulty": "easy" | "medium" | "hard" | null
  },
  "reasoning": one short sentence explaining your decision
}

Semester mapping notes:
  - "first semester" / "fall" / "autumn" → "fall"
  - "second semester" / "spring" → "spring"
  - "summer session" / "summer" → "summer"
  - Arabic: الفصل الأول → "fall", الفصل الثاني → "spring", الفصل الصيفي → "summer"

Exam-type mapping notes:
  - "midterm" / "mid-term" / "mid" / "imtihan nusf" → "midterm"
  - "final" / "نهائي" / "imtihan nihai" → "final"
  - "quiz" / "short test" → "quiz"
  - "practice exam" / "sample" / "mock" → "practice"

Output ONLY the JSON object. No prose, no code fences.`;

function jsonResponse(status: number, body: unknown, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

/** Try hard to coerce the model's JSON-ish output into an object.
 *  Strips code fences, trims, picks the largest matching brace block. */
function extractJson(raw: string): unknown {
  let s = raw.trim();
  // Strip ```json ... ``` or ``` ... ``` wrappers
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  }
  // Otherwise grab from first { to last } — sometimes Sonnet
  // adds a closing sentence after the JSON.
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first >= 0 && last > first) {
    s = s.slice(first, last + 1);
  }
  try { return JSON.parse(s); } catch { return null; }
}

function normalizeResult(raw: unknown, fileName: string): AnalyzeResult {
  const fallback: AnalyzeResult = {
    ok: false,
    isPastPaper: false,
    confidence: 0,
    extracted: { topicsCovered: [] },
    reasoning: "Couldn't parse the analysis result.",
  };
  if (!raw || typeof raw !== "object") return fallback;
  const obj = raw as Record<string, unknown>;
  const isPast = obj.is_past_paper === true;
  const confidence = typeof obj.confidence === "number"
    ? Math.max(0, Math.min(1, obj.confidence))
    : 0;
  const ex = (obj.extracted && typeof obj.extracted === "object") ? obj.extracted as Record<string, unknown> : {};
  const semester = ex.semester;
  const examType = ex.exam_type;
  const difficulty = ex.difficulty;
  const topics = Array.isArray(ex.topics_covered)
    ? (ex.topics_covered as unknown[])
        .filter((t): t is string => typeof t === "string" && t.length > 0 && t.length < 80)
        .slice(0, 8)
    : [];
  const yearRaw = ex.year;
  const yearNum = typeof yearRaw === "number" ? yearRaw
                : typeof yearRaw === "string" ? parseInt(yearRaw, 10)
                : null;
  const yearOk = typeof yearNum === "number" && Number.isFinite(yearNum) && yearNum >= 1990 && yearNum <= new Date().getFullYear() + 1;
  return {
    ok: true,
    isPastPaper: isPast,
    confidence,
    extracted: {
      courseName:     typeof ex.course_name === "string"     ? sanitizeLine(ex.course_name, 200)     : undefined,
      courseCode:     typeof ex.course_code === "string"     ? sanitizeLine(ex.course_code, 40)      : undefined,
      professorName:  typeof ex.professor_name === "string"  ? sanitizeLine(ex.professor_name, 120)  : undefined,
      year:           yearOk ? yearNum : undefined,
      semester:       semester === "fall" || semester === "spring" || semester === "summer" ? semester : undefined,
      examType:       examType === "midterm" || examType === "final" || examType === "quiz" || examType === "practice" || examType === "other" ? examType : undefined,
      topicsCovered:  topics,
      difficulty:     difficulty === "easy" || difficulty === "medium" || difficulty === "hard" ? difficulty : undefined,
    },
    reasoning: typeof obj.reasoning === "string" ? sanitizeLine(obj.reasoning, 400) : `Analyzed ${fileName}`,
  };
}

export default async function handler(req: Request): Promise<Response> {
  const origin = req.headers.get("origin");
  const sHeaders = securityHeaders(origin, ALLOWED_ORIGINS);

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: sHeaders });
  if (req.method !== "POST") return jsonResponse(405, { ok: false, error: "Method not allowed" }, sHeaders);

  if (!ANTHROPIC_API_KEY) {
    return jsonResponse(503, { ok: false, error: "AI analysis unavailable (server misconfigured)" }, sHeaders);
  }

  // Fail-closed rate limit — same pattern as the tutor / wellbeing
  // endpoints. Drops requests that can't be authenticated rather
  // than burning Anthropic budget.
  const authHeader = req.headers.get("authorization");
  const rl = await checkRateLimit({
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY,
    authHeader,
    endpoint: "past-papers/analyze",
    daily: LIMITS.daily,
    hourly: LIMITS.hourly,
    minute: LIMITS.minute,
  });
  if (!rl.allowed) {
    return rateLimitResponse(rl, sHeaders, {
      cooldown: "Slow down for a moment — please retry in a few seconds.",
      minute_limit: "Too many uploads in a minute — try again shortly.",
      hourly_limit: "Hourly upload-analysis quota reached.",
      daily_limit: "Daily upload-analysis quota reached.",
    });
  }

  const { data: body, error: bodyErr } = await readCappedJson<AnalyzeBody>(req, MAX_BODY_BYTES, sHeaders);
  if (bodyErr) return bodyErr;
  if (!body) return jsonResponse(400, { ok: false, error: "Missing body" }, sHeaders);

  const imageBase64 = body.imageBase64;
  const imageMediaType = body.imageMediaType;
  const pdfBase64 = body.pdfBase64;
  const pdfName = typeof body.pdfName === "string" ? body.pdfName : "document.pdf";
  const hint = typeof body.hint === "string" ? sanitizeLine(body.hint, 400) : "";

  // Validate that we got exactly one valid attachment.
  const hasImage = typeof imageBase64 === "string"
    && imageBase64.length > 100
    && imageBase64.length < PER_FILE_MAX
    && typeof imageMediaType === "string"
    && (ALLOWED_IMAGE_MEDIA as readonly string[]).includes(imageMediaType);
  const hasPdf = typeof pdfBase64 === "string"
    && pdfBase64.length > 100
    && pdfBase64.length < PER_FILE_MAX;

  if (!hasImage && !hasPdf) {
    return jsonResponse(400, { ok: false, error: "Attach an image or PDF to analyze" }, sHeaders);
  }

  // Build the Anthropic message — one content block for the file,
  // then the extraction prompt with optional user-provided hint.
  type ContentBlock =
    | { type: "text"; text: string }
    | { type: "image"; source: { type: "base64"; media_type: AllowedImageMedia; data: string } }
    | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } };

  const blocks: ContentBlock[] = [];
  if (hasPdf) {
    blocks.push({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: pdfBase64 as string },
    });
  }
  if (hasImage) {
    blocks.push({
      type: "image",
      source: { type: "base64", media_type: imageMediaType as AllowedImageMedia, data: imageBase64 as string },
    });
  }
  const userText = hint
    ? `${EXTRACTION_PROMPT}\n\nUSER HINT (use this to focus your extraction; verify against the document, don't blindly trust):\n${hint}`
    : EXTRACTION_PROMPT;
  blocks.push({ type: "text", text: userText });

  let modelText = "";
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        // Sonnet because precision matters here — wrong professor /
        // year persists in the shared library. Cost (~$0.005/call) is
        // acceptable for the upload path which is rare per-user.
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 800,
        // Lower temperature → more conservative extraction. Important
        // for is_past_paper / confidence honesty.
        temperature: 0.2,
        messages: [{ role: "user", content: blocks }],
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return jsonResponse(502, {
        ok: false,
        error: `Analysis failed (${res.status})`,
        detail: text.slice(0, 300),
      }, sHeaders);
    }
    const json = await res.json() as { content?: Array<{ type: string; text?: string }> };
    modelText = (json.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("\n")
      .trim();
  } catch (e) {
    return jsonResponse(502, {
      ok: false,
      error: e instanceof Error ? e.message : "Network error reaching the analyzer",
    }, sHeaders);
  }

  const parsed = extractJson(modelText);
  const result = normalizeResult(parsed, pdfName);
  return jsonResponse(200, result, sHeaders);
}
