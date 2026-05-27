import { CheckSquare, MoreHorizontal, Square, Trash2 } from "lucide-react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";

import type { UpdateSetMetaInput } from "~/api/sets";
import { SetRowMenu } from "~/components/set-row-menu";
import type { SetRow, SetType, WeightUnit } from "~/db/types";
import { kgToLbs, lbsToKg } from "~/utils/units";

type Props = {
  row: SetRow;
  unit: WeightUnit;
  /**
   * Previous completed set for this exercise (in-session if any, else from
   * the most recent past session). Its weight/reps/rpe are used as placeholder
   * text on this row's empty fields. Not used as the actual value.
   */
  previousSet?: SetRow | null;
  /** Live-session only. When true, render the leading check button and apply
   *  the "checked" tint when row.completed_at != null. Default: false. */
  showCheckable?: boolean;
  /** Forwarded toggle handler. `currentInput` carries the LIVE local-state
   *  values of the row's weight/reps text inputs — the typed-but-not-blurred
   *  strings the user has on screen RIGHT NOW. The row's cached
   *  `weight`/`reps` may differ (the user can tap the check button before
   *  blurring). The check-time auto-fill predicate reads from these strings
   *  so a value typed without a blur is honored, never clobbered. */
  onToggleChecked?: (
    nextChecked: boolean,
    currentInput: { weight: string; reps: string },
  ) => void;
  /** Live-session only. True while this set's check/uncheck mutation is in
   *  flight. Swaps the check icon for a spinner and disables the press so the
   *  user can't re-toggle until the background save settles. The row's green
   *  tint still flips instantly (optimistic), so this is a "saving" affordance
   *  on top of the instant flip, not a wait-for-server gate. */
  checkPending?: boolean;
  /** Reps/weight commit on blur or submit. RPE/notes flow through onUpdateMeta. */
  onCommit: (patch: { reps: number | null; weight: string | null }) => void;
  /** Called when the per-row menu commits an RPE or notes change. */
  onUpdateMeta: (patch: UpdateSetMetaInput) => void;
  /** Used as the bottom-sheet menu's title. */
  exerciseName: string;
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

export function SetInput({
  row,
  unit,
  previousSet,
  showCheckable = false,
  onToggleChecked,
  checkPending = false,
  onCommit,
  onUpdateMeta,
  exerciseName,
  onDelete,
}: Props) {
  const weightPlaceholder = previousSet?.weight
    ? inputStringFromKg(previousSet.weight, unit)
    : unit === "kg"
      ? "kg"
      : "lbs";
  const repsPlaceholder = previousSet?.reps != null
    ? previousSet.reps.toString()
    : "reps";
  const [reps, setReps] = useState(row.reps?.toString() ?? "");
  const [weight, setWeight] = useState(inputStringFromKg(row.weight, unit));
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setReps(row.reps?.toString() ?? "");
    setWeight(inputStringFromKg(row.weight, unit));
  }, [row.reps, row.weight, unit]);

  const commit = () => {
    const newWeight = kgFromInputString(weight, unit);
    const newReps = parseInt0(reps);
    // F7 follow-up race fix: skip the no-op blur-commit. When both local
    // strings parse to null AND the row was already null, this PATCH is a
    // null→null write that races the toggle handler's auto-fill `updateSet`
    // PATCH on the same `id` (PostgREST gives no ordering guarantee for
    // concurrent UPDATEs on one row). Suppressing it removes the colliding
    // writer entirely on the focused-empty-input + tap-check path.
    // Accepted trade-off: typing "100" then erasing to "" then blurring
    // without check is also suppressed — net effect zero because the row
    // was already null (nothing to clear).
    if (
      newWeight === null &&
      newReps === null &&
      row.weight === null &&
      row.reps === null
    ) {
      return;
    }
    onCommit({ reps: newReps, weight: newWeight });
  };

  const badge = TYPE_BADGE[row.set_type];
  const isChecked = row.completed_at != null;
  const hasMetaData = row.rpe != null || (row.notes?.trim().length ?? 0) > 0;

  return (
    <View
      className={`border-b border-gray-100 dark:border-gray-900 ${
        showCheckable && isChecked ? "bg-green-50 dark:bg-green-950/30" : ""
      }`}
    >
      <View className="flex-row items-center gap-2 px-4 py-2">
        {showCheckable ? (
          <Pressable
            onPress={() => {
              if (checkPending) return;
              onToggleChecked?.(!isChecked, { weight, reps });
            }}
            disabled={checkPending}
            accessibilityRole="button"
            accessibilityState={{ disabled: checkPending, busy: checkPending }}
            accessibilityLabel={
              isChecked ? "Unmark set as completed" : "Mark set as completed"
            }
            className="h-11 w-11 items-center justify-center"
          >
            {checkPending ? (
              <ActivityIndicator size="small" color="#9ca3af" />
            ) : isChecked ? (
              <CheckSquare color="#16a34a" size={20} />
            ) : (
              <Square color="#9ca3af" size={20} />
            )}
          </Pressable>
        ) : null}
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
            placeholder={weightPlaceholder}
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
            placeholder={repsPlaceholder}
            placeholderTextColor="#9ca3af"
            keyboardType="number-pad"
            className="rounded border border-gray-200 px-2 py-1.5 text-base text-black dark:border-gray-800 dark:text-white"
          />
        </View>

        <Pressable
          onPress={() => setMenuOpen(true)}
          accessibilityLabel="Open set details"
          accessibilityRole="button"
          className="h-11 w-11 items-center justify-center"
        >
          {/* Icon tint mirrors the existing notes-icon precedent: blue-500
              when there's RPE or notes data behind the menu, gray-400
              otherwise. lucide-react-native takes a hex `color` prop —
              NativeWind className on the icon itself is a no-op. */}
          <MoreHorizontal
            color={hasMetaData ? "#3b82f6" : "#9ca3af"}
            size={20}
          />
        </Pressable>

        <Pressable
          onPress={onDelete}
          accessibilityLabel="Delete set"
          accessibilityRole="button"
          className="rounded p-1"
        >
          <Trash2 color="#ef4444" size={16} />
        </Pressable>
      </View>

      {menuOpen ? (
        <SetRowMenu
          onClose={() => setMenuOpen(false)}
          setNumber={row.set_number}
          exerciseName={exerciseName}
          initialRpe={row.rpe}
          initialNotes={row.notes}
          previousRpe={previousSet?.rpe ?? null}
          onSubmit={(patch) => onUpdateMeta(patch)}
        />
      ) : null}
    </View>
  );
}
