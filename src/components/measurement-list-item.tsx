import { ChevronRight } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

import type {
  LengthUnit,
  MeasurementEntryRow,
  WeightUnit,
} from "~/db/types";
import { formatDisplayDate } from "~/utils/format-display-date";
import { formatLength, formatWeight } from "~/utils/units";

type Props = {
  entry: MeasurementEntryRow;
  weightUnit: WeightUnit;
  lengthUnit: LengthUnit;
  onPress?: () => void;
};

function formatHeadline(
  entry: MeasurementEntryRow,
  weightUnit: WeightUnit,
  lengthUnit: LengthUnit,
): string {
  const parts: string[] = [];
  if (entry.weight_kg != null) {
    const n = parseFloat(entry.weight_kg);
    if (Number.isFinite(n)) parts.push(formatWeight(n, weightUnit));
  }
  if (entry.body_fat_pct != null) {
    const n = parseFloat(entry.body_fat_pct);
    if (Number.isFinite(n)) parts.push(`${n.toFixed(1)}% bf`);
  }
  if (entry.waist_cm != null) {
    const n = parseFloat(entry.waist_cm);
    if (Number.isFinite(n)) parts.push(`${formatLength(n, lengthUnit)} waist`);
  }
  if (parts.length === 0) return "—";
  return parts.slice(0, 3).join(" · ");
}

export function MeasurementListItem({
  entry,
  weightUnit,
  lengthUnit,
  onPress,
}: Props) {
  const dateLabel = formatDisplayDate(entry.measured_at, {
    includeWeekday: true,
  });
  const headline = formatHeadline(entry, weightUnit, lengthUnit);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className="flex-row items-center justify-between border-b border-gray-100 px-4 py-4 active:bg-gray-50 dark:border-gray-900 dark:active:bg-gray-950"
    >
      <View className="flex-1 pr-3">
        <Text className="text-base font-semibold text-black dark:text-white">
          {dateLabel}
        </Text>
        <Text className="mt-0.5 text-sm text-gray-500">{headline}</Text>
        {entry.notes ? (
          <Text
            className="mt-1 text-xs text-gray-400"
            numberOfLines={1}
          >
            {entry.notes}
          </Text>
        ) : null}
      </View>
      <ChevronRight color="#9ca3af" size={18} />
    </Pressable>
  );
}
