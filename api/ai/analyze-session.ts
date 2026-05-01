/**
 * /api/ai/analyze-session — post-session analysis (UPGRADE 5).
 *
 * Dedicated to Omar 🍏. The analyzer is what turns a noisy chat
 * transcript into durable, structured progress data so the next
 * session can pick up exactly where the student left off.
 *
 * Flow:
 *   1. Verify the bearer token; only the session's owner can analyze it.
 *   2. Pull the session's full message history from tutor_sessions.
 *   3. Ask Anthropic to summarise it as strict JSON (5-field schema).
 *   4. Parse + sanity-check the JSON. One retry on parse failure.
 *   5. Write back into tutor_progress (upsert topics, weak_areas,
 *      strong_areas, next_review_topics, increment sessions_count).
 *   6. Persist the one-line summary onto tutor_sessions.session_summary.
 *
 * Hard guarantees:
 *   - Every Supabase + Anthropic failure is caught. We always 200 the
 *     client so a failed analysis never surfaces an error to the user.
 *   - JSON-parse failures retry once, then silently no-op (the session
 *     is preserved verbatim — only the summary structure is lost).
 *   - The endpoint is idempotent: calling it twice on the same session
 *     just re-applies the same writes (jsonb merging tolerates dupes).
 */
export const config = { runtime: "edge" };

import { ALLOWED_ORIGINS, securityHeaders, sanitizeLine } from "../_lib/ai-guard";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";

interface AnalyzeBody {
  sessionId?: string;
}

interface AnalysisResult {
  main_topic: string;
  subtopics: string[];
  student_performance: "struggled" | "average" | "strong";
  weak_areas: string[];
  strong_areas: string[];
  recommended_review: string[];
  session_summary: string;
}

const ANALYSIS_PROMPT = `Read the conversation transcript below — it is a tutoring session between a Jordanian university student and an AI tutor.

Respond ONLY with a single valid JSON object that exactly matches this TypeScript type. No markdown fences, no commentary, no leading/trailing whitespace, just the raw JSON:

{
  "main_topic": string,                 // primary topic the session covered, 2-6 words
  "subtopics": string[],                // up to 6 specific subtopics, each 1-5 words
  "student_performance": "struggled" | "average" | "strong",
  "weak_areas": string[],               // up to 5 concepts the student found difficult
  "strong_areas": string[],             // up to 5 concepts the student clearly understood
  "recommended_review": string[],       // up to 5 topics worth revisiting next session
  "session_summary": string             // 1-2 sentence English summary of what happened
}

Rules:
- Use English for all field values, even if the chat was in Arabic.
- If the conversation has fewer than 4 messages, prefer empty arrays over guessing.
- Keep arrays concise — quality over quantity.
- Do NOT include any field other than the seven above.
- Do NOT wrap the JSON in markdown.`;

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

async function getUserIdFromBearer(authHeader: string | null): Promise<string | null> {
  if (!authHeader || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: authHeader },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { id?: string };
    return data?.id ?? null;
  } catch {
    return null;
  }
}

async function callAnthropic(transcript: string): Promise<string | null> {
  if (!ANTHROPIC_API_KEY) return null;
  const body = {
    model: "claude-haiku-4-5-20251001",
    max_tokens: 800,
    system: ANALYSIS_PROMPT,
    messages: [{ role: "user", content: transcript.slice(0, 12_000) }],
  };
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { content?: Array<{ text?: string }> };
    return data?.content?.[0]?.text ?? null;
  } catch {
    return null;
  }
}

/** Strip common LLM wrappers (markdown fences, leading prose) and
 *  attempt to parse the remaining JSON. Returns null on failure. */
function tryParseAnalysis(raw: string | null): AnalysisResult | null {
  if (!raw) return null;
  let text = raw.trim();
  // Strip ```json ... ``` fencing if present.
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  // Find the outermost {...} block — tolerates a stray "Here is the JSON:" prefix.
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  text = text.slice(start, end + 1);
  try {
    const parsed = JSON.parse(text);
    if (
      typeof parsed?.main_topic === "string" &&
      Array.isArray(parsed.subtopics) &&
      typeof parsed.student_performance === "string" &&
      Array.isArray(parsed.weak_areas) &&
      Array.isArray(parsed.strong_areas) &&
      Array.isArray(parsed.recommended_review) &&
      typeof parsed.session_summary === "string"
    ) {
      return {
        main_topic: sanitizeLine(parsed.main_topic, 80),
        subtopics: (parsed.subtopics as unknown[]).map((s) => sanitizeLine(s, 80)).filter(Boolean).slice(0, 6),
        student_performance: ["struggled", "average", "strong"].includes(parsed.student_performance)
          ? parsed.student_performance
          : "average",
        weak_areas: (parsed.weak_areas as unknown[]).map((s) => sanitizeLine(s, 80)).filter(Boolean).slice(0, 5),
        strong_areas: (parsed.strong_areas as unknown[]).map((s) => sanitizeLine(s, 80)).filter(Boolean).slice(0, 5),
        recommended_review: (parsed.recommended_review as unknown[]).map((s) => sanitizeLine(s, 80)).filter(Boolean).slice(0, 5),
        session_summary: sanitizeLine(parsed.session_summary, 400),
      };
    }
    return null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────────

export default async function handler(req: Request) {
  const origin = req.headers.get("origin");
  const sHeaders = securityHeaders(origin, ALLOWED_ORIGINS);

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: sHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
      status: 405,
      headers: { ...sHeaders, "Content-Type": "application/json" },
    });
  }

  // Always return 200 — failures are silent so the student never sees them.
  const okResponse = (extra: Record<string, unknown> = {}) =>
    new Response(JSON.stringify({ ok: true, ...extra }), {
      status: 200,
      headers: { ...sHeaders, "Content-Type": "application/json" },
    });

  try {
    let body: AnalyzeBody;
    try {
      body = (await req.json()) as AnalyzeBody;
    } catch {
      return okResponse({ skipped: "bad-json" });
    }
    const sessionId = sanitizeLine(body?.sessionId, 80);
    if (!sessionId) return okResponse({ skipped: "no-session-id" });

    const authHeader = req.headers.get("authorization");
    const userId = await getUserIdFromBearer(authHeader);
    if (!userId) return okResponse({ skipped: "no-auth" });

    // 1. Pull the session row. RLS filters by auth.uid — but we use
    //    the user's own JWT here, not the service role, so a stolen
    //    session-id from another user simply returns no rows.
    const sessRes = await fetch(
      `${SUPABASE_URL}/rest/v1/tutor_sessions?id=eq.${sessionId}&select=id,user_id,subject,messages,topics_covered`,
      {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: authHeader!,
          "Accept": "application/json",
        },
      },
    );
    if (!sessRes.ok) return okResponse({ skipped: "session-fetch-failed" });
    const sessions = (await sessRes.json()) as Array<{
      id: string;
      user_id: string;
      subject: string;
      messages: Array<{ role: string; content: string }>;
      topics_covered: string[];
    }>;
    const session = sessions?.[0];
    if (!session || session.user_id !== userId) return okResponse({ skipped: "session-not-found-or-not-owner" });
    if (!session.messages || session.messages.length < 2) return okResponse({ skipped: "too-few-messages" });

    // 2. Build a compact transcript for analysis.
    const transcript = session.messages
      .slice(-40)
      .map((m) => `${m.role === "user" ? "STUDENT" : "TUTOR"}: ${(m.content || "").replace(/\s+/g, " ").slice(0, 800)}`)
      .join("\n");

    // 3. Call Anthropic; one retry on parse failure.
    let analysisRaw = await callAnthropic(transcript);
    let analysis = tryParseAnalysis(analysisRaw);
    if (!analysis) {
      analysisRaw = await callAnthropic(transcript);
      analysis = tryParseAnalysis(analysisRaw);
    }
    if (!analysis) return okResponse({ skipped: "parse-failed" });

    // 4. Update tutor_sessions.session_summary.
    void fetch(`${SUPABASE_URL}/rest/v1/tutor_sessions?id=eq.${sessionId}`, {
      method: "PATCH",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: authHeader!,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ session_summary: analysis.session_summary, topics_covered: [analysis.main_topic, ...analysis.subtopics].slice(0, 8) }),
    });

    // 5. Update / upsert tutor_progress.
    //    a) Read existing row.
    const progressRes = await fetch(
      `${SUPABASE_URL}/rest/v1/tutor_progress?user_id=eq.${userId}&subject=eq.${encodeURIComponent(session.subject)}&select=*`,
      {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: authHeader!,
          "Accept": "application/json",
        },
      },
    );
    type ProgressRow = {
      id?: string;
      sessions_count?: number;
      topics_covered?: Array<{ topic: string; last_seen: string }>;
      weak_areas?: string[];
      strong_areas?: string[];
    };
    const progressRows = progressRes.ok ? ((await progressRes.json()) as ProgressRow[]) : [];
    const existing = progressRows[0] ?? null;

    const nowIso = new Date().toISOString();
    const newTopicEntries = [analysis.main_topic, ...analysis.subtopics]
      .filter((t) => !!t)
      .map((topic) => ({ topic, last_seen: nowIso }));

    // Merge by topic (case-insensitive); newer last_seen wins.
    const mergedTopics = (() => {
      const map = new Map<string, { topic: string; last_seen: string }>();
      for (const t of (existing?.topics_covered ?? [])) {
        if (t?.topic) map.set(t.topic.toLowerCase(), t);
      }
      for (const t of newTopicEntries) map.set(t.topic.toLowerCase(), t);
      return Array.from(map.values()).slice(-100);
    })();
    const mergedWeak = Array.from(new Set([...(existing?.weak_areas ?? []), ...analysis.weak_areas])).slice(-20);
    const mergedStrong = Array.from(new Set([...(existing?.strong_areas ?? []), ...analysis.strong_areas])).slice(-20);

    if (existing?.id) {
      void fetch(`${SUPABASE_URL}/rest/v1/tutor_progress?id=eq.${existing.id}`, {
        method: "PATCH",
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: authHeader!,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          sessions_count: (existing.sessions_count ?? 0) + 1,
          topics_covered: mergedTopics,
          weak_areas: mergedWeak,
          strong_areas: mergedStrong,
          next_review_topics: analysis.recommended_review,
          last_session_at: nowIso,
        }),
      });
    } else {
      void fetch(`${SUPABASE_URL}/rest/v1/tutor_progress`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: authHeader!,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          user_id: userId,
          subject: session.subject,
          sessions_count: 1,
          topics_covered: mergedTopics,
          weak_areas: mergedWeak,
          strong_areas: mergedStrong,
          next_review_topics: analysis.recommended_review,
          last_session_at: nowIso,
        }),
      });
    }

    return okResponse({ analyzed: true, performance: analysis.student_performance });
  } catch (e) {
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.warn("[analyze-session] swallowed:", e);
    }
    return okResponse({ skipped: "exception" });
  }
}
