-- ============================================================================
-- 20260530_atomic_gamification.sql
-- ----------------------------------------------------------------------------
-- Fixes two CRITICAL client-side read-modify-write races + one HIGH timezone
-- bug, all caused by the mobile app doing "SELECT value -> compute -> UPDATE
-- value" from multiple screen instances at once:
--
--   * XP clobber       — two mounted screens each read xp, +amount, write back;
--                        one overwrites the other. Users silently lose XP.
--   * Streak clobber   — recordActivity() had no in-flight guard at all.
--   * Streak TZ bug    — streak was WRITTEN in UTC but COMPARED in device-local
--                        time, so a real consecutive day near midnight (or after
--                        travel) could score as "missed -> reset to 1".
--   * Chat-history clobber — appendChatMessages read the whole messages JSONB,
--                        appended, and wrote it back; two quick turns dropped
--                        one turn's pair.
--
-- The fix is to make every one of these a SINGLE atomic statement in the DB:
--   - award_xp:             xp = xp + amount        (atomic increment)
--   - record_daily_activity: streak recomputed + written in one UPDATE, using a
--                           single consistent timezone (Asia/Amman) for the
--                           day-boundary so write and compare always agree.
--   - append_tutor_messages / append_wellbeing_messages:
--                           messages = messages || new   (atomic jsonb append)
--
-- These run as the CALLING user (no SECURITY DEFINER), so existing own-row RLS
-- on profiles / tutor_sessions / wellbeing_sessions still fully applies — the
-- functions cannot touch another user's rows. The mobile client calls these via
-- supabase.rpc(...) and falls back to the old client path if the function is
-- missing, so deploying the app before this migration is applied does NOT break
-- anything.
--
-- APP DAY BOUNDARY: 'Asia/Amman'. Bas Udrus is Jordan-first; using one fixed
-- zone keeps streaks consistent for the core user base. If you later want
-- per-user day boundaries, pass the user's IANA tz into record_daily_activity.
--
-- Idempotent: create-or-replace throughout. Safe to re-run.
-- ============================================================================

-- ── XP: atomic increment ────────────────────────────────────────────────────
create or replace function public.award_xp(p_amount integer)
returns integer
language sql
as $$
  update public.profiles
     set xp = coalesce(xp, 0) + greatest(0, least(p_amount, 1000))
   where id = auth.uid()
  returning xp;
$$;

comment on function public.award_xp(integer) is
  'Atomically add p_amount (clamped 0..1000) to the caller''s profiles.xp and return the new total. Replaces the racy client read-modify-write.';

-- ── Streak: atomic recompute + write, single timezone ───────────────────────
create or replace function public.record_daily_activity()
returns table (streak integer, last_seen_at timestamptz)
language plpgsql
as $$
declare
  v_last      timestamptz;
  v_streak    integer;
  v_last_day  date;
  v_today     date;
  v_next      integer;
begin
  select p.last_seen_at, coalesce(p.streak, 0)
    into v_last, v_streak
    from public.profiles p
   where p.id = auth.uid();

  if not found then
    -- No profile row for this auth user; nothing to update.
    return;
  end if;

  -- Day boundary in a single fixed zone so write and compare always agree.
  v_today    := (now() at time zone 'Asia/Amman')::date;
  v_last_day := case when v_last is null
                     then null
                     else (v_last at time zone 'Asia/Amman')::date
                end;

  if v_last_day is null then
    v_next := 1;                              -- first ever activity
  elsif v_last_day = v_today then
    v_next := greatest(1, v_streak);          -- already counted today
  elsif v_last_day = v_today - 1 then
    v_next := v_streak + 1;                   -- consecutive day
  else
    v_next := 1;                              -- missed a day -> reset
  end if;

  update public.profiles
     set streak = v_next,
         last_seen_at = now()
   where id = auth.uid();

  streak := v_next;
  last_seen_at := now();
  return next;
end;
$$;

comment on function public.record_daily_activity() is
  'Atomically recompute + persist the caller''s streak using an Asia/Amman day boundary, set last_seen_at=now(), and return the new (streak, last_seen_at).';

-- ── Chat history: atomic jsonb append (one function per table for RLS clarity)
-- NOTE on atomicity + the 200-cap: the whole append MUST be a single UPDATE
-- statement so the row lock makes read+write atomic (a SELECT-then-UPDATE in
-- plpgsql would let two concurrent calls interleave and re-introduce the race).
-- The SET subquery references the row's current `t.messages`, concatenates the
-- new messages, and keeps only the most recent 200 entries — all inline.
create or replace function public.append_tutor_messages(p_session_id uuid, p_messages jsonb)
returns void
language sql
as $$
  update public.tutor_sessions t
     set messages = (
           select coalesce(jsonb_agg(value order by ord), '[]'::jsonb)
           from jsonb_array_elements(
                  coalesce(t.messages, '[]'::jsonb) || coalesce(p_messages, '[]'::jsonb)
                ) with ordinality as e(value, ord)
           where ord > greatest(
                   0,
                   jsonb_array_length(
                     coalesce(t.messages, '[]'::jsonb) || coalesce(p_messages, '[]'::jsonb)
                   ) - 200
                 )
         ),
         updated_at = now()
   where t.id = p_session_id
     and t.user_id = auth.uid();
$$;

comment on function public.append_tutor_messages(uuid, jsonb) is
  'Atomically append p_messages (a jsonb array) to the caller''s own tutor_sessions row. Replaces the racy client read-modify-write.';

create or replace function public.append_wellbeing_messages(p_session_id uuid, p_messages jsonb)
returns void
language sql
as $$
  update public.wellbeing_sessions t
     set messages = (
           select coalesce(jsonb_agg(value order by ord), '[]'::jsonb)
           from jsonb_array_elements(
                  coalesce(t.messages, '[]'::jsonb) || coalesce(p_messages, '[]'::jsonb)
                ) with ordinality as e(value, ord)
           where ord > greatest(
                   0,
                   jsonb_array_length(
                     coalesce(t.messages, '[]'::jsonb) || coalesce(p_messages, '[]'::jsonb)
                   ) - 200
                 )
         ),
         updated_at = now()
   where t.id = p_session_id
     and t.user_id = auth.uid();
$$;

comment on function public.append_wellbeing_messages(uuid, jsonb) is
  'Atomically append p_messages (a jsonb array) to the caller''s own wellbeing_sessions row. Replaces the racy client read-modify-write.';

-- Allow signed-in users to call these (they still only affect the caller's own
-- rows thanks to auth.uid() + RLS).
grant execute on function public.award_xp(integer)                       to authenticated;
grant execute on function public.record_daily_activity()                 to authenticated;
grant execute on function public.append_tutor_messages(uuid, jsonb)      to authenticated;
grant execute on function public.append_wellbeing_messages(uuid, jsonb)  to authenticated;
