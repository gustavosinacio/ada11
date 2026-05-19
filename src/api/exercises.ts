import { supabase } from "~/lib/supabase";
import type { ExerciseRow } from "~/db/types";

export type ExerciseInput = {
  name: string;
  primary_muscle?: string | null;
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

export async function createExercise(input: ExerciseInput): Promise<ExerciseRow> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("exercises")
    .insert({
      user_id: userId,
      name: input.name,
      primary_muscle: input.primary_muscle ?? null,
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
      primary_muscle: patch.primary_muscle ?? null,
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
