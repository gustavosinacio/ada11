-- =============================================================================
-- 0013_routine_exercise_sets.sql
-- Hand-written. Per-set normalization for routines.
--
-- Order of operations (single transaction):
--   1. Create routine_exercise_sets (UUID, FKs, set fields, soft-delete cols).
--   2. Composite read index (routine_exercise_id, set_number).
--   3. Partial UNIQUE (routine_exercise_id, set_number) WHERE deleted_at IS NULL.
--   4. Enable RLS + 4 inlined policies gated on auth.uid() = user_id.
--   5. touch_updated_at trigger.
--   6. NEW: Partial UNIQUE on routine_exercises(routine_id, exercise_id)
--      WHERE deleted_at IS NULL. Enforces one routine_exercise per (routine,
--      exercise) on the active plane, which the seed's natural-key relies on.
--   7. Backfill: one row per existing target_sets unit.
--   8. ALTER TABLE routine_exercises DROP COLUMN target_sets, target_reps,
--      target_weight. KEEP target_rest_seconds + notes.
-- =============================================================================

-- 1. Table.
create table public.routine_exercise_sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  routine_exercise_id uuid not null
    references public.routine_exercises(id) on delete cascade,
  set_number integer not null,
  set_type text not null,
  target_reps integer,
  target_weight numeric(6,2),
  parent_set_id uuid,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint routine_exercise_sets_set_type_valid
    check (set_type in ('warmup','working','dropset')),
  constraint routine_exercise_sets_parent_matches_type
    check (
      (set_type = 'dropset' and parent_set_id is not null)
      or (set_type in ('warmup','working') and parent_set_id is null)
    ),
  constraint routine_exercise_sets_parent_set_id_fk
    foreign key (parent_set_id)
    references public.routine_exercise_sets(id)
    on delete set null
);

-- 2. Composite read index.
create index routine_exercise_sets_routine_exercise_idx
  on public.routine_exercise_sets (routine_exercise_id, set_number);

-- 3. Partial UNIQUE on (routine_exercise_id, set_number) WHERE deleted_at IS NULL.
create unique index routine_exercise_sets_set_number_uq
  on public.routine_exercise_sets (routine_exercise_id, set_number)
  where deleted_at is null;

-- 4. RLS — enable + 4 explicit policies.
alter table public.routine_exercise_sets enable row level security;

drop policy if exists routine_exercise_sets_select on public.routine_exercise_sets;
create policy routine_exercise_sets_select on public.routine_exercise_sets
  for select using (auth.uid() = user_id);

drop policy if exists routine_exercise_sets_insert on public.routine_exercise_sets;
create policy routine_exercise_sets_insert on public.routine_exercise_sets
  for insert with check (auth.uid() = user_id);

drop policy if exists routine_exercise_sets_update on public.routine_exercise_sets;
create policy routine_exercise_sets_update on public.routine_exercise_sets
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists routine_exercise_sets_delete on public.routine_exercise_sets;
create policy routine_exercise_sets_delete on public.routine_exercise_sets
  for delete using (auth.uid() = user_id);

-- 5. touch_updated_at trigger.
drop trigger if exists routine_exercise_sets_touch_updated_at
  on public.routine_exercise_sets;
create trigger routine_exercise_sets_touch_updated_at
  before update on public.routine_exercise_sets
  for each row execute function public.touch_updated_at();

-- 6. NEW partial UNIQUE on routine_exercises(routine_id, exercise_id)
--    WHERE deleted_at IS NULL.
--    Rationale: the bulk seed's per-exercise natural-key (exercise_id,
--    set_number) requires that no two non-deleted routine_exercises rows
--    share an exercise_id within the same routine. The picker UI already
--    filters duplicates (routine-add picker `excludeIds`), so this is
--    primarily a schema guarantee + defense-in-depth against soft-delete-
--    then-readd races and admin-seed paths. Mirrors the (routine_id, position)
--    partial-unique from 0012; soft-deleted rows are excluded so re-adding
--    an exercise after removing it stays legal.
create unique index routine_exercises_routine_exercise_uq
  on public.routine_exercises (routine_id, exercise_id)
  where deleted_at is null;

-- 7. Forward-only data backfill.
--    For every non-deleted routine_exercise with target_sets > 0, emit N rows
--    set_number 1..N, set_type='working', copying target_reps / target_weight
--    (nullable carries forward). NULL or zero target_sets → zero rows.
--
--    Pre-flight assumption: no existing routine has two non-deleted
--    routine_exercises rows for the same exercise_id (or step 6 would have
--    failed). If that fires in CI/production, the migration aborts atomically
--    and Designer/Implementer must hand-soft-delete the duplicate first.
insert into public.routine_exercise_sets
  (user_id, routine_exercise_id, set_number, set_type, target_reps, target_weight)
select
  re.user_id,
  re.id,
  gs.set_number,
  'working',
  re.target_reps,
  re.target_weight
from public.routine_exercises re
cross join lateral generate_series(1, coalesce(re.target_sets, 0)) as gs(set_number)
where re.deleted_at is null
  and coalesce(re.target_sets, 0) > 0;

-- 8. Drop the legacy columns. target_rest_seconds + notes survive.
alter table public.routine_exercises
  drop column target_sets,
  drop column target_reps,
  drop column target_weight;
