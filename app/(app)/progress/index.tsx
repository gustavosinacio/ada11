import { Stack } from "expo-router";
import { useMemo, useState } from "react";
import { RefreshControl, ScrollView } from "react-native";

import { E1rmStrengthSection } from "~/components/e1rm-strength-section";
import { ExercisesThisWeekList } from "~/components/exercises-this-week-list";
import { ProgressHero } from "~/components/progress-hero";
import { ProgressWindowSelector } from "~/components/progress-window-selector";
import { StreakCard } from "~/components/streak-card";
import { WeeklyMuscleVolumeSection } from "~/components/weekly-muscle-volume-section";
import { WeeklyVolumeStrip } from "~/components/weekly-volume-strip";
import { type MaxVolumeWindowWeeks } from "~/db/types";
import {
  useMaxVolumeWindowWeeks,
  useWeightUnit,
} from "~/hooks/use-preferences";
import {
  useLifetimeBestWeek,
  useProgressPageRefresh,
} from "~/hooks/use-progress-page";
import { formatVolume } from "~/utils/units";
import { computeWindowStart } from "~/utils/window-utils";

/**
 * Progress page — dedicated top-level surface for momentum visibility.
 *
 * Composes independent trend + summary blocks driven by a single lifetime
 * kernel (`useLifetimeWeeklyVolume`) plus the sessions-started_ats read for
 * streaks:
 *
 *   1. <ProgressHero>             — PRs this week + weekly Max·Now·To PR
 *   2. <WeeklyVolumeStrip …>      — 8-bar chart with lifetime-best overlay
 *   3. <WeeklyMuscleVolumeSection>— per-muscle weekly-volume trend lines
 *   4. <E1rmStrengthSection>      — per-exercise estimated-1RM trend lines
 *   5. <ExercisesThisWeekList>    — per-muscle list with row-level Max·Now·To PR
 *   6. <StreakCard>               — current + best consecutive trained weeks
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

  // View-only chart window — ephemeral local state, SEEDED once from the
  // user's stored max-volume pref. NOT bound: we never re-sync to the pref on
  // later changes (no useEffect), because the chart window is now user-owned
  // (design-v1.md §"Seed-vs-bind"). `new Date()` lives INSIDE the memo factory
  // (matches use-progress-page.ts:76-79) so the threshold only recomputes when
  // `windowWeeks` changes; pref `0` → computeWindowStart → undefined → no
  // filter → Invariant W (today's full-history charts).
  const [windowWeeks, setWindowWeeks] = useState<MaxVolumeWindowWeeks>(weeks);
  const windowStartMs = useMemo(
    () => computeWindowStart(windowWeeks, new Date()),
    [windowWeeks],
  );

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
      {/*
       * Page-level chart window. Mounted ABOVE both trend sections so it
       * survives either chart's empty/null branch (an over-narrow window
       * collapses the charts but keeps the selector tappable — the user can
       * always widen back; design-v1.md Unknown 6 / R-3). One control governs
       * BOTH charts in lockstep via the shared `windowStartMs` prop.
       */}
      <ProgressWindowSelector value={windowWeeks} onChange={setWindowWeeks} />
      <WeeklyMuscleVolumeSection windowStartMs={windowStartMs} />
      <E1rmStrengthSection windowStartMs={windowStartMs} />
      <ExercisesThisWeekList />
      <StreakCard />
    </ScrollView>
  );
}
