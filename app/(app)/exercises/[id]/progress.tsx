import { Stack, useLocalSearchParams, useRouter, type Href } from "expo-router";
import { ChevronLeft, Pencil, Star } from "lucide-react-native";
import { useMemo } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  useColorScheme,
  useWindowDimensions,
  View,
} from "react-native";

import { ExerciseNoteSlot } from "~/components/exercise-note-slot";
import { ExerciseSessionRow } from "~/components/exercise-session-row";
import { ProgressChart, type DataPoint } from "~/components/progress-chart";
import { SetVolumeBreakdown } from "~/components/set-volume-breakdown";
import { useIsAdmin } from "~/hooks/use-admin";
import {
  useMyFavoriteExerciseIds,
  useToggleFavorite,
} from "~/hooks/use-exercise-favorites";
import { useAllExercise } from "~/hooks/use-exercises";
import { useMeasurements } from "~/hooks/use-measurements";
import { useMaxVolumeWindowWeeks, useWeightUnit } from "~/hooks/use-preferences";
import { useExerciseProgress } from "~/hooks/use-progress";
import { bodyweightKgAsOf, effectiveWeightKg } from "~/utils/bodyweight";
import { parseISO } from "~/utils/dates";
import { presentSetVolumeLines } from "~/utils/exercise-session-row-format";
import { formatDisplayDate, formatShortDate } from "~/utils/format-display-date";
import { epley1RM } from "~/utils/formulas";
import { formatVolume, formatWeight, kgToLbs } from "~/utils/units";
import { computeWindowStart } from "~/utils/window-utils";

/**
 * Per-exercise progress screen.
 *
 * The e1RM summary line and BOTH charts (estimated-1RM, total-volume trend)
 * are a deliberate "see all history" view — they show every session over
 * time and are not governed by the `max_volume_window_weeks` preference.
 *
 * The "Max volume session" callout, however, DOES respect that window: it's
 * the best single-session volume and must agree with the live
 * `<VolumeTargetSlot>` "Max" (same windowed baseline) — otherwise the same
 * exercise shows two different max-volume numbers across surfaces.
 */
export default function ExerciseProgressScreen() {
  // `backHref`: when this screen is opened from a DIFFERENT tab (e.g. the live
  // workout), the caller passes the path to return to. The progress route
  // lives in the `exercises` tab, so the default header back pops that tab's
  // stack → the exercises list, regardless of where the user came from. With
  // a `backHref` we render a custom back button that navigates to the origin
  // instead. Openers within the exercises tab (the list) pass nothing and keep
  // the default back, which already lands on the list.
  const { id, backHref } = useLocalSearchParams<{
    id: string;
    backHref?: string;
  }>();
  const router = useRouter();
  const colorScheme = useColorScheme();
  // Resolve the exercise even when it's soft-deleted so the screen header and
  // page title still render the name. The chart data itself comes from sets,
  // which already work for deleted ids.
  const exercise = useAllExercise(id);
  const progressQ = useExerciseProgress(id);
  const measurementsQ = useMeasurements();
  const unit = useWeightUnit();
  const isAdmin = useIsAdmin().data === true;
  // Favorite toggle — a user-private action, independent of edit rights, so
  // canonical exercises ARE favoritable. The star lives in the header-right
  // slot OUTSIDE the `canEdit` gate (below).
  const { data: favoriteIds } = useMyFavoriteExerciseIds();
  const toggleFavorite = useToggleFavorite();
  const isFavorite = !!id && (favoriteIds ?? []).includes(id);
  // Max-volume window preference — same source the live <VolumeTargetSlot>
  // reads, so the progress-page "Max volume session" callout agrees with it.
  const maxVolumeWindowWeeks = useMaxVolumeWindowWeeks();
  const windowStartMs = useMemo(
    () => computeWindowStart(maxVolumeWindowWeeks, new Date()),
    [maxVolumeWindowWeeks],
  );
  const { width: screenWidth } = useWindowDimensions();
  const chartWidth = Math.min(screenWidth - 48, 500);

  // Pencil shows for rows the user can actually edit: their own (user_id set)
  // or — for admins — any row, including canonical catalog entries
  // (user_id IS NULL), backed by the "Admins update all exercises" RLS policy
  // (migration 0018). The edit screen gates the same way, so deep-links /
  // route history can't bypass it.
  //
  // The predicate is hide-only-when-known-canonical-and-not-admin. During the
  // initial loading window `exercise.data` is undefined; treating that as
  // `canEdit = true` avoids a flash where the pencil disappears then reappears
  // for user-owned rows.
  const canEdit = exercise.data
    ? exercise.data.user_id !== null || isAdmin
    : true;
  const screenHeader = (
    <Stack.Screen
      options={{
        title: exercise.data?.name ?? "Progress",
        headerShown: true,
        headerLeft: backHref
          ? () => (
              <Pressable
                onPress={() => router.navigate(backHref as Href)}
                accessibilityLabel="Go back"
                accessibilityRole="button"
                className="px-3 py-1"
              >
                <ChevronLeft
                  color={colorScheme === "dark" ? "#fff" : "#000"}
                  size={26}
                />
              </Pressable>
            )
          : undefined,
        // Always present: the favorite star is a user-private action that is
        // independent of edit rights, so canonical exercises (no Pencil) are
        // still favoritable. The Pencil stays gated on `canEdit` INSIDE this
        // function.
        headerRight: () => (
          <View className="flex-row items-center">
            <Pressable
              onPress={() =>
                toggleFavorite.mutate({
                  exerciseId: id,
                  favorited: !isFavorite,
                })
              }
              accessibilityRole="button"
              accessibilityLabel={
                isFavorite
                  ? `Unfavorite ${exercise.data?.name ?? "exercise"}`
                  : `Favorite ${exercise.data?.name ?? "exercise"}`
              }
              className="px-2 py-1"
            >
              <Star
                color={
                  isFavorite
                    ? "#f59e0b"
                    : colorScheme === "dark"
                      ? "#fff"
                      : "#000"
                }
                fill={isFavorite ? "#f59e0b" : "transparent"}
                size={20}
              />
            </Pressable>
            {canEdit ? (
              <Pressable
                onPress={() => router.push(`/(app)/exercises/${id}`)}
                accessibilityLabel="Edit exercise"
                accessibilityRole="button"
                className="px-3 py-1"
              >
                <Pencil
                  color={colorScheme === "dark" ? "#fff" : "#000"}
                  size={20}
                />
              </Pressable>
            ) : null}
          </View>
        ),
      }}
    />
  );

  const { e1rmData, volumeData, bestE1rm, totalSessions, maxVolumeSession, maxVolumeKg } =
    useMemo(() => {
      const sessions = progressQ.data ?? [];
      const measurements = measurementsQ.data;
      const equipment = exercise.data?.equipment;
      const e1rm: DataPoint[] = [];
      const vol: DataPoint[] = [];
      let best = 0;
      let maxVolKg = 0;
      let maxVolSession: (typeof sessions)[number] | null = null;

      for (const s of sessions) {
        const label = formatShortDate(s.started_at);
        // Resolve bodyweight once per session (outside the set loop).
        const bw = bodyweightKgAsOf(
          measurements,
          parseISO(s.started_at).getTime(),
        );
        let sessionBestE1rm = 0;
        let sessionVolume = 0;

        for (const set of s.sets) {
          if (set.set_type === "warmup") continue;
          const r = set.reps ?? 0;

          // e1RM — logged weight ONLY, guard UNCHANGED. e1RM stays a
          // logged-weight strength metric (out of scope for bodyweight): a
          // 0-weight bodyweight set produces NO e1RM point (MAJ-2 / Invariant D).
          const w = set.weight ? parseFloat(set.weight) : 0;
          if (w > 0 && r > 0) {
            const est = epley1RM(w, r);
            if (est > sessionBestE1rm) sessionBestE1rm = est;
          }

          // Volume — effective (bodyweight-aware) weight, separate guard. A
          // 0-weight bodyweight set with bw>0 still contributes bw*reps.
          const effW = effectiveWeightKg(equipment, set.weight, bw);
          if (effW > 0 && r > 0) {
            sessionVolume += effW * r;
          }
        }

        if (sessionBestE1rm > 0) {
          const displayE1rm = unit === "kg" ? sessionBestE1rm : kgToLbs(sessionBestE1rm);
          e1rm.push({ label, value: displayE1rm });
          if (sessionBestE1rm > best) best = sessionBestE1rm;
        }
        if (sessionVolume > 0) {
          const displayVol = unit === "kg" ? sessionVolume : kgToLbs(sessionVolume);
          vol.push({ label, value: displayVol });
          // The Max-volume callout respects the max-volume-window preference
          // so it matches the live <VolumeTargetSlot> "Max"; the trend chart
          // above stays all-history. Session-level filter on started_at,
          // identical to computeVolumeTarget's windowing.
          const inWindow =
            windowStartMs === undefined ||
            parseISO(s.started_at).getTime() >= windowStartMs;
          if (inWindow && sessionVolume > maxVolKg) {
            maxVolKg = sessionVolume;
            maxVolSession = s;
          }
        }
      }

      return {
        e1rmData: e1rm,
        volumeData: vol,
        bestE1rm: best,
        totalSessions: sessions.length,
        maxVolumeSession: maxVolSession,
        maxVolumeKg: maxVolKg,
      };
    }, [progressQ.data, measurementsQ.data, exercise.data?.equipment, unit, windowStartMs]);

  // The query returns ASC for chart plotting (left→right oldest→newest).
  // The "Sessions" list below wants newest first, so reverse a shallow copy.
  const sessionsDesc = useMemo(
    () => [...(progressQ.data ?? [])].reverse(),
    [progressQ.data],
  );

  if (exercise.isLoading || progressQ.isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-black">
        {screenHeader}
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-white dark:bg-black"
      contentContainerClassName="px-6 py-6 pb-12"
    >
      {screenHeader}

      <Text className="mb-1 text-2xl font-semibold text-black dark:text-white">
        {exercise.data?.name}
      </Text>
      <Text className="mb-6 text-sm text-gray-500">
        {totalSessions} {totalSessions === 1 ? "session" : "sessions"} logged
        {bestE1rm > 0 ? ` · Best est. 1RM: ${formatWeight(bestE1rm, unit)}` : ""}
      </Text>

      {/* Per-(user, exercise) personal note. Sits above the chart so it's the
          first thing the user sees after the name + summary line. Renders even
          for soft-deleted exercises and for the empty-progress branch below. */}
      <View className="-mx-6 mb-2">
        <ExerciseNoteSlot exerciseId={id} editable={true} alwaysExpanded={true} />
      </View>

      {e1rmData.length === 0 ? (
        <View className="items-center py-10">
          <Text className="text-base text-gray-500">
            No working sets recorded yet. Complete a workout with this exercise to see
            progress.
          </Text>
        </View>
      ) : (
        <>
          <View className="gap-8">
            <ProgressChart
              data={e1rmData}
              width={chartWidth}
              title={`Estimated 1RM (${unit})`}
              formatValue={(v) => v.toFixed(1)}
            />

            <ProgressChart
              data={volumeData}
              width={chartWidth}
              title={`Total volume (${unit})`}
              formatValue={(v) =>
                v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0)
              }
            />
          </View>

          {maxVolumeSession ? (
            <View className="mt-6 rounded-xl border border-gray-200 p-4 dark:border-gray-800">
              <Text className="text-sm font-medium uppercase text-gray-500">
                Max volume session
                {maxVolumeWindowWeeks > 0 ? ` · last ${maxVolumeWindowWeeks}w` : ""}
              </Text>
              <View className="mb-2 mt-1 flex-row items-baseline justify-between">
                <Text className="text-base font-semibold text-black dark:text-white">
                  {formatDisplayDate(maxVolumeSession.started_at, {
                    includeWeekday: true,
                  })}
                </Text>
                <Text className="text-base font-semibold tabular-nums text-black dark:text-white">
                  {formatVolume(maxVolumeKg, unit)}
                </Text>
              </View>
              <SetVolumeBreakdown
                lines={presentSetVolumeLines({
                  sets: maxVolumeSession.sets,
                  unit,
                  // Identical equipment + per-session bodyweight to the volume
                  // reduce above, so the per-set lines sum to `maxVolumeKg`
                  // for a bodyweight exercise (Invariant C).
                  equipment: exercise.data?.equipment ?? undefined,
                  bodyweightKg: bodyweightKgAsOf(
                    measurementsQ.data,
                    parseISO(maxVolumeSession.started_at).getTime(),
                  ),
                })}
              />
            </View>
          ) : null}

          <View className="mt-6">
            {/* keep in sync with SECTION_HEADER on history/week/[isoWeek].tsx:20-21 */}
            <Text className="mt-4 mb-2 text-sm font-medium uppercase text-gray-500">
              Sessions
            </Text>
            <View>
              {sessionsDesc.map((s) => (
                <ExerciseSessionRow
                  key={s.session_id}
                  session={s}
                  unit={unit}
                  equipment={exercise.data?.equipment ?? undefined}
                  measurements={measurementsQ.data}
                  onPress={() => router.push(`/(app)/history/${s.session_id}`)}
                />
              ))}
            </View>
          </View>
        </>
      )}
    </ScrollView>
  );
}
