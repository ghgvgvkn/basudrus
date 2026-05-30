-- ============================================================================
-- 20260530_function_search_path.sql
-- ----------------------------------------------------------------------------
-- Pins `search_path = ''` on the functions added in 20260530_atomic_gamification
-- and 20260530_content_pipeline, silencing Supabase's
-- `function_search_path_mutable` security lint.
--
-- Safe to apply: every non-builtin object referenced inside those functions is
-- already fully schema-qualified (public.profiles, public.tutor_sessions,
-- public.wellbeing_sessions, auth.uid()). Built-in functions/operators/types
-- (now(), coalesce, jsonb_agg, jsonb_array_elements, jsonb_array_length, ||,
-- ::jsonb, ::date) resolve from pg_catalog, which is always implicitly on the
-- search_path even when it is set to empty. So pinning the path changes nothing
-- about behaviour — it only removes the lint and the (here-unreachable) risk of
-- search_path-based shadowing.
--
-- Idempotent. Safe to re-run.
-- ============================================================================

alter function public.award_xp(integer)                      set search_path = '';
alter function public.record_daily_activity()                set search_path = '';
alter function public.append_tutor_messages(uuid, jsonb)     set search_path = '';
alter function public.append_wellbeing_messages(uuid, jsonb) set search_path = '';
alter function public.touch_content_updated_at()             set search_path = '';
