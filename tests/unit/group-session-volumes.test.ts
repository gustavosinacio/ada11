/**
 * Pure tests for `groupSessionVolumes`.
 *
 * `WeeklyVolumeRow` is server-pre-filtered to non-warmup, non-deleted,
 * `completed_at != null`, `sessions.ended_at != null` rows — but the
 * kernel (`sumLiveVolume`) is still applied here for cross-surface
 * consistency. These tests cover both the canonical case (pre-filtered
 * rows in, totals out) AND the defensive case (hypothetical warmup /
 * null-completed_at rows, which the kernel still must skip).
 *
 * Mirrors `progress-page-math.test.ts` and `session-header-total-volume.test.ts`
 * shape: vitest, no RNTL, fixture-builder, pure.
 */

import { describe, expect, it } from "vitest";

import type { WeeklyVolumeRow } from "~/api/stats";
import type { SetType } from "~/db/types";
import { groupSessionVolumes } from "~/utils/progress-page-math";

type RowOverrides = Partial<WeeklyVolumeRow> & {
  session_id: string;
  weight: string | null;
  reps: number | null;
};

function mkRow(overrides: RowOverrides): WeeklyVolumeRow {
  return {
    // Use `in`-check so an explicit `null` (or `undefined`) override
    // is honored — the kernel's null-completed_at guard test depends
    // on the value surviving as-passed, not being defaulted by `??`.
    completed_at:
      "completed_at" in overrides
        ? (overrides.completed_at as string)
        : "2026-05-23T10:00:00Z",
    weight: overrides.weight,
    reps: overrides.reps,
    set_type: (overrides.set_type ?? "working") as SetType,
    exercise_id: overrides.exercise_id ?? "ex-1",
    session_id: overrides.session_id,
    // MIN-4: default barbell so existing assertions stay green.
    exercises: overrides.exercises ?? { equipment: "barbell" },
    sessions: overrides.sessions ?? {
      started_at: "2026-05-23T09:00:00Z",
      ended_at: "2026-05-23T10:30:00Z",
    },
  };
}

describe("groupSessionVolumes — base cases", () => {
  it("returns an empty Map for an empty input", () => {
    const map = groupSessionVolumes([]);
    expect(map.size).toBe(0);
  });

  it("groups two sets from the same session and sums w*r", () => {
    const map = groupSessionVolumes([
      mkRow({ session_id: "sid-A", weight: "100", reps: 10 }),
      mkRow({ session_id: "sid-A", weight: "100", reps: 8 }),
    ]);
    expect(map.size).toBe(1);
    expect(map.get("sid-A")).toBe(100 * 10 + 100 * 8); // 1800
  });

  it("splits rows across two sessions and totals each independently", () => {
    const map = groupSessionVolumes([
      mkRow({ session_id: "sid-A", weight: "100", reps: 10 }), // 1000
      mkRow({ session_id: "sid-B", weight: "50", reps: 10 }), // 500
    ]);
    expect(map.size).toBe(2);
    expect(map.get("sid-A")).toBe(1000);
    expect(map.get("sid-B")).toBe(500);
  });
});

describe("groupSessionVolumes — kernel guards", () => {
  it("excludes a warmup row alongside a working row (kernel rule)", () => {
    const map = groupSessionVolumes([
      mkRow({
        session_id: "sid-A",
        weight: "60",
        reps: 10,
        set_type: "warmup",
      }),
      mkRow({ session_id: "sid-A", weight: "100", reps: 5 }),
    ]);
    expect(map.get("sid-A")).toBe(500); // warmup row dropped
  });

  it("excludes a row with null completed_at (kernel guard, even if server pre-filters)", () => {
    const map = groupSessionVolumes([
      mkRow({
        session_id: "sid-A",
        weight: "100",
        reps: 5,
        completed_at: null as unknown as string,
      }),
      mkRow({ session_id: "sid-A", weight: "100", reps: 5 }),
    ]);
    expect(map.get("sid-A")).toBe(500);
  });

  it("excludes rows where weight is '0' (w > 0 guard)", () => {
    const map = groupSessionVolumes([
      mkRow({ session_id: "sid-A", weight: "0", reps: 10 }),
      mkRow({ session_id: "sid-A", weight: "100", reps: 5 }),
    ]);
    expect(map.get("sid-A")).toBe(500);
  });

  it("excludes rows where reps is 0 (r > 0 guard)", () => {
    const map = groupSessionVolumes([
      mkRow({ session_id: "sid-A", weight: "100", reps: 0 }),
      mkRow({ session_id: "sid-A", weight: "100", reps: 5 }),
    ]);
    expect(map.get("sid-A")).toBe(500);
  });

  it("excludes rows where weight is null", () => {
    const map = groupSessionVolumes([
      mkRow({ session_id: "sid-A", weight: null, reps: 5 }),
      mkRow({ session_id: "sid-A", weight: "100", reps: 5 }),
    ]);
    expect(map.get("sid-A")).toBe(500);
  });

  it("excludes rows where reps is null", () => {
    const map = groupSessionVolumes([
      mkRow({ session_id: "sid-A", weight: "100", reps: null }),
      mkRow({ session_id: "sid-A", weight: "100", reps: 5 }),
    ]);
    expect(map.get("sid-A")).toBe(500);
  });

  it("counts a dropset row alongside a working row (kernel rule: dropsets in)", () => {
    const map = groupSessionVolumes([
      mkRow({ session_id: "sid-A", weight: "100", reps: 5 }), // 500
      mkRow({
        session_id: "sid-A",
        weight: "60",
        reps: 10,
        set_type: "dropset",
      }), // 600
    ]);
    expect(map.get("sid-A")).toBe(1100);
  });
});

describe("groupSessionVolumes — cross-session isolation", () => {
  it("the same exercise across two sessions contributes only to its own session bucket", () => {
    const map = groupSessionVolumes([
      mkRow({
        session_id: "sid-A",
        exercise_id: "ex-1",
        weight: "100",
        reps: 5,
      }),
      mkRow({
        session_id: "sid-B",
        exercise_id: "ex-1",
        weight: "100",
        reps: 10,
      }),
    ]);
    expect(map.get("sid-A")).toBe(500);
    expect(map.get("sid-B")).toBe(1000);
  });

  it("a session with only warmups (or otherwise all-excluded rows) totals to 0", () => {
    const map = groupSessionVolumes([
      mkRow({
        session_id: "sid-A",
        weight: "60",
        reps: 10,
        set_type: "warmup",
      }),
    ]);
    // sid-A still appears in the map (we group eagerly), but its total is 0.
    // The presenter (`presentSessionVolumeSlot`) hides the slot when ≤ 0.
    expect(map.get("sid-A")).toBe(0);
  });
});
