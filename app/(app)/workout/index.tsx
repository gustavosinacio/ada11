import { Stack, useRouter } from "expo-router";
import { Plus } from "lucide-react-native";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Text,
  useColorScheme,
  View,
} from "react-native";

import { RoutineListItem } from "~/components/routine-list-item";
import { Button } from "~/components/ui/button";
import type { RoutineRow } from "~/db/types";
import { useRoutines } from "~/hooks/use-routines";
import { useActiveSession, useStartSession } from "~/hooks/use-sessions";

export default function WorkoutHome() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const active = useActiveSession();
  const start = useStartSession();
  const routines = useRoutines();

  // MAJ-NEW-1 fix: gate the entire render branch on active.isLoading so the
  // start handlers' `active.data` check has no race window during the initial
  // query settle. Matches the precedent for active.isLoading pattern.
  if (active.isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-black">
        <ActivityIndicator />
      </View>
    );
  }

  const hasActive = !!active.data;

  const startAdHocWorkout = async () => {
    if (active.data) {
      router.push(`/(app)/workout/${active.data.id}`);
      return;
    }
    try {
      const row = await start.mutateAsync({});
      router.replace(`/(app)/workout/${row.id}`);
    } catch (err) {
      console.warn("Start failed", err);
    }
  };

  const startFromRoutine = async (r: RoutineRow) => {
    if (active.data) {
      router.push(`/(app)/workout/${active.data.id}`);
      return;
    }
    try {
      const row = await start.mutateAsync({
        routine_id: r.id,
        name: r.name,
      });
      router.replace(`/(app)/workout/${row.id}`);
    } catch (err) {
      console.warn("Start failed", err);
    }
  };

  return (
    <View className="flex-1 bg-white dark:bg-black">
      <Stack.Screen
        options={{
          title: "Workout",
          headerShown: true,
          headerRight: () => (
            <Pressable
              onPress={() => router.push("/(app)/routines/new")}
              accessibilityLabel="New routine"
              accessibilityRole="button"
              className="px-3 py-1"
            >
              <Plus color={colorScheme === "dark" ? "#fff" : "#000"} size={22} />
            </Pressable>
          ),
        }}
      />

      {routines.isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      ) : !routines.data || routines.data.length === 0 ? (
        <View className="flex-1 items-center justify-center px-6">
          <Text className="mb-4 text-center text-base text-gray-500">
            No routines yet. Quick start a workout, or create your first routine below.
          </Text>
          <View className="w-full gap-3">
            <Button
              label="Quick start workout"
              onPress={startAdHocWorkout}
              loading={start.isPending}
            />
            <Button
              label="Create routine"
              variant="secondary"
              onPress={() => router.push("/(app)/routines/new")}
            />
          </View>
        </View>
      ) : (
        <FlatList
          data={routines.data}
          keyExtractor={(r) => r.id}
          ListHeaderComponent={
            <View className="gap-3 px-4 py-4">
              <Button
                label="Quick start workout"
                onPress={startAdHocWorkout}
                loading={start.isPending}
              />
              <Text className="mt-2 text-xs uppercase tracking-wide text-gray-500">
                Your routines
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <RoutineListItem
              routine={item}
              onPress={() => startFromRoutine(item)}
              onEditPress={() => router.push(`/(app)/routines/${item.id}`)}
              disabled={hasActive}
            />
          )}
          refreshing={routines.isRefetching}
          onRefresh={routines.refetch}
        />
      )}
    </View>
  );
}
