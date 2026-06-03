import { useMemo } from "react";
import { Text, View } from "react-native";

import { SetVolumeBreakdown } from "~/components/set-volume-breakdown";
import type { SetRow } from "~/db/types";
import { useMeasurements } from "~/hooks/use-measurements";
import {
  useMaxVolumeWindowWeeks,
  useWeightUnit,
} from "~/hooks/use-preferences";
import { useExerciseProgress } from "~/hooks/use-progress";
import { bodyweightKgAsOf } from "~/utils/bodyweight";
import { parseISO } from "~/utils/dates";
import { presentSetVolumeLines } from "~/utils/exercise-session-row-format";
import { formatVolume, formatWeight } from "~/utils/units";
import { computeVolumeTarget } from "~/utils/volume-target";
import { computeWindowStart } from "~/utils/window-utils";

type Props = {
  exerciseId: string;
  currentSessionSets: SetRow[];
  /** Equipment token of this exercise — when `"bodyweight"`, the Max/Now/To-PR
   *  math becomes bodyweight-aware. */
  equipment?: string;
  /** Bodyweight leverage factor (`exercise.bodyweight_factor`, numeric ⇒
   *  STRING). Same source as `equipment`; NULL/absent ⇒ 1.0. */
  factor?: number | string;
  /** `started_at` of the LIVE session — used to resolve the live bodyweight
   *  for the running session's volume. */
  liveSessionStartedAt?: string;
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
  equipment,
  factor,
  liveSessionStartedAt,
}: Props): React.JSX.Element | null {
  const progressQ = useExerciseProgress(exerciseId);
  const measurementsQ = useMeasurements();
  const unit = useWeightUnit();
  const weeks = useMaxVolumeWindowWeeks();
  const windowStartMs = useMemo(
    () => computeWindowStart(weeks, new Date()),
    [weeks],
  );

  // Bodyweight input for `computeVolumeTarget` (single exercise → a one-entry
  // equipment map; per-past-session bw resolved from each SessionSets.started_at;
  // live bw from the live session's started_at). Omitted (undefined) when this
  // is not a bodyweight exercise so the math stays byte-for-byte pre-feature.
  const bodyweight = useMemo(() => {
    if (equipment === undefined) return undefined;
    const equipmentByExerciseId = new Map<string, string>([
      [exerciseId, equipment],
    ]);
    // Parallel one-entry factor map (parseFloat the STRING numeric here so the
    // map only ever holds finite numbers; an absent key coalesces to 1.0 at
    // the seam). Guard `!= null` + `Number.isFinite` so a NaN never enters.
    const factorByExerciseId = new Map<string, number>();
    const f =
      factor == null
        ? undefined
        : typeof factor === "string"
          ? parseFloat(factor)
          : factor;
    if (f != null && Number.isFinite(f)) factorByExerciseId.set(exerciseId, f);
    const measurements = measurementsQ.data;
    const pastBodyweightBySession = new Map<string, number | null>();
    for (const s of progressQ.data ?? []) {
      pastBodyweightBySession.set(
        s.session_id,
        bodyweightKgAsOf(measurements, parseISO(s.started_at).getTime()),
      );
    }
    const liveBodyweightKg = liveSessionStartedAt
      ? bodyweightKgAsOf(measurements, parseISO(liveSessionStartedAt).getTime())
      : null;
    return {
      equipmentByExerciseId,
      factorByExerciseId,
      liveBodyweightKg,
      pastBodyweightBySession,
    };
  }, [
    equipment,
    factor,
    exerciseId,
    measurementsQ.data,
    progressQ.data,
    liveSessionStartedAt,
  ]);

  const state = useMemo(
    () =>
      computeVolumeTarget({
        pastSessions: progressQ.data,
        currentSessionSets,
        windowStartMs,
        bodyweight,
      }),
    [progressQ.data, currentSessionSets, windowStartMs, bodyweight],
  );

  // Hide while loading (no skeleton — keeps the block compact during
  // cold-start fan-out across N exercises).
  if (progressQ.isLoading) return null;
  if (state.kind === "no-pr") return null;

  // Bodyweight of the session that achieved `previousMaxKg`, resolved from any
  // of its sets' `session_id` (all share one session). Passed alongside
  // `equipment` to `presentSetVolumeLines` so the max-session per-set lines sum
  // to `previousMaxKg` for a bodyweight exercise (Invariant C).
  const maxSessionBwKg =
    bodyweight && state.previousMaxSets[0]
      ? bodyweight.pastBodyweightBySession.get(
          state.previousMaxSets[0].session_id,
        ) ?? null
      : null;

  if (state.kind === "chasing") {
    const maxDisplay = formatVolume(state.previousMaxKg, unit);
    const nowDisplay = formatVolume(state.runningKg, unit);
    const gapDisplay = formatVolume(state.gapKg, unit);
    // Per-set breakdown of the session that achieved the Max, so the user can
    // see *how* the previous best was built (Feature: volume per set on max).
    const maxLines = presentSetVolumeLines({
      sets: state.previousMaxSets,
      unit,
      equipment,
      factor,
      bodyweightKg: maxSessionBwKg,
    });
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
        {maxLines.length > 0 ? (
          <View className="mt-1">
            <Text className="mb-0.5 text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">
              Max session — volume per set
            </Text>
            <SetVolumeBreakdown lines={maxLines} />
          </View>
        ) : null}
      </View>
    );
  }

  // surpassed
  const isMatch = state.overflowKg === 0;
  const overflowDisplay = formatVolume(state.overflowKg, unit);
  const surMaxDisplay = formatVolume(state.previousMaxKg, unit);
  const surNowDisplay = formatVolume(state.runningKg, unit);
  const surMaxLines = presentSetVolumeLines({
    sets: state.previousMaxSets,
    unit,
    equipment,
    factor,
    bodyweightKg: maxSessionBwKg,
  });
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
      {surMaxLines.length > 0 ? (
        <View className="mt-1">
          <Text className="mb-0.5 text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">
            Prev. max session — volume per set
          </Text>
          <SetVolumeBreakdown lines={surMaxLines} />
        </View>
      ) : null}
    </View>
  );
}
