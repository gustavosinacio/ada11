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
    // Pin nulls last so unchecked drafts appear after checked sets, and break
    // intra-session timestamp ties (e.g. after bulkCheckAllInSession) with the
    // unique set_number per (session_id, exercise_id).
    .order("completed_at", { ascending: true, nullsFirst: false })
    .order("set_number", { ascending: true });
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
      // null = unchecked draft. User opts in to "checked" by tapping the
      // per-set check button (or via the bulk Finish-flow auto-check).
      completed_at: null,
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

/**
 * Flips a single set to "checked" by stamping completed_at = now().
 * No-op if already checked (idempotent at the call site via the toggle).
 */
export async function checkSet(id: string): Promise<void> {
  const { error } = await supabase
    .from("sets")
    .update({ completed_at: new Date().toISOString() })
    .eq("id", id)
    .is("deleted_at", null);
  if (error) throw error;
}

/**
 * Flips a single set back to "unchecked" by clearing completed_at.
 * Only meaningful inside an active session (finished sessions never expose
 * a toggle UI).
 */
export async function uncheckSet(id: string): Promise<void> {
  const { error } = await supabase
    .from("sets")
    .update({ completed_at: null })
    .eq("id", id)
    .is("deleted_at", null);
  if (error) throw error;
}

/**
 * Bulk-flip every unchecked, non-deleted set in this session to "checked"
 * with the same now() timestamp. Single PostgREST round-trip. The shared
 * timestamp ordering is broken by the secondary set_number sort in
 * listSetsForSession / listSetsForExercise.
 */
export async function bulkCheckAllInSession(sessionId: string): Promise<void> {
  const { error } = await supabase
    .from("sets")
    .update({ completed_at: new Date().toISOString() })
    .eq("session_id", sessionId)
    .is("completed_at", null)
    .is("deleted_at", null);
  if (error) throw error;
}

/**
 * Bulk soft-deletes every unchecked, non-deleted set in this session, then
 * cascades the same soft-delete to UNCHECKED dropset children whose parent
 * is one of the discarded rows. Checked dropset children survive — the user
 * explicitly opted to keep them. Their parent_set_id then references a
 * soft-deleted row, which is invisible behind every list's
 * `.is("deleted_at", null)` filter (same pre-existing nit as per-row
 * useDeleteSet of a parent with checked children).
 *
 * Uses a single now() timestamp for both UPDATE calls to keep deletion
 * timestamps coherent.
 */
export async function bulkSoftDeleteUncheckedInSession(
  sessionId: string,
): Promise<void> {
  const nowIso = new Date().toISOString();

  // 1) Collect ids of the unchecked rows we're about to discard.
  const { data: unchecked, error: readErr } = await supabase
    .from("sets")
    .select("id")
    .eq("session_id", sessionId)
    .is("completed_at", null)
    .is("deleted_at", null);
  if (readErr) throw readErr;
  const uncheckedIds = (unchecked ?? []).map((r) => r.id as string);
  if (uncheckedIds.length === 0) return;

  // 2) Soft-delete the unchecked rows themselves.
  const { error: delErr } = await supabase
    .from("sets")
    .update({ deleted_at: nowIso })
    .in("id", uncheckedIds);
  if (delErr) throw delErr;

  // 3) Cascade ONLY to unchecked dropset children of those rows. Checked
  //    children stay — the user explicitly opted to keep them. The
  //    parent_set_id of those checked survivors then points at a
  //    soft-deleted row, invisible behind every list's
  //    `.is("deleted_at", null)` filter (same pre-existing nit as per-row
  //    useDeleteSet of a parent with checked children).
  const { error: cascadeErr } = await supabase
    .from("sets")
    .update({ deleted_at: nowIso })
    .in("parent_set_id", uncheckedIds)
    .is("completed_at", null)
    .is("deleted_at", null);
  if (cascadeErr) throw cascadeErr;
}
