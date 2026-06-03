/**
 * Unit tests for `presentWeeklyVolumeByMuscle` (Phase 1 presenter).
 *
 * Pure — no React, no Supabase. Covers: bucketing by ISO week × primary
 * muscle, zero-fill across a shared contiguous week axis, `muscles[0]`
 * attribution, the "Other" bucket, bodyweight contribution, dangling
 * exercise_id skip, and empty input. Time is NOT pinned via fake timers — the
 * presenter takes an injectable `now` so the week axis is deterministic.
 */

import { describe, expect, it } from "vitest";

import type { WeeklyVolumeRow } from "~/api/stats";
import type { ExerciseRow, MeasurementEntryRow } from "~/db/types";
import { presentWeeklyVolumeByMuscle } from "~/utils/weekly-muscle-volume";
import { computeWindowStart } from "~/utils/window-utils";

// Fixed "now" — Monday 2026-05-18 (ISO week 2026-W21).
const NOW = new Date(2026, 4, 18, 12, 0, 0);

function mkRow(overrides: {
  completed_at: string;
  weight: string | null;
  reps: number | null;
  exercise_id?: string;
  session_id?: string;
  equipment?: string;
  started_at?: string;
}): WeeklyVolumeRow {
  const startedAt = overrides.started_at ?? overrides.completed_at;
  return {
    completed_at: overrides.completed_at,
    weight: overrides.weight,
    reps: overrides.reps,
    set_type: "working",
    exercise_id: overrides.exercise_id ?? "ex-1",
    session_id: overrides.session_id ?? "sess-1",
    exercises: { equipment: overrides.equipment ?? "barbell", bodyweight_factor: null },
    sessions: { started_at: startedAt, ended_at: startedAt },
  };
}

function mkExercise(overrides: {
  id: string;
  muscles?: string[];
  equipment?: string | null;
}): ExerciseRow {
  return {
    id: overrides.id,
    user_id: "user-1",
    name: `Exercise ${overrides.id}`,
    muscles: overrides.muscles ?? [],
    equipment: overrides.equipment ?? null,
    bodyweight_factor: null,
    notes: null,
    source: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    deleted_at: null,
  };
}

function mkMeasurement(
  measuredAt: string,
  weightKg: string | null,
): MeasurementEntryRow {
  return {
    id: `m-${measuredAt}`,
    user_id: "user-1",
    measured_at: measuredAt,
    weight_kg: weightKg,
    body_fat_pct: null,
    neck_cm: null,
    chest_cm: null,
    biceps_cm: null,
    forearm_cm: null,
    waist_cm: null,
    hips_cm: null,
    thigh_cm: null,
    calf_cm: null,
    notes: null,
    created_at: measuredAt,
    updated_at: measuredAt,
    deleted_at: null,
  };
}

describe("presentWeeklyVolumeByMuscle", () => {
  it("returns empty weeks + series for empty rows", () => {
    const model = presentWeeklyVolumeByMuscle({
      rows: [],
      exercises: [],
      measurements: [],
      now: NOW,
    });
    expect(model.weeks).toEqual([]);
    expect(model.series).toEqual([]);
  });

  it("attributes volume to the PRIMARY muscle (muscles[0])", () => {
    const rows = [
      mkRow({
        completed_at: "2026-05-18T10:00:00Z",
        weight: "100",
        reps: 5,
        exercise_id: "bench",
      }),
    ];
    const exercises = [
      // Primary = Chest, secondary = Shoulders — only Chest is attributed.
      mkExercise({ id: "bench", muscles: ["Chest", "Shoulders"] }),
    ];
    const model = presentWeeklyVolumeByMuscle({
      rows,
      exercises,
      measurements: [],
      now: NOW,
    });
    expect(model.series).toHaveLength(1);
    expect(model.series[0]!.key).toBe("Chest");
    // Single week → single value 500.
    expect(model.series[0]!.values).toEqual([500]);
  });

  it("zero-fills the shared week axis across multiple weeks", () => {
    // Row in week 2026-W19 (Mon 5/4) and another in 2026-W21 (Mon 5/18).
    const rows = [
      mkRow({
        completed_at: "2026-05-04T10:00:00Z",
        weight: "100",
        reps: 5,
        exercise_id: "bench",
      }),
      mkRow({
        completed_at: "2026-05-18T10:00:00Z",
        weight: "100",
        reps: 6,
        exercise_id: "bench",
      }),
    ];
    const exercises = [mkExercise({ id: "bench", muscles: ["Chest"] })];
    const model = presentWeeklyVolumeByMuscle({
      rows,
      exercises,
      measurements: [],
      now: NOW,
    });
    // Week axis spans W19 → W21 inclusive = 3 weeks.
    expect(model.weeks).toHaveLength(3);
    // Chest: [500, 0 (rest week W20), 600].
    expect(model.series[0]!.key).toBe("Chest");
    expect(model.series[0]!.values).toEqual([500, 0, 600]);
  });

  it("routes exercises with no/unknown primary muscle to 'Other'", () => {
    const rows = [
      mkRow({
        completed_at: "2026-05-18T10:00:00Z",
        weight: "50",
        reps: 10,
        exercise_id: "mystery",
      }),
    ];
    const exercises = [mkExercise({ id: "mystery", muscles: [] })];
    const model = presentWeeklyVolumeByMuscle({
      rows,
      exercises,
      measurements: [],
      now: NOW,
    });
    expect(model.series).toHaveLength(1);
    expect(model.series[0]!.key).toBe("Other");
    expect(model.series[0]!.values).toEqual([500]);
  });

  it("emits multiple series in MUSCLE_GROUPS order, then 'Other'", () => {
    const rows = [
      mkRow({
        completed_at: "2026-05-18T10:00:00Z",
        weight: "100",
        reps: 5,
        exercise_id: "squat",
      }),
      mkRow({
        completed_at: "2026-05-18T10:00:00Z",
        weight: "100",
        reps: 5,
        exercise_id: "bench",
      }),
      mkRow({
        completed_at: "2026-05-18T10:00:00Z",
        weight: "50",
        reps: 10,
        exercise_id: "mystery",
      }),
    ];
    const exercises = [
      mkExercise({ id: "squat", muscles: ["Legs"] }),
      mkExercise({ id: "bench", muscles: ["Chest"] }),
      mkExercise({ id: "mystery", muscles: [] }),
    ];
    const model = presentWeeklyVolumeByMuscle({
      rows,
      exercises,
      measurements: [],
      now: NOW,
    });
    // Order: Chest (before Legs in MUSCLE_GROUPS), Legs, then Other.
    expect(model.series.map((s) => s.key)).toEqual(["Chest", "Legs", "Other"]);
  });

  it("a bodyweight exercise contributes (bodyweight + addedLoad) * reps", () => {
    const rows = [
      mkRow({
        completed_at: "2026-05-18T10:00:00Z",
        weight: "0",
        reps: 10,
        exercise_id: "pullup",
        equipment: "bodyweight",
        started_at: "2026-05-18T09:00:00Z",
      }),
    ];
    const exercises = [
      mkExercise({
        id: "pullup",
        muscles: ["Upper back"],
        equipment: "bodyweight",
      }),
    ];
    const model = presentWeeklyVolumeByMuscle({
      rows,
      exercises,
      measurements: [mkMeasurement("2026-05-01T00:00:00Z", "80")],
      now: NOW,
    });
    expect(model.series[0]!.key).toBe("Upper back");
    // 80 * 10 = 800.
    expect(model.series[0]!.values).toEqual([800]);
  });

  it("skips rows whose exercise_id is not in the library (dangling)", () => {
    const rows = [
      mkRow({
        completed_at: "2026-05-18T10:00:00Z",
        weight: "100",
        reps: 5,
        exercise_id: "ghost",
      }),
    ];
    // Library has no "ghost" → row is skipped → no series.
    const model = presentWeeklyVolumeByMuscle({
      rows,
      exercises: [mkExercise({ id: "bench", muscles: ["Chest"] })],
      measurements: [],
      now: NOW,
    });
    expect(model.series).toEqual([]);
  });

  it("drops an all-zero muscle series (e.g. only warmup/0-volume rows)", () => {
    const rows = [
      mkRow({
        completed_at: "2026-05-18T10:00:00Z",
        weight: "0", // barbell 0 → contributes 0
        reps: 5,
        exercise_id: "bench",
      }),
    ];
    const exercises = [mkExercise({ id: "bench", muscles: ["Chest"] })];
    const model = presentWeeklyVolumeByMuscle({
      rows,
      exercises,
      measurements: [],
      now: NOW,
    });
    // Chest had a row but 0 volume → no series emitted.
    expect(model.series).toEqual([]);
    // Week axis still spans the single week.
    expect(model.weeks).toHaveLength(1);
  });

  it("renders a single week (one dot per series) for a first-week user", () => {
    const rows = [
      mkRow({
        completed_at: "2026-05-18T10:00:00Z",
        weight: "100",
        reps: 5,
        exercise_id: "bench",
      }),
    ];
    const exercises = [mkExercise({ id: "bench", muscles: ["Chest"] })];
    const model = presentWeeklyVolumeByMuscle({
      rows,
      exercises,
      measurements: [],
      now: NOW,
    });
    expect(model.weeks).toHaveLength(1);
    expect(model.series[0]!.values).toHaveLength(1);
  });

  // ---------------------------------------------------------------------------
  // Windowed cases (view-only chart window — `windowStartMs`).
  // ---------------------------------------------------------------------------

  it("W-0 (Invariant W): windowStartMs:undefined === the no-param call (byte-for-byte)", () => {
    // A multi-week, multi-muscle fixture.
    const rows = [
      mkRow({
        completed_at: "2026-03-02T10:00:00Z", // W10
        weight: "100",
        reps: 5,
        exercise_id: "bench",
        session_id: "s-w10",
        started_at: "2026-03-02T09:00:00Z",
      }),
      mkRow({
        completed_at: "2026-04-20T10:00:00Z", // W17
        weight: "120",
        reps: 5,
        exercise_id: "squat",
        session_id: "s-w17",
        started_at: "2026-04-20T09:00:00Z",
      }),
      mkRow({
        completed_at: "2026-05-18T10:00:00Z", // W21
        weight: "110",
        reps: 6,
        exercise_id: "bench",
        session_id: "s-w21",
        started_at: "2026-05-18T09:00:00Z",
      }),
    ];
    const exercises = [
      mkExercise({ id: "bench", muscles: ["Chest"] }),
      mkExercise({ id: "squat", muscles: ["Legs"] }),
    ];
    const withParam = presentWeeklyVolumeByMuscle({
      rows,
      exercises,
      measurements: [],
      windowStartMs: undefined,
      now: NOW,
    });
    const withoutParam = presentWeeklyVolumeByMuscle({
      rows,
      exercises,
      measurements: [],
      now: NOW,
    });
    expect(withParam).toEqual(withoutParam);
  });

  it("W-1 (axis shrink): the axis left edge becomes the first IN-WINDOW Monday", () => {
    // W10 (old) + W21 (recent). A 10-week window drops the W10 session, so the
    // axis must start at the first in-window week, not the lifetime W10.
    const rows = [
      mkRow({
        completed_at: "2026-03-02T10:00:00Z", // W10 — dropped
        weight: "100",
        reps: 5,
        exercise_id: "bench",
        session_id: "s-old",
        started_at: "2026-03-02T09:00:00Z",
      }),
      mkRow({
        completed_at: "2026-05-18T10:00:00Z", // W21 — in-window
        weight: "100",
        reps: 5,
        exercise_id: "bench",
        session_id: "s-new",
        started_at: "2026-05-18T09:00:00Z",
      }),
    ];
    const exercises = [mkExercise({ id: "bench", muscles: ["Chest"] })];

    const full = presentWeeklyVolumeByMuscle({
      rows,
      exercises,
      measurements: [],
      now: NOW,
    });
    const windowed = presentWeeklyVolumeByMuscle({
      rows,
      exercises,
      measurements: [],
      windowStartMs: computeWindowStart(10, NOW),
      now: NOW,
    });

    // Full history spans W10..W21; windowed starts at the first in-window
    // Monday (W21) and is therefore much shorter, NOT pinned to lifetime W10.
    expect(windowed.weeks.length).toBeLessThan(full.weeks.length);
    expect(windowed.weeks[0]!.key).not.toBe(full.weeks[0]!.key);
    // The single in-window session sits in the last (current) week.
    expect(windowed.series[0]!.key).toBe("Chest");
    expect(windowed.series[0]!.values.at(-1)).toBe(500);
  });

  it("W-2 (muscle drops out): a muscle with all sets pre-window is ABSENT", () => {
    const rows = [
      // Chest: ALL sets pre-window (W10) → must drop out.
      mkRow({
        completed_at: "2026-03-02T10:00:00Z",
        weight: "100",
        reps: 5,
        exercise_id: "bench",
        session_id: "s-old",
        started_at: "2026-03-02T09:00:00Z",
      }),
      // Legs: in-window (W21) → must remain.
      mkRow({
        completed_at: "2026-05-18T10:00:00Z",
        weight: "120",
        reps: 5,
        exercise_id: "squat",
        session_id: "s-new",
        started_at: "2026-05-18T09:00:00Z",
      }),
    ];
    const exercises = [
      mkExercise({ id: "bench", muscles: ["Chest"] }),
      mkExercise({ id: "squat", muscles: ["Legs"] }),
    ];
    const windowed = presentWeeklyVolumeByMuscle({
      rows,
      exercises,
      measurements: [],
      windowStartMs: computeWindowStart(10, NOW),
      now: NOW,
    });
    const keys = windowed.series.map((s) => s.key);
    expect(keys).not.toContain("Chest");
    expect(keys).toContain("Legs");
  });

  it("W-3 (boundary inclusivity): started_at === threshold is IN, threshold-1ms is OUT", () => {
    const threshold = computeWindowStart(10, NOW)!;
    const atThreshold = new Date(threshold).toISOString();
    const justBefore = new Date(threshold - 1).toISOString();

    // Both sessions bucket in the SAME current week so the axis is identical;
    // only inclusion differs by the started_at anchor.
    const rows = [
      mkRow({
        completed_at: "2026-05-18T10:00:00Z",
        weight: "100",
        reps: 5,
        exercise_id: "bench",
        session_id: "s-at",
        started_at: atThreshold, // exactly the threshold → INCLUDED
      }),
      mkRow({
        completed_at: "2026-05-18T11:00:00Z",
        weight: "100",
        reps: 5,
        exercise_id: "squat",
        session_id: "s-before",
        started_at: justBefore, // 1ms before → EXCLUDED
      }),
    ];
    const exercises = [
      mkExercise({ id: "bench", muscles: ["Chest"] }),
      mkExercise({ id: "squat", muscles: ["Legs"] }),
    ];
    const windowed = presentWeeklyVolumeByMuscle({
      rows,
      exercises,
      measurements: [],
      windowStartMs: threshold,
      now: NOW,
    });
    const keys = windowed.series.map((s) => s.key);
    // Chest's session started exactly at the threshold → included.
    expect(keys).toContain("Chest");
    // Legs' session started 1ms before the threshold → excluded.
    expect(keys).not.toContain("Legs");
  });
});
