/**
 * Unit tests for `computeVolumeTarget`. Pure function — verifies all three
 * discriminated states (`no-pr`, `chasing`, `surpassed`), kernel correctness
 * (warmup exclusion, guards), and the MAJ-1 regression: "current weight" is
 * picked by max(set_number), not by last-in-array order.
 */

import { describe, expect, it } from "vitest";

import type { SessionSets } from "~/api/progress";
import type { SetRow, SetType } from "~/db/types";
import { computeVolumeTarget } from "~/utils/volume-target";

type SetOverrides = Partial<SetRow> & {
  set_number: number;
  weight: string | null;
  reps: number | null;
};

function mkSet(overrides: SetOverrides): SetRow {
  return {
    id: `set-${overrides.set_number}-${overrides.weight ?? "x"}`,
    user_id: "user-1",
    session_id: overrides.session_id ?? "sess-current",
    exercise_id: overrides.exercise_id ?? "ex-1",
    set_number: overrides.set_number,
    reps: overrides.reps,
    weight: overrides.weight,
    rpe: overrides.rpe ?? null,
    set_type: (overrides.set_type ?? "working") as SetType,
    parent_set_id: overrides.parent_set_id ?? null,
    notes: overrides.notes ?? null,
    completed_at: overrides.completed_at ?? null,
    created_at: overrides.created_at ?? "2026-05-21T10:00:00Z",
    updated_at: overrides.updated_at ?? "2026-05-21T10:00:00Z",
    deleted_at: overrides.deleted_at ?? null,
  };
}

function mkSession(id: string, sets: SetRow[]): SessionSets {
  return {
    session_id: id,
    started_at: "2026-05-20T10:00:00Z",
    sets,
  };
}

describe("computeVolumeTarget — no-pr state", () => {
  it("returns no-pr when pastSessions is undefined (loading)", () => {
    const state = computeVolumeTarget({
      pastSessions: undefined,
      currentSessionSets: [
        mkSet({ set_number: 1, weight: "100", reps: 5 }),
      ],
    });
    expect(state.kind).toBe("no-pr");
  });

  it("returns no-pr when pastSessions is empty", () => {
    const state = computeVolumeTarget({
      pastSessions: [],
      currentSessionSets: [
        mkSet({ set_number: 1, weight: "100", reps: 5 }),
      ],
    });
    expect(state.kind).toBe("no-pr");
  });

  it("returns no-pr when all past sessions sum to zero volume", () => {
    const state = computeVolumeTarget({
      pastSessions: [
        // Only warmups — excluded by the kernel.
        mkSession("s1", [
          mkSet({
            set_number: 1,
            weight: "60",
            reps: 10,
            set_type: "warmup",
          }),
        ]),
        // Invalid weight/reps — guard rejects.
        mkSession("s2", [
          mkSet({ set_number: 1, weight: null, reps: 10 }),
          mkSet({ set_number: 2, weight: "0", reps: 5 }),
          mkSet({ set_number: 3, weight: "100", reps: 0 }),
        ]),
      ],
      currentSessionSets: [
        mkSet({ set_number: 1, weight: "100", reps: 5 }),
      ],
    });
    expect(state.kind).toBe("no-pr");
  });
});

describe("computeVolumeTarget — chasing state", () => {
  it("returns chasing with correct gap and reps when current weight is finite", () => {
    // Previous best session: 100 × 10 = 1000 kg.
    const past = [
      mkSession("s1", [
        mkSet({ set_number: 1, weight: "100", reps: 10 }),
      ]),
    ];
    // Running: 100 × 5 = 500 kg. Gap = 500. Current weight = 100 → reps to beat = 5.
    const current = [mkSet({ set_number: 1, weight: "100", reps: 5 })];

    const state = computeVolumeTarget({
      pastSessions: past,
      currentSessionSets: current,
    });
    expect(state.kind).toBe("chasing");
    if (state.kind !== "chasing") return;
    expect(state.previousMaxKg).toBe(1000);
    expect(state.runningKg).toBe(500);
    expect(state.gapKg).toBe(500);
    expect(state.currentWeightKg).toBe(100);
    expect(state.repsToBeat).toBe(5);
  });

  it("returns floating-point reps when gap is not a multiple of current weight", () => {
    const past = [
      mkSession("s1", [
        mkSet({ set_number: 1, weight: "100", reps: 10 }), // 1000 kg
      ]),
    ];
    // Running: 80 × 5 = 400. Gap = 600. Current weight = 80 → 600 / 80 = 7.5.
    const current = [mkSet({ set_number: 1, weight: "80", reps: 5 })];

    const state = computeVolumeTarget({
      pastSessions: past,
      currentSessionSets: current,
    });
    expect(state.kind).toBe("chasing");
    if (state.kind !== "chasing") return;
    expect(state.repsToBeat).toBeCloseTo(7.5, 6);
  });

  it("returns chasing with repsToBeat=null when no current set has a positive weight", () => {
    const past = [
      mkSession("s1", [
        mkSet({ set_number: 1, weight: "100", reps: 10 }),
      ]),
    ];
    const current = [
      mkSet({ set_number: 1, weight: null, reps: 5 }),
      mkSet({ set_number: 2, weight: "0", reps: 5 }),
    ];
    const state = computeVolumeTarget({
      pastSessions: past,
      currentSessionSets: current,
    });
    expect(state.kind).toBe("chasing");
    if (state.kind !== "chasing") return;
    expect(state.runningKg).toBe(0);
    expect(state.gapKg).toBe(1000);
    expect(state.currentWeightKg).toBeNull();
    expect(state.repsToBeat).toBeNull();
  });

  it("returns chasing with repsToBeat=null when currentSessionSets is empty", () => {
    const past = [
      mkSession("s1", [
        mkSet({ set_number: 1, weight: "100", reps: 10 }),
      ]),
    ];
    const state = computeVolumeTarget({
      pastSessions: past,
      currentSessionSets: [],
    });
    expect(state.kind).toBe("chasing");
    if (state.kind !== "chasing") return;
    expect(state.runningKg).toBe(0);
    expect(state.gapKg).toBe(1000);
    expect(state.currentWeightKg).toBeNull();
    expect(state.repsToBeat).toBeNull();
  });

  it("max-volume reduction picks the highest single-session total across pastSessions", () => {
    const past = [
      mkSession("s1", [
        mkSet({ set_number: 1, weight: "100", reps: 5 }), // 500
      ]),
      mkSession("s2", [
        mkSet({ set_number: 1, weight: "80", reps: 10 }), // 800
      ]),
      mkSession("s3", [
        mkSet({ set_number: 1, weight: "120", reps: 5 }), // 600
      ]),
    ];
    const state = computeVolumeTarget({
      pastSessions: past,
      currentSessionSets: [
        mkSet({ set_number: 1, weight: "100", reps: 1 }), // 100
      ],
    });
    expect(state.kind).toBe("chasing");
    if (state.kind !== "chasing") return;
    expect(state.previousMaxKg).toBe(800);
    expect(state.gapKg).toBe(700);
  });
});

describe("computeVolumeTarget — surpassed state", () => {
  it("returns surpassed with positive overflow when running exceeds previous max", () => {
    const past = [
      mkSession("s1", [
        mkSet({ set_number: 1, weight: "100", reps: 10 }), // 1000
      ]),
    ];
    const current = [
      mkSet({ set_number: 1, weight: "100", reps: 10 }), // 1000
      mkSet({ set_number: 2, weight: "100", reps: 5 }), //  500
    ]; // 1500
    const state = computeVolumeTarget({
      pastSessions: past,
      currentSessionSets: current,
    });
    expect(state.kind).toBe("surpassed");
    if (state.kind !== "surpassed") return;
    expect(state.previousMaxKg).toBe(1000);
    expect(state.runningKg).toBe(1500);
    expect(state.overflowKg).toBe(500);
  });

  it("returns surpassed with overflowKg=0 on an exact tie (MIN-2)", () => {
    const past = [
      mkSession("s1", [
        mkSet({ set_number: 1, weight: "100", reps: 10 }),
      ]),
    ];
    const current = [
      mkSet({ set_number: 1, weight: "100", reps: 10 }), // 1000 == previous max
    ];
    const state = computeVolumeTarget({
      pastSessions: past,
      currentSessionSets: current,
    });
    expect(state.kind).toBe("surpassed");
    if (state.kind !== "surpassed") return;
    expect(state.overflowKg).toBe(0);
  });
});

describe("computeVolumeTarget — warmup exclusion", () => {
  it("excludes warmups from BOTH past-max and running-volume reductions", () => {
    const past = [
      mkSession("s1", [
        mkSet({
          set_number: 1,
          weight: "200",
          reps: 50,
          set_type: "warmup",
        }), // excluded
        mkSet({ set_number: 2, weight: "100", reps: 5 }), // 500
      ]),
    ];
    const current = [
      mkSet({
        set_number: 1,
        weight: "200",
        reps: 50,
        set_type: "warmup",
      }), // excluded
      mkSet({ set_number: 2, weight: "100", reps: 2 }), // 200
    ];
    const state = computeVolumeTarget({
      pastSessions: past,
      currentSessionSets: current,
    });
    expect(state.kind).toBe("chasing");
    if (state.kind !== "chasing") return;
    expect(state.previousMaxKg).toBe(500);
    expect(state.runningKg).toBe(200);
    expect(state.gapKg).toBe(300);
  });
});

describe("computeVolumeTarget — MAJ-1 regression: current-weight pick", () => {
  it("picks the highest set_number, not the last array index", () => {
    // Simulates the array order after `listSetsForSession`:
    // checked sets first (ordered by completed_at), unchecked second.
    // set #2 was checked at 10:05, set #1 is unchecked → array order is
    // [set#2 (w=80, checked), set#1 (w=100, unchecked)].
    // Walking backwards through the array would pick set #1 (w=100); the
    // correct answer is set #2 (w=80, the most recent log).
    const past = [
      mkSession("s1", [
        mkSet({ set_number: 1, weight: "100", reps: 10 }), // 1000
      ]),
    ];
    const current = [
      mkSet({
        set_number: 2,
        weight: "80",
        reps: 5,
        completed_at: "2026-05-21T10:05:00Z",
      }),
      mkSet({
        set_number: 1,
        weight: "100",
        reps: 5,
        completed_at: null,
      }),
    ];
    const state = computeVolumeTarget({
      pastSessions: past,
      currentSessionSets: current,
    });
    expect(state.kind).toBe("chasing");
    if (state.kind !== "chasing") return;
    expect(state.currentWeightKg).toBe(80);
    // Gap = 1000 - (80*5 + 100*5) = 1000 - 900 = 100. repsToBeat = 100/80 = 1.25.
    expect(state.gapKg).toBe(100);
    expect(state.repsToBeat).toBeCloseTo(1.25, 6);
  });

  it("skips sets without a valid weight when picking current weight", () => {
    const past = [
      mkSession("s1", [
        mkSet({ set_number: 1, weight: "100", reps: 10 }),
      ]),
    ];
    const current = [
      mkSet({ set_number: 1, weight: "80", reps: 5 }), // valid (volume 400)
      mkSet({ set_number: 2, weight: null, reps: null }), // invalid: just added, empty
      mkSet({ set_number: 3, weight: "0", reps: 0 }), // invalid: zero
    ];
    const state = computeVolumeTarget({
      pastSessions: past,
      currentSessionSets: current,
    });
    expect(state.kind).toBe("chasing");
    if (state.kind !== "chasing") return;
    expect(state.currentWeightKg).toBe(80); // set #1, the only valid one
    expect(state.runningKg).toBe(400);
  });
});
