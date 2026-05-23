import { useMemo } from "react";
import { Text, View } from "react-native";

import type { SetRow } from "~/db/types";
import {
  useMaxVolumeWindowWeeks,
  useWeightUnit,
} from "~/hooks/use-preferences";
import { useExerciseProgress } from "~/hooks/use-progress";
import { formatVolume, formatWeight } from "~/utils/units";
import { computeVolumeTarget } from "~/utils/volume-target";
import { computeWindowStart } from "~/utils/window-utils";

type Props = {
  exerciseId: string;
  currentSessionSets: SetRow[];
};

/**
 * Per-exercise volume-target strip rendered inside `<ExerciseBlock>` on the
 * live workout screen. Compares the running session-volume to the user's
 * previous best single-session volume and shows the floating-point reps left
 * at the current weight to surpass it.
 *
 * Returns `null` when:
 *   - the progress query is still loading, OR
 *   - the user has never logged this exercise before (`no-pr` state).
 *
 * Hook contract: `useExerciseProgress` is called unconditionally so this
 * component must only be mounted when the slot should subscribe (i.e. the
 * parent gates mounting with `showVolumeTarget`).
 */
export function VolumeTargetSlot({
  exerciseId,
  currentSessionSets,
}: Props): React.JSX.Element | null {
  const progressQ = useExerciseProgress(exerciseId);
  const unit = useWeightUnit();
  const weeks = useMaxVolumeWindowWeeks();
  const windowStartMs = useMemo(
    () => computeWindowStart(weeks, new Date()),
    [weeks],
  );

  const state = useMemo(
    () =>
      computeVolumeTarget({
        pastSessions: progressQ.data,
        currentSessionSets,
        windowStartMs,
      }),
    [progressQ.data, currentSessionSets, windowStartMs],
  );

  // Hide while loading (no skeleton — keeps the block compact during
  // cold-start fan-out across N exercises).
  if (progressQ.isLoading) return null;
  if (state.kind === "no-pr") return null;

  if (state.kind === "chasing") {
    const maxDisplay = formatVolume(state.previousMaxKg, unit);
    const nowDisplay = formatVolume(state.runningKg, unit);
    const gapDisplay = formatVolume(state.gapKg, unit);
    // MAJ-1 fix (option c): suppress the reps clause when nothing has been
    // checked yet (`runningKg === 0`). Without this, a draft `100 × 5` (still
    // unchecked) renders as "Now 0 kg · ≈ 10 reps @ 100 kg" — internally
    // consistent but UX-misleading because the reps clause is then a
    // forward-looking projection of an unchecked draft, not a derived
    // consequence of the displayed Now.
    const showRepsClause =
      state.repsToBeat != null &&
      state.currentWeightKg != null &&
      state.runningKg > 0;
    const repsDisplay = showRepsClause
      ? `${state.repsToBeat!.toFixed(1)} reps`
      : null;
    const weightDisplay = showRepsClause
      ? formatWeight(state.currentWeightKg, unit)
      : null;

    const a11y = showRepsClause
      ? `Previous best ${maxDisplay}, current session ${nowDisplay}, ${gapDisplay} to beat your previous best. About ${state.repsToBeat!.toFixed(
          1,
        )} reps at ${weightDisplay}.`
      : `Previous best ${maxDisplay}, current session ${nowDisplay}, ${gapDisplay} to beat your previous best.`;

    return (
      <View className="border-b border-gray-100 px-4 py-2 dark:border-gray-900">
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
          {showRepsClause ? (
            <>
              {" · ≈ "}
              <Text className="font-semibold tabular-nums text-black dark:text-white">
                {repsDisplay}
              </Text>
              {` @ ${weightDisplay}`}
            </>
          ) : null}
        </Text>
      </View>
    );
  }

  // surpassed
  const isMatch = state.overflowKg === 0;
  const overflowDisplay = formatVolume(state.overflowKg, unit);
  const surMaxDisplay = formatVolume(state.previousMaxKg, unit);
  const surNowDisplay = formatVolume(state.runningKg, unit);
  const copy = isMatch
    ? "Matched your previous best — one more rep is a PR"
    : `New PR! +${overflowDisplay} over your previous`;
  const a11y = isMatch
    ? `Matched your previous best at ${surMaxDisplay}. Current session ${surNowDisplay}. One more rep beats it.`
    : `New personal record. ${overflowDisplay} over your previous best. Previous best ${surMaxDisplay}, current session ${surNowDisplay}.`;

  return (
    <View className="border-b border-gray-100 px-4 py-2 dark:border-gray-900">
      <Text
        accessibilityRole="text"
        accessibilityLabel={a11y}
        className="text-sm font-medium tabular-nums text-emerald-600 dark:text-emerald-400"
      >
        {copy}
      </Text>
      <Text className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
        {"Prev. Max "}
        <Text className="font-semibold tabular-nums text-black dark:text-white">
          {surMaxDisplay}
        </Text>
        {" · Now "}
        <Text className="font-semibold tabular-nums text-black dark:text-white">
          {surNowDisplay}
        </Text>
      </Text>
    </View>
  );
}
