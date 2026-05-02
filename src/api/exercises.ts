import { supabase } from "~/lib/supabase";
import type { Exercise, NewExercise } from "~/db/types";

export async function listExercises(): Promise<Exercise[]> {
  const { data, error } = await supabase
    .from("exercises")
    .select("*")
    .is("deleted_at", null)
    .order("name");
  if (error) throw error;
  return (data ?? []) as Exercise[];
}

export async function createExercise(input: Omit<NewExercise, "userId">): Promise<Exercise> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("exercises")
    .insert({ ...input, user_id: userId })
    .select()
    .single();
  if (error) throw error;
  return data as Exercise;
}
