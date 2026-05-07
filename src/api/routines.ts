import { supabase } from "~/lib/supabase";
import type { RoutineRow } from "~/db/types";

export type RoutineInput = {
  name: string;
  notes?: string | null;
};

export async function listRoutines(): Promise<RoutineRow[]> {
  const { data, error } = await supabase
    .from("routines")
    .select("*")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as RoutineRow[];
}

export async function getRoutine(id: string): Promise<RoutineRow> {
  const { data, error } = await supabase
    .from("routines")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .single();
  if (error) throw error;
  return data as RoutineRow;
}

export async function createRoutine(input: RoutineInput): Promise<RoutineRow> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("routines")
    .insert({
      user_id: userId,
      name: input.name,
      notes: input.notes ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data as RoutineRow;
}

export async function updateRoutine(
  id: string,
  patch: RoutineInput,
): Promise<RoutineRow> {
  const { data, error } = await supabase
    .from("routines")
    .update({
      name: patch.name,
      notes: patch.notes ?? null,
    })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as RoutineRow;
}

export async function softDeleteRoutine(id: string): Promise<void> {
  const { error } = await supabase
    .from("routines")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}
