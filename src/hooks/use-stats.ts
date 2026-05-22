import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { listWeeklyVolumeRows, type WeeklyVolumeRow } from "~/api/stats";

/**
 * Returns every finished, non-warmup, non-deleted set in the user's history
 * (paginated server-side). Powers the Progress page's lifetime-best week,
 * PR-this-week count, per-exercise lifetime maxes, and the scrollable
 * `<WeeklyVolumeStrip>` — all derive from this single dataset.
 *
 * Cache key sits under the `["stats"]` prefix, so existing invalidations in
 * `useFinishSession` / `useUpdateSessionTimes` / `useSoftDeleteSession`
 * cascade for free.
 *
 * Replaced the prior 8-week `useWeeklyVolume` hook (run
 * `2026-05-22_1130_chart-scroll-week-selector`). The `sinceUtc` branch of
 * `listWeeklyVolumeRows` survives for test compatibility / future windowed
 * reads, but production code no longer calls it.
 */
export function useLifetimeWeeklyVolume(): UseQueryResult<
  WeeklyVolumeRow[],
  Error
> {
  return useQuery({
    queryKey: ["stats", "weekly-volume", "lifetime"],
    queryFn: () => listWeeklyVolumeRows(),
    staleTime: 60_000,
  });
}
