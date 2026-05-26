-- Migration: 0014_backfill_exercise_muscles
-- Many canonical exercises (user_id IS NULL) shipped via 0011_canonical_exercises
-- without `muscles` populated. 54 canonical exercises currently render the
-- empty body-part badge in the picker and exercise list. This migration
-- backfills all 54 from common gym-knowledge muscle-group classification.
--
-- Vocabulary (matches the existing 7 distinct values across the catalog):
--   Arms, Chest, Core, Legs, Lower back, Shoulders, Upper back.
--
-- Also normalises `equipment` case (the catalog has "Cable" vs "cable",
-- "Dumbbell" vs "dumbbell", "Machine" vs "machine" — folding to lowercase
-- gives the picker a single canonical token to display).
--
-- Targets:
--   - WHERE deleted_at IS NULL (skip tombstones — out-of-scope per spec).
--   - WHERE user_id IS NULL    (canonical only — user-owned rows aren't
--     touched; the upstream investigation found ZERO user-owned exercises
--     with empty muscles, so this filter is just defense-in-depth).
--   - WHERE muscles = '{}'::text[] OR muscles IS NULL (only touch the rows
--     that actually need it — idempotent if re-run).
--
-- Idempotent across re-runs: each UPDATE includes the muscle-already-empty
-- predicate so the second run is a no-op.

-- Equipment case normalisation (8 → 5 canonical values).
update exercises
  set equipment = lower(equipment)
  where deleted_at is null
    and user_id is null
    and equipment is not null
    and equipment <> lower(equipment);

-- Muscle backfill. Single UPDATE per (exercise, muscle-tuple) combination,
-- gated on muscles being currently empty so the migration is idempotent.
update exercises set muscles = array['Shoulders']::text[]
  where deleted_at is null and user_id is null and (muscles is null or muscles = '{}'::text[])
    and name in (
      'Dumbbell Shoulder Press (Seated)',
      'Upright Row (Barbell)',
      'Arnold Press (Dumbbell)',
      'Upright Row (Cable)',
      'Front Raise (Cable)',
      'Lateral Raise (Dumbbell)',
      'Overhead Press (Dumbbell)',
      'Reverse Rotator Cuff (Manguito Invertido)',
      'Rotator Cuff (Manguito)',
      'Shoulder Press (Machine)',
      'Upright Row (Dumbbell)'
    );

update exercises set muscles = array['Chest']::text[]
  where deleted_at is null and user_id is null and (muscles is null or muscles = '{}'::text[])
    and name in (
      'Chest Press (Machine)',
      'Cable Crossover',
      'Cable Fly (Lower Upward)',
      'Chest Fly, Incline',
      'Bench Press, Incline (Dumbbell)'
    );

update exercises set muscles = array['Chest','Upper back']::text[]
  where deleted_at is null and user_id is null and (muscles is null or muscles = '{}'::text[])
    and name in (
      'Pullover (Cable)',
      'Pullover (Dumbbell)'
    );

update exercises set muscles = array['Chest','Arms']::text[]
  where deleted_at is null and user_id is null and (muscles is null or muscles = '{}'::text[])
    and name in (
      'Chest Dip',
      'Chest Dip (Machine)'
    );

update exercises set muscles = array['Arms']::text[]
  where deleted_at is null and user_id is null and (muscles is null or muscles = '{}'::text[])
    and name in (
      'Bicep Curl (Cable)',
      'Concentration Curl (Dumbbell)',
      'Forearm Curl (Cable)',
      'Hammer Curl (Cable)',
      'Preacher Curl (Barbell)',
      'Reverse Curl (Barbell)',
      'Skullcrusher (Barbell)',
      'Triceps Extension (Cable)',
      'Triceps Extension (Dumbbell)'
    );

update exercises set muscles = array['Core']::text[]
  where deleted_at is null and user_id is null and (muscles is null or muscles = '{}'::text[])
    and name in (
      'Crunch',
      'Crunch (Machine)',
      'Crunch/Leg Raise',
      'Decline Crunch',
      'Hanging Knee Raise'
    );

update exercises set muscles = array['Legs']::text[]
  where deleted_at is null and user_id is null and (muscles is null or muscles = '{}'::text[])
    and name in (
      'Calf Press on Leg Press',
      'Calf Press on Seated Leg Press',
      'Hip Abductor (Machine)',
      'Hip Adductor (Machine)',
      'Hip Thrust (Barbell)',
      'Lunge (Dumbbell)',
      'Seated Calf Raise (Plate Loaded)',
      'Seated Leg Press (Machine)',
      'Standing Calf Raise (Smith Machine)'
    );

update exercises set muscles = array['Lower back']::text[]
  where deleted_at is null and user_id is null and (muscles is null or muscles = '{}'::text[])
    and name = 'Back Extension';

update exercises set muscles = array['Lower back','Legs']::text[]
  where deleted_at is null and user_id is null and (muscles is null or muscles = '{}'::text[])
    and name = 'Good Morning (Barbell)';

update exercises set muscles = array['Upper back']::text[]
  where deleted_at is null and user_id is null and (muscles is null or muscles = '{}'::text[])
    and name in (
      'Lat Pulldown (Machine)',
      'Shrug (Barbell)',
      'Shrug (Dumbbell)',
      'Shrug (Smith Machine)',
      'Row, Incline (Dumbbell)'
    );

update exercises set muscles = array['Upper back','Arms']::text[]
  where deleted_at is null and user_id is null and (muscles is null or muscles = '{}'::text[])
    and name = 'Pull Up';

update exercises set muscles = array['Shoulders','Upper back']::text[]
  where deleted_at is null and user_id is null and (muscles is null or muscles = '{}'::text[])
    and name in (
      'Reverse Fly (Cable)',
      'Reverse Fly (Dumbbell)',
      'Reverse Fly (Machine)'
    );
