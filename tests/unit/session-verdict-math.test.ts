/**
 * Unit tests for the end-of-session verdict math kernel
 * (`src/utils/session-verdict-math.ts`). Mirrors the test plan in
 * `docs/runs/2026-05-22_0152_end-of-session-verdict/design-v2.md`:
 *
 *   - computeCurrentSessionVolumeByExercise ............... #1-#9
 *   - computePrsForSession ................................ #10-#20
 *   - sumLiveVolume reuse faithfulness (MIN-1) ............ #21
 *
 * All tests are pure — no React, no Supabase, no I/O. Fixtures `mkSet` /
 * `mkRow` keep call-sites tight and parallel `progress-page-math.test.ts`.
 */

import { describe, expect, it } from "vitest";

import type { WeeklyVolumeRow } from "~/api/stats";
import type { SetRow, SetType } from "~/db/types";
import {
  computeCurrentSessionVolumeByExercise,
  computePrsForSession,
} from "~/utils/session-verdict-math";
import { sumLiveVolume } from "~/utils/volume-target";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let setCounter = 0;
function mkSet(overrides: Partial<SetRow> = {}): SetRow {
  setCounter += 1;
  // Use `key in overrides` for nullable fields so callers can explicitly pass
  // `null` without `??` coalescing it back to the default.
  return {
    id: overrides.id ?? `set-${setCounter}`,
    user_id: overrides.user_id ?? "user-1",
    session_id: overrides.session_id ?? "sess-current",
    exercise_id: overrides.exercise_id ?? "ex-1",
    set_number: overrides.set_number ?? setCounter,
    reps: "reps" in overrides ? (overrides.reps as number | null) : 5,
    weight: "weight" in overrides ? (overrides.weight as string | null) : "100",
    rpe: overrides.rpe ?? null,
    set_type: (overrides.set_type ?? "working") as SetType,
    parent_set_id: overrides.parent_set_id ?? null,
    notes: overrides.notes ?? null,
    completed_at:
      "completed_at" in overrides
        ? (overrides.completed_at as string | null)
        : "2026-05-22T10:00:00Z",
    created_at: overrides.created_at ?? "2026-05-22T10:00:00Z",
    updated_at: overrides.updated_at ?? "2026-05-22T10:00:00Z",
    deleted_at: overrides.deleted_at ?? null,
  };
}

function mkRow(
  overrides: Partial<WeeklyVolumeRow> & {
    weight: string | null;
    reps: number | null;
  },
): WeeklyVolumeRow {
  const completedAt = overrides.completed_at ?? "2026-05-19T10:00:00Z";
  const sessionStarted =
    overrides.sessions?.started_at ?? "2026-05-19T09:00:00Z";
  return {
    completed_at: completedAt,
    weight: overrides.weight,
    reps: overrides.reps,
    set_type: (overrides.set_type ?? "working") as SetType,
    exercise_id: overrides.exercise_id ?? "ex-1",
    session_id: overrides.session_id ?? "sess-prior",
    sessions: overrides.sessions ?? {
      started_at: sessionStarted,
      ended_at: sessionStarted,
    },
  };
}

// ---------------------------------------------------------------------------
// computeCurrentSessionVolumeByExercise — #1-#9
// ---------------------------------------------------------------------------

describe("computeCurrentSessionVolumeByExercise", () => {
  it("(#1) empty sets → empty Map", () => {
    expect(computeCurrentSessionVolumeByExercise([]).size).toBe(0);
  });

  it("(#2) one working completed set 100x5 → { ex-1: 500 }", () => {
    const sets = [mkSet({ exercise_id: "ex-1", weight: "100", reps: 5 })];
    const out = computeCurrentSessionVolumeByExercise(sets);
    expect(out.size).toBe(1);
    expect(out.get("ex-1")).toBe(500);
  });

  it("(#3) warmup completed set 100x5 → empty (warmup excluded)", () => {
    const sets = [
      mkSet({
        exercise_id: "ex-1",
        weight: "100",
        reps: 5,
        set_type: "warmup",
      }),
    ];
    expect(computeCurrentSessionVolumeByExercise(sets).size).toBe(0);
  });

  it("(#4) unchecked working set (completed_at = null) → empty", () => {
    const sets = [
      mkSet({
        exercise_id: "ex-1",
        weight: "100",
        reps: 5,
        completed_at: null,
      }),
    ];
    expect(computeCurrentSessionVolumeByExercise(sets).size).toBe(0);
  });

  it("(#5) weight = null → empty", () => {
    const sets = [mkSet({ exercise_id: "ex-1", weight: null, reps: 5 })];
    expect(computeCurrentSessionVolumeByExercise(sets).size).toBe(0);
  });

  it("(#6) reps = 0 → empty", () => {
    const sets = [mkSet({ exercise_id: "ex-1", weight: "100", reps: 0 })];
    expect(computeCurrentSessionVolumeByExercise(sets).size).toBe(0);
  });

  it("(#7) two working sets same exercise → summed; different exercise keys", () => {
    const sets = [
      mkSet({ exercise_id: "ex-1", weight: "100", reps: 5 }),
      mkSet({ exercise_id: "ex-1", weight: "80", reps: 8 }),
      mkSet({ exercise_id: "ex-2", weight: "60", reps: 10 }),
    ];
    const out = computeCurrentSessionVolumeByExercise(sets);
    expect(out.get("ex-1")).toBe(500 + 640);
    expect(out.get("ex-2")).toBe(600);
    expect(out.size).toBe(2);
  });

  it("(#8) mixed working + dropset same exercise → both included (dropset is not warmup)", () => {
    const sets = [
      mkSet({
        exercise_id: "ex-1",
        weight: "100",
        reps: 5,
        set_type: "working",
      }),
      mkSet({
        exercise_id: "ex-1",
        weight: "60",
        reps: 8,
        set_type: "dropset",
      }),
    ];
    const out = computeCurrentSessionVolumeByExercise(sets);
    expect(out.get("ex-1")).toBe(500 + 480);
  });

  it("(#9) mixed warmup + working + unchecked working → only the checked working counted", () => {
    const sets = [
      mkSet({
        exercise_id: "ex-1",
        weight: "60",
        reps: 10,
        set_type: "warmup",
      }),
      mkSet({ exercise_id: "ex-1", weight: "100", reps: 5 }),
      mkSet({
        exercise_id: "ex-1",
        weight: "100",
        reps: 5,
        completed_at: null,
      }),
    ];
    const out = computeCurrentSessionVolumeByExercise(sets);
    expect(out.get("ex-1")).toBe(500);
    expect(out.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// computePrsForSession — #10-#20
// ---------------------------------------------------------------------------

describe("computePrsForSession", () => {
  it("(#10) empty rows + empty current map → []", () => {
    const out = computePrsForSession({
      rows: [],
      currentSessionId: "sess-current",
      currentSessionVolumeByExercise: new Map(),
    });
    expect(out).toEqual([]);
  });

  it("(#11) current has ex-1=500, no prior sessions → [] (priorMax guard)", () => {
    const out = computePrsForSession({
      rows: [],
      currentSessionId: "sess-current",
      currentSessionVolumeByExercise: new Map([["ex-1", 500]]),
    });
    expect(out).toEqual([]);
  });

  it("(#12) current ex-1=500, single prior s0=400 → one PR with overflow 100", () => {
    const rows = [
      mkRow({
        session_id: "s0",
        exercise_id: "ex-1",
        weight: "100",
        reps: 4,
      }),
    ];
    const out = computePrsForSession({
      rows,
      currentSessionId: "sess-current",
      currentSessionVolumeByExercise: new Map([["ex-1", 500]]),
    });
    expect(out).toEqual([
      {
        exerciseId: "ex-1",
        currentKg: 500,
        priorMaxKg: 400,
        overflowKg: 100,
      },
    ]);
  });

  it("(#13) strict-`>`: current ex-1=500, prior=500 → [] (tie is NOT a PR)", () => {
    const rows = [
      mkRow({
        session_id: "s0",
        exercise_id: "ex-1",
        weight: "100",
        reps: 5,
      }),
    ];
    const out = computePrsForSession({
      rows,
      currentSessionId: "sess-current",
      currentSessionVolumeByExercise: new Map([["ex-1", 500]]),
    });
    expect(out).toEqual([]);
  });

  it("(#14) two priors s0=400, s1=600; current=700 → priorMax 600, overflow 100", () => {
    const rows = [
      mkRow({
        session_id: "s0",
        exercise_id: "ex-1",
        weight: "100",
        reps: 4,
      }),
      mkRow({
        session_id: "s1",
        exercise_id: "ex-1",
        weight: "100",
        reps: 6,
      }),
    ];
    const out = computePrsForSession({
      rows,
      currentSessionId: "sess-current",
      currentSessionVolumeByExercise: new Map([["ex-1", 700]]),
    });
    expect(out).toEqual([
      {
        exerciseId: "ex-1",
        currentKg: 700,
        priorMaxKg: 600,
        overflowKg: 100,
      },
    ]);
  });

  it("(#15) currentSessionId leakage: rows include current session, must be filtered", () => {
    // Prior s0 = 400. Current sCur = 800. Rows array INCLUDES both.
    // Current map says sCur = 800. PR must be detected vs the 400 baseline
    // (NOT vs the 800 the current session contributes to the lifetime read).
    const rows = [
      mkRow({
        session_id: "s0",
        exercise_id: "ex-1",
        weight: "100",
        reps: 4,
      }),
      mkRow({
        session_id: "sess-current",
        exercise_id: "ex-1",
        weight: "100",
        reps: 8,
      }),
    ];
    const out = computePrsForSession({
      rows,
      currentSessionId: "sess-current",
      currentSessionVolumeByExercise: new Map([["ex-1", 800]]),
    });
    expect(out).toEqual([
      {
        exerciseId: "ex-1",
        currentKg: 800,
        priorMaxKg: 400,
        overflowKg: 400,
      },
    ]);
  });

  it("(#16) multi-exercise: ex-1 PRs, ex-2 does not → only ex-1 in result", () => {
    const rows = [
      // ex-1 prior: 400
      mkRow({
        session_id: "s0",
        exercise_id: "ex-1",
        weight: "100",
        reps: 4,
      }),
      // ex-2 prior: 800
      mkRow({
        session_id: "s0",
        exercise_id: "ex-2",
        weight: "100",
        reps: 8,
      }),
    ];
    const out = computePrsForSession({
      rows,
      currentSessionId: "sess-current",
      currentSessionVolumeByExercise: new Map([
        ["ex-1", 500], // PR: 500 > 400
        ["ex-2", 700], // NOT PR: 700 < 800
      ]),
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.exerciseId).toBe("ex-1");
  });

  it("(#17) multi-exercise sort: bigger overflow first (DESC)", () => {
    const rows = [
      mkRow({
        session_id: "s0",
        exercise_id: "ex-1",
        weight: "100",
        reps: 4,
      }), // 400
      mkRow({
        session_id: "s0",
        exercise_id: "ex-2",
        weight: "100",
        reps: 4,
      }), // 400
    ];
    const out = computePrsForSession({
      rows,
      currentSessionId: "sess-current",
      currentSessionVolumeByExercise: new Map([
        ["ex-1", 500], // overflow 100
        ["ex-2", 650], // overflow 250
      ]),
    });
    expect(out.map((p) => p.exerciseId)).toEqual(["ex-2", "ex-1"]);
  });

  it("(#18) tie-break: equal overflow → exerciseId ASC", () => {
    const rows = [
      mkRow({
        session_id: "s0",
        exercise_id: "ex-A",
        weight: "100",
        reps: 4,
      }), // 400
      mkRow({
        session_id: "s0",
        exercise_id: "ex-B",
        weight: "100",
        reps: 4,
      }), // 400
    ];
    const out = computePrsForSession({
      rows,
      currentSessionId: "sess-current",
      currentSessionVolumeByExercise: new Map([
        ["ex-B", 500], // overflow 100
        ["ex-A", 500], // overflow 100
      ]),
    });
    expect(out.map((p) => p.exerciseId)).toEqual(["ex-A", "ex-B"]);
  });

  it("(#19) current map has exercise not present in rows → priorMax=0 → NOT a PR", () => {
    const out = computePrsForSession({
      rows: [],
      currentSessionId: "sess-current",
      currentSessionVolumeByExercise: new Map([["ex-novel", 600]]),
    });
    expect(out).toEqual([]);
  });

  it("(#20) rows contain only zero-quality entries (weight=null) → priorMax stays 0 → no PRs", () => {
    const rows = [
      mkRow({
        session_id: "s0",
        exercise_id: "ex-1",
        weight: null,
        reps: 5,
      }),
    ];
    const out = computePrsForSession({
      rows,
      currentSessionId: "sess-current",
      currentSessionVolumeByExercise: new Map([["ex-1", 500]]),
    });
    expect(out).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// sumLiveVolume reuse faithfulness — #21 (MIN-1 in design-v2)
// ---------------------------------------------------------------------------

describe("computeCurrentSessionVolumeByExercise uses sumLiveVolume kernel", () => {
  it("(#21) per-(exercise_id) sum equals sumLiveVolume restricted to that exercise", () => {
    // Mixed sets across two exercises with the full predicate matrix:
    //   - working completed → counts
    //   - warmup completed → skipped
    //   - working unchecked → skipped
    //   - working completed with reps=0 → skipped
    //   - working completed with weight=null → skipped
    //   - dropset completed → counts
    const sets: SetRow[] = [
      mkSet({ exercise_id: "ex-1", weight: "100", reps: 5 }), // 500
      mkSet({
        exercise_id: "ex-1",
        weight: "60",
        reps: 10,
        set_type: "warmup",
      }), // skip
      mkSet({
        exercise_id: "ex-1",
        weight: "80",
        reps: 8,
        completed_at: null,
      }), // skip
      mkSet({
        exercise_id: "ex-1",
        weight: "70",
        reps: 0,
      }), // skip
      mkSet({
        exercise_id: "ex-1",
        weight: null,
        reps: 5,
      }), // skip
      mkSet({
        exercise_id: "ex-1",
        weight: "50",
        reps: 8,
        set_type: "dropset",
      }), // 400
      mkSet({ exercise_id: "ex-2", weight: "120", reps: 3 }), // 360
      mkSet({
        exercise_id: "ex-2",
        weight: "60",
        reps: 10,
        set_type: "warmup",
      }), // skip
    ];

    const map = computeCurrentSessionVolumeByExercise(sets);

    const setsForEx1 = sets.filter((s) => s.exercise_id === "ex-1");
    const setsForEx2 = sets.filter((s) => s.exercise_id === "ex-2");

    expect(map.get("ex-1")).toBe(sumLiveVolume(setsForEx1));
    expect(map.get("ex-2")).toBe(sumLiveVolume(setsForEx2));
    expect(map.get("ex-1")).toBe(900);
    expect(map.get("ex-2")).toBe(360);
  });
});
