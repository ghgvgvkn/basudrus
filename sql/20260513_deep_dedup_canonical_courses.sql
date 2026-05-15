-- 20260513_deep_dedup_canonical_courses.sql
--
-- Second-pass dedup on course_catalog after the initial strict
-- (lower-trim equality) pass. Catches formatting variants the
-- strict rule missed:
--
--   "Calculus I"   + "Calculus (1)" + "Calculus 1"   → one canonical
--   "Calculus II"  + "Calculus (2)" + "Calculus 2"   → one canonical
--   "Calculus III" + "Calculus (3)"                  → one canonical
--   "Military Science" + "Military Sciences"         → one canonical
--   "Human-Computer Interaction" + "Human Computer Interaction" → one
--
-- Crucially PRESERVES level distinctions:
--   "Calculus I" stays separate from "Calculus II" — they're different
--   courses (derivatives vs integrals). Same for English Language I
--   vs II, Field Training I vs II, etc.
--
-- Reversibility: dupe rows are NOT deleted. They're marked with
-- canonical_of = survivor_id, which the search code filters out
-- (canonical_of IS NULL). Setting canonical_of = NULL on any row
-- makes it visible again.
--
-- APPLIED TO PRODUCTION via Supabase MCP on 2026-05-13.

-- ─────────────────────────────────────────────────────────────────
-- Helper: parse a course name into (base, level_num)
-- ─────────────────────────────────────────────────────────────────
create or replace function public.parse_course_name(input text)
returns table(base text, level_num int)
language plpgsql immutable as $fn$
declare
  s text := lower(btrim(input));
  lvl int := null;
  stripped text;
  token text;
begin
  if s ~ '\s(iv|iii|ii|i)$' then
    token := btrim(substring(s from '\s(iv|iii|ii|i)$'));
    lvl := case token
             when 'i'   then 1 when 'ii'  then 2
             when 'iii' then 3 when 'iv'  then 4
             else null
           end;
    stripped := regexp_replace(s, '\s(iv|iii|ii|i)$', '');
  elsif s ~ '\s[1-9]$' then
    lvl := (substring(s from '\s([1-9])$'))::int;
    stripped := regexp_replace(s, '\s[1-9]$', '');
  elsif s ~ '\((iv|iii|ii|i|[1-9])\)\s*$' then
    token := lower(btrim(regexp_replace(
      substring(s from '\(([^)]+)\)\s*$'), '\s', '', 'g')));
    lvl := case token
             when 'i'   then 1 when 'ii'  then 2
             when 'iii' then 3 when 'iv'  then 4
             when '1' then 1 when '2' then 2 when '3' then 3 when '4' then 4
             when '5' then 5 when '6' then 6 when '7' then 7 when '8' then 8 when '9' then 9
             else null
           end;
    stripped := regexp_replace(s, '\s*\([^)]*\)\s*$', '');
  else
    lvl := null;
    stripped := s;
  end if;

  stripped := regexp_replace(stripped, '[-_]', ' ', 'g');
  stripped := regexp_replace(stripped, '\s+', ' ', 'g');
  stripped := btrim(stripped);
  stripped := regexp_replace(stripped, 's$', '');

  return query select stripped, lvl;
end
$fn$;

-- ─────────────────────────────────────────────────────────────────
-- Helper: score a candidate name for survivorship
-- ─────────────────────────────────────────────────────────────────
create or replace function public.course_display_score(input text, pop int)
returns double precision
language sql immutable as $fn$
  select (coalesce(pop, 0)::double precision * 100)
    + (case when input ~ '\s(I{1,4}|IV)$' then 50 else 0 end)
    - (case when input ~ '\(' then 30 else 0 end)
    - (case when input = lower(input) then 20 else 0 end);
$fn$;

-- ─────────────────────────────────────────────────────────────────
-- The merge pass
-- ─────────────────────────────────────────────────────────────────
do $$
begin
  create temp table _merge_plan on commit drop as
  with parsed as (
    select cc.id,
           cc.name,
           cc.uni_courses_count as pop,
           p.base,
           p.level_num,
           public.course_display_score(cc.name, cc.uni_courses_count) as score
    from public.course_catalog cc
    cross join lateral public.parse_course_name(cc.name) p
    where cc.canonical_of is null
  ),
  groups as (
    select base, coalesce(level_num, -1) as level_key,
      array_agg(id order by score desc) as ids,
      array_agg(name order by score desc) as names,
      count(*) as variants
    from parsed
    where length(btrim(base)) >= 3
    group by base, coalesce(level_num, -1)
    having count(*) > 1
  )
  select g.ids[1] as survivor_id,
         unnest(g.ids[2:array_length(g.ids,1)]) as dupe_id
  from groups g;

  update public.course_catalog cc
  set canonical_of = mp.survivor_id
  from _merge_plan mp
  where cc.id = mp.dupe_id;

  update public.uni_courses uc
  set catalog_id = mp.survivor_id
  from _merge_plan mp
  where uc.catalog_id = mp.dupe_id;

  update public.course_catalog cc
  set uni_courses_count = coalesce(sub.cnt, 0)
  from (
    select catalog_id, count(*) as cnt
    from public.uni_courses
    where catalog_id is not null
    group by catalog_id
  ) sub
  where cc.id = sub.catalog_id;
end
$$;
