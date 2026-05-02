import { supabase } from "~/lib/supabase";
import type { Set as LiftSet } from "~/db/types";

export async function listSetsForSession(sessionId: string): Promise<LiftSet[]> {
  const { data, error } = await supabase
    .from("sets")
    .select("*")
    .eq("session_id", sessionId)
    .is("deleted_at", null)
    .order("completed_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as LiftSet[];
}
