-- =============================================================================
-- 0020_user_exercise_favorites.sql
-- Hand-written. Per-(user, exercise) favorite pointers. A favorite is
-- presence/absence — no body, no soft-delete, no mutable column. Used to pin
-- favorited exercises into the e1RM strength chart (union with the auto top-N).
--
-- Diverges from 0010_exercise_notes.sql:
--   - composite PK (user_id, exercise_id) instead of a uuid surrogate +
--     partial UNIQUE (no soft-delete → no WHERE deleted_at IS NULL predicate);
--   - FK exercise_id ON DELETE CASCADE (a favorite is a disposable pointer, not
--     authored content — if an exercise is ever hard-deleted the favorite
--     vanishes, it does not block. Notes used RESTRICT because a note IS
--     content. App soft-deletes exercises today (exercises.ts:99-105), so
--     neither fires in practice — CASCADE is the cleaner intent here);
--   - 3 RLS policies (SELECT/INSERT/DELETE) — no UPDATE (no mutable column);
--   - no touch_updated_at trigger (nothing to touch).
-- =============================================================================

create table public.user_exercise_favorites (
  user_id uuid not null references auth.users(id) on delete cascade,
  exercise_id uuid not null references public.exercises(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, exercise_id)
);
-- The composite PK gives the UNIQUE constraint AND the (user_id, exercise_id)
-- read index for free — no separate index needed (every read filters on user_id,
-- and the toggle filters on the full pair).

alter table public.user_exercise_favorites enable row level security;

drop policy if exists user_exercise_favorites_select on public.user_exercise_favorites;
create policy user_exercise_favorites_select on public.user_exercise_favorites
  for select using (auth.uid() = user_id);

drop policy if exists user_exercise_favorites_insert on public.user_exercise_favorites;
create policy user_exercise_favorites_insert on public.user_exercise_favorites
  for insert with check (auth.uid() = user_id);

drop policy if exists user_exercise_favorites_delete on public.user_exercise_favorites;
create policy user_exercise_favorites_delete on public.user_exercise_favorites
  for delete using (auth.uid() = user_id);
