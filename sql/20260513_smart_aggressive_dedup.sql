-- 20260513_smart_aggressive_dedup.sql
--
-- Third dedup pass. Catches what level-aware merge missed:
--   & vs and:           "Probability & Statistics"  + "Probability and Statistics"
--   Lab vs Laboratory:  "Computer Networks Lab"     + "Computer Networks Laboratory"
--   Plural variants:    "Service Marketing"         + "Services Marketing"
--   Hyphen vs space:    "Human-Computer Interaction"+ "Human Computer Interaction"
--   Trivial parens:     "Geographic Information Systems"
--                            + "Geographic Information Systems (GIS)"
--                       "Introduction to Psychology"
--                            + "Introduction to Psychology (in English)"
--
-- DOES NOT merge meaningful-parens variants — those stay separate:
--   "Programming Fundamentals" vs "Programming Fundamentals (Java)"
--   "Engineering Mechanics (Statics)" vs "(Dynamics)"
--   "Field Training" vs "Field Training (Germany)"
--   "Translation (English-Arabic)" vs "(Arabic-English)"
--   "3D Modeling" vs "3D Modeling (SketchUp)"
--
-- The key insight: parens content is "trivial" iff it's an
-- abbreviation (e.g. "GIS"), a level number, a language note
-- ("in English"), or a "remedial" tag. Anything else (language,
-- specialization, country) signals a genuinely different course.
--
-- APPLIED TO PRODUCTION via Supabase MCP on 2026-05-13.

create extension if not exists pg_trgm;

-- ─────────────────────────────────────────────────────────────────
-- Aggressive normalizer — strips formatting, expands common
-- abbreviations, normalizes ampersands and plurals.
-- ─────────────────────────────────────────────────────────────────
create or replace function public.normalize_course_aggressive(input text)
returns text
language plpgsql immutable as $fn$
declare
  s text;
begin
  s := lower(coalesce(input, ''));
  s := regexp_replace(s, '\(.*?\)', ' ', 'g');
  s := regexp_replace(s, '\s&\s|\s+and\s+', ' and ', 'g');
  s := regexp_replace(s, '\mintro\M', 'introduction', 'g');
  s := regexp_replace(s, '\mlab\M', 'laboratory', 'g');
  s := regexp_replace(s, '\mprog\M', 'programming', 'g');
  s := regexp_replace(s, '\m(the|a|an)\M', ' ', 'g');
  s := regexp_replace(s, '[^a-z0-9\s]', ' ', 'g');
  s := regexp_replace(s, 's(\s|$)', '\1', 'g');
  s := regexp_replace(s, '\s+', ' ', 'g');
  return btrim(s);
end
$fn$;

-- ─────────────────────────────────────────────────────────────────
-- Parens-triviality check. Returns TRUE if every parenthesized
-- substring is "ignorable" (abbreviation, language note, level,
-- remedial). Used as the merge guard.
-- ─────────────────────────────────────────────────────────────────
create or replace function public.parens_content_is_trivial(input text)
returns boolean
language plpgsql immutable as $fn$
declare
  rec record;
  orig text;
  lowered text;
begin
  for rec in
    select m[1] as captured from regexp_matches(input, '\(([^)]*)\)', 'g') as t(m)
  loop
    orig := btrim(rec.captured);
    lowered := lower(orig);
    continue when length(lowered) = 0;
    continue when lowered ~ '^[1-9]$' or lowered ~ '^(i{1,4}|iv)$';
    continue when length(orig) <= 6 and orig = upper(orig) and orig ~ '^[A-Z]+$';
    continue when lowered ~ '^in (english|arabic|french|german|spanish|italian)$';
    continue when lowered ~ 'remedial';
    return false;
  end loop;
  return true;
end
$fn$;

-- ─────────────────────────────────────────────────────────────────
-- The smart merge pass
-- ─────────────────────────────────────────────────────────────────
do $$
declare
  v_merges int;
begin
  create temp table _smart_merge_plan on commit drop as
  with parsed as (
    select cc.id, cc.name, cc.uni_courses_count as pop,
      p.level_num,
      public.normalize_course_aggressive(cc.name) as aggressive_norm,
      public.parens_content_is_trivial(cc.name) as is_trivial,
      public.course_display_score(cc.name, cc.uni_courses_count) as score
    from public.course_catalog cc
    cross join lateral public.parse_course_name(cc.name) p
    where cc.canonical_of is null
  ),
  groups as (
    select
      btrim(regexp_replace(aggressive_norm, '\m(i{1,4}|iv|[1-9])\M\s*$', '')) as base_fp,
      coalesce(level_num, -1) as level_key,
      array_agg(id order by score desc) as ids,
      count(*) as variants
    from parsed
    where is_trivial = true and length(btrim(aggressive_norm)) >= 4
    group by
      btrim(regexp_replace(aggressive_norm, '\m(i{1,4}|iv|[1-9])\M\s*$', '')),
      coalesce(level_num, -1)
    having count(*) > 1
  )
  select g.ids[1] as survivor_id,
         unnest(g.ids[2:array_length(g.ids,1)]) as dupe_id
  from groups g;

  select count(*) into v_merges from _smart_merge_plan;
  raise notice 'Smart merge folded % more variants', v_merges;

  update public.course_catalog cc
  set canonical_of = mp.survivor_id
  from _smart_merge_plan mp
  where cc.id = mp.dupe_id;

  update public.uni_courses uc
  set catalog_id = mp.survivor_id
  from _smart_merge_plan mp
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
