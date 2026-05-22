import { Text, View } from "react-native";

import { useStreaks } from "~/hooks/use-progress-page";

/**
 * Streak card: current consecutive trained weeks + best-ever streak.
 *
 *  ┌────────────────────────────────────┐
 *  │ STREAK                             │
 *  │ Current 2 weeks · Best 4 weeks     │
 *  └────────────────────────────────────┘
 *
 * Day-zero (both zero): renders the card with a discoverable CTA copy.
 */
export function StreakCard(): React.JSX.Element {
  const { data, isLoading, isError } = useStreaks();

  if (isLoading) {
    return (
      <View className="mx-4 my-4 rounded-lg border border-gray-200 px-4 py-4 dark:border-gray-800">
        <View className="h-3 w-16 rounded-sm bg-gray-100 dark:bg-gray-900" />
        <View className="mt-2 h-5 w-40 rounded-sm bg-gray-100 dark:bg-gray-900" />
        <View className="mt-1 h-3 w-32 rounded-sm bg-gray-100 dark:bg-gray-900" />
      </View>
    );
  }

  if (isError) {
    return (
      <View className="mx-4 my-4 rounded-lg border border-gray-200 px-4 py-4 dark:border-gray-800">
        <Text className="text-center text-base text-red-500">
          Failed to load streak.
        </Text>
      </View>
    );
  }

  const { current, best } = data;
  const weekWord = (n: number) => (n === 1 ? "week" : "weeks");

  return (
    <View className="mx-4 my-4 rounded-lg border border-gray-200 px-4 py-4 dark:border-gray-800">
      <Text className="text-xs uppercase tracking-wide text-gray-500">
        Streak
      </Text>
      {current === 0 && best === 0 ? (
        <Text className="mt-1 text-base text-gray-500 dark:text-gray-400">
          Finish a session this week to start a streak.
        </Text>
      ) : (
        <Text className="mt-1 text-base text-black dark:text-white">
          {"Current "}
          <Text className="font-semibold tabular-nums">
            {current} {weekWord(current)}
          </Text>
          {" · Best "}
          <Text className="font-semibold tabular-nums">
            {best} {weekWord(best)}
          </Text>
        </Text>
      )}
    </View>
  );
}
