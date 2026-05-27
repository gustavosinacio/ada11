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

function mkSession(
  id: string,
  sets: SetRow[],
  startedAt?: string,
): SessionSets {
  return {
    session_id: id,
    started_at: startedAt ?? "2026-05-20T10:00:00Z",
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

describe("computeVolumeTarget — previousMaxSets (max-session breakdown)", () => {
  it("chasing: returns the sets of the session that achieved previousMaxKg", () => {
    const winner = [
      mkSet({ set_number: 1, weight: "100", reps: 8, session_id: "s2" }),
      mkSet({ set_number: 2, weight: "110", reps: 6, session_id: "s2" }),
    ]; // 800 + 660 = 1460
    const past = [
      mkSession("s1", [mkSet({ set_number: 1, weight: "100", reps: 5 })]), // 500
      mkSession("s2", winner), // 1460 — the max
    ];
    const state = computeVolumeTarget({
      pastSessions: past,
      currentSessionSets: [
        mkSet({
          set_number: 1,
          weight: "50",
          reps: 2,
          completed_at: "2026-05-21T10:05:00Z",
        }),
      ],
    });
    expect(state.kind).toBe("chasing");
    if (state.kind !== "chasing") return;
    expect(state.previousMaxKg).toBe(1460);
    // Exact reference: the winning session's set array, not the runner-up's.
    expect(state.previousMaxSets).toBe(winner);
  });

  it("surpassed: still carries the max session's sets", () => {
    const winner = [mkSet({ set_number: 1, weight: "100", reps: 10 })]; // 1000
    const state = computeVolumeTarget({
      pastSessions: [mkSession("s1", winner)],
      currentSessionSets: [
        mkSet({
          set_number: 1,
          weight: "200",
          reps: 10,
          completed_at: "2026-05-21T10:05:00Z",
        }),
      ], // 2000 > 1000 → surpassed
    });
    expect(state.kind).toBe("surpassed");
    if (state.kind !== "surpassed") return;
    expect(state.previousMaxSets).toBe(winner);
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
    const current = [
      mkSet({
        set_number: 1,
        weight: "100",
        reps: 5,
        completed_at: "2026-05-21T10:05:00Z",
      }),
    ];

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
    const current = [
      mkSet({
        set_number: 1,
        weight: "80",
        reps: 5,
        completed_at: "2026-05-21T10:05:00Z",
      }),
    ];

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
        mkSet({
          set_number: 1,
          weight: "100",
          reps: 1,
          completed_at: "2026-05-21T10:05:00Z",
        }), // 100
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
      mkSet({
        set_number: 1,
        weight: "100",
        reps: 10,
        completed_at: "2026-05-21T10:05:00Z",
      }), // 1000
      mkSet({
        set_number: 2,
        weight: "100",
        reps: 5,
        completed_at: "2026-05-21T10:06:00Z",
      }), //  500
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
      mkSet({
        set_number: 1,
        weight: "100",
        reps: 10,
        completed_at: "2026-05-21T10:05:00Z",
      }), // 1000 == previous max
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
        completed_at: "2026-05-21T10:05:00Z",
      }), // excluded
      mkSet({
        set_number: 2,
        weight: "100",
        reps: 2,
        completed_at: "2026-05-21T10:06:00Z",
      }), // 200
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
        completed_at: "2026-05-21T10:04:00Z",
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
      mkSet({
        set_number: 1,
        weight: "80",
        reps: 5,
        completed_at: "2026-05-21T10:05:00Z",
      }), // valid (volume 400)
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

describe("computeVolumeTarget — checked-only running volume", () => {
  it("excludes draft (unchecked) sets from runningKg", () => {
    // Past best: 1,000 kg. Current = [checked 100×5, draft 100×5].
    // Only the checked set should count toward Now.
    const past = [
      mkSession("s1", [
        mkSet({ set_number: 1, weight: "100", reps: 10 }), // 1000
      ]),
    ];
    const current = [
      mkSet({
        set_number: 1,
        weight: "100",
        reps: 5,
        completed_at: "2026-05-21T10:05:00Z",
      }), // checked → counts
      mkSet({
        set_number: 2,
        weight: "100",
        reps: 5,
        completed_at: null,
      }), // draft → excluded from Now, but still drives currentWeightKg
    ];
    const state = computeVolumeTarget({
      pastSessions: past,
      currentSessionSets: current,
    });
    expect(state.kind).toBe("chasing");
    if (state.kind !== "chasing") return;
    expect(state.runningKg).toBe(500);
    expect(state.gapKg).toBe(500);
    expect(state.currentWeightKg).toBe(100);
    expect(state.repsToBeat).toBe(5);
  });

  it("counts all checked working sets toward runningKg", () => {
    const past = [
      mkSession("s1", [
        mkSet({ set_number: 1, weight: "100", reps: 10 }), // 1000
      ]),
    ];
    const current = [
      mkSet({
        set_number: 1,
        weight: "100",
        reps: 3,
        completed_at: "2026-05-21T10:05:00Z",
      }), // 300
      mkSet({
        set_number: 2,
        weight: "100",
        reps: 2,
        completed_at: "2026-05-21T10:06:00Z",
      }), // 200
    ];
    const state = computeVolumeTarget({
      pastSessions: past,
      currentSessionSets: current,
    });
    expect(state.kind).toBe("chasing");
    if (state.kind !== "chasing") return;
    expect(state.runningKg).toBe(500);
    expect(state.gapKg).toBe(500);
  });

  it("a draft set still drives the currentWeightKg pick when it has the highest set_number (Decision #8)", () => {
    // Documents the deliberate decoupling: Now is checked-only, but the
    // "what weight am I on?" pick is about INTENT, so drafts still drive it.
    const past = [
      mkSession("s1", [
        mkSet({ set_number: 1, weight: "100", reps: 10 }), // 1000
      ]),
    ];
    const current = [
      mkSet({
        set_number: 1,
        weight: "60",
        reps: 5,
        completed_at: "2026-05-21T10:05:00Z",
      }), // checked → counts toward Now (300)
      mkSet({
        set_number: 2,
        weight: "80",
        reps: 5,
        completed_at: null,
      }), // draft → not counted, but drives currentWeightKg
    ];
    const state = computeVolumeTarget({
      pastSessions: past,
      currentSessionSets: current,
    });
    expect(state.kind).toBe("chasing");
    if (state.kind !== "chasing") return;
    expect(state.runningKg).toBe(300);
    expect(state.currentWeightKg).toBe(80);
    // gapKg = 1000 - 300 = 700; repsToBeat = 700 / 80 = 8.75.
    expect(state.gapKg).toBe(700);
    expect(state.repsToBeat).toBeCloseTo(8.75, 6);
  });

  it("warmup is still excluded even when checked", () => {
    // The warmup-skip predicate runs alongside the checked filter — a
    // checked warmup must NOT count toward Now.
    const past = [
      mkSession("s1", [
        mkSet({ set_number: 1, weight: "100", reps: 5 }), // 500
      ]),
    ];
    const current = [
      mkSet({
        set_number: 1,
        weight: "200",
        reps: 50,
        set_type: "warmup",
        completed_at: "2026-05-21T10:05:00Z",
      }), // checked but warmup → excluded
      mkSet({
        set_number: 2,
        weight: "100",
        reps: 2,
        completed_at: "2026-05-21T10:06:00Z",
      }), // 200
    ];
    const state = computeVolumeTarget({
      pastSessions: past,
      currentSessionSets: current,
    });
    expect(state.kind).toBe("chasing");
    if (state.kind !== "chasing") return;
    expect(state.runningKg).toBe(200);
    expect(state.gapKg).toBe(300);
  });

  it("MIN-4: chasing → surpassed transition triggers when an existing draft is toggled checked", () => {
    // Build sets that already total ≥ previousMax. Initially they are
    // drafts → runningKg = 0 → state is `chasing`. Flip both
    // `completed_at` to a stamp → state must flip to `surpassed`.
    const past = [
      mkSession("s1", [
        mkSet({ set_number: 1, weight: "100", reps: 10 }), // 1000
      ]),
    ];
    const draftSets = [
      mkSet({
        set_number: 1,
        weight: "100",
        reps: 10,
        completed_at: null,
      }), // 1000 if counted
      mkSet({
        set_number: 2,
        weight: "100",
        reps: 5,
        completed_at: null,
      }), //  500 if counted
    ];

    const before = computeVolumeTarget({
      pastSessions: past,
      currentSessionSets: draftSets,
    });
    expect(before.kind).toBe("chasing");
    if (before.kind !== "chasing") return;
    expect(before.runningKg).toBe(0);
    expect(before.gapKg).toBe(1000);

    // Now flip both sets from draft → checked, simulating the user pressing
    // the check button on each row. State should transition to `surpassed`
    // with the same totals.
    const checkedSets = draftSets.map((s, i) =>
      mkSet({
        set_number: s.set_number,
        weight: s.weight,
        reps: s.reps,
        completed_at:
          i === 0 ? "2026-05-21T10:05:00Z" : "2026-05-21T10:06:00Z",
      }),
    );

    const after = computeVolumeTarget({
      pastSessions: past,
      currentSessionSets: checkedSets,
    });
    expect(after.kind).toBe("surpassed");
    if (after.kind !== "surpassed") return;
    expect(after.runningKg).toBe(1500);
    expect(after.previousMaxKg).toBe(1000);
    expect(after.overflowKg).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Windowed-mode regression cases (configurable max-volume window run).
// See docs/runs/2026-05-23_0211_configurable-max-volume-window/design-v2.md.
// ---------------------------------------------------------------------------

describe("computeVolumeTarget — windowed-mode", () => {
  // Window threshold: Monday 23 Feb 2026 local. Sessions before this UTC
  // instant are excluded from `previousMaxKg`.
  const windowStartMs = new Date(2026, 1, 23, 0, 0, 0).getTime();

  it("(a) ancient max session excluded → previousMaxKg becomes the in-window second-best", () => {
    // Ancient (Jan 2025, OUT of window): 1500 kg.
    // In-window (Apr 2026): 800 kg.
    // Current: 100 kg → chasing the in-window 800, NOT the ancient 1500.
    const past = [
      mkSession(
        "s-ancient",
        [mkSet({ set_number: 1, weight: "100", reps: 15 })], // 1500
        "2025-01-15T09:00:00Z",
      ),
      mkSession(
        "s-recent",
        [mkSet({ set_number: 1, weight: "100", reps: 8 })], // 800
        "2026-04-01T09:00:00Z",
      ),
    ];
    const current = [
      mkSet({
        set_number: 1,
        weight: "100",
        reps: 1,
        completed_at: "2026-05-21T10:05:00Z",
      }), // 100
    ];

    const lifetime = computeVolumeTarget({
      pastSessions: past,
      currentSessionSets: current,
    });
    expect(lifetime.kind).toBe("chasing");
    if (lifetime.kind === "chasing") {
      expect(lifetime.previousMaxKg).toBe(1500); // ancient wins under lifetime
    }

    const windowed = computeVolumeTarget({
      pastSessions: past,
      currentSessionSets: current,
      windowStartMs,
    });
    expect(windowed.kind).toBe("chasing");
    if (windowed.kind !== "chasing") return;
    expect(windowed.previousMaxKg).toBe(800);
    expect(windowed.runningKg).toBe(100);
    expect(windowed.gapKg).toBe(700);
  });

  it("(b) all pastSessions excluded by window → kind=no-pr regardless of prior count", () => {
    const past = [
      mkSession(
        "s-ancient-1",
        [mkSet({ set_number: 1, weight: "100", reps: 5 })],
        "2025-01-15T09:00:00Z",
      ),
      mkSession(
        "s-ancient-2",
        [mkSet({ set_number: 1, weight: "100", reps: 6 })],
        "2025-06-20T09:00:00Z",
      ),
    ];
    const state = computeVolumeTarget({
      pastSessions: past,
      currentSessionSets: [
        mkSet({
          set_number: 1,
          weight: "100",
          reps: 5,
          completed_at: "2026-05-21T10:05:00Z",
        }),
      ],
      windowStartMs,
    });
    expect(state.kind).toBe("no-pr");
  });

  it("(c) windowStartMs=undefined is identical to the pre-feature lifetime path", () => {
    const past = [
      mkSession("s-1", [
        mkSet({ set_number: 1, weight: "100", reps: 10 }), // 1000
      ]),
    ];
    const current = [
      mkSet({
        set_number: 1,
        weight: "100",
        reps: 5,
        completed_at: "2026-05-21T10:05:00Z",
      }), // 500
    ];
    const lifetime = computeVolumeTarget({
      pastSessions: past,
      currentSessionSets: current,
    });
    const explicit = computeVolumeTarget({
      pastSessions: past,
      currentSessionSets: current,
      windowStartMs: undefined,
    });
    expect(lifetime).toEqual(explicit);
  });

  it("session at exactly windowStartMs is INCLUDED (>=)", () => {
    const onBoundaryIso = new Date(windowStartMs).toISOString();
    const past = [
      mkSession(
        "s-on-boundary",
        [mkSet({ set_number: 1, weight: "100", reps: 6 })], // 600
        onBoundaryIso,
      ),
    ];
    const state = computeVolumeTarget({
      pastSessions: past,
      currentSessionSets: [
        mkSet({
          set_number: 1,
          weight: "100",
          reps: 1,
          completed_at: "2026-05-21T10:05:00Z",
        }),
      ],
      windowStartMs,
    });
    expect(state.kind).toBe("chasing");
    if (state.kind !== "chasing") return;
    expect(state.previousMaxKg).toBe(600);
  });
});
