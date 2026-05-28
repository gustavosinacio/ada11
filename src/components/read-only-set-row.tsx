import { Check, StickyNote } from "lucide-react-native";
import { Text, View } from "react-native";

import type { SetRow, SetType, WeightUnit } from "~/db/types";
import { presentReadOnlySetRow } from "~/utils/set-display";

/**
 * Read-only counterpart of `<SetInput>`. Renders one set as static text-only
 * cells: no `<TextInput>`, no per-row trash, no "Open set details" Pressable,
 * no mutation callbacks. Used by `<ReadOnlyExerciseBlock>` on the history
 * detail screen when the screen-level Edit toggle is OFF.
 *
 * Visual structure mirrors `<SetInput>` (same column widths, same set-type
 * badge, same green tint when `completed_at != null`) so toggling into edit
 * mode does NOT reflow the rows. Empty slots (the per-row "Open set details"
 * Pressable and the trash icon) are kept as same-width `<View>` spacers so
 * column alignment is preserved against the editable tree.
 */

type Props = {
  row: SetRow;
  unit: WeightUnit;
  /** Mirror of `<SetInput>.parentSetNumber` — the parent working set's
   *  `set_number` for dropset rows. Used to render the inline "↳ N" parent
   *  reference. Ignored for warmup/working rows. */
  parentSetNumber?: number | null;
};

const TYPE_BADGE: Record<SetType, { label: string; classes: string }> = {
  warmup: { label: "W", classes: "bg-yellow-100 text-yellow-800" },
  working: { label: "•", classes: "bg-gray-200 text-gray-800" },
  dropset: { label: "↓", classes: "bg-purple-100 text-purple-800" },
};

export function ReadOnlySetRow({ row, unit, parentSetNumber = null }: Props) {
  const p = presentReadOnlySetRow(row, unit);
  const badge = TYPE_BADGE[row.set_type];

  // Mirrors the per-type styling in `<SetInput>` so toggling Edit on/off keeps
  // the same visual identity for each set type. Checked-state green wins on
  // background; the left accent strip + dropset indent + "↳ N" parent ref
  // stay visible regardless of checked state.
  const isWarmup = row.set_type === "warmup";
  const isDropset = row.set_type === "dropset";
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
  const bgClass = p.isChecked ? "bg-green-50 dark:bg-green-950/30" : typeBg;
  const innerPadding = isDropset ? "pl-8 pr-4" : "px-4";

  return (
    <View
      className={`border-b border-gray-100 dark:border-gray-900 ${accentClass} ${bgClass}`}
    >
      <View className={`flex-row items-center gap-2 ${innerPadding} py-2`}>
        {/* Set-type badge — kept identical to `<SetInput>`. */}
        <View
          className={`h-7 w-7 items-center justify-center rounded-full ${badge.classes}`}
        >
          <Text className="text-xs font-semibold">{badge.label}</Text>
        </View>

        {/* Inline parent reference for dropset rows. */}
        {isDropset && parentSetNumber != null ? (
          <Text
            className="text-xs font-medium text-purple-600 dark:text-purple-400"
            accessibilityLabel={`Drop set chained to set ${parentSetNumber}`}
          >
            ↳{parentSetNumber}
          </Text>
        ) : null}

        {/* Set number. */}
        <Text className="w-6 text-sm text-gray-500">{p.setNumber}</Text>

        {/* Weight (read-only). */}
        <View className="flex-1">
          <Text className="text-base text-black dark:text-white">
            {p.weight}
          </Text>
        </View>

        {/* Reps (read-only). */}
        <View className="flex-1">
          <Text className="text-base text-black dark:text-white">
            {p.reps}
          </Text>
        </View>

        {/* Static replacement for `<SetInput>`'s "Open set details"
            Pressable. Same 44pt slot width so column alignment is
            preserved on the toggle into edit mode. Shows an RPE chip
            when present and a notes glyph when present; nothing
            tappable inside. */}
        <View className="h-11 w-11 flex-row items-center justify-center gap-1">
          {p.showRpe && p.rpeText != null ? (
            <Text
              className="rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-950/50 dark:text-blue-300"
              accessibilityLabel={`RPE ${p.rpeText}`}
            >
              {p.rpeText}
            </Text>
          ) : null}
          {p.showNotes ? <StickyNote color="#6b7280" size={14} /> : null}
        </View>

        {/* Trash slot spacer (28pt) — mirrors `<SetInput>`'s `rounded p-1`
            trash button width so the row width is identical in both
            modes. Optional check glyph sits inside this slot when the
            set is completed. */}
        <View className="w-7 items-center justify-center">
          {p.showCheck ? <Check color="#16a34a" size={14} /> : null}
        </View>
      </View>
    </View>
  );
}
