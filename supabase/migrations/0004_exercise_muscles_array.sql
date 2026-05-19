-- =============================================================================
-- 0004_exercise_muscles_array.sql
-- Hand-written. Replaces exercises.primary_muscle (free-text, nullable) with
-- exercises.muscles (text[], required, non-empty) backed by a fixed app-level
-- enum: Chest, Upper back, Lower back, Shoulders, Arms, Legs, Core.
-- =============================================================================

-- 1. Add the new column. NOT NULL with empty-array default so existing rows
--    survive the ALTER; we backfill below.
alter table public.exercises
  add column muscles text[] not null default '{}';

-- 2. Backfill from the legacy primary_muscle column.
--    Maps known seeded values; unknown user values become '{}' and surface as
--    "no muscles" in the UI so the user fixes them via the edit form.
update public.exercises
set muscles = case lower(primary_muscle)
  when 'chest'       then array['Chest']
  when 'back'        then array['Upper back']
  when 'upper back'  then array['Upper back']
  when 'lower back'  then array['Lower back']
  when 'shoulders'   then array['Shoulders']
  when 'biceps'      then array['Arms']
  when 'triceps'     then array['Arms']
  when 'forearms'    then array['Arms']
  when 'arms'        then array['Arms']
  when 'quadriceps'  then array['Legs']
  when 'quads'       then array['Legs']
  when 'hamstrings'  then array['Legs']
  when 'glutes'      then array['Legs']
  when 'calves'      then array['Legs']
  when 'legs'        then array['Legs']
  when 'core'        then array['Core']
  when 'abs'         then array['Core']
  else array[]::text[]
end
where primary_muscle is not null;

-- 3. Drop the legacy column.
alter table public.exercises drop column primary_muscle;

-- 4. Rewrite seed_new_user so future user signups insert into the new column.
create or replace function public.seed_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_preferences (user_id, weight_unit)
  values (new.id, 'kg')
  on conflict (user_id) do nothing;

  insert into public.exercises (user_id, name, muscles, equipment)
  values
    (new.id, 'Back Squat',          array['Legs'],         'barbell'),
    (new.id, 'Front Squat',         array['Legs'],         'barbell'),
    (new.id, 'Deadlift',            array['Legs', 'Lower back'], 'barbell'),
    (new.id, 'Romanian Deadlift',   array['Legs', 'Lower back'], 'barbell'),
    (new.id, 'Bench Press',         array['Chest'],        'barbell'),
    (new.id, 'Incline Bench Press', array['Chest'],        'barbell'),
    (new.id, 'Overhead Press',      array['Shoulders'],    'barbell'),
    (new.id, 'Barbell Row',         array['Upper back'],   'barbell'),
    (new.id, 'Pendlay Row',         array['Upper back'],   'barbell'),
    (new.id, 'Pull-up',             array['Upper back'],   'bodyweight'),
    (new.id, 'Chin-up',             array['Upper back', 'Arms'], 'bodyweight'),
    (new.id, 'Dip',                 array['Chest', 'Arms'],'bodyweight'),
    (new.id, 'Push-up',             array['Chest'],        'bodyweight'),
    (new.id, 'Lat Pulldown',        array['Upper back'],   'cable'),
    (new.id, 'Seated Cable Row',    array['Upper back'],   'cable'),
    (new.id, 'Face Pull',           array['Shoulders'],    'cable'),
    (new.id, 'Cable Tricep Pushdown', array['Arms'],       'cable'),
    (new.id, 'Bicep Curl',          array['Arms'],         'dumbbell'),
    (new.id, 'Hammer Curl',         array['Arms'],         'dumbbell'),
    (new.id, 'Lateral Raise',       array['Shoulders'],    'dumbbell'),
    (new.id, 'Rear Delt Fly',       array['Shoulders'],    'dumbbell'),
    (new.id, 'Dumbbell Bench Press',array['Chest'],        'dumbbell'),
    (new.id, 'Dumbbell Row',        array['Upper back'],   'dumbbell'),
    (new.id, 'Goblet Squat',        array['Legs'],         'dumbbell'),
    (new.id, 'Bulgarian Split Squat', array['Legs'],       'dumbbell'),
    (new.id, 'Leg Press',           array['Legs'],         'machine'),
    (new.id, 'Leg Curl',            array['Legs'],         'machine'),
    (new.id, 'Leg Extension',       array['Legs'],         'machine'),
    (new.id, 'Calf Raise',          array['Legs'],         'machine'),
    (new.id, 'Plank',               array['Core'],         'bodyweight'),
    (new.id, 'Hanging Leg Raise',   array['Core'],         'bodyweight');

  return new;
end;
$$;
