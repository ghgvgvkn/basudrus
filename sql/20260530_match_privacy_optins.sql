-- ============================================================================
-- 20260530_match_privacy_optins.sql
-- ----------------------------------------------------------------------------
-- Closes two HIGH-severity privacy findings in the Study Match feature:
--
--   1. /api/ai/study-match read EVERY candidate's private `student_memory`
--      (which can contain wellbeing-derived emotional facts) into the AI
--      matchmaker prompt via the service-role key, with no consent check.
--   2. /api/ai/match-lookup resolved ANY email address to a real account +
--      profile card via the service-role admin API, i.e. an account-existence
--      + PII oracle over the whole user base.
--
-- Fix = explicit, per-user opt-in columns. The API now gates the sensitive
-- behaviour on these flags (see api/ai/study-match.ts and match-lookup.ts).
--
-- DEFAULT = FALSE (privacy-safe by default). This means, until a user opts in:
--   - their tutor memory is NOT used to enrich match-making (profile-only
--     matching still works exactly as before), and
--   - they are NOT discoverable by email (the lookup returns the same generic
--     "no eligible student" response it already returns for non-users).
--
-- >>> PRODUCT DECISION FOR THE FOUNDER <<<
-- If you would rather these features stay broadly enabled (growth over
-- privacy-by-default), flip existing users on with the one-liner at the bottom
-- of this file AND change the column default to TRUE. I recommend leaving them
-- FALSE — it's the defensible posture for an app that touches wellbeing data.
--
-- Idempotent: safe to re-run.
-- ============================================================================

alter table public.profiles
  add column if not exists study_match_opt_in boolean not null default false;

alter table public.profiles
  add column if not exists discoverable_by_email boolean not null default false;

comment on column public.profiles.study_match_opt_in is
  'When true, this user''s tutor memory (student_memory) may be used to enrich AI study-partner matching. Default false = profile-only matching, no private notes leave the user.';

comment on column public.profiles.discoverable_by_email is
  'When true, other signed-in users can resolve this user''s profile by entering their exact email in Study Match. Default false = not discoverable by email.';

-- No RLS change required: `profiles` already restricts who can read/write rows,
-- and these columns are read server-side via the service role inside the two
-- API endpoints. The mobile Settings toggle updates them through the user's own
-- authenticated session (own-row update, already permitted).

-- ----------------------------------------------------------------------------
-- OPTIONAL — opt every CURRENT user in (run ONLY if you choose growth-default):
--
--   update public.profiles set study_match_opt_in = true;
--   update public.profiles set discoverable_by_email = true;
--   alter table public.profiles alter column study_match_opt_in set default true;
--   alter table public.profiles alter column discoverable_by_email set default true;
--
-- Leave commented to keep the privacy-safe default.
-- ----------------------------------------------------------------------------
