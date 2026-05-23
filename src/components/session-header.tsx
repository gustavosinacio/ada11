import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

import type { WeightUnit } from "~/db/types";
import { formatVolume } from "~/utils/units";

type Props = {
  startedAt: string;
  onFinish: () => void;
  finishing?: boolean;
  /** Running total volume of the active session, in kilograms. The header
   *  is presentational — the route computes this via `sumLiveVolume` over
   *  the `useSetsForSession` cache and passes it down. F10 "checked =
   *  committed": unchecked drafts and warmups are already excluded by the
   *  kernel; dropsets are included. */
  volumeKg: number;
  /** Display unit selected by the user (`"kg"` or `"lbs"`). The header
   *  delegates conversion + locale formatting to `formatVolume`. */
  unit: WeightUnit;
};

function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function SessionHeader({
  startedAt,
  onFinish,
  finishing,
  volumeKg,
  unit,
}: Props) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const elapsed = now - new Date(startedAt).getTime();
  const volumeDisplay = formatVolume(volumeKg, unit);

  return (
    <View className="flex-row items-center justify-between border-b border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-black">
      {/* Metric blocks — `gap-6` keeps a comfortable gutter between them and
          mirrors the existing label-above-number shape from "Elapsed". Both
          numerals render at `text-xl` (not `text-2xl`) to guarantee fit on
          iPhone SE 320pt with the worst-case `1:23:45` elapsed + 7-digit
          lbs volume. The pinned test selectors don't assert font size, so
          this is non-breaking. See validation-v1 MAJ-1. */}
      <View className="flex-row items-center gap-6">
        <View>
          <Text className="text-xs text-gray-500">Elapsed</Text>
          <Text className="text-xl font-semibold tabular-nums text-black dark:text-white">
            {formatElapsed(elapsed)}
          </Text>
        </View>
        <View>
          <Text className="text-xs text-gray-500">Volume</Text>
          <Text
            accessibilityRole="text"
            accessibilityLabel={`Session total volume: ${volumeDisplay}`}
            className="text-xl font-semibold tabular-nums text-black dark:text-white"
          >
            {volumeDisplay}
          </Text>
        </View>
      </View>
      <Pressable
        onPress={onFinish}
        disabled={finishing}
        accessibilityRole="button"
        accessibilityLabel="Finish workout"
        className={`rounded-lg bg-black px-4 py-2 dark:bg-white ${finishing ? "opacity-50" : ""}`}
      >
        <Text className="text-base font-medium text-white dark:text-black">
          {finishing ? "..." : "Finish"}
        </Text>
      </Pressable>
    </View>
  );
}
