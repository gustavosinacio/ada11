import { Stack } from "expo-router";
import { RefreshControl, ScrollView } from "react-native";

import { ExercisesThisWeekList } from "~/components/exercises-this-week-list";
import { ProgressHero } from "~/components/progress-hero";
import { StreakCard } from "~/components/streak-card";
import { WeeklyVolumeStrip } from "~/components/weekly-volume-strip";
import { useWeightUnit } from "~/hooks/use-preferences";
import {
  useLifetimeBestWeek,
  useProgressPageRefresh,
} from "~/hooks/use-progress-page";
import { formatVolume } from "~/utils/units";

/**
 * Progress page — dedicated top-level surface for momentum visibility.
 *
 * Composes four independent blocks driven by a single lifetime kernel
 * (`useLifetimeWeeklyVolume`) plus the sessions-started_ats read for streaks:
 *
 *   1. <ProgressHero>            — PRs this week + weekly Max·Now·To PR
 *   2. <WeeklyVolumeStrip …>     — 8-bar chart with lifetime-best overlay
 *   3. <ExercisesThisWeekList>   — per-muscle list with row-level Max·Now·To PR
 *   4. <StreakCard>              — current + best consecutive trained weeks
 *
 * Pull-to-refresh fans out to `["stats"]` + `["exercises"]`. All blocks
 * react to the shared invalidation cascade so finishing a session live-
 * updates the page without any explicit wiring.
 */
export default function ProgressScreen(): React.JSX.Element {
  const unit = useWeightUnit();
  const { data: bestWeek } = useLifetimeBestWeek();
  const { refreshing, onRefresh } = useProgressPageRefresh();

  const bestWeekLabel = bestWeek
    ? `Best week: ${formatVolume(bestWeek.totalKg, unit)} (${bestWeek.weekStartLabel})`
    : undefined;

  return (
    <ScrollView
      className="flex-1 bg-white dark:bg-black"
      contentContainerClassName="pb-12"
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      <Stack.Screen options={{ title: "Progress", headerShown: true }} />
      <ProgressHero />
      <WeeklyVolumeStrip
        bestWeekKg={bestWeek?.totalKg}
        bestWeekLabel={bestWeekLabel}
      />
      <ExercisesThisWeekList />
      <StreakCard />
    </ScrollView>
  );
}
