import { Text, View } from "react-native";

/**
 * Inline label-chip rendered next to an exercise row's name when the row is
 * user-owned (`exercise.user_id !== null`). Distinguishes user-created
 * exercises from the canonical/shared catalog rows (`user_id IS NULL`)
 * introduced in supabase/migrations/0011_canonical_exercises.sql.
 *
 * Two consumer surfaces today: `<ExercisePicker>` and `<ExerciseListItem>`.
 * Extracting into a single component (vs. inlining both) eliminates the
 * visual-drift risk between picker and library row.
 *
 * Visual rhythm mirrors `pr-list-row.tsx:48-52` (same `ml-2 rounded-full
 * px-2 py-0.5` shell + 10px uppercase wide-tracked label). Slate hue is
 * neutral attribution semantic (distinct from emerald's achievement
 * semantic). Contrast: slate-600 on slate-100 ~5.6:1 (AA-large) light;
 * slate-300 on slate-800 ~7.1:1 (AAA-large) dark.
 *
 * The visible glyph is "You" (three characters, readable at 10px); the
 * full meaning is exposed to screen readers via `accessibilityLabel`.
 */
export function CreatedByYouChip(): React.JSX.Element {
  return (
    <View
      accessibilityLabel="Created by you"
      className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 dark:bg-slate-800"
    >
      <Text className="text-[10px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
        You
      </Text>
    </View>
  );
}
