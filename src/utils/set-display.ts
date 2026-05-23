/**
 * Pure display helpers for read-only set rows.
 *
 * The history detail screen renders ended workouts read-only by default
 * (see `src/components/read-only-set-row.tsx`). The weight column shows a
 * formatted `<Text>` value rather than a `<TextInput>`, so we need a
 * deterministic kg → unit formatter that mirrors `<SetInput>`'s
 * `inputStringFromKg` contract (set-input.tsx:52-59):
 *
 *   - `null` or non-finite → em dash `"—"`.
 *   - Integer value → integer string (e.g. `"100"`).
 *   - Non-integer → one decimal (e.g. `"82.5"`).
 *
 * Lifted to its own module so it can be unit-tested without a React
 * renderer (vitest is configured to pick up only `tests/unit/**\/*.test.ts`
 * — no `.tsx`).
 */

import type { WeightUnit } from "~/db/types";
import { kgToLbs } from "~/utils/units";

const EM_DASH = "—";

/**
 * Render the weight cell of a read-only set row.
 *
 * Storage canonical: kilograms as a stringified numeric (e.g. `"82.50"` or
 * `null`). The user's preference selects the displayed unit (kg or lbs).
 *
 * Contract:
 *   displayWeight(null,    "kg")  → "—"
 *   displayWeight(null,    "lbs") → "—"
 *   displayWeight("100",   "kg")  → "100"
 *   displayWeight("82.5",  "kg")  → "82.5"
 *   displayWeight("100",   "lbs") → "220.5"  (kgToLbs(100) ≈ 220.4623)
 *   displayWeight("not-a-number", "kg") → "—"
 *
 * Returns the em dash for any non-finite parse so the row still reads as a
 * stable single-character cell instead of "NaN" / "Infinity" leaking through.
 */
export function displayWeight(
  kgStr: string | null,
  unit: WeightUnit,
): string {
  if (kgStr == null) return EM_DASH;
  const kg = parseFloat(kgStr);
  if (!Number.isFinite(kg)) return EM_DASH;
  const value = unit === "kg" ? kg : kgToLbs(kg);
  return Number.isInteger(value) ? value.toString() : value.toFixed(1);
}

/**
 * Render the reps cell of a read-only set row. Trivial wrapper kept for
 * symmetry with `displayWeight` and for the same testability reason — the
 * read-only row's two value cells round-trip through these helpers.
 */
export function displayReps(reps: number | null): string {
  if (reps == null) return EM_DASH;
  return reps.toString();
}

/**
 * Presentation contract for `<ReadOnlySetRow>`. Returns the exact strings
 * and visibility flags the row will render, given a `SetRow` and the user's
 * weight-unit preference. Kept as a pure transform so it can be unit-tested
 * via vitest (which only picks up `tests/unit/**\/*.test.ts`, no JSX).
 *
 * Mirrors the per-cell decisions inside `read-only-set-row.tsx`:
 *
 *   - `weight` → `displayWeight(row.weight, unit)`
 *   - `reps` → `displayReps(row.reps)`
 *   - `setNumber` → raw integer
 *   - `badgeLabel` → "W" / "•" / "↓" per set type
 *   - `showRpe` → true iff `row.rpe != null`
 *   - `rpeText` → the persisted rpe string (or null when absent)
 *   - `showNotes` → true iff `row.notes?.trim().length > 0`
 *   - `showCheck` → true iff `row.completed_at != null`
 *   - `isChecked` → same as `showCheck`; aliased for tinting clarity
 */
export type ReadOnlySetRowPresentation = {
  weight: string;
  reps: string;
  setNumber: number;
  badgeLabel: "W" | "•" | "↓";
  showRpe: boolean;
  rpeText: string | null;
  showNotes: boolean;
  showCheck: boolean;
  isChecked: boolean;
};

const BADGE_LABEL: Record<
  "warmup" | "working" | "dropset",
  "W" | "•" | "↓"
> = {
  warmup: "W",
  working: "•",
  dropset: "↓",
};

export function presentReadOnlySetRow(
  row: {
    set_number: number;
    weight: string | null;
    reps: number | null;
    rpe: string | null;
    notes: string | null;
    set_type: "warmup" | "working" | "dropset";
    completed_at: string | null;
  },
  unit: WeightUnit,
): ReadOnlySetRowPresentation {
  const isChecked = row.completed_at != null;
  return {
    weight: displayWeight(row.weight, unit),
    reps: displayReps(row.reps),
    setNumber: row.set_number,
    badgeLabel: BADGE_LABEL[row.set_type],
    showRpe: row.rpe != null,
    rpeText: row.rpe,
    showNotes: (row.notes?.trim().length ?? 0) > 0,
    showCheck: isChecked,
    isChecked,
  };
}

/**
 * Presentation contract for `<ReadOnlyExerciseBlock>`'s header + empty state.
 * Pure transform — same testability rationale as `presentReadOnlySetRow`.
 *
 *   - `name` → exercise name verbatim
 *   - `showDeletedSuffix` → true iff `exercise.deleted_at != null`
 *   - `subline` → "muscles · equipment" string, or null when both empty
 *   - `showColumnHeader` → true iff there is at least one set
 *   - `showEmptyState` → true iff there are zero sets
 *   - `emptyStateText` → the italic copy rendered in that case (pinned)
 */
export type ReadOnlyExerciseBlockPresentation = {
  name: string;
  showDeletedSuffix: boolean;
  subline: string | null;
  showColumnHeader: boolean;
  showEmptyState: boolean;
  emptyStateText: string;
};

export const READ_ONLY_BLOCK_EMPTY_TEXT =
  "No sets logged for this exercise.";

export function presentReadOnlyExerciseBlock(
  exercise: {
    name: string;
    muscles: string[];
    equipment: string | null;
    deleted_at: string | null;
  },
  setsCount: number,
): ReadOnlyExerciseBlockPresentation {
  const muscles = exercise.muscles ?? [];
  const subline =
    muscles.length > 0 || exercise.equipment
      ? [muscles.length > 0 ? muscles.join(", ") : null, exercise.equipment]
          .filter(Boolean)
          .join(" · ")
      : null;
  return {
    name: exercise.name,
    showDeletedSuffix: exercise.deleted_at != null,
    subline,
    showColumnHeader: setsCount > 0,
    showEmptyState: setsCount === 0,
    emptyStateText: READ_ONLY_BLOCK_EMPTY_TEXT,
  };
}
