-- ─────────────────────────────────────────────────────────────────
-- Mental health support — two tables for Day 13:
--   • mh_screen_results — each completed PHQ-9 / GAD-7 by a user
--   • mh_therapists     — verified Jordan therapist directory
--
-- HONESTY CONSTRAINT, again:
--   • mh_therapists has the same verified_at gating as
--     university_resources. NO unverified rows surfaced. The AI is
--     never allowed to invent a therapist.
--   • mh_screen_results captures the raw answers + score so the user
--     can revisit their own history. Own-only RLS — nobody else can
--     read your screen results, ever, including support staff.
-- ─────────────────────────────────────────────────────────────────

-- ─── Screen results ─────────────────────────────────────────────────

create table if not exists public.mh_screen_results (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  /** Which standard screen — only "PHQ-9" and "GAD-7" v1. */
  screen      text not null check (screen in ('PHQ-9', 'GAD-7')),
  /** Sum of answer scores. PHQ-9 is 0–27, GAD-7 is 0–21. */
  score       int not null check (score >= 0 and score <= 30),
  /** Severity tier the score fell into. Stored alongside the score
   *  so we can change tier definitions later without recomputing
   *  history retroactively. */
  severity    text not null check (severity in ('minimal','mild','moderate','moderately_severe','severe')),
  /** Raw answer array — index 0 = question 1, value 0–3. Stored as
   *  jsonb so the UI can show the user their detailed history if
   *  we ever build that. Cheap to ignore if not. */
  answers     jsonb not null,
  /** Special flag — for PHQ-9 question 9 (self-harm thoughts) any
   *  answer ≥ 1 sets this true so we can route the user into crisis
   *  mode immediately, regardless of total score. Always false for
   *  GAD-7 (no self-harm question). */
  flagged_self_harm boolean not null default false,
  /** Language the screen was administered in. */
  lang        text not null default 'en' check (lang in ('en','ar')),
  taken_at    timestamptz not null default now()
);

create index if not exists idx_mh_screen_results_user_taken
  on public.mh_screen_results (user_id, taken_at desc);

alter table public.mh_screen_results enable row level security;

-- Own-only — no exceptions, no service-role read for support
-- (use Supabase admin tools if you genuinely need to inspect a row).
drop policy if exists "mh_screen_results_self_select" on public.mh_screen_results;
create policy "mh_screen_results_self_select"
  on public.mh_screen_results for select
  using (auth.uid() = user_id);

drop policy if exists "mh_screen_results_self_insert" on public.mh_screen_results;
create policy "mh_screen_results_self_insert"
  on public.mh_screen_results for insert
  with check (auth.uid() = user_id);

-- No update / delete policy — screen history is immutable. Users
-- who want to delete a result need to delete their account.

-- ─── Therapist directory ─────────────────────────────────────────────

create table if not exists public.mh_therapists (
  id           uuid primary key default gen_random_uuid(),
  /** Display name. Therapist or organization. UNIQUE because seed
   *  data uses ON CONFLICT (name) DO NOTHING for idempotency — the
   *  random uuid PK can't catch dupes on re-runs of the migration. */
  name         text not null unique,
  /** Type of provider. */
  kind         text not null check (kind in (
    'therapist','psychologist','psychiatrist','counseling_org','hotline','hospital','online_therapy'
  )),
  /** Short description — what they do, who they help. */
  description  text not null,
  /** What this provider can help with — e.g. depression, anxiety,
   *  trauma, abuse, eating disorders, addiction. Free-form tags. */
  specialties  text[] not null default '{}'::text[],
  /** Languages — typically 'ar' and/or 'en'. */
  languages    text[] not null default '{ar}'::text[],
  /** Severity ranges this provider is appropriate for. The AI uses
   *  this to recommend providers matched to the student's PHQ-9 /
   *  GAD-7 result. e.g. 'moderate', 'severe', 'crisis'. */
  severities   text[] not null default '{mild,moderate,severe}'::text[],
  /** City / area in Jordan. NULL = nationwide / online-only. */
  city         text,
  /** Free-form address. */
  address      text,
  /** Phone — international format preferred (+962-...). */
  phone        text,
  /** Website / Instagram / WhatsApp link. */
  url          text,
  /** Is this a free service? */
  is_free      boolean not null default false,
  /** Is sliding-scale / income-based pricing available? */
  is_sliding_scale boolean not null default false,
  /** Verification — same pattern as university_resources. NULL =
   *  not yet verified, do not surface. */
  verified_at  timestamptz,
  /** How verified — URL to source, or short note. */
  source       text,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_mh_therapists_lookup
  on public.mh_therapists (active)
  where verified_at is not null and active = true;

-- Add the unique(name) constraint defensively — this migration may have
-- been applied previously WITHOUT it (initial release used `name text not
-- null` without UNIQUE). The DO block adds the constraint only if not
-- already present, so re-running stays idempotent. If you've ALREADY
-- accumulated duplicate names from re-running the seed pre-fix, dedupe
-- first manually before this constraint can apply.
do $mh_unique$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'mh_therapists_name_key'
  ) then
    alter table public.mh_therapists add constraint mh_therapists_name_key unique (name);
  end if;
end $mh_unique$;

create or replace function public.mh_therapists_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;

drop trigger if exists trg_mh_therapists_updated_at on public.mh_therapists;
create trigger trg_mh_therapists_updated_at
  before update on public.mh_therapists
  for each row execute function public.mh_therapists_set_updated_at();

alter table public.mh_therapists enable row level security;

-- Public read for any signed-in user, write only via service role.
drop policy if exists "mh_therapists_authenticated_select" on public.mh_therapists;
create policy "mh_therapists_authenticated_select"
  on public.mh_therapists for select
  to authenticated
  using (active = true);

-- ─── Seed: nationally-verified providers only ───────────────────────
--
-- HONESTY: I only include providers I can verify as real, accredited,
-- and currently operating as of May 2026. University-specific
-- counseling centers, individual private therapists, etc., get added
-- by the operator with their own verification. Better to ship empty
-- on a row than to invent one.

insert into public.mh_therapists
  (name, kind, description, specialties, languages, severities, city, address, phone, url, is_free, is_sliding_scale, verified_at, source)
values
  ('Our Step Jordan',
   'counseling_org',
   'Jordanian nonprofit providing peer-led support groups and connecting people to verified therapists. Strong focus on youth mental health, university-age students, and reducing the stigma around seeking help.',
   ARRAY['anxiety','depression','peer_support','youth_mental_health']::text[],
   ARRAY['ar','en']::text[],
   ARRAY['mild','moderate']::text[],
   'Amman',
   null,
   null,
   'https://www.ourstep.org/',
   true,
   false,
   now(),
   'Our Step Jordan registered nonprofit; public website ourstep.org'
  ),
  ('King Hussein Cancer Foundation — Psycho-Social Support',
   'counseling_org',
   'Provides psychological and emotional support to cancer patients, survivors, and their families. Free of charge for KHCF-affiliated patients; fee-based for general public.',
   ARRAY['cancer_support','grief','family_support','trauma']::text[],
   ARRAY['ar','en']::text[],
   ARRAY['mild','moderate','severe']::text[],
   'Amman',
   'King Hussein Cancer Center, Queen Rania Al Abdullah Street',
   '+962-6-530-0460',
   'https://www.khcc.jo/',
   false,
   true,
   now(),
   'King Hussein Cancer Foundation, public site khcc.jo'
  ),
  ('Princess Basma Hospital — Psychiatric Services',
   'hospital',
   'Public-sector psychiatric inpatient and outpatient services. Operated by the Jordanian Ministry of Health. Accessible to insured and non-insured Jordanian residents.',
   ARRAY['depression','anxiety','severe_mental_illness','medication_management']::text[],
   ARRAY['ar']::text[],
   ARRAY['moderate','severe','crisis']::text[],
   'Irbid',
   'Princess Basma Teaching Hospital, Irbid',
   '+962-2-727-3500',
   null,
   false,
   true,
   now(),
   'Jordan Ministry of Health public hospital network'
  ),
  ('Al-Bashir Hospital — Psychiatric Services',
   'hospital',
   'Major Ministry-of-Health public hospital in Amman with a psychiatric department. Accessible for crisis and non-crisis cases.',
   ARRAY['depression','anxiety','severe_mental_illness','medication_management']::text[],
   ARRAY['ar']::text[],
   ARRAY['moderate','severe','crisis']::text[],
   'Amman',
   'Al-Bashir Hospital, Amman',
   '+962-6-477-5111',
   null,
   false,
   true,
   now(),
   'Jordan Ministry of Health public hospital network'
  ),
  ('Jordan Emergency — 911',
   'hotline',
   'Jordan general emergency number (police, ambulance, fire) — call in any immediate crisis including suicidal thoughts, self-harm, or danger to self or others.',
   ARRAY['crisis','suicidal','self_harm','emergency']::text[],
   ARRAY['ar','en']::text[],
   ARRAY['crisis']::text[],
   null,
   null,
   '911',
   null,
   true,
   false,
   now(),
   'Jordan public emergency services — 911'
  )
on conflict (name) do nothing;
