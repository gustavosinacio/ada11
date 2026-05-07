import { Pressable, Text, View } from "react-native";

import { useRestTimer } from "~/hooks/use-rest-timer";

function formatMmSs(s: number): string {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

type Props = {
  /** Optional default duration to start when the user taps a quick-start button below. */
  quickStartSeconds?: number[];
};

export function RestTimerOverlay({ quickStartSeconds = [60, 90, 120, 180] }: Props) {
  const { running, remainingSeconds, totalSeconds, start, stop } = useRestTimer();

  if (!running) {
    return (
      <View className="absolute bottom-0 left-0 right-0 border-t border-gray-200 bg-white px-4 py-2 dark:border-gray-800 dark:bg-black">
        <View className="flex-row items-center justify-between">
          <Text className="text-xs text-gray-500">Rest timer</Text>
          <View className="flex-row gap-2">
            {quickStartSeconds.map((s) => (
              <Pressable
                key={s}
                onPress={() => start(s)}
                accessibilityRole="button"
                className="rounded-md border border-gray-300 px-2 py-1 dark:border-gray-700"
              >
                <Text className="text-xs text-black dark:text-white">
                  {s >= 60 ? `${s / 60}m` : `${s}s`}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    );
  }

  const pct =
    totalSeconds && totalSeconds > 0
      ? Math.max(0, Math.min(1, remainingSeconds / totalSeconds))
      : 0;

  return (
    <View className="absolute bottom-0 left-0 right-0 border-t border-gray-200 bg-white dark:border-gray-800 dark:bg-black">
      <View className="h-1 bg-gray-100 dark:bg-gray-900">
        <View
          className="h-full bg-black dark:bg-white"
          style={{ width: `${pct * 100}%` }}
        />
      </View>
      <View className="flex-row items-center justify-between px-4 py-2">
        <Text className="text-xs text-gray-500">Resting</Text>
        <Text className="text-2xl font-semibold tabular-nums text-black dark:text-white">
          {formatMmSs(remainingSeconds)}
        </Text>
        <Pressable
          onPress={stop}
          accessibilityRole="button"
          accessibilityLabel="Stop rest timer"
          className="rounded-md border border-gray-300 px-2 py-1 dark:border-gray-700"
        >
          <Text className="text-xs text-black dark:text-white">Skip</Text>
        </Pressable>
      </View>
    </View>
  );
}
