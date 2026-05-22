import { Text, View } from "react-native";

import type { WeightUnit } from "~/db/types";
import { formatVolume } from "~/utils/units";

type Props = {
  maxKg: number;
  nowKg: number;
  gapKg: number;
  unit: WeightUnit;
  /** Optional accessibility prefix (e.g. "Bench press · "). */
  a11yPrefix?: string;
};

/**
 * Shared display helper: renders the `Max · Now · To PR` triple used by the
 * Progress page's hero (weekly volume) and per-exercise list rows.
 *
 * NOT used to refactor `<VolumeTargetSlot>` — that component has a
 * specialised chasing/surpassed/reps-clause shape (out of scope per
 * design-v3 Alternative #14).
 */
export function MaxNowToPrLine({
  maxKg,
  nowKg,
  gapKg,
  unit,
  a11yPrefix,
}: Props): React.JSX.Element {
  const maxDisplay = formatVolume(maxKg, unit);
  const nowDisplay = formatVolume(nowKg, unit);
  const gapDisplay = formatVolume(gapKg, unit);

  const a11y = `${a11yPrefix ?? ""}Max ${maxDisplay}, Now ${nowDisplay}, To PR ${gapDisplay}.`;

  return (
    <View>
      <Text
        accessibilityRole="text"
        accessibilityLabel={a11y}
        className="text-sm text-gray-500 dark:text-gray-400"
      >
        {"Max "}
        <Text className="font-semibold tabular-nums text-black dark:text-white">
          {maxDisplay}
        </Text>
        {" · Now "}
        <Text className="font-semibold tabular-nums text-black dark:text-white">
          {nowDisplay}
        </Text>
        {" · To PR "}
        <Text className="font-semibold tabular-nums text-black dark:text-white">
          {gapDisplay}
        </Text>
      </Text>
    </View>
  );
}
