import { Stack, useRouter } from "expo-router";
import { useCallback, useMemo } from "react";
import { ActivityIndicator, FlatList, Text, View } from "react-native";

import { SessionSummaryRow } from "~/components/session-summary-row";
import { WeeklyVolumeStrip } from "~/components/weekly-volume-strip";
import { useMeasurements } from "~/hooks/use-measurements";
import { useWeightUnit } from "~/hooks/use-preferences";
import { useSessions } from "~/hooks/use-sessions";
import { useLifetimeWeeklyVolume } from "~/hooks/use-stats";
import { groupSessionVolumes } from "~/utils/progress-page-math";

export default function HistoryList() {
  const router = useRouter();
  const { data, isLoading, isError, error, refetch, isRefetching } = useSessions();
  const {
    data: weeklyVolumeData,
    refetch: refetchWeekly,
    isRefetching: isRefetchingWeekly,
  } = useLifetimeWeeklyVolume();
  // Bodyweight-aware per-session totals (MAJ-3-NEW): the History-list row
  // totals must match the week drill-down / verdict / strip / chart for any
  // bodyweight exercise — the twin of the week-drill-down `groupSessionVolumes`
  // wiring. Equipment arrives on the widened `WeeklyVolumeRow.exercises.equipment`.
  const { data: measurements } = useMeasurements();
  const unit = useWeightUnit();

  const totalVolumeBySessionId = useMemo(
    () =>
      groupSessionVolumes(
        weeklyVolumeData ?? [],
        measurements ? { measurements } : undefined,
      ),
    [weeklyVolumeData, measurements],
  );

  const onRefresh = useCallback(async () => {
    await Promise.all([refetch(), refetchWeekly()]);
  }, [refetch, refetchWeekly]);

  return (
    <View className="flex-1 bg-white dark:bg-black">
      <Stack.Screen options={{ title: "History", headerShown: true }} />

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      ) : isError ? (
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-base text-red-500">
            {error instanceof Error ? error.message : "Failed to load history"}
          </Text>
        </View>
      ) : !data || data.length === 0 ? (
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-center text-base text-gray-500">
            No sessions yet. Finish your first workout and it will appear here.
          </Text>
        </View>
      ) : (
        <FlatList
          data={data}
          keyExtractor={(s) => s.id}
          ListHeaderComponent={<WeeklyVolumeStrip />}
          renderItem={({ item }) => (
            <SessionSummaryRow
              session={item}
              unit={unit}
              totalVolumeKg={totalVolumeBySessionId.get(item.id)}
              onPress={() => router.push(`/(app)/history/${item.id}`)}
            />
          )}
          refreshing={isRefetching || isRefetchingWeekly}
          onRefresh={onRefresh}
        />
      )}
    </View>
  );
}
