-- user_study_plans — persistent storage for generated study plans.
--
-- Before this table, plans streamed from /api/ai/study-plan into the
-- UI and were lost when the student left the screen. With this table,
-- every successful plan generation is mirrored to the student's
-- account so the History sidebar can list them and they can re-open
-- any past plan.
--
-- We store the markdown body (rendered identically on re-open) plus
-- enough metadata to render a meaningful list item without parsing
-- the markdown.

create table if not exists public.user_study_plans (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  title         text not null check (char_length(title) between 1 and 200),
  subjects      text[] not null default '{}'::text[],
  exam_date     date,
  uni           text,
  major         text,
  year          text,
  plan_markdown text not null,
  language      text default 'en' check (language in ('en','ar','mixed')),
  created_at    timestamptz not null default now()
);

create index if not exists user_study_plans_user_idx
  on public.user_study_plans (user_id, created_at desc);

alter table public.user_study_plans enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'user_study_plans'
      and policyname = 'user_study_plans_select_own'
  ) then
    create policy user_study_plans_select_own
      on public.user_study_plans for select
      using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'user_study_plans'
      and policyname = 'user_study_plans_insert_own'
  ) then
    create policy user_study_plans_insert_own
      on public.user_study_plans for insert
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'user_study_plans'
      and policyname = 'user_study_plans_delete_own'
  ) then
    create policy user_study_plans_delete_own
      on public.user_study_plans for delete
      using (auth.uid() = user_id);
  end if;
end $$;
