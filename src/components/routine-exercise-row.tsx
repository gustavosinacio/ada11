import { ChevronDown, ChevronUp, Trash2 } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import type { RoutineExerciseEntry } from "~/api/routine-exercises";

type Props = {
  entry: RoutineExerciseEntry;
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  onChangeTargets: (patch: {
    target_sets?: number | null;
    target_reps?: number | null;
    target_weight?: string | null;
    target_rest_seconds?: number | null;
  }) => void;
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

export function RoutineExerciseRow({
  entry,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
  onRemove,
  onChangeTargets,
}: Props) {
  const [sets, setSets] = useState(entry.target_sets?.toString() ?? "");
  const [reps, setReps] = useState(entry.target_reps?.toString() ?? "");
  const [weight, setWeight] = useState(entry.target_weight ?? "");
  const [rest, setRest] = useState(entry.target_rest_seconds?.toString() ?? "");

  // Reset fields when the underlying row changes (e.g., after server invalidates).
  useEffect(() => {
    setSets(entry.target_sets?.toString() ?? "");
    setReps(entry.target_reps?.toString() ?? "");
    setWeight(entry.target_weight ?? "");
    setRest(entry.target_rest_seconds?.toString() ?? "");
  }, [entry.target_sets, entry.target_reps, entry.target_weight, entry.target_rest_seconds]);

  return (
    <View className="border-b border-gray-100 bg-white px-4 py-3 dark:border-gray-900 dark:bg-black">
      <View className="flex-row items-center justify-between">
        <View className="flex-1 pr-2">
          <Text className="text-base font-medium text-black dark:text-white">
            {entry.exercise.name}
          </Text>
          {(entry.exercise.muscles.length > 0 || entry.exercise.equipment) && (
            <Text className="mt-0.5 text-sm text-gray-500">
              {[
                entry.exercise.muscles.length > 0
                  ? entry.exercise.muscles.join(", ")
                  : null,
                entry.exercise.equipment,
              ]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          )}
        </View>

        <View className="flex-row items-center gap-1">
          <Pressable
            onPress={onMoveUp}
            disabled={isFirst}
            accessibilityLabel="Move up"
            accessibilityRole="button"
            className={`rounded p-2 ${isFirst ? "opacity-30" : ""}`}
          >
            <ChevronUp color="#6b7280" size={20} />
          </Pressable>
          <Pressable
            onPress={onMoveDown}
            disabled={isLast}
            accessibilityLabel="Move down"
            accessibilityRole="button"
            className={`rounded p-2 ${isLast ? "opacity-30" : ""}`}
          >
            <ChevronDown color="#6b7280" size={20} />
          </Pressable>
          <Pressable
            onPress={onRemove}
            accessibilityLabel="Remove exercise"
            accessibilityRole="button"
            className="rounded p-2"
          >
            <Trash2 color="#ef4444" size={18} />
          </Pressable>
        </View>
      </View>

      <View className="mt-3 flex-row gap-2">
        <TargetField
          label="Sets"
          value={sets}
          onChangeText={setSets}
          onCommit={() =>
            onChangeTargets({ target_sets: parseInt0(sets) })
          }
          placeholder="3"
          keyboardType="number-pad"
        />
        <TargetField
          label="Reps"
          value={reps}
          onChangeText={setReps}
          onCommit={() =>
            onChangeTargets({ target_reps: parseInt0(reps) })
          }
          placeholder="8"
          keyboardType="number-pad"
        />
        <TargetField
          label="Weight (kg)"
          value={weight}
          onChangeText={setWeight}
          onCommit={() =>
            onChangeTargets({ target_weight: parseWeightStr(weight) })
          }
          placeholder="60.0"
          keyboardType="decimal-pad"
        />
        <TargetField
          label="Rest (s)"
          value={rest}
          onChangeText={setRest}
          onCommit={() =>
            onChangeTargets({ target_rest_seconds: parseInt0(rest) })
          }
          placeholder="90"
          keyboardType="number-pad"
        />
      </View>
    </View>
  );
}

type FieldProps = {
  label: string;
  value: string;
  onChangeText: (s: string) => void;
  onCommit: () => void;
  placeholder?: string;
  keyboardType?: "number-pad" | "decimal-pad";
};

function TargetField({
  label,
  value,
  onChangeText,
  onCommit,
  placeholder,
  keyboardType,
}: FieldProps) {
  return (
    <View className="flex-1">
      <Text className="mb-1 text-xs text-gray-500">{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onBlur={onCommit}
        onSubmitEditing={onCommit}
        placeholder={placeholder}
        placeholderTextColor="#9ca3af"
        keyboardType={keyboardType}
        className="rounded-lg border border-gray-300 px-3 py-2 text-base text-black dark:border-gray-700 dark:text-white"
      />
    </View>
  );
}
