-- ============================================================================
-- 20260531_existing_rls_documentation.sql   (DOCUMENTATION — idempotent)
-- ----------------------------------------------------------------------------
-- These RLS policies ALREADY EXIST in the live database (they were applied
-- ad-hoc via the Supabase dashboard, never captured in sql/). This file
-- documents them in-repo and is written defensively (drop-then-create) so
-- running it is a safe no-op that simply re-asserts the current, verified
-- production state. Nothing here changes behaviour.
--
-- Why this file exists: a code audit flagged that several sensitive tables
-- had no RLS migration in the repo. Investigation (pg_policies, 2026-05-31)
-- confirmed the LIVE policies are correct own-only — so this is a
-- documentation gap, not a security hole. Capturing them here means a future
-- DB rebuild from sql/ reproduces the same protection instead of silently
-- shipping unprotected tables.
--
-- VERIFIED LIVE STATE (pg_policies) being mirrored below:
--   tutor_sessions      — own-only select/insert/update/delete (authenticated)
--   tutor_progress      — own-only select/insert/update/delete (authenticated)
--   tutor_feedback      — own-only select/insert            (authenticated)
--   wellbeing_sessions  — own-only select/insert/update/delete
--   student_memory      — own-only select/insert/update/delete
--
-- INTENTIONAL DESIGN NOTE — public.profiles:
--   profiles has `SELECT ... USING (true)` for authenticated users. This is
--   DELIBERATE and must NOT be locked down: Connect, Discover, Rooms, and
--   Study Match all show other students' public profile cards. There is no
--   `email` column on profiles (removed in an earlier privacy refactor), so
--   broad readability does not expose contact info. Email-based discovery is
--   separately gated by profiles.discoverable_by_email (see
--   20260530_match_privacy_optins.sql) and enforced server-side in
--   api/ai/match-lookup.ts. Writes remain own-row only
--   (profiles_update_own / profiles_insert_own).
-- ============================================================================

-- Ensure RLS is on (no-op if already enabled).
alter table public.tutor_sessions     enable row level security;
alter table public.tutor_progress     enable row level security;
alter table public.tutor_feedback     enable row level security;
alter table public.wellbeing_sessions enable row level security;
alter table public.student_memory     enable row level security;

-- ── tutor_sessions ──────────────────────────────────────────────────────────
drop policy if exists tutor_sessions_select_own on public.tutor_sessions;
create policy tutor_sessions_select_own on public.tutor_sessions
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists tutor_sessions_insert_own on public.tutor_sessions;
create policy tutor_sessions_insert_own on public.tutor_sessions
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists tutor_sessions_update_own on public.tutor_sessions;
create policy tutor_sessions_update_own on public.tutor_sessions
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
drop policy if exists tutor_sessions_delete_own on public.tutor_sessions;
create policy tutor_sessions_delete_own on public.tutor_sessions
  for delete to authenticated using ((select auth.uid()) = user_id);

-- ── tutor_progress ───────────────────────────────────────────────────────────
drop policy if exists tutor_progress_select_own on public.tutor_progress;
create policy tutor_progress_select_own on public.tutor_progress
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists tutor_progress_insert_own on public.tutor_progress;
create policy tutor_progress_insert_own on public.tutor_progress
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists tutor_progress_update_own on public.tutor_progress;
create policy tutor_progress_update_own on public.tutor_progress
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
drop policy if exists tutor_progress_delete_own on public.tutor_progress;
create policy tutor_progress_delete_own on public.tutor_progress
  for delete to authenticated using ((select auth.uid()) = user_id);

-- ── tutor_feedback ───────────────────────────────────────────────────────────
drop policy if exists tutor_feedback_select_own on public.tutor_feedback;
create policy tutor_feedback_select_own on public.tutor_feedback
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists tutor_feedback_insert_own on public.tutor_feedback;
create policy tutor_feedback_insert_own on public.tutor_feedback
  for insert to authenticated with check ((select auth.uid()) = user_id);

-- ── wellbeing_sessions ───────────────────────────────────────────────────────
drop policy if exists wellbeing_sessions_select_own on public.wellbeing_sessions;
create policy wellbeing_sessions_select_own on public.wellbeing_sessions
  for select using (auth.uid() = user_id);
drop policy if exists wellbeing_sessions_insert_own on public.wellbeing_sessions;
create policy wellbeing_sessions_insert_own on public.wellbeing_sessions
  for insert with check (auth.uid() = user_id);
drop policy if exists wellbeing_sessions_update_own on public.wellbeing_sessions;
create policy wellbeing_sessions_update_own on public.wellbeing_sessions
  for update using (auth.uid() = user_id);
drop policy if exists wellbeing_sessions_delete_own on public.wellbeing_sessions;
create policy wellbeing_sessions_delete_own on public.wellbeing_sessions
  for delete using (auth.uid() = user_id);

-- ── student_memory ───────────────────────────────────────────────────────────
drop policy if exists student_memory_select_own on public.student_memory;
create policy student_memory_select_own on public.student_memory
  for select using (auth.uid() = user_id);
drop policy if exists student_memory_insert_own on public.student_memory;
create policy student_memory_insert_own on public.student_memory
  for insert with check (auth.uid() = user_id);
drop policy if exists student_memory_update_own on public.student_memory;
create policy student_memory_update_own on public.student_memory
  for update using (auth.uid() = user_id);
drop policy if exists student_memory_delete_own on public.student_memory;
create policy student_memory_delete_own on public.student_memory
  for delete using (auth.uid() = user_id);
