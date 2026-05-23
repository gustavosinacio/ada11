import { Stack } from "expo-router";
import { RefreshControl, ScrollView } from "react-native";

import { ExercisesThisWeekList } from "~/components/exercises-this-week-list";
import { ProgressHero } from "~/components/progress-hero";
import { StreakCard } from "~/components/streak-card";
import { WeeklyVolumeStrip } from "~/components/weekly-volume-strip";
import {
  useMaxVolumeWindowWeeks,
  useWeightUnit,
} from "~/hooks/use-preferences";
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
  const weeks = useMaxVolumeWindowWeeks();
  const { data: bestWeek } = useLifetimeBestWeek();
  const { refreshing, onRefresh } = useProgressPageRefresh();

  const bestWeekLabel = bestWeek
    ? weeks === 0
      ? `Best week: ${formatVolume(bestWeek.totalKg, unit)} (${bestWeek.weekStartLabel})`
      : `Best of last ${weeks} weeks: ${formatVolume(bestWeek.totalKg, unit)} (${bestWeek.weekStartLabel})`
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
      {/*
       * NEW-MIN-3 ack: under a narrow window (e.g. 10w) the strip's per-bar
       * height denom remains the lifetime-bucket max, while the dotted
       * `bestWeekKg` overlay only reflects the in-window best. A historical
       * peak from outside the window can therefore tower visually above the
       * overlay line. This asymmetry is intentional — the bar-height scale
       * is about readability across the full visible bucket range, and the
       * overlay is the dedicated cue for the windowed Max. Do not "fix" by
       * shrinking bars to the window. See design-v2.md §"Out of scope".
       */}
      <WeeklyVolumeStrip
        bestWeekKg={bestWeek?.totalKg}
        bestWeekLabel={bestWeekLabel}
      />
      <ExercisesThisWeekList />
      <StreakCard />
    </ScrollView>
  );
}
