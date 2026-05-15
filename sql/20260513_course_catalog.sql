-- 20260513_course_catalog.sql
--
-- Dedupes `uni_courses` (36,733 rows → 5,770 canonical) into a new
-- master catalog table that scales toward a worldwide ~20K-course
-- catalog. Adds a country column on universities so the future
-- country filter on Discover has a foundation. Fully additive —
-- no rows deleted, all help_requests + profile subjects preserved
-- byte-for-byte.
--
-- THIS FILE IS THE CHECKED-IN COPY of the migrations that were
-- already applied to production via the Supabase MCP on 2026-05-13.
-- It exists as a paper trail / disaster-recovery aid; it should be
-- safe to re-run because every step is idempotent (CREATE TABLE
-- IF NOT EXISTS, ADD COLUMN IF NOT EXISTS, ON CONFLICT DO NOTHING).

-- ─────────────────────────────────────────────────────────────────
-- 1. Insurance backups (frozen snapshots, safe to drop after a week
--    of confirmed safe operation)
-- ─────────────────────────────────────────────────────────────────

create table if not exists _backup_help_requests_20260513 as
  select * from public.help_requests;

create table if not exists _backup_profiles_courses_20260513 as
  select id as user_id, name, course, major, subjects, created_at
  from public.profiles;

create table if not exists _backup_uni_courses_20260513 as
  select id, major_id, name, display_order, created_at from public.uni_courses;

-- ─────────────────────────────────────────────────────────────────
-- 2. course_catalog — the canonical global course list
-- ─────────────────────────────────────────────────────────────────

create table if not exists public.course_catalog (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 2 and 200),
  discipline  text,
  level       text check (level is null or level in ('intro', 'intermediate', 'advanced')),
  code_hint   text,
  canonical_of uuid references public.course_catalog(id) on delete set null,
  uni_courses_count integer not null default 0,
  source      text not null default 'jordan_dedup',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists course_catalog_name_uniq
  on public.course_catalog (lower(btrim(name)));

create index if not exists course_catalog_discipline_idx
  on public.course_catalog (discipline, level)
  where canonical_of is null;

create index if not exists course_catalog_freq_idx
  on public.course_catalog (uni_courses_count desc, name)
  where canonical_of is null;

alter table public.course_catalog enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'course_catalog'
      and policyname = 'course_catalog_public_read'
  ) then
    create policy course_catalog_public_read
      on public.course_catalog for select using (true);
  end if;
end $$;

create or replace function public.touch_course_catalog_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_touch_course_catalog on public.course_catalog;
create trigger trg_touch_course_catalog
  before update on public.course_catalog
  for each row execute function public.touch_course_catalog_updated_at();

-- ─────────────────────────────────────────────────────────────────
-- 3. Seed the catalog from existing uni_courses (deduplicate by
--    lower-trim'd name; prefer the proper-cased display)
-- ─────────────────────────────────────────────────────────────────

with normalized as (
  select
    lower(btrim(name)) as norm,
    btrim(name) as display,
    count(*) as freq
  from public.uni_courses
  where name is not null and btrim(name) <> ''
  group by 1, 2
),
ranked as (
  select norm, display, freq,
    row_number() over (
      partition by norm
      order by freq desc,
               (length(regexp_replace(display, '[^A-Z]', '', 'g'))) desc,
               display
    ) as rn
  from normalized
),
per_norm_count as (
  select norm, sum(freq) as total from normalized group by 1
)
insert into public.course_catalog (name, source, uni_courses_count)
select r.display, 'jordan_dedup', p.total
from ranked r
join per_norm_count p using (norm)
where r.rn = 1
on conflict ((lower(btrim(name)))) do nothing;

-- ─────────────────────────────────────────────────────────────────
-- 4. Link the legacy uni_courses → catalog
-- ─────────────────────────────────────────────────────────────────

alter table public.uni_courses
  add column if not exists catalog_id uuid
  references public.course_catalog(id) on delete set null;

create index if not exists uni_courses_catalog_id_idx
  on public.uni_courses (catalog_id);

update public.uni_courses uc
set catalog_id = cc.id
from public.course_catalog cc
where lower(btrim(uc.name)) = lower(btrim(cc.name))
  and uc.catalog_id is null;

-- ─────────────────────────────────────────────────────────────────
-- 5. Add country to universities (foundation for the future country
--    filter on Discover — courses stay global, social feed filters
--    by country)
-- ─────────────────────────────────────────────────────────────────

alter table public.universities
  add column if not exists country text;

create index if not exists universities_country_idx
  on public.universities (country);

update public.universities
set country = 'JO'
where country is null;
