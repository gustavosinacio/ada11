-- =============================================================================
-- 0019_session_exercise_order.sql
-- Hand-written. Persist the per-session EXERCISE display order:
--   1) snapshotted from the live workout screen when the user taps Finish, and
--   2) editable from the History detail EDIT page via up/down chevrons.
-- Fixes History reordering exercises vs the order shown during the live workout,
-- and lets a user re-sequence (and recover the order of) older sessions.
--
-- Storage: an ordered uuid[] of exercise_id on the sessions row. Nullable;
-- legacy/in-progress sessions stay NULL and the read-side falls back to a
-- deterministic first-occurrence order. No new RLS — inherits the existing
-- sessions policies (already gated on auth.uid() = user_id), which cover
-- both the SELECT (read in History) and the UPDATE (write on reorder/Finish).
-- =============================================================================

alter table public.sessions
  add column session_exercise_order uuid[];

-- Intentionally NO backfill: historical finished sessions never recorded the
-- order the user saw, so we cannot recover it automatically. They keep NULL and
-- render via the deterministic read-side fallback. A user can manually re-order
-- such a session in History EDIT mode, which writes the column for the first
-- time (the legacy-recovery path). See fix-plan "Legacy-session recovery flow".
