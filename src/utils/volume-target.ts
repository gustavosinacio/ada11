import type { SessionSets } from "~/api/progress";
import type { SetRow } from "~/db/types";
import { parseISO } from "~/utils/dates";

/**
 * Discriminated state returned by `computeVolumeTarget`. The live
 * `<VolumeTargetSlot>` maps these to the three render states (hidden,
 * chasing strip, surpassed strip). All numeric fields are in kg —
 * display-layer is responsible for unit conversion via
 * `formatVolume` / `formatWeight`.
 */
export type VolumeTargetState =
  | { kind: "no-pr" }
  | {
      kind: "chasing";
      previousMaxKg: number;
      /** Sets of the past session that achieved `previousMaxKg` — for the
       *  per-set breakdown of the max-volume session. Empty only when
       *  `previousMaxKg === 0` (which short-circuits to `no-pr`). */
      previousMaxSets: SetRow[];
      runningKg: number;
      /** previousMaxKg - runningKg, > 0. */
      gapKg: number;
      /** Weight of the most-recent set in the live session that has a
       *  finite positive `weight`. `null` when no usable set has been
       *  logged yet. */
      currentWeightKg: number | null;
      /** gapKg / currentWeightKg. `null` when `currentWeightKg` is null. */
      repsToBeat: number | null;
    }
  | {
      kind: "surpassed";
      previousMaxKg: number;
      /** Sets of the past session that achieved `previousMaxKg`. */
      previousMaxSets: SetRow[];
      runningKg: number;
      /** runningKg - previousMaxKg, >= 0. Zero means "matched". */
      overflowKg: number;
    };

export type ComputeVolumeTargetInput = {
  /** All finished-session set groups for this exercise, from
   *  `useExerciseProgress(exerciseId)`. May be undefined while loading. */
  pastSessions: SessionSets[] | undefined;
  /** Session-scoped sets for this exercise, from the live screen
   *  (`setsByExercise.get(ex.id)`). */
  currentSessionSets: SetRow[];
  /**
   * Optional numeric millisecond threshold (typically from
   * `computeWindowStart(weeks, now)`). When provided, past sessions whose
   * `started_at` is strictly before the threshold are excluded from the
   * `previousMaxKg` reduction. Filtering uses `SessionSets.started_at` (not
   * individual set `completed_at`) so a session is always an indivisible
   * unit — consistent with the cross-kernel rule in design-v2.
   */
  windowStartMs?: number;
};

/**
 * Canonical volume kernel — mirrors `exercises/[id]/progress.tsx:62-93` and
 * `weekly-volume-strip.tsx:43-51`. Skips warmups, parses string weights with
 * `parseFloat`, guards `w > 0 && r > 0`.
 *
 * Past-vs-live asymmetry (deliberate): `sumPastVolume` does NOT filter on
 * `completed_at` because `pastSessions` is loaded by `listSetsForExercise`,
 * which scopes to finished sessions (`ended_at IS NOT NULL`). Within a
 * finished session every set is implicitly committed — the F10 "checked =
 * committed" rule governs the LIVE session interpretation only. Migration
 * 0007 made `completed_at` nullable, so a finished session could technically
 * contain unchecked rows, but that case is operational noise, not the
 * intended semantic, and folding it into the past-max reduction would
 * silently corrupt historical PRs.
 */
export function sumPastVolume(sets: SetRow[]): number {
  let total = 0;
  for (const s of sets) {
    if (s.set_type === "warmup") continue;
    const w = s.weight ? parseFloat(s.weight) : NaN;
    const r = s.reps ?? 0;
    if (Number.isFinite(w) && w > 0 && r > 0) {
      total += w * r;
    }
  }
  return total;
}

/**
 * Live-session volume kernel. Same per-set predicate as `sumPastVolume`
 * (warmup skip, weight > 0, reps > 0) plus a leading `completed_at != null`
 * guard so drafts (unchecked rows) are excluded. This enforces the
 * user-visible `Max − Now = To PR` arithmetic on `<VolumeTargetSlot>` per
 * F10 "checked = committed" semantics.
 *
 * Accepts the structural subset of `SetRow` the body actually reads
 * (`Pick<SetRow, "completed_at" | "set_type" | "weight" | "reps">`). This
 * lets non-`SetRow` shapes — notably `WeeklyVolumeRow` from `src/api/stats`
 * — feed the kernel without casts, while existing `SetRow[]` callers remain
 * structurally assignable.
 */
export function sumLiveVolume(
  sets: Pick<SetRow, "completed_at" | "set_type" | "weight" | "reps">[],
): number {
  let total = 0;
  for (const s of sets) {
    if (s.completed_at == null) continue;
    if (s.set_type === "warmup") continue;
    const w = s.weight ? parseFloat(s.weight) : NaN;
    const r = s.reps ?? 0;
    if (Number.isFinite(w) && w > 0 && r > 0) {
      total += w * r;
    }
  }
  return total;
}

/**
 * Computes the volume-target state for a single exercise.
 *
 * - `previousMaxKg` = max single-session volume across `pastSessions`
 *   (via `sumPastVolume`, no completion filter).
 * - `runningKg` = volume of CHECKED working sets in `currentSessionSets`
 *   (via `sumLiveVolume`, filters `completed_at != null`). This enforces
 *   `Max − Now = To PR` on the visible UI per F10 "checked = committed".
 * - `currentWeightKg` = weight of the set with the maximum `set_number` that
 *   has a finite positive weight. Chosen by `set_number` (not array index)
 *   because `listSetsForSession` orders by completion timestamp, which can
 *   reorder rows once individual sets are checked (MAJ-1 fix). NOT gated by
 *   `completed_at` — the "what weight am I on?" pick is about *intent*, so
 *   drafts still drive it (Decision #8 in the design).
 *
 * Tie case (`gapKg <= 0` with `previousMaxKg > 0`): returns `surpassed` with
 * `overflowKg = Math.max(0, -gapKg)` so the slot can render a clean "matched"
 * or "+X over previous" copy (MIN-2).
 */
export function computeVolumeTarget(
  input: ComputeVolumeTargetInput,
): VolumeTargetState {
  const { pastSessions, currentSessionSets, windowStartMs } = input;

  let previousMaxKg = 0;
  let previousMaxSets: SetRow[] = [];
  if (pastSessions) {
    for (const session of pastSessions) {
      // Window filter at the session level — never per-set — so a session is
      // always treated as one indivisible unit (MAJ-1 in design-v2).
      if (windowStartMs !== undefined) {
        const startedMs = parseISO(session.started_at).getTime();
        if (startedMs < windowStartMs) continue;
      }
      const total = sumPastVolume(session.sets);
      if (total > previousMaxKg) {
        previousMaxKg = total;
        previousMaxSets = session.sets;
      }
    }
  }

  if (previousMaxKg === 0) {
    return { kind: "no-pr" };
  }

  const runningKg = sumLiveVolume(currentSessionSets);
  const gapKg = previousMaxKg - runningKg;

  if (gapKg <= 0) {
    return {
      kind: "surpassed",
      previousMaxKg,
      previousMaxSets,
      runningKg,
      overflowKg: Math.max(0, -gapKg),
    };
  }

  // Pick the "current weight" by max(set_number) — robust against the
  // completion-timestamp ordering used by `listSetsForSession` (MAJ-1).
  const currentSet = currentSessionSets.reduce<SetRow | null>((best, s) => {
    const w = s.weight ? parseFloat(s.weight) : NaN;
    if (!Number.isFinite(w) || w <= 0) return best;
    if (!best || s.set_number > best.set_number) return s;
    return best;
  }, null);

  const currentWeightKg = currentSet
    ? parseFloat(currentSet.weight as string)
    : null;
  const repsToBeat =
    currentWeightKg != null && currentWeightKg > 0
      ? gapKg / currentWeightKg
      : null;

  return {
    kind: "chasing",
    previousMaxKg,
    previousMaxSets,
    runningKg,
    gapKg,
    currentWeightKg,
    repsToBeat,
  };
}
