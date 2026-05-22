import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MeasurementEntryRow } from "~/db/types";
import { entriesToWeightSeries } from "~/utils/measurements-chart";

// Pin "now" so the year-conditional label rule in `formatShortDate` stays
// stable across calendar years. Without this, `expect("5/20")` would start
// failing once we cross into 2027 because all fixtures are 2026.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-05-22T12:00:00-03:00"));
});

afterEach(() => {
  vi.useRealTimers();
});

// Convenience: build a row with just the columns the helper touches plus
// the universally-required scaffold columns. All other columns are null.
function row(
  measuredAt: string,
  weightKg: string | null,
): MeasurementEntryRow {
  return {
    id: `id-${measuredAt}`,
    user_id: "u",
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
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    deleted_at: null,
  };
}

describe("entriesToWeightSeries", () => {
  it("returns empty array when input is empty", () => {
    expect(entriesToWeightSeries([], "kg")).toEqual([]);
  });

  it("skips entries with null or non-finite weight_kg", () => {
    // listMeasurements emits DESC; keep that here.
    const input: MeasurementEntryRow[] = [
      row("2026-05-15T12:00:00Z", null),
      row("2026-05-10T12:00:00Z", "abc"),
      row("2026-05-05T12:00:00Z", "80.0"),
    ];
    const out = entriesToWeightSeries(input, "kg");
    expect(out).toHaveLength(1);
    expect(out[0]!.value).toBeCloseTo(80, 6);
  });

  it("reverses DESC input to ASC output (oldest -> newest)", () => {
    const input: MeasurementEntryRow[] = [
      row("2026-05-15T12:00:00Z", "82.0"), // newest
      row("2026-05-10T12:00:00Z", "81.0"),
      row("2026-05-05T12:00:00Z", "80.0"), // oldest
    ];
    const out = entriesToWeightSeries(input, "kg");
    expect(out).toHaveLength(3);
    expect(out[0]!.value).toBeCloseTo(80, 6);
    expect(out[2]!.value).toBeCloseTo(82, 6);
  });

  it("respects maxPoints (default 12; take N most-recent from DESC)", () => {
    const input: MeasurementEntryRow[] = [];
    // 15 entries, DESC: day 15 (newest) → day 1 (oldest).
    for (let d = 15; d >= 1; d--) {
      const iso = `2026-05-${String(d).padStart(2, "0")}T12:00:00Z`;
      input.push(row(iso, String(70 + d)));
    }
    const out = entriesToWeightSeries(input, "kg");
    expect(out).toHaveLength(12);
    // Most recent 12 in DESC are days 15..4. ASC ordering: day 4 first, day 15 last.
    expect(out[0]!.value).toBeCloseTo(74, 6);
    expect(out[11]!.value).toBeCloseTo(85, 6);
  });

  it("honors custom maxPoints", () => {
    const input: MeasurementEntryRow[] = [
      row("2026-05-15T12:00:00Z", "82.0"),
      row("2026-05-10T12:00:00Z", "81.0"),
      row("2026-05-05T12:00:00Z", "80.0"),
    ];
    const out = entriesToWeightSeries(input, "kg", 2);
    expect(out).toHaveLength(2);
    // Top 2 DESC are 82 & 81. ASC: 81 first, 82 last.
    expect(out[0]!.value).toBeCloseTo(81, 6);
    expect(out[1]!.value).toBeCloseTo(82, 6);
  });

  it("converts to lbs when unit is 'lbs'", () => {
    const input: MeasurementEntryRow[] = [
      row("2026-05-15T12:00:00Z", "100.0"),
      row("2026-05-10T12:00:00Z", "50.0"),
    ];
    const out = entriesToWeightSeries(input, "lbs");
    // 100 kg ≈ 220.46 lbs, 50 kg ≈ 110.23 lbs.
    expect(out[0]!.value).toBeCloseTo(110.231, 2);
    expect(out[1]!.value).toBeCloseTo(220.462, 2);
  });

  it("emits M/D labels from measured_at", () => {
    const input: MeasurementEntryRow[] = [row("2026-05-20T12:00:00Z", "80.0")];
    const out = entriesToWeightSeries(input, "kg");
    expect(out[0]!.label).toBe("5/20");
  });
});
