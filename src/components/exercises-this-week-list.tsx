import { useRouter } from "expo-router";
import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";

import { MaxNowToPrLine } from "~/components/max-now-to-pr-line";
import type { MuscleGroup } from "~/db/types";
import { MUSCLE_GROUPS } from "~/db/types";
import { useWeightUnit } from "~/hooks/use-preferences";
import {
  useExercisesThisWeek,
  type ExerciseThisWeekRow,
} from "~/hooks/use-progress-page";

const SECTION_HEADER =
  "mt-4 mb-2 px-4 text-sm font-medium uppercase text-gray-500";

/**
 * Per-muscle list of exercises trained this ISO week. Each row links to the
 * existing per-exercise progress screen so the entry point matches the
 * "tap exercise name to progress" affordance already established elsewhere.
 *
 *   CHEST
 *   Bench press [PR]                 →
 *   Max 8,400 kg · Now 6,000 kg · To PR 2,400 kg
 *
 *   ARMS
 *   ...
 *
 * Empty-state copy is rendered when the user has trained zero exercises in
 * the current ISO week (early-week or rest-week). Per-block skeleton matches
 * the surrounding strip / hero idiom while loading.
 */
export function ExercisesThisWeekList(): React.JSX.Element {
  const router = useRouter();
  const unit = useWeightUnit();
  const { data, isLoading, isError } = useExercisesThisWeek();

  const grouped = useMemo<Map<MuscleGroup | "Other", ExerciseThisWeekRow[]>>(
    () => {
      const map = new Map<MuscleGroup | "Other", ExerciseThisWeekRow[]>();
      for (const row of data) {
        const arr = map.get(row.group) ?? [];
        arr.push(row);
        map.set(row.group, arr);
      }
      return map;
    },
    [data],
  );

  if (isLoading) {
    return (
      <View className="border-b border-gray-200 py-4 dark:border-gray-800">
        <View className="mx-4 h-3 w-20 rounded-sm bg-gray-100 dark:bg-gray-900" />
        <View className="mt-3 h-12 bg-gray-100 dark:bg-gray-900" />
        <View className="mt-1 h-12 bg-gray-100 dark:bg-gray-900" />
        <View className="mt-1 h-12 bg-gray-100 dark:bg-gray-900" />
        <View className="mt-1 h-12 bg-gray-100 dark:bg-gray-900" />
      </View>
    );
  }

  if (isError) {
    return (
      <View className="border-b border-gray-200 px-4 py-6 dark:border-gray-800">
        <Text className="text-center text-base text-red-500">
          Failed to load exercises this week.
        </Text>
      </View>
    );
  }

  if (data.length === 0) {
    return (
      <View className="border-b border-gray-200 px-4 py-8 dark:border-gray-800">
        <Text className="text-center text-base text-gray-500">
          No exercises trained this week yet. Log a session to get started.
        </Text>
      </View>
    );
  }

  // Render groups in canonical order, "Other" last. Empty groups are skipped.
  const groupOrder: (MuscleGroup | "Other")[] = [
    ...MUSCLE_GROUPS,
    "Other",
  ];

  return (
    <View className="border-b border-gray-200 pb-4 dark:border-gray-800">
      {groupOrder.map((group) => {
        const rows = grouped.get(group);
        if (!rows || rows.length === 0) return null;
        return (
          <View key={group}>
            <Text className={SECTION_HEADER}>{group}</Text>
            {rows.map((row) => (
              <Pressable
                key={row.exerciseId}
                onPress={() =>
                  router.push(`/(app)/exercises/${row.exerciseId}/progress`)
                }
                accessibilityRole="button"
                accessibilityLabel={`${row.exerciseName}, view progress`}
                className="border-b border-gray-100 px-4 py-3 active:bg-gray-50 dark:border-gray-900 dark:active:bg-gray-950"
              >
                <View className="flex-row items-center justify-between">
                  <Text className="flex-1 text-base text-black dark:text-white">
                    {row.exerciseName}
                  </Text>
                  {row.isPrThisWeek ? (
                    <View className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 dark:bg-emerald-900">
                      <Text className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                        PR
                      </Text>
                    </View>
                  ) : null}
                </View>
                <View className="mt-1">
                  <MaxNowToPrLine
                    maxKg={row.maxKg}
                    nowKg={row.nowKg}
                    gapKg={row.gapKg}
                    unit={unit}
                    a11yPrefix={`${row.exerciseName} — `}
                  />
                </View>
              </Pressable>
            ))}
          </View>
        );
      })}
    </View>
  );
}
