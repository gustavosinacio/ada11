import { supabase } from "~/lib/supabase";
import type { SetType } from "~/db/types";

export type WeeklyVolumeRow = {
  completed_at: string;
  weight: string | null;
  reps: number | null;
  set_type: SetType;
  sessions: { started_at: string; ended_at: string };
};

/**
 * Range-bound read of finished, non-warmup, non-deleted sets since `sinceUtc`.
 *
 * Stays "dumb": no client-side reduction. The strip component does the
 * week-bucketing so the same query can serve any future per-week aggregation.
 */
export async function listWeeklyVolumeRows(opts: {
  sinceUtc: string;
}): Promise<WeeklyVolumeRow[]> {
  const { data, error } = await supabase
    .from("sets")
    .select(
      "completed_at, weight, reps, set_type, sessions!inner(started_at, ended_at)",
    )
    .is("deleted_at", null)
    .not("sessions.ended_at", "is", null)
    .neq("set_type", "warmup")
    .gte("completed_at", opts.sinceUtc)
    .order("completed_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as WeeklyVolumeRow[];
}
