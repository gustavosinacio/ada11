import { useMemo, useState } from "react";
import { Dimensions, Pressable, Text, View } from "react-native";

import {
  MultiSeriesChart,
  type ChartSeries,
} from "~/components/multi-series-chart";
import { useMyFavoriteExerciseIds } from "~/hooks/use-exercise-favorites";
import { useAllExercises } from "~/hooks/use-exercises";
import { useWeightUnit } from "~/hooks/use-preferences";
import { useLifetimeWeeklyVolume } from "~/hooks/use-stats";
import { presentTopExerciseE1rm } from "~/utils/e1rm-strength";
import { formatWeight } from "~/utils/units";

/**
 * e1RM strength-progress chart. The strength complement to
 * <WeeklyMuscleVolumeSection>: one line per AUTO-selected (most-performed)
 * weighted exercise, showing its best estimated-1RM per ISO week over time.
 * Selectable multi-line trend with check-all / uncheck-all + per-exercise
 * toggles (local, non-persisted state — mirrors the muscle section's idiom).
 *
 * Logged-weight only (Invariant D — NO `useMeasurements`): bodyweight-only
 * movements produce no line. Full-history trend viz: does NOT honor
 * `max_volume_window_weeks` (mirrors the volume chart).
 */

// Palette indexed by rank (Decision #4). The first 8 are the Phase-2a hexes
// (unchanged → existing top-5 lines keep their colors). The 4 appended hues are
// spaced away from amber (#f59e0b) and violet (#8b5cf6) for adjacent-rank
// contrast. length (12) >= E1RM_MAX_LINES so `% length` never wraps within the
// ceiling — no two plotted lines ever share a color.
const E1RM_PALETTE = [
  "#ef4444", // red-500     (rank 0) — unchanged
  "#3b82f6", // blue-500    (rank 1) — unchanged
  "#10b981", // emerald-500 (rank 2) — unchanged
  "#f59e0b", // amber-500   (rank 3) — unchanged
  "#8b5cf6", // violet-500  (rank 4) — unchanged
  "#ec4899", // pink-500    (rank 5) — unchanged
  "#06b6d4", // cyan-500    (rank 6) — unchanged
  "#84cc16", // lime-500    (rank 7) — unchanged
  "#15803d", // green-700   (rank 8) — deep green, distinct from emerald/lime
  "#64748b", // slate-500   (rank 9) — neutral slate, no nearby hue
  "#e11d48", // rose-600    (rank 10) — rose, distinct from red/pink
  "#92400e", // amber-800   (rank 11) — brown, distinct from amber-500
] as const;

const colorForRank = (i: number): string =>
  E1RM_PALETTE[i % E1RM_PALETTE.length]!;

export function E1rmStrengthSection(props: {
  /** View-only chart window (page-owned). undefined → full history. */
  windowStartMs?: number;
}): React.JSX.Element | null {
  const { data: rows, isLoading } = useLifetimeWeeklyVolume();
  const { data: exercises } = useAllExercises();
  const { data: favoriteIds } = useMyFavoriteExerciseIds();
  const unit = useWeightUnit();

  // Memoize the favorite set; gated by the react-query `data` identity
  // (TanStack structural sharing keeps `favoriteIds` referentially stable
  // until the cache changes). On toggle, setQueryData produces a NEW array →
  // favoriteSet recomputes → model recomputes → chart re-renders.
  const favoriteSet = useMemo(
    () => new Set(favoriteIds ?? []),
    [favoriteIds],
  );

  const model = useMemo(() => {
    if (!rows || !exercises) return null;
    return presentTopExerciseE1rm({
      rows,
      exercises,
      favoriteExerciseIds: favoriteSet,
      windowStartMs: props.windowStartMs,
    });
  }, [rows, exercises, favoriteSet, props.windowStartMs]);

  // All exercise lines on by default. Keyed off exercise `id` (stable across
  // renames) so a newly appearing exercise starts visible.
  const seriesKeys = useMemo(
    () => model?.series.map((s) => s.id) ?? [],
    [model],
  );
  const seriesKeysSig = seriesKeys.join("|");
  const [visible, setVisible] = useState<Set<string>>(
    () => new Set(seriesKeys),
  );
  // When the set of available series changes (data refetch adds/removes an
  // exercise), re-seed visibility to "all on" so a freshly appearing line is
  // not silently hidden. Tracks the signature, not the array identity.
  const [lastSig, setLastSig] = useState(seriesKeysSig);
  if (lastSig !== seriesKeysSig) {
    setLastSig(seriesKeysSig);
    setVisible(new Set(seriesKeys));
  }

  const chartSeries: ChartSeries[] = useMemo(
    () =>
      (model?.series ?? []).map((s) => ({
        // R-7: `label` is the legend text + the chart's internal React key.
        // Duplicate display names collide on that key; selection + color key
        // off `s.id` (stable), so toggling/coloring stays correct. A name
        // clash for a sole user's top-5 is an accepted LOW/LOW residual.
        label: s.name,
        color: colorForRank(s.rank),
        values: s.values, // kg — `formatValue` converts for display.
        visible: visible.has(s.id),
      })),
    [model, visible],
  );

  if (isLoading) return null;
  if (!model || model.series.length === 0) return null;

  const width = Dimensions.get("window").width - 32;
  const xLabels = model.weeks.map((w) => w.label);
  const allOn = seriesKeys.every((k) => visible.has(k));

  return (
    <View className="mt-2 px-4 pb-2">
      <View className="mb-2 flex-row items-center justify-between">
        <Text className="text-xs uppercase tracking-wide text-gray-500">
          Estimated 1RM per exercise
        </Text>
        <Pressable
          onPress={() =>
            setVisible(allOn ? new Set() : new Set(seriesKeys))
          }
          accessibilityRole="button"
          accessibilityLabel={
            allOn ? "Hide all exercises" : "Show all exercises"
          }
          hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
          className="rounded-full border border-gray-300 px-2.5 py-1 dark:border-gray-700"
        >
          <Text className="text-xs font-medium text-gray-700 dark:text-gray-300">
            {allOn ? "Uncheck all" : "Check all"}
          </Text>
        </Pressable>
      </View>

      <MultiSeriesChart
        xLabels={xLabels}
        series={chartSeries}
        width={width}
        height={200}
        title=""
        formatValue={(v) => formatWeight(v, unit)}
      />

      {/* Selectable exercise legend / toggles. */}
      <View className="mt-2 flex-row flex-wrap gap-2">
        {model.series.map((s) => {
          const on = visible.has(s.id);
          return (
            <Pressable
              key={s.id}
              onPress={() =>
                setVisible((prev) => {
                  const next = new Set(prev);
                  if (next.has(s.id)) next.delete(s.id);
                  else next.add(s.id);
                  return next;
                })
              }
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={`Toggle ${s.name}`}
              hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
              className={`flex-row items-center rounded-full border px-2.5 py-1 ${
                on
                  ? "border-gray-300 dark:border-gray-600"
                  : "border-gray-200 opacity-40 dark:border-gray-800"
              }`}
            >
              <View
                style={{ backgroundColor: colorForRank(s.rank) }}
                className="mr-1.5 h-2.5 w-2.5 rounded-full"
              />
              <Text className="text-xs font-medium text-gray-700 dark:text-gray-300">
                {s.name}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
