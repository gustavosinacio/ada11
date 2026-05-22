-- Migration: 0008_sets_unique_set_number
-- Adds a partial unique index on (session_id, exercise_id, set_number) for
-- non-deleted sets. The UI relies on this uniqueness for ordering rows in
-- history detail, the "Anterior" placeholder, and the per-exercise progress
-- screen — but the constraint was implicit until now. The Strong CSV import
-- (scripts/import-strong.ts, now removed) silently produced 1,118 duplicate
-- rows across 356 (session, exercise) groups because its parseInt fallback
-- assigned set_number=1 to any row with a non-numeric Set Order ("D"
-- dropsets, "A" alternates, "F" failure sets). Backfill was performed by
-- scripts/backfill-strong-setnumber.ts (also removed) on 2026-05-21.
--
-- This index makes any future regression of that class trip at the DB layer
-- instead of silently corrupting set numbering.

create unique index if not exists sets_session_exercise_set_number_unique
  on sets (session_id, exercise_id, set_number)
  where deleted_at is null;
