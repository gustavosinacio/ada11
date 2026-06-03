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
    bodyweight_factor: null,
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

  // ---------------------------------------------------------------------------
  // Windowed cases (view-only chart window — `windowStartMs`).
  // ---------------------------------------------------------------------------

  // W-0 — Invariant W: windowStartMs:undefined === the no-param call.
  it("W-0 (Invariant W): windowStartMs:undefined === the no-param call (byte-for-byte)", () => {
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
        completed_at: "2026-05-18T10:00:00Z", // W21
        weight: "120",
        reps: 3,
        exercise_id: "bench",
        session_id: "s-w21",
        started_at: "2026-05-18T09:00:00Z",
      }),
      mkRow({
        completed_at: "2026-05-18T10:00:00Z", // W21
        weight: "140",
        reps: 5,
        exercise_id: "squat",
        session_id: "s-sq",
        started_at: "2026-05-18T09:00:00Z",
      }),
    ];
    const exercises = [
      mkExercise({ id: "bench", name: "Bench Press" }),
      mkExercise({ id: "squat", name: "Squat" }),
    ];
    const withParam = presentTopExerciseE1rm({
      rows,
      exercises,
      windowStartMs: undefined,
      now: NOW,
    });
    const withoutParam = presentTopExerciseE1rm({ rows, exercises, now: NOW });
    expect(withParam).toEqual(withoutParam);
  });

  // W-1 — axis shrink: the left edge becomes the first IN-WINDOW Monday.
  it("W-1 (axis shrink): the axis left edge becomes the first IN-WINDOW Monday", () => {
    const rows = [
      mkRow({
        completed_at: "2026-03-02T10:00:00Z", // W10 — dropped under a 10-week window
        weight: "100",
        reps: 5,
        exercise_id: "bench",
        session_id: "s-old",
        started_at: "2026-03-02T09:00:00Z",
      }),
      mkRow({
        completed_at: "2026-05-18T10:00:00Z", // W21 — in-window
        weight: "110",
        reps: 5,
        exercise_id: "bench",
        session_id: "s-new",
        started_at: "2026-05-18T09:00:00Z",
      }),
    ];
    const exercises = [mkExercise({ id: "bench", name: "Bench Press" })];
    const full = presentTopExerciseE1rm({ rows, exercises, now: NOW });
    const windowed = presentTopExerciseE1rm({
      rows,
      exercises,
      windowStartMs: computeWindowStart(10, NOW),
      now: NOW,
    });

    expect(windowed.weeks.length).toBeLessThan(full.weeks.length);
    expect(windowed.weeks[0]!.key).not.toBe(full.weeks[0]!.key);
  });

  // W-4 — top-N recompute: an exercise whose sessions are ALL pre-window must
  // NOT appear (cannot consume a top-N slot); rank order recomputes.
  it("W-4 (top-N recompute): a pre-window-only exercise is EXCLUDED and ranks recompute", () => {
    const rows: WeeklyVolumeRow[] = [];
    // "old" — many sessions, but ALL pre-window (W10). Highest session count.
    for (let s = 0; s < 5; s++) {
      rows.push(
        mkRow({
          completed_at: `2026-03-0${2 + s}T10:00:00Z`, // W10/W11 — pre-window
          weight: "100",
          reps: 5,
          exercise_id: "old",
          session_id: `old-s${s}`,
          started_at: `2026-03-0${2 + s}T09:00:00Z`,
        }),
      );
    }
    // "recent" — fewer sessions, all in-window (W21).
    for (let s = 0; s < 2; s++) {
      rows.push(
        mkRow({
          completed_at: `2026-05-18T1${s}:00:00Z`,
          weight: "120",
          reps: 5,
          exercise_id: "recent",
          session_id: `recent-s${s}`,
          started_at: `2026-05-18T0${s}:00:00Z`,
        }),
      );
    }
    const exercises = [
      mkExercise({ id: "old", name: "Old Lift" }),
      mkExercise({ id: "recent", name: "Recent Lift" }),
    ];

    // Full history: "old" outranks "recent" (5 vs 2 sessions) → it leads.
    const full = presentTopExerciseE1rm({ rows, exercises, now: NOW });
    expect(full.series.map((s) => s.id)).toEqual(["old", "recent"]);

    // Windowed (10w): "old" is entirely pre-window → excluded; only "recent"
    // remains and it is now rank 0 (ranks recompute over the windowed set).
    const windowed = presentTopExerciseE1rm({
      rows,
      exercises,
      windowStartMs: computeWindowStart(10, NOW),
      now: NOW,
    });
    expect(windowed.series.map((s) => s.id)).toEqual(["recent"]);
    expect(windowed.series[0]!.rank).toBe(0);
  });

  // W-5 — LOCF over the windowed set: the flat lead-in uses the first
  // IN-WINDOW real value, not the dropped pre-window one.
  it("W-5 (LOCF over windowed set): the flat lead-in uses the first IN-WINDOW value", () => {
    const rows = [
      // Pre-window (W10): a LOW e1RM (80×5). Dropped under a 10-week window.
      mkRow({
        completed_at: "2026-03-02T10:00:00Z",
        weight: "80",
        reps: 5,
        exercise_id: "bench",
        session_id: "s-old",
        started_at: "2026-03-02T09:00:00Z",
      }),
      // In-window (W21): a HIGHER e1RM (120×5).
      mkRow({
        completed_at: "2026-05-18T10:00:00Z",
        weight: "120",
        reps: 5,
        exercise_id: "bench",
        session_id: "s-new",
        started_at: "2026-05-18T09:00:00Z",
      }),
    ];
    const exercises = [mkExercise({ id: "bench", name: "Bench Press" })];

    const windowed = presentTopExerciseE1rm({
      rows,
      exercises,
      windowStartMs: computeWindowStart(10, NOW),
      now: NOW,
    });

    const values = windowed.series[0]!.values;
    const inWindow = epley1RM(120, 5);
    const dropped = epley1RM(80, 5);
    // The flat lead-in (values[0]) uses the first IN-WINDOW real value, NOT the
    // dropped pre-window 80×5.
    expect(values[0]!).toBeCloseTo(inWindow);
    expect(values[0]!).not.toBeCloseTo(dropped);
    // The last (current) week also holds the in-window value.
    expect(values.at(-1)!).toBeCloseTo(inWindow);
  });
});

/**
 * Favorites union — the top-N-OVERALL ∪ favorites selection (design-v2 §A).
 *
 * The auto-selection is the top-N OVERALL (byte-for-byte today's
 * `sorted.slice(0, topN)`). Favorites are unioned with it and deduped by
 * construction: a favorite already in the top-N is a no-op; a favorite outside
 * adds exactly one line. Total capped at E1RM_MAX_LINES, dropping the lowest
 * NON-favorites first (favorites guaranteed visible).
 *
 * Seed helper: N distinct WEIGHTED exercises whose distinct-session COUNT is
 * strictly decreasing by id index, so the comparator (sessions DESC, then
 * recency, then name, then id) puts them in a known order `[ex-00, ex-01, …]`.
 * Each exercise's sessions all sit in the same ISO week as NOW so the axis is
 * a single week — keeps the values trivial and the ranking driven purely by
 * distinct-session count.
 */
function seedWeightedByDecreasingSessions(count: number): {
  rows: WeeklyVolumeRow[];
  exercises: ExerciseRow[];
  ids: string[];
} {
  const rows: WeeklyVolumeRow[] = [];
  const exercises: ExerciseRow[] = [];
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = `ex-${String(i).padStart(2, "0")}`;
    ids.push(id);
    // Strictly decreasing distinct-session count: the highest-index exercise
    // still has ≥1 session. count - i sessions for index i.
    const sessions = count - i;
    for (let s = 0; s < sessions; s++) {
      rows.push(
        mkRow({
          // All within ISO week 2026-W21 (Mon 5/18) — single-week axis.
          completed_at: `2026-05-18T${String(6 + s).padStart(2, "0")}:00:00Z`,
          weight: "100",
          reps: 5,
          exercise_id: id,
          session_id: `${id}-s${s}`,
        }),
      );
    }
    exercises.push(mkExercise({ id, name: `Ex ${id}` }));
  }
  return { rows, exercises, ids };
}

describe("presentTopExerciseE1rm — favorites union (top-N OVERALL ∪ favorites)", () => {
  // 1. Favorite OUTSIDE the top-N is ADDED (count grows by exactly 1).
  it("adds a favorite that sits OUTSIDE the top-N (+1 line, appended last)", () => {
    // 6 eligible, sorted [ex-00..ex-05]; topN=5 → top-5 = ex-00..ex-04.
    // ex-05 is outside. Favorite it.
    const { rows, exercises, ids } = seedWeightedByDecreasingSessions(6);
    const target = ids[5]!; // outside top-5
    const model = presentTopExerciseE1rm({
      rows,
      exercises,
      topN: 5,
      favoriteExerciseIds: new Set([target]),
      now: NOW,
    });

    expect(model.series).toHaveLength(6); // topN + 1
    const seriesIds = model.series.map((s) => s.id);
    // The original top-5 are all present with ranks 0..4 unchanged.
    expect(seriesIds.slice(0, 5)).toEqual(ids.slice(0, 5));
    // The favorite is appended LAST (rank 5).
    expect(seriesIds[5]).toBe(target);
    expect(model.series[5]!.rank).toBe(5);
  });

  // 2. Favorite already INSIDE the top-N → SAME count, id once, byte-identical.
  it("is a NO-OP when the favorite is already in the top-N (count unchanged, byte-identical)", () => {
    const { rows, exercises, ids } = seedWeightedByDecreasingSessions(6);
    const insideTopN = ids[2]!; // ex-02 — a top-3, inside top-5.
    const withFav = presentTopExerciseE1rm({
      rows,
      exercises,
      topN: 5,
      favoriteExerciseIds: new Set([insideTopN]),
      now: NOW,
    });
    const noFav = presentTopExerciseE1rm({
      rows,
      exercises,
      topN: 5,
      now: NOW,
    });

    // Count UNCHANGED — no promotion of a hidden non-favorite.
    expect(withFav.series).toHaveLength(5);
    // The favorite id appears exactly once.
    expect(withFav.series.filter((s) => s.id === insideTopN)).toHaveLength(1);
    // Byte-identical to the no-favorites output (the MAJ-1 fix).
    expect(withFav.series).toEqual(noFav.series);
  });

  // 3. Bodyweight-only favorite excluded (Invariant D survives the union).
  it("excludes a favorited bodyweight-only exercise (Invariant D)", () => {
    const rows = [
      // Favorited bodyweight-only (all weight=0) — can't plot.
      mkRow({
        completed_at: "2026-05-18T10:00:00Z",
        weight: "0",
        reps: 12,
        exercise_id: "bwfav",
        equipment: "bodyweight",
        session_id: "bw1",
      }),
      // A weighted exercise so the section isn't empty.
      mkRow({
        completed_at: "2026-05-18T10:00:00Z",
        weight: "100",
        reps: 5,
        exercise_id: "bench",
        session_id: "b1",
      }),
    ];
    const exercises = [
      mkExercise({ id: "bwfav", name: "BW Fav", equipment: "bodyweight" }),
      mkExercise({ id: "bench", name: "Bench Press" }),
    ];
    const model = presentTopExerciseE1rm({
      rows,
      exercises,
      favoriteExerciseIds: new Set(["bwfav"]),
      now: NOW,
    });

    // The favorited bodyweight-only exercise never entered byExercise → absent.
    expect(model.series.map((s) => s.id)).toEqual(["bench"]);
    expect(model.series.some((s) => s.id === "bwfav")).toBe(false);
  });

  // 4. No-set favorite excluded (favorite id with NO rows at all).
  it("excludes a favorited exercise that has no rows at all", () => {
    const rows = [
      mkRow({
        completed_at: "2026-05-18T10:00:00Z",
        weight: "100",
        reps: 5,
        exercise_id: "bench",
        session_id: "b1",
      }),
    ];
    const exercises = [
      mkExercise({ id: "bench", name: "Bench Press" }),
      mkExercise({ id: "ghostfav", name: "Ghost Fav" }),
    ];
    const model = presentTopExerciseE1rm({
      rows,
      exercises,
      favoriteExerciseIds: new Set(["ghostfav"]),
      now: NOW,
    });

    expect(model.series.map((s) => s.id)).toEqual(["bench"]);
  });

  // 5. Cap drops the lowest NON-favorite, not a favorite (over the ceiling).
  it("drops the lowest-ranked NON-favorite auto pick when over the ceiling, keeps all favorites", () => {
    // 13 eligible [ex-00..ex-12]; topN=5 → top-5 = ex-00..ex-04.
    // Favorite the 8 lowest outside-top-5 (ex-05..ex-12) PLUS ex-04 (in top-5).
    const { rows, exercises, ids } = seedWeightedByDecreasingSessions(13);
    const outsideFavs = ids.slice(5); // ex-05..ex-12 (8 items, all outside)
    const insideFav = ids[4]!; // ex-04 — inside top-5, must be a no-op
    const model = presentTopExerciseE1rm({
      rows,
      exercises,
      topN: 5,
      favoriteExerciseIds: new Set([...outsideFavs, insideFav]),
      now: NOW,
    });

    expect(model.series).toHaveLength(12); // E1RM_MAX_LINES
    const seriesIds = model.series.map((s) => s.id);
    // All 8 outside favorites are present.
    for (const f of outsideFavs) expect(seriesIds).toContain(f);
    // ex-04 (the lowest-ranked NON-favorite auto pick) is DROPPED.
    expect(seriesIds).not.toContain(ids[4]);
    // ex-00..ex-03 (the kept auto picks) are present.
    for (const a of ids.slice(0, 4)) expect(seriesIds).toContain(a);
  });

  // 6. Dense ranks over the combined list.
  it("produces dense 0-based ranks over the combined list (no gaps / dup index)", () => {
    // 6-series case (1 outside favorite).
    {
      const { rows, exercises, ids } = seedWeightedByDecreasingSessions(6);
      const model = presentTopExerciseE1rm({
        rows,
        exercises,
        topN: 5,
        favoriteExerciseIds: new Set([ids[5]!]),
        now: NOW,
      });
      expect(model.series.map((s) => s.rank)).toEqual([0, 1, 2, 3, 4, 5]);
    }
    // 12-series case (over the ceiling, trimmed to 12).
    {
      const { rows, exercises, ids } = seedWeightedByDecreasingSessions(13);
      const model = presentTopExerciseE1rm({
        rows,
        exercises,
        topN: 5,
        favoriteExerciseIds: new Set(ids.slice(5)),
        now: NOW,
      });
      expect(model.series.map((s) => s.rank)).toEqual([
        0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
      ]);
    }
  });

  // 7. Determinism — favorite-set insertion order does not affect series order.
  it("is deterministic regardless of favorite-set insertion order", () => {
    const { rows, exercises, ids } = seedWeightedByDecreasingSessions(6);
    const f1 = ids[5]!; // outside top-5
    const f2 = ids[4]!; // inside top-5 (no-op)
    const a = presentTopExerciseE1rm({
      rows,
      exercises,
      topN: 5,
      favoriteExerciseIds: new Set([f1, f2]),
      now: NOW,
    });
    const b = presentTopExerciseE1rm({
      rows,
      exercises,
      topN: 5,
      favoriteExerciseIds: new Set([f2, f1]),
      now: NOW,
    });
    expect(a.series.map((s) => s.id)).toEqual(b.series.map((s) => s.id));
  });

  // 8. Empty / absent favorites = current output (Invariant F — byte-for-byte).
  it("Invariant F: no-arg, empty-Set, and pre-change top-N output are all deep-equal", () => {
    const { rows, exercises, ids } = seedWeightedByDecreasingSessions(8);
    const noArg = presentTopExerciseE1rm({ rows, exercises, topN: 5, now: NOW });
    const emptySet = presentTopExerciseE1rm({
      rows,
      exercises,
      topN: 5,
      favoriteExerciseIds: new Set(),
      now: NOW,
    });

    // No-arg and empty-Set produce DEEP-EQUAL output.
    expect(noArg).toEqual(emptySet);
    // And that output equals the pre-change top-N selection: exactly the
    // top-5 by the comparator (ex-00..ex-04), ranks 0..4, no extras.
    expect(noArg.series.map((s) => s.id)).toEqual(ids.slice(0, 5));
    expect(noArg.series.map((s) => s.rank)).toEqual([0, 1, 2, 3, 4]);
    expect(noArg.series).toHaveLength(5);
  });

  // 9. Exactly AT the ceiling → no trim.
  it("plots exactly E1RM_MAX_LINES with no trim when at the ceiling", () => {
    // 12 eligible [ex-00..ex-11]; topN=5. Favorite the 7 lowest outside-top-5
    // (ex-05..ex-11). selected.length = 5 + 7 = 12 = ceiling → no trim.
    const { rows, exercises, ids } = seedWeightedByDecreasingSessions(12);
    const model = presentTopExerciseE1rm({
      rows,
      exercises,
      topN: 5,
      favoriteExerciseIds: new Set(ids.slice(5)),
      now: NOW,
    });

    expect(model.series).toHaveLength(12);
    // ALL of ex-00..ex-11 present (nothing dropped).
    const seriesIds = model.series.map((s) => s.id);
    for (const id of ids) expect(seriesIds).toContain(id);
    expect(model.series.map((s) => s.rank)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    ]);
  });

  // 10. One OVER the ceiling → trims exactly one (lowest) non-favorite.
  it("trims exactly one (lowest) non-favorite when one over the ceiling", () => {
    // 13 eligible; topN=5. Favorite the 8 lowest outside-top-5 (ex-05..ex-12).
    // selected.length = 5 + 8 = 13 > 12 → keptAuto = slice(0, 12-8) = [00..03];
    // ex-04 (the single lowest auto pick) dropped.
    const { rows, exercises, ids } = seedWeightedByDecreasingSessions(13);
    const outsideFavs = ids.slice(5); // ex-05..ex-12
    const model = presentTopExerciseE1rm({
      rows,
      exercises,
      topN: 5,
      favoriteExerciseIds: new Set(outsideFavs),
      now: NOW,
    });

    expect(model.series).toHaveLength(12);
    const seriesIds = model.series.map((s) => s.id);
    // ex-04 dropped; ex-00..ex-03 kept; all 8 favorites kept.
    expect(seriesIds).not.toContain(ids[4]);
    for (const a of ids.slice(0, 4)) expect(seriesIds).toContain(a);
    for (const f of outsideFavs) expect(seriesIds).toContain(f);
  });

  // 11. Degenerate: favorites > ceiling → favorites themselves trimmed.
  it("trims the lowest favorites when favorites alone exceed the ceiling (zero auto survive)", () => {
    // 5 high-session non-favorites (ex-00..ex-04) + 13 low-session favorites.
    // Build so the 5 auto picks are the highest-session, and 13 favorites are
    // all strictly lower-session (hence all outside top-5).
    const rows: WeeklyVolumeRow[] = [];
    const exercises: ExerciseRow[] = [];
    const autoIds: string[] = [];
    const favIds: string[] = [];
    // 5 non-favorites with high session counts (100, 99, …, 96).
    for (let i = 0; i < 5; i++) {
      const id = `auto-${String(i).padStart(2, "0")}`;
      autoIds.push(id);
      const sessions = 100 - i;
      for (let s = 0; s < sessions; s++) {
        rows.push(
          mkRow({
            completed_at: `2026-05-18T${String(1 + (s % 20)).padStart(2, "0")}:00:00Z`,
            weight: "100",
            reps: 5,
            exercise_id: id,
            session_id: `${id}-s${s}`,
          }),
        );
      }
      exercises.push(mkExercise({ id, name: `Auto ${id}` }));
    }
    // 13 favorites with strictly-lower decreasing session counts (13..1) so
    // they have a deterministic comparator order; all below the auto picks.
    for (let i = 0; i < 13; i++) {
      const id = `fav-${String(i).padStart(2, "0")}`;
      favIds.push(id);
      const sessions = 13 - i;
      for (let s = 0; s < sessions; s++) {
        rows.push(
          mkRow({
            completed_at: `2026-05-18T${String(1 + (s % 20)).padStart(2, "0")}:30:00Z`,
            weight: "100",
            reps: 5,
            exercise_id: id,
            session_id: `${id}-s${s}`,
          }),
        );
      }
      exercises.push(mkExercise({ id, name: `Fav ${id}` }));
    }
    const model = presentTopExerciseE1rm({
      rows,
      exercises,
      topN: 5,
      favoriteExerciseIds: new Set(favIds),
      now: NOW,
    });

    expect(model.series).toHaveLength(12);
    const seriesIds = model.series.map((s) => s.id);
    // ALL kept lines are favorites; zero auto picks survive.
    for (const id of seriesIds) expect(id.startsWith("fav-")).toBe(true);
    for (const a of autoIds) expect(seriesIds).not.toContain(a);
    // The 13th-lowest-comparator favorite (fav-12, fewest sessions) is dropped.
    expect(seriesIds).not.toContain("fav-12");
    // The 12 highest-comparator favorites (fav-00..fav-11) are kept.
    for (let i = 0; i < 12; i++) {
      expect(seriesIds).toContain(`fav-${String(i).padStart(2, "0")}`);
    }
  });
});
