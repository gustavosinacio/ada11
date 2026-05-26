-- Migration: 0017_admin_secdef_reads
-- Closes a security leak introduced by 0016_admin.sql.
--
-- 0016 added additive `Admins read all <table>` SELECT policies on every
-- user-data table. Postgres OR-combines policies, which meant any
-- admin-flagged user saw ALL rows on EVERY surface — not just the /admin
-- page. Regular pages (History, Routines, Workout, Exercises) had no
-- explicit `user_id = auth.uid()` filter on their list queries (they relied
-- entirely on RLS), so an admin signing in saw everyone's data on the
-- normal app screens.
--
-- Fix: drop the additive policies. Move admin reads to SECURITY DEFINER
-- RPC functions that explicitly check `is_admin(auth.uid())` and return
-- the joined data the admin page needs. The strict per-user RLS stays in
-- place; only the named RPC entry points elevate access.

drop policy if exists "Admins read all sessions"               on sessions;
drop policy if exists "Admins read all sets"                   on sets;
drop policy if exists "Admins read all routines"               on routines;
drop policy if exists "Admins read all routine_exercises"      on routine_exercises;
drop policy if exists "Admins read all routine_exercise_sets"  on routine_exercise_sets;
drop policy if exists "Admins read all exercise_notes"         on exercise_notes;
drop policy if exists "Admins read all measurement_entries"    on measurement_entries;
drop policy if exists "Admins read all user_preferences"       on user_preferences;
drop policy if exists "Admins read all exercises"              on exercises;

-- ---------------------------------------------------------------------------
-- admin_routines_for_user(target_user_id) → setof routines
-- ---------------------------------------------------------------------------
create or replace function admin_routines_for_user(target_user_id uuid)
returns setof routines
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not is_admin(auth.uid()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return query
    select * from routines
    where user_id = target_user_id and deleted_at is null
    order by created_at desc;
end;
$$;
revoke all on function admin_routines_for_user(uuid) from public;
grant execute on function admin_routines_for_user(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- admin_sessions_for_user(target_user_id) → setof sessions
-- ---------------------------------------------------------------------------
create or replace function admin_sessions_for_user(target_user_id uuid)
returns setof sessions
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not is_admin(auth.uid()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return query
    select * from sessions
    where user_id = target_user_id and deleted_at is null
    order by started_at desc;
end;
$$;
revoke all on function admin_sessions_for_user(uuid) from public;
grant execute on function admin_sessions_for_user(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- admin_routine_detail(routine_id) → jsonb { routine, entries[], sets[] }
--   entries: routine_exercises with `exercise` joined inline
--   sets:    routine_exercise_sets across all entries, ordered by set_number
-- ---------------------------------------------------------------------------
create or replace function admin_routine_detail(target_routine_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  out_routine jsonb;
  out_entries jsonb;
  out_sets jsonb;
begin
  if not is_admin(auth.uid()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select to_jsonb(r) into out_routine
    from routines r
    where r.id = target_routine_id and r.deleted_at is null;

  select coalesce(
    jsonb_agg(
      to_jsonb(re) || jsonb_build_object('exercise', to_jsonb(e))
      order by re.position
    ),
    '[]'::jsonb
  ) into out_entries
  from routine_exercises re
  join exercises e on e.id = re.exercise_id
  where re.routine_id = target_routine_id and re.deleted_at is null;

  select coalesce(jsonb_agg(to_jsonb(s) order by s.set_number), '[]'::jsonb)
  into out_sets
  from routine_exercise_sets s
  where s.routine_exercise_id in (
    select id from routine_exercises
    where routine_id = target_routine_id and deleted_at is null
  ) and s.deleted_at is null;

  return jsonb_build_object(
    'routine', out_routine,
    'entries', out_entries,
    'sets', out_sets
  );
end;
$$;
revoke all on function admin_routine_detail(uuid) from public;
grant execute on function admin_routine_detail(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- admin_session_detail(session_id) → jsonb { session, sets[] }
--   sets: sets with `exercise` joined inline, ordered by set_number
-- ---------------------------------------------------------------------------
create or replace function admin_session_detail(target_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  out_session jsonb;
  out_sets jsonb;
begin
  if not is_admin(auth.uid()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select to_jsonb(s) into out_session
    from sessions s
    where s.id = target_session_id and s.deleted_at is null;

  select coalesce(
    jsonb_agg(
      to_jsonb(st) || jsonb_build_object('exercise', to_jsonb(e))
      order by st.set_number
    ),
    '[]'::jsonb
  ) into out_sets
  from sets st
  join exercises e on e.id = st.exercise_id
  where st.session_id = target_session_id and st.deleted_at is null;

  return jsonb_build_object(
    'session', out_session,
    'sets', out_sets
  );
end;
$$;
revoke all on function admin_session_detail(uuid) from public;
grant execute on function admin_session_detail(uuid) to authenticated;
