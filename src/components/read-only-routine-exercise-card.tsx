import { useMemo } from "react";
import { Text, View } from "react-native";

import type { RoutineExerciseEntry } from "~/api/routine-exercises";
import {
  formatEquipment,
  type RoutineExerciseSetRow,
  type SetType,
  type WeightUnit,
} from "~/db/types";
import { displayReps, displayWeight } from "~/utils/set-display";

/**
 * Read-only render of ONE routine exercise + its per-set targets. The
 * structural counterpart of `<ReadOnlyExerciseBlock>` (the History read-only
 * precedent), but on routine TARGETS (`RoutineExerciseSetRow`:
 * `target_reps`/`target_weight`, no completed/rpe/notes columns) instead of
 * logged `SetRow`s.
 *
 * The editor's `<RoutineExerciseCard>` is edit-only (every set is a
 * `<TextInput>` row + move/trash + add-set menu) and is intentionally NOT made
 * read-only (LOCKED #1). This is a SEPARATE component; the editor card is
 * untouched.
 *
 * Read-only by construction — the prop shape carries no callbacks, so there is
 * no mutation affordance (mirrors `<ReadOnlyExerciseBlock>`'s no-mutation
 * contract).
 */

type Props = {
  entry: RoutineExerciseEntry;
  /** Pre-grouped + sorted by set_number ASC (same as the editor's reducer). */
  sets: RoutineExerciseSetRow[];
  unit: WeightUnit;
};

const TYPE_BADGE: Record<SetType, { label: string; classes: string }> = {
  warmup: { label: "W", classes: "bg-yellow-100 text-yellow-800" },
  working: { label: "•", classes: "bg-gray-200 text-gray-800" },
  dropset: { label: "↓", classes: "bg-purple-100 text-purple-800" },
};

export function ReadOnlyRoutineExerciseCard({ entry, sets, unit }: Props) {
  const muscles = entry.exercise.muscles ?? [];
  // Header subline reuses the editor's exact formula
  // (routine-exercise-card.tsx:140-149): "muscles · equipment".
  const subline =
    muscles.length > 0 || entry.exercise.equipment
      ? [
          muscles.length > 0 ? muscles.join(", ") : null,
          formatEquipment(entry.exercise.equipment),
        ]
          .filter(Boolean)
          .join(" · ")
      : null;

  // `set_id -> set_number` lookup for the dropset "↳ N" parent reference
  // (same pattern as `<ReadOnlyExerciseBlock>`).
  const setNumberById = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of sets) map.set(s.id, s.set_number);
    return map;
  }, [sets]);

  return (
    <View className="border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-black">
      <View className="px-4 py-3">
        <Text className="text-lg font-semibold text-black dark:text-white">
          {entry.exercise.name}
        </Text>
        {subline ? (
          <Text className="mt-0.5 text-sm text-gray-500">{subline}</Text>
        ) : null}
      </View>

      {sets.length > 0 ? (
        <View className="flex-row items-center gap-2 border-y border-gray-100 bg-gray-50 px-4 py-1 dark:border-gray-900 dark:bg-gray-950">
          <Text className="w-7 text-xs text-gray-500">#</Text>
          <Text className="flex-1 text-xs text-gray-500">Weight ({unit})</Text>
          <Text className="flex-1 text-xs text-gray-500">Reps</Text>
        </View>
      ) : null}

      {sets.length === 0 ? (
        <Text className="px-4 py-3 text-sm italic text-gray-500">
          No sets configured.
        </Text>
      ) : (
        sets.map((s) => {
          const badge = TYPE_BADGE[s.set_type];
          const isWarmup = s.set_type === "warmup";
          const isDropset = s.set_type === "dropset";
          const accentClass = isWarmup
            ? "border-l-2 border-l-yellow-400 dark:border-l-yellow-500"
            : isDropset
              ? "border-l-2 border-l-purple-400 dark:border-l-purple-500"
              : "border-l-2 border-l-transparent";
          const typeBg = isWarmup
            ? "bg-yellow-50/60 dark:bg-yellow-950/20"
            : isDropset
              ? "bg-purple-50/60 dark:bg-purple-950/20"
              : "";
          const innerPadding = isDropset ? "pl-8 pr-4" : "px-4";
          const parentSetNumber =
            s.parent_set_id != null
              ? (setNumberById.get(s.parent_set_id) ?? null)
              : null;
          return (
            <View
              key={s.id}
              className={`border-b border-gray-100 dark:border-gray-900 ${accentClass} ${typeBg}`}
            >
              <View
                className={`flex-row items-center gap-2 ${innerPadding} py-2`}
              >
                <View
                  className={`h-7 w-7 items-center justify-center rounded-full ${badge.classes}`}
                >
                  <Text className="text-xs font-semibold">{badge.label}</Text>
                </View>

                {isDropset && parentSetNumber != null ? (
                  <Text
                    className="text-xs font-medium text-purple-600 dark:text-purple-400"
                    accessibilityLabel={`Drop set chained to set ${parentSetNumber}`}
                  >
                    ↳{parentSetNumber}
                  </Text>
                ) : null}

                <Text className="w-6 text-sm text-gray-500">
                  {s.set_number}
                </Text>

                <View className="flex-1">
                  <Text className="text-base text-black dark:text-white">
                    {displayWeight(s.target_weight, unit)}
                  </Text>
                </View>

                <View className="flex-1">
                  <Text className="text-base text-black dark:text-white">
                    {displayReps(s.target_reps)}
                  </Text>
                </View>
              </View>
            </View>
          );
        })
      )}
    </View>
  );
}
