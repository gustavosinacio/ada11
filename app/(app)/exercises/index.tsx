import { Stack, useRouter } from "expo-router";
import { Plus } from "lucide-react-native";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";

import { ExerciseListItem } from "~/components/exercise-list-item";
import { useExercises } from "~/hooks/use-exercises";

export default function ExercisesList() {
  const router = useRouter();
  const { data, isLoading, isError, error, refetch, isRefetching } = useExercises();

  return (
    <View className="flex-1 bg-white dark:bg-black">
      <Stack.Screen
        options={{
          title: "Exercises",
          headerShown: true,
          headerRight: () => (
            <Pressable
              onPress={() => router.push("/(app)/exercises/new")}
              accessibilityLabel="New exercise"
              accessibilityRole="button"
              className="px-3 py-1"
            >
              <Plus color="#000" size={22} />
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
            {error instanceof Error ? error.message : "Failed to load exercises"}
          </Text>
        </View>
      ) : !data || data.length === 0 ? (
        <View className="flex-1 items-center justify-center px-6">
          <Text className="mb-4 text-center text-base text-gray-500">
            No exercises yet. Add your first lift.
          </Text>
          <Pressable
            onPress={() => router.push("/(app)/exercises/new")}
            accessibilityRole="button"
            className="rounded-lg bg-black px-4 py-3 dark:bg-white"
          >
            <Text className="text-base font-medium text-white dark:text-black">
              Add exercise
            </Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={data}
          keyExtractor={(e) => e.id}
          renderItem={({ item }) => (
            <ExerciseListItem
              exercise={item}
              onPress={() => router.push(`/(app)/exercises/${item.id}`)}
            />
          )}
          refreshing={isRefetching}
          onRefresh={refetch}
        />
      )}
    </View>
  );
}
