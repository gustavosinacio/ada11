-- Migration: 0018_admin_edit_exercises
-- Lets admins edit canonical (built-in catalog) exercises from the app.
--
-- Background: 0011 made `exercises` a shared catalog — canonical rows have
-- `user_id IS NULL` and the `exercises_update` policy only allows
-- `auth.uid() = user_id`, so canonical rows are app-immutable for everyone
-- (the 0011 comment expected admin edits to happen via the service role).
-- 0016 added admin SELECT policies but no admin write policy.
--
-- This adds an ADDITIVE permissive UPDATE policy gated by is_admin(auth.uid()).
-- Postgres OR-combines permissive policies, so:
--   - non-admins are unaffected (is_admin = false -> this policy is a no-op;
--     the existing self-update policy still governs their own rows, and
--     canonical rows stay immutable for them)
--   - admins may UPDATE any exercise row, including canonical (user_id IS NULL)
-- Mirrors the admin SELECT policies added in 0016.
--
-- Note: soft-delete is also an UPDATE (sets deleted_at), so this policy also
-- enables admins to soft-delete any exercise at the DB layer. The app hides
-- the Delete affordance on canonical rows; this is the only intended write
-- surface for the catalog.

drop policy if exists "Admins update all exercises" on public.exercises;
create policy "Admins update all exercises"
  on public.exercises for update to authenticated
  using (is_admin(auth.uid()))
  with check (is_admin(auth.uid()));
