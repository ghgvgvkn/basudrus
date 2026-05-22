export const config = { runtime: "edge" };

/**
 * /api/past-papers/validate-university — AI-validated uni name lookup.
 *
 * Flow:
 *   1. Caller sends {name: "American University in Cairo"}.
 *   2. Server first checks public.universities for an exact / fuzzy
 *      match — returns immediately if already in the catalog.
 *   3. If not in the catalog, Tavily searches the web for the name.
 *   4. Claude Haiku reads the search results + the typed name and
 *      returns a structured verdict:
 *        - isReal:   true if a real institution exists with this name
 *        - canonical: the canonical name (cleans up typos / abbrevs)
 *        - country:  country where the institution is located
 *        - confidence: 0..1
 *        - reasoning: one sentence
 *   5. If `isReal && confidence >= 0.7`, server INSERTs the canonical
 *      row into public.universities so the next student picks it up
 *      from the dropdown without re-validating.
 *   6. Borderline matches (0.4 ≤ confidence < 0.7) get isReal:true
 *      but we DON'T auto-insert — the upload still succeeds, the row
 *      is flagged for admin review later (Phase 3).
 *   7. Clearly fake / spam (confidence < 0.4 OR isReal:false) is
 *      rejected — the client surfaces a friendly error.
 *
 * Security:
 *   - Auth required (rate limiter checks the JWT).
 *   - Rate limit: 30/day per user — university adds are infrequent.
 *   - CORS exact-host match.
 *   - 8 KB body cap.
 *   - Service-role Supabase client used ONLY for the insert step
 *     (universities table is INSERT-restricted at the RLS level).
 */

import {
  ALLOWED_ORIGINS,
  securityHeaders,
  readCappedJson,
  checkRateLimit,
  rateLimitResponse,
  sanitizeLine,
} from "../_lib/ai-guard";
import { searchTavily } from "../_lib/tavily";

const ANTHROPIC_API_KEY      = process.env.ANTHROPIC_API_KEY || "";
const TAVILY_API_KEY         = process.env.TAVILY_API_KEY || "";
const SUPABASE_URL           = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY      = process.env.SUPABASE_ANON_KEY || "";
const SUPABASE_SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const MAX_BODY_BYTES = 8 * 1024; // 8 KB — just a name string
const LIMITS = { daily: 30, hourly: 15, minute: 5 };

interface ValidateBody {
  name?: unknown;
}

interface ValidateResult {
  ok: boolean;
  /** "match" = found in our catalog already; "verified" = AI-verified
   *  and inserted; "borderline" = AI-uncertain, accepted but not
   *  inserted into catalog; "rejected" = AI says fake/spam. */
  status: "match" | "verified" | "borderline" | "rejected" | "error";
  /** The canonical name we'd save. May differ from the typed name
   *  (typo fixes, expansion of abbreviations, etc.). */
  canonical?: string;
  /** Country where the institution is located. */
  country?: string | null;
  /** 0..1 AI confidence. Null when no AI ran (cache hit). */
  confidence?: number | null;
  /** One-sentence explanation for UI surface. */
  reasoning?: string;
  /** UUID of the matched / inserted universities row, when one
   *  exists in our catalog. */
  universityId?: string | null;
  error?: string;
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

/** Cheap fuzzy-similarity score: 1 means exact (case/whitespace
 *  insensitive); 0 means completely different. We pre-screen DB rows
 *  with this so we don't make an AI call for "univesity of jordan"
 *  when "University of Jordan" is already in the catalog. */
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
}
function similarity(a: string, b: string): number {
  const an = normalize(a);
  const bn = normalize(b);
  if (!an || !bn) return 0;
  if (an === bn) return 1;
  if (an.startsWith(bn) || bn.startsWith(an)) return 0.85;
  if (an.includes(bn) || bn.includes(an)) return 0.7;
  // Token overlap fallback — useful for "University of Jordan" vs
  // "Jordan University" type variations.
  const toks = (s: string) => new Set(s.toLowerCase().split(/[\s\-_,.()]+/).filter((w) => w.length > 2));
  const A = toks(a);
  const B = toks(b);
  if (A.size === 0 || B.size === 0) return 0;
  let common = 0;
  for (const t of A) if (B.has(t)) common++;
  return common / Math.max(A.size, B.size);
}

async function lookupExistingUniversity(name: string): Promise<{ id: string; name: string } | null> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  try {
    // We pull the catalog small (~12-200 rows even after international
    // expansion) and fuzzy-match in memory. This avoids needing a
    // pg_trgm extension and works across spelling variations.
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/universities?select=id,name,short_name,full_name&limit=500`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } },
    );
    if (!res.ok) return null;
    const rows = await res.json() as Array<{ id: string; name: string; short_name?: string; full_name?: string }>;
    let best: { id: string; name: string } | null = null;
    let bestScore = 0;
    for (const r of rows) {
      const candidates = [r.name, r.short_name, r.full_name].filter(Boolean) as string[];
      for (const c of candidates) {
        const s = similarity(name, c);
        if (s > bestScore) { bestScore = s; best = { id: r.id, name: r.name }; }
      }
    }
    // 0.7+ similarity = almost certainly the same university.
    return bestScore >= 0.7 ? best : null;
  } catch {
    return null;
  }
}

async function insertUniversity(canonical: string, country: string | null): Promise<string | null> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return null;
  // Code = lowercased alnum slug derived from canonical name.
  const code = canonical
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || `u_${Date.now().toString(36)}`;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/universities`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        name: canonical,
        code,
        country: country ?? null,
        // display_order defaults to 0 — community-added unis sit at
        // the bottom of the seed list which is intentional.
      }),
    });
    if (!res.ok) return null;
    const rows = await res.json() as Array<{ id: string }>;
    return rows?.[0]?.id ?? null;
  } catch {
    return null;
  }
}

const VALIDATE_PROMPT = `You are validating whether a string is the name of a REAL university (or college / institute of higher education) in the world.

Real institutions look like:
  - "University of Jordan" / "Princess Sumaya University" / "MIT"
  - "Massachusetts Institute of Technology" / "American University in Cairo"
  - "École Polytechnique" / "جامعة الأردن" (Arabic names count)
  - Community colleges, technical institutes, professional schools

NOT real:
  - Random strings ("asdfasdf")
  - Joke names ("Hogwarts", "Pokémon Academy")
  - Generic words alone ("school", "the college")
  - Made-up combinations of real words ("Stanford of California University") — if you can't find evidence of this exact institution, flag it
  - Misspellings so severe you can't tell what was meant

You'll be given a typed name and web search results. Use BOTH:
  - The search results are evidence; if they show a real institution by this name, it's real.
  - Empty / unrelated search results suggest the input is wrong.
  - A typo of a real uni (e.g. "Universty of Jordan") IS real — set canonical to the corrected form.

Return ONLY JSON, no commentary:

{
  "is_real": boolean,
  "canonical": string (the proper name; required even when is_real:false — use the typed name as-is then),
  "country": string or null (where the institution is located, e.g. "Jordan", "United States", "France"),
  "confidence": number between 0 and 1,
  "reasoning": one short sentence
}

Confidence guide:
  - 0.9+ : exact name + clear web evidence
  - 0.7-0.9 : near-match + good web evidence (typo, abbreviation)
  - 0.4-0.7 : plausible but uncertain — wording matches a possible institution but evidence is thin
  - <0.4 : reject as fake / spam / nonsense`;

function extractJson(raw: string): unknown {
  let s = raw.trim();
  if (s.startsWith("```")) s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first >= 0 && last > first) s = s.slice(first, last + 1);
  try { return JSON.parse(s); } catch { return null; }
}

export default async function handler(req: Request): Promise<Response> {
  const origin = req.headers.get("origin");
  const sHeaders = securityHeaders(origin, ALLOWED_ORIGINS);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: sHeaders });
  if (req.method !== "POST") return jsonResponse(405, { ok: false, status: "error", error: "Method not allowed" }, sHeaders);

  if (!ANTHROPIC_API_KEY) {
    return jsonResponse(503, { ok: false, status: "error", error: "Validator unavailable (server misconfigured)" }, sHeaders);
  }

  const authHeader = req.headers.get("authorization");
  const rl = await checkRateLimit({
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY,
    authHeader,
    endpoint: "past-papers/validate-university",
    daily: LIMITS.daily,
    hourly: LIMITS.hourly,
    minute: LIMITS.minute,
  });
  if (!rl.allowed) {
    return rateLimitResponse(rl, sHeaders, {
      cooldown:     "Slow down — please retry in a few seconds.",
      minute_limit: "Too many uni lookups in a minute — try again shortly.",
      hourly_limit: "Hourly uni-lookup quota reached.",
      daily_limit:  "Daily uni-lookup quota reached.",
    });
  }

  const { data: body, error: bodyErr } = await readCappedJson<ValidateBody>(req, MAX_BODY_BYTES, sHeaders);
  if (bodyErr) return bodyErr;
  if (!body) return jsonResponse(400, { ok: false, status: "error", error: "Missing body" }, sHeaders);

  const raw = sanitizeLine(body.name, 200);
  if (!raw || raw.length < 3) {
    return jsonResponse(400, { ok: false, status: "error", error: "University name is too short" }, sHeaders);
  }

  // ── Step 1: Catalog cache lookup ──
  const existing = await lookupExistingUniversity(raw);
  if (existing) {
    return jsonResponse(200, {
      ok: true,
      status: "match",
      canonical: existing.name,
      universityId: existing.id,
      reasoning: `Already in catalog as "${existing.name}".`,
    } satisfies ValidateResult, sHeaders);
  }

  // ── Step 2: Tavily search for evidence ──
  let tavilyContext = "";
  if (TAVILY_API_KEY) {
    try {
      const results = await searchTavily({
        apiKey: TAVILY_API_KEY,
        query: `${raw} university accreditation about overview`,
        searchDepth: "basic",
        maxResults: 4,
      });
      if (results.length > 0) {
        tavilyContext = results
          .map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.content.slice(0, 600)}`)
          .join("\n\n");
      } else {
        tavilyContext = "(No search results — the name may be unusual or misspelled.)";
      }
    } catch {
      tavilyContext = "(Web search unavailable.)";
    }
  } else {
    tavilyContext = "(Web search not configured.)";
  }

  // ── Step 3: Claude verdict (with retry on transient overload) ──
  // 529 = Anthropic overloaded. Retry twice before giving up.
  const RETRYABLE = new Set([502, 503, 504, 529]);
  const BACKOFF_MS = [0, 700, 1700];
  let modelText = "";
  let lastStatus = 0;
  let lastDetail = "";
  let networkErr: string | null = null;

  for (let attempt = 0; attempt < BACKOFF_MS.length; attempt++) {
    if (BACKOFF_MS[attempt] > 0) await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt]));
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 400,
          temperature: 0.1,
          messages: [{
            role: "user",
            content: `${VALIDATE_PROMPT}\n\nTyped name: ${raw}\n\nWeb evidence:\n${tavilyContext}`,
          }],
        }),
      });
      if (res.ok) {
        const json = await res.json() as { content?: Array<{ type: string; text?: string }> };
        modelText = (json.content || [])
          .filter((b) => b.type === "text")
          .map((b) => b.text ?? "")
          .join("\n").trim();
        networkErr = null;
        lastStatus = 200;
        break;
      }
      lastStatus = res.status;
      lastDetail = await res.text().catch(() => "");
      if (!RETRYABLE.has(res.status)) break;
    } catch (e) {
      networkErr = e instanceof Error ? e.message : "Network error reaching the validator";
    }
  }

  if (!modelText) {
    if (networkErr) {
      return jsonResponse(502, { ok: false, status: "error", error: networkErr }, sHeaders);
    }
    const friendly = (lastStatus === 529 || lastStatus === 503)
      ? "AI is overloaded right now — please try again in a moment."
      : `Validator upstream failed (${lastStatus})`;
    return jsonResponse(502, {
      ok: false,
      status: "error",
      error: friendly,
      detail: lastDetail.slice(0, 200),
    }, sHeaders);
  }

  const parsed = extractJson(modelText) as Record<string, unknown> | null;
  if (!parsed || typeof parsed !== "object") {
    return jsonResponse(200, {
      ok: false,
      status: "error",
      canonical: raw,
      reasoning: "Couldn't parse the AI verdict.",
    } satisfies ValidateResult, sHeaders);
  }
  const isReal = parsed.is_real === true;
  const confidence = typeof parsed.confidence === "number"
    ? Math.max(0, Math.min(1, parsed.confidence))
    : 0;
  const canonical = typeof parsed.canonical === "string" && parsed.canonical.trim().length > 0
    ? sanitizeLine(parsed.canonical, 200)
    : raw;
  const country = typeof parsed.country === "string" && parsed.country.length > 0
    ? sanitizeLine(parsed.country, 80)
    : null;
  const reasoning = typeof parsed.reasoning === "string"
    ? sanitizeLine(parsed.reasoning, 300)
    : "";

  // Routing logic per the strategy doc §7.3:
  //   - is_real && confidence >= 0.7 → insert + return verified
  //   - is_real but lower confidence → accept but flag for review
  //   - !is_real or very low confidence → reject
  if (isReal && confidence >= 0.7) {
    const insertedId = await insertUniversity(canonical, country);
    return jsonResponse(200, {
      ok: true,
      status: "verified",
      canonical,
      country,
      confidence,
      reasoning,
      universityId: insertedId,
    } satisfies ValidateResult, sHeaders);
  }
  if (isReal && confidence >= 0.4) {
    // Borderline — accepted but NOT inserted. The past_papers row
    // will still save with the typed (canonicalized) name; an admin
    // can promote later.
    return jsonResponse(200, {
      ok: true,
      status: "borderline",
      canonical,
      country,
      confidence,
      reasoning,
    } satisfies ValidateResult, sHeaders);
  }
  return jsonResponse(200, {
    ok: false,
    status: "rejected",
    canonical: raw,
    country,
    confidence,
    reasoning: reasoning || "We couldn't verify this as a real university. Please double-check the spelling.",
  } satisfies ValidateResult, sHeaders);
}
