import { ChevronRight } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

import { SetVolumeBreakdown } from "~/components/set-volume-breakdown";
import type { SessionSets } from "~/api/progress";
import type { MeasurementEntryRow, WeightUnit } from "~/db/types";
import { bodyweightKgAsOf } from "~/utils/bodyweight";
import { parseISO } from "~/utils/dates";
import {
  presentExerciseSessionRow,
  presentSetVolumeLines,
} from "~/utils/exercise-session-row-format";
import { formatDisplayDate } from "~/utils/format-display-date";

type Props = {
  session: SessionSets;
  unit: WeightUnit;
  /** Equipment token of this exercise — makes the row's volume bodyweight-aware
   *  when `"bodyweight"`. */
  equipment?: string;
  /** Bodyweight leverage factor (`exercise.bodyweight_factor`, numeric ⇒
   *  STRING). Same source as `equipment`; NULL/absent ⇒ 1.0. */
  factor?: number | string | null;
  /** Measurements timeline; the row resolves this session's bodyweight from
   *  `session.started_at` (MIN-NEW-2: per-row, since the "Sessions" list is
   *  multi-session). */
  measurements?: MeasurementEntryRow[];
  onPress: () => void;
};

/**
 * Exercise-scoped session row for the `/(app)/exercises/{id}/progress`
 * "Sessions" section. Mirrors the visual idiom of `<SessionSummaryRow>`
 * (border-bottom, active-state, ChevronRight) but deliberately omits the
 * `px-4` horizontal padding so the host screen's ambient `px-6` governs
 * indent and the row's left edge aligns with the chart container above
 * (design-v2 MAJ-2b).
 *
 * Line 1: visible date (no time). Line 2: aggregate "N × volume" — only
 * rendered when the presenter returns a non-empty `volumeLabel`
 * (warmup-only sessions degrade gracefully to a date-only row). Below that,
 * one line per non-warmup set ("100 × 8 — 800 kg") so the row shows the
 * actual sets, not just the count + total. Per-set volumes sum to the total.
 *
 * A11y label includes the time-of-day so same-day sessions stay
 * disambiguated for screen readers and automation (design-v2 MAJ-1).
 */
export function ExerciseSessionRow({
  session,
  unit,
  equipment,
  factor,
  measurements,
  onPress,
}: Props) {
  // Resolve THIS session's bodyweight from its own started_at — the same value
  // is passed to both presenters so the per-set lines sum to the row total
  // (Invariant C).
  const bodyweightKg = bodyweightKgAsOf(
    measurements,
    parseISO(session.started_at).getTime(),
  );
  const { volumeLabel } = presentExerciseSessionRow({
    sets: session.sets,
    unit,
    equipment,
    factor,
    bodyweightKg,
  });
  const setLines = presentSetVolumeLines({
    sets: session.sets,
    unit,
    equipment,
    factor,
    bodyweightKg,
  });
  const visibleDate = formatDisplayDate(session.started_at, {
    includeWeekday: true,
  });
  const accessibleDate = formatDisplayDate(session.started_at, {
    includeWeekday: true,
    includeTime: true,
  });

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open session from ${accessibleDate}`}
      className="border-b border-gray-100 py-4 active:bg-gray-50 dark:border-gray-900 dark:active:bg-gray-950"
    >
      <View className="flex-row items-center justify-between">
        <View className="flex-1 pr-3">
          <Text className="text-base font-semibold text-black dark:text-white">
            {visibleDate}
          </Text>
          {volumeLabel !== "" ? (
            <Text className="mt-0.5 text-sm text-gray-500">{volumeLabel}</Text>
          ) : null}
          {setLines.length > 0 ? (
            <View className="mt-1.5">
              <SetVolumeBreakdown lines={setLines} />
            </View>
          ) : null}
        </View>
        <ChevronRight color="#9ca3af" size={18} />
      </View>
    </Pressable>
  );
}
