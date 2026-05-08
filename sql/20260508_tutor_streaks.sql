-- ─────────────────────────────────────────────────────────────────
-- tutor_streaks — daily-streak tracking for the AI tutor.
--
-- Behaviour we model:
--   • Each row = one user's lifetime streak state.
--   • current_streak bumps by 1 if they study today AND yesterday;
--     resets to 1 if they skipped a day.
--   • longest_streak is a high-water mark.
--   • milestones_reached records which milestone tiers a user has
--     ever hit, so we only fire the celebratory toast ONCE per tier
--     per user (3, 7, 14, 30, 60, 100, 365).
--   • last_active_day is a UTC date — close enough for Jordan TZ
--     (UTC+3); skew of a few hours either way is fine for a streak
--     concept.
--
-- RLS: own-row only. No service-role writes from the client side.
-- ─────────────────────────────────────────────────────────────────

create table if not exists public.tutor_streaks (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  current_streak     int not null default 0,
  longest_streak     int not null default 0,
  last_active_day    date,
  total_sessions     int not null default 0,
  milestones_reached int[] not null default '{}',
  updated_at         timestamptz not null default now()
);

alter table public.tutor_streaks enable row level security;

-- Drop-and-recreate so re-running the script in Supabase SQL editor
-- is idempotent. Each user reads only their own row.
drop policy if exists "tutor_streaks_self_select" on public.tutor_streaks;
create policy "tutor_streaks_self_select"
  on public.tutor_streaks for select
  using (auth.uid() = user_id);

drop policy if exists "tutor_streaks_self_insert" on public.tutor_streaks;
create policy "tutor_streaks_self_insert"
  on public.tutor_streaks for insert
  with check (auth.uid() = user_id);

drop policy if exists "tutor_streaks_self_update" on public.tutor_streaks;
create policy "tutor_streaks_self_update"
  on public.tutor_streaks for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- updated_at trigger so we can sort by recency if we ever build a
-- streaks-leaderboard view later. Cheap, schema-stable.
create or replace function public.tutor_streaks_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_tutor_streaks_updated_at on public.tutor_streaks;
create trigger trg_tutor_streaks_updated_at
  before update on public.tutor_streaks
  for each row execute function public.tutor_streaks_set_updated_at();
