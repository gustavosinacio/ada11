/**
 * Pure presenter for one row of the "Sessions" list on
 * `/(app)/exercises/{id}/progress`.
 *
 * Single responsibility: turn a session's set group for ONE exercise into the
 * two display primitives the row needs — a working-set count and a formatted
 * total-volume label like `"4 × 12,400 kg"`. Mirrors the canonical chart
 * kernels (`progress.tsx`, `weekly-volume-strip.tsx`, `sumPastVolume`) so the
 * row's `X × Y kg` agrees with the chart's volume point for the same session.
 *
 * Kept in a `.ts` (no React, no RN imports) so the unit tests run under
 * vitest like the other presenters (`session-row-format.ts`,
 * `set-display.ts`).
 */
import type { SetRow, WeightUnit } from "~/db/types";

import { formatVolume } from "~/utils/units";
import { sumPastVolume } from "~/utils/volume-target";

/**
 * Returned shape carries the parts (`count`, `volumeKg`) alongside the
 * presentation string (`volumeLabel`) for two reasons:
 *
 * 1. **Unit-test ergonomics.** The unit tests assert the underlying math
 *    independently of formatter changes — if `formatVolume`'s thousands
 *    separator ever changes locale or precision, the count/volumeKg
 *    assertions stay green and only the volumeLabel test updates.
 * 2. **Future per-set secondary line.** The deferred "100×8 · 100×8 · 110×6"
 *    secondary needs `count > 0` to decide whether to render at all; exposing
 *    `count` here lets the consumer gate without re-counting.
 */
export type ExerciseSessionRowPresentation = {
  /** Working-set count: sets where `set_type !== "warmup"`. Counts the row
   *  even if `weight`/`reps` are null/0 (matches the user's perception of
   *  "I did 4 sets" even when one was logged sloppily). */
  count: number;
  /** Volume in kg via canonical `sumPastVolume` (warmup-skip, w>0 && r>0). */
  volumeKg: number;
  /**
   * `"{count} × {formatVolume(volumeKg, unit)}"` when `count > 0 &&
   *  volumeKg > 0`, else `""`. Empty string is the "render nothing visible"
   *  sentinel so the row's line-2 can be conditionally suppressed.
   */
  volumeLabel: string;
};

export function presentExerciseSessionRow(input: {
  sets: SetRow[];
  unit: WeightUnit;
}): ExerciseSessionRowPresentation {
  const { sets, unit } = input;

  const count = sets.filter((s) => s.set_type !== "warmup").length;
  const volumeKg = sumPastVolume(sets);
  const volumeLabel =
    count > 0 && volumeKg > 0
      ? `${count} × ${formatVolume(volumeKg, unit)}`
      : "";

  return { count, volumeKg, volumeLabel };
}
