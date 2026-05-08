-- ─────────────────────────────────────────────────────────────────
-- tutor_letters — idempotency log for the weekly Sunday letter.
--
-- The cron runs every Sunday at 08:00 UTC (11:00 Jordan local). A
-- single fire writes one row per user it sent to, keyed on ISO week
-- (e.g. "2026-W19"). If Vercel retries the cron — or if we run it
-- manually from the Supabase SQL editor for testing — the unique
-- constraint prevents double-sends.
--
-- We also add the opt-out flag to profiles. Default OFF (= subscribed)
-- for new and existing users, since the Sunday letter is part of the
-- core experience. Every email contains a one-click unsubscribe link.
-- ─────────────────────────────────────────────────────────────────

create table if not exists public.tutor_letters (
  user_id    uuid not null references auth.users(id) on delete cascade,
  iso_week   text not null,
  sent_at    timestamptz not null default now(),
  /** Resend message ID — stored so support can trace bounces. */
  message_id text,
  primary key (user_id, iso_week)
);

alter table public.tutor_letters enable row level security;

-- Users can read their own send history; only the service role
-- writes. Withholding an INSERT policy means client writes fail RLS,
-- which is what we want — only the cron handler (service role) inserts.
drop policy if exists "tutor_letters_self_select" on public.tutor_letters;
create policy "tutor_letters_self_select"
  on public.tutor_letters for select
  using (auth.uid() = user_id);

-- Profile column for opt-out. Existing rows default to FALSE
-- (subscribed). Users can flip it via the unsubscribe link in any
-- letter or via the settings UI (forthcoming).
alter table public.profiles
  add column if not exists letter_unsubscribed boolean not null default false;
