import type { WeeklyVolumeRow } from "~/api/stats";
import type { ExerciseRow } from "~/db/types";
import { isoWeekStart, isoWeeksBetween, parseISO, weekKeyOf } from "~/utils/dates";
import { epley1RM } from "~/utils/formulas";

/**
 * Pure presenter for the e1RM strength-progress chart. Ranks the owner's
 * MOST-PERFORMED (by distinct sessions) weighted exercises, computes the best
 * estimated-1RM per (exercise × ISO week) via `epley1RM` on LOGGED weight, and
 * carries the last observed value forward across untrained weeks (LOCF). No
 * React, no I/O. The strength complement to `presentWeeklyVolumeByMuscle`.
 *
 * Two material divergences from the muscle (volume) presenter:
 *   - **Invariant D — LOGGED weight only.** The guard is on `parseFloat(weight)`,
 *     NOT `effectiveWeightKg`. A bodyweight-only set (`weight=0`) yields NO e1RM
 *     point and never makes its exercise eligible — it cannot consume a top-N
 *     slot. (Same gate as `app/(app)/exercises/[id]/progress.tsx:155-159`.)
 *   - **Invariant E1 — PEAK metric.** Per (exercise, week) we take the MAX
 *     `epley1RM`, NOT a `+=` sum (the volume presenter sums; e1RM is a best, not
 *     an accumulation).
 *
 * Untrained weeks are LAST-OBSERVATION-CARRIED-FORWARD (Decision #7a), NOT
 * zero-filled: a rest week is not strength=0, and `<MultiSeriesChart>` has no
 * gap support, so zero-fill would crash each line to the x-axis and back.
 */

/** One exercise's e1RM trend, index-aligned to the shared `weeks` axis. */
export type E1rmSeries = {
  /** Stable identity = exercise_id. Drives color-by-rank + selection state. */
  id: string;
  /** Display name resolved from the library (ExerciseRow.name). */
  name: string;
  /** 0-based rank among the top-N (drives palette index). */
  rank: number;
  /**
   * kg per week, index-aligned to `weeks`. Untrained weeks are
   * LAST-OBSERVATION-CARRIED-FORWARD (Decision #7a), NOT zero-filled:
   *   - week with ≥1 set passing (w>0 && r>0): the MAX epley1RM of that week.
   *   - week with no such set: the previous week's value.
   *   - leading weeks before the first real value: the first real value
   *     (flat lead-in) — so the array is fully numeric (no nulls, no 0-drop).
   * Guaranteed: every entry > 0 (a series with no real value is never emitted).
   */
  values: number[];
};

export type E1rmStrengthModel = {
  /** Shared contiguous ISO-week axis (oldest→newest), first-trained → now. */
  weeks: { key: string; label: string }[];
  /** Top-N eligible exercises by distinct-session rank; rank-ordered. */
  series: E1rmSeries[];
};

/** Default cap on plotted lines (matches progress-hero.tsx TOP_N). */
export const E1RM_TOP_N = 5;

type EligibleAgg = {
  id: string;
  name: string;
  /** weekIdx → MAX epley1RM for that week (sparse — only real weeks set). */
  cell: (number | undefined)[];
  /** distinct session_ids the exercise has a weighted set in. */
  sessions: Set<string>;
  /** most-recent weighted-set completion (ms) — tie-break #2. */
  lastActiveMs: number;
};

export function presentTopExerciseE1rm(args: {
  rows: WeeklyVolumeRow[];
  exercises: ExerciseRow[];
  topN?: number; // default E1RM_TOP_N
  now?: Date; // injectable for deterministic tests; default new Date()
}): E1rmStrengthModel {
  const { rows, exercises, topN = E1RM_TOP_N, now = new Date() } = args;
  if (rows.length === 0) return { weeks: [], series: [] };

  // Earliest completed_at → first-trained Monday (the left axis edge).
  let earliestMs = Infinity;
  for (const row of rows) {
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

  // exercise_id → library row (for the display name). Dangling ids are skipped.
  const libById = new Map(exercises.map((e) => [e.id, e] as const));

  // Per-exercise aggregate, built ONLY for eligible (weighted) exercises.
  const byExercise = new Map<string, EligibleAgg>();

  for (const row of rows) {
    const idx = weekIndex.get(weekKeyOf(parseISO(row.completed_at)));
    if (idx === undefined) continue; // week outside the axis — shouldn't happen.
    const ex = libById.get(row.exercise_id);
    if (!ex) continue; // dangling exercise_id — skip (lib safety).

    // Invariant D — LOGGED weight only. NOT effectiveWeightKg.
    const w = row.weight ? parseFloat(row.weight) : 0;
    const r = row.reps ?? 0;
    if (!(w > 0 && r > 0)) continue; // bodyweight (w=0) / reps=0 → no point, no eligibility.

    const est = epley1RM(w, r);

    let agg = byExercise.get(row.exercise_id);
    if (!agg) {
      agg = {
        id: row.exercise_id,
        name: ex.name,
        cell: new Array<number | undefined>(weeks.length),
        sessions: new Set<string>(),
        lastActiveMs: 0,
      };
      byExercise.set(row.exercise_id, agg);
    }

    // Invariant E1 — MAX, not `+=`.
    const prev = agg.cell[idx];
    if (prev === undefined || est > prev) agg.cell[idx] = est;
    agg.sessions.add(row.session_id);
    const ms = parseISO(row.completed_at).getTime();
    if (Number.isFinite(ms) && ms > agg.lastActiveMs) agg.lastActiveMs = ms;
  }

  // Rank eligible exercises by the total-order comparator (Decision #2):
  //   1. distinct-session count DESC
  //   2. most-recent activity DESC
  //   3. name ASC (localeCompare)
  //   4. id ASC (final total-order guarantee)
  const ranked = Array.from(byExercise.values())
    .sort((a, b) => {
      if (b.sessions.size !== a.sessions.size)
        return b.sessions.size - a.sessions.size;
      if (b.lastActiveMs !== a.lastActiveMs)
        return b.lastActiveMs - a.lastActiveMs;
      const byName = a.name.localeCompare(b.name);
      if (byName !== 0) return byName;
      return a.id.localeCompare(b.id);
    })
    .slice(0, topN);

  // Build each series via LOCF over the shared week axis.
  const series: E1rmSeries[] = ranked.map((agg, rank) => {
    const values = new Array<number>(weeks.length);
    let last: number | null = null;
    for (let w = 0; w < weeks.length; w++) {
      const cellMax = agg.cell[w];
      if (cellMax !== undefined) {
        values[w] = cellMax;
        last = cellMax;
      } else {
        // Carry forward; may still be null for leading weeks before the first
        // real value — backfilled below.
        values[w] = last as number; // placeholder; leading nulls fixed next.
      }
    }
    // Backfill leading weeks (before the first real value) with the first
    // non-null value (flat lead-in). Eligibility guarantees ≥1 real cell, so
    // `firstReal` is always found and no null survives.
    let firstReal = 0;
    for (let w = 0; w < values.length; w++) {
      if (agg.cell[w] !== undefined) {
        firstReal = agg.cell[w] as number;
        break;
      }
    }
    let seenReal = false;
    for (let w = 0; w < values.length; w++) {
      if (agg.cell[w] !== undefined) seenReal = true;
      if (!seenReal) values[w] = firstReal;
    }
    return { id: agg.id, name: agg.name, rank, values };
  });

  return {
    weeks: weeks.map((w) => ({ key: w.key, label: w.label })),
    series,
  };
}
