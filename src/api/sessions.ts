import { supabase } from "~/lib/supabase";
import type { SessionRow } from "~/db/types";

export async function listSessions(): Promise<SessionRow[]> {
  const { data, error } = await supabase
    .from("sessions")
    .select("*")
    .is("deleted_at", null)
    .order("started_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as SessionRow[];
}

export async function getSession(id: string): Promise<SessionRow> {
  const { data, error } = await supabase
    .from("sessions")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .single();
  if (error) throw error;
  return data as SessionRow;
}

/** Returns the in-progress session (ended_at IS NULL) if any. */
export async function getActiveSession(): Promise<SessionRow | null> {
  const { data, error } = await supabase
    .from("sessions")
    .select("*")
    .is("deleted_at", null)
    .is("ended_at", null)
    .order("started_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  return (data?.[0] as SessionRow | undefined) ?? null;
}

export async function startSession(input: {
  routine_id?: string | null;
  notes?: string | null;
}): Promise<SessionRow> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("sessions")
    .insert({
      user_id: userId,
      routine_id: input.routine_id ?? null,
      started_at: new Date().toISOString(),
      notes: input.notes ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data as SessionRow;
}

export async function finishSession(id: string): Promise<SessionRow> {
  const { data, error } = await supabase
    .from("sessions")
    .update({ ended_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as SessionRow;
}

export async function updateSessionNotes(
  id: string,
  notes: string | null,
): Promise<SessionRow> {
  const { data, error } = await supabase
    .from("sessions")
    .update({ notes })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as SessionRow;
}

export async function softDeleteSession(id: string): Promise<void> {
  const { error } = await supabase
    .from("sessions")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}
