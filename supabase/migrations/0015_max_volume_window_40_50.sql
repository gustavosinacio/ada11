-- Migration: 0015_max_volume_window_40_50
-- Extends the user_preferences.max_volume_window_weeks CHECK constraint
-- to accept 40 and 50 in addition to the existing 0 / 10 / 20 / 30.
-- See 0009_max_volume_window.sql for original constraint + semantics.

alter table user_preferences
  drop constraint if exists user_preferences_max_volume_window_weeks_check;

alter table user_preferences
  add constraint user_preferences_max_volume_window_weeks_check
  check (max_volume_window_weeks in (0, 10, 20, 30, 40, 50));
