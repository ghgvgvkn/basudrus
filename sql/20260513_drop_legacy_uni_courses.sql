-- 20260513_drop_legacy_uni_courses.sql
--
-- Drops the legacy uni_courses table. course_catalog is now the
-- sole source of truth for unique courses (5,492 visible canonical
-- rows). Founder request: simplify so there's only one table to
-- look at.
--
-- Safe to drop because:
--   • No application code reads uni_courses anymore. useCourseSearch
--     was updated to query course_catalog; every other file that
--     mentioned uni_courses was just a stale comment.
--   • No foreign keys point at uni_courses.
--   • _backup_uni_courses_20260513 holds every original row (36,733)
--     so we can rehydrate if anything was missed.
--   • help_requests + profile.subjects reference courses by NAME
--     (text), not by id — untouched.
--
-- APPLIED TO PRODUCTION via Supabase MCP on 2026-05-13.

drop table if exists public.uni_courses;
