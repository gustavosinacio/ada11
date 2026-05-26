/**
 * Tests for `src/api/routine-exercise-sets.ts`.
 *
 * Covers:
 *   1. `addRoutineExerciseSet` — next set_number = MAX(non-deleted) + 1.
 *   2. `updateRoutineExerciseSet` — tri-state partial-spread, empty short-circuit.
 *   3. `reorderRoutineExerciseSets` — two-step park-to-negative swap.
 *   4. `seedSetsForSession`:
 *        - Idempotency guard at routine_exercise_id granularity.
 *        - Dropset two-pass remap via natural-key.
 *        - Orphan-dropset graceful fallback.
 *        - NULL target_reps/target_weight carries forward.
 *        - Per-exercise set_number monotonicity (NOT global).
 *
 * Strategy mirrors `tests/unit/api-sets.updateSet.test.ts` shape — vitest +
 * vi.mock('~/lib/supabase') with chained mocks per call.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getUserMock = vi.fn();

type Builder = {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  is: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  // Awaited (no chain terminator) — most insert/update calls without
  // .select() resolve directly by awaiting the chain.
  __thenValue?: { data: unknown; error: unknown };
};

const fromCalls: string[] = [];
const pendingChains: Builder[] = [];

function chain(): Builder {
  const b = {} as Builder;
  b.select = vi.fn(() => b);
  b.insert = vi.fn(() => b);
  b.update = vi.fn(() => b);
  b.eq = vi.fn(() => b);
  b.is = vi.fn(() => b);
  b.order = vi.fn(() => b);
  b.limit = vi.fn(() => b);
  b.single = vi.fn();
  return b;
}

// A then-able chain that resolves itself on await (used when the caller does
// `await supabase.from(...).update(...).eq(...)` with no terminator).
function thenableChain(returnValue: { data: unknown; error: unknown }): Builder {
  const b = chain();
  // Attach a `then` so `await` on the chain resolves with returnValue.
  (b as unknown as { then: (cb: (v: unknown) => void) => void }).then = (cb) =>
    cb(returnValue);
  return b;
}

vi.mock("~/lib/supabase", () => ({
  supabase: {
    auth: {
      getUser: (...args: unknown[]) => getUserMock(...args),
    },
    from: (table: string) => {
      fromCalls.push(table);
      const b = pendingChains.shift();
      if (!b) {
        throw new Error(
          `Unexpected .from('${table}') — no pending chain queued. fromCalls=${fromCalls.join(",")}`,
        );
      }
      return b;
    },
  },
}));

const AUTHED_USER = { id: "user-1" };

beforeEach(() => {
  fromCalls.length = 0;
  pendingChains.length = 0;
  getUserMock.mockReset();
});

afterEach(() => {
  if (pendingChains.length !== 0) {
    throw new Error(
      `Leftover pending chains: ${pendingChains.length}. Test queued more chains than the API consumed.`,
    );
  }
});

// ----- addRoutineExerciseSet ------------------------------------------------

describe("addRoutineExerciseSet — set_number = MAX(non-deleted) + 1", () => {
  it("inserts with set_number = 1 when no rows exist", async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: AUTHED_USER } });

    // 1. SELECT max — returns empty.
    const sel = chain();
    sel.limit.mockResolvedValueOnce({ data: [], error: null });
    pendingChains.push(sel);

    // 2. INSERT — returns the inserted row.
    const insRow = {
      id: "rs-1",
      user_id: "user-1",
      routine_exercise_id: "re-1",
      set_number: 1,
      set_type: "working",
      target_reps: 8,
      target_weight: "60.00",
      parent_set_id: null,
      notes: null,
      created_at: "2026-05-26T00:00:00Z",
      updated_at: "2026-05-26T00:00:00Z",
      deleted_at: null,
    };
    const ins = chain();
    ins.single.mockResolvedValueOnce({ data: insRow, error: null });
    pendingChains.push(ins);

    const { addRoutineExerciseSet } = await import("~/api/routine-exercise-sets");
    const result = await addRoutineExerciseSet({
      routine_exercise_id: "re-1",
      set_type: "working",
      target_reps: 8,
      target_weight: "60.00",
    });

    expect(result).toEqual(insRow);
    expect(ins.insert).toHaveBeenCalledWith({
      user_id: "user-1",
      routine_exercise_id: "re-1",
      set_number: 1,
      set_type: "working",
      target_reps: 8,
      target_weight: "60.00",
      parent_set_id: null,
      notes: null,
    });
  });

  it("inserts with set_number = MAX + 1 when prior non-deleted rows exist", async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: AUTHED_USER } });

    // SELECT returns the highest non-deleted set_number = 3.
    const sel = chain();
    sel.limit.mockResolvedValueOnce({
      data: [{ set_number: 3 }],
      error: null,
    });
    pendingChains.push(sel);

    const ins = chain();
    ins.single.mockResolvedValueOnce({
      data: { id: "rs-2", set_number: 4 },
      error: null,
    });
    pendingChains.push(ins);

    const { addRoutineExerciseSet } = await import("~/api/routine-exercise-sets");
    await addRoutineExerciseSet({
      routine_exercise_id: "re-1",
      set_type: "working",
    });

    expect(ins.insert).toHaveBeenCalledWith(
      expect.objectContaining({ set_number: 4 }),
    );
    // Filter on non-deleted rows during MAX read.
    expect(sel.is).toHaveBeenCalledWith("deleted_at", null);
  });
});

// ----- updateRoutineExerciseSet --------------------------------------------

describe("updateRoutineExerciseSet — tri-state partial-spread", () => {
  it("short-circuits with null on empty patch (no .from call)", async () => {
    const { updateRoutineExerciseSet } = await import(
      "~/api/routine-exercise-sets"
    );
    const result = await updateRoutineExerciseSet("rs-1", {});
    expect(result).toBeNull();
    expect(fromCalls).toEqual([]);
  });

  it("writes only target_reps when patch = { target_reps: 8 }", async () => {
    const b = chain();
    b.single.mockResolvedValueOnce({ data: { id: "rs-1" }, error: null });
    pendingChains.push(b);

    const { updateRoutineExerciseSet } = await import(
      "~/api/routine-exercise-sets"
    );
    await updateRoutineExerciseSet("rs-1", { target_reps: 8 });

    expect(b.update).toHaveBeenCalledWith({ target_reps: 8 });
    expect(b.eq).toHaveBeenCalledWith("id", "rs-1");
  });

  it("writes target_weight: null (explicit clear)", async () => {
    const b = chain();
    b.single.mockResolvedValueOnce({ data: { id: "rs-1" }, error: null });
    pendingChains.push(b);

    const { updateRoutineExerciseSet } = await import(
      "~/api/routine-exercise-sets"
    );
    await updateRoutineExerciseSet("rs-1", { target_weight: null });

    expect(b.update).toHaveBeenCalledWith({ target_weight: null });
  });

  it("short-circuits when every key is explicitly undefined", async () => {
    const { updateRoutineExerciseSet } = await import(
      "~/api/routine-exercise-sets"
    );
    const result = await updateRoutineExerciseSet("rs-1", {
      target_reps: undefined,
      target_weight: undefined,
    });
    expect(result).toBeNull();
    expect(fromCalls).toEqual([]);
  });
});

// ----- reorderRoutineExerciseSets ------------------------------------------

describe("reorderRoutineExerciseSets — two-step park-to-negative swap", () => {
  it("parks each id to -(i+1) then writes final 1..N positions", async () => {
    // 3 rows × 2 phases = 6 chains.
    const chains: Builder[] = [];
    for (let i = 0; i < 6; i++) {
      chains.push(thenableChain({ data: null, error: null }));
    }
    pendingChains.push(...chains);

    const { reorderRoutineExerciseSets } = await import(
      "~/api/routine-exercise-sets"
    );
    await reorderRoutineExerciseSets("re-1", ["A", "B", "C"]);

    // Phase 1: -1, -2, -3.
    expect(chains[0]!.update).toHaveBeenCalledWith({ set_number: -1 });
    expect(chains[1]!.update).toHaveBeenCalledWith({ set_number: -2 });
    expect(chains[2]!.update).toHaveBeenCalledWith({ set_number: -3 });
    // Phase 2: 1, 2, 3 (1-indexed).
    expect(chains[3]!.update).toHaveBeenCalledWith({ set_number: 1 });
    expect(chains[4]!.update).toHaveBeenCalledWith({ set_number: 2 });
    expect(chains[5]!.update).toHaveBeenCalledWith({ set_number: 3 });

    // Every call must also scope to routine_exercise_id.
    for (const c of chains) {
      expect(c.eq).toHaveBeenCalledWith("routine_exercise_id", "re-1");
    }
  });
});

// ----- seedSetsForSession --------------------------------------------------

describe("seedSetsForSession", () => {
  it("idempotency: skips a routine_exercise whose sets already exist in this session", async () => {
    // 1. Read routine_exercise_sets.
    const readChain = chain();
    readChain.order.mockResolvedValueOnce({
      data: [
        {
          id: "rs-1",
          set_number: 1,
          set_type: "working",
          target_reps: 8,
          target_weight: "60.00",
          parent_set_id: null,
          routine_exercises: {
            id: "re-1",
            exercise_id: "ex-1",
            routine_id: "routine-1",
            deleted_at: null,
          },
        },
      ],
      error: null,
    });
    pendingChains.push(readChain);

    // 2. Read existing session sets — already has a row for ex-1.
    const existChain = chain();
    existChain.is.mockResolvedValueOnce({
      data: [{ exercise_id: "ex-1", set_number: 1 }],
      error: null,
    });
    pendingChains.push(existChain);

    // No further .from calls — both branches skipped.

    const { seedSetsForSession } = await import("~/api/routine-exercise-sets");
    const result = await seedSetsForSession({
      session_id: "sess-1",
      routine_id: "routine-1",
      user_id: "user-1",
    });

    expect(result.inserted).toBe(0);
    expect(result.skipped_routine_exercise_ids).toEqual(["re-1"]);
  });

  it("dropset two-pass remap: non-dropsets first, dropsets resolved via natural key", async () => {
    // Read returns 1 working + 1 dropset both attached to the same exercise.
    const readChain = chain();
    readChain.order.mockResolvedValueOnce({
      data: [
        {
          id: "rs-w",
          set_number: 1,
          set_type: "working",
          target_reps: 8,
          target_weight: "60.00",
          parent_set_id: null,
          routine_exercises: {
            id: "re-1",
            exercise_id: "ex-1",
            routine_id: "routine-1",
            deleted_at: null,
          },
        },
        {
          id: "rs-d",
          set_number: 2,
          set_type: "dropset",
          target_reps: 6,
          target_weight: "50.00",
          parent_set_id: "rs-w",
          routine_exercises: {
            id: "re-1",
            exercise_id: "ex-1",
            routine_id: "routine-1",
            deleted_at: null,
          },
        },
      ],
      error: null,
    });
    pendingChains.push(readChain);

    // Existing sets — none.
    const existChain = chain();
    existChain.is.mockResolvedValueOnce({ data: [], error: null });
    pendingChains.push(existChain);

    // Pass 1 INSERT non-dropsets → returns the inserted working row.
    const ins1 = chain();
    ins1.select.mockResolvedValueOnce({
      data: [{ id: "set-w-1", exercise_id: "ex-1", set_number: 1 }],
      error: null,
    });
    pendingChains.push(ins1);

    // Pass 2 INSERT dropsets — terminator is the awaited insert call.
    const ins2 = thenableChain({ data: null, error: null });
    pendingChains.push(ins2);

    const { seedSetsForSession } = await import("~/api/routine-exercise-sets");
    const result = await seedSetsForSession({
      session_id: "sess-1",
      routine_id: "routine-1",
      user_id: "user-1",
    });

    expect(result.inserted).toBe(2);
    // Working insert payload.
    expect(ins1.insert).toHaveBeenCalledWith([
      expect.objectContaining({
        exercise_id: "ex-1",
        set_number: 1,
        set_type: "working",
        parent_set_id: null,
        completed_at: null,
      }),
    ]);
    // Dropset insert payload uses the freshly-inserted working set id as parent.
    expect(ins2.insert).toHaveBeenCalledWith([
      expect.objectContaining({
        exercise_id: "ex-1",
        set_number: 2,
        set_type: "dropset",
        parent_set_id: "set-w-1",
        completed_at: null,
      }),
    ]);
  });

  it("orphan-dropset graceful fallback: dropset whose parent was excluded is dropped silently", async () => {
    // Read returns just a dropset whose parent_set_id points at an unknown
    // routine_set (parent_set_id not present in the read set — simulates the
    // parent row being soft-deleted between the read and insert phases).
    const readChain = chain();
    readChain.order.mockResolvedValueOnce({
      data: [
        {
          id: "rs-d",
          set_number: 2,
          set_type: "dropset",
          target_reps: 6,
          target_weight: "50.00",
          parent_set_id: "rs-unknown",
          routine_exercises: {
            id: "re-1",
            exercise_id: "ex-1",
            routine_id: "routine-1",
            deleted_at: null,
          },
        },
      ],
      error: null,
    });
    pendingChains.push(readChain);

    const existChain = chain();
    existChain.is.mockResolvedValueOnce({ data: [], error: null });
    pendingChains.push(existChain);

    // No non-dropset insert (no rows queued). No dropset insert (unresolvable).

    const { seedSetsForSession } = await import("~/api/routine-exercise-sets");
    const result = await seedSetsForSession({
      session_id: "sess-1",
      routine_id: "routine-1",
      user_id: "user-1",
    });

    expect(result.inserted).toBe(0);
    expect(result.skipped_routine_exercise_ids).toEqual([]);
  });

  it("NULL target_reps + target_weight carries forward to sets payload", async () => {
    const readChain = chain();
    readChain.order.mockResolvedValueOnce({
      data: [
        {
          id: "rs-x",
          set_number: 1,
          set_type: "working",
          target_reps: null,
          target_weight: null,
          parent_set_id: null,
          routine_exercises: {
            id: "re-1",
            exercise_id: "ex-1",
            routine_id: "routine-1",
            deleted_at: null,
          },
        },
      ],
      error: null,
    });
    pendingChains.push(readChain);

    const existChain = chain();
    existChain.is.mockResolvedValueOnce({ data: [], error: null });
    pendingChains.push(existChain);

    const ins = chain();
    ins.select.mockResolvedValueOnce({
      data: [{ id: "set-1", exercise_id: "ex-1", set_number: 1 }],
      error: null,
    });
    pendingChains.push(ins);

    const { seedSetsForSession } = await import("~/api/routine-exercise-sets");
    await seedSetsForSession({
      session_id: "sess-1",
      routine_id: "routine-1",
      user_id: "user-1",
    });

    expect(ins.insert).toHaveBeenCalledWith([
      expect.objectContaining({ reps: null, weight: null }),
    ]);
  });

  it("per-exercise set_number monotonicity — 2 exercises × 2 sets each yields 1,2 / 1,2", async () => {
    const readChain = chain();
    readChain.order.mockResolvedValueOnce({
      data: [
        // exercise A
        {
          id: "rs-a-1",
          set_number: 1,
          set_type: "working",
          target_reps: 8,
          target_weight: "60.00",
          parent_set_id: null,
          routine_exercises: {
            id: "re-A",
            exercise_id: "ex-A",
            routine_id: "routine-1",
            deleted_at: null,
          },
        },
        {
          id: "rs-a-2",
          set_number: 2,
          set_type: "working",
          target_reps: 8,
          target_weight: "70.00",
          parent_set_id: null,
          routine_exercises: {
            id: "re-A",
            exercise_id: "ex-A",
            routine_id: "routine-1",
            deleted_at: null,
          },
        },
        // exercise B
        {
          id: "rs-b-1",
          set_number: 1,
          set_type: "working",
          target_reps: 5,
          target_weight: "100.00",
          parent_set_id: null,
          routine_exercises: {
            id: "re-B",
            exercise_id: "ex-B",
            routine_id: "routine-1",
            deleted_at: null,
          },
        },
        {
          id: "rs-b-2",
          set_number: 2,
          set_type: "working",
          target_reps: 5,
          target_weight: "100.00",
          parent_set_id: null,
          routine_exercises: {
            id: "re-B",
            exercise_id: "ex-B",
            routine_id: "routine-1",
            deleted_at: null,
          },
        },
      ],
      error: null,
    });
    pendingChains.push(readChain);

    const existChain = chain();
    existChain.is.mockResolvedValueOnce({ data: [], error: null });
    pendingChains.push(existChain);

    const ins = chain();
    ins.select.mockResolvedValueOnce({
      data: [
        { id: "s-a-1", exercise_id: "ex-A", set_number: 1 },
        { id: "s-a-2", exercise_id: "ex-A", set_number: 2 },
        { id: "s-b-1", exercise_id: "ex-B", set_number: 1 },
        { id: "s-b-2", exercise_id: "ex-B", set_number: 2 },
      ],
      error: null,
    });
    pendingChains.push(ins);

    const { seedSetsForSession } = await import("~/api/routine-exercise-sets");
    const result = await seedSetsForSession({
      session_id: "sess-1",
      routine_id: "routine-1",
      user_id: "user-1",
    });

    expect(result.inserted).toBe(4);
    const insertPayload = ins.insert.mock.calls[0]![0] as {
      exercise_id: string;
      set_number: number;
    }[];
    // Per-exercise set_number is monotonic 1..N — NOT globally.
    expect(insertPayload.map((r) => `${r.exercise_id}:${r.set_number}`)).toEqual([
      "ex-A:1",
      "ex-A:2",
      "ex-B:1",
      "ex-B:2",
    ]);
  });
});
