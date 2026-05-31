# Autonomous Course-Content Pipeline — Design (Scaffold)

**Status:** scaffold landed (schema + skeleton endpoint). Generation/verification
logic is stubbed and awaiting greenlight on this design.

This is the engine behind the goal "AI keeps adding universities and courses
around the world." It is intentionally **not** a single autonomous agent. It is a
deterministic pipeline with an **adversarial verification gate** and a **human
exception queue**, because for an education product a wrong lesson is the one
failure that destroys trust — and frontier agents still only complete ~¼–⅓ of
multi-step tasks unsupervised.

> The principle: **automate the labor, keep a human on the judgment.** This
> pipeline lets one person supervise the output of a content team — it does not
> remove the person.

---

## Flow

```
content_jobs ── "add courses for University X / Discipline Y"
   │
   ├─ 1. discover   → research the real curriculum (web), dedupe vs course_catalog
   ├─ 2. generate   → author each lesson (markdown, en/ar) WITH source refs
   ├─ 3. verify     → a SEPARATE model fact-checks each lesson vs its sources,
   │                  scores confidence, tags high-stakes topics
   ├─ 4. route      → low-confidence OR high-stakes ⇒ human review queue
   │                  clean + trusted subject ⇒ eligible for auto-publish
   └─ 5. publish    → students can read it
                      ↑
content_feedback ── student "this is wrong" ⇒ auto-unpublish + re-queue
```

## The safety gate (do not remove this for an edu product)

1. **Source-grounded generation.** The generator must emit inline references it
   can later be checked against. No references ⇒ auto-flag.
2. **Adversarial verification (AI grades AI).** A *different* prompt — ideally a
   *stronger* model than the generator — fact-checks each claim against the
   lesson's own sources and returns a 0–1 confidence. This is where you buy
   safety cheaply: AI reviews the 95%, humans only see the flagged slice.
3. **High-stakes routing.** Math proofs, medical, legal, and religious-sensitive
   content go to a human **regardless of confidence** (`risk_tags`).
4. **Human exception queue.** A founder/SME approves flagged items + a random
   sample of "clean" ones. Track per-subject accuracy; a subject that scores
   clean for N samples earns a lower human-review rate. Nothing un-reviewed ships
   in a brand-new subject.
5. **Feedback loop.** A student report pulls the lesson and re-queues it. Per
   source/subject error rates decide what stays automated.

## Data model

See `sql/20260530_content_pipeline.sql`:

| table | purpose | who can read |
|---|---|---|
| `content_jobs` | a unit of work + live stats | service role only |
| `generated_lessons` | AI-authored content, status-tracked | students read `published` only |
| `lesson_verifications` | adversarial check results | service role only |
| `lesson_reviews` | human decision audit trail | service role only |
| `content_feedback` | student "this is wrong" reports | students read their own |

RLS: work tables have **no authenticated policies** (service-role pipeline only).
Students can read published lessons and file feedback. Drafts/verifications/
reviews are never student-visible.

## API surface

- `POST /api/content/generate-course` — the worker (scaffold). Auth =
  `Bearer <CRON_SECRET>`. Claims the oldest queued job and runs the (stubbed)
  stages. **Not yet attached to a cron** — wire it in `vercel.json` only after
  stages are implemented and tested.
- *(future)* `POST /api/content/review` — admin approve/reject (gate with the
  `PRO_OVERRIDE_USER_IDS` founder allowlist, mirroring `api/_lib/ai-guard.ts`).
- *(future)* a small admin review screen — add as a section under
  `ai-app/src/settings/sections/` or a founder-gated route.

## Phased build plan

- **Phase 0 (done): scaffold** — schema, RLS, skeleton worker, this doc.
- **Phase 1: one course, one lesson, human-reviewed.** Implement
  `discoverCourses` (Tavily) + `generateLesson` (Claude) for a single seeded
  job; persist to `generated_lessons` as `draft`. No auto-publish.
- **Phase 2: verification gate.** Implement `verifyLesson` (separate model),
  populate `lesson_verifications`, auto-route flagged ⇒ `review`.
- **Phase 3: human review UI.** Founder-gated screen to approve/reject; approve
  ⇒ `published`. Wire the worker to a cron.
- **Phase 4: feedback loop + trust scoring.** `content_feedback` handling,
  per-subject accuracy metrics, graduated auto-publish for proven subjects.
- **Phase 5: scale out** — discovery jobs per university/country, batch
  generation, dashboards.

## Guardrails / instrumentation (build alongside, not after)

- Per-subject + per-source accuracy (verifier confidence, human reject rate,
  student report rate). You cannot supervise what you cannot measure.
- Hard rule: a new subject never auto-publishes until it has a clean human-
  reviewed track record.
- Marketing/SEO note: if published lessons get indexed, mass un-reviewed pages
  risk Google "scaled content abuse" actions. Quality gate protects rankings too.

## Open decisions for the founder

1. **Auto-publish ever?** Recommend: never for new subjects; graduated only.
2. **First target** for Phase 1 (which university + discipline to seed)?
3. **SME reviewer**: you alone at first, or a part-time subject expert for
   math/medical from day one?
