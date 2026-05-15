-- wellbeing_sessions — persistent storage for Noor (wellbeing) chats.
--
-- Mirrors tutor_sessions for the History sidebar, but kept as a
-- separate table because Noor sessions don't have a "subject" the way
-- tutor sessions do — and we don't want to pollute tutor_sessions
-- with persona logic or null-allow subject. Two clean tables, one
-- union'd view in the client. Same JSONB message shape so the
-- resume flow uses the same TutorMessage transformer.
--
-- topic is free-form text the client sets (we typically infer from
-- the first user message — "anxiety", "relationship", "general").
-- It only feeds the sidebar title; nothing else reads it.

create table if not exists public.wellbeing_sessions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  topic           text default 'general' check (char_length(topic) between 1 and 80),
  messages        jsonb not null default '[]'::jsonb,
  session_summary text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists wellbeing_sessions_user_idx
  on public.wellbeing_sessions (user_id, updated_at desc);

alter table public.wellbeing_sessions enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'wellbeing_sessions'
      and policyname = 'wellbeing_sessions_select_own'
  ) then
    create policy wellbeing_sessions_select_own
      on public.wellbeing_sessions for select
      using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'wellbeing_sessions'
      and policyname = 'wellbeing_sessions_insert_own'
  ) then
    create policy wellbeing_sessions_insert_own
      on public.wellbeing_sessions for insert
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'wellbeing_sessions'
      and policyname = 'wellbeing_sessions_update_own'
  ) then
    create policy wellbeing_sessions_update_own
      on public.wellbeing_sessions for update
      using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'wellbeing_sessions'
      and policyname = 'wellbeing_sessions_delete_own'
  ) then
    create policy wellbeing_sessions_delete_own
      on public.wellbeing_sessions for delete
      using (auth.uid() = user_id);
  end if;
end $$;

-- Keep updated_at fresh — important for History sidebar bucketing.
create or replace function public.touch_wellbeing_sessions_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_touch_wellbeing_sessions on public.wellbeing_sessions;
create trigger trg_touch_wellbeing_sessions
  before update on public.wellbeing_sessions
  for each row execute function public.touch_wellbeing_sessions_updated_at();
