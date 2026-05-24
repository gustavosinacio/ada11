/**
 * Pure-presenter tests for `presentSessionVolumeSlot`.
 *
 * The `<SessionSummaryRow>` row composes its line-2 string by appending
 * the presenter's output to the date · duration block. The presenter
 * decides BOTH whether to render the slot (returns `null` when hidden)
 * AND what the formatted suffix looks like (`" · 12,345 kg"`, with the
 * leading space-middot-space separator baked in).
 *
 * Mirrors `session-header-total-volume.test.ts`: vitest, no RNTL, no
 * `.tsx`, no React. The vitest config only collects `tests/unit/**\/*.test.ts`.
 *
 * Coverage axes:
 *   - hide-when-absent: `null`, `undefined`, `0`, negative
 *   - show-with-format: kg (under-thousand, five-digit), lbs conversion
 *   - separator shape: every visible output starts with `" · "`
 */

import { describe, expect, it } from "vitest";

import { presentSessionVolumeSlot } from "~/utils/session-row-format";

describe("presentSessionVolumeSlot — hide cases", () => {
  it("returns null for undefined totalVolumeKg (kg)", () => {
    expect(presentSessionVolumeSlot(undefined, "kg")).toBeNull();
  });

  it("returns null for undefined totalVolumeKg (lbs)", () => {
    expect(presentSessionVolumeSlot(undefined, "lbs")).toBeNull();
  });

  it("returns null for null totalVolumeKg (kg)", () => {
    expect(presentSessionVolumeSlot(null, "kg")).toBeNull();
  });

  it("returns null for null totalVolumeKg (lbs)", () => {
    expect(presentSessionVolumeSlot(null, "lbs")).toBeNull();
  });

  it("returns null for zero totalVolumeKg (hide-on-zero contract)", () => {
    expect(presentSessionVolumeSlot(0, "kg")).toBeNull();
    expect(presentSessionVolumeSlot(0, "lbs")).toBeNull();
  });

  it("returns null for any negative totalVolumeKg (defensive)", () => {
    // sumLiveVolume can't produce negatives, but the presenter is the
    // visibility gate; if upstream math ever drifts we must not render a
    // "-5 kg" label.
    expect(presentSessionVolumeSlot(-1, "kg")).toBeNull();
    expect(presentSessionVolumeSlot(-1, "lbs")).toBeNull();
    expect(presentSessionVolumeSlot(-12345, "kg")).toBeNull();
  });
});

describe("presentSessionVolumeSlot — kg visible cases", () => {
  it("formats a five-digit kg total with the en-US thousands separator", () => {
    expect(presentSessionVolumeSlot(12345, "kg")).toBe(" · 12,345 kg");
  });

  it("formats a sub-thousand kg total without a separator", () => {
    expect(presentSessionVolumeSlot(500, "kg")).toBe(" · 500 kg");
  });

  it("rounds fractional kg values to the nearest integer", () => {
    // formatVolume uses `Math.round` — 12,345.4 → 12,345; 12,345.6 → 12,346.
    expect(presentSessionVolumeSlot(12345.4, "kg")).toBe(" · 12,345 kg");
    expect(presentSessionVolumeSlot(12345.6, "kg")).toBe(" · 12,346 kg");
  });
});

describe("presentSessionVolumeSlot — lbs visible cases (conversion)", () => {
  it("converts and formats a 1,000 kg total to '· 2,205 lbs'", () => {
    expect(presentSessionVolumeSlot(1000, "lbs")).toBe(" · 2,205 lbs");
  });

  it("converts and formats a high-volume kg total to lbs with the en-US separator", () => {
    // 12,344 kg → 27,213.76 lbs → rounds to 27,214. Matches the width audit
    // fixture in `session-header-total-volume.test.ts:202`.
    expect(presentSessionVolumeSlot(12344, "lbs")).toBe(" · 27,214 lbs");
  });

  it("converts a sub-thousand kg total to lbs", () => {
    // 500 kg → 1,102.31 lbs → rounds to 1,102.
    expect(presentSessionVolumeSlot(500, "lbs")).toBe(" · 1,102 lbs");
  });
});

describe("presentSessionVolumeSlot — separator shape contract", () => {
  it("every visible output starts with the line-2 separator ' · '", () => {
    const samples = [
      presentSessionVolumeSlot(1, "kg"),
      presentSessionVolumeSlot(500, "kg"),
      presentSessionVolumeSlot(12345, "kg"),
      presentSessionVolumeSlot(1, "lbs"),
      presentSessionVolumeSlot(12344, "lbs"),
    ];
    for (const s of samples) {
      expect(s).not.toBeNull();
      expect(s!.startsWith(" · ")).toBe(true);
    }
  });
});
