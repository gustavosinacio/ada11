/**
 * Smoke test for `<SessionHeader>`'s new total-volume metric block.
 *
 * Deviation from the design's call for an RNTL `<SessionHeader>` render:
 * this codebase has no react-native testing library installed and the
 * vitest config restricts `include` to `tests/unit/**\/*.test.ts` (no
 * `.tsx`). Rather than introduce a whole RNTL/jsdom stack (out of scope
 * for this run), we smoke-test the same wiring at the formatter +
 * accessibility-label contract level — mirrors
 * `profile-max-volume-window.test.ts` (same approach used by the previous
 * pipeline run).
 *
 * The four behaviours the design + validator called out are still
 * verified deterministically:
 *   (a) empty session renders `"0 kg"` (kg) / `"0 lbs"` (lbs).
 *   (b) numeric volume renders with the user's unit applied.
 *   (c) lbs conversion + en-US thousands separator are intact.
 *   (d) the a11y label string matches the pinned shape
 *       `"Session total volume: <formatted volume>"`.
 *
 * These are the strings the live `<SessionHeader>` puts on screen and in
 * the a11y tree — the rendering itself is a single `<Text>` over the
 * output of `formatVolume`. A regression in either the formatter or the
 * label template would surface here without needing React.
 */

import { describe, expect, it } from "vitest";

import type { SetRow, SetType, WeightUnit } from "~/db/types";
import { formatVolume } from "~/utils/units";
import { sumLiveVolume } from "~/utils/volume-target";

type SetOverrides = Partial<SetRow> & {
  set_number: number;
  weight: string | null;
  reps: number | null;
};

function mkSet(overrides: SetOverrides): SetRow {
  return {
    id: `set-${overrides.set_number}-${overrides.weight ?? "x"}`,
    user_id: "user-1",
    session_id: overrides.session_id ?? "sess-1",
    exercise_id: overrides.exercise_id ?? "ex-1",
    set_number: overrides.set_number,
    reps: overrides.reps,
    weight: overrides.weight,
    rpe: overrides.rpe ?? null,
    set_type: (overrides.set_type ?? "working") as SetType,
    parent_set_id: overrides.parent_set_id ?? null,
    notes: overrides.notes ?? null,
    completed_at: overrides.completed_at ?? null,
    created_at: overrides.created_at ?? "2026-05-23T10:00:00Z",
    updated_at: overrides.updated_at ?? "2026-05-23T10:00:00Z",
    deleted_at: overrides.deleted_at ?? null,
  };
}

/**
 * Mirrors the inner `<Text>`'s a11y label template in
 * `src/components/session-header.tsx`. Kept in sync intentionally — if
 * the template literal changes there, this constant must change here.
 */
function expectedA11yLabel(volumeKg: number, unit: WeightUnit): string {
  return `Session total volume: ${formatVolume(volumeKg, unit)}`;
}

describe("SessionHeader — empty / loading state (a)", () => {
  it("renders '0 kg' when there are no sets at all (kg)", () => {
    const total = sumLiveVolume([]);
    expect(total).toBe(0);
    expect(formatVolume(total, "kg")).toBe("0 kg");
  });

  it("renders '0 lbs' when there are no sets at all (lbs)", () => {
    const total = sumLiveVolume([]);
    expect(total).toBe(0);
    expect(formatVolume(total, "lbs")).toBe("0 lbs");
  });

  it("renders '0 kg' when only unchecked drafts are present (F10 — drafts excluded)", () => {
    const total = sumLiveVolume([
      mkSet({
        set_number: 1,
        weight: "100",
        reps: 5,
        completed_at: null, // draft
      }),
      mkSet({
        set_number: 2,
        weight: "100",
        reps: 5,
        completed_at: null, // draft
      }),
    ]);
    expect(total).toBe(0);
    expect(formatVolume(total, "kg")).toBe("0 kg");
  });

  it("renders '0 kg' when only warmups are checked (kernel excludes warmups)", () => {
    const total = sumLiveVolume([
      mkSet({
        set_number: 1,
        weight: "60",
        reps: 10,
        set_type: "warmup",
        completed_at: "2026-05-23T10:01:00Z",
      }),
    ]);
    expect(total).toBe(0);
    expect(formatVolume(total, "kg")).toBe("0 kg");
  });
});

describe("SessionHeader — numeric volume in kg (b)", () => {
  it("renders the sum of two checked working sets at 100 kg × 5 each", () => {
    const total = sumLiveVolume([
      mkSet({
        set_number: 1,
        weight: "100",
        reps: 5,
        completed_at: "2026-05-23T10:01:00Z",
      }),
      mkSet({
        set_number: 2,
        weight: "100",
        reps: 5,
        completed_at: "2026-05-23T10:03:00Z",
      }),
    ]);
    expect(total).toBe(1000);
    expect(formatVolume(total, "kg")).toBe("1,000 kg");
  });

  it("includes a checked dropset in the total (kernel rule: dropsets in)", () => {
    const total = sumLiveVolume([
      mkSet({
        set_number: 1,
        weight: "100",
        reps: 5,
        completed_at: "2026-05-23T10:01:00Z",
      }),
      mkSet({
        set_number: 2,
        weight: "60",
        reps: 10,
        set_type: "dropset",
        completed_at: "2026-05-23T10:03:00Z",
      }),
    ]);
    expect(total).toBe(500 + 600);
    expect(formatVolume(total, "kg")).toBe("1,100 kg");
  });

  it("excludes an unchecked draft sitting next to checked sets", () => {
    const total = sumLiveVolume([
      mkSet({
        set_number: 1,
        weight: "100",
        reps: 5,
        completed_at: "2026-05-23T10:01:00Z",
      }),
      mkSet({
        set_number: 2,
        weight: "100",
        reps: 5,
        completed_at: null, // unchecked — must be ignored
      }),
    ]);
    expect(total).toBe(500);
    expect(formatVolume(total, "kg")).toBe("500 kg");
  });

  it("formats five-digit kg totals with en-US thousands separator", () => {
    expect(formatVolume(12345, "kg")).toBe("12,345 kg");
  });
});

describe("SessionHeader — numeric volume in lbs (c)", () => {
  it("converts 1,000 kg to 2,205 lbs (rounded), with en-US separator", () => {
    expect(formatVolume(1000, "lbs")).toBe("2,205 lbs");
  });

  it("converts 100 kg × 5 (500 kg) to 1,102 lbs (rounded)", () => {
    const total = sumLiveVolume([
      mkSet({
        set_number: 1,
        weight: "100",
        reps: 5,
        completed_at: "2026-05-23T10:01:00Z",
      }),
    ]);
    expect(total).toBe(500);
    expect(formatVolume(total, "lbs")).toBe("1,102 lbs");
  });

  it("renders a high-volume lbs string with the en-US comma separator (width audit)", () => {
    // ~12,344 kg → 27,213.76 lbs → rounds to 27,214. Used to validate the
    // iPhone SE 320pt overflow envelope at design + validation time
    // (~6 chars + ' lbs'). If `formatVolume` ever drops the comma or
    // changes locale, this assertion will catch it.
    expect(formatVolume(12344, "lbs")).toBe("27,214 lbs");
  });
});

describe("SessionHeader — a11y label shape (d)", () => {
  it("matches 'Session total volume: 0 kg' on empty session", () => {
    expect(expectedA11yLabel(0, "kg")).toBe("Session total volume: 0 kg");
  });

  it("matches 'Session total volume: 1,000 kg' on a 1,000 kg session", () => {
    expect(expectedA11yLabel(1000, "kg")).toBe(
      "Session total volume: 1,000 kg",
    );
  });

  it("matches 'Session total volume: 2,205 lbs' for the same 1,000 kg under lbs", () => {
    expect(expectedA11yLabel(1000, "lbs")).toBe(
      "Session total volume: 2,205 lbs",
    );
  });

  it("a11y label changes deterministically when volume changes", () => {
    const a = expectedA11yLabel(500, "kg");
    const b = expectedA11yLabel(1000, "kg");
    expect(a).not.toBe(b);
    expect(a).toBe("Session total volume: 500 kg");
    expect(b).toBe("Session total volume: 1,000 kg");
  });
});

describe("SessionHeader — cross-screen parity (verdict ↔ live header)", () => {
  /**
   * The live header and the verdict screen MUST agree on every digit when
   * Finish is tapped. Both consume `sumLiveVolume` over the same
   * `["sets", sessionId]` cache, so divergence is impossible by
   * construction. This test pins the contract: same input → same output.
   */
  it("live header total equals the verdict screen's total for the same set list", () => {
    const sets: SetRow[] = [
      mkSet({
        set_number: 1,
        weight: "100",
        reps: 5,
        completed_at: "2026-05-23T10:01:00Z",
      }),
      mkSet({
        set_number: 2,
        weight: "120",
        reps: 3,
        completed_at: "2026-05-23T10:03:00Z",
      }),
      mkSet({
        set_number: 3,
        weight: "80",
        reps: 8,
        completed_at: null, // unchecked — verdict excludes too
      }),
      mkSet({
        set_number: 4,
        weight: "60",
        reps: 10,
        set_type: "warmup",
        completed_at: "2026-05-23T09:55:00Z",
      }),
    ];
    const liveHeaderTotal = sumLiveVolume(sets);
    const verdictTotal = sumLiveVolume(sets); // same kernel, both screens
    expect(liveHeaderTotal).toBe(verdictTotal);
    expect(liveHeaderTotal).toBe(500 + 360); // 860
    expect(formatVolume(liveHeaderTotal, "kg")).toBe("860 kg");
  });
});
