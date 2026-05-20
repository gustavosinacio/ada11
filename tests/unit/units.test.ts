import { describe, expect, it } from "vitest";

import { formatVolume, formatWeight, kgToLbs, lbsToKg } from "~/utils/units";

describe("formatVolume", () => {
  it("returns '—' for null and undefined", () => {
    expect(formatVolume(null, "kg")).toBe("—");
    expect(formatVolume(undefined, "kg")).toBe("—");
    expect(formatVolume(null, "lbs")).toBe("—");
  });

  it("renders whole-number kg under 1000 without decimals", () => {
    expect(formatVolume(840, "kg")).toBe("840 kg");
    expect(formatVolume(1, "kg")).toBe("1 kg");
    expect(formatVolume(0, "kg")).toBe("0 kg");
  });

  it("rounds to nearest int under 1000", () => {
    expect(formatVolume(840.4, "kg")).toBe("840 kg");
    expect(formatVolume(840.6, "kg")).toBe("841 kg");
  });

  it("applies k-shorthand with one decimal at >= 1000", () => {
    expect(formatVolume(1000, "kg")).toBe("1.0k kg");
    expect(formatVolume(12400, "kg")).toBe("12.4k kg");
    expect(formatVolume(2500, "kg")).toBe("2.5k kg");
  });

  it("MIN-3 boundary: 999.5 kg rounds up to k-shorthand (no kg-only cliff)", () => {
    expect(formatVolume(999.5, "kg")).toBe("1.0k kg");
    expect(formatVolume(999.4, "kg")).toBe("999 kg");
  });

  it("converts kg to lbs before formatting when unit is lbs", () => {
    // 100 kg ~ 220.46 lbs (< 1000 -> whole-number)
    expect(formatVolume(100, "lbs")).toBe("220 lbs");
    // 500 kg ~ 1102.3 lbs (>= 1000 -> k-shorthand)
    expect(formatVolume(500, "lbs")).toBe("1.1k lbs");
  });

  it("does NOT affect existing formatWeight (regression check)", () => {
    expect(formatWeight(100, "kg")).toBe("100.0 kg");
    expect(formatWeight(null, "kg")).toBe("—");
    expect(formatWeight(45.5, "lbs")).toBe(`${kgToLbs(45.5).toFixed(1)} lbs`);
  });
});

describe("unit conversion helpers (regression check)", () => {
  it("kgToLbs / lbsToKg are still round-trip safe", () => {
    const kg = 102.5;
    expect(lbsToKg(kgToLbs(kg))).toBeCloseTo(kg, 6);
  });
});
