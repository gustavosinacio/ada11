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
 * Buckets bodyweight-aware weekly volume by (ISO week × primary muscle).
 *
 * - Week axis = isoWeeksBetween(firstSessionMonday, currentMonday) — same
 *   zero-fill contract as computeStripModel (Decision #4).
 * - Bucket placement uses weekKeyOf(parseISO(row.completed_at)) (matches the
 *   strip's bar-week semantic).
 * - Muscle attribution: libById.get(row.exercise_id).muscles[0] → MuscleGroup,
 *   else "Other" (mirrors useExercisesThisWeek:278-283). Dangling exercise_id
 *   (not in lib) → skip the row (mirrors use-progress-page.ts:275).
 * - Volume per set = effectiveWeightKg(ex.equipment, row.weight, bw) * reps,
 *   bw = bodyweightKgAsOf(measurements, parseISO(row.sessions.started_at)),
 *   memoised per session_id. (Equipment read from the lib here since the
 *   presenter already joins lib for muscles; equivalent to row.exercises.equipment.)
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
export function presentWeeklyVolumeByMuscle(args: {
  rows: WeeklyVolumeRow[];
  exercises: ExerciseRow[];
  measurements: MeasurementEntryRow[];
  windowStartMs?: number; // view-only chart window; undefined → Invariant W (full history).
  now?: Date; // injectable for deterministic tests (default new Date())
}): WeeklyMuscleVolumeModel {
  const { rows, exercises, measurements, windowStartMs, now = new Date() } =
    args;
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

  // Bodyweight resolver, memoised per session_id (F-2).
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

    const bw = resolveBw(row.session_id, row.sessions.started_at);
    const w = effectiveWeightKg(ex.equipment, row.weight, bw);
    const r = row.reps ?? 0;
    if (!(w > 0 && r > 0)) continue;

    let values = byMuscle.get(key);
    if (!values) {
      values = new Array<number>(weeks.length).fill(0);
      byMuscle.set(key, values);
    }
    values[idx]! += w * r;
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
