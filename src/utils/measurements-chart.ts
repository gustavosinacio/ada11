import type { DataPoint } from "~/components/progress-chart";
import type { MeasurementEntryRow, WeightUnit } from "~/db/types";
import { kgToLbs } from "~/utils/units";

const DEFAULT_MAX_POINTS = 12;

function shortDate(iso: string): string {
  try {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  } catch {
    return "?";
  }
}

/**
 * Build a chart series for bodyweight history.
 *
 * - Filters entries with non-null, finite `weight_kg`.
 * - INPUT IS DESC by `measured_at` (`listMeasurements` contract,
 *   `api/measurements.ts:105`). The function takes the first N from the
 *   filtered DESC list (most recent N), then reverses to ASC so the chart
 *   line reads left→right (oldest → newest).
 * - Converts kg→lbs when `unit === "lbs"` via `kgToLbs`.
 * - Label format: `M/D` (e.g. `"5/20"`) — identical to
 *   `app/(app)/exercises/[id]/progress.tsx:12-19`.
 *
 * Pure. No side effects. Safe to call inside `useMemo`.
 */
export function entriesToWeightSeries(
  entries: MeasurementEntryRow[],
  unit: WeightUnit,
  maxPoints: number = DEFAULT_MAX_POINTS,
): DataPoint[] {
  const filtered: { row: MeasurementEntryRow; kg: number }[] = [];
  for (const row of entries) {
    if (row.weight_kg == null) continue;
    const kg = parseFloat(row.weight_kg);
    if (!Number.isFinite(kg)) continue;
    filtered.push({ row, kg });
  }
  // Input is DESC; first `maxPoints` are the N most recent.
  const recentDesc = filtered.slice(0, Math.max(0, maxPoints));
  // Reverse to ASC for left→right time progression.
  const recentAsc = recentDesc.slice().reverse();
  return recentAsc.map(({ row, kg }) => ({
    label: shortDate(row.measured_at),
    value: unit === "lbs" ? kgToLbs(kg) : kg,
  }));
}
