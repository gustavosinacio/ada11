import { X } from "lucide-react-native";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import type { UpdateSetMetaInput } from "~/api/sets";

type Props = {
  onClose: () => void;
  setNumber: number;
  exerciseName: string;
  /** Current persisted value (one-decimal string like "9.0", or null). */
  initialRpe: string | null;
  /** Current persisted value, or null. */
  initialNotes: string | null;
  /** Previous-set RPE shown as a placeholder hint on the chip strip. */
  previousRpe: string | null;
  /**
   * Patch contract (mirrors updateSetMeta):
   * - { rpe: "9.0" } → set RPE to 9.0, leave notes alone.
   * - { rpe: null }   → CLEAR RPE (the "—" chip). Notes unchanged.
   * - { notes: "x" }  → set notes, leave rpe alone.
   * - { notes: null } → clear notes (textarea emptied + dismiss).
   * Never pass `undefined` — that's the "absent" sentinel, handled by simply
   * not including the key in the patch object. See UpdateSetMetaInput
   * JSDoc in `~/api/sets`.
   */
  onSubmit: (patch: UpdateSetMetaInput) => void;
};

/**
 * Chip values for the RPE selector strip. `null` is the leftmost "—" clear
 * chip. The numeric values are persisted as one-decimal strings to match the
 * column's `numeric(3,1)` storage and `parseFloat0(rpe)?.toFixed(1)`
 * rendering precedent elsewhere in the app.
 */
export const RPE_CHIPS = [
  null,
  "5.0",
  "5.5",
  "6.0",
  "6.5",
  "7.0",
  "7.5",
  "8.0",
  "8.5",
  "9.0",
  "9.5",
  "10.0",
] as const;

function normalizeRpe(value: string | null): string | null {
  if (value == null) return null;
  const v = parseFloat(value);
  if (!Number.isFinite(v)) return null;
  return v.toFixed(1);
}

/**
 * Per-set bottom-sheet menu for editing RPE + notes off the row.
 *
 * Mount-on-open, unmount-on-close: parent gates the JSX with
 * `{menuOpen ? <SetRowMenu .../> : null}` — no `visible` prop. Each open is
 * a fresh mount with draft state seeded from the current `row` props.
 *
 * RPE commits immediately on chip tap (single-field write via `onSubmit`);
 * notes commits on dismiss (close button or backdrop tap), matching today's
 * blur semantics for the previously-inline notes input. The two-write cost
 * when both change in one session is accepted (see design-v2 MIN-5).
 */
export function SetRowMenu({
  onClose,
  setNumber,
  exerciseName,
  initialRpe,
  initialNotes,
  previousRpe,
  onSubmit,
}: Props) {
  // Draft state is implicitly fresh on every open because the parent
  // unmounts the menu on close.
  const [rpe, setRpe] = useState<string | null>(initialRpe);
  const [notes, setNotes] = useState<string>(initialNotes ?? "");

  const normalizedRpe = normalizeRpe(rpe);
  const normalizedPreviousRpe = normalizeRpe(previousRpe);

  const handleChipTap = (chip: string | null) => {
    setRpe(chip);
    onSubmit({ rpe: chip });
  };

  const commitNotesAndClose = () => {
    const trimmed = notes.trim();
    const currentPersisted = initialNotes ?? "";
    if (trimmed !== currentPersisted.trim()) {
      onSubmit({ notes: trimmed.length === 0 ? null : trimmed });
    }
    onClose();
  };

  return (
    <Modal
      visible
      animationType="slide"
      transparent
      onRequestClose={commitNotesAndClose}
    >
      <Pressable
        onPress={commitNotesAndClose}
        accessibilityLabel="Dismiss set details"
        accessibilityRole="button"
        className="flex-1 justify-end bg-black/50"
      >
        {/* Prevent backdrop dismiss when tapping inside the card. */}
        <Pressable onPress={() => {}} accessibilityRole="none">
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            className="w-full"
          >
            <View className="rounded-t-2xl bg-white px-6 pb-10 pt-6 dark:bg-gray-900">
              <View className="mb-4 flex-row items-center justify-between">
                <Text className="text-lg font-semibold text-black dark:text-white">
                  Set {setNumber} · {exerciseName}
                </Text>
                <Pressable
                  onPress={commitNotesAndClose}
                  accessibilityLabel="Close"
                  accessibilityRole="button"
                  className="h-11 w-11 items-center justify-center"
                >
                  <X color="#6b7280" size={22} />
                </Pressable>
              </View>

              <Text className="mb-2 text-xs uppercase text-gray-500">RPE</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerClassName="gap-2 pb-1"
              >
                {RPE_CHIPS.map((chip) => {
                  const isSelected =
                    chip === null
                      ? normalizedRpe == null
                      : chip === normalizedRpe;
                  const isPreviousHint =
                    !isSelected &&
                    normalizedRpe == null &&
                    chip !== null &&
                    chip === normalizedPreviousRpe;
                  const label = chip ?? "—";
                  const baseClasses =
                    "min-w-[44px] items-center justify-center rounded-full px-3 py-2";
                  const selectedClasses = "bg-emerald-500";
                  const previousHintClasses =
                    "border border-dashed border-gray-400 dark:border-gray-500";
                  const defaultClasses =
                    "border border-gray-300 dark:border-gray-700";
                  const textSelected = "text-white font-semibold";
                  const textPreviousHint = "text-gray-500 dark:text-gray-400";
                  const textDefault = "text-gray-800 dark:text-gray-100";
                  return (
                    <Pressable
                      key={chip ?? "clear"}
                      onPress={() => handleChipTap(chip)}
                      accessibilityRole="button"
                      accessibilityLabel={
                        chip === null
                          ? "Clear RPE"
                          : `Set RPE to ${chip}`
                      }
                      accessibilityState={{ selected: isSelected }}
                      className={`${baseClasses} ${
                        isSelected
                          ? selectedClasses
                          : isPreviousHint
                            ? previousHintClasses
                            : defaultClasses
                      }`}
                    >
                      <Text
                        className={`text-sm ${
                          isSelected
                            ? textSelected
                            : isPreviousHint
                              ? textPreviousHint
                              : textDefault
                        }`}
                      >
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>

              <Text className="mb-2 mt-5 text-xs uppercase text-gray-500">
                Notes
              </Text>
              <TextInput
                value={notes}
                onChangeText={setNotes}
                placeholder="Notes for this set"
                placeholderTextColor="#9ca3af"
                multiline
                numberOfLines={4}
                textAlignVertical="top"
                className="min-h-[96px] rounded border border-gray-300 px-3 py-2 text-base text-black dark:border-gray-700 dark:text-white"
              />
            </View>
          </KeyboardAvoidingView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
