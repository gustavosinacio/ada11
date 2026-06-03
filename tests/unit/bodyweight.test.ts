/**
 * Unit tests for the bodyweight-as-load kernel (`src/utils/bodyweight.ts`).
 *
 * Pure — no React, no Supabase. Covers:
 *   - effectiveWeightKg: bodyweight addend, weighted pull-up, non-bodyweight
 *     passthrough, null/empty/0 weight, NaN-safety, legacy "Bodyweight"
 *     non-trigger.
 *   - bodyweightKgAsOf: prior / later / none→null fallbacks, null-weight_kg
 *     skip, DESC-input order independence, exact-instant tie.
 */

import { describe, expect, it } from "vitest";

import type { MeasurementEntryRow } from "~/db/types";
import { bodyweightKgAsOf, effectiveWeightKg } from "~/utils/bodyweight";

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

const ms = (iso: string) => new Date(iso).getTime();

describe("effectiveWeightKg", () => {
  it("bodyweight + addedLoad=0 → bodyweight (unweighted pull-up)", () => {
    expect(effectiveWeightKg("bodyweight", "0", 80)).toBe(80);
  });

  it("bodyweight + addedLoad>0 → bodyweight + addedLoad (weighted pull-up)", () => {
    expect(effectiveWeightKg("bodyweight", "20", 80)).toBe(100);
  });

  it("bodyweight + null weight → bodyweight (addedLoad defaults to 0)", () => {
    expect(effectiveWeightKg("bodyweight", null, 80)).toBe(80);
  });

  it("bodyweight + empty-string weight → bodyweight (parseFloat('') is NaN → 0)", () => {
    expect(effectiveWeightKg("bodyweight", "", 80)).toBe(80);
  });

  it("bodyweight + null bodyweight → addedLoad only (no NaN)", () => {
    expect(effectiveWeightKg("bodyweight", "20", null)).toBe(20);
  });

  it("bodyweight + null bodyweight + 0 weight → 0 (today's behaviour, no NaN)", () => {
    expect(effectiveWeightKg("bodyweight", "0", null)).toBe(0);
  });

  it("non-bodyweight (barbell) → addedLoad only, ignores bodyweight", () => {
    expect(effectiveWeightKg("barbell", "100", 80)).toBe(100);
  });

  it("non-bodyweight 0-weight machine set stays 0 (Decision #6)", () => {
    expect(effectiveWeightKg("machine", "0", 80)).toBe(0);
  });

  it("null/undefined equipment → addedLoad only (no addend)", () => {
    expect(effectiveWeightKg(null, "100", 80)).toBe(100);
    expect(effectiveWeightKg(undefined, "100", 80)).toBe(100);
  });

  it("legacy mixed-case 'Bodyweight' does NOT trigger the addend (Decision #7)", () => {
    expect(effectiveWeightKg("Bodyweight", "0", 80)).toBe(0);
  });

  it("non-finite weight parse → 0 addedLoad (never NaN)", () => {
    expect(effectiveWeightKg("bodyweight", "abc", 80)).toBe(80);
    expect(effectiveWeightKg("barbell", "abc", null)).toBe(0);
  });

  it("non-finite bodyweight → treated as 0 addend (never NaN)", () => {
    expect(effectiveWeightKg("bodyweight", "20", Number.NaN)).toBe(20);
  });
});

describe("effectiveWeightKg — leverage factor (MAJ-2 STRING-aware)", () => {
  // `bodyweight_factor` is a `numeric` column → PostgREST returns it as a JSON
  // STRING ("0.64"). Every factor case asserts with STRING inputs (with teeth)
  // so a number-literal false-green can't hide the string-drop bug. The
  // coalesce target is 1.0 (NEVER 0).

  // 1. Push-up at "0.64" (STRING): 80 * 0.64 + 0 = 51.2.
  it("push-up factor '0.64' (STRING) scales the bodyweight only", () => {
    expect(effectiveWeightKg("bodyweight", "0", 80, "0.64")).toBe(51.2);
  });

  // 2. Push-up with added load (STRING factor): 80*0.64 + 10 = 61.2.
  //    addedLoad is NOT scaled (NOT (80+10)*0.64 = 57.6).
  it("addedLoad is NEVER scaled by the factor (bw*f + addedLoad)", () => {
    expect(effectiveWeightKg("bodyweight", "10", 80, "0.64")).toBe(61.2);
  });

  // 3. Dip at "1.0" (STRING) = today's number.
  it("factor '1.0' (STRING) reproduces the pre-feature number", () => {
    expect(effectiveWeightKg("bodyweight", "0", 80, "1.0")).toBe(80);
  });

  // 4. Weighted dip (STRING factor): 80*1 + 30 = 110 (belt leveraged at 1.0).
  it("weighted dip: belt load leveraged at 1.0 (unscaled)", () => {
    expect(effectiveWeightKg("bodyweight", "30", 80, "1.0")).toBe(110);
  });

  // 5. Reclassified-three retroactive: an equipment='bodyweight' row with
  //    factor "1.0" produces bodyweight volume where it produced 0 before.
  it("reclassified bodyweight row with factor '1.0' contributes bodyweight (was 0)", () => {
    // Pull Up: bw 80, factor "1.0", per-rep effective weight = 80.
    expect(effectiveWeightKg("bodyweight", "0", 80, "1.0")).toBe(80);
  });

  // 6. NULL factor ⇒ 1.0.
  it("NULL factor ⇒ 1.0 (no-op)", () => {
    expect(effectiveWeightKg("bodyweight", "0", 80, null)).toBe(80);
  });

  // 7. undefined / absent factor ⇒ 1.0 (Invariant L identity).
  it("absent (undefined) factor ⇒ 1.0 (Invariant L)", () => {
    expect(effectiveWeightKg("bodyweight", "0", 80)).toBe(80);
    expect(effectiveWeightKg("bodyweight", "0", 80, undefined)).toBe(80);
  });

  // 8. Non-finite STRING factor ⇒ 1.0 (NEVER 0).
  it("non-numeric STRING factor 'abc' ⇒ 1.0 (parseFloat NaN coalesce, NEVER 0)", () => {
    expect(effectiveWeightKg("bodyweight", "0", 80, "abc")).toBe(80);
  });

  it("non-finite NUMBER factor (NaN/±Infinity) ⇒ 1.0 (NEVER 0)", () => {
    expect(effectiveWeightKg("bodyweight", "0", 80, Number.NaN)).toBe(80);
    expect(effectiveWeightKg("bodyweight", "0", 80, Number.POSITIVE_INFINITY)).toBe(80);
    expect(effectiveWeightKg("bodyweight", "0", 80, Number.NEGATIVE_INFINITY)).toBe(80);
  });

  // 9. Stored finite "0" honored (deliberate value, distinct from NULL).
  it("stored finite '0' is HONORED (80*0 + addedLoad), NOT coalesced", () => {
    expect(effectiveWeightKg("bodyweight", "10", 80, "0")).toBe(10);
    expect(effectiveWeightKg("bodyweight", "0", 80, "0")).toBe(0);
  });

  // 10. Non-bodyweight ignores the factor entirely.
  it("non-bodyweight equipment never reads the factor", () => {
    expect(effectiveWeightKg("barbell", "100", 80, "0.64")).toBe(100);
    expect(effectiveWeightKg("machine", "0", 80, "0.64")).toBe(0);
  });

  // 11. Defensive number path: a number still works (strictly safer).
  it("defensive number factor 0.64 still works (strictly safer)", () => {
    expect(effectiveWeightKg("bodyweight", "0", 80, 0.64)).toBe(51.2);
  });

  // Legacy mixed-case "Bodyweight" never triggers the branch ⇒ never reads
  // the factor.
  it("legacy 'Bodyweight' token never reads the factor (addedLoad only)", () => {
    expect(effectiveWeightKg("Bodyweight", "0", 80, "0.64")).toBe(0);
  });
});

describe("bodyweightKgAsOf", () => {
  it("undefined / empty measurements → null", () => {
    expect(bodyweightKgAsOf(undefined, ms("2026-05-01T00:00:00Z"))).toBeNull();
    expect(bodyweightKgAsOf([], ms("2026-05-01T00:00:00Z"))).toBeNull();
  });

  it("nearest PRIOR weigh-in wins over an earlier prior", () => {
    const measurements = [
      mkMeasurement("2026-01-01T00:00:00Z", "70"),
      mkMeasurement("2026-04-01T00:00:00Z", "78"), // nearest prior
    ];
    expect(bodyweightKgAsOf(measurements, ms("2026-05-01T00:00:00Z"))).toBe(78);
  });

  it("falls back to nearest LATER weigh-in when no prior exists", () => {
    const measurements = [
      mkMeasurement("2026-06-01T00:00:00Z", "82"), // nearest later
      mkMeasurement("2026-09-01T00:00:00Z", "85"),
    ];
    expect(bodyweightKgAsOf(measurements, ms("2026-05-01T00:00:00Z"))).toBe(82);
  });

  it("prior is preferred even when a closer later weigh-in exists", () => {
    const measurements = [
      mkMeasurement("2026-01-01T00:00:00Z", "70"), // far prior
      mkMeasurement("2026-05-02T00:00:00Z", "82"), // closer, but LATER
    ];
    // Prior-priority: returns 70 (the honest "what did I weigh then"), NOT 82.
    expect(bodyweightKgAsOf(measurements, ms("2026-05-01T00:00:00Z"))).toBe(70);
  });

  it("returns null when no finite weight_kg exists anywhere", () => {
    const measurements = [
      mkMeasurement("2026-01-01T00:00:00Z", null), // circumference-only
      mkMeasurement("2026-04-01T00:00:00Z", null),
    ];
    expect(bodyweightKgAsOf(measurements, ms("2026-05-01T00:00:00Z"))).toBeNull();
  });

  it("skips entries with null weight_kg (picks the nearest prior with a finite weight)", () => {
    const measurements = [
      mkMeasurement("2026-04-15T00:00:00Z", null), // nearest prior, but null
      mkMeasurement("2026-04-01T00:00:00Z", "78"), // next prior, finite
    ];
    expect(bodyweightKgAsOf(measurements, ms("2026-05-01T00:00:00Z"))).toBe(78);
  });

  it("skips entries with a non-finite weight_kg string", () => {
    const measurements = [
      mkMeasurement("2026-04-15T00:00:00Z", "abc"),
      mkMeasurement("2026-04-01T00:00:00Z", "78"),
    ];
    expect(bodyweightKgAsOf(measurements, ms("2026-05-01T00:00:00Z"))).toBe(78);
  });

  it("is order-independent (DESC input gives the same result as ASC)", () => {
    const asc = [
      mkMeasurement("2026-01-01T00:00:00Z", "70"),
      mkMeasurement("2026-04-01T00:00:00Z", "78"),
    ];
    const desc = [...asc].reverse();
    const instant = ms("2026-05-01T00:00:00Z");
    expect(bodyweightKgAsOf(asc, instant)).toBe(
      bodyweightKgAsOf(desc, instant),
    );
    expect(bodyweightKgAsOf(desc, instant)).toBe(78);
  });

  it("exact-instant tie: a weigh-in measured at exactly instantMs counts as PRIOR", () => {
    const instantIso = "2026-05-01T09:00:00Z";
    const measurements = [
      mkMeasurement(instantIso, "80"), // exactly at the session start
      mkMeasurement("2026-06-01T00:00:00Z", "85"), // later
    ];
    expect(bodyweightKgAsOf(measurements, ms(instantIso))).toBe(80);
  });
});
