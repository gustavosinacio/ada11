import type { WeightUnit } from "~/db/types";
import { formatVolume } from "~/utils/units";

/**
 * Returns the suffix to append to the row's line-2 text when a session has a
 * positive total volume; returns `null` to indicate the slot should be
 * omitted entirely.
 *
 * The leading `" · "` (space-middot-space) separator is included in the
 * returned string so the caller can do
 *   `{presentSessionVolumeSlot(v, u) ?? ""}`
 * without any additional whitespace logic. Matches the line-2 separator
 * pattern in `<SessionSummaryRow>` (date · duration · volume).
 *
 * Pure — no React, no hooks. Testable directly with vitest under
 * `tests/unit/`. Returns `null` for `null`, `undefined`, `0`, and any
 * negative value (defensive — `sumLiveVolume` never produces negatives, but
 * the presenter is the visibility gate and should not render a "-1 kg"
 * label if upstream math ever drifts).
 */
export function presentSessionVolumeSlot(
  totalVolumeKg: number | null | undefined,
  unit: WeightUnit,
): string | null {
  if (totalVolumeKg == null) return null;
  if (totalVolumeKg <= 0) return null;
  return ` · ${formatVolume(totalVolumeKg, unit)}`;
}
