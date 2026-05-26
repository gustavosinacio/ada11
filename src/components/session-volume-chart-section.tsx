import { useMemo } from "react";
import { Dimensions, Text, View } from "react-native";

import { ProgressChart } from "~/components/progress-chart";
import { useWeightUnit } from "~/hooks/use-preferences";
import { useLifetimeWeeklyVolume } from "~/hooks/use-stats";
import { presentSessionVolumeChart } from "~/utils/progress-page-math";
import { formatVolume } from "~/utils/units";

/**
 * Per-session volume time-series — one point per finished session, oldest
 * left. Sits below the weekly strip on the Progress page so the same vertical
 * scan tells two stories: weekly cadence (above) and per-session output
 * (below). Volume kernel = `groupSessionVolumes`, the same as History rows
 * and the verdict screen — cross-surface consistency by construction.
 *
 * Cost concern flagged in features.md was unfounded: the dataset is already
 * paginated server-side by `useLifetimeWeeklyVolume()` (TanStack staleTime
 * 60s), and the per-session grouping is O(N) in-memory.
 */
export function SessionVolumeChartSection(): React.JSX.Element | null {
  const unit = useWeightUnit();
  const { data, isLoading } = useLifetimeWeeklyVolume();

  // Keep `value` in kg — formatVolume converts to the user's unit for both
  // the axis labels and any callout. Axis arithmetic stays in kg so the chart
  // doesn't have to re-scale when the user toggles unit.
  const points = useMemo(() => {
    if (!data) return [];
    return presentSessionVolumeChart(data).map((p) => ({
      label: p.label,
      value: p.value,
    }));
  }, [data]);

  if (isLoading) return null;
  if (points.length === 0) return null;

  const width = Dimensions.get("window").width - 32;

  return (
    <View className="mt-2 px-4 pb-2">
      <Text className="mb-1 text-xs uppercase tracking-wide text-gray-500">
        Volume per session
      </Text>
      <ProgressChart
        data={points}
        width={width}
        height={180}
        title=""
        formatValue={(v) => formatVolume(v, unit)}
      />
    </View>
  );
}
