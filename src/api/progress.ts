import { supabase } from "~/lib/supabase";
import type { SetRow } from "~/db/types";

export type SessionSets = {
  session_id: string;
  started_at: string;
  sets: SetRow[];
};

export async function listSetsForExercise(exerciseId: string): Promise<SessionSets[]> {
  const { data, error } = await supabase
    .from("sets")
    .select("*, sessions!inner(id, started_at, ended_at)")
    .eq("exercise_id", exerciseId)
    .not("sessions.ended_at", "is", null)
    .is("deleted_at", null)
    .order("completed_at", { ascending: true });
  if (error) throw error;

  const bySession = new Map<string, SessionSets>();
  for (const row of (data ?? []) as (SetRow & { sessions: { id: string; started_at: string } })[]) {
    const sid = row.sessions.id;
    if (!bySession.has(sid)) {
      bySession.set(sid, {
        session_id: sid,
        started_at: row.sessions.started_at,
        sets: [],
      });
    }
    bySession.get(sid)!.sets.push(row);
  }

  return Array.from(bySession.values()).sort(
    (a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime(),
  );
}
