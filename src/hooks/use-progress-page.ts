import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { endOfWeek } from "date-fns";
import { useCallback, useMemo, useState } from "react";

import { listFinishedSessionStartedAts } from "~/api/progress-page";
import type { MuscleGroup } from "~/db/types";
import { useAllExercises } from "~/hooks/use-exercises";
import { useLifetimeWeeklyVolume } from "~/hooks/use-stats";
import { MUSCLE_GROUPS } from "~/db/types";
import { isoWeekStart, parseISO } from "~/utils/dates";
import {
  bucketLifetimeWeeklyVolumes,
  computeCurrentWeekVolume,
  computeLifetimeMaxPerExercise,
  computePrExerciseIdsThisWeek,
  computeStreaks,
  findBestWeek,
  type BestWeek,
} from "~/utils/progress-page-math";

/**
 * Hooks orchestrating the Progress page. Every raw fetch sits under the
 * `["stats", "progress-page", ...]` prefix; derived hooks reuse parent query
 * caches via `useMemo`. Existing `["stats"]` invalidations cascade for free.
 */

const WEEK_OPTS = { weekStartsOn: 1 as const };

// ---------------------------------------------------------------------------
// useLifetimeBestWeek
// ---------------------------------------------------------------------------

export function useLifetimeBestWeek(): {
  data: BestWeek | null;
  isLoading: boolean;
  isError: boolean;
} {
  const q = useLifetimeWeeklyVolume();
  const data = useMemo<BestWeek | null>(() => {
    if (!q.data) return null;
    return findBestWeek(bucketLifetimeWeeklyVolumes(q.data));
  }, [q.data]);
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
  const data = useMemo<number>(() => {
    if (!q.data) return 0;
    return computeCurrentWeekVolume(q.data, new Date());
  }, [q.data]);
  return { data, isLoading: q.isLoading, isError: q.isError };
}

// ---------------------------------------------------------------------------
// usePrsThisWeek
// ---------------------------------------------------------------------------

export function usePrsThisWeek(): {
  data: number;
  prIds: Set<string>;
  isLoading: boolean;
  isError: boolean;
} {
  const q = useLifetimeWeeklyVolume();
  const { count, prIds } = useMemo(() => {
    if (!q.data) return { count: 0, prIds: new Set<string>() };
    const now = new Date();
    const start = isoWeekStart(now).toISOString();
    const end = endOfWeek(now, WEEK_OPTS).toISOString();
    const ids = computePrExerciseIdsThisWeek({
      rows: q.data,
      currentWeekStartIso: start,
      currentWeekEndIso: end,
    });
    return { count: ids.size, prIds: ids };
  }, [q.data]);
  return { data: count, prIds, isLoading: q.isLoading, isError: q.isError };
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

  const data = useMemo<ExerciseThisWeekRow[]>(() => {
    if (!lifetime.data || !lib.data) return [];
    const now = new Date();
    const weekStart = isoWeekStart(now);
    const weekEnd = endOfWeek(now, WEEK_OPTS);

    // 1. Bucket this week's rows by exercise_id → nowKg.
    const nowKgByExercise = new Map<string, number>();
    for (const r of lifetime.data) {
      const t = parseISO(r.completed_at);
      if (t < weekStart || t > weekEnd) continue;
      const w = r.weight ? parseFloat(r.weight) : 0;
      const reps = r.reps ?? 0;
      if (Number.isFinite(w) && w > 0 && reps > 0) {
        nowKgByExercise.set(
          r.exercise_id,
          (nowKgByExercise.get(r.exercise_id) ?? 0) + w * reps,
        );
      }
    }

    // 2. Lifetime max single-session volume per exercise.
    const maxKgByExercise = computeLifetimeMaxPerExercise(lifetime.data);

    // 3. PR flags (per-exercise, this-week dedupe).
    const prSet = computePrExerciseIdsThisWeek({
      rows: lifetime.data,
      currentWeekStartIso: weekStart.toISOString(),
      currentWeekEndIso: weekEnd.toISOString(),
    });

    // 4. Join with library for name/muscles.
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
      rows.push({
        exerciseId: exId,
        exerciseName: ex.name,
        muscles,
        group,
        maxKg,
        nowKg,
        gapKg,
        isPrThisWeek: prSet.has(exId),
      });
    }

    // 5. Sort within groups: PR first, then nowKg descending. Then group
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
  }, [lifetime.data, lib.data]);

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
