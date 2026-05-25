/**
 * Unit tests for `computeAutoFillPayload` — the pure helper behind the
 * "auto-fill checked set from placeholder" feature.
 *
 * Run-id: 2026-05-24_2020_auto-fill-placeholder-on-check
 *
 * The 8 canonical cases from design v3 §"Unit test cases" plus retained
 * edge cases (cases 9-12). Predicate is pure-string in / pure-shape out;
 * `set_type` gating lives in the screen handler, NOT here.
 */

import { describe, expect, it } from "vitest";

import { computeAutoFillPayload } from "~/utils/auto-fill-set";

describe("computeAutoFillPayload", () => {
  it("Case 1: both empty + previous {120.00, 8} → fill both", () => {
    const out = computeAutoFillPayload({
      currentInput: { weight: "", reps: "" },
      previous: { weight: "120.00", reps: 8 },
    });
    expect(out).toEqual({ weight: "120.00", reps: 8 });
  });

  it("Case 2: weight=\"0\" + reps=\"\" + previous {120.00, 8} → fill both (zero counts as empty)", () => {
    const out = computeAutoFillPayload({
      currentInput: { weight: "0", reps: "" },
      previous: { weight: "120.00", reps: 8 },
    });
    expect(out).toEqual({ weight: "120.00", reps: 8 });
  });

  it("Case 3: weight=\"100\" typed + reps empty + previous {120.00, 8} → fill only reps", () => {
    const out = computeAutoFillPayload({
      currentInput: { weight: "100", reps: "" },
      previous: { weight: "120.00", reps: 8 },
    });
    expect(out).toEqual({ reps: 8 });
  });

  it("Case 4: weight empty + reps=\"8\" typed + previous {120.00, 10} → fill only weight", () => {
    const out = computeAutoFillPayload({
      currentInput: { weight: "", reps: "8" },
      previous: { weight: "120.00", reps: 10 },
    });
    expect(out).toEqual({ weight: "120.00" });
  });

  it("Case 5: both empty + previous null → null (no source)", () => {
    const out = computeAutoFillPayload({
      currentInput: { weight: "", reps: "" },
      previous: null,
    });
    expect(out).toBeNull();
  });

  it("Case 6: both empty + previous {0, 8} → reps only (zero-weight source unusable)", () => {
    const out = computeAutoFillPayload({
      currentInput: { weight: "", reps: "" },
      previous: { weight: "0", reps: 8 },
    });
    expect(out).toEqual({ reps: 8 });
  });

  it("Case 7: both empty + previous {120.00, 0} → weight only (zero-reps source unusable)", () => {
    const out = computeAutoFillPayload({
      currentInput: { weight: "", reps: "" },
      previous: { weight: "120.00", reps: 0 },
    });
    expect(out).toEqual({ weight: "120.00" });
  });

  it("Case 8: both inputs zero + previous {0, 0} → null (both sources unusable)", () => {
    const out = computeAutoFillPayload({
      currentInput: { weight: "0", reps: "0" },
      previous: { weight: "0", reps: 0 },
    });
    expect(out).toBeNull();
  });

  it("Case 9 (edge): previous undefined → null (treated like null)", () => {
    const out = computeAutoFillPayload({
      currentInput: { weight: "", reps: "" },
      previous: undefined,
    });
    expect(out).toBeNull();
  });

  it("Case 10 (edge): both inputs typed non-zero → null (nothing to fill)", () => {
    const out = computeAutoFillPayload({
      currentInput: { weight: "100.00", reps: "8" },
      previous: { weight: "120.00", reps: 10 },
    });
    expect(out).toBeNull();
  });

  it("Case 11 (edge): weight=\"0.00\" parses to 0 → treated as empty, fills both", () => {
    const out = computeAutoFillPayload({
      currentInput: { weight: "0.00", reps: "" },
      previous: { weight: "120.00", reps: 8 },
    });
    expect(out).toEqual({ weight: "120.00", reps: 8 });
  });

  it("Case 12 (edge): previous.weight=\"0.00\" parses to 0 → unusable, reps only", () => {
    const out = computeAutoFillPayload({
      currentInput: { weight: "", reps: "" },
      previous: { weight: "0.00", reps: 8 },
    });
    expect(out).toEqual({ reps: 8 });
  });

  it("comma-decimal weight (\"0,5\") is honored as a typed non-zero value (matches set-input's parseFloat0)", () => {
    const out = computeAutoFillPayload({
      currentInput: { weight: "0,5", reps: "" },
      previous: { weight: "120.00", reps: 8 },
    });
    // weight already typed (0.5 > 0) → not empty → only reps filled.
    expect(out).toEqual({ reps: 8 });
  });

  it("never returns explicit null in patch keys (no { weight: null })", () => {
    // Confirm the contract: when the helper can't fill, it OMITS the key.
    const out = computeAutoFillPayload({
      currentInput: { weight: "", reps: "8" },
      previous: { weight: null, reps: 10 },
    });
    // No fill possible for weight (previous.weight null) and reps is typed.
    expect(out).toBeNull();

    const out2 = computeAutoFillPayload({
      currentInput: { weight: "", reps: "" },
      previous: { weight: null, reps: 8 },
    });
    expect(out2).toEqual({ reps: 8 });
    expect("weight" in (out2 ?? {})).toBe(false);
  });

  it("whitespace-only input strings count as empty", () => {
    const out = computeAutoFillPayload({
      currentInput: { weight: "  ", reps: "\t" },
      previous: { weight: "120.00", reps: 8 },
    });
    expect(out).toEqual({ weight: "120.00", reps: 8 });
  });
});
