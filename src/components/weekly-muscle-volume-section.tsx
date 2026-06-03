import { useMemo, useState } from "react";
import { Dimensions, Pressable, Text, View } from "react-native";

import {
  MultiSeriesChart,
  type ChartSeries,
} from "~/components/multi-series-chart";
import { useAllExercises } from "~/hooks/use-exercises";
import { useMeasurements } from "~/hooks/use-measurements";
import { useWeightUnit } from "~/hooks/use-preferences";
import { useLifetimeWeeklyVolume } from "~/hooks/use-stats";
import { formatVolume } from "~/utils/units";
import {
  presentWeeklyVolumeByMuscle,
  type MuscleSeriesKey,
} from "~/utils/weekly-muscle-volume";

/**
 * Weekly per-muscle volume chart. Replaces the removed per-session chart.
 * Buckets the (bodyweight-aware) lifetime weekly-volume rows by ISO week ×
 * primary muscle, renders selectable multi-line trend with check-all /
 * uncheck-all + per-muscle toggles (local, non-persisted state — mirrors the
 * removed section's `useState` idiom). Full-history trend viz: does NOT honor
 * `max_volume_window_weeks` (Decision #3).
 */

// 7 fixed colors keyed to MUSCLE_GROUPS order + "Other".
const MUSCLE_COLORS: Record<MuscleSeriesKey, string> = {
  Chest: "#ef4444", // red-500
  "Upper back": "#3b82f6", // blue-500
  "Lower back": "#06b6d4", // cyan-500
  Shoulders: "#f59e0b", // amber-500
  Arms: "#8b5cf6", // violet-500
  Legs: "#10b981", // emerald-500
  Core: "#ec4899", // pink-500
  Other: "#9ca3af", // gray-400 (only when an "Other" line exists)
};

export function WeeklyMuscleVolumeSection(props: {
  /** View-only chart window (page-owned). undefined → full history. */
  windowStartMs?: number;
}): React.JSX.Element | null {
  const { data: rows, isLoading } = useLifetimeWeeklyVolume();
  const { data: exercises } = useAllExercises();
  const { data: measurements } = useMeasurements();
  const unit = useWeightUnit();

  const model = useMemo(() => {
    if (!rows || !exercises) return null;
    return presentWeeklyVolumeByMuscle({
      rows,
      exercises,
      measurements: measurements ?? [],
      windowStartMs: props.windowStartMs,
    });
  }, [rows, exercises, measurements, props.windowStartMs]);

  // All muscle lines on by default. Keyed off the present series so a newly
  // appearing muscle starts visible.
  const seriesKeys = useMemo(
    () => model?.series.map((s) => s.key) ?? [],
    [model],
  );
  const seriesKeysSig = seriesKeys.join("|");
  const [visible, setVisible] = useState<Set<MuscleSeriesKey>>(
    () => new Set(seriesKeys),
  );
  // When the set of available series changes (data refetch adds/removes a
  // muscle), re-seed visibility to "all on" so a freshly appearing line is not
  // silently hidden. Tracks the signature, not the array identity.
  const [lastSig, setLastSig] = useState(seriesKeysSig);
  if (lastSig !== seriesKeysSig) {
    setLastSig(seriesKeysSig);
    setVisible(new Set(seriesKeys));
  }

  const chartSeries: ChartSeries[] = useMemo(
    () =>
      (model?.series ?? []).map((s) => ({
        label: s.key,
        color: MUSCLE_COLORS[s.key],
        values: s.values, // kg — `formatValue` converts for display.
        visible: visible.has(s.key),
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
          Weekly volume per muscle
        </Text>
        <Pressable
          onPress={() =>
            setVisible(allOn ? new Set() : new Set(seriesKeys))
          }
          accessibilityRole="button"
          accessibilityLabel={allOn ? "Hide all muscles" : "Show all muscles"}
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
        formatValue={(v) => formatVolume(v, unit)}
      />

      {/* Selectable muscle legend / toggles. */}
      <View className="mt-2 flex-row flex-wrap gap-2">
        {model.series.map((s) => {
          const on = visible.has(s.key);
          return (
            <Pressable
              key={s.key}
              onPress={() =>
                setVisible((prev) => {
                  const next = new Set(prev);
                  if (next.has(s.key)) next.delete(s.key);
                  else next.add(s.key);
                  return next;
                })
              }
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={`Toggle ${s.key}`}
              hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
              className={`flex-row items-center rounded-full border px-2.5 py-1 ${
                on
                  ? "border-gray-300 dark:border-gray-600"
                  : "border-gray-200 opacity-40 dark:border-gray-800"
              }`}
            >
              <View
                style={{ backgroundColor: MUSCLE_COLORS[s.key] }}
                className="mr-1.5 h-2.5 w-2.5 rounded-full"
              />
              <Text className="text-xs font-medium text-gray-700 dark:text-gray-300">
                {s.key}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
