-- =============================================================================
-- 0007_set_completed_at_nullable.sql
-- Hand-written. Drops NOT NULL on sets.completed_at so the column can encode
-- per-set "checked" state in the live-workout screen:
--   completed_at IS NULL      → unchecked draft (live session only)
--   completed_at IS NOT NULL  → checked / persisted
--
-- All existing rows have non-null completed_at and remain "checked" — no
-- backfill needed. No RLS policy changes (gate on auth.uid() = user_id).
-- Index sets_exercise_completed_idx remains valid; btree indexes nulls.
-- =============================================================================

alter table public.sets alter column completed_at drop not null;
