-- =============================================================================
-- 0009_max_volume_window.sql
-- Hand-written. Adds a per-user "max-volume window" preference that controls
-- whether the Progress page, exercise PR detection, and live volume-target
-- compute "max" over the user's full lifetime (the existing default) or only
-- the trailing N most-recent ISO weeks.
--
-- Encoding:
--   max_volume_window_weeks = 0  ⇒ lifetime (preserves current behaviour)
--   max_volume_window_weeks = 10 ⇒ trailing 10 ISO weeks
--   max_volume_window_weeks = 20 ⇒ trailing 20 ISO weeks
--   max_volume_window_weeks = 30 ⇒ trailing 30 ISO weeks
--
-- Order of operations (mirrors 0005_measurements.sql §1-§3):
--   1. Add column with DEFAULT 0 — existing rows backfill with 0 (lifetime)
--      during the column-rewrite, so behaviour is unchanged for every user
--      until they opt in via the Profile screen.
--   2. Add CHECK constraint enforcing the IN-list — rejects malformed writes
--      (e.g. 7, 12) at the DB layer regardless of client validation.
--
-- Seed function (`seed_new_user()` in 0001_rls_and_seed.sql) is NOT rewritten
-- here — it omits the column and the DEFAULT applies for new signups, matching
-- the precedent set by `length_unit` (0005_measurements.sql:8-10).
--
-- RLS unchanged: the existing `auth.uid() = user_id` policies on
-- `user_preferences` cover the new column uniformly.
-- =============================================================================

-- 1. New column with default. Existing rows backfill to 0 (lifetime).
alter table public.user_preferences
  add column max_volume_window_weeks integer not null default 0;

-- 2. CHECK constraint pinning the allowed IN-list. The integer encoding is
--    naturally orderable and matches the "X weeks" framing — see
--    `design-v2.md` Alternatives #9-#10 for the rationale.
alter table public.user_preferences
  add constraint user_preferences_max_volume_window_weeks_check
  check (max_volume_window_weeks in (0, 10, 20, 30));
