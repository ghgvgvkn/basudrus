-- ─────────────────────────────────────────────────────────────────
-- university_resources — verified local resources Bas Udros can
-- recommend to students when their question implicates a real-life
-- need (struggling alone with a subject, looking for a study group,
-- needing career advice, etc.).
--
-- HONESTY CONSTRAINT — kept in the schema itself:
--   • Every row carries a `verified_at` timestamp. Rows without it
--     should never be surfaced to students.
--   • Every row has a `source` field pointing to the URL / contact
--     where we verified it. If the source goes stale we can re-check.
--   • We DO NOT seed this table with fabricated data. It ships empty
--     (or with only universally-true entries like "your professor's
--     office hours") and admins fill it in over time with verified
--     real local data.
--
-- The Bas Udros tutor endpoint reads this table (server side) on
-- every turn where the student has a `uni` set on their profile,
-- pulls verified rows matching their context, and injects them into
-- the system prompt as a RESOURCES block. The AI is instructed to
-- recommend rows by name when relevant — and to say "I don't have a
-- verified local resource for that" when nothing matches. Never to
-- invent.
--
-- Read access: every signed-in user. Insert/update access: service
-- role only (manage from Supabase dashboard or a future admin UI).
-- ─────────────────────────────────────────────────────────────────

create table if not exists public.university_resources (
  id           uuid primary key default gen_random_uuid(),
  /** University the resource is at. Free-form for now (we don't
   *  have a normalized university table yet) — store the canonical
   *  short name we use in profiles.uni: "PSUT", "JU", "Yarmouk",
   *  "AABU", "AAU", "BAU", "Hashemite", "Mutah", "GJU", "Petra",
   *  "ZUJ", "Philadelphia". Use NULL for resources that apply to
   *  ALL Jordanian unis (e.g. national hotlines, public libraries). */
  uni          text,
  /** Resource type. Drives how the AI introduces it.
   *    'club'           — student clubs / chapters (IEEE, ACM, etc.)
   *    'study_circle'   — informal weekly study group
   *    'help_desk'      — drop-in tutoring (math/writing/etc.)
   *    'office_hours'   — professor / TA office hours
   *    'tutoring'       — paid or peer tutoring service
   *    'counseling'     — university counseling / mental health
   *    'career'         — career services, internship office
   *    'library'        — library reservations / quiet study
   *    'lab'            — physical lab / computing lab access
   *    'online'         — online resource (course, MOOC, channel)
   *    'hotline'        — phone hotlines (mental-health, suicide)
   *    'other'          — catch-all
   */
  kind         text not null check (kind in (
    'club','study_circle','help_desk','office_hours','tutoring',
    'counseling','career','library','lab','online','hotline','other'
  )),
  /** Display name. e.g. "IEEE Computer Society — PSUT Chapter".
   *  This is what the AI says back to the student. UNIQUE because
   *  the seed insert below uses ON CONFLICT (name) DO NOTHING for
   *  idempotency — random uuid PK can't catch dupes on re-runs. */
  name         text not null unique,
  /** What this resource is and why a student would visit it.
   *  Short — 1-2 sentences. The AI weaves this into its reply. */
  description  text not null,
  /** Subjects this resource helps with. Empty array = applies broadly.
   *  Should match the AISubject enum keys: math, cs, physics,
   *  chemistry, biology, languages, history, wellbeing, general. */
  subjects     text[] not null default '{}'::text[],
  /** Problem signals this resource addresses. Free-form text tags
   *  the tutor matches against the student's context. Examples:
   *  'struggling_alone', 'need_practice_partner', 'career_anxiety',
   *  'cv_help', 'low_grades', 'feeling_lost', 'exam_prep',
   *  'group_study', 'mental_health', 'paper_writing'. */
  signals      text[] not null default '{}'::text[],
  /** Free-form when text. e.g. "Tuesdays 7-9pm during semester". */
  when_text    text,
  /** Free-form where text. e.g. "Engineering Building, Room 221". */
  where_text   text,
  /** How to contact / sign up. e.g. "instagram @psut.ieee". */
  contact      text,
  /** Optional URL — Instagram page, university page, online resource. */
  url          text,
  /** WHO verified this is real, and WHEN. NULL = not verified, do
   *  not surface to students. Update on each re-verification. */
  verified_at  timestamptz,
  /** Where the verification came from — a URL or short text note
   *  explaining how we know this is accurate. */
  source       text,
  /** Soft-delete flag — flip false instead of deleting so we keep
   *  history of what we used to recommend. */
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Index for the typical query: by uni + active + verified.
create index if not exists idx_university_resources_lookup
  on public.university_resources (uni, active)
  where verified_at is not null and active = true;

-- Defensively add unique(name) constraint if missing — initial migration
-- may have been applied without it. Idempotent via DO block guard.
do $ur_unique$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'university_resources_name_key'
  ) then
    alter table public.university_resources add constraint university_resources_name_key unique (name);
  end if;
end $ur_unique$;

-- updated_at trigger so we can sort by recency.
create or replace function public.university_resources_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;

drop trigger if exists trg_university_resources_updated_at on public.university_resources;
create trigger trg_university_resources_updated_at
  before update on public.university_resources
  for each row execute function public.university_resources_set_updated_at();

-- RLS: read by any authenticated user, write by service role only.
alter table public.university_resources enable row level security;

drop policy if exists "uni_resources_authenticated_select" on public.university_resources;
create policy "uni_resources_authenticated_select"
  on public.university_resources for select
  to authenticated
  using (true);

-- No insert / update / delete policies — only the service role bypasses
-- RLS, which is what we want until we build an admin UI.

-- ─────────────────────────────────────────────────────────────────
-- SEED DATA — verified national-level resources only.
--
-- DELIBERATELY MINIMAL. We seed only entries we can verify as real
-- and accurate at the time of writing (May 2026). Everything else
-- (university-specific clubs, help desks, individual tutoring) gets
-- added by the operator with verified data. The AI is instructed to
-- say "I don't have a verified local resource for that" when nothing
-- matches — better than fabricating.
-- ─────────────────────────────────────────────────────────────────

-- Universal: every student in Jordan can talk to their own professor.
-- This is a tautology that we surface so the AI can recommend it
-- when academic struggles are the topic.
insert into public.university_resources
  (uni, kind, name, description, subjects, signals, when_text, where_text, contact, url, verified_at, source)
values
  (null, 'office_hours',
   'Your professor''s office hours',
   'Every professor at every Jordanian university holds weekly office hours, usually 1-2 hours. They are paid to help — using them is normal, not embarrassing.',
   '{}'::text[],
   ARRAY['struggling_alone','low_grades','exam_prep','clarification_needed'],
   'Posted on the course syllabus / ask in class',
   'Faculty offices on your campus',
   'Check the syllabus, the course Moodle page, or ask the prof directly',
   null,
   now(),
   'Universal at all accredited Jordanian universities (Higher Education Accreditation Commission of Jordan).'
  ),
  (null, 'hotline',
   'Jordan suicide / mental-health emergency hotline',
   'If a student is in immediate crisis (suicidal thoughts, self-harm, severe distress), call 911 (Jordan emergency) or visit the nearest hospital emergency department. The Princess Basma Hospital and Al-Bashir Hospital both have psychiatric services.',
   ARRAY['wellbeing']::text[],
   ARRAY['mental_health','crisis','suicidal','self_harm']::text[],
   '24/7',
   null,
   '911 (Jordan emergency)',
   null,
   now(),
   'Jordan public emergency services — 911 reaches police / ambulance / fire across the country.'
  )
on conflict (name) do nothing;
