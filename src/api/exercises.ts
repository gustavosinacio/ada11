import { supabase } from "~/lib/supabase";
import type { ExerciseRow } from "~/db/types";

export type ExerciseInput = {
  name: string;
  muscles: string[];
  equipment?: string | null;
  notes?: string | null;
};

export async function listExercises(): Promise<ExerciseRow[]> {
  const { data, error } = await supabase
    .from("exercises")
    .select("*")
    .is("deleted_at", null)
    .order("name");
  if (error) throw error;
  return (data ?? []) as ExerciseRow[];
}

export async function getExercise(id: string): Promise<ExerciseRow> {
  const { data, error } = await supabase
    .from("exercises")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .single();
  if (error) throw error;
  return data as ExerciseRow;
}

// Sibling of `listExercises` that intentionally returns soft-deleted rows too.
// History / per-exercise progress surfaces use this so old sessions don't
// silently drop blocks for exercises that were deleted from the library.
// The picker + Exercises library list keep using `listExercises` (filtered).
export async function listAllExercises(): Promise<ExerciseRow[]> {
  const { data, error } = await supabase
    .from("exercises")
    .select("*")
    // intentionally NO .is("deleted_at", null) — includes soft-deleted rows
    .order("name");
  if (error) throw error;
  return (data ?? []) as ExerciseRow[];
}

// Sibling of `getExercise` that intentionally resolves soft-deleted rows too.
// Used by the per-exercise progress screen so the header title still renders
// the exercise name when navigating to a deleted exercise's progress chart.
export async function getAnyExercise(id: string): Promise<ExerciseRow> {
  const { data, error } = await supabase
    .from("exercises")
    .select("*")
    .eq("id", id)
    // intentionally NO .is("deleted_at", null)
    .single();
  if (error) throw error;
  return data as ExerciseRow;
}

export async function createExercise(input: ExerciseInput): Promise<ExerciseRow> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("exercises")
    .insert({
      user_id: userId,
      name: input.name,
      muscles: input.muscles,
      equipment: input.equipment ?? null,
      notes: input.notes ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data as ExerciseRow;
}

export async function updateExercise(
  id: string,
  patch: ExerciseInput,
): Promise<ExerciseRow> {
  const { data, error } = await supabase
    .from("exercises")
    .update({
      name: patch.name,
      muscles: patch.muscles,
      equipment: patch.equipment ?? null,
      notes: patch.notes ?? null,
    })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as ExerciseRow;
}

export async function softDeleteExercise(id: string): Promise<void> {
  const { error } = await supabase
    .from("exercises")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}
