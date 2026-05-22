import { Text, View } from "react-native";

import { useWeightUnit } from "~/hooks/use-preferences";
import {
  useCurrentWeekVolume,
  useLifetimeBestWeek,
  usePrsThisWeek,
} from "~/hooks/use-progress-page";
import { MaxNowToPrLine } from "~/components/max-now-to-pr-line";

/**
 * Hero block at the top of the Progress screen.
 *
 *   PRs THIS WEEK
 *   2
 *   ────────────
 *   Max 26,210 kg · Now 5,400 kg · To PR 20,810 kg
 *
 * Renders a per-block skeleton while loading; matches the
 * `<WeeklyVolumeStrip>` skeleton idiom.
 */
export function ProgressHero(): React.JSX.Element {
  const unit = useWeightUnit();
  const bestWeekQ = useLifetimeBestWeek();
  const nowQ = useCurrentWeekVolume();
  const prsQ = usePrsThisWeek();

  const isLoading = bestWeekQ.isLoading || nowQ.isLoading || prsQ.isLoading;

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

  const prs = prsQ.data;
  const nowKg = nowQ.data;
  const maxKg = bestWeekQ.data?.totalKg ?? 0;
  const gapKg = Math.max(maxKg - nowKg, 0);

  return (
    <View className="border-b border-gray-200 px-4 py-5 dark:border-gray-800">
      <Text className="text-xs uppercase tracking-wide text-gray-500">
        PRs this week
      </Text>
      <Text className="mt-1 text-3xl font-semibold text-black dark:text-white">
        {prs}
      </Text>

      <View className="mt-4 h-px bg-gray-200 dark:bg-gray-800" />

      <View className="mt-3">
        {maxKg > 0 ? (
          <MaxNowToPrLine
            maxKg={maxKg}
            nowKg={nowKg}
            gapKg={gapKg}
            unit={unit}
            a11yPrefix="Weekly volume — "
          />
        ) : (
          <Text className="text-sm text-gray-500 dark:text-gray-400">
            Log your first session to see weekly volume.
          </Text>
        )}
      </View>
    </View>
  );
}
