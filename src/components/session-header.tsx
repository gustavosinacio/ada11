import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

type Props = {
  startedAt: string;
  onFinish: () => void;
  finishing?: boolean;
};

function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function SessionHeader({ startedAt, onFinish, finishing }: Props) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const elapsed = now - new Date(startedAt).getTime();

  return (
    <View className="flex-row items-center justify-between border-b border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-black">
      <View>
        <Text className="text-xs text-gray-500">Elapsed</Text>
        <Text className="text-2xl font-semibold tabular-nums text-black dark:text-white">
          {formatElapsed(elapsed)}
        </Text>
      </View>
      <Pressable
        onPress={onFinish}
        disabled={finishing}
        accessibilityRole="button"
        accessibilityLabel="Finish workout"
        className={`rounded-lg bg-black px-4 py-2 dark:bg-white ${finishing ? "opacity-50" : ""}`}
      >
        <Text className="text-base font-medium text-white dark:text-black">
          {finishing ? "..." : "Finish"}
        </Text>
      </Pressable>
    </View>
  );
}
