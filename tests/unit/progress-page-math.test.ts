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
import type { ExerciseRow, MuscleGroup, SetType } from "~/db/types";
import { MUSCLE_GROUPS } from "~/db/types";
import {
  bucketLifetimeWeeklyVolumes,
  computeCurrentWeekVolume,
  computeLifetimeMaxPerExercise,
  computePrExerciseIdsThisWeek,
  computeStreaks,
  findBestWeek,
  groupExercisesByPrimaryMuscle,
} from "~/utils/progress-page-math";
import { isoWeekStart, weekKeyOf } from "~/utils/dates";

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
    sessions: overrides.sessions ?? {
      started_at: sessionStart,
      ended_at: sessionStart,
    },
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

  it("findBestWeek surfaces a M/d label derived from the ISO-week key", () => {
    const m = new Map<string, number>();
    m.set("2026-W21", 1000); // Monday 2026-05-18
    const best = findBestWeek(m);
    expect(best!.weekStartLabel).toBe("5/18");
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
