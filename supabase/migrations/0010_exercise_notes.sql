-- =============================================================================
-- 0010_exercise_notes.sql
-- Hand-written. Adds per-(user, exercise) private free-text notes.
--
-- The note is a personal cue attached to an exercise that lives independent of
-- any routine. One active row per (user_id, exercise_id) — enforced by a
-- partial UNIQUE index (excluding soft-deleted rows so re-create after delete
-- is unblocked, matching the measurement_entries_user_day_idx precedent from
-- 0005_measurements.sql).
--
-- Mirrors the 0005_measurements.sql shape:
--   1. Create the table with UUID id, FK cascade on user, FK RESTRICT on
--      exercise (matches routine_exercises.exercise_id + sets.exercise_id),
--      body text NOT NULL with a 2000-char CHECK (defense-in-depth — zod and
--      <Textarea maxLength> are layers 1+2; this is the DB layer), and the
--      standard timestamps triple.
--   2. Composite read index (user_id, exercise_id) — every read filters on
--      this pair.
--   3. UNIQUE partial index (user_id, exercise_id) WHERE deleted_at IS NULL
--      — one active note per pair, soft-deleted rows excluded.
--   4. Enable RLS + 4 inlined policies gated on auth.uid() = user_id.
--   5. Apply the existing touch_updated_at trigger (function exists since
--      0001).
-- =============================================================================

-- 1. exercise_notes table.
create table public.exercise_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  exercise_id uuid not null references public.exercises(id) on delete restrict,
  body text not null
    constraint exercise_notes_body_length_check check (char_length(body) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- 2. Composite read index — every read is gated by (user_id, exercise_id).
create index exercise_notes_user_exercise_idx
  on public.exercise_notes (user_id, exercise_id);

-- 3. UNIQUE partial index — one active note per (user, exercise). Soft-deleted
--    rows are excluded by the WHERE clause so re-create after delete is
--    unblocked (matches measurement_entries_user_day_idx semantics from 0005).
create unique index exercise_notes_user_exercise_active_uq
  on public.exercise_notes (user_id, exercise_id)
  where deleted_at is null;

-- 4. RLS — enable + 4 policies, gated on auth.uid() = user_id. Inlined as
--    four explicit statements (matches 0005_measurements.sql style).
alter table public.exercise_notes enable row level security;

drop policy if exists exercise_notes_select on public.exercise_notes;
create policy exercise_notes_select on public.exercise_notes
  for select using (auth.uid() = user_id);

drop policy if exists exercise_notes_insert on public.exercise_notes;
create policy exercise_notes_insert on public.exercise_notes
  for insert with check (auth.uid() = user_id);

drop policy if exists exercise_notes_update on public.exercise_notes;
create policy exercise_notes_update on public.exercise_notes
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists exercise_notes_delete on public.exercise_notes;
create policy exercise_notes_delete on public.exercise_notes
  for delete using (auth.uid() = user_id);

-- 5. touch_updated_at trigger — function already exists from 0001.
drop trigger if exists exercise_notes_touch_updated_at on public.exercise_notes;
create trigger exercise_notes_touch_updated_at
  before update on public.exercise_notes
  for each row execute function public.touch_updated_at();
