import { Text, View } from "react-native";

import type { SetVolumeLine } from "~/utils/exercise-session-row-format";

type Props = {
  /** Per-set lines from `presentSetVolumeLines`. Renders nothing when empty. */
  lines: SetVolumeLine[];
};

/**
 * Stacked per-set "weight × reps — volume" breakdown. Shared by the exercise
 * progress "Sessions" rows, the live `<VolumeTargetSlot>` max-session callout,
 * and the progress page's best-volume callout so the three surfaces render the
 * breakdown identically. Pure presentational — the caller owns the data via
 * `presentSetVolumeLines`.
 */
export function SetVolumeBreakdown({ lines }: Props): React.JSX.Element | null {
  if (lines.length === 0) return null;
  return (
    <View className="gap-0.5">
      {lines.map((line) => (
        <View
          key={line.setNumber}
          className="flex-row items-center justify-between"
        >
          <Text className="text-xs tabular-nums text-gray-600 dark:text-gray-400">
            {line.setType === "dropset" ? "↓ " : ""}
            {line.label}
          </Text>
          {line.volumeLabel !== "" ? (
            <Text className="text-xs tabular-nums text-gray-400 dark:text-gray-500">
              {line.volumeLabel}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}
