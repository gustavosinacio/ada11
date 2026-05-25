import { supabase } from "~/lib/supabase";
import type { ExerciseNoteRow } from "~/db/types";

/**
 * Read the current user's note for `exerciseId`.
 *
 * Returns `null` when the caller is unauthenticated OR when no active row
 * exists for the (user, exercise) pair. Mirrors the `getMyPreferences` shape
 * in `src/api/preferences.ts:14-27`.
 */
export async function getMyExerciseNote(
  exerciseId: string,
): Promise<ExerciseNoteRow | null> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) return null;

  const { data, error } = await supabase
    .from("exercise_notes")
    .select("*")
    .eq("user_id", userId)
    .eq("exercise_id", exerciseId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return (data as ExerciseNoteRow | null) ?? null;
}

type SupabaseLikeError = {
  code?: string;
};

/**
 * Read-then-write upsert for the (current user, exerciseId) note.
 *
 * PostgREST `.upsert()` is intentionally avoided: `ON CONFLICT (cols)` cannot
 * infer a *partial* unique index without a `WHERE` predicate, and PostgREST's
 * `onConflict` parameter does not forward predicates — so an
 * `.upsert(..., { onConflict: "user_id,exercise_id" })` call against this
 * table's partial UNIQUE index fails deterministically with PostgreSQL
 * `42P10: there is no unique or exclusion constraint matching the ON CONFLICT
 * specification`. The pattern below matches the explicit INSERT + SQLSTATE
 * 23505 discriminator precedent at src/api/measurements.ts:121-159.
 *
 * Race semantics: between SELECT and INSERT, a concurrent writer (another
 * tab / device for the same user) may insert a row first. The INSERT then
 * trips the partial UNIQUE index → 23505. We loop once — the next iteration's
 * SELECT finds the active row and routes to UPDATE. After at most one retry
 * the loop terminates: either UPDATE returns the row, or the second INSERT
 * succeeds (the racer's row was rolled back), or we surface the error.
 */
export async function upsertMyExerciseNote(
  exerciseId: string,
  body: string,
): Promise<ExerciseNoteRow> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error("Not authenticated");

  let lastInsertError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data: existing, error: selErr } = await supabase
      .from("exercise_notes")
      .select("*")
      .eq("user_id", userId)
      .eq("exercise_id", exerciseId)
      .is("deleted_at", null)
      .maybeSingle();
    if (selErr) throw selErr;

    if (existing) {
      const { data, error } = await supabase
        .from("exercise_notes")
        .update({ body })
        .eq("id", (existing as ExerciseNoteRow).id)
        .select()
        .single();
      if (error) throw error;
      return data as ExerciseNoteRow;
    }

    const { data, error } = await supabase
      .from("exercise_notes")
      .insert({ user_id: userId, exercise_id: exerciseId, body })
      .select()
      .single();
    if (!error) return data as ExerciseNoteRow;

    // Concurrent writer created the row between our SELECT and INSERT.
    // Loop once — the next iteration's SELECT will find the racer's row and
    // route to UPDATE. Any non-23505 error surfaces immediately.
    if ((error as SupabaseLikeError).code !== "23505") {
      throw error;
    }
    lastInsertError = error;
  }

  // Defensive: both attempts hit 23505 without UPDATE resolving (shouldn't
  // happen — after a racer's INSERT lands, our next SELECT must see it). If
  // it does, surface the last INSERT error rather than loop forever.
  throw lastInsertError ?? new Error("upsertMyExerciseNote: unexpected loop exit");
}
