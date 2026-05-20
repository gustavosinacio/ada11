import { describe, expect, it } from "vitest";

import { cmToIn, formatLength, inToCm, parseLengthToCm } from "~/utils/units";

describe("cmToIn / inToCm", () => {
  it("round-trips with high precision", () => {
    const cm = 91.4;
    expect(inToCm(cmToIn(cm))).toBeCloseTo(cm, 6);
  });

  it("converts known values", () => {
    expect(cmToIn(2.54)).toBeCloseTo(1, 6);
    expect(inToCm(1)).toBeCloseTo(2.54, 6);
  });

  it("zero is identity", () => {
    expect(cmToIn(0)).toBe(0);
    expect(inToCm(0)).toBe(0);
  });
});

describe("formatLength", () => {
  it("returns '—' for null and undefined", () => {
    expect(formatLength(null, "cm")).toBe("—");
    expect(formatLength(undefined, "in")).toBe("—");
  });

  it("formats cm with one decimal in cm mode", () => {
    expect(formatLength(91.4, "cm")).toBe("91.4 cm");
    expect(formatLength(100, "cm")).toBe("100.0 cm");
  });

  it("converts to inches in 'in' mode", () => {
    // 2.54 cm = 1 in
    expect(formatLength(2.54, "in")).toBe("1.0 in");
    // 91.44 cm = 36 in (one yard)
    expect(formatLength(91.44, "in")).toBe("36.0 in");
  });
});

describe("parseLengthToCm", () => {
  it("returns null for empty / NaN", () => {
    expect(parseLengthToCm("", "cm")).toBeNull();
    expect(parseLengthToCm("abc", "cm")).toBeNull();
  });

  it("passes through cm input", () => {
    expect(parseLengthToCm("91.4", "cm")).toBeCloseTo(91.4, 6);
  });

  it("converts inches input to cm", () => {
    // "1" in -> 2.54 cm
    expect(parseLengthToCm("1", "in")).toBeCloseTo(2.54, 6);
  });

  it("accepts comma decimal separator", () => {
    expect(parseLengthToCm("91,4", "cm")).toBeCloseTo(91.4, 6);
  });

  it("round-trips with formatLength", () => {
    // cm round-trip
    const cm = 91.4;
    const formattedCm = formatLength(cm, "cm");
    const numberFromCm = parseFloat(formattedCm.split(" ")[0]!);
    expect(parseLengthToCm(String(numberFromCm), "cm")).toBeCloseTo(cm, 1);

    // in round-trip — format then re-parse should preserve cm value to 1 dp
    const formattedIn = formatLength(cm, "in");
    const numberFromIn = parseFloat(formattedIn.split(" ")[0]!);
    expect(parseLengthToCm(String(numberFromIn), "in")).toBeCloseTo(cm, 1);
  });
});
