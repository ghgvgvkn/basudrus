-- 20260513_collapse_uni_courses_to_unique.sql
--
-- Final dedup step. Collapses uni_courses from 36,733 messy rows
-- (with same course duplicated once per major × uni that required
-- it) down to 5,492 unique rows — one per canonical course.
--
-- Why this is safe:
--   • Nothing in the application reads uni_courses directly anymore.
--     useCourseSearch queries course_catalog (the clean 5,492-row
--     table). No FK in the database points at uni_courses.
--   • help_requests + profile.subjects reference courses by NAME
--     (text), not by row id. They're untouched.
--   • _backup_uni_courses_20260513 holds every original row.
--     Full reversibility if anything goes wrong.
--
-- The major_id column gets NULL'd on survivors because the
-- per-major mapping was exactly what created the duplication
-- (each canonical course had ~6 rows, one per major that required
-- it). The founder explicitly stated the platform connects
-- students by COURSE, not by major — so major_id is no longer
-- meaningful here. The column stays in case a future per-major
-- mapping table is added.
--
-- APPLIED TO PRODUCTION via Supabase MCP on 2026-05-13.

-- Loosen the NOT NULL constraint so survivors can have major_id = NULL.
alter table public.uni_courses alter column major_id drop not null;

do $$
declare
  v_before bigint;
  v_keepers bigint;
  v_after bigint;
begin
  select count(*) into v_before from public.uni_courses;
  raise notice 'Before: % rows', v_before;

  -- Pick survivor per catalog_id:
  --   1. Row whose name exactly matches the canonical (cleanest)
  --   2. Lowest display_order
  --   3. Lowest id (deterministic tiebreaker)
  create temp table _keepers on commit drop as
  select distinct on (uc.catalog_id) uc.id
  from public.uni_courses uc
  join public.course_catalog cc on cc.id = uc.catalog_id
  where uc.catalog_id is not null
  order by uc.catalog_id,
    case when lower(btrim(uc.name)) = lower(btrim(cc.name)) then 0 else 1 end,
    uc.display_order nulls last,
    uc.id;

  select count(*) into v_keepers from _keepers;
  raise notice 'Keepers selected: %', v_keepers;

  delete from public.uni_courses
  where id not in (select id from _keepers);

  -- Survivors: name exactly matches canonical; major_id is null
  -- (honest representation — not "this course is only required by
  -- this one major").
  update public.uni_courses uc
  set name = cc.name,
      major_id = null
  from public.course_catalog cc
  where cc.id = uc.catalog_id;

  select count(*) into v_after from public.uni_courses;
  raise notice 'After: % rows', v_after;
end
$$;
