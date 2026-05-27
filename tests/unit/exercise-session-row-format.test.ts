/**
 * Pure-presenter tests for `presentExerciseSessionRow`.
 *
 * Locks the kernel the new "Sessions" row on `/(app)/exercises/{id}/progress`
 * shares with the chart's volume data point (`progress.tsx` math + `sumPastVolume`).
 * Same predicate as `sumPastVolume` (warmup-skip, `w > 0 && r > 0`); same
 * working-set count convention (`set_type !== "warmup"`) as the rest of the
 * codebase.
 *
 * Mirrors `session-summary-row-format.test.ts`: vitest only, no RNTL, no
 * `.tsx`, no React. vitest config collects `tests/unit/**\/*.test.ts`.
 */

import { describe, expect, it } from "vitest";

import type { SetRow } from "~/db/types";
import {
  presentExerciseSessionRow,
  presentSetVolumeLines,
} from "~/utils/exercise-session-row-format";

/**
 * Builds a `SetRow`-shaped row good enough for the presenter. The presenter
 * only reads `set_type`, `weight`, and `reps`; the rest of the columns are
 * filled with deterministic placeholders so the test fixtures stay terse.
 */
function makeSet(overrides: Partial<SetRow> = {}): SetRow {
  return {
    id: overrides.id ?? "00000000-0000-0000-0000-000000000000",
    user_id: "user-1",
    session_id: "session-1",
    exercise_id: "exercise-1",
    set_number: overrides.set_number ?? 1,
    reps: overrides.reps ?? null,
    weight: overrides.weight ?? null,
    rpe: null,
    set_type: overrides.set_type ?? "working",
    parent_set_id: null,
    notes: null,
    completed_at: null,
    created_at: "2026-05-24T00:00:00.000Z",
    updated_at: "2026-05-24T00:00:00.000Z",
    deleted_at: null,
    ...overrides,
  };
}

describe("presentExerciseSessionRow — happy path", () => {
  it("aggregates 4 working sets at 100kg×8 → '4 × 3,200 kg'", () => {
    const sets: SetRow[] = [
      makeSet({ set_number: 1, weight: "100", reps: 8 }),
      makeSet({ set_number: 2, weight: "100", reps: 8 }),
      makeSet({ set_number: 3, weight: "100", reps: 8 }),
      makeSet({ set_number: 4, weight: "100", reps: 8 }),
    ];
    expect(presentExerciseSessionRow({ sets, unit: "kg" })).toEqual({
      count: 4,
      volumeKg: 3200,
      volumeLabel: "4 × 3,200 kg",
    });
  });
});

describe("presentExerciseSessionRow — warmup handling", () => {
  it("excludes warmups from both count and volumeKg", () => {
    const sets: SetRow[] = [
      makeSet({ set_number: 1, set_type: "warmup", weight: "40", reps: 10 }),
      makeSet({ set_number: 2, weight: "100", reps: 8 }),
      makeSet({ set_number: 3, weight: "100", reps: 8 }),
      makeSet({ set_number: 4, weight: "100", reps: 8 }),
    ];
    const out = presentExerciseSessionRow({ sets, unit: "kg" });
    expect(out.count).toBe(3);
    expect(out.volumeKg).toBe(2400);
    expect(out.volumeLabel).toBe("3 × 2,400 kg");
  });

  it("returns empty label when only warmups are logged (volumeKg === 0)", () => {
    const sets: SetRow[] = [
      makeSet({ set_number: 1, set_type: "warmup", weight: "40", reps: 10 }),
      makeSet({ set_number: 2, set_type: "warmup", weight: "60", reps: 5 }),
    ];
    expect(presentExerciseSessionRow({ sets, unit: "kg" })).toEqual({
      count: 0,
      volumeKg: 0,
      volumeLabel: "",
    });
  });
});

describe("presentExerciseSessionRow — sloppy data", () => {
  it("counts working sets with null weight/0 reps but excludes them from volumeKg", () => {
    // count = working-set count (filter only on set_type), independent of
    // whether weight/reps were filled in. volumeKg = canonical predicate
    // (sumPastVolume) which skips w=0 and r=0.
    const sets: SetRow[] = [
      makeSet({ set_number: 1, weight: null, reps: 8 }),
      makeSet({ set_number: 2, weight: "100", reps: 0 }),
      makeSet({ set_number: 3, weight: "100", reps: 8 }),
    ];
    const out = presentExerciseSessionRow({ sets, unit: "kg" });
    expect(out.count).toBe(3);
    expect(out.volumeKg).toBe(800);
    expect(out.volumeLabel).toBe("3 × 800 kg");
  });

  it("returns empty label when volumeKg evaluates to 0 even with working sets present", () => {
    // 3 working sets but every one has unusable weight/reps → volumeKg = 0.
    // count > 0 but the kernel suppresses the label.
    const sets: SetRow[] = [
      makeSet({ set_number: 1, weight: null, reps: 8 }),
      makeSet({ set_number: 2, weight: "100", reps: 0 }),
      makeSet({ set_number: 3, weight: null, reps: null }),
    ];
    expect(presentExerciseSessionRow({ sets, unit: "kg" })).toEqual({
      count: 3,
      volumeKg: 0,
      volumeLabel: "",
    });
  });

  it("returns empty label for an empty sets array", () => {
    expect(presentExerciseSessionRow({ sets: [], unit: "kg" })).toEqual({
      count: 0,
      volumeKg: 0,
      volumeLabel: "",
    });
  });
});

describe("presentSetVolumeLines — happy path", () => {
  it("one line per non-warmup set with label + per-set volume", () => {
    const sets: SetRow[] = [
      makeSet({ set_number: 1, weight: "100", reps: 8 }),
      makeSet({ set_number: 2, weight: "100", reps: 8 }),
      makeSet({ set_number: 3, weight: "110", reps: 6 }),
    ];
    expect(presentSetVolumeLines({ sets, unit: "kg" })).toEqual([
      { setNumber: 1, setType: "working", label: "100 × 8", volumeKg: 800, volumeLabel: "800 kg" },
      { setNumber: 2, setType: "working", label: "100 × 8", volumeKg: 800, volumeLabel: "800 kg" },
      { setNumber: 3, setType: "working", label: "110 × 6", volumeKg: 660, volumeLabel: "660 kg" },
    ]);
  });

  it("per-set volumeKg sums to sumPastVolume (the row total)", () => {
    const sets: SetRow[] = [
      makeSet({ set_number: 1, set_type: "warmup", weight: "40", reps: 10 }),
      makeSet({ set_number: 2, weight: "100", reps: 8 }),
      makeSet({ set_number: 3, weight: "110", reps: 6 }),
    ];
    const lines = presentSetVolumeLines({ sets, unit: "kg" });
    const sum = lines.reduce((acc, l) => acc + l.volumeKg, 0);
    expect(sum).toBe(presentExerciseSessionRow({ sets, unit: "kg" }).volumeKg);
  });
});

describe("presentSetVolumeLines — warmups + dropsets", () => {
  it("excludes warmups, includes dropsets in the volume", () => {
    const sets: SetRow[] = [
      makeSet({ set_number: 1, set_type: "warmup", weight: "40", reps: 10 }),
      makeSet({ set_number: 2, set_type: "working", weight: "100", reps: 8 }),
      makeSet({ set_number: 3, set_type: "dropset", weight: "60", reps: 12 }),
    ];
    const lines = presentSetVolumeLines({ sets, unit: "kg" });
    expect(lines.map((l) => l.setType)).toEqual(["working", "dropset"]);
    expect(lines.map((l) => l.volumeKg)).toEqual([800, 720]);
  });
});

describe("presentSetVolumeLines — sloppy data", () => {
  it("renders em dashes and empty volumeLabel for null/zero parts (0 volume)", () => {
    const sets: SetRow[] = [
      makeSet({ set_number: 1, weight: null, reps: 8 }),
      makeSet({ set_number: 2, weight: "100", reps: 0 }),
      makeSet({ set_number: 3, weight: "100", reps: 8 }),
    ];
    const lines = presentSetVolumeLines({ sets, unit: "kg" });
    expect(lines).toEqual([
      { setNumber: 1, setType: "working", label: "— × 8", volumeKg: 0, volumeLabel: "" },
      { setNumber: 2, setType: "working", label: "100 × 0", volumeKg: 0, volumeLabel: "" },
      { setNumber: 3, setType: "working", label: "100 × 8", volumeKg: 800, volumeLabel: "800 kg" },
    ]);
  });

  it("returns an empty array when there are no non-warmup sets", () => {
    const sets: SetRow[] = [
      makeSet({ set_number: 1, set_type: "warmup", weight: "40", reps: 10 }),
    ];
    expect(presentSetVolumeLines({ sets, unit: "kg" })).toEqual([]);
  });
});

describe("presentSetVolumeLines — unit-awareness", () => {
  it("converts the weight label + volume to lbs, keeps volumeKg canonical", () => {
    const sets: SetRow[] = [makeSet({ set_number: 1, weight: "100", reps: 8 })];
    const lines = presentSetVolumeLines({ sets, unit: "lbs" });
    // displayWeight(100kg, lbs) ≈ 220.5; volume 800kg ≈ 1,764 lbs.
    expect(lines[0]!.label).toBe("220.5 × 8");
    expect(lines[0]!.volumeKg).toBe(800);
    expect(lines[0]!.volumeLabel).toBe("1,764 lbs");
  });
});

describe("presentExerciseSessionRow — unit-awareness", () => {
  it("converts kg → lbs in the label suffix while leaving volumeKg canonical", () => {
    // 4 × 100kg × 8 = 3,200 kg ≈ 7,055 lbs (formatVolume rounds via Math.round).
    const sets: SetRow[] = [
      makeSet({ set_number: 1, weight: "100", reps: 8 }),
      makeSet({ set_number: 2, weight: "100", reps: 8 }),
      makeSet({ set_number: 3, weight: "100", reps: 8 }),
      makeSet({ set_number: 4, weight: "100", reps: 8 }),
    ];
    const out = presentExerciseSessionRow({ sets, unit: "lbs" });
    expect(out.count).toBe(4);
    // volumeKg stays canonical kg — only volumeLabel changes between units.
    expect(out.volumeKg).toBe(3200);
    expect(out.volumeLabel).toBe("4 × 7,055 lbs");
    // The pinned screen-level regex `^\d+ × [\d,]+ (kg|lbs)$` must match.
    expect(out.volumeLabel).toMatch(/^\d+ × [\d,]+ (kg|lbs)$/);
  });
});
