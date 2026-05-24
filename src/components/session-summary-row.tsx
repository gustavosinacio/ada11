import { ChevronRight } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

import type { SessionRow, WeightUnit } from "~/db/types";
import { formatDisplayDate } from "~/utils/format-display-date";
import { presentSessionVolumeSlot } from "~/utils/session-row-format";

type Props = {
  session: SessionRow;
  totalSets?: number;
  totalVolumeKg?: number;
  unit: WeightUnit;
  onPress?: () => void;
};

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
          <Text className="text-base font-semibold text-black dark:text-white">
            {session.name?.trim() || "Workout"}
          </Text>
          <Text className="mt-0.5 text-sm text-gray-500">
            {formatDisplayDate(session.started_at, { includeWeekday: true })} ·{" "}
            {formatDuration(session.started_at, session.ended_at)}
            {totalSets != null
              ? ` · ${totalSets} ${totalSets === 1 ? "set" : "sets"}`
              : ""}
            {presentSessionVolumeSlot(totalVolumeKg, unit) ?? ""}
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
