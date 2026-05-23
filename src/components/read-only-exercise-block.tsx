import { Pressable, Text, View } from "react-native";

import { ReadOnlySetRow } from "~/components/read-only-set-row";
import type { ExerciseRow, SetRow, WeightUnit } from "~/db/types";
import { presentReadOnlyExerciseBlock } from "~/utils/set-display";

/**
 * Read-only counterpart of `<ExerciseBlock>`. Used by the history detail
 * screen when the screen-level Edit toggle is OFF. Renders the same exercise
 * header (name + `(deleted)` suffix preserved, muscles/equipment line, same
 * column-header strip) but DROPS every editable affordance:
 *
 *   - No reorder chevrons.
 *   - No exercise trash.
 *   - No `<VolumeTargetSlot>` (history never passed `showVolumeTarget`).
 *   - No `<SetInput>` `<TextInput>` cells — `<ReadOnlySetRow>` instead.
 *   - No "+ Working set" footer, no chevron menu, no "+ Warm-up" / "+ Drop
 *     set" Pressables.
 *   - No `useLastWorkingSet(exercise.id)` cross-session read (placeholder
 *     hints are an edit-mode concern only).
 *
 * Column-header spacers (44pt for menu, 28pt for trash) are kept so column
 * alignment matches `<ExerciseBlock>` exactly — toggling into edit mode does
 * not reflow the table.
 */

type Props = {
  exercise: ExerciseRow;
  sets: SetRow[];
  unit: WeightUnit;
  /** When provided, the exercise name is wrapped in a `<Pressable>` (same
   *  contract as `<ExerciseBlock>.onPressName` — caller owns navigation). */
  onPressName?: () => void;
};

export function ReadOnlyExerciseBlock({
  exercise,
  sets,
  unit,
  onPressName,
}: Props) {
  const p = presentReadOnlyExerciseBlock(exercise, sets.length);

  const nameNode = (
    <Text className="text-lg font-semibold text-black dark:text-white">
      {p.name}
      {p.showDeletedSuffix ? (
        <Text className="text-base font-normal text-gray-500"> (deleted)</Text>
      ) : null}
    </Text>
  );

  return (
    <View className="border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-black">
      <View className="flex-row items-start justify-between px-4 py-3">
        <View className="flex-1 pr-2">
          {onPressName ? (
            <Pressable
              onPress={onPressName}
              accessibilityRole="button"
              accessibilityLabel={`View progress for ${p.name}`}
              className="active:opacity-70"
            >
              {nameNode}
            </Pressable>
          ) : (
            nameNode
          )}
          {p.subline ? (
            <Text className="mt-0.5 text-sm text-gray-500">{p.subline}</Text>
          ) : null}
        </View>
        {/* No action area — history never passed `onRemove`/`onMoveUp`/
            `onMoveDown` and the read-only block omits it by contract. */}
      </View>

      {p.showColumnHeader ? (
        <View className="flex-row items-center gap-2 border-y border-gray-100 bg-gray-50 px-4 py-1 dark:border-gray-900 dark:bg-gray-950">
          {/* Mirrors `<ExerciseBlock>`'s column-header strip widths.
              History detail never passes `showCheckable`, so no leading
              44pt check-button spacer. */}
          <View className="w-7" />
          <Text className="w-6 text-xs text-gray-500">#</Text>
          <Text className="flex-1 text-xs text-gray-500">
            Weight ({unit})
          </Text>
          <Text className="flex-1 text-xs text-gray-500">Reps</Text>
          {/* 44pt spacer matching `<SetInput>`'s "Open set details" slot. */}
          <View className="w-11" />
          {/* 28pt spacer matching `<SetInput>`'s trash button width. */}
          <View className="w-7" />
        </View>
      ) : null}

      {p.showEmptyState ? (
        <Text className="px-4 py-3 text-sm italic text-gray-500">
          {p.emptyStateText}
        </Text>
      ) : (
        sets.map((s) => <ReadOnlySetRow key={s.id} row={s} unit={unit} />)
      )}
    </View>
  );
}
