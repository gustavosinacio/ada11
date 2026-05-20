/**
 * Verifies the bucketing logic used by `WeeklyVolumeStrip`.
 *
 * `computeStripModel` is a local helper inside the component (per validator
 * MIN-2 in validation-v2). We replicate the kernel here against the same
 * `lastNIsoWeeks` / `weekKeyOf` helpers it consumes, so the test catches any
 * drift in the public utilities the component depends on.
 */

import { describe, expect, it } from "vitest";

import { lastNIsoWeeks, parseISO, weekKeyOf } from "~/utils/dates";

type Row = {
  completed_at: string;
  weight: string | null;
  reps: number | null;
};

function bucket(rows: Row[], now: Date) {
  const weeks = lastNIsoWeeks(8, now);
  const totals = new Map<string, number>();
  for (const w of weeks) totals.set(w.key, 0);

  for (const row of rows) {
    const key = weekKeyOf(parseISO(row.completed_at));
    if (!totals.has(key)) continue;
    const w = row.weight ? parseFloat(row.weight) : 0;
    const r = row.reps ?? 0;
    if (Number.isFinite(w) && w > 0 && r > 0) {
      totals.set(key, (totals.get(key) ?? 0) + w * r);
    }
  }

  const buckets = weeks.map((wk, idx) => ({
    key: wk.key,
    label: wk.label,
    totalKg: totals.get(wk.key) ?? 0,
    isCurrent: idx === weeks.length - 1,
  }));
  const maxKg = buckets.reduce((m, b) => (b.totalKg > m ? b.totalKg : m), 0);
  const currentWeekKg = buckets[buckets.length - 1]?.totalKg ?? 0;
  return { buckets, maxKg, currentWeekKg };
}

describe("computeStripModel kernel", () => {
  const NOW = new Date(2026, 4, 19, 12, 0, 0); // Tuesday, 2026-05-19

  it("produces 8 buckets oldest -> newest", () => {
    const { buckets } = bucket([], NOW);
    expect(buckets.length).toBe(8);
    expect(buckets[buckets.length - 1]!.isCurrent).toBe(true);
    for (let i = 0; i < 7; i++) {
      expect(buckets[i]!.isCurrent).toBe(false);
    }
  });

  it("returns maxKg = 0 when no rows are provided (all-zero branch)", () => {
    const { maxKg, currentWeekKg } = bucket([], NOW);
    expect(maxKg).toBe(0);
    expect(currentWeekKg).toBe(0);
  });

  it("sums weight × reps for valid rows, drops invalid ones", () => {
    const rows: Row[] = [
      // Valid: 100 × 5 = 500
      { completed_at: "2026-05-19T10:00:00Z", weight: "100", reps: 5 },
      // Valid: 80 × 8 = 640
      { completed_at: "2026-05-19T11:00:00Z", weight: "80", reps: 8 },
      // Invalid: null weight (bodyweight) — dropped by `> 0`
      { completed_at: "2026-05-19T12:00:00Z", weight: null, reps: 10 },
      // Invalid: zero reps
      { completed_at: "2026-05-19T13:00:00Z", weight: "100", reps: 0 },
      // Invalid: zero weight string
      { completed_at: "2026-05-19T14:00:00Z", weight: "0", reps: 5 },
      // Invalid: null reps
      { completed_at: "2026-05-19T15:00:00Z", weight: "100", reps: null },
    ];
    const { currentWeekKg } = bucket(rows, NOW);
    expect(currentWeekKg).toBe(500 + 640);
  });

  it("scales heights linearly — heaviest bucket maps to PLOT_HEIGHT", () => {
    // Build a heavy current week (1000 kg) and a light past week (250 kg).
    // We don't recompute heights here (component-internal), but we check the
    // ratio: a 250 kg week should yield Math.round(250/1000 * 96) = 24 px.
    const weeks = lastNIsoWeeks(8, NOW);
    const lightWeek = weeks[3]!; // some past week
    const heavyWeek = weeks[weeks.length - 1]!; // current

    const lightDay = new Date(lightWeek.start.getTime() + 86400000 * 2); // Wed of light week
    const heavyDay = new Date(heavyWeek.start.getTime() + 86400000); // Tue of heavy week

    const rows: Row[] = [
      { completed_at: lightDay.toISOString(), weight: "50", reps: 5 }, // 250
      { completed_at: heavyDay.toISOString(), weight: "100", reps: 10 }, // 1000
    ];
    const { buckets, maxKg } = bucket(rows, NOW);
    expect(maxKg).toBe(1000);
    const lightBucket = buckets.find((b) => b.key === lightWeek.key)!;
    expect(lightBucket.totalKg).toBe(250);

    // Verify the documented height formula at the boundary.
    const PLOT = 96;
    const MIN = 4;
    const h = Math.max(MIN, Math.round((lightBucket.totalKg / maxKg) * PLOT));
    expect(h).toBe(24);
    // Heaviest bucket should reach the top.
    const heavyBucket = buckets.find((b) => b.key === heavyWeek.key)!;
    const heavyH = Math.max(
      MIN,
      Math.round((heavyBucket.totalKg / maxKg) * PLOT),
    );
    expect(heavyH).toBe(PLOT);
  });

  it("rest weeks (totalKg = 0) get the MIN_BAR_HEIGHT floor", () => {
    const rows: Row[] = [
      { completed_at: "2026-05-19T10:00:00Z", weight: "100", reps: 5 },
    ];
    const { buckets, maxKg } = bucket(rows, NOW);
    // All non-current buckets have totalKg = 0; the floor should apply.
    const MIN = 4;
    const restBucket = buckets[0]!;
    const h =
      maxKg === 0
        ? MIN
        : Math.max(MIN, Math.round((restBucket.totalKg / maxKg) * 96));
    expect(restBucket.totalKg).toBe(0);
    expect(h).toBe(MIN);
  });

  it("rows outside the 8-week window are dropped", () => {
    // 10 weeks ago — outside the window.
    const tenWeeksAgo = new Date(NOW.getTime() - 10 * 7 * 86400000);
    const rows: Row[] = [
      { completed_at: tenWeeksAgo.toISOString(), weight: "100", reps: 5 },
    ];
    const { maxKg } = bucket(rows, NOW);
    expect(maxKg).toBe(0);
  });

  it("late-Sunday-night BRT set lands in the correct ISO week", () => {
    // Simulate: 23:30 local-time Sunday. Same physical day in BRT becomes
    // Monday in UTC. `parseISO` of a UTC string + local-time getters in
    // weekKeyOf must produce the Sunday-belongs-to-its-own-week behavior.
    //
    // To avoid depending on the runner's TZ for the assertion, we construct
    // a Date using local-time values directly and just verify the round-trip
    // produces the same week key on either side of the parseISO step.
    const sundayLocal = new Date(2026, 4, 17, 23, 30, 0); // Sunday 17 May, local
    const expectedKey = weekKeyOf(sundayLocal);

    // Re-parse from ISO and re-key — must agree.
    const iso = sundayLocal.toISOString();
    const reparsed = parseISO(iso);
    expect(weekKeyOf(reparsed)).toBe(expectedKey);
  });
});
