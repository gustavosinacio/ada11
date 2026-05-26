-- Migration: 0012_routine_exercises_unique_partial
-- Converts the (routine_id, position) unique index on routine_exercises
-- from a full unique index to a partial one filtered on deleted_at IS NULL.
--
-- The previous full index also covered soft-deleted rows. Combined with
-- src/api/routine-exercises.ts:addExerciseToRoutine, which computes the
-- next position from max(position) WHERE deleted_at IS NULL, any routine
-- with a previously soft-deleted exercise at the trailing position would
-- reject new inserts with 23505 / "duplicate key value violates unique
-- constraint routine_exercises_routine_position_uq".
--
-- Drop and recreate atomically. Strictly looser than the prior constraint
-- (the new partial allows duplicate positions only when at least one row
-- is soft-deleted), so it cannot introduce new violations.
--
-- Mirrors the convention from 0008_sets_unique_set_number.sql and
-- 0010_exercise_notes.sql, both of which use partial unique indexes on
-- WHERE deleted_at IS NULL.

drop index if exists "routine_exercises_routine_position_uq";

create unique index "routine_exercises_routine_position_uq"
  on routine_exercises (routine_id, position)
  where deleted_at is null;
