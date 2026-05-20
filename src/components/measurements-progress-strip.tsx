import { useMemo } from "react";
import { Text, useWindowDimensions, View } from "react-native";

import { ProgressChart, type DataPoint } from "~/components/progress-chart";
import { useMeasurements } from "~/hooks/use-measurements";
import { useWeightUnit } from "~/hooks/use-preferences";
import { entriesToWeightSeries } from "~/utils/measurements-chart";
import { formatWeight } from "~/utils/units";

/**
 * `ListHeaderComponent` chart for the Measurements list. Bodyweight over time.
 *
 * Returns `null` (no chrome) when:
 *   - `useMeasurements()` is in error state, OR
 *   - the bodyweight series has fewer than 2 datapoints.
 *
 * Renders a loading skeleton when `useMeasurements()` is loading.
 * Otherwise renders a single `<ProgressChart>` with title `"Weight (kg)"`
 * or `"Weight (lbs)"` depending on the unit pref.
 */
export function MeasurementsProgressStrip(): React.JSX.Element | null {
  const { data, isLoading, isError } = useMeasurements();
  const unit = useWeightUnit();
  const { width: screenWidth } = useWindowDimensions();
  const chartWidth = Math.min(screenWidth - 48, 500);

  const series: DataPoint[] = useMemo(
    () => (data ? entriesToWeightSeries(data, unit, 12) : []),
    [data, unit],
  );

  // Loading skeleton (mirrors weekly-volume-strip.tsx:75-83).
  if (isLoading) {
    return (
      <View className="border-b border-gray-200 px-4 py-5 dark:border-gray-800">
        <View className="h-7 w-32 rounded-sm bg-gray-100 dark:bg-gray-900" />
        <View className="mt-4 h-32 w-full rounded-sm bg-gray-100 dark:bg-gray-900" />
      </View>
    );
  }

  // Error / empty / single-point → bare null, no chrome.
  if (isError) return null;
  if (series.length < 2) return null;

  // listMeasurements returns DESC by measured_at — first non-null row is latest.
  const latestRow = (data ?? []).find(
    (r) => r.weight_kg != null && Number.isFinite(parseFloat(r.weight_kg)),
  );
  const latestKg = latestRow ? parseFloat(latestRow.weight_kg!) : NaN;
  const latestDisplay = Number.isFinite(latestKg)
    ? formatWeight(latestKg, unit)
    : "";

  return (
    <View className="border-b border-gray-200 px-4 py-5 dark:border-gray-800">
      <Text className="text-2xl font-semibold text-black dark:text-white">
        {latestDisplay}
      </Text>
      <View className="mt-3">
        <ProgressChart
          data={series}
          width={chartWidth}
          height={160}
          title={`Weight (${unit})`}
          formatValue={(v) => v.toFixed(1)}
        />
      </View>
    </View>
  );
}
