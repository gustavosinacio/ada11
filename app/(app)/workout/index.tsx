import { Pressable, Text, View } from "react-native";

export default function WorkoutHome() {
  return (
    <View className="flex-1 items-center justify-center bg-white px-6 dark:bg-black">
      <Text className="mb-2 text-2xl font-semibold text-black dark:text-white">
        Ready to lift?
      </Text>
      <Text className="mb-8 text-center text-base text-gray-500">
        Start a workout from one of your routines, or go ad-hoc.
      </Text>

      <Pressable className="mb-3 w-full rounded-lg bg-black py-3 dark:bg-white">
        <Text className="text-center text-base font-medium text-white dark:text-black">
          Start from routine (TODO)
        </Text>
      </Pressable>

      <Pressable className="w-full rounded-lg border border-gray-300 py-3 dark:border-gray-700">
        <Text className="text-center text-base text-black dark:text-white">
          Start ad-hoc workout (TODO)
        </Text>
      </Pressable>
    </View>
  );
}
