import { supabase } from "~/lib/supabase";
import type { UserExerciseFavoriteRow } from "~/db/types";

type SupabaseLikeError = {
  code?: string;
};

/**
 * Returns the current user's favorite exercise_ids.
 *
 * Returns `[]` when the caller is unauthenticated (no DB call). Mirrors the
 * auth-gate shape in `src/api/exercise-notes.ts:14-16`.
 */
export async function listMyFavoriteExerciseIds(): Promise<string[]> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) return [];

  const { data, error } = await supabase
    .from("user_exercise_favorites")
    .select("exercise_id")
    .eq("user_id", userId);
  if (error) throw error;
  return ((data as Pick<UserExerciseFavoriteRow, "exercise_id">[] | null) ?? []).map(
    (r) => r.exercise_id,
  );
}

/**
 * Idempotent favorite. Plain INSERT against the (user_id, exercise_id)
 * composite PK.
 *
 * A favorite is presence/absence against a NON-partial composite PK, so the
 * partial-UNIQUE 42P10 trap that forces `exercise-notes.ts`'s read-then-write
 * loop does NOT apply here. We INSERT and SWALLOW SQLSTATE 23505 (PK dup =
 * already favorited) as success — idempotent. Any other error re-throws.
 * Matches the explicit INSERT + SQLSTATE discriminator precedent at
 * `src/api/measurements.ts:121-159`.
 */
export async function addFavorite(exerciseId: string): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error("Not authenticated");

  const { error } = await supabase
    .from("user_exercise_favorites")
    .insert({ user_id: userId, exercise_id: exerciseId });
  // 23505 = composite PK dup = already favorited → idempotent no-op.
  if (error && (error as SupabaseLikeError).code !== "23505") throw error;
}

/**
 * Removes the favorite. No-op if absent (DELETE affects 0 rows, no error).
 */
export async function removeFavorite(exerciseId: string): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error("Not authenticated");

  const { error } = await supabase
    .from("user_exercise_favorites")
    .delete()
    .eq("user_id", userId)
    .eq("exercise_id", exerciseId);
  if (error) throw error;
}
