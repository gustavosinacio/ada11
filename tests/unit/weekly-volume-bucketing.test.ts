/**
 * Verifies the bucketing logic used by `WeeklyVolumeStrip`.
 *
 * `computeStripModel` lives in `~/utils/weekly-volume-strip-math` (a pure
 * module) so we can test it without dragging in the RN component tree.
 * Buckets are dynamic-length spanning `firstSessionMonday` → `currentMonday`
 * (inclusive). Empty data returns `null` so the caller branches into the
 * zero-state without rendering chrome.
 */

import { describe, expect, it } from "vitest";

import type { WeeklyVolumeRow } from "~/api/stats";
import type { MeasurementEntryRow } from "~/db/types";
import { isoWeekStart } from "~/utils/dates";
import { computeStripModel } from "~/utils/weekly-volume-strip-math";

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

type RowInput = Omit<
  WeeklyVolumeRow,
  "set_type" | "exercise_id" | "session_id" | "exercises" | "sessions"
> & {
  exercise_id?: string;
  session_id?: string;
  exercises?: { equipment: string; bodyweight_factor: string | null };
  sessions?: { started_at: string; ended_at: string };
  set_type?: WeeklyVolumeRow["set_type"];
};

function buildRow(input: RowInput): WeeklyVolumeRow {
  return {
    completed_at: input.completed_at,
    weight: input.weight,
    reps: input.reps,
    set_type: input.set_type ?? "working",
    exercise_id: input.exercise_id ?? "ex-1",
    session_id: input.session_id ?? "sess-1",
    // MIN-4: default barbell so existing assertions stay green
    // (`effectiveWeightKg("barbell", weight, null)` === addedLoad).
    exercises: input.exercises ?? {
      equipment: "barbell",
      bodyweight_factor: null,
    },
    sessions: input.sessions ?? {
      started_at: input.completed_at,
      ended_at: input.completed_at,
    },
  };
}

describe("computeStripModel", () => {
  it("returns null on empty data (zero-state branch)", () => {
    const model = computeStripModel([]);
    expect(model).toBeNull();
  });

  it("returns dynamic buckets from firstSessionMonday → currentMonday", () => {
    // Seed a single row roughly 5 weeks ago. The bucket array should span
    // that week through the current week inclusive (6 weeks).
    const now = new Date();
    const fiveWeeksAgo = new Date(now.getTime() - 5 * 7 * 86400000);
    const row = buildRow({
      completed_at: fiveWeeksAgo.toISOString(),
      weight: "100",
      reps: 5,
    });
    const model = computeStripModel([row]);
    expect(model).not.toBeNull();
    // Should be at least 6 weeks (could be 6 or 7 depending on day-of-week).
    expect(model!.buckets.length).toBeGreaterThanOrEqual(6);
    // First bucket is the Monday of the first-session week.
    const firstBucketStart = model!.buckets[0]!.start;
    const firstSessionMonday = isoWeekStart(fiveWeeksAgo);
    expect(firstBucketStart.getTime()).toBe(firstSessionMonday.getTime());
    // Last bucket is the current week.
    expect(model!.buckets[model!.buckets.length - 1]!.isCurrent).toBe(true);
  });

  it("5 weeks of data → at least 5 contiguous buckets oldest→newest", () => {
    const now = new Date();
    const rows: WeeklyVolumeRow[] = [];
    for (let weeksBack = 0; weeksBack < 5; weeksBack++) {
      const dt = new Date(now.getTime() - weeksBack * 7 * 86400000);
      rows.push(
        buildRow({
          completed_at: dt.toISOString(),
          weight: "100",
          reps: 5,
        }),
      );
    }
    const model = computeStripModel(rows);
    expect(model).not.toBeNull();
    // Buckets are contiguous, oldest → newest.
    const buckets = model!.buckets;
    expect(buckets.length).toBeGreaterThanOrEqual(5);
    for (let i = 1; i < buckets.length; i++) {
      expect(buckets[i]!.start.getTime()).toBeGreaterThan(
        buckets[i - 1]!.start.getTime(),
      );
    }
    // Final bucket is flagged current.
    expect(buckets[buckets.length - 1]!.isCurrent).toBe(true);
    // The other 4 weeks of data should produce non-zero totals.
    const nonZeroBuckets = buckets.filter((b) => b.totalKg > 0);
    expect(nonZeroBuckets.length).toBeGreaterThanOrEqual(5);
  });

  it("sums weight × reps for valid rows, drops invalid ones", () => {
    const now = new Date();
    const dt = now.toISOString();
    const rows: WeeklyVolumeRow[] = [
      // Valid: 100 × 5 = 500
      buildRow({ completed_at: dt, weight: "100", reps: 5 }),
      // Valid: 80 × 8 = 640
      buildRow({ completed_at: dt, weight: "80", reps: 8 }),
      // Invalid: null weight (bodyweight) — dropped by `> 0`
      buildRow({ completed_at: dt, weight: null, reps: 10 }),
      // Invalid: zero reps
      buildRow({ completed_at: dt, weight: "100", reps: 0 }),
      // Invalid: zero weight string
      buildRow({ completed_at: dt, weight: "0", reps: 5 }),
      // Invalid: null reps
      buildRow({ completed_at: dt, weight: "100", reps: null }),
    ];
    const model = computeStripModel(rows);
    expect(model).not.toBeNull();
    expect(model!.currentWeekKg).toBe(500 + 640);
  });

  it("scales heights linearly — heaviest bucket maps to PLOT_HEIGHT", () => {
    const now = new Date();
    const lightDayMs = now.getTime() - 7 * 86400000 * 3; // ~3 weeks ago
    const heavyDay = now;

    const rows: WeeklyVolumeRow[] = [
      buildRow({
        completed_at: new Date(lightDayMs).toISOString(),
        weight: "50",
        reps: 5,
      }), // 250
      buildRow({
        completed_at: heavyDay.toISOString(),
        weight: "100",
        reps: 10,
      }), // 1000
    ];
    const model = computeStripModel(rows);
    expect(model).not.toBeNull();
    expect(model!.maxKg).toBe(1000);
    const heavy = model!.buckets[model!.buckets.length - 1]!;
    expect(heavy.totalKg).toBe(1000);
    // The light bucket should be 250.
    const light = model!.buckets.find((b) => b.totalKg === 250);
    expect(light).toBeDefined();
    // Verify the documented height formula.
    const PLOT = 96;
    const MIN = 4;
    const lh = Math.max(MIN, Math.round((light!.totalKg / model!.maxKg) * PLOT));
    expect(lh).toBe(24);
    const hh = Math.max(MIN, Math.round((heavy.totalKg / model!.maxKg) * PLOT));
    expect(hh).toBe(PLOT);
  });

  it("rest weeks (totalKg = 0) get the MIN_BAR_HEIGHT floor under the height formula", () => {
    // Seed: a heavy week 5 weeks ago AND the current week, leaving the
    // in-between buckets empty. The 4 buckets in between are rest weeks.
    const now = new Date();
    const fiveWeeksAgo = new Date(now.getTime() - 5 * 7 * 86400000);
    const rows: WeeklyVolumeRow[] = [
      buildRow({
        completed_at: fiveWeeksAgo.toISOString(),
        weight: "100",
        reps: 5,
      }),
      buildRow({
        completed_at: now.toISOString(),
        weight: "100",
        reps: 5,
      }),
    ];
    const model = computeStripModel(rows);
    expect(model).not.toBeNull();
    expect(model!.maxKg).toBe(500);
    // Find a rest bucket (between the first and last).
    const buckets = model!.buckets;
    const restBucket = buckets.slice(1, -1).find((b) => b.totalKg === 0);
    expect(restBucket).toBeDefined();
    const MIN = 4;
    const h =
      model!.maxKg === 0
        ? MIN
        : Math.max(MIN, Math.round((restBucket!.totalKg / model!.maxKg) * 96));
    expect(h).toBe(MIN);
  });

  it("includes rows older than 8 weeks now that buckets are lifetime-spanning", () => {
    // Pre-rewrite, rows older than 8 weeks were silently dropped. After this
    // run, lifetime data flows through — the bucket span grows to cover them.
    const now = new Date();
    const tenWeeksAgo = new Date(now.getTime() - 10 * 7 * 86400000);
    const rows: WeeklyVolumeRow[] = [
      buildRow({
        completed_at: tenWeeksAgo.toISOString(),
        weight: "100",
        reps: 5,
      }),
    ];
    const model = computeStripModel(rows);
    expect(model).not.toBeNull();
    // Buckets span ≥10 weeks now.
    expect(model!.buckets.length).toBeGreaterThanOrEqual(10);
    // The 10-weeks-ago row's volume IS counted (maxKg > 0).
    expect(model!.maxKg).toBe(500);
  });
});

describe("computeStripModel — bodyweight kernel", () => {
  it("a bodyweight set (weight=0) contributes (bodyweight + addedLoad) * reps", () => {
    const now = new Date();
    const oneWeekAgo = new Date(now.getTime() - 7 * 86400000);
    const completedAt = oneWeekAgo.toISOString();
    const rows: WeeklyVolumeRow[] = [
      buildRow({
        completed_at: completedAt,
        weight: "0", // unweighted pull-up
        reps: 10,
        exercises: { equipment: "bodyweight", bodyweight_factor: null },
        sessions: { started_at: completedAt, ended_at: completedAt },
      }),
    ];
    // Bodyweight 80kg as of the session → effective 80 * 10 = 800.
    const model = computeStripModel(rows, now, {
      measurements: [mkMeasurement(completedAt, "80")],
    });
    expect(model).not.toBeNull();
    expect(model!.maxKg).toBe(800);
  });

  it("a weighted pull-up (weight=20) adds load on top of bodyweight", () => {
    const now = new Date();
    const oneWeekAgo = new Date(now.getTime() - 7 * 86400000);
    const completedAt = oneWeekAgo.toISOString();
    const rows: WeeklyVolumeRow[] = [
      buildRow({
        completed_at: completedAt,
        weight: "20",
        reps: 5,
        exercises: { equipment: "bodyweight", bodyweight_factor: null },
        sessions: { started_at: completedAt, ended_at: completedAt },
      }),
    ];
    // (80 + 20) * 5 = 500.
    const model = computeStripModel(rows, now, {
      measurements: [mkMeasurement(completedAt, "80")],
    });
    expect(model!.maxKg).toBe(500);
  });

  it("without measurements a bodyweight set falls back to addedLoad only", () => {
    const now = new Date();
    const oneWeekAgo = new Date(now.getTime() - 7 * 86400000);
    const completedAt = oneWeekAgo.toISOString();
    const rows: WeeklyVolumeRow[] = [
      buildRow({
        completed_at: completedAt,
        weight: "0",
        reps: 10,
        exercises: { equipment: "bodyweight", bodyweight_factor: null },
      }),
    ];
    // No measurements → bw null → effective = 0 → contributes 0 = today's
    // behaviour for an unweighted bodyweight set.
    const model = computeStripModel(rows, now, { measurements: [] });
    expect(model!.maxKg).toBe(0);
  });
});
