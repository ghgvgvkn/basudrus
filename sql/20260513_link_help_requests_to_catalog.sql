-- 20260513_link_help_requests_to_catalog.sql
--
-- Add a canonical FK to help_requests so each "I need help with X"
-- post knows which canonical course it's about. Backfills the 29
-- existing rows via four lookup strategies. Adds a trigger so
-- every future insert / subject-edit auto-resolves the link.
--
-- The `subject` text column stays — it preserves what the asker
-- actually typed (used for display in the feed card). `catalog_id`
-- is the normalized link, used for filtering and aggregation.
--
-- Why we need this:
--   • "show me help requests about Calculus I" should match every
--     way someone might write that course name ("Calc 1",
--     "Calculus (1)", "Calculus 1") via the canonical id
--   • Aggregate counts per course in analytics
--   • Cross-reference with profile.subjects[] arrays later
--
-- APPLIED TO PRODUCTION via Supabase MCP on 2026-05-13.

alter table public.help_requests
  add column if not exists catalog_id uuid
  references public.course_catalog(id) on delete set null;

create index if not exists help_requests_catalog_id_idx
  on public.help_requests (catalog_id);

-- ─────────────────────────────────────────────────────────────────
-- Resolver function — called by trigger on every insert/update.
-- Uses four lookup strategies in priority order:
--   1) Exact-name on visible canonical
--   2) Name match on an alias → follow canonical_of to survivor
--   3) (base, level) parse match on both sides
--   4) Aggressive normalization (& vs and, lab vs laboratory, etc.)
--      + level match
-- All four use the same helpers (parse_course_name +
-- normalize_course_aggressive) the catalog dedup pass used,
-- so resolution behavior stays consistent with the dedup logic.
-- ─────────────────────────────────────────────────────────────────

create or replace function public.resolve_help_request_catalog_id()
returns trigger language plpgsql as $fn$
declare
  v_match uuid;
  v_norm_subject text;
  v_subject_level int;
begin
  if new.catalog_id is not null then return new; end if;
  if new.subject is null or btrim(new.subject) = '' then return new; end if;

  select id into v_match
  from public.course_catalog
  where canonical_of is null
    and lower(btrim(name)) = lower(btrim(new.subject))
  limit 1;

  if v_match is null then
    select canonical_of into v_match
    from public.course_catalog
    where canonical_of is not null
      and lower(btrim(name)) = lower(btrim(new.subject))
    limit 1;
  end if;

  if v_match is null then
    select cc.id into v_match
    from public.course_catalog cc
    cross join lateral public.parse_course_name(cc.name) cp
    cross join lateral public.parse_course_name(new.subject) hp
    where cc.canonical_of is null
      and length(btrim(hp.base)) >= 3
      and hp.base = cp.base
      and coalesce(hp.level_num, -1) = coalesce(cp.level_num, -1)
    limit 1;
  end if;

  if v_match is null then
    v_norm_subject := public.normalize_course_aggressive(new.subject);
    v_norm_subject := btrim(regexp_replace(v_norm_subject, '\m(i{1,4}|iv|[1-9])\M\s*$', ''));
    select level_num into v_subject_level
    from public.parse_course_name(new.subject);
    select cc.id into v_match
    from public.course_catalog cc
    cross join lateral public.parse_course_name(cc.name) cp
    where cc.canonical_of is null
      and length(v_norm_subject) >= 3
      and btrim(regexp_replace(public.normalize_course_aggressive(cc.name),
            '\m(i{1,4}|iv|[1-9])\M\s*$', '')) = v_norm_subject
      and coalesce(cp.level_num, -1) = coalesce(v_subject_level, -1)
    limit 1;
  end if;

  new.catalog_id := v_match;
  return new;
end
$fn$;

drop trigger if exists trg_resolve_help_request_catalog on public.help_requests;
create trigger trg_resolve_help_request_catalog
  before insert or update of subject, catalog_id on public.help_requests
  for each row execute function public.resolve_help_request_catalog_id();

-- ─────────────────────────────────────────────────────────────────
-- Backfill existing rows
-- ─────────────────────────────────────────────────────────────────
update public.help_requests set subject = subject where catalog_id is null;
