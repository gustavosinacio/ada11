import { ChevronDown, ChevronUp } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { SetInput } from "~/components/set-input";
import type { ExerciseRow, SetRow, SetType, WeightUnit } from "~/db/types";
import { useLastWorkingSet } from "~/hooks/use-sets";

type Props = {
  exercise: ExerciseRow;
  sets: SetRow[];
  unit: WeightUnit;
  isFirst?: boolean;
  isLast?: boolean;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onAddSet: (input: {
    set_type: SetType;
    parent_set_id?: string | null;
  }) => void;
  onUpdateSet: (
    id: string,
    patch: { reps: number | null; weight: string | null; rpe: string | null; notes: string | null },
  ) => void;
  onDeleteSet: (id: string) => void;
};

export function ExerciseBlock({
  exercise,
  sets,
  unit,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
  onAddSet,
  onUpdateSet,
  onDeleteSet,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);

  // Last working set in chronological order — drop sets stack onto it.
  const lastWorkingSet = useMemo(() => {
    for (let i = sets.length - 1; i >= 0; i--) {
      const s = sets[i];
      if (s && s.set_type === "working") return s;
    }
    return null;
  }, [sets]);

  // Cross-session fallback for placeholder values when this is the first set
  // of the exercise in the current session. Only fires once per exercise.
  const lastFromHistory = useLastWorkingSet(exercise.id);

  // For each row, the "previous completed set" used to seed placeholders:
  // walk backwards from the current row index, return the nearest prior set
  // that has both weight and reps. If none in-session, fall back to the most
  // recent past completed set.
  const previousByRowId = useMemo(() => {
    const map = new Map<string, SetRow | null>();
    for (let i = 0; i < sets.length; i++) {
      const current = sets[i];
      if (!current) continue;
      let prev: SetRow | null = null;
      for (let j = i - 1; j >= 0; j--) {
        const candidate = sets[j];
        if (candidate && candidate.weight != null && candidate.reps != null) {
          prev = candidate;
          break;
        }
      }
      map.set(current.id, prev ?? lastFromHistory.data ?? null);
    }
    return map;
  }, [sets, lastFromHistory.data]);

  const showReorder = !!onMoveUp || !!onMoveDown;

  return (
    <View className="border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-black">
      <View className="flex-row items-start justify-between px-4 py-3">
        <View className="flex-1 pr-2">
          <Text className="text-lg font-semibold text-black dark:text-white">
            {exercise.name}
          </Text>
          {(exercise.primary_muscle || exercise.equipment) && (
            <Text className="mt-0.5 text-sm text-gray-500">
              {[exercise.primary_muscle, exercise.equipment]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          )}
        </View>
        {showReorder && (
          <View className="flex-row items-center">
            <Pressable
              onPress={onMoveUp}
              disabled={!onMoveUp || isFirst}
              accessibilityLabel={`Move ${exercise.name} up`}
              accessibilityRole="button"
              className={`rounded p-2 ${!onMoveUp || isFirst ? "opacity-30" : ""}`}
            >
              <ChevronUp color="#6b7280" size={20} />
            </Pressable>
            <Pressable
              onPress={onMoveDown}
              disabled={!onMoveDown || isLast}
              accessibilityLabel={`Move ${exercise.name} down`}
              accessibilityRole="button"
              className={`rounded p-2 ${!onMoveDown || isLast ? "opacity-30" : ""}`}
            >
              <ChevronDown color="#6b7280" size={20} />
            </Pressable>
          </View>
        )}
      </View>

      {sets.length > 0 && (
        <View className="flex-row border-y border-gray-100 bg-gray-50 px-4 py-1 dark:border-gray-900 dark:bg-gray-950">
          <View className="w-7" />
          <Text className="w-6 text-xs text-gray-500">#</Text>
          <Text className="flex-1 text-xs text-gray-500">
            Weight ({unit})
          </Text>
          <Text className="flex-1 text-xs text-gray-500">Reps</Text>
          <Text className="w-14 text-xs text-gray-500">RPE</Text>
          <View className="w-7" />
          <View className="w-7" />
        </View>
      )}

      {sets.map((s) => (
        <SetInput
          key={s.id}
          row={s}
          unit={unit}
          previousSet={previousByRowId.get(s.id) ?? null}
          onCommit={(patch) => onUpdateSet(s.id, patch)}
          onDelete={() => onDeleteSet(s.id)}
        />
      ))}

      <View className="px-4 py-3">
        <View className="flex-row gap-2">
          <Pressable
            onPress={() => onAddSet({ set_type: "working" })}
            accessibilityRole="button"
            className="flex-1 rounded-lg bg-black py-2 dark:bg-white"
          >
            <Text className="text-center text-sm font-medium text-white dark:text-black">
              + Working set
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setMenuOpen((v) => !v)}
            accessibilityLabel="More set types"
            accessibilityRole="button"
            className="rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-700"
          >
            <ChevronDown color="#6b7280" size={18} />
          </Pressable>
        </View>

        {menuOpen && (
          <View className="mt-2 gap-2">
            <Pressable
              onPress={() => {
                onAddSet({ set_type: "warmup" });
                setMenuOpen(false);
              }}
              accessibilityRole="button"
              className="rounded-lg border border-gray-300 py-2 dark:border-gray-700"
            >
              <Text className="text-center text-sm text-black dark:text-white">
                + Warm-up
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                if (!lastWorkingSet) return;
                onAddSet({ set_type: "dropset", parent_set_id: lastWorkingSet.id });
                setMenuOpen(false);
              }}
              disabled={!lastWorkingSet}
              accessibilityRole="button"
              className={`rounded-lg border border-gray-300 py-2 dark:border-gray-700 ${!lastWorkingSet ? "opacity-50" : ""}`}
            >
              <Text className="text-center text-sm text-black dark:text-white">
                {lastWorkingSet
                  ? `+ Drop set (chains onto set ${lastWorkingSet.set_number})`
                  : "+ Drop set (needs a working set first)"}
              </Text>
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}
