import {
  ChevronDown,
  ChevronUp,
  Trash2,
} from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { confirmDelete } from "~/components/confirm-delete";
import type { RoutineExerciseEntry } from "~/api/routine-exercises";
import type { RoutineExerciseSetRow, SetType } from "~/db/types";

type Props = {
  entry: RoutineExerciseEntry;
  /** Pre-filtered + sorted by set_number ASC. */
  setsForExercise: RoutineExerciseSetRow[];
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemoveExercise: () => void;
  onChangeRest: (seconds: number | null) => Promise<void> | void;
  onAddSet: (input: {
    set_type: SetType;
    parent_set_id?: string | null;
  }) => Promise<void>;
  onUpdateSet: (
    id: string,
    patch: { target_reps?: number | null; target_weight?: string | null },
  ) => Promise<void>;
  onRemoveSet: (id: string) => Promise<void>;
  onReorderSets: (orderedIds: string[]) => Promise<void>;
  /**
   * Predicate applied per set row: when true, the trash icon prompts
   * `confirmDelete` first; otherwise the set is soft-deleted directly.
   * Default at parent: `(set) => set.target_reps != null && set.target_weight != null`.
   */
  confirmRemoveSet: (set: RoutineExerciseSetRow) => boolean;
};

function parseInt0(s: string): number | null {
  const v = parseInt(s, 10);
  return Number.isFinite(v) && v > 0 ? v : null;
}

function parseWeightStr(s: string): string | null {
  const cleaned = s.replace(",", ".").trim();
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return n.toFixed(2);
}

function setTypeLabel(t: SetType): string {
  switch (t) {
    case "warmup":
      return "warm-up";
    case "dropset":
      return "dropset";
    default:
      return "working";
  }
}

export function RoutineExerciseCard({
  entry,
  setsForExercise,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
  onRemoveExercise,
  onChangeRest,
  onAddSet,
  onUpdateSet,
  onRemoveSet,
  onReorderSets,
  confirmRemoveSet,
}: Props) {
  const [expanded, setExpanded] = useState(true); // open-by-default per U6
  const [menuOpen, setMenuOpen] = useState(false);
  const [isMutating, setIsMutating] = useState(false);

  const lastWorkingSet = useMemo(() => {
    for (let i = setsForExercise.length - 1; i >= 0; i--) {
      const s = setsForExercise[i];
      if (s && s.set_type === "working") return s;
    }
    return null;
  }, [setsForExercise]);

  const muscles = entry.exercise.muscles ?? [];

  const handleAddSet = async (input: {
    set_type: SetType;
    parent_set_id?: string | null;
  }) => {
    if (isMutating) return;
    setIsMutating(true);
    try {
      await onAddSet(input);
    } finally {
      setIsMutating(false);
    }
  };

  const moveSet = async (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= setsForExercise.length) return;
    const next = [...setsForExercise];
    const tmp = next[idx]!;
    next[idx] = next[target]!;
    next[target] = tmp;
    await onReorderSets(next.map((s) => s.id));
  };

  return (
    <View className="border-b border-gray-100 bg-white dark:border-gray-900 dark:bg-black">
      {/* Header — tap to collapse/expand */}
      <View className="flex-row items-center justify-between px-4 py-3">
        <Pressable
          onPress={() => setExpanded((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={expanded ? "Collapse exercise" : "Expand exercise"}
          className="flex-1 flex-row items-center pr-2"
        >
          {expanded ? (
            <ChevronDown color="#6b7280" size={18} />
          ) : (
            <ChevronUp color="#6b7280" size={18} />
          )}
          <View className="ml-2 flex-1">
            <Text className="text-base font-medium text-black dark:text-white">
              {entry.exercise.name}
            </Text>
            {(muscles.length > 0 || entry.exercise.equipment) && (
              <Text className="mt-0.5 text-sm text-gray-500">
                {[
                  muscles.length > 0 ? muscles.join(", ") : null,
                  entry.exercise.equipment,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            )}
          </View>
        </Pressable>

        <View className="flex-row items-center gap-1">
          <Pressable
            onPress={onMoveUp}
            disabled={isFirst}
            accessibilityLabel="Move exercise up"
            accessibilityRole="button"
            className={`rounded p-2 ${isFirst ? "opacity-30" : ""}`}
          >
            <ChevronUp color="#6b7280" size={20} />
          </Pressable>
          <Pressable
            onPress={onMoveDown}
            disabled={isLast}
            accessibilityLabel="Move exercise down"
            accessibilityRole="button"
            className={`rounded p-2 ${isLast ? "opacity-30" : ""}`}
          >
            <ChevronDown color="#6b7280" size={20} />
          </Pressable>
          <Pressable
            onPress={onRemoveExercise}
            accessibilityLabel="Remove exercise"
            accessibilityRole="button"
            className="rounded p-2"
          >
            <Trash2 color="#ef4444" size={18} />
          </Pressable>
        </View>
      </View>

      {expanded ? (
        <>
          {/* Sets list */}
          {setsForExercise.length > 0 ? (
            <View className="border-t border-gray-100 dark:border-gray-900">
              <View className="flex-row items-center gap-2 bg-gray-50 px-4 py-1 dark:bg-gray-950">
                <Text className="w-6 text-xs text-gray-500">#</Text>
                <Text className="flex-1 text-xs text-gray-500">Weight (kg)</Text>
                <Text className="flex-1 text-xs text-gray-500">Reps</Text>
                <Text className="w-16 text-xs text-gray-500">Type</Text>
                <View className="w-20" />
              </View>
              {setsForExercise.map((set, idx) => (
                <SetEditorRow
                  key={set.id}
                  set={set}
                  index={idx}
                  isFirst={idx === 0}
                  isLast={idx === setsForExercise.length - 1}
                  onMoveUp={() => moveSet(idx, -1)}
                  onMoveDown={() => moveSet(idx, 1)}
                  onUpdate={onUpdateSet}
                  onRemove={async () => {
                    if (confirmRemoveSet(set)) {
                      const ok = await confirmDelete({
                        title: `Remove set ${set.set_number}?`,
                        message: "This can be undone by re-adding the set.",
                      });
                      if (!ok) return;
                    }
                    await onRemoveSet(set.id);
                  }}
                />
              ))}
            </View>
          ) : (
            <View className="border-t border-gray-100 px-4 py-3 dark:border-gray-900">
              <Text className="text-sm text-gray-500">
                No sets yet. Add your first below.
              </Text>
            </View>
          )}

          {/* Add-set footer — mirrors <ExerciseBlock> terminology. */}
          <View className="border-t border-gray-100 px-4 py-3 dark:border-gray-900">
            <View className="flex-row gap-2">
              <Pressable
                onPress={() => handleAddSet({ set_type: "working" })}
                disabled={isMutating}
                accessibilityRole="button"
                accessibilityLabel="Add working set"
                className={`flex-1 rounded-lg bg-black py-2 dark:bg-white ${isMutating ? "opacity-50" : ""}`}
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

            {menuOpen ? (
              <View className="mt-2 gap-2">
                <Pressable
                  onPress={() => {
                    handleAddSet({ set_type: "warmup" });
                    setMenuOpen(false);
                  }}
                  disabled={isMutating}
                  accessibilityRole="button"
                  accessibilityLabel="Add warm-up set"
                  className={`rounded-lg border border-gray-300 py-2 dark:border-gray-700 ${isMutating ? "opacity-50" : ""}`}
                >
                  <Text className="text-center text-sm text-black dark:text-white">
                    + Warm-up
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    if (!lastWorkingSet) return;
                    handleAddSet({
                      set_type: "dropset",
                      parent_set_id: lastWorkingSet.id,
                    });
                    setMenuOpen(false);
                  }}
                  disabled={!lastWorkingSet || isMutating}
                  accessibilityRole="button"
                  accessibilityLabel="Add drop set"
                  className={`rounded-lg border border-gray-300 py-2 dark:border-gray-700 ${!lastWorkingSet || isMutating ? "opacity-50" : ""}`}
                >
                  <Text className="text-center text-sm text-black dark:text-white">
                    {lastWorkingSet
                      ? `+ Drop set (chains onto set ${lastWorkingSet.set_number})`
                      : "+ Drop set (needs a working set first)"}
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </View>

          {/* Per-exercise rest field */}
          <RestField
            initial={entry.target_rest_seconds}
            onCommit={onChangeRest}
          />
        </>
      ) : null}
    </View>
  );
}

type SetRowProps = {
  set: RoutineExerciseSetRow;
  index: number;
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onUpdate: (
    id: string,
    patch: { target_reps?: number | null; target_weight?: string | null },
  ) => Promise<void>;
  onRemove: () => Promise<void>;
};

function SetEditorRow({
  set,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
  onUpdate,
  onRemove,
}: SetRowProps) {
  const [weight, setWeight] = useState(set.target_weight ?? "");
  const [reps, setReps] = useState(set.target_reps?.toString() ?? "");

  // Reset on server-driven changes (e.g., reorder writes set_number; the row
  // identity is stable via key={set.id}, but server invalidations may flip
  // target_reps / target_weight).
  useEffect(() => {
    setWeight(set.target_weight ?? "");
    setReps(set.target_reps?.toString() ?? "");
  }, [set.target_weight, set.target_reps]);

  const commitWeight = () => {
    const parsed = parseWeightStr(weight);
    if ((parsed ?? null) === (set.target_weight ?? null)) return;
    void onUpdate(set.id, { target_weight: parsed });
  };

  const commitReps = () => {
    const parsed = parseInt0(reps);
    if ((parsed ?? null) === (set.target_reps ?? null)) return;
    void onUpdate(set.id, { target_reps: parsed });
  };

  return (
    <View className="flex-row items-center gap-2 border-t border-gray-100 px-4 py-2 dark:border-gray-900">
      <Text className="w-6 text-sm text-black dark:text-white">
        {set.set_number}
      </Text>
      <View className="flex-1">
        <TextInput
          value={weight}
          onChangeText={setWeight}
          onBlur={commitWeight}
          onSubmitEditing={commitWeight}
          placeholder="60.0"
          placeholderTextColor="#9ca3af"
          keyboardType="decimal-pad"
          accessibilityLabel={`Weight for set ${set.set_number}`}
          className="rounded-lg border border-gray-300 px-3 py-2 text-base text-black dark:border-gray-700 dark:text-white"
        />
      </View>
      <View className="flex-1">
        <TextInput
          value={reps}
          onChangeText={setReps}
          onBlur={commitReps}
          onSubmitEditing={commitReps}
          placeholder="8"
          placeholderTextColor="#9ca3af"
          keyboardType="number-pad"
          accessibilityLabel={`Reps for set ${set.set_number}`}
          className="rounded-lg border border-gray-300 px-3 py-2 text-base text-black dark:border-gray-700 dark:text-white"
        />
      </View>
      <Text className="w-16 text-xs text-gray-500">{setTypeLabel(set.set_type)}</Text>
      <View className="flex-row items-center">
        <Pressable
          onPress={onMoveUp}
          disabled={isFirst}
          accessibilityLabel={`Move set ${set.set_number} up`}
          accessibilityRole="button"
          className={`rounded p-1 ${isFirst ? "opacity-30" : ""}`}
        >
          <ChevronUp color="#6b7280" size={16} />
        </Pressable>
        <Pressable
          onPress={onMoveDown}
          disabled={isLast}
          accessibilityLabel={`Move set ${set.set_number} down`}
          accessibilityRole="button"
          className={`rounded p-1 ${isLast ? "opacity-30" : ""}`}
        >
          <ChevronDown color="#6b7280" size={16} />
        </Pressable>
        <Pressable
          onPress={onRemove}
          accessibilityLabel={`Remove set ${set.set_number}`}
          accessibilityRole="button"
          className="rounded p-1"
        >
          <Trash2 color="#ef4444" size={16} />
        </Pressable>
      </View>
    </View>
  );
}

type RestFieldProps = {
  initial: number | null;
  onCommit: (seconds: number | null) => Promise<void> | void;
};

function RestField({ initial, onCommit }: RestFieldProps) {
  const [rest, setRest] = useState(initial?.toString() ?? "");

  useEffect(() => {
    setRest(initial?.toString() ?? "");
  }, [initial]);

  const commit = () => {
    const parsed = parseInt0(rest);
    if ((parsed ?? null) === (initial ?? null)) return;
    void onCommit(parsed);
  };

  return (
    <View className="flex-row items-center gap-3 border-t border-gray-100 px-4 py-3 dark:border-gray-900">
      <Text className="text-sm text-gray-500">Rest between sets</Text>
      <View className="w-24">
        <TextInput
          value={rest}
          onChangeText={setRest}
          onBlur={commit}
          onSubmitEditing={commit}
          placeholder="90"
          placeholderTextColor="#9ca3af"
          keyboardType="number-pad"
          accessibilityLabel="Rest between sets in seconds"
          className="rounded-lg border border-gray-300 px-3 py-2 text-base text-black dark:border-gray-700 dark:text-white"
        />
      </View>
      <Text className="text-sm text-gray-500">s</Text>
    </View>
  );
}
