/**
 * Pure-component contract tests for the read-only history surface.
 *
 * Run-id: 2026-05-23_1855_read-only-history-view
 *
 * Vitest is configured to pick up only `tests/unit/**\/*.test.ts` (no
 * `.tsx`, no RN renderer), so we exercise the read-only components at the
 * presentation-contract layer rather than via JSX rendering. The
 * `presentReadOnlySetRow` / `presentReadOnlyExerciseBlock` pure functions
 * are the same code paths the live components consume — testing them
 * deterministically covers:
 *
 *   - kg / lbs rendering of the weight cell.
 *   - reps cell formatting (including null).
 *   - `(deleted)` suffix flag on the exercise header.
 *   - Empty-block italic copy (pinned text).
 *   - RPE / notes visibility flags (hidden when null/blank).
 *   - Set-type badge label.
 *   - Check / tint flag from `completed_at`.
 *
 * Mirrors the precedent used by `session-header-total-volume.test.ts`
 * (contract-level testing because RNTL is not installed in this repo).
 */

import { describe, expect, it } from "vitest";

import type { SetRow, SetType } from "~/db/types";
import {
  READ_ONLY_BLOCK_EMPTY_TEXT,
  displayReps,
  displayWeight,
  presentReadOnlyExerciseBlock,
  presentReadOnlySetRow,
} from "~/utils/set-display";

function mkSet(overrides: Partial<SetRow> & Pick<SetRow, "set_number">): SetRow {
  return {
    id: `set-${overrides.set_number}`,
    user_id: "u-1",
    session_id: "sess-1",
    exercise_id: "ex-1",
    set_number: overrides.set_number,
    reps: overrides.reps ?? null,
    weight: overrides.weight ?? null,
    rpe: overrides.rpe ?? null,
    set_type: (overrides.set_type ?? "working") as SetType,
    parent_set_id: overrides.parent_set_id ?? null,
    notes: overrides.notes ?? null,
    completed_at: overrides.completed_at ?? null,
    created_at: overrides.created_at ?? "2026-05-23T10:00:00Z",
    updated_at: overrides.updated_at ?? "2026-05-23T10:00:00Z",
    deleted_at: overrides.deleted_at ?? null,
  };
}

// ---------------------------------------------------------------------------
// displayWeight — kg / lbs rendering of the read-only weight cell.
// ---------------------------------------------------------------------------
describe("displayWeight", () => {
  it("returns em-dash for null", () => {
    expect(displayWeight(null, "kg")).toBe("—");
    expect(displayWeight(null, "lbs")).toBe("—");
  });

  it("returns em-dash for non-finite parses", () => {
    expect(displayWeight("not-a-number", "kg")).toBe("—");
    expect(displayWeight("", "kg")).toBe("—");
  });

  it("renders an integer kg value as an integer string", () => {
    expect(displayWeight("100", "kg")).toBe("100");
    expect(displayWeight("100.00", "kg")).toBe("100");
  });

  it("renders a non-integer kg value with one decimal", () => {
    expect(displayWeight("82.5", "kg")).toBe("82.5");
    expect(displayWeight("82.50", "kg")).toBe("82.5");
  });

  it("converts to lbs when unit is lbs", () => {
    // 100 kg → 220.4623 lbs → "220.5"
    expect(displayWeight("100", "lbs")).toBe("220.5");
  });

  it("returns the em-dash for null even under lbs (regression guard)", () => {
    expect(displayWeight(null, "lbs")).toBe("—");
  });
});

// ---------------------------------------------------------------------------
// displayReps — reps cell formatting.
// ---------------------------------------------------------------------------
describe("displayReps", () => {
  it("returns em-dash for null", () => {
    expect(displayReps(null)).toBe("—");
  });

  it("renders a positive integer", () => {
    expect(displayReps(8)).toBe("8");
    expect(displayReps(1)).toBe("1");
  });

  it("renders zero (even if zero shouldn't normally exist)", () => {
    // Defensive — `reps` storage allows 0; the read-only cell should not lie.
    expect(displayReps(0)).toBe("0");
  });
});

// ---------------------------------------------------------------------------
// presentReadOnlySetRow — RPE / notes hidden when null, badge label, tint.
// ---------------------------------------------------------------------------
describe("presentReadOnlySetRow", () => {
  it("renders a fully-populated checked working set", () => {
    const row = mkSet({
      set_number: 1,
      weight: "100",
      reps: 8,
      rpe: "9.0",
      notes: "felt easy",
      set_type: "working",
      completed_at: "2026-05-23T10:00:00Z",
    });
    const p = presentReadOnlySetRow(row, "kg");
    expect(p.weight).toBe("100");
    expect(p.reps).toBe("8");
    expect(p.setNumber).toBe(1);
    expect(p.badgeLabel).toBe("•");
    expect(p.showRpe).toBe(true);
    expect(p.rpeText).toBe("9.0");
    expect(p.showNotes).toBe(true);
    expect(p.showCheck).toBe(true);
    expect(p.isChecked).toBe(true);
  });

  it("hides the RPE chip and notes glyph when both are null", () => {
    const row = mkSet({
      set_number: 1,
      weight: "100",
      reps: 5,
      rpe: null,
      notes: null,
    });
    const p = presentReadOnlySetRow(row, "kg");
    expect(p.showRpe).toBe(false);
    expect(p.rpeText).toBeNull();
    expect(p.showNotes).toBe(false);
  });

  it("treats a blank-whitespace notes string as no notes", () => {
    const row = mkSet({
      set_number: 1,
      weight: "100",
      reps: 5,
      notes: "   ",
    });
    expect(presentReadOnlySetRow(row, "kg").showNotes).toBe(false);
  });

  it("treats a non-blank notes string as notes", () => {
    const row = mkSet({
      set_number: 1,
      weight: "100",
      reps: 5,
      notes: "rep 8 grindy",
    });
    expect(presentReadOnlySetRow(row, "kg").showNotes).toBe(true);
  });

  it("returns the correct badge label for each set type", () => {
    const w = mkSet({ set_number: 1, set_type: "warmup" });
    const k = mkSet({ set_number: 2, set_type: "working" });
    const d = mkSet({ set_number: 3, set_type: "dropset" });
    expect(presentReadOnlySetRow(w, "kg").badgeLabel).toBe("W");
    expect(presentReadOnlySetRow(k, "kg").badgeLabel).toBe("•");
    expect(presentReadOnlySetRow(d, "kg").badgeLabel).toBe("↓");
  });

  it("does NOT tint or show the check glyph for an uncompleted row", () => {
    const row = mkSet({ set_number: 1, completed_at: null });
    const p = presentReadOnlySetRow(row, "kg");
    expect(p.isChecked).toBe(false);
    expect(p.showCheck).toBe(false);
  });

  it("renders the weight in lbs when unit is lbs", () => {
    const row = mkSet({ set_number: 1, weight: "100", reps: 5 });
    const p = presentReadOnlySetRow(row, "lbs");
    expect(p.weight).toBe("220.5");
    // Reps cell does not convert; reps are unit-less.
    expect(p.reps).toBe("5");
  });

  it("shows em-dashes for an empty (null weight, null reps) row", () => {
    const row = mkSet({ set_number: 1, weight: null, reps: null });
    const p = presentReadOnlySetRow(row, "kg");
    expect(p.weight).toBe("—");
    expect(p.reps).toBe("—");
  });
});

// ---------------------------------------------------------------------------
// presentReadOnlyExerciseBlock — header subline, deleted suffix, empty state.
// ---------------------------------------------------------------------------
describe("presentReadOnlyExerciseBlock", () => {
  const baseExercise = {
    name: "Barbell Bench Press",
    muscles: ["Chest", "Arms"],
    equipment: "Barbell" as string | null,
    deleted_at: null as string | null,
  };

  it("renders name, subline, and column header when sets exist", () => {
    const p = presentReadOnlyExerciseBlock(baseExercise, 3);
    expect(p.name).toBe("Barbell Bench Press");
    expect(p.showDeletedSuffix).toBe(false);
    expect(p.subline).toBe("Chest, Arms · Barbell");
    expect(p.showColumnHeader).toBe(true);
    expect(p.showEmptyState).toBe(false);
  });

  it("renders the empty state when sets.length === 0", () => {
    const p = presentReadOnlySetEmpty();
    expect(p.showEmptyState).toBe(true);
    expect(p.showColumnHeader).toBe(false);
    expect(p.emptyStateText).toBe("No sets logged for this exercise.");
    // Anchor against the exported constant so a copy change here forces a
    // matching test update.
    expect(p.emptyStateText).toBe(READ_ONLY_BLOCK_EMPTY_TEXT);
  });

  it("flags the deleted suffix when the exercise has been soft-deleted", () => {
    const p = presentReadOnlyExerciseBlock(
      { ...baseExercise, deleted_at: "2026-05-22T08:00:00Z" },
      2,
    );
    expect(p.showDeletedSuffix).toBe(true);
    // Name itself is unchanged — the `(deleted)` text is appended by the
    // component's JSX, not by the presentation contract.
    expect(p.name).toBe("Barbell Bench Press");
  });

  it("omits the subline when muscles is empty AND equipment is null", () => {
    const p = presentReadOnlyExerciseBlock(
      { ...baseExercise, muscles: [], equipment: null },
      1,
    );
    expect(p.subline).toBeNull();
  });

  it("renders just muscles when equipment is null", () => {
    const p = presentReadOnlyExerciseBlock(
      { ...baseExercise, equipment: null },
      1,
    );
    expect(p.subline).toBe("Chest, Arms");
  });

  it("renders just equipment when muscles is empty", () => {
    const p = presentReadOnlyExerciseBlock(
      { ...baseExercise, muscles: [] },
      1,
    );
    expect(p.subline).toBe("Barbell");
  });
});

function presentReadOnlySetEmpty() {
  return presentReadOnlyExerciseBlock(
    {
      name: "Barbell Bench Press",
      muscles: ["Chest"],
      equipment: "Barbell",
      deleted_at: null,
    },
    0,
  );
}
