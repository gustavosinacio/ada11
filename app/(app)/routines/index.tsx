import { Stack, useRouter } from "expo-router";
import { Plus } from "lucide-react-native";
import { ActivityIndicator, FlatList, Pressable, Text, useColorScheme, View } from "react-native";

import { RoutineListItem } from "~/components/routine-list-item";
import { useRoutines } from "~/hooks/use-routines";

export default function RoutinesList() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const { data, isLoading, isError, error, refetch, isRefetching } = useRoutines();

  return (
    <View className="flex-1 bg-white dark:bg-black">
      <Stack.Screen
        options={{
          title: "Routines",
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

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      ) : isError ? (
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-base text-red-500">
            {error instanceof Error ? error.message : "Failed to load routines"}
          </Text>
        </View>
      ) : !data || data.length === 0 ? (
        <View className="flex-1 items-center justify-center px-6">
          <Text className="mb-4 text-center text-base text-gray-500">
            No routines yet. Create your first program template.
          </Text>
          <Pressable
            onPress={() => router.push("/(app)/routines/new")}
            accessibilityRole="button"
            className="rounded-lg bg-black px-4 py-3 dark:bg-white"
          >
            <Text className="text-base font-medium text-white dark:text-black">
              Create routine
            </Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={data}
          keyExtractor={(r) => r.id}
          renderItem={({ item }) => (
            <RoutineListItem
              routine={item}
              onPress={() => router.push(`/(app)/routines/${item.id}`)}
            />
          )}
          refreshing={isRefetching}
          onRefresh={refetch}
        />
      )}
    </View>
  );
}
