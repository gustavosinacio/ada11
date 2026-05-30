import { supabase } from "~/lib/supabase";
import type { SetType } from "~/db/types";

/**
 * Row shape returned by `listWeeklyVolumeRows`.
 *
 * `completed_at` is narrowed to non-null `string`. Two defences uphold the
 * invariant:
 *   1. Server-side `.not("completed_at", "is", null)` filter on BOTH branches
 *      (paginated lifetime AND single-shot sinceUtc-bound).
 *   2. Post-fetch runtime assertion that throws if any row slipped through.
 *
 * Background: `finishSession` only stamps `sessions.ended_at`; unchecked sets
 * inside a finished session keep `completed_at = null`. Without the filter,
 * those rows would reach `parseISO(null)` → `Invalid Date` → bucket math
 * throws. See design-v3.md BLK-3.
 */
export type WeeklyVolumeRow = {
  completed_at: string;
  weight: string | null;
  reps: number | null;
  set_type: SetType;
  exercise_id: string;
  session_id: string;
  // `equipment` typed `string` (not `Equipment`) — legacy user-owned rows may
  // hold arbitrary strings (`db/types.ts:108-118`); the `=== "bodyweight"`
  // test inside `effectiveWeightKg` is the canonical gate.
  exercises: { equipment: string };
  sessions: { started_at: string; ended_at: string };
};

const SELECT =
  "completed_at, weight, reps, set_type, exercise_id, session_id, " +
  "exercises!inner(equipment), sessions!inner(started_at, ended_at)";

const PAGE = 1000;

/**
 * Reads finished, non-warmup, non-deleted sets with non-null `completed_at`.
 *
 * When `sinceUtc` is provided, filters `completed_at >= sinceUtc` and issues
 * a single-shot read (≤1000 rows expected — used by the History 8-week strip).
 *
 * When `sinceUtc` is omitted, iterates paginated `.range(from, from + PAGE - 1)`
 * until a short page returns. PostgREST silently truncates at 1000 rows unless
 * the client paginates explicitly. Lifetime reads on the Progress page need
 * every finished-set row, so the loop is load-bearing.
 *
 * Both branches apply `.not("completed_at", "is", null)` server-side and
 * assert non-null post-fetch (defence-in-depth — narrows the returned type to
 * `completed_at: string` so downstream call sites don't need to coalesce).
 */
export async function listWeeklyVolumeRows(
  opts: { sinceUtc?: string } = {},
): Promise<WeeklyVolumeRow[]> {
  if (opts.sinceUtc !== undefined) {
    const { data, error } = await supabase
      .from("sets")
      .select(SELECT)
      .is("deleted_at", null)
      .is("sessions.deleted_at", null)
      .not("completed_at", "is", null)
      .not("sessions.ended_at", "is", null)
      .neq("set_type", "warmup")
      .gte("completed_at", opts.sinceUtc)
      .order("completed_at", { ascending: true });
    if (error) throw error;
    const rows = (data ?? []) as unknown as WeeklyVolumeRow[];
    if (rows.some((r) => r.completed_at === null)) {
      throw new Error(
        "listWeeklyVolumeRows: null completed_at slipped past server filter",
      );
    }
    return rows;
  }

  // Lifetime branch — paginate to bypass PostgREST's silent 1000-row truncation.
  let from = 0;
  const all: WeeklyVolumeRow[] = [];
  while (true) {
    const { data, error } = await supabase
      .from("sets")
      .select(SELECT)
      .is("deleted_at", null)
      .is("sessions.deleted_at", null)
      .not("completed_at", "is", null)
      .not("sessions.ended_at", "is", null)
      .neq("set_type", "warmup")
      .order("completed_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const page = (data ?? []) as unknown as WeeklyVolumeRow[];
    all.push(...page);
    if (page.length < PAGE) break;
    from += PAGE;
  }
  if (all.some((r) => r.completed_at === null)) {
    throw new Error(
      "listWeeklyVolumeRows: null completed_at slipped past server filter",
    );
  }
  return all;
}
