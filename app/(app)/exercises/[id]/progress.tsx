import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Pencil } from "lucide-react-native";
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

import { ProgressChart, type DataPoint } from "~/components/progress-chart";
import { useAllExercise } from "~/hooks/use-exercises";
import { useWeightUnit } from "~/hooks/use-preferences";
import { useExerciseProgress } from "~/hooks/use-progress";
import { formatShortDate } from "~/utils/format-display-date";
import { epley1RM } from "~/utils/formulas";
import { formatWeight, kgToLbs } from "~/utils/units";

/**
 * Per-exercise progress chart.
 *
 * Intentional deferral (MIN-1 in `docs/runs/2026-05-23_0211_configurable-max-volume-window/design-v2.md`):
 * the `bestE1rm` and total-volume reductions below operate on the e1RM kernel
 * (`max(weight * (1 + reps/30))`), NOT the volume kernel that the
 * `max_volume_window_weeks` preference governs. Threading the same window
 * preference here would conflate two distinct PR concepts (best estimated
 * 1RM vs best single-session volume). If a separate "e1RM window" companion
 * preference is ever introduced, that's where this screen would wire up.
 *
 * Until then this surface deliberately remains a "see all history" view.
 */
export default function ExerciseProgressScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const colorScheme = useColorScheme();
  // Resolve the exercise even when it's soft-deleted so the screen header and
  // page title still render the name. The chart data itself comes from sets,
  // which already work for deleted ids.
  const exercise = useAllExercise(id);
  const progressQ = useExerciseProgress(id);
  const unit = useWeightUnit();
  const { width: screenWidth } = useWindowDimensions();
  const chartWidth = Math.min(screenWidth - 48, 500);

  const screenHeader = (
    <Stack.Screen
      options={{
        title: exercise.data?.name ?? "Progress",
        headerShown: true,
        headerRight: () => (
          <Pressable
            onPress={() => router.push(`/(app)/exercises/${id}`)}
            accessibilityLabel="Edit exercise"
            accessibilityRole="button"
            className="px-3 py-1"
          >
            <Pencil color={colorScheme === "dark" ? "#fff" : "#000"} size={20} />
          </Pressable>
        ),
      }}
    />
  );

  const { e1rmData, volumeData, bestE1rm, totalSessions } = useMemo(() => {
    const sessions = progressQ.data ?? [];
    const e1rm: DataPoint[] = [];
    const vol: DataPoint[] = [];
    let best = 0;

    for (const s of sessions) {
      const label = formatShortDate(s.started_at);
      let sessionBestE1rm = 0;
      let sessionVolume = 0;

      for (const set of s.sets) {
        if (set.set_type === "warmup") continue;
        const w = set.weight ? parseFloat(set.weight) : 0;
        const r = set.reps ?? 0;
        if (w > 0 && r > 0) {
          const est = epley1RM(w, r);
          if (est > sessionBestE1rm) sessionBestE1rm = est;
          sessionVolume += w * r;
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
      }
    }

    return {
      e1rmData: e1rm,
      volumeData: vol,
      bestE1rm: best,
      totalSessions: sessions.length,
    };
  }, [progressQ.data, unit]);

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

      {e1rmData.length === 0 ? (
        <View className="items-center py-10">
          <Text className="text-base text-gray-500">
            No working sets recorded yet. Complete a workout with this exercise to see
            progress.
          </Text>
        </View>
      ) : (
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
      )}
    </ScrollView>
  );
}
