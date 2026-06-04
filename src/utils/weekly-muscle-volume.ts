import type { WeeklyVolumeRow } from "~/api/stats";
import type { ExerciseRow, MeasurementEntryRow, MuscleGroup } from "~/db/types";
import { MUSCLE_GROUPS } from "~/db/types";
import { bodyweightKgAsOf, effectiveWeightKg } from "~/utils/bodyweight";
import { isoWeekStart, isoWeeksBetween, parseISO, weekKeyOf } from "~/utils/dates";

/**
 * Pure presenter for the weekly per-muscle volume chart. Buckets the
 * (bodyweight-aware) `WeeklyVolumeRow[]` by (ISO week × primary muscle),
 * zero-filled across a shared contiguous week axis. No React, no I/O.
 */

export type MuscleSeriesKey = MuscleGroup | "Other";

export type WeeklyMuscleSeries = {
  key: MuscleSeriesKey;
  /** kg per week, index-aligned to `weeks` (zero-filled). */
  values: number[];
};

export type WeeklyMuscleVolumeModel = {
  /** Shared contiguous ISO-week axis (oldest→newest), first-trained → now. */
  weeks: { key: string; label: string }[];
  /** One entry per muscle group that has ANY non-zero week (+ "Other" iff it
   *  has data). Insertion order = MUSCLE_GROUPS then "Other". */
  series: WeeklyMuscleSeries[];
};

const SERIES_ORDER: readonly MuscleSeriesKey[] = [...MUSCLE_GROUPS, "Other"];

/**
 * Same shape as `WeeklyMuscleVolumeModel` — `values` are integer hard-set
 * counts (one per qualifying working set), not kg. Only the display
 * `formatValue` interprets the units; the chart consumes the structure
 * identically.
 */
export type WeeklyMuscleHardSetsModel = WeeklyMuscleVolumeModel;

/**
 * Per-row inclusion + contribution for a (muscle × week) bucketing metric. The
 * shared scaffold (`bucketByMuscleWeek`) is parameterized by THIS so the two
 * metrics — tonnage (working+dropset rows with w>0 && r>0) and hard sets
 * (working-only, load-irrelevant) — diverge on the INCLUDE-predicate, not just
 * the accumulator. `w`/`r` are only computed when `needsLoad` is true.
 */
type RowMetric = {
  /** Per-row inclusion. Receives the raw row + the (lazily computed) effective
   *  weight/reps so tonnage can keep its `w>0 && r>0` gate and sets can ignore
   *  load entirely. */
  include: (row: WeeklyVolumeRow, w: number, r: number) => boolean;
  /** Per-row contribution to the (muscle, week) accumulator. */
  contribute: (row: WeeklyVolumeRow, w: number, r: number) => number;
  /** Whether this metric needs the bodyweight/effectiveWeight machinery at all.
   *  Sets path = false → skip resolveBw/effectiveWeightKg entirely (Invariant S,
   *  perf). Tonnage = true. */
  needsLoad: boolean;
};

/**
 * Shared bucketing scaffold for the weekly per-muscle chart. Buckets the
 * `WeeklyVolumeRow[]` by (ISO week × primary muscle), zero-filled across a
 * shared contiguous week axis. Parameterized by a per-row INCLUDE-predicate +
 * per-row CONTRIBUTION (the `metric` arg) so tonnage and hard-sets share ALL
 * the axis/window/attribution/emit logic and diverge ONLY on which rows count
 * and what each contributes. No React, no I/O.
 *
 * - Week axis = isoWeeksBetween(firstSessionMonday, currentMonday) — same
 *   zero-fill contract as computeStripModel (Decision #4).
 * - Bucket placement uses weekKeyOf(parseISO(row.completed_at)) (matches the
 *   strip's bar-week semantic).
 * - Muscle attribution: libById.get(row.exercise_id).muscles[0] → MuscleGroup,
 *   else "Other" (mirrors useExercisesThisWeek:278-283). Dangling exercise_id
 *   (not in lib) → skip the row (mirrors use-progress-page.ts:275). SHARED by
 *   both metrics (U6) so feature #2's secondary-muscle attribution lands once.
 * - Effective weight/reps are computed lazily, only when `metric.needsLoad`
 *   (the sets path never touches resolveBw/effectiveWeightKg — Invariant S).
 * - Empty series (a muscle with all-zero weeks) is dropped from `series`.
 * - Returns weeks=[] / series=[] when rows is empty.
 *
 * Optional `windowStartMs` (view-only chart window): when provided, excludes
 * rows whose `sessions.started_at` is strictly before the threshold instant —
 * the SAME dual-anchor rule the "Max" numbers use (inclusion on `started_at`,
 * bucketing still on `completed_at`; `bucketLifetimeWeeklyVolumes`,
 * progress-page-math.ts:82-84). The guard sits at the head of BOTH row loops
 * (earliest-edge + bucket) so the axis left edge also shrinks to the first
 * in-window week. Absent/undefined → Invariant W: byte-for-byte today's
 * full-history output (no guard fires). Does NOT honor max_volume_window_weeks
 * by default (Decision #3) — full history unless the page threads a window.
 */
function bucketByMuscleWeek(args: {
  rows: WeeklyVolumeRow[];
  exercises: ExerciseRow[];
  measurements: MeasurementEntryRow[];
  windowStartMs: number | undefined;
  now: Date;
  metric: RowMetric;
}): WeeklyMuscleVolumeModel {
  const { rows, exercises, measurements, windowStartMs, now, metric } = args;
  if (rows.length === 0) return { weeks: [], series: [] };

  // Earliest completed_at → first-trained Monday (the left axis edge).
  let earliestMs = Infinity;
  for (const row of rows) {
    if (windowStartMs !== undefined) {
      const startedMs = parseISO(row.sessions.started_at).getTime();
      if (startedMs < windowStartMs) continue;
    }
    const t = parseISO(row.completed_at).getTime();
    if (Number.isFinite(t) && t < earliestMs) earliestMs = t;
  }
  if (!Number.isFinite(earliestMs)) return { weeks: [], series: [] };

  const firstMonday = isoWeekStart(new Date(earliestMs));
  const currentMonday = isoWeekStart(now);
  const weeks = isoWeeksBetween(firstMonday, currentMonday);
  if (weeks.length === 0) return { weeks: [], series: [] };

  // weekKey → index for O(1) bucket placement.
  const weekIndex = new Map<string, number>();
  weeks.forEach((w, i) => weekIndex.set(w.key, i));

  // exercise_id → library row (for muscles[0] + equipment).
  const libById = new Map(exercises.map((e) => [e.id, e] as const));
  const validMuscles = new Set<string>(MUSCLE_GROUPS);

  // Bodyweight resolver, memoised per session_id (F-2). Only invoked on the
  // load-bearing (tonnage) path — see `metric.needsLoad`.
  const bwCache = new Map<string, number | null>();
  const resolveBw = (sessionId: string, startedAt: string): number | null => {
    if (bwCache.has(sessionId)) return bwCache.get(sessionId)!;
    const v = bodyweightKgAsOf(measurements, parseISO(startedAt).getTime());
    bwCache.set(sessionId, v);
    return v;
  };

  // muscleKey → number[] (week-indexed), built only for keys that get data.
  const byMuscle = new Map<MuscleSeriesKey, number[]>();

  for (const row of rows) {
    if (windowStartMs !== undefined) {
      const startedMs = parseISO(row.sessions.started_at).getTime();
      if (startedMs < windowStartMs) continue;
    }
    const idx = weekIndex.get(weekKeyOf(parseISO(row.completed_at)));
    if (idx === undefined) continue; // week outside the axis — shouldn't happen.
    const ex = libById.get(row.exercise_id);
    if (!ex) continue; // dangling exercise_id — skip (lib safety).

    const primary = (ex.muscles ?? [])[0];
    const key: MuscleSeriesKey =
      primary && validMuscles.has(primary) ? (primary as MuscleGroup) : "Other";

    // Lazily compute effective weight/reps ONLY when the metric needs load.
    // The sets path (needsLoad:false) never calls resolveBw/effectiveWeightKg
    // (Invariant S) — a bodyweight working set (weight=0, no weigh-in) counts.
    let w = 0;
    let r = 0;
    if (metric.needsLoad) {
      const bw = resolveBw(row.session_id, row.sessions.started_at);
      w = effectiveWeightKg(ex.equipment, row.weight, bw, ex.bodyweight_factor);
      r = row.reps ?? 0;
    }
    if (!metric.include(row, w, r)) continue;

    let values = byMuscle.get(key);
    if (!values) {
      values = new Array<number>(weeks.length).fill(0);
      byMuscle.set(key, values);
    }
    values[idx]! += metric.contribute(row, w, r);
  }

  // Emit series in canonical order; drop all-zero (i.e. absent) series.
  const series: WeeklyMuscleSeries[] = [];
  for (const key of SERIES_ORDER) {
    const values = byMuscle.get(key);
    if (!values) continue;
    if (values.every((v) => v === 0)) continue;
    series.push({ key, values });
  }

  return {
    weeks: weeks.map((w) => ({ key: w.key, label: w.label })),
    series,
  };
}

/**
 * Buckets bodyweight-aware weekly TONNAGE by (ISO week × primary muscle). Thin
 * wrapper over the shared `bucketByMuscleWeek` scaffold (Invariant T: this
 * produces byte-for-byte today's output — the include-predicate
 * `(w,r)=>w>0&&r>0` and contribution `(w,r)=>w*r` reproduce the pre-refactor
 * `:123`/`:130` seam verbatim).
 *
 * - Volume per set = effectiveWeightKg(ex.equipment, row.weight, bw) * reps,
 *   bw = bodyweightKgAsOf(measurements, parseISO(row.sessions.started_at)),
 *   memoised per session_id. Includes working+dropset rows (no `set_type`
 *   filter — server already excludes warmups).
 *
 * See `bucketByMuscleWeek` for the shared axis/window/attribution contract and
 * the `windowStartMs` Invariant-W semantics.
 */
export function presentWeeklyVolumeByMuscle(args: {
  rows: WeeklyVolumeRow[];
  exercises: ExerciseRow[];
  measurements: MeasurementEntryRow[];
  windowStartMs?: number; // view-only chart window; undefined → Invariant W (full history).
  now?: Date; // injectable for deterministic tests (default new Date())
}): WeeklyMuscleVolumeModel {
  const { rows, exercises, measurements, windowStartMs, now = new Date() } =
    args;
  return bucketByMuscleWeek({
    rows,
    exercises,
    measurements,
    windowStartMs,
    now,
    metric: {
      needsLoad: true,
      include: (_row, w, r) => w > 0 && r > 0, // today's :123 guard, verbatim
      contribute: (_row, w, r) => w * r, // today's :130 value, verbatim
    },
  });
}

/**
 * Buckets weekly HARD SETS by (ISO week × primary muscle). A "hard set" is one
 * `set_type === 'working'`, non-dangling, in-window row — each counts as
 * exactly 1, REGARDLESS of load/reps (Invariant S / U1): a bodyweight working
 * set (weight=0, no weigh-in) counts; a reps=0/null working set counts.
 * Dropset rows do NOT count (Invariant D / U3 — a dropset extends one effort);
 * warmups are already server-excluded.
 *
 * The signature OMITS `measurements`: the sets metric is load-irrelevant and
 * NEVER calls effectiveWeightKg/resolveBw/bodyweight (needsLoad:false). It
 * shares the SAME `muscles[0]` attribution path as tonnage via the scaffold
 * (U6), so feature #2's secondary-muscle attribution lands in one place.
 *
 * See `bucketByMuscleWeek` for the shared axis/window/attribution contract and
 * the `windowStartMs` Invariant-W semantics.
 */
export function presentWeeklyHardSetsByMuscle(args: {
  rows: WeeklyVolumeRow[];
  exercises: ExerciseRow[];
  windowStartMs?: number; // view-only chart window; undefined → full history.
  now?: Date; // injectable for deterministic tests (default new Date())
}): WeeklyMuscleHardSetsModel {
  const { rows, exercises, windowStartMs, now = new Date() } = args;
  return bucketByMuscleWeek({
    rows,
    exercises,
    measurements: [], // inert — needsLoad:false means resolveBw is never called.
    windowStartMs,
    now,
    metric: {
      needsLoad: false, // Invariant S — no effectiveWeightKg/resolveBw
      include: (row) => row.set_type === "working", // LOCKED #1/#3 — working-only
      contribute: () => 1, // one hard set per qualifying row
    },
  });
}
