/**
 * Unit tests for `presentTopExerciseE1rm` (Phase 2a e1RM presenter).
 *
 * Pure — no React, no Supabase. Covers: best-e1RM per (exercise × ISO week)
 * via MAX (Invariant E1, NOT sum), LOGGED-weight-only eligibility (Invariant
 * D — bodyweight `weight=0` produces no point AND no top-N slot), LOCF
 * carry-forward of untrained weeks + leading flat lead-in (Decision #7a),
 * top-N capping + deterministic ranking by distinct sessions, dangling
 * exercise_id skip, and row-order-independent determinism. Time is NOT pinned
 * via fake timers — the presenter takes an injectable `now`.
 */

import { describe, expect, it } from "vitest";

import type { WeeklyVolumeRow } from "~/api/stats";
import type { ExerciseRow } from "~/db/types";
import { epley1RM } from "~/utils/formulas";
import { presentTopExerciseE1rm } from "~/utils/e1rm-strength";

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
    exercises: { equipment: overrides.equipment ?? "barbell" },
    sessions: { started_at: startedAt, ended_at: startedAt },
  };
}

function mkExercise(overrides: {
  id: string;
  name?: string;
  muscles?: string[];
  equipment?: string | null;
}): ExerciseRow {
  return {
    id: overrides.id,
    user_id: "user-1",
    name: overrides.name ?? `Exercise ${overrides.id}`,
    muscles: overrides.muscles ?? [],
    equipment: overrides.equipment ?? null,
    notes: null,
    source: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    deleted_at: null,
  };
}

describe("presentTopExerciseE1rm", () => {
  // 1.
  it("returns empty weeks + series for empty rows", () => {
    const model = presentTopExerciseE1rm({
      rows: [],
      exercises: [],
      now: NOW,
    });
    expect(model.weeks).toEqual([]);
    expect(model.series).toEqual([]);
  });

  // 2.
  it("single weighted exercise, single week → one series with epley1RM(100,5)", () => {
    const rows = [
      mkRow({
        completed_at: "2026-05-18T10:00:00Z",
        weight: "100",
        reps: 5,
        exercise_id: "bench",
      }),
    ];
    const exercises = [mkExercise({ id: "bench", name: "Bench Press" })];
    const model = presentTopExerciseE1rm({ rows, exercises, now: NOW });

    expect(model.series).toHaveLength(1);
    expect(model.series[0]!.id).toBe("bench");
    expect(model.series[0]!.name).toBe("Bench Press");
    expect(model.series[0]!.rank).toBe(0);
    expect(model.series[0]!.values).toHaveLength(1);
    expect(model.series[0]!.values[0]!).toBeCloseTo(epley1RM(100, 5)); // 116.666…
  });

  // 3. — Invariant E1: MAX across same-week sessions, NOT sum.
  it("takes the MAX e1RM across two sessions in the SAME week (not a sum)", () => {
    const rows = [
      // (100×5) → e1RM ≈ 116.67
      mkRow({
        completed_at: "2026-05-18T10:00:00Z",
        weight: "100",
        reps: 5,
        exercise_id: "bench",
        session_id: "s1",
      }),
      // (120×3) → e1RM = 132 (higher)
      mkRow({
        completed_at: "2026-05-18T11:00:00Z",
        weight: "120",
        reps: 3,
        exercise_id: "bench",
        session_id: "s2",
      }),
    ];
    const exercises = [mkExercise({ id: "bench", name: "Bench Press" })];
    const model = presentTopExerciseE1rm({ rows, exercises, now: NOW });

    expect(model.series).toHaveLength(1);
    expect(model.series[0]!.values).toHaveLength(1);
    expect(model.series[0]!.values[0]!).toBeCloseTo(132); // MAX, not ~248.67
    expect(model.series[0]!.values[0]!).not.toBeCloseTo(248.67);
  });

  // 4. — MAX within a single session across sets.
  it("takes the MAX e1RM across sets within a single session", () => {
    const rows = [
      mkRow({
        completed_at: "2026-05-18T10:00:00Z",
        weight: "100",
        reps: 5,
        exercise_id: "bench",
        session_id: "s1",
      }),
      mkRow({
        completed_at: "2026-05-18T10:05:00Z",
        weight: "110",
        reps: 3,
        exercise_id: "bench",
        session_id: "s1",
      }),
    ];
    const exercises = [mkExercise({ id: "bench" })];
    const model = presentTopExerciseE1rm({ rows, exercises, now: NOW });

    // max(epley1RM(100,5)=116.67, epley1RM(110,3)=121) = 121
    expect(model.series[0]!.values[0]!).toBeCloseTo(121);
  });

  // 5. — LOCF: untrained week carries previous value forward, NOT 0.
  it("carries the last e1RM forward across an untrained week (LOCF, not 0)", () => {
    // W19 (Mon 5/4): 100×5 → 116.67; W21 (Mon 5/18): 120×3 → 132; W20 untrained.
    const rows = [
      mkRow({
        completed_at: "2026-05-04T10:00:00Z",
        weight: "100",
        reps: 5,
        exercise_id: "bench",
      }),
      mkRow({
        completed_at: "2026-05-18T10:00:00Z",
        weight: "120",
        reps: 3,
        exercise_id: "bench",
      }),
    ];
    const exercises = [mkExercise({ id: "bench" })];
    const model = presentTopExerciseE1rm({ rows, exercises, now: NOW });

    expect(model.weeks).toHaveLength(3); // W19, W20, W21
    const values = model.series[0]!.values;
    expect(values).toHaveLength(3);
    expect(values[0]!).toBeCloseTo(epley1RM(100, 5)); // 116.67
    // W20 (untrained) carries W19's value forward — NOT 0.
    expect(values[1]!).not.toBe(0);
    expect(values[1]!).toBeCloseTo(epley1RM(100, 5)); // 116.67 held
    expect(values[2]!).toBeCloseTo(132);
  });

  // 6. — Leading flat lead-in: weeks before the first real value take it.
  it("flat-leads-in: leading untrained weeks take the first real value (no 0)", () => {
    // Anchor the axis at W19 via a DIFFERENT exercise trained in W19. The
    // exercise under test ("late") is first trained in W20 only.
    const rows = [
      // Anchor exercise in W19.
      mkRow({
        completed_at: "2026-05-04T10:00:00Z",
        weight: "100",
        reps: 5,
        exercise_id: "anchor",
        session_id: "a1",
      }),
      // "late" first trained in W20 (Mon 5/11).
      mkRow({
        completed_at: "2026-05-11T10:00:00Z",
        weight: "80",
        reps: 5,
        exercise_id: "late",
        session_id: "l1",
      }),
    ];
    const exercises = [
      mkExercise({ id: "anchor", name: "Anchor" }),
      mkExercise({ id: "late", name: "Late" }),
    ];
    const model = presentTopExerciseE1rm({ rows, exercises, now: NOW });

    expect(model.weeks).toHaveLength(3); // W19, W20, W21
    const late = model.series.find((s) => s.id === "late")!;
    const v80 = epley1RM(80, 5);
    // Leading W19 (untrained for "late") flat-leads at the first real value.
    expect(late.values[0]!).toBeGreaterThan(0);
    expect(late.values[0]!).toBe(late.values[1]!);
    expect(late.values[0]!).toBeCloseTo(v80);
    // W21 (untrained, after first real) carries W20 forward.
    expect(late.values[2]!).toBeCloseTo(v80);
  });

  // 7. — Invariant D: bodyweight-only (weight=0) → NO series.
  it("excludes a bodyweight-only exercise (all weight=0) from series", () => {
    const rows = [
      // Bodyweight-only (no e1RM).
      mkRow({
        completed_at: "2026-05-18T10:00:00Z",
        weight: "0",
        reps: 12,
        exercise_id: "pushup",
        equipment: "bodyweight",
        session_id: "p1",
      }),
      // Paired weighted exercise — proves the weighted one still plots.
      mkRow({
        completed_at: "2026-05-18T10:00:00Z",
        weight: "100",
        reps: 5,
        exercise_id: "bench",
        session_id: "b1",
      }),
    ];
    const exercises = [
      mkExercise({ id: "pushup", name: "Push-up", equipment: "bodyweight" }),
      mkExercise({ id: "bench", name: "Bench Press" }),
    ];
    const model = presentTopExerciseE1rm({ rows, exercises, now: NOW });

    expect(model.series.map((s) => s.id)).toEqual(["bench"]);
    expect(model.series.some((s) => s.id === "pushup")).toBe(false);
  });

  // 8. — Bodyweight WITH added load plots (gate is logged weight, not equipment).
  it("plots a bodyweight-equipment exercise logged WITH added weight", () => {
    const rows = [
      mkRow({
        completed_at: "2026-05-18T10:00:00Z",
        weight: "20", // added load on a Pull-up
        reps: 8,
        exercise_id: "pullup",
        equipment: "bodyweight",
      }),
    ];
    const exercises = [
      mkExercise({ id: "pullup", name: "Pull-up", equipment: "bodyweight" }),
    ];
    const model = presentTopExerciseE1rm({ rows, exercises, now: NOW });

    expect(model.series).toHaveLength(1);
    expect(model.series[0]!.id).toBe("pullup");
    expect(model.series[0]!.values[0]!).toBeCloseTo(epley1RM(20, 8));
  });

  // 9. — top-N cap + ranking by distinct sessions + tie-break.
  it("caps at top-N and ranks by distinct sessions then recency then name", () => {
    const rows: WeeklyVolumeRow[] = [];
    // Four exercises with unambiguous distinct-session counts [5,4,3,2].
    // ex-a: 5 sessions, ex-b: 4, ex-c: 3, ex-d: 2.
    const counts: Record<string, number> = {
      "ex-a": 5,
      "ex-b": 4,
      "ex-c": 3,
      "ex-d": 2,
    };
    // Spread sessions across days inside the week axis so each has its own
    // session_id (12..17 May fall within the W20/W21 span ending at NOW).
    for (const [id, n] of Object.entries(counts)) {
      for (let i = 0; i < n; i++) {
        const d = `2026-05-${String(12 + (i % 6)).padStart(2, "0")}`;
        rows.push(
          mkRow({
            completed_at: `${d}T1${i}:00:00Z`,
            weight: "100",
            reps: 5,
            exercise_id: id,
            session_id: `${id}-s${i}`,
          }),
        );
      }
    }
    // ex-e and ex-f both have 1 session (a tie). Give ex-f a STRICTLY later
    // last-activity timestamp than ex-e so tie-break #2 (recency DESC) decides
    // the 5th-and-final slot deterministically: ex-f wins, ex-e is dropped.
    rows.push(
      mkRow({
        completed_at: "2026-05-14T08:00:00Z", // ex-e: earlier
        weight: "100",
        reps: 5,
        exercise_id: "ex-e",
        session_id: "ex-e-s0",
      }),
      mkRow({
        completed_at: "2026-05-15T20:00:00Z", // ex-f: later → wins by recency
        weight: "100",
        reps: 5,
        exercise_id: "ex-f",
        session_id: "ex-f-s0",
      }),
    );
    const exercises = [
      mkExercise({ id: "ex-a", name: "A" }),
      mkExercise({ id: "ex-b", name: "B" }),
      mkExercise({ id: "ex-c", name: "C" }),
      mkExercise({ id: "ex-d", name: "D" }),
      mkExercise({ id: "ex-e", name: "E" }),
      mkExercise({ id: "ex-f", name: "F" }),
    ];
    const model = presentTopExerciseE1rm({
      rows,
      exercises,
      topN: 5,
      now: NOW,
    });

    expect(model.series).toHaveLength(5);
    const ids = model.series.map((s) => s.id);
    // Top 4 are unambiguous by session count.
    expect(ids.slice(0, 4)).toEqual(["ex-a", "ex-b", "ex-c", "ex-d"]);
    // The 5th slot resolves the count-1 tie by recency DESC → ex-f (later),
    // NOT ex-e. Name ASC (E < F) would pick ex-e, so this also proves recency
    // outranks name in the tie-break order.
    expect(ids[4]).toBe("ex-f");
    expect(ids).not.toContain("ex-e");
    // Ranks are 0..4 in series order.
    expect(model.series.map((s) => s.rank)).toEqual([0, 1, 2, 3, 4]);
  });

  // 10. — eligibility excludes a high-frequency bodyweight-only exercise.
  it("a high-frequency bodyweight-only exercise does NOT consume a top-N slot", () => {
    const rows: WeeklyVolumeRow[] = [];
    // Push-up: bodyweight-only, 10 distinct sessions (highest frequency).
    for (let i = 0; i < 10; i++) {
      rows.push(
        mkRow({
          completed_at: `2026-05-${String(12 + (i % 6)).padStart(2, "0")}T1${i % 9}:00:00Z`,
          weight: "0",
          reps: 12,
          exercise_id: "pushup",
          equipment: "bodyweight",
          session_id: `pu-s${i}`,
        }),
      );
    }
    // Bench: weighted, only 2 sessions (lower frequency) — should still be the
    // ONLY series because pushup is ineligible.
    for (let i = 0; i < 2; i++) {
      rows.push(
        mkRow({
          completed_at: `2026-05-1${4 + i}T10:00:00Z`,
          weight: "100",
          reps: 5,
          exercise_id: "bench",
          session_id: `b-s${i}`,
        }),
      );
    }
    const exercises = [
      mkExercise({ id: "pushup", name: "Push-up", equipment: "bodyweight" }),
      mkExercise({ id: "bench", name: "Bench Press" }),
    ];
    const model = presentTopExerciseE1rm({ rows, exercises, now: NOW });

    expect(model.series.map((s) => s.id)).toEqual(["bench"]);
  });

  // 11. — dangling exercise_id skip.
  it("skips rows whose exercise_id is not in the library (dangling)", () => {
    const rows = [
      mkRow({
        completed_at: "2026-05-18T10:00:00Z",
        weight: "100",
        reps: 5,
        exercise_id: "ghost",
      }),
      mkRow({
        completed_at: "2026-05-18T10:00:00Z",
        weight: "100",
        reps: 5,
        exercise_id: "bench",
      }),
    ];
    const exercises = [mkExercise({ id: "bench", name: "Bench Press" })];
    const model = presentTopExerciseE1rm({ rows, exercises, now: NOW });

    // ghost neither plots nor counts toward ranking.
    expect(model.series.map((s) => s.id)).toEqual(["bench"]);
  });

  // 12. — single-week one-dot for a first-week user.
  it("renders a single week (one value per series) for a first-week user", () => {
    const rows = [
      mkRow({
        completed_at: "2026-05-18T10:00:00Z",
        weight: "100",
        reps: 5,
        exercise_id: "bench",
      }),
    ];
    const exercises = [mkExercise({ id: "bench" })];
    const model = presentTopExerciseE1rm({ rows, exercises, now: NOW });

    expect(model.weeks).toHaveLength(1);
    expect(model.series[0]!.values).toHaveLength(1);
  });

  // 13. — ranking is deterministic regardless of row order.
  it("produces identical series id-order regardless of input row order", () => {
    const base = [
      // ex-x: 3 sessions
      mkRow({ completed_at: "2026-05-12T10:00:00Z", weight: "100", reps: 5, exercise_id: "ex-x", session_id: "x1" }),
      mkRow({ completed_at: "2026-05-13T10:00:00Z", weight: "100", reps: 5, exercise_id: "ex-x", session_id: "x2" }),
      mkRow({ completed_at: "2026-05-14T10:00:00Z", weight: "100", reps: 5, exercise_id: "ex-x", session_id: "x3" }),
      // ex-y: 2 sessions
      mkRow({ completed_at: "2026-05-12T11:00:00Z", weight: "90", reps: 5, exercise_id: "ex-y", session_id: "y1" }),
      mkRow({ completed_at: "2026-05-13T11:00:00Z", weight: "90", reps: 5, exercise_id: "ex-y", session_id: "y2" }),
      // ex-z: 1 session
      mkRow({ completed_at: "2026-05-12T12:00:00Z", weight: "80", reps: 5, exercise_id: "ex-z", session_id: "z1" }),
    ];
    const exercises = [
      mkExercise({ id: "ex-x", name: "X" }),
      mkExercise({ id: "ex-y", name: "Y" }),
      mkExercise({ id: "ex-z", name: "Z" }),
    ];
    const forward = presentTopExerciseE1rm({ rows: base, exercises, now: NOW });
    const reversed = presentTopExerciseE1rm({
      rows: [...base].reverse(),
      exercises,
      now: NOW,
    });
    const shuffled = presentTopExerciseE1rm({
      rows: [base[2]!, base[5]!, base[0]!, base[4]!, base[1]!, base[3]!],
      exercises,
      now: NOW,
    });

    const order = (m: ReturnType<typeof presentTopExerciseE1rm>) =>
      m.series.map((s) => s.id);
    expect(order(forward)).toEqual(["ex-x", "ex-y", "ex-z"]);
    expect(order(reversed)).toEqual(["ex-x", "ex-y", "ex-z"]);
    expect(order(shuffled)).toEqual(["ex-x", "ex-y", "ex-z"]);
  });
});
