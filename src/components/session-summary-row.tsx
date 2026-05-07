import { ChevronRight } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

import type { SessionRow, WeightUnit } from "~/db/types";
import { formatWeight } from "~/utils/units";

type Props = {
  session: SessionRow;
  totalSets?: number;
  totalVolumeKg?: number;
  unit: WeightUnit;
  onPress?: () => void;
};

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function formatDuration(startIso: string, endIso: string | null): string {
  if (!endIso) return "in progress";
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  const totalSec = Math.max(0, Math.floor((end - start) / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function SessionSummaryRow({
  session,
  totalSets,
  totalVolumeKg,
  unit,
  onPress,
}: Props) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className="border-b border-gray-100 px-4 py-4 active:bg-gray-50 dark:border-gray-900 dark:active:bg-gray-950"
    >
      <View className="flex-row items-center justify-between">
        <View className="flex-1 pr-3">
          <Text className="text-base font-medium text-black dark:text-white">
            {formatDate(session.started_at)}
          </Text>
          <Text className="mt-1 text-sm text-gray-500">
            {formatDuration(session.started_at, session.ended_at)}
            {totalSets != null
              ? ` · ${totalSets} ${totalSets === 1 ? "set" : "sets"}`
              : ""}
            {totalVolumeKg != null && totalVolumeKg > 0
              ? ` · ${formatWeight(totalVolumeKg, unit)} volume`
              : ""}
          </Text>
          {!session.ended_at ? (
            <Text className="mt-1 text-xs font-medium text-orange-600">
              In progress
            </Text>
          ) : null}
        </View>
        <ChevronRight color="#9ca3af" size={18} />
      </View>
    </Pressable>
  );
}
