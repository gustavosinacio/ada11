/**
 * Pure math kernel for the end-of-session verdict screen
 * (`app/(app)/workout/verdict/[sessionId].tsx`). No React, no Supabase.
 *
 * Two responsibilities:
 *   1. Group the just-finished session's `SetRow[]` into per-exercise volume
 *      buckets via the canonical `sumLiveVolume` kernel from
 *      `~/utils/volume-target` (so the live-screen volume strip and the
 *      verdict screen agree on every digit).
 *   2. Detect lifetime-volume PRs for the just-finished session, given the
 *      lifetime `WeeklyVolumeRow[]` (already invalidated + refetched by
 *      `useFinishSession.onSuccess`). The detector filters out the current
 *      session's rows BEFORE running `computeLifetimeMaxPerExercise`, so the
 *      prior-only max is well-defined and `current > priorMax` is meaningful.
 *
 * See `docs/runs/2026-05-22_0152_end-of-session-verdict/design-v2.md`.
 */
import type { WeeklyVolumeRow } from "~/api/stats";
import type { SetRow } from "~/db/types";
import { computeLifetimeMaxPerExercise } from "~/utils/progress-page-math";
import { sumLiveVolume } from "~/utils/volume-target";

/**
 * Per-exercise volume (kg) for the just-finished session. Groups `sets` by
 * `exercise_id`, then reduces each group via the shared `sumLiveVolume`
 * kernel — single source of truth for the live-volume predicate (warmup
 * skip, `completed_at != null`, `weight > 0`, `reps > 0`).
 *
 * Returns Map<exercise_id, totalKg>. Exercises with zero qualifying sets are
 * NOT present in the map. The downstream `priorMax > 0` guard inside
 * `computePrsForSession` makes the absence harmless — they cannot PR.
 */
export function computeCurrentSessionVolumeByExercise(
  sets: SetRow[],
): Map<string, number> {
  const byEx = new Map<string, SetRow[]>();
  for (const s of sets) {
    const bucket = byEx.get(s.exercise_id);
    if (bucket) bucket.push(s);
    else byEx.set(s.exercise_id, [s]);
  }
  const out = new Map<string, number>();
  for (const [exerciseId, group] of byEx) {
    const total = sumLiveVolume(group);
    if (total > 0) out.set(exerciseId, total);
  }
  return out;
}

export type SessionPr = {
  exerciseId: string;
  currentKg: number;
  priorMaxKg: number;
  /** currentKg - priorMaxKg, strictly > 0 by construction. */
  overflowKg: number;
};

/**
 * Returns one entry per exercise that hit a strict lifetime-volume PR in the
 * just-finished session.
 *
 * Algorithm:
 *   1. Filter `rows` to those with `row.session_id !== currentSessionId`
 *      (lifetime read is refetched after Finish and includes the current
 *      session's rows; removing them gives the prior-only baseline).
 *   2. Run `computeLifetimeMaxPerExercise` on the filtered rows.
 *   3. For each exercise present in `currentSessionVolumeByExercise`, emit a
 *      `SessionPr` iff `currentKg > priorMaxKg && priorMaxKg > 0`.
 *
 * Edge cases:
 *   - Exercise with zero prior finished sessions → priorMaxKg is 0 → NOT a
 *     PR (mirrors the first-session-doesn't-PR semantic in
 *     `volume-target.ts` and `computePrExerciseIdsThisWeek`).
 *   - Exact tie (currentKg === priorMaxKg) → NOT a PR (strict `>`).
 *   - Warmup-only / weight-0 / reps-0 contributions are filtered upstream by
 *     `computeCurrentSessionVolumeByExercise` AND inside
 *     `computeLifetimeMaxPerExercise`.
 *
 * Sorted by `overflowKg` DESC so the biggest PR appears first. Deterministic
 * tie-breaker: `exerciseId` ASC.
 */
export function computePrsForSession(opts: {
  rows: WeeklyVolumeRow[];
  currentSessionId: string;
  currentSessionVolumeByExercise: Map<string, number>;
  /**
   * Optional numeric millisecond threshold (typically from
   * `computeWindowStart(weeks, now)`). Plumbed straight through to
   * `computeLifetimeMaxPerExercise`. When provided, the prior-only baseline
   * is restricted to sessions whose `started_at >= windowStartMs`; the
   * strict-`>` and `priorMaxKg > 0` PR invariants survive trivially because
   * the comparison logic is unchanged — only the dataset shrinks.
   */
  windowStartMs?: number;
}): SessionPr[] {
  const {
    rows,
    currentSessionId,
    currentSessionVolumeByExercise,
    windowStartMs,
  } = opts;

  // Step 1: drop current-session rows so the lifetime max represents prior
  // sessions only.
  const priorRows = rows.filter((r) => r.session_id !== currentSessionId);

  // Step 2: prior-only lifetime max per exercise (windowed when configured).
  const priorMaxByExercise = computeLifetimeMaxPerExercise(
    priorRows,
    windowStartMs,
  );

  // Step 3: emit PR for each exercise with current > priorMax && priorMax > 0.
  const out: SessionPr[] = [];
  for (const [exerciseId, currentKg] of currentSessionVolumeByExercise) {
    const priorMaxKg = priorMaxByExercise.get(exerciseId) ?? 0;
    if (priorMaxKg > 0 && currentKg > priorMaxKg) {
      out.push({
        exerciseId,
        currentKg,
        priorMaxKg,
        overflowKg: currentKg - priorMaxKg,
      });
    }
  }

  // Sort: overflowKg DESC, then exerciseId ASC for determinism.
  out.sort((a, b) => {
    if (b.overflowKg !== a.overflowKg) return b.overflowKg - a.overflowKg;
    return a.exerciseId.localeCompare(b.exerciseId);
  });
  return out;
}
