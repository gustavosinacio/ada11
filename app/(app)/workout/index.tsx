import { Stack, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";

import { Button } from "~/components/ui/button";
import { useRoutines } from "~/hooks/use-routines";
import { useActiveSession, useStartSession } from "~/hooks/use-sessions";

export default function WorkoutHome() {
  const router = useRouter();
  const active = useActiveSession();
  const start = useStartSession();
  const routines = useRoutines();

  const [pickerOpen, setPickerOpen] = useState(false);

  // Auto-route to active session if one exists.
  useEffect(() => {
    if (active.data) {
      router.replace(`/(app)/workout/${active.data.id}`);
    }
  }, [active.data, router]);

  const startAdHoc = async () => {
    try {
      const row = await start.mutateAsync({});
      router.replace(`/(app)/workout/${row.id}`);
    } catch (err) {
      console.warn("Start failed", err);
    }
  };

  const startFromRoutine = async (routineId: string, routineName: string) => {
    try {
      const row = await start.mutateAsync({
        routine_id: routineId,
        name: routineName,
      });
      setPickerOpen(false);
      router.replace(`/(app)/workout/${row.id}`);
    } catch (err) {
      console.warn("Start failed", err);
    }
  };

  if (active.isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-black">
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-white dark:bg-black">
      <Stack.Screen options={{ title: "Workout", headerShown: true }} />

      <View className="flex-1 items-center justify-center px-6">
        <Text className="mb-2 text-2xl font-semibold text-black dark:text-white">
          Ready to lift?
        </Text>
        <Text className="mb-8 text-center text-base text-gray-500">
          Start a workout from one of your routines, or go ad-hoc.
        </Text>

        <View className="w-full gap-3">
          <Button
            label="Start from routine"
            onPress={() => setPickerOpen(true)}
            loading={start.isPending}
          />
          <Button
            label="Start ad-hoc workout"
            variant="secondary"
            onPress={startAdHoc}
            loading={start.isPending}
          />
        </View>
      </View>

      <Modal
        visible={pickerOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setPickerOpen(false)}
      >
        <View className="flex-1 bg-white dark:bg-black">
          <View className="flex-row items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-800">
            <Text className="text-lg font-semibold text-black dark:text-white">
              Pick a routine
            </Text>
            <Pressable onPress={() => setPickerOpen(false)} className="p-1">
              <Text className="text-base text-gray-500">Cancel</Text>
            </Pressable>
          </View>

          {routines.isLoading ? (
            <View className="flex-1 items-center justify-center">
              <ActivityIndicator />
            </View>
          ) : !routines.data || routines.data.length === 0 ? (
            <View className="flex-1 items-center justify-center px-6">
              <Text className="text-center text-base text-gray-500">
                No routines yet. Create one from the Routines tab.
              </Text>
            </View>
          ) : (
            <ScrollView>
              {routines.data.map((r) => (
                <Pressable
                  key={r.id}
                  onPress={() => startFromRoutine(r.id, r.name)}
                  accessibilityRole="button"
                  className="border-b border-gray-100 px-4 py-4 active:bg-gray-50 dark:border-gray-900 dark:active:bg-gray-950"
                >
                  <Text className="text-base text-black dark:text-white">
                    {r.name}
                  </Text>
                  {r.notes ? (
                    <Text
                      className="mt-0.5 text-sm text-gray-500"
                      numberOfLines={2}
                    >
                      {r.notes}
                    </Text>
                  ) : null}
                </Pressable>
              ))}
            </ScrollView>
          )}
        </View>
      </Modal>
    </View>
  );
}
