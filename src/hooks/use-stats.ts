import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { listWeeklyVolumeRows, type WeeklyVolumeRow } from "~/api/stats";
import { lastNIsoWeeks } from "~/utils/dates";

const WEEKS_WINDOW = 8;

/**
 * Returns the last 8 ISO weeks of non-warmup, finished-session sets.
 *
 * Cache key uses `sinceUtc.slice(0, 10)` (date portion) so the key rolls over
 * exactly when the rolling 8-week window slides forward. No `user_id` in the
 * key — matches the existing `useSessions` / `useExerciseProgress` convention
 * (RLS scopes the data; user-switch invalidates the whole cache).
 */
export function useWeeklyVolume(): UseQueryResult<WeeklyVolumeRow[], Error> {
  const weeks = lastNIsoWeeks(WEEKS_WINDOW);
  // `lastNIsoWeeks(8)` always returns exactly 8 entries oldest→newest, so
  // index 0 is the oldest week's Monday. The non-null assertion is safe and
  // narrows away TS's array-index-may-be-undefined warning.
  const sinceUtc = weeks[0]!.start.toISOString();
  return useQuery({
    queryKey: ["stats", "weekly-volume", sinceUtc.slice(0, 10)],
    queryFn: () => listWeeklyVolumeRows({ sinceUtc }),
    staleTime: 60_000,
  });
}

/**
 * Returns every finished, non-warmup, non-deleted set in the user's history
 * (paginated server-side). Powers the Progress page's lifetime-best week,
 * PR-this-week count, and per-exercise lifetime maxes — all derive from this
 * single dataset.
 *
 * Cache key sits under the `["stats"]` prefix, so existing invalidations in
 * `useFinishSession` / `useUpdateSessionTimes` / `useSoftDeleteSession`
 * cascade for free.
 */
export function useLifetimeWeeklyVolume(): UseQueryResult<
  WeeklyVolumeRow[],
  Error
> {
  return useQuery({
    queryKey: ["stats", "weekly-volume", "lifetime"],
    queryFn: () => listWeeklyVolumeRows({}),
    staleTime: 60_000,
  });
}
