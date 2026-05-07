import { Trash2 } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import type { SetRow, SetType, WeightUnit } from "~/db/types";
import { kgToLbs, lbsToKg } from "~/utils/units";

type Props = {
  row: SetRow;
  unit: WeightUnit;
  onCommit: (patch: { reps: number | null; weight: string | null; rpe: string | null }) => void;
  onDelete: () => void;
};

function parseInt0(s: string): number | null {
  const v = parseInt(s, 10);
  return Number.isFinite(v) && v > 0 ? v : null;
}

function parseFloat0(s: string): number | null {
  const cleaned = s.replace(",", ".").trim();
  if (!cleaned) return null;
  const v = parseFloat(cleaned);
  return Number.isFinite(v) && v >= 0 ? v : null;
}

function kgFromInputString(s: string, unit: WeightUnit): string | null {
  const v = parseFloat0(s);
  if (v == null) return null;
  const kg = unit === "kg" ? v : lbsToKg(v);
  return kg.toFixed(2);
}

function inputStringFromKg(kgStr: string | null, unit: WeightUnit): string {
  if (!kgStr) return "";
  const kg = parseFloat(kgStr);
  if (!Number.isFinite(kg)) return "";
  const v = unit === "kg" ? kg : kgToLbs(kg);
  // Trim trailing zeros for display.
  return Number.isInteger(v) ? v.toString() : v.toFixed(1);
}

const TYPE_BADGE: Record<SetType, { label: string; classes: string }> = {
  warmup: { label: "W", classes: "bg-yellow-100 text-yellow-800" },
  working: { label: "•", classes: "bg-gray-200 text-gray-800" },
  dropset: { label: "↓", classes: "bg-purple-100 text-purple-800" },
};

export function SetInput({ row, unit, onCommit, onDelete }: Props) {
  const [reps, setReps] = useState(row.reps?.toString() ?? "");
  const [weight, setWeight] = useState(inputStringFromKg(row.weight, unit));
  const [rpe, setRpe] = useState(row.rpe ?? "");

  useEffect(() => {
    setReps(row.reps?.toString() ?? "");
    setWeight(inputStringFromKg(row.weight, unit));
    setRpe(row.rpe ?? "");
  }, [row.reps, row.weight, row.rpe, unit]);

  const commit = () => {
    onCommit({
      reps: parseInt0(reps),
      weight: kgFromInputString(weight, unit),
      rpe: rpe.trim() ? parseFloat0(rpe)?.toFixed(1) ?? null : null,
    });
  };

  const badge = TYPE_BADGE[row.set_type];

  return (
    <View className="flex-row items-center gap-2 border-b border-gray-100 px-4 py-2 dark:border-gray-900">
      <View
        className={`h-7 w-7 items-center justify-center rounded-full ${badge.classes}`}
      >
        <Text className="text-xs font-semibold">{badge.label}</Text>
      </View>
      <Text className="w-6 text-sm text-gray-500">{row.set_number}</Text>

      <View className="flex-1">
        <TextInput
          value={weight}
          onChangeText={setWeight}
          onBlur={commit}
          onSubmitEditing={commit}
          placeholder={unit === "kg" ? "kg" : "lbs"}
          placeholderTextColor="#9ca3af"
          keyboardType="decimal-pad"
          className="rounded border border-gray-200 px-2 py-1.5 text-base text-black dark:border-gray-800 dark:text-white"
        />
      </View>

      <View className="flex-1">
        <TextInput
          value={reps}
          onChangeText={setReps}
          onBlur={commit}
          onSubmitEditing={commit}
          placeholder="reps"
          placeholderTextColor="#9ca3af"
          keyboardType="number-pad"
          className="rounded border border-gray-200 px-2 py-1.5 text-base text-black dark:border-gray-800 dark:text-white"
        />
      </View>

      <View className="w-14">
        <TextInput
          value={rpe}
          onChangeText={setRpe}
          onBlur={commit}
          onSubmitEditing={commit}
          placeholder="RPE"
          placeholderTextColor="#9ca3af"
          keyboardType="decimal-pad"
          className="rounded border border-gray-200 px-2 py-1.5 text-base text-black dark:border-gray-800 dark:text-white"
        />
      </View>

      <Pressable
        onPress={onDelete}
        accessibilityLabel="Delete set"
        accessibilityRole="button"
        className="rounded p-1"
      >
        <Trash2 color="#ef4444" size={16} />
      </Pressable>
    </View>
  );
}
