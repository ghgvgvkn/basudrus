-- ============================================================================
-- 20260530_content_pipeline.sql   (SCAFFOLD)
-- ----------------------------------------------------------------------------
-- Schema for the autonomous course-content pipeline — the data layer behind
-- "AI keeps adding universities and courses." See docs/content-pipeline.md for
-- the full design and the safety rationale.
--
-- Flow:   content_jobs (a unit of work)
--           -> generated_lessons (AI-authored content, one per course/lesson)
--             -> lesson_verifications (adversarial AI fact-check, AI grades AI)
--             -> lesson_reviews (human decision on flagged / sampled lessons)
--           -> published lessons readable by students
--         content_feedback (student "this is wrong" reports -> re-queue)
--
-- SAFETY POSTURE (why this isn't "no human review"):
--   Generation is automated; JUDGMENT is not. Every lesson is fact-checked by
--   a SEPARATE model pass; anything low-confidence or high-stakes (math,
--   medical, legal, religious) is routed to a human queue. Only the flagged
--   slice (~the risky 5%) needs eyes. This is what lets one person supervise
--   the output of a content team. NEVER drop the verification + human-exception
--   layer for an education product — wrong content is the one thing that kills
--   trust.
--
-- RLS: the work tables are service-role-only (no authenticated policies => the
-- admin pipeline reaches them via the service key inside server endpoints).
-- Students can READ published lessons and FILE feedback on them. They can
-- never see drafts, verifications, or review decisions.
--
-- Idempotent. Safe to re-run.
-- ============================================================================

-- ── content_jobs : one unit of "go add courses for X" ───────────────────────
create table if not exists public.content_jobs (
  id                uuid primary key default gen_random_uuid(),
  status            text not null default 'queued'
                      check (status in ('queued','discovering','generating',
                                        'verifying','review','published',
                                        'failed','canceled')),
  target_country    text,
  target_university text,
  target_discipline text,
  requested_by      uuid references auth.users(id) on delete set null,
  notes             text,
  stats             jsonb not null default '{}'::jsonb,   -- counts as it runs
  error             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ── generated_lessons : the AI-authored content unit ────────────────────────
create table if not exists public.generated_lessons (
  id                uuid primary key default gen_random_uuid(),
  job_id            uuid references public.content_jobs(id) on delete cascade,
  course_catalog_id uuid references public.course_catalog(id) on delete set null,
  course_name       text not null,
  title             text not null,
  language          text not null default 'en' check (language in ('en','ar')),
  body              text not null,                         -- markdown content
  quiz              jsonb,                                 -- optional generated quiz
  source_refs       jsonb not null default '[]'::jsonb,    -- [{title,url}]
  status            text not null default 'draft'
                      check (status in ('draft','verifying','verified','flagged',
                                        'approved','rejected','published')),
  confidence        numeric,                               -- 0..1 from verifier
  risk_tags         text[] not null default '{}',          -- {math,medical,...}
  model             text,                                  -- audit: which model
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ── lesson_verifications : adversarial AI fact-check (AI grades AI) ──────────
create table if not exists public.lesson_verifications (
  id             uuid primary key default gen_random_uuid(),
  lesson_id      uuid references public.generated_lessons(id) on delete cascade,
  verdict        text not null check (verdict in ('pass','flag','fail')),
  confidence     numeric,
  issues         jsonb not null default '[]'::jsonb,       -- [{type,detail,severity}]
  verifier_model text,
  created_at     timestamptz not null default now()
);

-- ── lesson_reviews : human decision trail (audit) ───────────────────────────
create table if not exists public.lesson_reviews (
  id          uuid primary key default gen_random_uuid(),
  lesson_id   uuid references public.generated_lessons(id) on delete cascade,
  reviewer_id uuid references auth.users(id) on delete set null,
  decision    text not null check (decision in ('approved','rejected','edited')),
  note        text,
  created_at  timestamptz not null default now()
);

-- ── content_feedback : student "this looks wrong" reports ───────────────────
create table if not exists public.content_feedback (
  id          uuid primary key default gen_random_uuid(),
  lesson_id   uuid references public.generated_lessons(id) on delete cascade,
  reporter_id uuid references auth.users(id) on delete set null,
  reason      text,
  detail      text,
  status      text not null default 'open'
                check (status in ('open','reviewing','resolved','dismissed')),
  created_at  timestamptz not null default now()
);

-- ── Indexes for the queue queries ───────────────────────────────────────────
create index if not exists content_jobs_status_idx       on public.content_jobs (status, created_at);
create index if not exists generated_lessons_status_idx  on public.generated_lessons (status);
create index if not exists generated_lessons_job_idx     on public.generated_lessons (job_id);
create index if not exists lesson_verifications_lesson_idx on public.lesson_verifications (lesson_id);
create index if not exists content_feedback_lesson_idx   on public.content_feedback (lesson_id, status);

-- ── updated_at touch trigger (follows repo convention) ──────────────────────
create or replace function public.touch_content_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_content_jobs_touch on public.content_jobs;
create trigger trg_content_jobs_touch before update on public.content_jobs
  for each row execute function public.touch_content_updated_at();

drop trigger if exists trg_generated_lessons_touch on public.generated_lessons;
create trigger trg_generated_lessons_touch before update on public.generated_lessons
  for each row execute function public.touch_content_updated_at();

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.content_jobs         enable row level security;
alter table public.generated_lessons    enable row level security;
alter table public.lesson_verifications enable row level security;
alter table public.lesson_reviews       enable row level security;
alter table public.content_feedback     enable row level security;

-- Work tables: NO policies for authenticated users => only the service role
-- (which bypasses RLS) can read/write them, from server-side pipeline code.

-- Students may READ published lessons only.
drop policy if exists generated_lessons_read_published on public.generated_lessons;
create policy generated_lessons_read_published on public.generated_lessons
  for select to authenticated
  using (status = 'published');

-- Students may FILE feedback on a lesson, and read their own reports.
drop policy if exists content_feedback_insert_own on public.content_feedback;
create policy content_feedback_insert_own on public.content_feedback
  for insert to authenticated
  with check (reporter_id = auth.uid());

drop policy if exists content_feedback_select_own on public.content_feedback;
create policy content_feedback_select_own on public.content_feedback
  for select to authenticated
  using (reporter_id = auth.uid());
