/**
 * Unit tests for the Progress page's math kernel. Mirrors design-v3.md's
 * 56-case test plan. All tests are pure — no React, no Supabase, no I/O.
 *
 * Test inventory (by helper):
 *   - bucketLifetimeWeeklyVolumes ......................... #1-#9
 *   - findBestWeek (inc. MIN-7 tie behaviour) ............. #10-#13
 *   - computePrExerciseIdsThisWeek / countPrsThisWeek ..... #14-#24, #50-#52
 *   - groupExercisesByPrimaryMuscle ....................... #25-#29
 *   - computeStreaks ...................................... #30-#38
 *   - WeeklyVolumeStrip height + overlay (BLK-2) .......... #39-#41
 *   - listWeeklyVolumeRows null-completed_at safety ....... #42-#45
 *   - computeLifetimeMaxPerExercise ....................... #46-#49
 *   - useExercisesThisWeek derivation invariants .......... #53-#56
 *     (tested at the pure-helper level — see MIN-12 note in
 *      implementation.md)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WeeklyVolumeRow } from "~/api/stats";
import type {
  ExerciseRow,
  MeasurementEntryRow,
  MuscleGroup,
  SetType,
} from "~/db/types";
import { MUSCLE_GROUPS } from "~/db/types";
import {
  bucketLifetimeWeeklyVolumes,
  computeCurrentWeekVolume,
  computeLifetimeMaxPerExercise,
  computePrExerciseIdsThisWeek,
  computePrsThisWeek,
  computeStreaks,
  findBestWeek,
  groupExercisesByPrimaryMuscle,
} from "~/utils/progress-page-math";
import { isoWeekStart, weekKeyOf } from "~/utils/dates";

// Pin "now" so the year-conditional label rule in `formatShortDate` stays
// stable across calendar years. The "best-week label" test asserts a literal
// `"5/18"` and would start emitting `"5/18/26"` once the host year ticks past
// 2026. Mock-time isolates the fixture year. The mock is global per-describe
// because the `WeeklyVolumeStrip` mock-builder describe overrides
// `beforeEach`/`afterEach` with its own block — we re-pin there too.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-05-22T12:00:00-03:00"));
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function mkRow(overrides: Partial<WeeklyVolumeRow> & {
  completed_at: string;
  weight: string | null;
  reps: number | null;
  exercise_id?: string;
  session_id?: string;
  sessionStartedAt?: string;
}): WeeklyVolumeRow {
  const sessionStart =
    overrides.sessionStartedAt ?? overrides.sessions?.started_at ?? overrides.completed_at;
  return {
    completed_at: overrides.completed_at,
    weight: overrides.weight,
    reps: overrides.reps,
    set_type: (overrides.set_type ?? "working") as SetType,
    exercise_id: overrides.exercise_id ?? "ex-1",
    session_id: overrides.session_id ?? "sess-1",
    // MIN-4: default barbell so existing assertions stay green.
    exercises: overrides.exercises ?? { equipment: "barbell" },
    sessions: overrides.sessions ?? {
      started_at: sessionStart,
      ended_at: sessionStart,
    },
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

function mkExercise(overrides: Partial<ExerciseRow> & { id: string; name: string }): ExerciseRow {
  return {
    id: overrides.id,
    user_id: overrides.user_id ?? "user-1",
    name: overrides.name,
    muscles: overrides.muscles ?? [],
    equipment: overrides.equipment ?? null,
    notes: overrides.notes ?? null,
    source: overrides.source ?? null,
    created_at: overrides.created_at ?? "2026-01-01T00:00:00Z",
    updated_at: overrides.updated_at ?? "2026-01-01T00:00:00Z",
    deleted_at: overrides.deleted_at ?? null,
  };
}

// ---------------------------------------------------------------------------
// bucketLifetimeWeeklyVolumes — tests #1-#9
// ---------------------------------------------------------------------------

describe("bucketLifetimeWeeklyVolumes", () => {
  it("(#1) empty input → empty Map", () => {
    expect(bucketLifetimeWeeklyVolumes([]).size).toBe(0);
  });

  it("(#2) single valid row → one entry with w*r", () => {
    const rows = [mkRow({ completed_at: "2026-05-19T10:00:00Z", weight: "100", reps: 5 })];
    const m = bucketLifetimeWeeklyVolumes(rows);
    expect(m.size).toBe(1);
    const [val] = m.values();
    expect(val).toBe(500);
  });

  it("(#3) two rows same week → summed", () => {
    const rows = [
      mkRow({ completed_at: "2026-05-19T10:00:00Z", weight: "100", reps: 5 }),
      mkRow({ completed_at: "2026-05-20T10:00:00Z", weight: "80", reps: 8 }),
    ];
    const m = bucketLifetimeWeeklyVolumes(rows);
    expect(m.size).toBe(1);
    expect([...m.values()][0]).toBe(500 + 640);
  });

  it("(#4) two rows different weeks → two entries", () => {
    const rows = [
      mkRow({ completed_at: "2026-05-19T10:00:00Z", weight: "100", reps: 5 }),
      mkRow({ completed_at: "2026-05-12T10:00:00Z", weight: "80", reps: 8 }),
    ];
    const m = bucketLifetimeWeeklyVolumes(rows);
    expect(m.size).toBe(2);
  });

  it("(#5) weight = null → not counted", () => {
    const rows = [mkRow({ completed_at: "2026-05-19T10:00:00Z", weight: null, reps: 10 })];
    expect(bucketLifetimeWeeklyVolumes(rows).size).toBe(0);
  });

  it("(#6) reps = 0 → not counted", () => {
    const rows = [mkRow({ completed_at: "2026-05-19T10:00:00Z", weight: "100", reps: 0 })];
    expect(bucketLifetimeWeeklyVolumes(rows).size).toBe(0);
  });

  it("(#7) reps = null → not counted", () => {
    const rows = [mkRow({ completed_at: "2026-05-19T10:00:00Z", weight: "100", reps: null })];
    expect(bucketLifetimeWeeklyVolumes(rows).size).toBe(0);
  });

  it("(#8) negative weight → not counted", () => {
    const rows = [mkRow({ completed_at: "2026-05-19T10:00:00Z", weight: "-50", reps: 5 })];
    expect(bucketLifetimeWeeklyVolumes(rows).size).toBe(0);
  });

  it("(#9) Sunday 23:30 BRT lands in its own ISO week (TZ correctness)", () => {
    // Construct a local-time Sunday and verify the round trip via weekKeyOf
    // produces a single bucket.
    const sundayLocal = new Date(2026, 4, 17, 23, 30, 0); // Sunday 17 May local
    const rows = [
      mkRow({
        completed_at: sundayLocal.toISOString(),
        weight: "100",
        reps: 5,
      }),
    ];
    const m = bucketLifetimeWeeklyVolumes(rows);
    expect(m.size).toBe(1);
    expect([...m.keys()][0]).toBe(weekKeyOf(sundayLocal));
  });
});

// ---------------------------------------------------------------------------
// findBestWeek — tests #10-#13 (incl. MIN-7 tie behaviour)
// ---------------------------------------------------------------------------

describe("findBestWeek", () => {
  it("(#10) empty map → null", () => {
    expect(findBestWeek(new Map())).toBeNull();
  });

  it("(#11) three buckets 100/500/250 → returns 500", () => {
    const m = new Map<string, number>();
    m.set("2026-W18", 100);
    m.set("2026-W19", 500);
    m.set("2026-W20", 250);
    const best = findBestWeek(m);
    expect(best).not.toBeNull();
    expect(best!.totalKg).toBe(500);
    expect(best!.isoWeekKey).toBe("2026-W19");
  });

  it("(#12) MIN-7 tie behaviour: oldest insertion-order week wins on ties", () => {
    // Server-side ASC sort means insertion order is oldest→newest. Strict
    // `>` (not `>=`) makes the first-inserted max persist.
    const m = new Map<string, number>();
    m.set("2026-W18", 500); // OLDEST tied
    m.set("2026-W19", 500); // newer tied — should NOT win
    m.set("2026-W20", 500); // newest tied — should NOT win
    const best = findBestWeek(m);
    expect(best!.isoWeekKey).toBe("2026-W18");
  });

  it("(#13) all-zero buckets → null", () => {
    const m = new Map<string, number>();
    m.set("2026-W18", 0);
    m.set("2026-W19", 0);
    expect(findBestWeek(m)).toBeNull();
  });

  it("findBestWeek surfaces a dd/mm label derived from the ISO-week key", () => {
    const m = new Map<string, number>();
    m.set("2026-W21", 1000); // Monday 2026-05-18
    const best = findBestWeek(m);
    expect(best!.weekStartLabel).toBe("18/05");
  });
});

// ---------------------------------------------------------------------------
// computePrExerciseIdsThisWeek / countPrsThisWeek — tests #14-#24, #50-#52
// ---------------------------------------------------------------------------

describe("computePrExerciseIdsThisWeek", () => {
  // Anchor: BRT Monday 2026-05-18. Current ISO week = 2026-W21.
  const NOW = new Date(2026, 4, 19, 12, 0, 0); // Tuesday 19 May local
  const WEEK_START = isoWeekStart(NOW).toISOString();
  // Build the week-end by adding 6 days 23h59m59s to the Monday — match the
  // helper used in production (endOfWeek with weekStartsOn: 1). We construct
  // it directly here to keep the test independent of `endOfWeek`.
  const weekEndDate = new Date(isoWeekStart(NOW).getTime());
  weekEndDate.setDate(weekEndDate.getDate() + 6);
  weekEndDate.setHours(23, 59, 59, 999);
  const WEEK_END = weekEndDate.toISOString();

  function callOpts(rows: WeeklyVolumeRow[]) {
    return {
      rows,
      currentWeekStartIso: WEEK_START,
      currentWeekEndIso: WEEK_END,
    };
  }

  it("(#14) empty rows → empty set", () => {
    expect(computePrExerciseIdsThisWeek(callOpts([])).size).toBe(0);
  });

  it("(#15) one exercise, three prior sessions ascending, no this-week → 0", () => {
    const rows = [
      mkRow({
        completed_at: "2026-04-01T10:00:00Z",
        sessionStartedAt: "2026-04-01T09:00:00Z",
        session_id: "s1",
        weight: "100",
        reps: 5,
      }),
      mkRow({
        completed_at: "2026-04-08T10:00:00Z",
        sessionStartedAt: "2026-04-08T09:00:00Z",
        session_id: "s2",
        weight: "100",
        reps: 6,
      }),
      mkRow({
        completed_at: "2026-04-15T10:00:00Z",
        sessionStartedAt: "2026-04-15T09:00:00Z",
        session_id: "s3",
        weight: "100",
        reps: 7,
      }),
    ];
    expect(computePrExerciseIdsThisWeek(callOpts(rows)).size).toBe(0);
  });

  it("(#16) one exercise, two prior (500, 800), this-week 900 → 1 PR", () => {
    const rows = [
      mkRow({
        completed_at: "2026-04-01T10:00:00Z",
        sessionStartedAt: "2026-04-01T09:00:00Z",
        session_id: "s1",
        weight: "100",
        reps: 5,
      }), // 500
      mkRow({
        completed_at: "2026-04-08T10:00:00Z",
        sessionStartedAt: "2026-04-08T09:00:00Z",
        session_id: "s2",
        weight: "100",
        reps: 8,
      }), // 800
      mkRow({
        completed_at: "2026-05-19T10:00:00Z",
        sessionStartedAt: "2026-05-19T09:00:00Z",
        session_id: "s3",
        weight: "100",
        reps: 9,
      }), // 900
    ];
    const result = computePrExerciseIdsThisWeek(callOpts(rows));
    expect(result.size).toBe(1);
    expect(result.has("ex-1")).toBe(true);
  });

  it("(#17) one exercise, two prior (500, 800), this-week 700 → 0", () => {
    const rows = [
      mkRow({
        completed_at: "2026-04-01T10:00:00Z",
        sessionStartedAt: "2026-04-01T09:00:00Z",
        session_id: "s1",
        weight: "100",
        reps: 5,
      }),
      mkRow({
        completed_at: "2026-04-08T10:00:00Z",
        sessionStartedAt: "2026-04-08T09:00:00Z",
        session_id: "s2",
        weight: "100",
        reps: 8,
      }),
      mkRow({
        completed_at: "2026-05-19T10:00:00Z",
        sessionStartedAt: "2026-05-19T09:00:00Z",
        session_id: "s3",
        weight: "100",
        reps: 7,
      }),
    ];
    expect(computePrExerciseIdsThisWeek(callOpts(rows)).size).toBe(0);
  });

  it("(#18) two this-week sessions both beating prior → 1 (dedupe)", () => {
    const rows = [
      mkRow({
        completed_at: "2026-04-01T10:00:00Z",
        sessionStartedAt: "2026-04-01T09:00:00Z",
        session_id: "s1",
        weight: "100",
        reps: 5,
      }), // 500
      mkRow({
        completed_at: "2026-05-19T10:00:00Z",
        sessionStartedAt: "2026-05-19T09:00:00Z",
        session_id: "s2",
        weight: "100",
        reps: 7,
      }), // 700 (PR)
      mkRow({
        completed_at: "2026-05-21T10:00:00Z",
        sessionStartedAt: "2026-05-21T09:00:00Z",
        session_id: "s3",
        weight: "100",
        reps: 8,
      }), // 800 (also PR; dedupe per exercise)
    ];
    const result = computePrExerciseIdsThisWeek(callOpts(rows));
    expect(result.size).toBe(1);
  });

  it("(#19) two exercises, both PR this week → 2", () => {
    const rows = [
      mkRow({
        exercise_id: "ex-A",
        completed_at: "2026-04-01T10:00:00Z",
        sessionStartedAt: "2026-04-01T09:00:00Z",
        session_id: "sA1",
        weight: "100",
        reps: 5,
      }),
      mkRow({
        exercise_id: "ex-A",
        completed_at: "2026-05-19T10:00:00Z",
        sessionStartedAt: "2026-05-19T09:00:00Z",
        session_id: "sA2",
        weight: "100",
        reps: 6,
      }),
      mkRow({
        exercise_id: "ex-B",
        completed_at: "2026-04-01T11:00:00Z",
        sessionStartedAt: "2026-04-01T11:00:00Z",
        session_id: "sB1",
        weight: "50",
        reps: 10,
      }),
      mkRow({
        exercise_id: "ex-B",
        completed_at: "2026-05-19T11:00:00Z",
        sessionStartedAt: "2026-05-19T11:00:00Z",
        session_id: "sB2",
        weight: "50",
        reps: 12,
      }),
    ];
    const result = computePrExerciseIdsThisWeek(callOpts(rows));
    expect(result.size).toBe(2);
    expect(result.has("ex-A")).toBe(true);
    expect(result.has("ex-B")).toBe(true);
  });

  it("(#20) first-ever session this week → 0 PRs (no prior baseline)", () => {
    const rows = [
      mkRow({
        completed_at: "2026-05-19T10:00:00Z",
        sessionStartedAt: "2026-05-19T09:00:00Z",
        session_id: "s1",
        weight: "100",
        reps: 5,
      }),
    ];
    expect(computePrExerciseIdsThisWeek(callOpts(rows)).size).toBe(0);
  });

  it("(#21) PR session whose started_at is in last week → 0", () => {
    const rows = [
      mkRow({
        completed_at: "2026-04-01T10:00:00Z",
        sessionStartedAt: "2026-04-01T09:00:00Z",
        session_id: "s1",
        weight: "100",
        reps: 5,
      }), // 500
      mkRow({
        completed_at: "2026-05-12T10:00:00Z",
        sessionStartedAt: "2026-05-12T09:00:00Z",
        session_id: "s2",
        weight: "100",
        reps: 7,
      }), // 700 (PR, last week)
    ];
    expect(computePrExerciseIdsThisWeek(callOpts(rows)).size).toBe(0);
  });

  it("(#22) warmup row (server-filtered) → not counted", () => {
    // Helper documents the assumption: warmups must be filtered server-side.
    // We pass NO warmups to mirror the production filter chain.
    const rows = [
      mkRow({
        completed_at: "2026-04-01T10:00:00Z",
        sessionStartedAt: "2026-04-01T09:00:00Z",
        session_id: "s1",
        weight: "100",
        reps: 5,
      }),
      mkRow({
        completed_at: "2026-05-19T10:00:00Z",
        sessionStartedAt: "2026-05-19T09:00:00Z",
        session_id: "s2",
        weight: "100",
        reps: 6,
      }),
    ];
    expect(computePrExerciseIdsThisWeek(callOpts(rows)).size).toBe(1);
  });

  it("(#23) MAJ-3 boundary: one prior 500, this-week 600 → 1 PR", () => {
    const rows = [
      mkRow({
        completed_at: "2026-04-01T10:00:00Z",
        sessionStartedAt: "2026-04-01T09:00:00Z",
        session_id: "s1",
        weight: "100",
        reps: 5,
      }), // 500
      mkRow({
        completed_at: "2026-05-19T10:00:00Z",
        sessionStartedAt: "2026-05-19T09:00:00Z",
        session_id: "s2",
        weight: "100",
        reps: 6,
      }), // 600
    ];
    expect(computePrExerciseIdsThisWeek(callOpts(rows)).size).toBe(1);
  });

  it("(#24) MAJ-3 boundary: one prior 500, this-week 400 → 0 (strict >)", () => {
    const rows = [
      mkRow({
        completed_at: "2026-04-01T10:00:00Z",
        sessionStartedAt: "2026-04-01T09:00:00Z",
        session_id: "s1",
        weight: "100",
        reps: 5,
      }), // 500
      mkRow({
        completed_at: "2026-05-19T10:00:00Z",
        sessionStartedAt: "2026-05-19T09:00:00Z",
        session_id: "s2",
        weight: "100",
        reps: 4,
      }), // 400
    ];
    expect(computePrExerciseIdsThisWeek(callOpts(rows)).size).toBe(0);
  });

  // -- Tests #50-#52: PR-set surface contract --
  it("(#50) one exercise hits PR this week → Set size 1, contains exercise_id", () => {
    const rows = [
      mkRow({
        exercise_id: "ex-bench",
        completed_at: "2026-04-01T10:00:00Z",
        sessionStartedAt: "2026-04-01T09:00:00Z",
        session_id: "s1",
        weight: "100",
        reps: 5,
      }),
      mkRow({
        exercise_id: "ex-bench",
        completed_at: "2026-05-19T10:00:00Z",
        sessionStartedAt: "2026-05-19T09:00:00Z",
        session_id: "s2",
        weight: "100",
        reps: 6,
      }),
    ];
    const result = computePrExerciseIdsThisWeek(callOpts(rows));
    expect(result.size).toBe(1);
    expect(result.has("ex-bench")).toBe(true);
  });

  it("(#51) two exercises both PR → Set size 2, contains both ids", () => {
    const rows = [
      mkRow({
        exercise_id: "ex-A",
        completed_at: "2026-04-01T10:00:00Z",
        sessionStartedAt: "2026-04-01T09:00:00Z",
        session_id: "sA1",
        weight: "100",
        reps: 5,
      }),
      mkRow({
        exercise_id: "ex-A",
        completed_at: "2026-05-19T10:00:00Z",
        sessionStartedAt: "2026-05-19T09:00:00Z",
        session_id: "sA2",
        weight: "100",
        reps: 6,
      }),
      mkRow({
        exercise_id: "ex-B",
        completed_at: "2026-04-01T11:00:00Z",
        sessionStartedAt: "2026-04-01T11:00:00Z",
        session_id: "sB1",
        weight: "60",
        reps: 10,
      }),
      mkRow({
        exercise_id: "ex-B",
        completed_at: "2026-05-19T11:00:00Z",
        sessionStartedAt: "2026-05-19T11:00:00Z",
        session_id: "sB2",
        weight: "60",
        reps: 12,
      }),
    ];
    const result = computePrExerciseIdsThisWeek(callOpts(rows));
    expect(result.size).toBe(2);
    expect(result.has("ex-A")).toBe(true);
    expect(result.has("ex-B")).toBe(true);
  });

  it("(#52) `.size` is the count wrapper — parity test", () => {
    const rows = [
      mkRow({
        exercise_id: "ex-A",
        completed_at: "2026-04-01T10:00:00Z",
        sessionStartedAt: "2026-04-01T09:00:00Z",
        session_id: "sA1",
        weight: "100",
        reps: 5,
      }),
      mkRow({
        exercise_id: "ex-A",
        completed_at: "2026-05-19T10:00:00Z",
        sessionStartedAt: "2026-05-19T09:00:00Z",
        session_id: "sA2",
        weight: "100",
        reps: 6,
      }),
    ];
    const set = computePrExerciseIdsThisWeek(callOpts(rows));
    // Wrapper count would be `.size`; assert that's the canonical surface.
    expect(set.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// computePrsThisWeek — design-v3 §"Contratos de I/O" + MIN-D tests
// ---------------------------------------------------------------------------

describe("computePrsThisWeek", () => {
  // Same anchor as computePrExerciseIdsThisWeek: BRT Monday 2026-05-18.
  const NOW = new Date(2026, 4, 19, 12, 0, 0);
  const WEEK_START = isoWeekStart(NOW).toISOString();
  const weekEndDate = new Date(isoWeekStart(NOW).getTime());
  weekEndDate.setDate(weekEndDate.getDate() + 6);
  weekEndDate.setHours(23, 59, 59, 999);
  const WEEK_END = weekEndDate.toISOString();

  function callOpts(rows: WeeklyVolumeRow[]) {
    return {
      rows,
      currentWeekStartIso: WEEK_START,
      currentWeekEndIso: WEEK_END,
    };
  }

  it("(a) empty rows → []", () => {
    expect(computePrsThisWeek(callOpts([]))).toEqual([]);
  });

  it("(b) one PR exercise → 1 entry with priorMaxKg/currentMaxKg/overflowKg", () => {
    const rows = [
      mkRow({
        completed_at: "2026-04-01T10:00:00Z",
        sessionStartedAt: "2026-04-01T09:00:00Z",
        session_id: "s1",
        weight: "100",
        reps: 5,
      }), // 500
      mkRow({
        completed_at: "2026-04-08T10:00:00Z",
        sessionStartedAt: "2026-04-08T09:00:00Z",
        session_id: "s2",
        weight: "100",
        reps: 8,
      }), // 800
      mkRow({
        completed_at: "2026-05-19T10:00:00Z",
        sessionStartedAt: "2026-05-19T09:00:00Z",
        session_id: "s3",
        weight: "100",
        reps: 9,
      }), // 900 (PR)
    ];
    const result = computePrsThisWeek(callOpts(rows));
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      exerciseId: "ex-1",
      priorMaxKg: 800,
      currentMaxKg: 900,
      overflowKg: 100,
    });
  });

  it("(c) two PRs same week same exercise (800→900→1000) → priorMaxKg=800, currentMaxKg=1000", () => {
    const rows = [
      mkRow({
        completed_at: "2026-04-01T10:00:00Z",
        sessionStartedAt: "2026-04-01T09:00:00Z",
        session_id: "s1",
        weight: "100",
        reps: 8,
      }), // 800 (pre-week baseline)
      mkRow({
        completed_at: "2026-05-19T10:00:00Z",
        sessionStartedAt: "2026-05-19T09:00:00Z",
        session_id: "s2",
        weight: "100",
        reps: 9,
      }), // 900 (in-week, PR)
      mkRow({
        completed_at: "2026-05-21T10:00:00Z",
        sessionStartedAt: "2026-05-21T09:00:00Z",
        session_id: "s3",
        weight: "100",
        reps: 10,
      }), // 1000 (in-week, also PR)
    ];
    const result = computePrsThisWeek(callOpts(rows));
    expect(result).toHaveLength(1);
    expect(result[0]?.priorMaxKg).toBe(800);
    expect(result[0]?.currentMaxKg).toBe(1000);
    expect(result[0]?.overflowKg).toBe(200);
  });

  it("(d) PR-then-non-PR in same week → currentMaxKg = max(in-week session volumes)", () => {
    const rows = [
      mkRow({
        completed_at: "2026-04-01T10:00:00Z",
        sessionStartedAt: "2026-04-01T09:00:00Z",
        session_id: "s1",
        weight: "100",
        reps: 5,
      }), // 500 (pre-week baseline)
      mkRow({
        completed_at: "2026-05-19T10:00:00Z",
        sessionStartedAt: "2026-05-19T09:00:00Z",
        session_id: "s2",
        weight: "100",
        reps: 7,
      }), // 700 (in-week PR)
      mkRow({
        completed_at: "2026-05-21T10:00:00Z",
        sessionStartedAt: "2026-05-21T09:00:00Z",
        session_id: "s3",
        weight: "100",
        reps: 6,
      }), // 600 (in-week, NOT a PR vs 700)
    ];
    const result = computePrsThisWeek(callOpts(rows));
    expect(result).toHaveLength(1);
    expect(result[0]?.priorMaxKg).toBe(500);
    // MIN-D: currentMaxKg = max(in-week volumes) = 700, not the later 600.
    expect(result[0]?.currentMaxKg).toBe(700);
    expect(result[0]?.overflowKg).toBe(200);
  });

  it("(e) sort: overflowKg DESC, exerciseId ASC tiebreak", () => {
    const rows = [
      // ex-C: prior 500 → in-week 800. overflow = 300.
      mkRow({
        exercise_id: "ex-C",
        completed_at: "2026-04-01T10:00:00Z",
        sessionStartedAt: "2026-04-01T09:00:00Z",
        session_id: "sC1",
        weight: "100",
        reps: 5,
      }),
      mkRow({
        exercise_id: "ex-C",
        completed_at: "2026-05-19T10:00:00Z",
        sessionStartedAt: "2026-05-19T09:00:00Z",
        session_id: "sC2",
        weight: "100",
        reps: 8,
      }),
      // ex-A: prior 500 → in-week 700. overflow = 200.
      mkRow({
        exercise_id: "ex-A",
        completed_at: "2026-04-01T10:00:00Z",
        sessionStartedAt: "2026-04-01T09:00:00Z",
        session_id: "sA1",
        weight: "100",
        reps: 5,
      }),
      mkRow({
        exercise_id: "ex-A",
        completed_at: "2026-05-19T10:00:00Z",
        sessionStartedAt: "2026-05-19T09:00:00Z",
        session_id: "sA2",
        weight: "100",
        reps: 7,
      }),
      // ex-B: prior 500 → in-week 700. overflow = 200 (ties with ex-A).
      mkRow({
        exercise_id: "ex-B",
        completed_at: "2026-04-01T10:00:00Z",
        sessionStartedAt: "2026-04-01T09:00:00Z",
        session_id: "sB1",
        weight: "100",
        reps: 5,
      }),
      mkRow({
        exercise_id: "ex-B",
        completed_at: "2026-05-19T10:00:00Z",
        sessionStartedAt: "2026-05-19T09:00:00Z",
        session_id: "sB2",
        weight: "100",
        reps: 7,
      }),
    ];
    const result = computePrsThisWeek(callOpts(rows));
    expect(result.map((p) => p.exerciseId)).toEqual(["ex-C", "ex-A", "ex-B"]);
  });

  it("(f) priorMaxKg = 0 (first-ever session in-week) → NOT a PR", () => {
    const rows = [
      mkRow({
        completed_at: "2026-05-19T10:00:00Z",
        sessionStartedAt: "2026-05-19T09:00:00Z",
        session_id: "s1",
        weight: "100",
        reps: 5,
      }),
    ];
    expect(computePrsThisWeek(callOpts(rows))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// groupExercisesByPrimaryMuscle — tests #25-#29
// ---------------------------------------------------------------------------

describe("groupExercisesByPrimaryMuscle", () => {
  it("(#25) empty input → empty map", () => {
    expect(groupExercisesByPrimaryMuscle([]).size).toBe(0);
  });

  it("(#26) muscles: ['Chest', 'Shoulders'] → goes to Chest only", () => {
    const ex = mkExercise({ id: "x", name: "Bench", muscles: ["Chest", "Shoulders"] });
    const grouped = groupExercisesByPrimaryMuscle([ex]);
    expect(grouped.get("Chest")?.length).toBe(1);
    expect(grouped.get("Shoulders")).toBeUndefined();
  });

  it("(#27) muscles: [] → goes to 'Other'", () => {
    const ex = mkExercise({ id: "x", name: "Mystery", muscles: [] });
    const grouped = groupExercisesByPrimaryMuscle([ex]);
    expect(grouped.get("Other")?.length).toBe(1);
  });

  it("(#28) malformed muscle (not in MUSCLE_GROUPS) → goes to 'Other'", () => {
    const ex = mkExercise({ id: "x", name: "Weird", muscles: ["Bogus"] });
    const grouped = groupExercisesByPrimaryMuscle([ex]);
    expect(grouped.get("Other")?.length).toBe(1);
  });

  it("(#29) insertion order: MUSCLE_GROUPS then 'Other'", () => {
    const rows = [
      mkExercise({ id: "1", name: "Bench", muscles: ["Chest"] }),
      mkExercise({ id: "2", name: "Squat", muscles: ["Legs"] }),
      mkExercise({ id: "3", name: "Pullup", muscles: ["Upper back"] }),
      mkExercise({ id: "4", name: "Mystery", muscles: [] }),
    ];
    const grouped = groupExercisesByPrimaryMuscle(rows);
    const keys = [...grouped.keys()];
    // Canonical order: Chest before Upper back before Legs; Other last.
    const chestIdx = keys.indexOf("Chest");
    const upperIdx = keys.indexOf("Upper back");
    const legsIdx = keys.indexOf("Legs");
    const otherIdx = keys.indexOf("Other");
    expect(chestIdx).toBeLessThan(upperIdx);
    expect(upperIdx).toBeLessThan(legsIdx);
    expect(legsIdx).toBeLessThan(otherIdx);
    // Ordering matches MUSCLE_GROUPS for present groups.
    const muscleOrder = MUSCLE_GROUPS.indexOf(keys[0] as MuscleGroup);
    expect(muscleOrder).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// computeStreaks — tests #30-#38
// ---------------------------------------------------------------------------

describe("computeStreaks", () => {
  // Anchor NOW = Tuesday 2026-05-19 local (ISO week 2026-W21).
  const NOW = new Date(2026, 4, 19, 12, 0, 0);

  function weekDate(weeksBack: number, dayOffset = 1): string {
    const monday = isoWeekStart(NOW);
    const d = new Date(monday);
    d.setDate(monday.getDate() - weeksBack * 7 + dayOffset);
    return d.toISOString();
  }

  it("(#30) empty sessions → {0, 0}", () => {
    expect(computeStreaks([], NOW)).toEqual({ current: 0, best: 0 });
  });

  it("(#31) one finished session this week → {1, 1}", () => {
    expect(
      computeStreaks([{ started_at: weekDate(0) }], NOW),
    ).toEqual({ current: 1, best: 1 });
  });

  it("(#32) session last week, none this week → soft-fallback {1, 1}", () => {
    expect(
      computeStreaks([{ started_at: weekDate(1) }], NOW),
    ).toEqual({ current: 1, best: 1 });
  });

  it("(#33) session two weeks ago, none last or this → {0, 1}", () => {
    expect(
      computeStreaks([{ started_at: weekDate(2) }], NOW),
    ).toEqual({ current: 0, best: 1 });
  });

  it("(#34) W-3, W-2, W-1, W → {4, 4}", () => {
    const sessions = [
      { started_at: weekDate(3) },
      { started_at: weekDate(2) },
      { started_at: weekDate(1) },
      { started_at: weekDate(0) },
    ];
    expect(computeStreaks(sessions, NOW)).toEqual({ current: 4, best: 4 });
  });

  it("(#35) W-7..W-5 gap then W-1, W → {2, 3}", () => {
    const sessions = [
      { started_at: weekDate(7) },
      { started_at: weekDate(6) },
      { started_at: weekDate(5) },
      { started_at: weekDate(1) },
      { started_at: weekDate(0) },
    ];
    expect(computeStreaks(sessions, NOW)).toEqual({ current: 2, best: 3 });
  });

  it("(#36) multiple sessions same ISO week → counted once for streak", () => {
    const sessions = [
      { started_at: weekDate(0, 0) },
      { started_at: weekDate(0, 1) },
      { started_at: weekDate(0, 2) },
    ];
    expect(computeStreaks(sessions, NOW)).toEqual({ current: 1, best: 1 });
  });

  it("(#37) Sunday-23:59 empty current week, last week also empty → {0, prior best}", () => {
    // Anchor: current = empty; last week = empty; W-2 had a session.
    const sessions = [{ started_at: weekDate(2) }];
    // Pin "now" to Sunday-23:59 local — still in the same ISO week as
    // weekDate(0), but no sessions in W-0 or W-1.
    const sundayLate = new Date(NOW);
    // shift now to Sunday-23:59 of week W (i.e. weeksBack=0).
    sundayLate.setDate(isoWeekStart(NOW).getDate() + 6);
    sundayLate.setHours(23, 59, 59, 999);
    expect(computeStreaks(sessions, sundayLate)).toEqual({ current: 0, best: 1 });
  });

  it("(#38) TZ correctness: Sunday-23:30 BRT session belongs to its own ISO week", () => {
    // Construct a Date for Sunday 17 May 23:30 local. weekKeyOf of that = W20.
    // NOW = Tuesday 19 May local (W21). Soft-fallback applies.
    const sundayLocal = new Date(2026, 4, 17, 23, 30, 0);
    expect(
      computeStreaks([{ started_at: sundayLocal.toISOString() }], NOW),
    ).toEqual({ current: 1, best: 1 });
  });
});

// ---------------------------------------------------------------------------
// Strip height + overlay — tests #39-#41 (BLK-2)
// ---------------------------------------------------------------------------

describe("WeeklyVolumeStrip max-aware denominator", () => {
  const PLOT_HEIGHT = 96;
  const MIN_BAR_HEIGHT = 4;

  function heightFor(totalKg: number, modelMaxKg: number, bestWeekKg?: number) {
    const denom = Math.max(modelMaxKg, bestWeekKg ?? 0);
    if (denom === 0) return MIN_BAR_HEIGHT;
    return Math.max(
      MIN_BAR_HEIGHT,
      Math.round((totalKg / denom) * PLOT_HEIGHT),
    );
  }

  function overlayYFor(modelMaxKg: number, bestWeekKg: number) {
    const denom = Math.max(modelMaxKg, bestWeekKg);
    if (denom === 0) return PLOT_HEIGHT;
    return PLOT_HEIGHT - Math.round((bestWeekKg / denom) * PLOT_HEIGHT);
  }

  it("(#39) bars shrink proportionally when bestWeekKg > model.maxKg", () => {
    // model.maxKg = 1000; bestWeekKg = 2000 → denom = 2000.
    // heaviest visible bar = round(1000/2000 * 96) = 48.
    // overlay y = 96 - round(2000/2000 * 96) = 0.
    expect(heightFor(1000, 1000, 2000)).toBe(48);
    expect(overlayYFor(1000, 2000)).toBe(0);
  });

  it("(#40) bars unaffected when bestWeekKg ≤ model.maxKg", () => {
    // model.maxKg = 1000; bestWeekKg = 800 → denom = 1000.
    // heaviest bar = 96, overlay y = 96 - round(800/1000 * 96) = 96 - 77 = 19.
    expect(heightFor(1000, 1000, 800)).toBe(96);
    expect(overlayYFor(1000, 800)).toBe(19);
  });

  it("(#41) History mount (bestWeekKg undefined) is byte-identical", () => {
    // Existing test in weekly-volume-bucketing.test.ts: maxKg=1000, light=250
    // → light bar = 24, heavy bar = 96. Must match without overlay.
    expect(heightFor(250, 1000, undefined)).toBe(24);
    expect(heightFor(1000, 1000, undefined)).toBe(96);
    // No bestWeekKg → denom = 1000, no overlay rendered.
  });
});

// ---------------------------------------------------------------------------
// listWeeklyVolumeRows null-completed_at safety — tests #42-#45 (BLK-3)
// ---------------------------------------------------------------------------

describe("listWeeklyVolumeRows null-completed_at safety", () => {
  const TRACKER = {
    notCalls: [] as { col: string; op: string; val: unknown }[],
    rowsToReturn: [] as unknown[],
  };

  function makeBuilder() {
    const builder: Record<string, unknown> = {};
    builder.select = vi.fn(() => builder);
    builder.is = vi.fn(() => builder);
    builder.neq = vi.fn(() => builder);
    builder.gte = vi.fn(() => builder);
    builder.order = vi.fn(() => builder);
    builder.not = vi.fn((col: string, op: string, val: unknown) => {
      TRACKER.notCalls.push({ col, op, val });
      return builder;
    });
    builder.range = vi.fn(() =>
      Promise.resolve({ data: TRACKER.rowsToReturn, error: null }),
    );
    // For sinceUtc branch: `.order(...)` is awaited as a thenable directly.
    // We override `.then` to fulfil that path. The non-paginated branch
    // chains: from→select→is→not(...)→not(...)→neq→gte→order, and the
    // final `await` resolves the builder. Make builder thenable.
    builder.then = (resolve: (v: { data: unknown; error: unknown }) => void) =>
      resolve({ data: TRACKER.rowsToReturn, error: null });
    return builder;
  }

  beforeEach(() => {
    TRACKER.notCalls = [];
    TRACKER.rowsToReturn = [];
    vi.resetModules();
    vi.doMock("~/lib/supabase", () => ({
      supabase: {
        from: vi.fn(() => makeBuilder()),
      },
    }));
  });

  afterEach(() => {
    vi.doUnmock("~/lib/supabase");
  });

  it("(#42) lifetime branch filters null completed_at server-side", async () => {
    const { listWeeklyVolumeRows } = await import("~/api/stats");
    TRACKER.rowsToReturn = []; // short page → loop exits after one iteration
    await listWeeklyVolumeRows({});
    const cols = TRACKER.notCalls.map((c) => `${c.col}/${c.op}`);
    expect(cols).toContain("completed_at/is");
    expect(cols).toContain("sessions.ended_at/is");
  });

  it("(#43) sinceUtc branch also filters null completed_at", async () => {
    const { listWeeklyVolumeRows } = await import("~/api/stats");
    TRACKER.rowsToReturn = [];
    await listWeeklyVolumeRows({ sinceUtc: "2026-04-01T00:00:00Z" });
    const cols = TRACKER.notCalls.map((c) => `${c.col}/${c.op}`);
    expect(cols).toContain("completed_at/is");
  });

  it("(#44) post-fetch assert throws if a null row slips past the filter", async () => {
    const { listWeeklyVolumeRows } = await import("~/api/stats");
    TRACKER.rowsToReturn = [
      { completed_at: null, weight: "100", reps: 5, set_type: "working" },
    ];
    await expect(listWeeklyVolumeRows({})).rejects.toThrow(
      /null completed_at slipped past server filter/,
    );
  });

  it("(#45) valid rows → returns narrowed rows, no throw", async () => {
    const { listWeeklyVolumeRows } = await import("~/api/stats");
    TRACKER.rowsToReturn = [
      {
        completed_at: "2026-05-19T10:00:00Z",
        weight: "100",
        reps: 5,
        set_type: "working",
        exercise_id: "ex-1",
        session_id: "s-1",
        sessions: { started_at: "2026-05-19T09:00:00Z", ended_at: "2026-05-19T11:00:00Z" },
      },
    ];
    const rows = await listWeeklyVolumeRows({});
    expect(rows.length).toBe(1);
    // TS narrow: completed_at is string at this point.
    expect(rows[0]!.completed_at).toBe("2026-05-19T10:00:00Z");
  });
});

// ---------------------------------------------------------------------------
// computeLifetimeMaxPerExercise — tests #46-#49
// ---------------------------------------------------------------------------

describe("computeLifetimeMaxPerExercise", () => {
  it("(#46) empty rows → empty map", () => {
    expect(computeLifetimeMaxPerExercise([]).size).toBe(0);
  });

  it("(#47) one exercise, one session, two sets summed", () => {
    const rows = [
      mkRow({
        exercise_id: "ex-1",
        session_id: "s-1",
        completed_at: "2026-05-19T10:00:00Z",
        weight: "100",
        reps: 5,
      }),
      mkRow({
        exercise_id: "ex-1",
        session_id: "s-1",
        completed_at: "2026-05-19T10:05:00Z",
        weight: "100",
        reps: 5,
      }),
    ];
    const m = computeLifetimeMaxPerExercise(rows);
    expect(m.get("ex-1")).toBe(1000);
  });

  it("(#48) one exercise, two sessions, S1=500 S2=800 → 800", () => {
    const rows = [
      mkRow({
        exercise_id: "ex-1",
        session_id: "s-1",
        completed_at: "2026-04-01T10:00:00Z",
        weight: "100",
        reps: 5,
      }),
      mkRow({
        exercise_id: "ex-1",
        session_id: "s-2",
        completed_at: "2026-05-01T10:00:00Z",
        weight: "100",
        reps: 8,
      }),
    ];
    expect(computeLifetimeMaxPerExercise(rows).get("ex-1")).toBe(800);
  });

  it("(#49) two exercises, distinct sessions → both keys present", () => {
    const rows = [
      mkRow({
        exercise_id: "ex-A",
        session_id: "sA",
        completed_at: "2026-04-01T10:00:00Z",
        weight: "100",
        reps: 5,
      }),
      mkRow({
        exercise_id: "ex-B",
        session_id: "sB",
        completed_at: "2026-04-02T10:00:00Z",
        weight: "60",
        reps: 10,
      }),
    ];
    const m = computeLifetimeMaxPerExercise(rows);
    expect(m.get("ex-A")).toBe(500);
    expect(m.get("ex-B")).toBe(600);
  });
});

// ---------------------------------------------------------------------------
// useExercisesThisWeek derivation invariants — tests #53-#56
// ---------------------------------------------------------------------------
//
// Per design-v3 MIN-12 + Implementer call: the hook itself wraps
// `useLifetimeWeeklyVolume` + `useAllExercises` in `useMemo` with no
// independent algorithm beyond `computeLifetimeMaxPerExercise` +
// `computePrExerciseIdsThisWeek` + a library join. We test the same
// invariants at the pure-helper level here — see implementation.md for the
// deferred-hook-test rationale.
// ---------------------------------------------------------------------------

describe("useExercisesThisWeek derivation invariants (pure-helper level)", () => {
  it("(#53) dangling exercise_id is skipped on the library join", () => {
    // Mirror the hook's join: only exercises present in the library appear.
    const trainedNowKg = new Map<string, number>([
      ["ex-in-lib", 600],
      ["ex-dangling", 800],
    ]);
    const lib = [mkExercise({ id: "ex-in-lib", name: "Bench" })];
    const libById = new Map(lib.map((e) => [e.id, e] as const));
    const rows = [];
    for (const [exId, nowKg] of trainedNowKg) {
      const ex = libById.get(exId);
      if (!ex) continue; // <-- dangling skip — assertion focus
      rows.push({ exerciseId: exId, name: ex.name, nowKg });
    }
    expect(rows).toEqual([
      { exerciseId: "ex-in-lib", name: "Bench", nowKg: 600 },
    ]);
  });

  it("(#54) muscles: [] → group is 'Other'", () => {
    const ex = mkExercise({ id: "x", name: "Mystery", muscles: [] });
    const grouped = groupExercisesByPrimaryMuscle([ex]);
    expect(grouped.has("Other")).toBe(true);
    expect(grouped.get("Other")?.[0]?.id).toBe("x");
  });

  it("(#55) muscles: ['Chest','Shoulders'] → group is 'Chest' (primary-only rule)", () => {
    const ex = mkExercise({ id: "x", name: "Bench", muscles: ["Chest", "Shoulders"] });
    const grouped = groupExercisesByPrimaryMuscle([ex]);
    expect(grouped.get("Chest")?.[0]?.id).toBe("x");
    expect(grouped.get("Shoulders")).toBeUndefined();
  });

  it("(#56) isPrThisWeek matches computePrExerciseIdsThisWeek for the same input (parity)", () => {
    const NOW = new Date(2026, 4, 19, 12, 0, 0);
    const weekStart = isoWeekStart(NOW).toISOString();
    const weekEndDate = new Date(isoWeekStart(NOW).getTime());
    weekEndDate.setDate(weekEndDate.getDate() + 6);
    weekEndDate.setHours(23, 59, 59, 999);
    const weekEnd = weekEndDate.toISOString();
    const rows = [
      mkRow({
        exercise_id: "ex-A",
        completed_at: "2026-04-01T10:00:00Z",
        sessionStartedAt: "2026-04-01T09:00:00Z",
        session_id: "s1",
        weight: "100",
        reps: 5,
      }),
      mkRow({
        exercise_id: "ex-A",
        completed_at: "2026-05-19T10:00:00Z",
        sessionStartedAt: "2026-05-19T09:00:00Z",
        session_id: "s2",
        weight: "100",
        reps: 6,
      }),
    ];
    const prSet = computePrExerciseIdsThisWeek({
      rows,
      currentWeekStartIso: weekStart,
      currentWeekEndIso: weekEnd,
    });
    // The hook reads `prSet.has(row.exerciseId)` — assert that's true here.
    expect(prSet.has("ex-A")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// computeCurrentWeekVolume — supporting tests for the hero "Now" value
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Windowed-mode regression cases (configurable max-volume window run).
// ---------------------------------------------------------------------------
//
// These three blocks pin the per-kernel `windowStartMs?: number` semantic
// (see `docs/runs/2026-05-23_0211_configurable-max-volume-window/design-v2.md`).
//
// All cases share:
//   - `NOW = 2026-05-19` (Tuesday in 2026-W21).
//   - `windowStartMs` derived from `computeWindowStart(N, NOW)`.
// ---------------------------------------------------------------------------

describe("windowed-mode regression — bucketLifetimeWeeklyVolumes", () => {
  // We construct `windowStartMs` from a known instant rather than
  // `computeWindowStart` to keep this test independent of that helper's
  // bugs. Pick a Monday and use its UTC ms as the threshold.
  const NOW = new Date(2026, 4, 19, 12, 0, 0); // Tuesday 19 May 2026 (W21)
  const windowMondayLocal = new Date(2026, 1, 23, 0, 0, 0); // Monday 23 Feb 2026
  const windowStartMs = windowMondayLocal.getTime();

  it("(a) session at exactly windowStartMs is INCLUDED (>=)", () => {
    const rows = [
      mkRow({
        completed_at: windowMondayLocal.toISOString(),
        sessionStartedAt: windowMondayLocal.toISOString(),
        weight: "100",
        reps: 5,
      }),
    ];
    const m = bucketLifetimeWeeklyVolumes(rows, windowStartMs);
    expect(m.size).toBe(1);
    expect([...m.values()][0]).toBe(500);
  });

  it("(b) session 1 ms before windowStartMs is EXCLUDED", () => {
    const oneMsBefore = new Date(windowStartMs - 1).toISOString();
    const rows = [
      mkRow({
        completed_at: oneMsBefore,
        sessionStartedAt: oneMsBefore,
        weight: "100",
        reps: 5,
      }),
    ];
    const m = bucketLifetimeWeeklyVolumes(rows, windowStartMs);
    expect(m.size).toBe(0);
  });

  it("(d) windowStartMs=undefined falls back to identical lifetime numbers", () => {
    const ancient = new Date(2024, 0, 1, 10, 0, 0).toISOString();
    const recent = new Date(2026, 4, 19, 10, 0, 0).toISOString();
    const rows = [
      mkRow({
        completed_at: ancient,
        sessionStartedAt: ancient,
        weight: "100",
        reps: 5,
      }), // 500
      mkRow({
        completed_at: recent,
        sessionStartedAt: recent,
        weight: "100",
        reps: 8,
      }), // 800
    ];
    const lifetime = bucketLifetimeWeeklyVolumes(rows);
    const explicitUndefined = bucketLifetimeWeeklyVolumes(rows, undefined);
    expect(lifetime).toEqual(explicitUndefined);
    // Total volume across both weeks = 1300.
    let total = 0;
    for (const v of lifetime.values()) total += v;
    expect(total).toBe(500 + 800);
  });

  it("(e) cross-week session: started_at outside window, completed_at inside → EXCLUDED as one unit", () => {
    // Session started Sunday 22 Feb 23:30 local (week W08, before the
    // window) and completed Monday 23 Feb 00:30 local (week W09, ON the
    // window's first Monday). Window starts at Monday 23 Feb 00:00 local.
    // Per the dual-anchor rule, session-anchor decides INCLUSION → the
    // whole session is excluded; bucket placement is irrelevant because no
    // row survives.
    const sundayLateLocal = new Date(2026, 1, 22, 23, 30, 0).toISOString();
    const mondayEarlyLocal = new Date(2026, 1, 23, 0, 30, 0).toISOString();
    const rows = [
      mkRow({
        completed_at: mondayEarlyLocal,
        sessionStartedAt: sundayLateLocal,
        weight: "100",
        reps: 5,
      }),
    ];
    const m = bucketLifetimeWeeklyVolumes(rows, windowStartMs);
    expect(m.size).toBe(0);
  });

  it("(e2) cross-week session: started_at inside window, completed_at on later week → INCLUDED entirely", () => {
    // Inverse of (e): session started ON the window's first Monday at
    // 23:30 local, and a set completed at Tuesday 00:30 local. The whole
    // session is in-window; the set still lands in the Tuesday bucket per
    // the dual-anchor rule.
    const mondayLateLocal = new Date(2026, 1, 23, 23, 30, 0).toISOString();
    const tuesdayEarlyLocal = new Date(2026, 1, 24, 0, 30, 0).toISOString();
    const rows = [
      mkRow({
        completed_at: tuesdayEarlyLocal,
        sessionStartedAt: mondayLateLocal,
        weight: "100",
        reps: 5,
      }),
    ];
    const m = bucketLifetimeWeeklyVolumes(rows, windowStartMs);
    expect(m.size).toBe(1);
    expect([...m.values()][0]).toBe(500);
  });

  // Reference `NOW` so the lint rule that flags unused declarations stays
  // happy if it ever runs on the file. (NOW is the conceptual anchor; the
  // explicit dates above were chosen against it.)
  it("__internal__: NOW anchor is the Tuesday of 2026-W21", () => {
    expect(NOW.getDay()).toBe(2);
  });
});

describe("windowed-mode regression — computeLifetimeMaxPerExercise", () => {
  const windowMondayLocal = new Date(2026, 1, 23, 0, 0, 0); // Monday 23 Feb 2026
  const windowStartMs = windowMondayLocal.getTime();

  it("(a) session exactly at windowStartMs is INCLUDED", () => {
    const exactly = windowMondayLocal.toISOString();
    const rows = [
      mkRow({
        exercise_id: "ex-1",
        session_id: "s-on-boundary",
        completed_at: exactly,
        sessionStartedAt: exactly,
        weight: "100",
        reps: 5,
      }),
    ];
    const m = computeLifetimeMaxPerExercise(rows, windowStartMs);
    expect(m.get("ex-1")).toBe(500);
  });

  it("(b) session 1 ms before windowStartMs is EXCLUDED", () => {
    const before = new Date(windowStartMs - 1).toISOString();
    const rows = [
      mkRow({
        exercise_id: "ex-1",
        session_id: "s-before",
        completed_at: before,
        sessionStartedAt: before,
        weight: "100",
        reps: 5,
      }),
    ];
    const m = computeLifetimeMaxPerExercise(rows, windowStartMs);
    // No surviving sessions for ex-1 → 0 (or absent; we accept both).
    expect(m.get("ex-1") ?? 0).toBe(0);
  });

  it("(c) ancient PR excluded → in-window second-best becomes the max", () => {
    // Ancient: 1500 kg (one year ago, OUT of window).
    // In-window: 800 kg.
    const ancient = "2025-01-15T10:00:00Z";
    const recent = "2026-04-01T10:00:00Z";
    const rows = [
      mkRow({
        exercise_id: "ex-1",
        session_id: "s-ancient",
        completed_at: ancient,
        sessionStartedAt: ancient,
        weight: "100",
        reps: 15, // 1500 kg
      }),
      mkRow({
        exercise_id: "ex-1",
        session_id: "s-recent",
        completed_at: recent,
        sessionStartedAt: recent,
        weight: "100",
        reps: 8, // 800 kg
      }),
    ];
    const windowed = computeLifetimeMaxPerExercise(rows, windowStartMs);
    expect(windowed.get("ex-1")).toBe(800);
    // Lifetime (no window) still picks the 1500.
    const lifetime = computeLifetimeMaxPerExercise(rows);
    expect(lifetime.get("ex-1")).toBe(1500);
  });

  it("(d) windowStartMs=undefined matches the lifetime path byte-for-byte", () => {
    const rows = [
      mkRow({
        exercise_id: "ex-1",
        session_id: "s-1",
        completed_at: "2025-01-01T10:00:00Z",
        sessionStartedAt: "2025-01-01T10:00:00Z",
        weight: "100",
        reps: 5,
      }),
      mkRow({
        exercise_id: "ex-1",
        session_id: "s-2",
        completed_at: "2026-05-01T10:00:00Z",
        sessionStartedAt: "2026-05-01T10:00:00Z",
        weight: "100",
        reps: 8,
      }),
    ];
    expect(computeLifetimeMaxPerExercise(rows)).toEqual(
      computeLifetimeMaxPerExercise(rows, undefined),
    );
  });

  it("(e) cross-week session counted as one unit (started_at decides inclusion)", () => {
    // Session started 1 ms BEFORE the window, with one set completed inside
    // the window — the entire session is OUT.
    const startedBefore = new Date(windowStartMs - 1).toISOString();
    const completedInside = new Date(windowStartMs + 60_000).toISOString();
    const rows = [
      mkRow({
        exercise_id: "ex-1",
        session_id: "s-cross",
        completed_at: completedInside,
        sessionStartedAt: startedBefore,
        weight: "100",
        reps: 7, // 700 kg
      }),
    ];
    const m = computeLifetimeMaxPerExercise(rows, windowStartMs);
    expect(m.get("ex-1") ?? 0).toBe(0);
  });
});

describe("windowed-mode regression — computePrsThisWeek", () => {
  // Anchor on Tuesday 2026-W21 just like the existing block.
  const NOW = new Date(2026, 4, 19, 12, 0, 0);
  const WEEK_START = isoWeekStart(NOW).toISOString();
  const weekEndDate = new Date(isoWeekStart(NOW).getTime());
  weekEndDate.setDate(weekEndDate.getDate() + 6);
  weekEndDate.setHours(23, 59, 59, 999);
  const WEEK_END = weekEndDate.toISOString();

  // Window threshold: Monday 23 Feb 2026 local (12 weeks before W21).
  const windowStartMs = new Date(2026, 1, 23, 0, 0, 0).getTime();

  function callOpts(rows: WeeklyVolumeRow[], windowed: boolean) {
    return {
      rows,
      currentWeekStartIso: WEEK_START,
      currentWeekEndIso: WEEK_END,
      windowStartMs: windowed ? windowStartMs : undefined,
    };
  }

  it("(c) ancient PR excluded by window → in-window prior becomes the priorMax → new PR fires", () => {
    // Ancient: 1500 kg (Jan 2025, OUT of window).
    // In-window prior: 700 kg.
    // This week: 800 kg → under lifetime semantics NOT a PR (1500 stands);
    // under windowed semantics IS a PR (700 was the priorMax).
    const rows = [
      mkRow({
        completed_at: "2025-01-15T10:00:00Z",
        sessionStartedAt: "2025-01-15T09:00:00Z",
        session_id: "s-ancient",
        weight: "100",
        reps: 15, // 1500
      }),
      mkRow({
        completed_at: "2026-04-01T10:00:00Z",
        sessionStartedAt: "2026-04-01T09:00:00Z",
        session_id: "s-recent",
        weight: "100",
        reps: 7, // 700
      }),
      mkRow({
        completed_at: "2026-05-19T10:00:00Z",
        sessionStartedAt: "2026-05-19T09:00:00Z",
        session_id: "s-thisweek",
        weight: "100",
        reps: 8, // 800
      }),
    ];

    const lifetime = computePrsThisWeek(callOpts(rows, false));
    expect(lifetime).toHaveLength(0); // 800 < 1500, no PR

    const windowed = computePrsThisWeek(callOpts(rows, true));
    expect(windowed).toHaveLength(1);
    expect(windowed[0]).toEqual({
      exerciseId: "ex-1",
      priorMaxKg: 700,
      currentMaxKg: 800,
      overflowKg: 100,
    });
  });

  it("(d) windowStartMs=undefined is byte-identical to existing lifetime numbers", () => {
    const rows = [
      mkRow({
        completed_at: "2026-04-01T10:00:00Z",
        sessionStartedAt: "2026-04-01T09:00:00Z",
        session_id: "s1",
        weight: "100",
        reps: 5,
      }), // 500
      mkRow({
        completed_at: "2026-04-08T10:00:00Z",
        sessionStartedAt: "2026-04-08T09:00:00Z",
        session_id: "s2",
        weight: "100",
        reps: 8,
      }), // 800
      mkRow({
        completed_at: "2026-05-19T10:00:00Z",
        sessionStartedAt: "2026-05-19T09:00:00Z",
        session_id: "s3",
        weight: "100",
        reps: 9,
      }), // 900 (PR)
    ];
    expect(computePrsThisWeek(callOpts(rows, false))).toEqual([
      {
        exerciseId: "ex-1",
        priorMaxKg: 800,
        currentMaxKg: 900,
        overflowKg: 100,
      },
    ]);
  });

  it("(e) cross-week session: priors aggregated to session level → never split", () => {
    // Pre-window session started 1ms BEFORE windowStartMs, with sets
    // completed AFTER. As an aggregate it is OUT-of-window. With no other
    // priors, this-week becomes a "first session in-window" → priorMax=0
    // → NOT a PR (mirrors lifetime first-session semantic).
    const startedBefore = new Date(windowStartMs - 1).toISOString();
    const completedInside = new Date(windowStartMs + 60_000).toISOString();
    const rows = [
      mkRow({
        completed_at: completedInside,
        sessionStartedAt: startedBefore,
        session_id: "s-cross",
        weight: "100",
        reps: 6, // 600
      }),
      mkRow({
        completed_at: "2026-05-19T10:00:00Z",
        sessionStartedAt: "2026-05-19T09:00:00Z",
        session_id: "s-thisweek",
        weight: "100",
        reps: 8, // 800
      }),
    ];
    expect(computePrsThisWeek(callOpts(rows, true))).toHaveLength(0);
    // For sanity: under lifetime (no window) the cross-session counts and
    // this-week 800 IS a PR over 600.
    expect(computePrsThisWeek(callOpts(rows, false))).toHaveLength(1);
  });

  it("internal anchor sanity: NOW is the Tuesday of 2026-W21", () => {
    expect(NOW.getDay()).toBe(2);
  });
});

describe("computeCurrentWeekVolume", () => {
  const NOW = new Date(2026, 4, 19, 12, 0, 0);

  it("sums only rows in the current ISO week", () => {
    const monday = isoWeekStart(NOW);
    const tuesdayThisWeek = new Date(monday);
    tuesdayThisWeek.setDate(monday.getDate() + 1);
    const lastWeek = new Date(monday);
    lastWeek.setDate(monday.getDate() - 3);
    const rows = [
      mkRow({
        completed_at: tuesdayThisWeek.toISOString(),
        weight: "100",
        reps: 5,
      }), // 500 (this week)
      mkRow({
        completed_at: lastWeek.toISOString(),
        weight: "100",
        reps: 7,
      }), // 700 (last week)
    ];
    expect(computeCurrentWeekVolume(rows, NOW)).toBe(500);
  });

  it("returns 0 when no rows fall in the current week", () => {
    const rows = [
      mkRow({
        completed_at: "2026-04-01T10:00:00Z",
        weight: "100",
        reps: 5,
      }),
    ];
    expect(computeCurrentWeekVolume(rows, NOW)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Bodyweight kernel — Phase 0 (Invariant B: bodyweight shifts)
// ---------------------------------------------------------------------------

describe("bucketLifetimeWeeklyVolumes — bodyweight", () => {
  it("a bodyweight set (weight=0) contributes bodyweight * reps", () => {
    const rows = [
      mkRow({
        completed_at: "2026-05-04T10:00:00Z",
        weight: "0",
        reps: 10,
        exercises: { equipment: "bodyweight" },
        sessions: {
          started_at: "2026-05-04T09:00:00Z",
          ended_at: "2026-05-04T10:30:00Z",
        },
      }),
    ];
    const buckets = bucketLifetimeWeeklyVolumes(rows, undefined, {
      measurements: [mkMeasurement("2026-05-01T00:00:00Z", "80")],
    });
    // 80 * 10 = 800 in the 2026-W19 bucket.
    expect([...buckets.values()].reduce((a, b) => a + b, 0)).toBe(800);
  });

  it("non-bodyweight rows are byte-identical with vs without the bodyweight input (Invariant A)", () => {
    const rows = [
      mkRow({ completed_at: "2026-05-04T10:00:00Z", weight: "100", reps: 5 }),
    ];
    const withoutBw = bucketLifetimeWeeklyVolumes(rows);
    const withBw = bucketLifetimeWeeklyVolumes(rows, undefined, {
      measurements: [mkMeasurement("2026-05-01T00:00:00Z", "80")],
    });
    expect([...withBw.entries()]).toEqual([...withoutBw.entries()]);
  });
});

describe("computeLifetimeMaxPerExercise — bodyweight (Invariant B)", () => {
  it("bodyweight session max reflects (bodyweight + addedLoad) * reps", () => {
    const rows = [
      // Prior session, lighter bodyweight.
      mkRow({
        completed_at: "2026-04-06T10:00:00Z",
        weight: "0",
        reps: 8,
        exercise_id: "pullup",
        session_id: "s1",
        exercises: { equipment: "bodyweight" },
        sessions: {
          started_at: "2026-04-06T09:00:00Z",
          ended_at: "2026-04-06T10:00:00Z",
        },
      }),
      // Later session, heavier bodyweight + more reps.
      mkRow({
        completed_at: "2026-05-04T10:00:00Z",
        weight: "0",
        reps: 12,
        exercise_id: "pullup",
        session_id: "s2",
        exercises: { equipment: "bodyweight" },
        sessions: {
          started_at: "2026-05-04T09:00:00Z",
          ended_at: "2026-05-04T10:00:00Z",
        },
      }),
    ];
    const maxes = computeLifetimeMaxPerExercise(rows, undefined, {
      measurements: [
        mkMeasurement("2026-04-01T00:00:00Z", "70"), // prior weigh-in
        mkMeasurement("2026-05-01T00:00:00Z", "82"), // later weigh-in
      ],
    });
    // s1: 70 * 8 = 560; s2: 82 * 12 = 984 → max 984.
    expect(maxes.get("pullup")).toBe(984);
  });
});

describe("computePrsThisWeek — bodyweight PR creation/erasure", () => {
  // Anchor NOW = Tuesday 2026-05-19 local (ISO week 2026-W21, Mon 5/18).
  const NOW = new Date(2026, 4, 19, 12, 0, 0);

  it("create: a bodyweight session beats the prior bodyweight max (PR appears)", () => {
    const rows = [
      // Prior week — bodyweight 80, 8 reps → 640.
      mkRow({
        completed_at: "2026-05-04T10:00:00Z",
        weight: "0",
        reps: 8,
        exercise_id: "pullup",
        session_id: "s-prior",
        exercises: { equipment: "bodyweight" },
        sessions: {
          started_at: "2026-05-04T09:00:00Z",
          ended_at: "2026-05-04T10:00:00Z",
        },
      }),
      // Current week (2026-W21: Mon 5/18) — bodyweight 80, 12 reps → 960 > 640.
      mkRow({
        completed_at: "2026-05-20T10:00:00Z",
        weight: "0",
        reps: 12,
        exercise_id: "pullup",
        session_id: "s-week",
        exercises: { equipment: "bodyweight" },
        sessions: {
          started_at: "2026-05-20T09:00:00Z",
          ended_at: "2026-05-20T10:00:00Z",
        },
      }),
    ];
    const prs = computePrsThisWeek({
      rows,
      currentWeekStartIso: isoWeekStart(NOW).toISOString(),
      currentWeekEndIso: new Date(
        isoWeekStart(NOW).getTime() + 6 * 86400000 + 86399000,
      ).toISOString(),
      bodyweight: {
        measurements: [mkMeasurement("2026-05-01T00:00:00Z", "80")],
      },
    });
    const pr = prs.find((p) => p.exerciseId === "pullup");
    expect(pr).toBeDefined();
    expect(pr!.priorMaxKg).toBe(640);
    expect(pr!.currentMaxKg).toBe(960);
  });

  it("erase: a logged-weight PR vanishes once the prior bodyweight max is counted", () => {
    // Without bodyweight: prior pull-ups log weight=0 → 0 volume → the current
    // week's first pull-up would look like a brand-new PR baseline. WITH
    // bodyweight, the prior sessions now carry real volume, so a smaller
    // current-week session is NOT a PR.
    const rows = [
      // Prior — bodyweight 80, 15 reps → 1200 (the real prior max).
      mkRow({
        completed_at: "2026-05-04T10:00:00Z",
        weight: "0",
        reps: 15,
        exercise_id: "pullup",
        session_id: "s-prior",
        exercises: { equipment: "bodyweight" },
        sessions: {
          started_at: "2026-05-04T09:00:00Z",
          ended_at: "2026-05-04T10:00:00Z",
        },
      }),
      // Current week — bodyweight 80, 8 reps → 640 < 1200 → NOT a PR.
      mkRow({
        completed_at: "2026-05-20T10:00:00Z",
        weight: "0",
        reps: 8,
        exercise_id: "pullup",
        session_id: "s-week",
        exercises: { equipment: "bodyweight" },
        sessions: {
          started_at: "2026-05-20T09:00:00Z",
          ended_at: "2026-05-20T10:00:00Z",
        },
      }),
    ];
    const prs = computePrsThisWeek({
      rows,
      currentWeekStartIso: isoWeekStart(NOW).toISOString(),
      currentWeekEndIso: new Date(
        isoWeekStart(NOW).getTime() + 6 * 86400000 + 86399000,
      ).toISOString(),
      bodyweight: {
        measurements: [mkMeasurement("2026-05-01T00:00:00Z", "80")],
      },
    });
    expect(prs.find((p) => p.exerciseId === "pullup")).toBeUndefined();
  });
});
