-- Migration: 0016_admin
-- Adds read-only admin access for a hand-picked set of users.
--
-- Surface:
--   - `admins` table — one row per admin (user_id PK, references auth.users).
--   - `is_admin(uid)` SECURITY DEFINER STABLE helper — true iff `uid` is in
--     `admins`. Granted to `authenticated`.
--   - `admin_list_users()` SECURITY DEFINER STABLE function returning a
--     read-only projection of `auth.users` (id, email, created_at,
--     last_sign_in_at). Raises 42501 when caller is not admin.
--   - Per-table SELECT-only admin RLS policies on every table that holds
--     user data. ADDITIVE (Postgres OR-combines policies), so the existing
--     `auth.uid() = user_id` self-read policy is untouched.
--
-- New admins are added by hand: INSERT INTO admins (user_id) VALUES (...).
-- No application-level UI for admin management (per spec).
--
-- Defense-in-depth: client UI gates on `useIsAdmin()`, but the RLS arms +
-- function guards are the authoritative check. A non-admin who somehow
-- routes to /admin gets empty results, not unauthorized data.

-- 1) admins table
create table admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table admins enable row level security;

-- Self-read only: a user can confirm whether they themselves are an admin,
-- but cannot enumerate the admin set. No INSERT/UPDATE/DELETE policies —
-- only the service role (via SQL migrations) writes here.
create policy "Read own admin row" on admins
  for select using (auth.uid() = user_id);

-- 2) is_admin(uid) helper. SECURITY DEFINER lets it read `admins` ignoring
-- the calling user's RLS (so the self-read constraint on `admins` doesn't
-- prevent the function from confirming OTHER users are admins).
-- `set search_path = public` prevents search-path-injection attacks.
create or replace function is_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(select 1 from admins where user_id = uid);
$$;

revoke all on function is_admin(uuid) from public;
grant execute on function is_admin(uuid) to authenticated;

-- 3) Additive admin SELECT policies on every user-data table. The existing
-- `auth.uid() = user_id` self-read policies stay in place; Postgres
-- combines policies with OR, so admins see ALL rows while non-admins
-- still only see their own.
create policy "Admins read all sessions"
  on sessions for select to authenticated
  using (is_admin(auth.uid()));

create policy "Admins read all sets"
  on sets for select to authenticated
  using (is_admin(auth.uid()));

create policy "Admins read all routines"
  on routines for select to authenticated
  using (is_admin(auth.uid()));

create policy "Admins read all routine_exercises"
  on routine_exercises for select to authenticated
  using (is_admin(auth.uid()));

create policy "Admins read all routine_exercise_sets"
  on routine_exercise_sets for select to authenticated
  using (is_admin(auth.uid()));

create policy "Admins read all exercise_notes"
  on exercise_notes for select to authenticated
  using (is_admin(auth.uid()));

create policy "Admins read all measurement_entries"
  on measurement_entries for select to authenticated
  using (is_admin(auth.uid()));

create policy "Admins read all user_preferences"
  on user_preferences for select to authenticated
  using (is_admin(auth.uid()));

-- `exercises` is already widened (0011 canonical) to allow
-- `user_id IS NULL OR auth.uid() = user_id`. Admins additionally need to
-- see user-owned exercises — add a third arm.
create policy "Admins read all exercises"
  on exercises for select to authenticated
  using (is_admin(auth.uid()));

-- 4) admin_list_users() — projects auth.users for the admin page's user
-- picker. SECURITY DEFINER required because auth.users is admin-only at
-- the RLS layer for non-service callers.
create or replace function admin_list_users()
returns table (
  id uuid,
  email text,
  created_at timestamptz,
  last_sign_in_at timestamptz
)
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
    select u.id, u.email::text, u.created_at, u.last_sign_in_at
    from auth.users u
    order by u.created_at desc;
end;
$$;

revoke all on function admin_list_users() from public;
grant execute on function admin_list_users() to authenticated;

-- 5) Seed the first admin (gsinacio94@gmail.com).
insert into admins (user_id)
  values ('0b2dfe22-2d30-41eb-bede-d7a42bc3651c')
  on conflict (user_id) do nothing;
