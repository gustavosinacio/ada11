import { ChevronRight } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

import type { ExerciseRow } from "~/db/types";

type Props = {
  exercise: ExerciseRow;
  onPress?: () => void;
};

export function ExerciseListItem({ exercise, onPress }: Props) {
  const musclesText =
    exercise.muscles.length > 0 ? exercise.muscles.join(", ") : null;
  const subtitleParts = [musclesText, exercise.equipment].filter(
    (s): s is string => Boolean(s),
  );
  const subtitle = subtitleParts.join(" · ");

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className="flex-row items-center justify-between border-b border-gray-100 px-4 py-3 active:bg-gray-50 dark:border-gray-900 dark:active:bg-gray-950"
    >
      <View className="flex-1 pr-3">
        <Text className="text-base text-black dark:text-white">{exercise.name}</Text>
        {subtitle ? (
          <Text className="mt-0.5 text-sm text-gray-500">{subtitle}</Text>
        ) : null}
      </View>
      <ChevronRight color="#9ca3af" size={18} />
    </Pressable>
  );
}
