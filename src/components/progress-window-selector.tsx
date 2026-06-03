import { Pressable, Text, View } from "react-native";

import {
  MAX_VOLUME_WINDOW_LABELS,
  MAX_VOLUME_WINDOW_OPTIONS,
  type MaxVolumeWindowWeeks,
} from "~/db/types";

/**
 * Page-level discrete weeks-window selector for the Progress-tab trend charts.
 *
 * Stateless / presentational — owns NO state and NEVER writes the stored
 * preference. The Progress page holds the ephemeral `windowWeeks` value and
 * passes it down; this control just renders the segments and reports taps.
 *
 * Reuses the Profile segmented-control idiom verbatim (`profile.tsx:151-187`):
 * one `flex-1 rounded-md py-2` pressable per `MAX_VOLUME_WINDOW_OPTIONS`,
 * active = `bg-black dark:bg-white`, labels via the shared
 * `MAX_VOLUME_WINDOW_LABELS` map. The tap short-circuits when the segment is
 * already active (mirrors `profile.tsx:158`).
 */
export function ProgressWindowSelector(props: {
  value: MaxVolumeWindowWeeks;
  onChange: (weeks: MaxVolumeWindowWeeks) => void;
}): React.JSX.Element {
  const { value, onChange } = props;
  return (
    <View className="mt-2 px-4">
      <Text className="mb-2 text-xs uppercase tracking-wide text-gray-500">
        Chart window
      </Text>
      <View className="flex-row gap-2">
        {MAX_VOLUME_WINDOW_OPTIONS.map((w) => {
          const selected = value === w;
          return (
            <Pressable
              key={w}
              onPress={() => {
                if (selected) return;
                onChange(w);
              }}
              accessibilityRole="button"
              accessibilityLabel={
                w === 0
                  ? "Chart window: all history"
                  : `Chart window: last ${w} weeks`
              }
              accessibilityState={{ selected }}
              className={`flex-1 rounded-md py-2 ${
                selected
                  ? "bg-black dark:bg-white"
                  : "border border-gray-300 dark:border-gray-700"
              }`}
            >
              <Text
                className={`text-center text-base font-medium ${
                  selected
                    ? "text-white dark:text-black"
                    : "text-black dark:text-white"
                }`}
              >
                {MAX_VOLUME_WINDOW_LABELS[w]}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
