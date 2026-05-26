import { useMemo, useState } from "react";
import { Dimensions, Pressable, Text, View } from "react-native";

import { ProgressChart } from "~/components/progress-chart";
import { useWeightUnit } from "~/hooks/use-preferences";
import { useLifetimeWeeklyVolume } from "~/hooks/use-stats";
import { presentSessionVolumeChart } from "~/utils/progress-page-math";
import { formatVolume } from "~/utils/units";

type WindowOption = 12 | 26 | 52 | "all";

const WINDOW_OPTIONS: { value: WindowOption; label: string }[] = [
  { value: 12, label: "12w" },
  { value: 26, label: "26w" },
  { value: 52, label: "52w" },
  { value: "all", label: "All" },
];

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Per-session volume time-series — one point per finished session, oldest
 * left. Sits below the weekly strip on the Progress page so the same vertical
 * scan tells two stories: weekly cadence (above) and per-session output
 * (below). Volume kernel = `groupSessionVolumes`, the same as History rows
 * and the verdict screen — cross-surface consistency by construction.
 *
 * Window selector: 12w (default) / 26w / 52w / All. Filters rows by
 * `sessions.started_at` before grouping so the chart density stays readable.
 * State is component-local (not persisted) — independent of the user's
 * `max_volume_window_weeks` preference, which governs PR/Max surfaces.
 */
export function SessionVolumeChartSection(): React.JSX.Element | null {
  const unit = useWeightUnit();
  const { data, isLoading } = useLifetimeWeeklyVolume();
  const [windowWeeks, setWindowWeeks] = useState<WindowOption>(12);

  // Filter rows by started_at >= now - windowWeeks * 7d before grouping. The
  // presenter still does the heavy lifting; we just trim the input set.
  const points = useMemo(() => {
    if (!data) return [];
    let filtered = data;
    if (windowWeeks !== "all") {
      const cutoffMs = Date.now() - windowWeeks * 7 * DAY_MS;
      filtered = data.filter(
        (row) => new Date(row.sessions.started_at).getTime() >= cutoffMs,
      );
    }
    return presentSessionVolumeChart(filtered).map((p) => ({
      label: p.label,
      value: p.value,
    }));
  }, [data, windowWeeks]);

  if (isLoading) return null;

  const width = Dimensions.get("window").width - 32;

  return (
    <View className="mt-2 px-4 pb-2">
      <View className="mb-2 flex-row items-center justify-between">
        <Text className="text-xs uppercase tracking-wide text-gray-500">
          Volume per session
        </Text>
        <View className="flex-row gap-1">
          {WINDOW_OPTIONS.map((opt) => {
            const selected = windowWeeks === opt.value;
            return (
              <Pressable
                key={String(opt.value)}
                onPress={() => setWindowWeeks(opt.value)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={`Show last ${opt.label}`}
                hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                className={`rounded-full px-2.5 py-1 ${
                  selected
                    ? "bg-black dark:bg-white"
                    : "border border-gray-300 dark:border-gray-700"
                }`}
              >
                <Text
                  className={`text-xs font-medium ${
                    selected
                      ? "text-white dark:text-black"
                      : "text-gray-700 dark:text-gray-300"
                  }`}
                >
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      {points.length === 0 ? (
        <Text className="py-4 text-center text-sm text-gray-500">
          No sessions in this range
        </Text>
      ) : (
        <ProgressChart
          data={points}
          width={width}
          height={180}
          title=""
          formatValue={(v) => formatVolume(v, unit)}
        />
      )}
    </View>
  );
}
