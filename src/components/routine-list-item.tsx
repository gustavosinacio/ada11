import { ChevronRight } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

import type { RoutineRow } from "~/db/types";

type Props = {
  routine: RoutineRow;
  onPress?: () => void;
};

export function RoutineListItem({ routine, onPress }: Props) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className="flex-row items-center justify-between border-b border-gray-100 px-4 py-4 active:bg-gray-50 dark:border-gray-900 dark:active:bg-gray-950"
    >
      <View className="flex-1 pr-3">
        <Text className="text-base text-black dark:text-white">{routine.name}</Text>
        {routine.notes ? (
          <Text className="mt-0.5 text-sm text-gray-500" numberOfLines={2}>
            {routine.notes}
          </Text>
        ) : null}
      </View>
      <ChevronRight color="#9ca3af" size={18} />
    </Pressable>
  );
}
