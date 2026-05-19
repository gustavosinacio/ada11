import { describe, expect, it } from "vitest";

import { epley1RM } from "~/utils/formulas";

describe("epley1RM", () => {
  it("returns the weight unchanged for a single rep", () => {
    expect(epley1RM(100, 1)).toBe(100);
  });

  it("estimates 1RM for multiple reps via the Epley formula", () => {
    // Epley: w * (1 + r/30)
    // 100 kg × 5 reps → 100 × (1 + 5/30) = 116.666...
    expect(epley1RM(100, 5)).toBeCloseTo(116.667, 3);
    // 80 kg × 10 reps → 80 × (1 + 10/30) = 106.666...
    expect(epley1RM(80, 10)).toBeCloseTo(106.667, 3);
  });

  it("returns 0 for non-positive reps", () => {
    expect(epley1RM(100, 0)).toBe(0);
    expect(epley1RM(100, -3)).toBe(0);
  });

  it("returns 0 for non-positive weight", () => {
    expect(epley1RM(0, 5)).toBe(0);
    expect(epley1RM(-20, 5)).toBe(0);
  });

  it("is monotonic in reps for the same weight", () => {
    // More reps at the same weight ⇒ stronger ⇒ higher estimated 1RM.
    const e1 = epley1RM(100, 3);
    const e2 = epley1RM(100, 5);
    const e3 = epley1RM(100, 8);
    expect(e1).toBeLessThan(e2);
    expect(e2).toBeLessThan(e3);
  });
});
