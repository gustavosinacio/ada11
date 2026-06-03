-- =============================================================================
-- 0021_bodyweight_factor.sql
-- Hand-written. Adds a per-exercise bodyweight leverage factor + backfills the
-- canonical bodyweight catalog. Mirrors 0011/0014's idempotent canonical-row
-- UPDATE shape (WHERE user_id IS NULL AND deleted_at IS NULL).
--
-- The factor scales ONLY the bodyweight component in effectiveWeightKg
-- (bw*factor + addedLoad); addedLoad (belt/vest) is never scaled. NULL ⇒ the
-- app coalesces to 1.0 (NEVER 0). The column is nullable with no default, so
-- every user-owned and non-bodyweight row stays NULL ⇒ 1.0 ⇒ byte-for-byte
-- today's numbers.
--
-- RETROACTIVE SHIFT (call-out): step 2 reclassifies Pull Up, Chest Dip, and
-- Hanging Knee Raise from equipment=NULL to equipment='bodyweight'. Today they
-- count ZERO bodyweight volume; after this migration every historical session
-- of those three gains bodyweight*factor*reps volume (same class of retroactive
-- change as Phase 0). This changes historical PRs/max-volume for those three,
-- and makes them APPEAR on per-muscle/strip/PR surfaces where they were absent.
-- =============================================================================

-- 1. Add the nullable column (no default → existing rows stay NULL ⇒ 1.0).
alter table public.exercises add column if not exists bodyweight_factor numeric;

-- 2. Reclassify the three mis-tagged bodyweight movements to count bodyweight.
update public.exercises set equipment = 'bodyweight'
  where user_id is null and deleted_at is null
    and name in ('Pull Up', 'Chest Dip', 'Hanging Knee Raise');

-- 3. Backfill the leverage factors on all seven canonical bodyweight rows.
--    Idempotent: re-running sets the same values. Matched by exact name on
--    canonical (user_id IS NULL), non-deleted rows.
update public.exercises set bodyweight_factor = 0.64
  where user_id is null and deleted_at is null and name = 'Push-up';
update public.exercises set bodyweight_factor = 1.0
  where user_id is null and deleted_at is null and name = 'Dip';
update public.exercises set bodyweight_factor = 1.0
  where user_id is null and deleted_at is null and name = 'Chin-up';
update public.exercises set bodyweight_factor = 1.0
  where user_id is null and deleted_at is null and name = 'Pull Up';
update public.exercises set bodyweight_factor = 1.0
  where user_id is null and deleted_at is null and name = 'Chest Dip';
update public.exercises set bodyweight_factor = 0.50
  where user_id is null and deleted_at is null and name = 'Hanging Leg Raise';
update public.exercises set bodyweight_factor = 0.50
  where user_id is null and deleted_at is null and name = 'Hanging Knee Raise';
