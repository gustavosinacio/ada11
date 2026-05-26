import { ChevronRight, Pencil } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

import type { RoutineRow } from "~/db/types";

type Props = {
  routine: RoutineRow;
  onPress?: () => void;
  onEditPress?: () => void;
  disabled?: boolean;
  /**
   * Fired when this routine's Start is in flight. Maps to the existing
   * `disabled` visual (same opacity/dimming) — no new design tokens. OR'd
   * with `disabled` at render time. Future spinner-on-pending is follow-up.
   */
  pending?: boolean;
};

/**
 * Renders a routine row with two side-by-side tap targets: the main area
 * (Start workout) and an optional Edit affordance. They are SIBLINGS, not
 * nested — RN-Web maps each <Pressable> to a `<button>` element, and HTML
 * forbids nesting interactive elements (the spec violation surfaces as a
 * React hydration warning). When `onEditPress` is omitted, the trailing slot
 * is a non-interactive chevron and the row degrades to a single Pressable.
 */
export function RoutineListItem({
  routine,
  onPress,
  onEditPress,
  disabled = false,
  pending = false,
}: Props) {
  const effectivelyDisabled = disabled || pending;
  const opacityClass = effectivelyDisabled ? "opacity-60" : "";
  return (
    <View
      className={`flex-row items-stretch border-b border-gray-100 dark:border-gray-900 ${opacityClass}`}
    >
      <Pressable
        onPress={effectivelyDisabled ? undefined : onPress}
        accessibilityRole="button"
        accessibilityLabel={`Start workout: ${routine.name}`}
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
        {onEditPress ? null : <ChevronRight color="#9ca3af" size={18} />}
      </Pressable>
      {onEditPress ? (
        <Pressable
          onPress={onEditPress}
          accessibilityRole="button"
          accessibilityLabel={`Edit routine: ${routine.name}`}
          hitSlop={8}
          className="my-3 mr-4 flex-row items-center gap-1 self-center rounded-md border border-gray-200 px-2 py-1 active:bg-gray-100 dark:border-gray-800 dark:active:bg-gray-900"
        >
          <Pencil color="#9ca3af" size={14} />
          <Text className="text-xs text-gray-500">Edit</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
