import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { endOfWeek } from "date-fns";
import { useCallback, useMemo, useState } from "react";

import { listFinishedSessionStartedAts } from "~/api/progress-page";
import type { MeasurementEntryRow, MuscleGroup } from "~/db/types";
import { useAllExercises } from "~/hooks/use-exercises";
import { useMeasurements } from "~/hooks/use-measurements";
import { useMaxVolumeWindowWeeks } from "~/hooks/use-preferences";
import { useLifetimeWeeklyVolume } from "~/hooks/use-stats";
import { MUSCLE_GROUPS } from "~/db/types";
import { bodyweightKgAsOf, effectiveWeightKg } from "~/utils/bodyweight";
import { isoWeekStart, parseISO } from "~/utils/dates";
import {
  bucketLifetimeWeeklyVolumes,
  computeCurrentWeekVolume,
  computeLifetimeMaxPerExercise,
  computePrsThisWeek,
  computeStreaks,
  findBestWeek,
  type BestWeek,
  type WeeklyBodyweightInput,
} from "~/utils/progress-page-math";
import { computeWindowStart } from "~/utils/window-utils";

/**
 * Hooks orchestrating the Progress page. Every raw fetch sits under the
 * `["stats", "progress-page", ...]` prefix; derived hooks reuse parent query
 * caches via `useMemo`. Existing `["stats"]` invalidations cascade for free.
 */

const WEEK_OPTS = { weekStartsOn: 1 as const };

/**
 * Wraps the raw `useMeasurements` data into a stable `WeeklyBodyweightInput`
 * reference for the WVR kernels (MIN-3: WVR hooks take ONLY `{ measurements }`;
 * equipment arrives on the widened row). Memoised on `measurements` identity so
 * downstream `useMemo`s don't re-run every render. Returns `undefined` while
 * measurements are still loading → kernels keep the pre-feature numbers.
 */
function useWeeklyBodyweightInput(
  measurements: MeasurementEntryRow[] | undefined,
): WeeklyBodyweightInput | undefined {
  return useMemo(
    () => (measurements ? { measurements } : undefined),
    [measurements],
  );
}

// ---------------------------------------------------------------------------
// useLifetimeBestWeek
// ---------------------------------------------------------------------------

/**
 * Best ISO-week of lifetime weekly volume, OR — when the user has configured
 * a "max-volume window" preference (`weeks > 0`) — the best ISO-week within
 * the trailing N weeks anchored at `session.started_at`.
 *
 * Name retained (no rename to `useBestWindowWeek`) to avoid rippling through
 * every Progress-page consumer. The window semantic lives inside the memo;
 * when `weeks === 0` (default) the result is identical to the pre-feature
 * lifetime best. See `MaxVolumeWindowWeeks` for the integer encoding.
 */
export function useLifetimeBestWeek(): {
  data: BestWeek | null;
  isLoading: boolean;
  isError: boolean;
} {
  const q = useLifetimeWeeklyVolume();
  const measurementsQ = useMeasurements();
  const weeks = useMaxVolumeWindowWeeks();
  // `new Date()` lives INSIDE the factory so it does not appear in the dep
  // list — the memo only re-runs when `weeks` or `q.data` changes. The
  // resulting threshold is correct for ~24h until the local Monday rolls
  // over, which matches existing memo lifetimes on this page.
  const windowStartMs = useMemo(
    () => computeWindowStart(weeks, new Date()),
    [weeks],
  );
  const bodyweight = useWeeklyBodyweightInput(measurementsQ.data);
  const data = useMemo<BestWeek | null>(() => {
    if (!q.data) return null;
    return findBestWeek(
      bucketLifetimeWeeklyVolumes(q.data, windowStartMs, bodyweight),
    );
  }, [q.data, windowStartMs, bodyweight]);
  return { data, isLoading: q.isLoading, isError: q.isError };
}

// ---------------------------------------------------------------------------
// useCurrentWeekVolume
// ---------------------------------------------------------------------------

export function useCurrentWeekVolume(): {
  data: number;
  isLoading: boolean;
  isError: boolean;
} {
  const q = useLifetimeWeeklyVolume();
  const measurementsQ = useMeasurements();
  const bodyweight = useWeeklyBodyweightInput(measurementsQ.data);
  const data = useMemo<number>(() => {
    if (!q.data) return 0;
    return computeCurrentWeekVolume(q.data, new Date(), bodyweight);
  }, [q.data, bodyweight]);
  return { data, isLoading: q.isLoading, isError: q.isError };
}

// ---------------------------------------------------------------------------
// usePrsThisWeek
// ---------------------------------------------------------------------------

export type PrSummary = {
  /** Lifetime max single-session volume BEFORE the current ISO week. */
  priorMaxKg: number;
  /** Max single-session volume DURING the current ISO week. */
  currentMaxKg: number;
  /** currentMaxKg - priorMaxKg, strictly > 0. */
  overflowKg: number;
};

/**
 * This-week PR count + per-exercise summary map. The map preserves the
 * kernel's `overflowKg DESC, exerciseId ASC` ordering so consumers can use
 * `Array.from(prsByExerciseId.values()).slice(0, 5)` to render the top-5
 * accordion without re-sorting.
 */
export function usePrsThisWeek(): {
  count: number;
  prIds: Set<string>;
  prsByExerciseId: Map<string, PrSummary>;
  isLoading: boolean;
} {
  const q = useLifetimeWeeklyVolume();
  const measurementsQ = useMeasurements();
  const bodyweight = useWeeklyBodyweightInput(measurementsQ.data);
  const weeks = useMaxVolumeWindowWeeks();
  const windowStartMs = useMemo(
    () => computeWindowStart(weeks, new Date()),
    [weeks],
  );
  const { count, prIds, prsByExerciseId } = useMemo(() => {
    if (!q.data)
      return {
        count: 0,
        prIds: new Set<string>(),
        prsByExerciseId: new Map<string, PrSummary>(),
      };
    const now = new Date();
    const start = isoWeekStart(now).toISOString();
    const end = endOfWeek(now, WEEK_OPTS).toISOString();
    const prs = computePrsThisWeek({
      rows: q.data,
      currentWeekStartIso: start,
      currentWeekEndIso: end,
      windowStartMs,
      bodyweight,
    });
    const ids = new Set<string>();
    const map = new Map<string, PrSummary>();
    for (const p of prs) {
      ids.add(p.exerciseId);
      map.set(p.exerciseId, {
        priorMaxKg: p.priorMaxKg,
        currentMaxKg: p.currentMaxKg,
        overflowKg: p.overflowKg,
      });
    }
    return { count: ids.size, prIds: ids, prsByExerciseId: map };
  }, [q.data, windowStartMs, bodyweight]);
  return { count, prIds, prsByExerciseId, isLoading: q.isLoading };
}

// ---------------------------------------------------------------------------
// useFinishedSessionStartedAts
// ---------------------------------------------------------------------------

/**
 * Lifetime read of every finished, non-deleted session's `started_at`.
 *
 * Why a second query (vs deriving from the lifetime sets read): a finished
 * session with all sets unchecked has `completed_at = null` on every row, so
 * those rows are filtered out per BLK-3. The streak math counts ANY finished
 * session, even if no sets were checked — so the sets-based read is not a
 * source of truth for "what sessions happened".
 */
export function useFinishedSessionStartedAts(): UseQueryResult<
  { started_at: string }[],
  Error
> {
  return useQuery({
    queryKey: ["stats", "progress-page", "session-started-ats"],
    queryFn: listFinishedSessionStartedAts,
    staleTime: 60_000,
  });
}

// ---------------------------------------------------------------------------
// useStreaks
// ---------------------------------------------------------------------------

export function useStreaks(): {
  data: { current: number; best: number };
  isLoading: boolean;
  isError: boolean;
} {
  const q = useFinishedSessionStartedAts();
  const data = useMemo(() => {
    if (!q.data) return { current: 0, best: 0 };
    return computeStreaks(q.data, new Date());
  }, [q.data]);
  return { data, isLoading: q.isLoading, isError: q.isError };
}

// ---------------------------------------------------------------------------
// useExercisesThisWeek
// ---------------------------------------------------------------------------

export type ExerciseThisWeekRow = {
  exerciseId: string;
  exerciseName: string;
  muscles: string[];
  group: MuscleGroup | "Other";
  maxKg: number;
  nowKg: number;
  gapKg: number;
  isPrThisWeek: boolean;
  /** Populated only when isPrThisWeek === true. Lifetime max BEFORE this ISO week. */
  priorMaxKg?: number;
  /** Populated only when isPrThisWeek === true. currentMaxKg - priorMaxKg. */
  overflowKg?: number;
};

/**
 * Exercises trained this ISO week, derived CLIENT-SIDE from the lifetime
 * dataset + exercise library. No server round-trip.
 *
 * For each exercise trained this week:
 *   - `maxKg` = lifetime max single-session volume (incl. THIS week — matches
 *      `volume-target.ts:118-122`'s reduction over `pastSessions`).
 *   - `nowKg` = sum of this week's session volumes for this exercise.
 *   - `gapKg` = max(maxKg - nowKg, 0).
 *   - `isPrThisWeek` flag is sourced from `computePrExerciseIdsThisWeek`.
 *
 * Output is sorted: PR rows first, then by `nowKg` descending within each
 * primary-muscle group. Group order matches `groupExercisesByPrimaryMuscle`.
 */
export function useExercisesThisWeek(): {
  data: ExerciseThisWeekRow[];
  isLoading: boolean;
  isError: boolean;
} {
  const lifetime = useLifetimeWeeklyVolume();
  const lib = useAllExercises();
  const measurementsQ = useMeasurements();
  const bodyweight = useWeeklyBodyweightInput(measurementsQ.data);
  const weeks = useMaxVolumeWindowWeeks();
  const windowStartMs = useMemo(
    () => computeWindowStart(weeks, new Date()),
    [weeks],
  );
  // MIN-C: consume the per-exercise PR map directly from `usePrsThisWeek`.
  // TanStack prefix-cache + the shared `useLifetimeWeeklyVolume` dependency
  // means `computePrsThisWeek` runs once per render (inside its `useMemo`).
  const { prsByExerciseId } = usePrsThisWeek();

  const data = useMemo<ExerciseThisWeekRow[]>(() => {
    if (!lifetime.data || !lib.data) return [];
    const now = new Date();
    const weekStart = isoWeekStart(now);
    const weekEnd = endOfWeek(now, WEEK_OPTS);

    // 1. Bucket this week's rows by exercise_id → nowKg. "Now" is always
    //    this week and is orthogonal to the window pref (the window only
    //    governs "Max"); we do NOT filter `nowKgByExercise` by
    //    `windowStartMs`.
    // Bodyweight resolver memoised per session_id (F-2). When `bodyweight` is
    // absent, `effectiveWeightKg(eq, weight, null)` reduces to the pre-feature
    // addedLoad for non-bodyweight rows (byte-for-byte).
    const nowBwCache = new Map<string, number | null>();
    const resolveNowBw = (sessionId: string, startedAt: string): number | null => {
      if (!bodyweight) return null;
      if (nowBwCache.has(sessionId)) return nowBwCache.get(sessionId)!;
      const v = bodyweightKgAsOf(
        bodyweight.measurements,
        parseISO(startedAt).getTime(),
      );
      nowBwCache.set(sessionId, v);
      return v;
    };
    const nowKgByExercise = new Map<string, number>();
    for (const r of lifetime.data) {
      const t = parseISO(r.completed_at);
      if (t < weekStart || t > weekEnd) continue;
      const bw = resolveNowBw(r.session_id, r.sessions.started_at);
      const w = effectiveWeightKg(
        r.exercises?.equipment,
        r.weight,
        bw,
        r.exercises?.bodyweight_factor,
      );
      const reps = r.reps ?? 0;
      if (w > 0 && reps > 0) {
        nowKgByExercise.set(
          r.exercise_id,
          (nowKgByExercise.get(r.exercise_id) ?? 0) + w * reps,
        );
      }
    }

    // 2. Max single-session volume per exercise. Honours the user's
    //    "max-volume window" preference via `windowStartMs`.
    const maxKgByExercise = computeLifetimeMaxPerExercise(
      lifetime.data,
      windowStartMs,
      bodyweight,
    );

    // 3. Join with library for name/muscles + enrich PR'd rows with
    //    priorMaxKg + overflowKg from the shared kernel result.
    const libById = new Map(lib.data.map((e) => [e.id, e] as const));
    const validMuscles = new Set<string>(MUSCLE_GROUPS);
    const rows: ExerciseThisWeekRow[] = [];
    for (const [exId, nowKg] of nowKgByExercise) {
      const ex = libById.get(exId);
      if (!ex) continue; // dangling exercise_id — skip (matches history/[id].tsx safety)
      const maxKg = maxKgByExercise.get(exId) ?? 0;
      const gapKg = Math.max(maxKg - nowKg, 0);
      const muscles = ex.muscles ?? [];
      const primary = muscles[0];
      const group: MuscleGroup | "Other" =
        primary && validMuscles.has(primary)
          ? (primary as MuscleGroup)
          : "Other";
      const pr = prsByExerciseId.get(exId);
      if (pr) {
        rows.push({
          exerciseId: exId,
          exerciseName: ex.name,
          muscles,
          group,
          maxKg,
          nowKg,
          gapKg,
          isPrThisWeek: true,
          priorMaxKg: pr.priorMaxKg,
          overflowKg: pr.overflowKg,
        });
      } else {
        rows.push({
          exerciseId: exId,
          exerciseName: ex.name,
          muscles,
          group,
          maxKg,
          nowKg,
          gapKg,
          isPrThisWeek: false,
        });
      }
    }

    // 4. Sort within groups: PR first, then nowKg descending. Then group
    //    order follows `MUSCLE_GROUPS` then "Other".
    const groupOrder = new Map<MuscleGroup | "Other", number>();
    MUSCLE_GROUPS.forEach((g, i) => groupOrder.set(g, i));
    groupOrder.set("Other", MUSCLE_GROUPS.length);

    rows.sort((a, b) => {
      const ga = groupOrder.get(a.group) ?? Number.MAX_SAFE_INTEGER;
      const gb = groupOrder.get(b.group) ?? Number.MAX_SAFE_INTEGER;
      if (ga !== gb) return ga - gb;
      if (a.isPrThisWeek !== b.isPrThisWeek) return a.isPrThisWeek ? -1 : 1;
      return b.nowKg - a.nowKg;
    });

    return rows;
  }, [lifetime.data, lib.data, prsByExerciseId, windowStartMs, bodyweight]);

  return {
    data,
    isLoading: lifetime.isLoading || lib.isLoading,
    isError: lifetime.isError || lib.isError,
  };
}

// ---------------------------------------------------------------------------
// useProgressPageRefresh
// ---------------------------------------------------------------------------

/**
 * Pull-to-refresh fan-out. Invalidates `["stats"]` + `["exercises"]` (covers
 * every underlying Progress-page query under BLK-1's namespace decision).
 */
export function useProgressPageRefresh(): {
  refreshing: boolean;
  onRefresh: () => Promise<void>;
} {
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["stats"] }),
        qc.invalidateQueries({ queryKey: ["exercises"] }),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [qc]);
  return { refreshing, onRefresh };
}
