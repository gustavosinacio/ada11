import { supabase } from "~/lib/supabase";
import type { ExerciseRow, RoutineExerciseRow } from "~/db/types";

export type RoutineExerciseEntry = RoutineExerciseRow & { exercise: ExerciseRow };

/**
 * Patch shape for `updateRoutineExercise`. Post-0013 the per-set targets
 * (`target_sets`, `target_reps`, `target_weight`) moved to
 * `routine_exercise_sets`; only the per-exercise fields survive here.
 */
export type RoutineExerciseTargets = {
  target_rest_seconds?: number | null;
  notes?: string | null;
};

type SupabaseLikeError = {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
};

/**
 * Thrown by `addExerciseToRoutine` when the new `(routine_id, exercise_id)`
 * partial-unique (`routine_exercises_routine_exercise_uq`, migration 0013)
 * rejects an insert. The picker UI already filters duplicates via
 * `excludeIds`, so the typed error is defense-in-depth against
 * soft-delete-then-readd races and admin-seed paths.
 *
 * Follows the typed-23505 discriminator precedent at
 * `src/api/measurements.ts:50` and `src/api/exercise-notes.ts:91-92`.
 * `addExerciseToRoutine` did not previously decode 23505 errors; the
 * physical `(routine_id, position)` unique was caught only at the DB
 * boundary and surfaced as a raw 23505 toast.
 */
export class DuplicateRoutineExerciseError extends Error {
  readonly code = "ROUTINE_EXERCISE_DUPLICATE" as const;
  constructor() {
    super("Exercise already in routine");
    this.name = "DuplicateRoutineExerciseError";
  }
}

function isDuplicateRoutineExerciseConstraint(err: SupabaseLikeError): boolean {
  if (err.code !== "23505") return false;
  const haystack = `${err.message ?? ""} ${err.details ?? ""}`;
  return haystack.includes("routine_exercises_routine_exercise_uq");
}

export async function listRoutineExercises(
  routineId: string,
): Promise<RoutineExerciseEntry[]> {
  const { data, error } = await supabase
    .from("routine_exercises")
    .select("*, exercise:exercises(*)")
    .eq("routine_id", routineId)
    .is("deleted_at", null)
    .order("position", { ascending: true });
  if (error) throw error;
  return (data ?? []) as RoutineExerciseEntry[];
}

export async function addExerciseToRoutine(input: {
  routineId: string;
  exerciseId: string;
  targets?: RoutineExerciseTargets;
}): Promise<RoutineExerciseRow> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error("Not authenticated");

  // Compute next position: max(position) + 1.
  const { data: existing, error: posErr } = await supabase
    .from("routine_exercises")
    .select("position")
    .eq("routine_id", input.routineId)
    .is("deleted_at", null)
    .order("position", { ascending: false })
    .limit(1);
  if (posErr) throw posErr;
  const nextPosition = (existing?.[0]?.position ?? -1) + 1;

  const { data, error } = await supabase
    .from("routine_exercises")
    .insert({
      user_id: userId,
      routine_id: input.routineId,
      exercise_id: input.exerciseId,
      position: nextPosition,
      target_rest_seconds: input.targets?.target_rest_seconds ?? null,
      notes: input.targets?.notes ?? null,
    })
    .select()
    .single();
  if (error) {
    if (isDuplicateRoutineExerciseConstraint(error)) {
      throw new DuplicateRoutineExerciseError();
    }
    throw error;
  }
  return data as RoutineExerciseRow;
}

export async function updateRoutineExercise(
  id: string,
  patch: RoutineExerciseTargets,
): Promise<RoutineExerciseRow> {
  const { data, error } = await supabase
    .from("routine_exercises")
    .update({
      target_rest_seconds: patch.target_rest_seconds ?? null,
      notes: patch.notes ?? null,
    })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as RoutineExerciseRow;
}

export async function removeExerciseFromRoutine(id: string): Promise<void> {
  const { error } = await supabase
    .from("routine_exercises")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

/**
 * Reorders entries to match the given id order. Uses a two-step swap to avoid
 * tripping the (routine_id, position) unique index: stage all rows to negative
 * temp positions first, then write final positions.
 */
export async function reorderRoutineExercises(
  routineId: string,
  orderedIds: string[],
): Promise<void> {
  // Step 1: park each row at -(idx + 1) so no two rows collide on the unique idx.
  for (let i = 0; i < orderedIds.length; i++) {
    const id = orderedIds[i]!;
    const { error } = await supabase
      .from("routine_exercises")
      .update({ position: -(i + 1) })
      .eq("id", id)
      .eq("routine_id", routineId);
    if (error) throw error;
  }
  // Step 2: write final positions.
  for (let i = 0; i < orderedIds.length; i++) {
    const id = orderedIds[i]!;
    const { error } = await supabase
      .from("routine_exercises")
      .update({ position: i })
      .eq("id", id)
      .eq("routine_id", routineId);
    if (error) throw error;
  }
}
