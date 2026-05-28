import { ChevronDown, ChevronUp, Trash2 } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

import type { UpdateSetMetaInput } from "~/api/sets";
import { ExerciseNoteSlot } from "~/components/exercise-note-slot";
import { SetInput } from "~/components/set-input";
import { VolumeTargetSlot } from "~/components/volume-target-slot";
import {
  formatEquipment,
  type ExerciseRow,
  type SetRow,
  type SetType,
  type WeightUnit,
} from "~/db/types";
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
    patch: { reps: number | null; weight: string | null },
  ) => void;
  /** Per-set bottom-sheet menu commits RPE/notes through this. */
  onUpdateSetMeta: (id: string, patch: UpdateSetMetaInput) => void;
  onDeleteSet: (id: string) => void;
  onRemove?: () => void;
  removeDisabled?: boolean;
  /** When provided, the exercise name `<Text>` is wrapped in a `<Pressable>`
   *  that invokes this callback on press. When omitted, the name renders as
   *  plain text (current behavior). Callers own the navigation target. */
  onPressName?: () => void;
  /** Live-session only. Forwarded to each <SetInput>. Default: false. */
  showCheckable?: boolean;
  /** Forwarded toggle handler. Required when showCheckable === true.
   *  `nextChecked` is the state the row will be in after the toggle.
   *  `options.previousSet` is the placeholder source (in-session previous
   *  if any, else `useLastWorkingSet` fallback, else null) — sourced from
   *  the existing `previousByRowId` Map. `options.currentInput` carries the
   *  LIVE typed strings from `<SetInput>`'s local state (mid-typing,
   *  not-yet-blurred values). The screen-level handler uses both to compute
   *  the check-time auto-fill payload. */
  onToggleSetChecked?: (
    setId: string,
    nextChecked: boolean,
    options: {
      previousSet: SetRow | null;
      currentInput: { weight: string; reps: string };
    },
  ) => void | Promise<void>;
  /** Set IDs whose check/uncheck mutation is currently in flight. Each such
   *  set's check button shows a spinner and is disabled. Live-session only;
   *  omitted on the history-edit caller (no check toggle there). */
  pendingCheckSetIds?: Set<string>;
  /** Live-session only. When true, mounts `<VolumeTargetSlot>` below the
   *  header so the block subscribes to `useExerciseProgress(exercise.id)`
   *  and renders the per-exercise volume-target strip. Default: false. */
  showVolumeTarget?: boolean;
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
  onUpdateSetMeta,
  onDeleteSet,
  onRemove,
  removeDisabled,
  onPressName,
  showCheckable = false,
  onToggleSetChecked,
  pendingCheckSetIds,
  showVolumeTarget = false,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  // Local in-flight guard so a quick double-tap on the add-set button doesn't
  // race two `MAX(set_number) + 1` reads and produce duplicate rows (the DB
  // partial unique index on (session, exercise, set_number) would reject the
  // second insert and surface as an error toast, which is worse UX than a
  // disabled button for ~200ms). Per-exercise scope so tapping Bench's add
  // doesn't disable Squat's.
  const [isAddingSet, setIsAddingSet] = useState(false);
  const handleAddSet = async (input: {
    set_type: SetType;
    parent_set_id?: string | null;
  }) => {
    if (isAddingSet) return;
    setIsAddingSet(true);
    try {
      await Promise.resolve(onAddSet(input));
    } finally {
      setIsAddingSet(false);
    }
  };

  const muscles = exercise.muscles ?? [];

  // `set_id -> set_number` lookup used by each <SetInput> to render the
  // "↳ N" parent reference on dropset rows (resolves `row.parent_set_id` to
  // the chained working set's display number).
  const setNumberById = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of sets) map.set(s.id, s.set_number);
    return map;
  }, [sets]);

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

  const showActions = !!onMoveUp || !!onMoveDown || !!onRemove;

  return (
    <View className="border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-black">
      <View className="flex-row items-start justify-between px-4 py-3">
        <View className="flex-1 pr-2">
          {onPressName ? (
            <Pressable
              onPress={onPressName}
              accessibilityRole="button"
              accessibilityLabel={`View progress for ${exercise.name}`}
              className="active:opacity-70"
            >
              <Text className="text-lg font-semibold text-black dark:text-white">
                {exercise.name}
                {exercise.deleted_at != null ? (
                  <Text className="text-base font-normal text-gray-500"> (deleted)</Text>
                ) : null}
              </Text>
            </Pressable>
          ) : (
            <Text className="text-lg font-semibold text-black dark:text-white">
              {exercise.name}
              {exercise.deleted_at != null ? (
                <Text className="text-base font-normal text-gray-500"> (deleted)</Text>
              ) : null}
            </Text>
          )}
          {(muscles.length > 0 || exercise.equipment) && (
            <Text className="mt-0.5 text-sm text-gray-500">
              {[
                muscles.length > 0
                  ? muscles.join(", ")
                  : null,
                formatEquipment(exercise.equipment),
              ]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          )}
        </View>
        {showActions && (
          <View className="flex-row items-center">
            {(onMoveUp || onMoveDown) && (
              <>
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
              </>
            )}
            {onRemove && (
              <Pressable
                onPress={onRemove}
                disabled={!!removeDisabled}
                accessibilityLabel={`Remove ${exercise.name} from workout`}
                accessibilityRole="button"
                className={`rounded p-2 ${removeDisabled ? "opacity-30" : ""}`}
              >
                <Trash2 color="#ef4444" size={18} />
              </Pressable>
            )}
          </View>
        )}
      </View>

      <ExerciseNoteSlot exerciseId={exercise.id} editable={true} />

      {showVolumeTarget ? (
        <VolumeTargetSlot
          exerciseId={exercise.id}
          currentSessionSets={sets}
        />
      ) : null}

      {sets.length > 0 && (
        <View className="flex-row items-center gap-2 border-y border-gray-100 bg-gray-50 px-4 py-1 dark:border-gray-900 dark:bg-gray-950">
          {/* Additive leading spacer (44pt) matching the check-button tap
              target in <SetInput>. History detail keeps the original
              column positions because it doesn't pass `showCheckable`. */}
          {showCheckable ? <View className="w-11" /> : null}
          <View className="w-7" />
          <Text className="w-6 text-xs text-gray-500">#</Text>
          <Text className="flex-1 text-xs text-gray-500">
            Weight ({unit})
          </Text>
          <Text className="flex-1 text-xs text-gray-500">Reps</Text>
          {/* 44pt spacer for the per-row menu trigger. */}
          <View className="w-11" />
          {/* Trash spacer mirrors the row's `rounded p-1` icon (~28pt). */}
          <View className="w-7" />
        </View>
      )}

      {sets.map((s) => (
        <SetInput
          key={s.id}
          row={s}
          unit={unit}
          previousSet={previousByRowId.get(s.id) ?? null}
          showCheckable={showCheckable}
          checkPending={pendingCheckSetIds?.has(s.id) ?? false}
          parentSetNumber={
            s.parent_set_id ? setNumberById.get(s.parent_set_id) ?? null : null
          }
          exerciseName={exercise.name}
          onToggleChecked={
            onToggleSetChecked
              ? (nextChecked, currentInput) =>
                  onToggleSetChecked(s.id, nextChecked, {
                    previousSet: previousByRowId.get(s.id) ?? null,
                    currentInput,
                  })
              : undefined
          }
          onCommit={(patch) => onUpdateSet(s.id, patch)}
          onUpdateMeta={(patch) => onUpdateSetMeta(s.id, patch)}
          onDelete={() => onDeleteSet(s.id)}
        />
      ))}

      <View className="px-4 py-3">
        <View className="flex-row gap-2">
          <Pressable
            onPress={() => handleAddSet({ set_type: "working" })}
            disabled={isAddingSet}
            accessibilityRole="button"
            className={`flex-1 rounded-lg bg-black py-2 dark:bg-white ${isAddingSet ? "opacity-50" : ""}`}
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
                handleAddSet({ set_type: "warmup" });
                setMenuOpen(false);
              }}
              disabled={isAddingSet}
              accessibilityRole="button"
              className={`rounded-lg border border-gray-300 py-2 dark:border-gray-700 ${isAddingSet ? "opacity-50" : ""}`}
            >
              <Text className="text-center text-sm text-black dark:text-white">
                + Warm-up
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                if (!lastWorkingSet) return;
                handleAddSet({ set_type: "dropset", parent_set_id: lastWorkingSet.id });
                setMenuOpen(false);
              }}
              disabled={!lastWorkingSet || isAddingSet}
              accessibilityRole="button"
              className={`rounded-lg border border-gray-300 py-2 dark:border-gray-700 ${!lastWorkingSet || isAddingSet ? "opacity-50" : ""}`}
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
