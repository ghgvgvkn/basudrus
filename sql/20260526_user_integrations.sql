-- user_integrations — per-user external tool connections.
--
-- Each row stores ONE connection of a user to ONE external integration
-- provider (currently just "zapier"; future: "notion", "openai_key",
-- etc.). The connection is identified by an opaque endpoint URL the
-- user pasted from the provider's setup flow — for Zapier MCP this is
-- the server URL from https://mcp.zapier.com/mcp/servers/new.
--
-- WHY THIS EXISTS
--
-- aurora.ts previously read a single `ZAPIER_MCP_URL` env var which
-- meant every Aurora user shared the founder's Zapier account — Tony
-- would send emails AS the founder for anyone he talked to. Wrong for
-- multi-tenant. This table replaces the env var: aurora.ts now looks
-- up the calling user's row at request time and passes THEIR URL into
-- the Anthropic mcp_servers field. Per-user isolation by design.
--
-- WHY A NEW TABLE INSTEAD OF A COLUMN ON profiles
--
--   1. profiles is touched constantly; adding integration churn there
--      means the profile cache invalidates on every connect/disconnect.
--   2. Future integrations (Notion MCP, custom API keys, OAuth refresh
--      tokens) will need more columns than fit cleanly on profiles.
--   3. Provider-scoped uniqueness is naturally expressed as a unique
--      index on (user_id, provider).
--
-- COLUMNS
--
--   user_id       FK to auth.users — strict per-user RLS scoping
--   provider      what kind of integration (extensible — start with zapier)
--   endpoint_url  the URL we hit. For Zapier: the MCP server URL
--   label         optional human label the user gave it
--                 ("Personal Gmail" / "Work account")
--   created_at    when they first connected
--   updated_at    when they last updated the URL (rotated token, etc.)
--
-- WHAT'S NOT STORED
--
--   - No API tokens. The Zapier MCP URL has the token baked in the
--     path itself — that IS the credential. We treat it like a
--     password (no logging, RLS-scoped, never returned to other users).
--   - No OAuth refresh tokens or anything that could be silently used
--     against the user's account. Future OAuth providers would need
--     their own columns + a careful threat model.
--
-- THREAT MODEL
--
-- The endpoint_url is sensitive — anyone who gets it can use the
-- user's Zapier integrations. So:
--   - RLS allows only the row's owner to SELECT it (no admin reads)
--   - Server-side code accesses it via the user's own JWT (RLS-scoped)
--   - We never log the URL even in error messages

create table if not exists public.user_integrations (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  provider      text not null check (provider in (
                  'zapier'      -- Zapier MCP server URL
                  -- future: 'notion', 'openai_key', 'github', etc.
                )),
  endpoint_url  text not null check (char_length(endpoint_url) between 10 and 2000),
  label         text check (label is null or char_length(label) between 1 and 80),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- One row per (user, provider). Reconnecting (e.g. rotating a leaked
-- URL) is an UPDATE, not an INSERT — so the lookup at request time
-- is always a single row.
create unique index if not exists user_integrations_unique_per_user_provider
  on public.user_integrations (user_id, provider);

-- Look up by user — the hot path is "fetch this user's zapier row"
-- on every Aurora chat turn. Index keeps it O(log n) even at scale.
create index if not exists user_integrations_user_idx
  on public.user_integrations (user_id);

-- updated_at trigger so we can tell when a user last rotated their URL.
create or replace function public.set_updated_at_user_integrations()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists user_integrations_set_updated_at on public.user_integrations;
create trigger user_integrations_set_updated_at
  before update on public.user_integrations
  for each row execute function public.set_updated_at_user_integrations();

-- RLS — STRICTLY per-user. The endpoint_url is sensitive (it's a
-- bearer credential for the user's Zapier integrations). No admin
-- bypass, no service role exposure to other users.
alter table public.user_integrations enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'user_integrations'
      and policyname = 'user_integrations_select_own'
  ) then
    create policy user_integrations_select_own
      on public.user_integrations for select
      using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'user_integrations'
      and policyname = 'user_integrations_insert_own'
  ) then
    create policy user_integrations_insert_own
      on public.user_integrations for insert
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'user_integrations'
      and policyname = 'user_integrations_update_own'
  ) then
    create policy user_integrations_update_own
      on public.user_integrations for update
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'user_integrations'
      and policyname = 'user_integrations_delete_own'
  ) then
    create policy user_integrations_delete_own
      on public.user_integrations for delete
      using (auth.uid() = user_id);
  end if;
end $$;
