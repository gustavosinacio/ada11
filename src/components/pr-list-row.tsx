import { Pressable, Text, View } from "react-native";

import type { WeightUnit } from "~/db/types";
import { formatVolume } from "~/utils/units";

type Props = {
  exerciseId: string;
  exerciseName: string;
  /** Lifetime max single-session volume BEFORE this PR. */
  priorMaxKg: number;
  /** Strictly > 0. Volume delta over `priorMaxKg`. */
  overflowKg: number;
  unit: WeightUnit;
  onPress?: (exerciseId: string) => void;
};

/**
 * Shared celebratory PR row. Used on the Progress page hero accordion, the
 * per-muscle list (when a row hit a PR this week), and the end-of-session
 * verdict screen. Single source of truth for the visual + copy:
 *
 *   {exerciseName}                                   [PR]
 *   PR! +{overflowKg} kg (was {priorMaxKg} kg)
 *
 * The literal "PR!" prefix is byte-for-byte the existing verdict copy — the
 * verdict screen e2e relies on the unchanged text. Tap → caller routes via
 * `onPress(exerciseId)` (typically `/(app)/exercises/{id}/progress`).
 */
export function PrListRow({
  exerciseId,
  exerciseName,
  priorMaxKg,
  overflowKg,
  unit,
  onPress,
}: Props): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${exerciseName}, view progress`}
      onPress={() => onPress?.(exerciseId)}
      className="border-b border-gray-100 px-4 py-3 active:bg-gray-50 dark:border-gray-900 dark:active:bg-gray-950"
    >
      <View className="flex-row items-center justify-between">
        <Text className="flex-1 text-base font-medium text-black dark:text-white">
          {exerciseName}
        </Text>
        <View className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 dark:bg-emerald-900">
          <Text className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
            PR
          </Text>
        </View>
      </View>
      <Text className="mt-1 text-sm tabular-nums text-emerald-700 dark:text-emerald-400">
        {`PR! +${formatVolume(overflowKg, unit)} (was ${formatVolume(priorMaxKg, unit)})`}
      </Text>
    </Pressable>
  );
}
