-- student_memory — persistent semantic memory for the AI.
--
-- Stores discrete "facts" the AI knows about each student. These are
-- loaded into Omar's / Noor's system prompt as a STUDENT MEMORY block
-- so the AI feels like it remembers the student across sessions.
--
-- Sources:
--   • 'manual'        — student typed it themselves in the Memory view
--   • 'auto_extracted'— extracted by a background analyzer from a conversation
--   • 'imported'      — pasted in from another AI via the Import flow
--
-- Categories help the UI group them sensibly and let the prompt
-- prioritize academic context over preferences when space is tight.
--
-- importance is 1-10. Higher = more likely to be injected into the
-- prompt. Defaults to 5 (medium). The auto-extractor can write 3 (low)
-- for casual mentions and 8 (high) for strong patterns ("Ahmed has
-- failed integration 3 times").

create table if not exists public.student_memory (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  fact          text not null check (char_length(fact) between 4 and 600),
  category      text default 'context' check (category in (
                  'academic',     -- "Ahmed is a 3rd-year CS student at PSUT"
                  'preference',   -- "Prefers Arabic explanations after midnight"
                  'context',      -- general context ("commutes 1hr to uni")
                  'weakness',     -- "Struggles with integration by parts"
                  'strength',     -- "Strong in linear algebra"
                  'goal',         -- "Wants to graduate in 2027"
                  'win',          -- "Got 85% on data structures midterm"
                  'other'
                )),
  importance    smallint default 5 check (importance between 1 and 10),
  source        text default 'manual' check (source in ('manual','auto_extracted','imported')),
  last_referenced timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists student_memory_user_idx
  on public.student_memory (user_id, importance desc, created_at desc);

-- Per-user uniqueness on lowercase'd fact text — prevents the
-- auto-extractor from inserting the same fact twice. Manual entries
-- get to override (different casing / wording counts as different).
create unique index if not exists student_memory_unique_per_user
  on public.student_memory (user_id, lower(fact));

-- RLS — strictly per-user. No admin read here; mental-health-adjacent
-- memory is sensitive even when not explicitly clinical.
alter table public.student_memory enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'student_memory'
      and policyname = 'student_memory_select_own'
  ) then
    create policy student_memory_select_own
      on public.student_memory for select
      using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'student_memory'
      and policyname = 'student_memory_insert_own'
  ) then
    create policy student_memory_insert_own
      on public.student_memory for insert
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'student_memory'
      and policyname = 'student_memory_update_own'
  ) then
    create policy student_memory_update_own
      on public.student_memory for update
      using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'student_memory'
      and policyname = 'student_memory_delete_own'
  ) then
    create policy student_memory_delete_own
      on public.student_memory for delete
      using (auth.uid() = user_id);
  end if;
end $$;

-- Keep updated_at fresh on edits.
create or replace function public.touch_student_memory_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_touch_student_memory on public.student_memory;
create trigger trg_touch_student_memory
  before update on public.student_memory
  for each row execute function public.touch_student_memory_updated_at();
