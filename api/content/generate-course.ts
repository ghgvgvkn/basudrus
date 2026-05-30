export const config = { runtime: "nodejs", maxDuration: 60 };

/**
 * /api/content/generate-course — SCAFFOLD for the autonomous course pipeline.
 * ----------------------------------------------------------------------------
 * This is the engine behind "AI keeps adding universities and courses." It is
 * deliberately a SCAFFOLD: the structure, auth, job-claim, and stage contracts
 * are real, but the three model-driven stages (discover / generate / verify)
 * are stubbed and clearly marked TODO. Nothing is persisted yet, and this
 * endpoint is NOT attached to any cron — so it cannot run on its own or write
 * generated content until someone implements the stages on purpose.
 *
 * Why staged, not one "autonomous agent": frontier agents complete only
 * ~1/4–1/3 of multi-step tasks unsupervised (CMU TheAgentCompany, 2025), and
 * for an EDUCATION product a wrong lesson is fatal to trust. So the pipeline
 * is a deterministic sequence with an adversarial verification gate and a
 * human-exception queue — see docs/content-pipeline.md.
 *
 * Pipeline (per job):
 *   1. discoverCourses  — research the real curriculum for a target uni/dept.
 *   2. generateLesson   — author each lesson in the right language (en/ar).
 *   3. verifyLesson     — a SEPARATE model fact-checks each lesson vs. its
 *                         sources, scores confidence, and tags high-stakes
 *                         content for mandatory human review.
 *   4. (persist) verified+low-risk -> auto-publishable later; flagged -> human
 *      review queue (lesson_reviews). Implemented once stages are real.
 *
 * Auth: cron/admin only, via `Authorization: Bearer <CRON_SECRET>` — same
 * pattern as api/cron/sunday-letter.ts. Never publicly callable.
 */

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const CRON_SECRET = process.env.CRON_SECRET || "";

interface ContentJob {
  id: string;
  status: string;
  target_country: string | null;
  target_university: string | null;
  target_discipline: string | null;
}

interface DiscoveredCourse {
  name: string;
  code_hint?: string | null;
}

interface GeneratedLesson {
  course_name: string;
  title: string;
  language: "en" | "ar";
  body: string;
  source_refs: Array<{ title: string; url: string }>;
}

interface VerificationResult {
  verdict: "pass" | "flag" | "fail";
  confidence: number;
  issues: Array<{ type: string; detail: string }>;
  risk_tags: string[];
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * STAGE 1 — discover the real courses for a target.
 * TODO: use the existing Tavily web-search helper (api/_lib/tavily.ts) to pull
 * the actual course catalogue for `job.target_university` + `target_discipline`,
 * normalise names against public.course_catalog (reuse the dedup helpers from
 * sql/20260513_*), and return a deduped list. Returns [] in scaffold mode.
 */
async function discoverCourses(job: ContentJob): Promise<DiscoveredCourse[]> {
  void job;
  return [];
}

/**
 * STAGE 2 — generate one lesson for one course.
 * TODO: call Claude to produce structured lesson content (markdown) in the
 * student's language, WITH inline source references it can be checked against.
 * Reuse the tutor persona/system-prompt building blocks from api/ai/tutor.ts.
 * Returns null in scaffold mode.
 */
async function generateLesson(course: DiscoveredCourse, job: ContentJob): Promise<GeneratedLesson | null> {
  void course;
  void job;
  return null;
}

/**
 * STAGE 3 — adversarial verification (AI grades AI). The safety gate.
 * TODO: a SEPARATE model pass (different prompt, ideally a stronger model than
 * the generator) that (a) fact-checks each claim against the lesson's own
 * source_refs, (b) returns a 0..1 confidence, (c) tags high-stakes content
 * (math proofs, medical, legal, religious-sensitive) that MUST get human eyes
 * regardless of confidence. Low confidence OR any risk tag => route to the
 * human review queue; otherwise eligible for auto-publish once a subject has a
 * clean track record. Returns a conservative "flag" in scaffold mode.
 */
async function verifyLesson(lesson: GeneratedLesson): Promise<VerificationResult> {
  void lesson;
  return {
    verdict: "flag",
    confidence: 0,
    issues: [{ type: "scaffold", detail: "verification not implemented yet" }],
    risk_tags: [],
  };
}

/** Claim the oldest queued job via the service role. */
async function claimNextQueuedJob(): Promise<ContentJob | null> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return null;
  const url =
    `${SUPABASE_URL}/rest/v1/content_jobs` +
    `?select=id,status,target_country,target_university,target_discipline` +
    `&status=eq.queued&order=created_at.asc&limit=1`;
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    },
  });
  if (!res.ok) return null;
  const rows = (await res.json()) as ContentJob[];
  return rows?.[0] ?? null;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return json(405, { ok: false, error: "Method not allowed" });
  }

  // Cron/admin only.
  const auth = req.headers.get("authorization") || "";
  if (!CRON_SECRET || auth !== `Bearer ${CRON_SECRET}`) {
    return json(401, { ok: false, error: "Unauthorized" });
  }
  if (!SUPABASE_SERVICE_KEY) {
    return json(503, { ok: false, error: "Pipeline unavailable (service key missing)" });
  }

  const job = await claimNextQueuedJob();
  if (!job) {
    return json(200, {
      ok: true,
      scaffold: true,
      message: "No queued content jobs.",
      stagesImplemented: false,
    });
  }

  // Exercise the (stubbed) stage shapes without persisting anything.
  const courses = await discoverCourses(job);
  const lessons: GeneratedLesson[] = [];
  const verifications: VerificationResult[] = [];
  for (const course of courses) {
    const lesson = await generateLesson(course, job);
    if (!lesson) continue;
    lessons.push(lesson);
    verifications.push(await verifyLesson(lesson));
  }

  return json(200, {
    ok: true,
    scaffold: true,
    message:
      "Pipeline scaffold reached. Stage functions are stubbed — see docs/content-pipeline.md to implement.",
    job,
    counts: {
      coursesDiscovered: courses.length,
      lessonsGenerated: lessons.length,
      verified: verifications.length,
    },
    stagesImplemented: false,
  });
}
