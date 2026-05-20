-- =============================================================================
-- 0005_measurements.sql
-- Hand-written. Adds body-measurement tracking.
--
-- Order of operations:
--   1. Add symmetric CHECK on user_preferences.weight_unit (v2 MIN-2).
--   2. Add user_preferences.length_unit text NOT NULL DEFAULT 'cm' (backfills
--      existing rows; future seed_new_user() INSERTs pick up the default
--      automatically — no rewrite of the seed function needed).
--   3. Add CHECK on length_unit.
--   4. Create measurement_entries (wide nullable numeric table) with FK to
--      auth.users + soft-delete timestamps.
--   5. Composite ASC index (user_id, measured_at) — PG scans it backwards for
--      ORDER BY measured_at DESC (matches sessions_user_started_idx precedent).
--   6. UNIQUE partial expression index enforcing one active row per user per
--      UTC calendar day. Soft-deleted rows do not block re-entry.
--   7. Enable RLS + 4 policies gated on auth.uid() = user_id.
--   8. Apply the existing touch_updated_at trigger to the new table.
-- =============================================================================

-- 1. Symmetric CHECK on the existing column (v2 MIN-2). Existing rows already
--    store 'kg' (seed default), so the constraint is satisfied; if any row
--    somehow held another value the ALTER aborts atomically.
alter table public.user_preferences
  add constraint user_preferences_weight_unit_check
  check (weight_unit in ('kg','lbs'));

-- 2. New length_unit column with default. Existing rows backfill with 'cm'
--    during the column-rewrite; seed_new_user() omits this column in its
--    INSERT, so new signups also receive 'cm' via the default.
alter table public.user_preferences
  add column length_unit text not null default 'cm';

-- 3. Symmetric CHECK on the new column.
alter table public.user_preferences
  add constraint user_preferences_length_unit_check
  check (length_unit in ('cm','in'));

-- 4. measurement_entries table.
create table public.measurement_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  measured_at timestamptz not null default now(),
  weight_kg     numeric(6,2),
  body_fat_pct  numeric(4,1),
  neck_cm       numeric(6,2),
  chest_cm      numeric(6,2),
  biceps_cm     numeric(6,2),
  forearm_cm    numeric(6,2),
  waist_cm      numeric(6,2),
  hips_cm       numeric(6,2),
  thigh_cm      numeric(6,2),
  calf_cm       numeric(6,2),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- 5. Plain ASC composite. Postgres reads it backwards for ORDER BY
--    measured_at DESC (matches sessions_user_started_idx precedent).
create index measurement_entries_user_measured_idx
  on public.measurement_entries (user_id, measured_at);

-- 6. UNIQUE partial expression index — one active row per user per UTC
--    calendar day. Soft-deleted rows are excluded by the WHERE clause so
--    re-entry after delete is unblocked.
create unique index measurement_entries_user_day_idx
  on public.measurement_entries (user_id, date(measured_at at time zone 'UTC'))
  where deleted_at is null;

-- 7. RLS — enable + 4 policies, gated on auth.uid() = user_id. Inlined as
--    four explicit statements (not a one-element loop) for clarity.
alter table public.measurement_entries enable row level security;

drop policy if exists measurement_entries_select on public.measurement_entries;
create policy measurement_entries_select on public.measurement_entries
  for select using (auth.uid() = user_id);

drop policy if exists measurement_entries_insert on public.measurement_entries;
create policy measurement_entries_insert on public.measurement_entries
  for insert with check (auth.uid() = user_id);

drop policy if exists measurement_entries_update on public.measurement_entries;
create policy measurement_entries_update on public.measurement_entries
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists measurement_entries_delete on public.measurement_entries;
create policy measurement_entries_delete on public.measurement_entries
  for delete using (auth.uid() = user_id);

-- 8. touch_updated_at trigger — function already exists from 0001.
drop trigger if exists measurement_entries_touch_updated_at on public.measurement_entries;
create trigger measurement_entries_touch_updated_at
  before update on public.measurement_entries
  for each row execute function public.touch_updated_at();
