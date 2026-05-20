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

/**
 * Most recent completed working/dropset for the given exercise across any
 * finished past session. Used to seed placeholders for new sets so the user
 * sees their last actual numbers when starting an exercise. Excludes warmups
 * (they don't reflect work weight) and unfinished/current sessions.
 */
export async function getLastWorkingSetForExercise(
  exerciseId: string,
): Promise<SetRow | null> {
  const { data, error } = await supabase
    .from("sets")
    .select("*, sessions!inner(ended_at)")
    .eq("exercise_id", exerciseId)
    .in("set_type", ["working", "dropset"])
    .not("weight", "is", null)
    .not("reps", "is", null)
    .is("deleted_at", null)
    .not("sessions.ended_at", "is", null)
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const { sessions: _sessions, ...row } = data as SetRow & {
    sessions: unknown;
  };
  return row as SetRow;
}

export async function softDeleteSet(id: string): Promise<void> {
  const { error } = await supabase
    .from("sets")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export type BulkSoftDeleteSetsInput = {
  sessionId: string;
  exerciseId: string;
};

/**
 * Soft-deletes every non-deleted set in this (session, exercise) pair.
 * One PostgREST round-trip. RLS allows because every row's user_id
 * matches the authed user.
 */
export async function bulkSoftDeleteSetsForExerciseInSession(
  input: BulkSoftDeleteSetsInput,
): Promise<void> {
  const { error } = await supabase
    .from("sets")
    .update({ deleted_at: new Date().toISOString() })
    .eq("session_id", input.sessionId)
    .eq("exercise_id", input.exerciseId)
    .is("deleted_at", null);
  if (error) throw error;
}
