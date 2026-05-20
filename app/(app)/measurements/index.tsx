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

import { MeasurementListItem } from "~/components/measurement-list-item";
import { MeasurementsProgressStrip } from "~/components/measurements-progress-strip";
import { useLengthUnit, useWeightUnit } from "~/hooks/use-preferences";
import { useMeasurements } from "~/hooks/use-measurements";

export default function MeasurementsList() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const weightUnit = useWeightUnit();
  const lengthUnit = useLengthUnit();
  const { data, isLoading, isError, error, refetch, isRefetching } =
    useMeasurements();

  return (
    <View className="flex-1 bg-white dark:bg-black">
      <Stack.Screen
        options={{
          title: "Measurements",
          headerShown: true,
          headerRight: () => (
            <Pressable
              onPress={() => router.push("/(app)/measurements/new")}
              accessibilityLabel="New measurement"
              accessibilityRole="button"
              className="px-3 py-1"
            >
              <Plus color={colorScheme === "dark" ? "#fff" : "#000"} size={22} />
            </Pressable>
          ),
        }}
      />

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      ) : isError ? (
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-base text-red-500">
            {error instanceof Error
              ? error.message
              : "Failed to load measurements"}
          </Text>
        </View>
      ) : !data || data.length === 0 ? (
        <View className="flex-1 items-center justify-center px-6">
          <Text className="mb-4 text-center text-base text-gray-500">
            No measurements logged yet. Log your first to start tracking
            progress.
          </Text>
          <Pressable
            onPress={() => router.push("/(app)/measurements/new")}
            accessibilityRole="button"
            className="rounded-lg bg-black px-4 py-3 dark:bg-white"
          >
            <Text className="text-base font-medium text-white dark:text-black">
              Log measurement
            </Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={data}
          keyExtractor={(e) => e.id}
          ListHeaderComponent={<MeasurementsProgressStrip />}
          renderItem={({ item }) => (
            <MeasurementListItem
              entry={item}
              weightUnit={weightUnit}
              lengthUnit={lengthUnit}
              onPress={() => router.push(`/(app)/measurements/${item.id}`)}
            />
          )}
          refreshing={isRefetching}
          onRefresh={refetch}
        />
      )}
    </View>
  );
}
