-- =============================================================================
-- 0011_canonical_exercises.sql
-- Hand-written. Single-file transaction (Supabase CLI wraps each migration in
-- BEGIN/COMMIT; apply via `npm run db:push`).
--
-- Converts public.exercises to a shared-catalog model:
--   - canonical rows have user_id IS NULL, visible to every authenticated user
--   - user-created rows keep user_id = auth.uid(), private as today
-- All 127 existing rows (owned by the only existing user) flip to canonical.
-- UUIDs preserved -> FKs from sets/routine_exercises/exercise_notes unaffected.
--
-- Mirrors 0004_exercise_muscles_array.sql's structural shape:
--   nullability change -> backfill UPDATE -> policy replace -> trigger rewrite.
-- =============================================================================

-- 1. Drop NOT NULL so canonical rows can exist.
alter table public.exercises alter column user_id drop not null;

-- 2. Flip every existing row to canonical. The single existing user owned all
--    127 rows; the seed library becomes the canonical catalog in place.
--    UUIDs preserved -> sets.exercise_id, routine_exercises.exercise_id,
--    exercise_notes.exercise_id continue to resolve unchanged.
update public.exercises set user_id = null;

-- 3. Replace the 4 exercises_* RLS policies. SELECT widens to allow canonical;
--    INSERT/UPDATE/DELETE stay scoped to auth.uid() = user_id so canonical
--    rows are app-immutable (service role bypasses RLS for admin edits).
drop policy if exists exercises_select on public.exercises;
create policy exercises_select on public.exercises
  for select using (user_id is null or auth.uid() = user_id);

drop policy if exists exercises_insert on public.exercises;
create policy exercises_insert on public.exercises
  for insert with check (auth.uid() = user_id);

drop policy if exists exercises_update on public.exercises;
create policy exercises_update on public.exercises
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists exercises_delete on public.exercises;
create policy exercises_delete on public.exercises
  for delete using (auth.uid() = user_id);

-- 4. Rewrite seed_new_user(): drop the per-user exercises insert (canonical
--    covers it via RLS). Keep the user_preferences insert.
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

  return new;
end;
$$;

-- 5. Drop the unused exercises_user_idx. With 127 rows + no client predicate
--    on user_id, the planner seq-scans regardless. YAGNI consistent with the
--    repo ethos (see docs/decisions.md). If user-owned-row volume ever climbs,
--    a future migration can introduce a partial index on (user_id) WHERE
--    user_id IS NOT NULL via the Drizzle "SQL is source of truth" precedent.
drop index if exists public.exercises_user_idx;
