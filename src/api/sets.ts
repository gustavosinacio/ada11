import { supabase } from "~/lib/supabase";
import type { SetRow, SetType } from "~/db/types";

export type LogSetInput = {
  session_id: string;
  exercise_id: string;
  set_type: SetType;
  parent_set_id?: string | null;
  reps?: number | null;
  weight?: string | null;
  rpe?: string | null;
  notes?: string | null;
};

export type UpdateSetInput = {
  reps?: number | null;
  weight?: string | null;
  rpe?: string | null;
  notes?: string | null;
};

export async function listSetsForSession(sessionId: string): Promise<SetRow[]> {
  const { data, error } = await supabase
    .from("sets")
    .select("*")
    .eq("session_id", sessionId)
    .is("deleted_at", null)
    .order("completed_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as SetRow[];
}

export async function logSet(input: LogSetInput): Promise<SetRow> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error("Not authenticated");

  // Compute next set_number for this (session, exercise).
  const { data: existing, error: numErr } = await supabase
    .from("sets")
    .select("set_number")
    .eq("session_id", input.session_id)
    .eq("exercise_id", input.exercise_id)
    .is("deleted_at", null)
    .order("set_number", { ascending: false })
    .limit(1);
  if (numErr) throw numErr;
  const nextNumber = (existing?.[0]?.set_number ?? 0) + 1;

  const { data, error } = await supabase
    .from("sets")
    .insert({
      user_id: userId,
      session_id: input.session_id,
      exercise_id: input.exercise_id,
      set_number: nextNumber,
      reps: input.reps ?? null,
      weight: input.weight ?? null,
      rpe: input.rpe ?? null,
      set_type: input.set_type,
      parent_set_id: input.parent_set_id ?? null,
      notes: input.notes ?? null,
      completed_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (error) throw error;
  return data as SetRow;
}

export async function updateSet(
  id: string,
  patch: UpdateSetInput,
): Promise<SetRow> {
  const { data, error } = await supabase
    .from("sets")
    .update({
      reps: patch.reps ?? null,
      weight: patch.weight ?? null,
      rpe: patch.rpe ?? null,
      notes: patch.notes ?? null,
    })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as SetRow;
}

export async function softDeleteSet(id: string): Promise<void> {
  const { error } = await supabase
    .from("sets")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}
