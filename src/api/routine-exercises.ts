import { supabase } from "~/lib/supabase";
import type { ExerciseRow, RoutineExerciseRow } from "~/db/types";

export type RoutineExerciseEntry = RoutineExerciseRow & { exercise: ExerciseRow };

export type RoutineExerciseTargets = {
  target_sets?: number | null;
  target_reps?: number | null;
  target_weight?: string | null;
  target_rest_seconds?: number | null;
  notes?: string | null;
};

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
      target_sets: input.targets?.target_sets ?? null,
      target_reps: input.targets?.target_reps ?? null,
      target_weight: input.targets?.target_weight ?? null,
      target_rest_seconds: input.targets?.target_rest_seconds ?? null,
      notes: input.targets?.notes ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data as RoutineExerciseRow;
}

export async function updateRoutineExercise(
  id: string,
  patch: RoutineExerciseTargets,
): Promise<RoutineExerciseRow> {
  const { data, error } = await supabase
    .from("routine_exercises")
    .update({
      target_sets: patch.target_sets ?? null,
      target_reps: patch.target_reps ?? null,
      target_weight: patch.target_weight ?? null,
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
