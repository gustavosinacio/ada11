import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { MaxNowToPrLine } from "~/components/max-now-to-pr-line";
import { PrListRow } from "~/components/pr-list-row";
import { useAllExercises } from "~/hooks/use-exercises";
import {
  useMaxVolumeWindowWeeks,
  useWeightUnit,
} from "~/hooks/use-preferences";
import {
  useCurrentWeekVolume,
  useLifetimeBestWeek,
  usePrsThisWeek,
} from "~/hooks/use-progress-page";
import { useLifetimeWeeklyVolume } from "~/hooks/use-stats";
import {
  bucketLifetimeWeeklyVolumes,
  findBestWeek,
} from "~/utils/progress-page-math";
import { formatVolume } from "~/utils/units";

const TOP_N = 5;

/**
 * Hero block at the top of the Progress screen.
 *
 *   PRs THIS WEEK
 *   2  ▾                            ← Pressable when count > 0
 *   ────────────
 *   Max 26,210 kg · Now 5,400 kg · To PR 20,810 kg
 *   Max = best week ever · Now = this week · To PR = remaining
 *
 * Tap the count to expand an accordion of `<PrListRow>` entries (top 5 by
 * `overflowKg`); if more than 5, a "Show all (N)" affordance reveals the
 * rest in-place (no modal). Renders a per-block skeleton while loading;
 * matches the `<WeeklyVolumeStrip>` skeleton idiom.
 */
export function ProgressHero(): React.JSX.Element {
  const router = useRouter();
  const unit = useWeightUnit();
  const weeks = useMaxVolumeWindowWeeks();
  const bestWeekQ = useLifetimeBestWeek();
  const nowQ = useCurrentWeekVolume();
  const prsQ = usePrsThisWeek();
  const exercisesQ = useAllExercises();
  // All-time best week, regardless of the user's max-volume-window. When the
  // window is set (non-zero), we show this alongside the windowed Max so the
  // user keeps the lifetime context. When window === 0 they're the same
  // value, so we suppress the secondary line.
  const lifetimeQ = useLifetimeWeeklyVolume();
  const allTimeBestKg = useMemo(() => {
    if (!lifetimeQ.data) return 0;
    const best = findBestWeek(bucketLifetimeWeeklyVolumes(lifetimeQ.data));
    return best?.totalKg ?? 0;
  }, [lifetimeQ.data]);

  const [expanded, setExpanded] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const isLoading = bestWeekQ.isLoading || nowQ.isLoading || prsQ.isLoading;

  // Collapse both toggles when the count drops to 0 (e.g. RLS reload, week
  // rollover, undo a PR).
  const count = prsQ.count;
  useEffect(() => {
    if (count === 0) {
      if (expanded) setExpanded(false);
      if (showAll) setShowAll(false);
    }
  }, [count, expanded, showAll]);

  const exerciseNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const ex of exercisesQ.data ?? []) m.set(ex.id, ex.name);
    return m;
  }, [exercisesQ.data]);

  const prRows = useMemo(() => {
    // Map preserves the kernel's `overflowKg DESC, exerciseId ASC` order.
    return Array.from(prsQ.prsByExerciseId.entries()).map(([exerciseId, p]) => ({
      exerciseId,
      exerciseName: exerciseNameById.get(exerciseId) ?? "Unknown exercise",
      priorMaxKg: p.priorMaxKg,
      overflowKg: p.overflowKg,
    }));
  }, [prsQ.prsByExerciseId, exerciseNameById]);

  if (isLoading) {
    return (
      <View className="border-b border-gray-200 px-4 py-5 dark:border-gray-800">
        <View className="h-3 w-32 rounded-sm bg-gray-100 dark:bg-gray-900" />
        <View className="mt-1 h-9 w-16 rounded-sm bg-gray-100 dark:bg-gray-900" />
        <View className="mt-4 h-px bg-gray-200 dark:bg-gray-800" />
        <View className="mt-3 h-4 w-64 rounded-sm bg-gray-100 dark:bg-gray-900" />
      </View>
    );
  }

  const nowKg = nowQ.data;
  const maxKg = bestWeekQ.data?.totalKg ?? 0;
  const gapKg = Math.max(maxKg - nowKg, 0);
  const totalPrs = prRows.length;
  const visibleRows = showAll ? prRows : prRows.slice(0, TOP_N);
  const hasOverflowRows = totalPrs > TOP_N;

  return (
    <View className="border-b border-gray-200 px-4 py-5 dark:border-gray-800">
      <Text className="text-xs uppercase tracking-wide text-gray-500">
        PRs this week
      </Text>

      {count > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${count} PRs this week, tap to expand`}
          accessibilityState={{ expanded }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          onPress={() => setExpanded((e) => !e)}
          className="mt-1 flex-row items-center"
        >
          <Text className="text-3xl font-semibold text-black dark:text-white">
            {count}
          </Text>
          <Text
            accessibilityElementsHidden
            importantForAccessibility="no"
            className="ml-2 text-2xl text-gray-500 dark:text-gray-400"
          >
            {expanded ? "▾" : "▸"}
          </Text>
        </Pressable>
      ) : (
        <Text className="mt-1 text-3xl font-semibold text-black dark:text-white">
          {count}
        </Text>
      )}

      {expanded && count > 0 ? (
        <View className="mt-3 -mx-4 border-t border-gray-200 dark:border-gray-800">
          {visibleRows.map((r) => (
            <PrListRow
              key={r.exerciseId}
              exerciseId={r.exerciseId}
              exerciseName={r.exerciseName}
              priorMaxKg={r.priorMaxKg}
              overflowKg={r.overflowKg}
              unit={unit}
              onPress={(id) =>
                router.push(`/(app)/exercises/${id}/progress`)
              }
            />
          ))}
          {hasOverflowRows && !showAll ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Show all ${totalPrs} PRs`}
              onPress={() => setShowAll(true)}
              className="px-4 py-3 active:bg-gray-50 dark:active:bg-gray-950"
            >
              <Text className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
                {`Show all (${totalPrs})`}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <View className="mt-4 h-px bg-gray-200 dark:bg-gray-800" />

      <View className="mt-3">
        {maxKg > 0 ? (
          <>
            <MaxNowToPrLine
              maxKg={maxKg}
              nowKg={nowKg}
              gapKg={gapKg}
              unit={unit}
              a11yPrefix="Weekly volume — "
            />
            {weeks !== 0 && allTimeBestKg > 0 && allTimeBestKg !== maxKg ? (
              <Text
                accessibilityLabel={`All-time best week: ${formatVolume(allTimeBestKg, unit)}`}
                className="mt-1 text-sm text-gray-600 dark:text-gray-400"
              >
                All-time best: {formatVolume(allTimeBestKg, unit)}
              </Text>
            ) : null}
            <Text className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {weeks === 0
                ? "Max = best week ever · Now = this week · To PR = remaining"
                : `Max = best of last ${weeks} weeks · Now = this week · To PR = remaining`}
            </Text>
          </>
        ) : (
          <Text className="text-sm text-gray-500 dark:text-gray-400">
            Log your first session to see weekly volume.
          </Text>
        )}
      </View>
    </View>
  );
}
