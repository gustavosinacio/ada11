import { ChevronRight } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

import type { RoutineRow } from "~/db/types";

type Props = {
  routine: RoutineRow;
  /** Navigates to the routine PREVIEW; never starts a session directly. */
  onPress?: () => void;
  disabled?: boolean;
};

/**
 * Renders a routine row as a single Pressable that navigates to the routine
 * preview (the hub from which the user starts the workout or jumps to the
 * editor). When `disabled` (an active session is in progress) the row dims to
 * opacity-60 and the tap is a no-op — the resume banner is the intended path
 * back into the active session.
 */
export function RoutineListItem({
  routine,
  onPress,
  disabled = false,
}: Props) {
  const opacityClass = disabled ? "opacity-60" : "";
  return (
    <View
      className={`flex-row items-stretch border-b border-gray-100 dark:border-gray-900 ${opacityClass}`}
    >
      <Pressable
        onPress={disabled ? undefined : onPress}
        accessibilityRole="button"
        accessibilityLabel={`View routine: ${routine.name}`}
        className="flex-1 flex-row items-center px-4 py-4 active:bg-gray-50 dark:active:bg-gray-950"
      >
        <View className="flex-1 pr-3">
          <Text className="text-base text-black dark:text-white">
            {routine.name}
          </Text>
          {routine.notes ? (
            <Text className="mt-0.5 text-sm text-gray-500" numberOfLines={2}>
              {routine.notes}
            </Text>
          ) : null}
        </View>
        <ChevronRight color="#9ca3af" size={18} />
      </Pressable>
    </View>
  );
}
