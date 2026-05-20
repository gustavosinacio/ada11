import { useMemo } from "react";
import { Text, View } from "react-native";

import type { WeeklyVolumeRow } from "~/api/stats";
import { useWeightUnit } from "~/hooks/use-preferences";
import { useWeeklyVolume } from "~/hooks/use-stats";
import { lastNIsoWeeks, parseISO, weekKeyOf } from "~/utils/dates";
import { formatVolume } from "~/utils/units";

type Bucket = {
  key: string;
  label: string;
  totalKg: number;
  isCurrent: boolean;
};

type StripModel = {
  buckets: Bucket[];
  maxKg: number;
  currentWeekKg: number;
};

const WEEKS_WINDOW = 8;
const PLOT_HEIGHT = 96;
const MIN_BAR_HEIGHT = 4;

/**
 * Pure bucketing helper. Lives next to the component because nothing else
 * needs it (per validator MIN-2). Builds exactly `WEEKS_WINDOW` buckets
 * oldest→newest, zero-filled where the user did nothing, and applies the
 * existing volume kernel (parseFloat weight × reps, guarded > 0; warmups are
 * already filtered server-side).
 */
function computeStripModel(data: WeeklyVolumeRow[]): StripModel {
  const weeks = lastNIsoWeeks(WEEKS_WINDOW);
  const totals = new Map<string, number>();
  for (const w of weeks) totals.set(w.key, 0);

  for (const row of data) {
    const key = weekKeyOf(parseISO(row.completed_at));
    if (!totals.has(key)) continue; // outside the rolling 8-week window
    const w = row.weight ? parseFloat(row.weight) : 0;
    const r = row.reps ?? 0;
    if (Number.isFinite(w) && w > 0 && r > 0) {
      totals.set(key, (totals.get(key) ?? 0) + w * r);
    }
  }

  const buckets: Bucket[] = weeks.map((wk, idx) => ({
    key: wk.key,
    label: wk.label,
    totalKg: totals.get(wk.key) ?? 0,
    isCurrent: idx === weeks.length - 1,
  }));

  const maxKg = buckets.reduce((m, b) => (b.totalKg > m ? b.totalKg : m), 0);
  const currentWeekKg = buckets[buckets.length - 1]?.totalKg ?? 0;

  return { buckets, maxKg, currentWeekKg };
}

export function WeeklyVolumeStrip(): React.JSX.Element | null {
  const { data, isLoading, isError } = useWeeklyVolume();
  const unit = useWeightUnit();

  // Bucket math depends only on `data`. `unit` is read inline in JSX so the
  // toggle re-renders without invalidating the memo (MIN-5).
  const model: StripModel | null = useMemo(() => {
    if (!data || data.length === 0) return null;
    return computeStripModel(data);
  }, [data]);

  // BRANCH 1: loading — wrapper + skeleton blocks. Includes a placeholder
  // for the date-label row (MIN-1) so the layout doesn't jump on data arrival.
  if (isLoading) {
    return (
      <View className="border-b border-gray-200 px-4 py-5 dark:border-gray-800">
        <View className="h-3 w-20 rounded-sm bg-gray-100 dark:bg-gray-900" />
        <View className="mt-1 h-7 w-32 rounded-sm bg-gray-100 dark:bg-gray-900" />
        <View className="mt-4 h-24 w-full rounded-sm bg-gray-100 dark:bg-gray-900" />
        <View className="mt-1 h-3 w-full rounded-sm bg-gray-100 dark:bg-gray-900" />
      </View>
    );
  }

  // BRANCH 2: error / no data / all-zero — bare null, no wrapper chrome.
  if (isError) return null;
  if (!model) return null;
  if (model.maxKg === 0) return null;

  // BRANCH 3: data — wrapper + bars + labels.
  return (
    <View className="border-b border-gray-200 px-4 py-5 dark:border-gray-800">
      <Text className="text-xs uppercase tracking-wide text-gray-500">
        This week
      </Text>
      <Text className="mt-1 text-2xl font-semibold text-black dark:text-white">
        {formatVolume(model.currentWeekKg, unit)}
      </Text>

      <View className="mt-4 h-24 flex-row items-end gap-1.5">
        {model.buckets.map((b) => {
          const h =
            model.maxKg === 0
              ? MIN_BAR_HEIGHT
              : Math.max(
                  MIN_BAR_HEIGHT,
                  Math.round((b.totalKg / model.maxKg) * PLOT_HEIGHT),
                );
          const cls =
            b.totalKg === 0
              ? "flex-1 rounded-sm bg-gray-200 dark:bg-gray-800"
              : b.isCurrent
                ? "flex-1 rounded-sm bg-blue-500 dark:bg-blue-400"
                : "flex-1 rounded-sm bg-gray-300 dark:bg-gray-700";
          return <View key={b.key} style={{ height: h }} className={cls} />;
        })}
      </View>

      <View className="mt-1 flex-row gap-1.5">
        {model.buckets.map((b) => (
          <Text
            key={b.key}
            className="flex-1 text-center text-[10px] text-gray-500"
          >
            {b.label}
          </Text>
        ))}
      </View>
    </View>
  );
}
