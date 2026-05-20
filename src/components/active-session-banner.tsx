import { useRouter } from "expo-router";
import { ChevronRight } from "lucide-react-native";
import { Pressable, Text, useColorScheme, View } from "react-native";

import { useActiveSession } from "~/hooks/use-sessions";

export function ActiveSessionBanner() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const active = useActiveSession();

  if (!active.data) return null;

  const sessionId = active.data.id;
  const chevronColor = colorScheme === "dark" ? "#000" : "#fff";

  return (
    <Pressable
      onPress={() => router.push(`/(app)/workout/${sessionId}`)}
      accessibilityRole="button"
      accessibilityLabel="Resume workout in progress"
      className="flex-row items-center justify-between bg-gray-900 px-4 py-2 dark:bg-gray-100"
    >
      <Text className="text-sm font-medium text-white dark:text-black">
        Workout in progress
      </Text>
      <View className="flex-row items-center gap-1">
        <Text className="text-sm text-white dark:text-black">Resume</Text>
        <ChevronRight color={chevronColor} size={16} />
      </View>
    </Pressable>
  );
}
