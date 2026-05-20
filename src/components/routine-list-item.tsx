import { ChevronRight, Pencil } from "lucide-react-native";
import { Pressable, Text, View, type GestureResponderEvent } from "react-native";

import type { RoutineRow } from "~/db/types";

type Props = {
  routine: RoutineRow;
  onPress?: () => void;
  onEditPress?: () => void;
  disabled?: boolean;
};

export function RoutineListItem({
  routine,
  onPress,
  onEditPress,
  disabled = false,
}: Props) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={`Start workout: ${routine.name}`}
      className={`flex-row items-center justify-between border-b border-gray-100 px-4 py-4 active:bg-gray-50 dark:border-gray-900 dark:active:bg-gray-950 ${disabled ? "opacity-60" : ""}`}
    >
      <View className="flex-1 pr-3">
        <Text className="text-base text-black dark:text-white">{routine.name}</Text>
        {routine.notes ? (
          <Text className="mt-0.5 text-sm text-gray-500" numberOfLines={2}>
            {routine.notes}
          </Text>
        ) : null}
      </View>
      {onEditPress ? (
        <Pressable
          onPress={(e: GestureResponderEvent) => {
            e.stopPropagation?.();
            onEditPress();
          }}
          accessibilityRole="button"
          accessibilityLabel={`Edit routine: ${routine.name}`}
          hitSlop={8}
          className="flex-row items-center gap-1 rounded-md border border-gray-200 px-2 py-1 active:bg-gray-100 dark:border-gray-800 dark:active:bg-gray-900"
        >
          <Pencil color="#9ca3af" size={14} />
          <Text className="text-xs text-gray-500">Edit</Text>
        </Pressable>
      ) : (
        <ChevronRight color="#9ca3af" size={18} />
      )}
    </Pressable>
  );
}
