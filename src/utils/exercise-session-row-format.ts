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
import type { SetRow, SetType, WeightUnit } from "~/db/types";

import { displayReps, displayWeight } from "~/utils/set-display";
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

/** One non-warmup set, presented for a per-set "weight × reps — volume" line. */
export type SetVolumeLine = {
  setNumber: number;
  setType: SetType;
  /** `"100 × 8"` — weight in the display unit (via `displayWeight`, no unit
   *  suffix for compactness), reps as integer. `"—"` for missing parts. */
  label: string;
  /** Per-set volume in kg: `weight × reps` when both are usable (`w>0 && r>0`),
   *  else 0. The sum of these equals `sumPastVolume(sets)` by construction. */
  volumeKg: number;
  /** `formatVolume(volumeKg, unit)` when `volumeKg > 0`, else `""` (so a sloppy
   *  set with null/zero weight/reps renders no volume chip). */
  volumeLabel: string;
};

/**
 * Per-set breakdown for the "Sessions" rows on `/(app)/exercises/{id}/progress`
 * and for the max-volume session callouts (live `<VolumeTargetSlot>` + progress
 * page). Skips warmups — mirrors `sumPastVolume`'s set scope — so the per-set
 * `volumeKg` values sum exactly to the session's displayed total volume.
 *
 * Includes non-warmup sets even when `weight`/`reps` are null/0 (they render
 * `"—"` and contribute 0 volume) so the line count matches the user's
 * perception of "I did N sets" — same convention as `count` above.
 */
export function presentSetVolumeLines(input: {
  sets: SetRow[];
  unit: WeightUnit;
}): SetVolumeLine[] {
  const { sets, unit } = input;
  const lines: SetVolumeLine[] = [];

  for (const s of sets) {
    if (s.set_type === "warmup") continue;
    const w = s.weight ? parseFloat(s.weight) : NaN;
    const r = s.reps ?? 0;
    const counts = Number.isFinite(w) && w > 0 && r > 0;
    const volumeKg = counts ? w * r : 0;
    lines.push({
      setNumber: s.set_number,
      setType: s.set_type,
      label: `${displayWeight(s.weight, unit)} × ${displayReps(s.reps)}`,
      volumeKg,
      volumeLabel: volumeKg > 0 ? formatVolume(volumeKg, unit) : "",
    });
  }

  return lines;
}
