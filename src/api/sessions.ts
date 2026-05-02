import { supabase } from "~/lib/supabase";
import type { Session } from "~/db/types";

export async function listSessions(): Promise<Session[]> {
  const { data, error } = await supabase
    .from("sessions")
    .select("*")
    .is("deleted_at", null)
    .order("started_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Session[];
}
