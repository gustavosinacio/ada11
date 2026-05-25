/**
 * Tests for `src/api/exercise-notes.ts`.
 *
 * Covers:
 *   - Auth gating (`getMyExerciseNote` returns null when unauth; no DB call).
 *   - Null-on-no-row + soft-delete filter (`.is("deleted_at", null)`).
 *   - Read-then-write semantics: SELECT-no-row → INSERT; SELECT-row → UPDATE.
 *   - 23505 race recovery: SELECT-no-row → INSERT 23505 → SELECT-row → UPDATE.
 *   - Non-23505 INSERT error surfaces immediately.
 *
 * Test strategy mirrors the api-sets.updateSetMeta.test.ts shape (Vitest
 * `vi.mock('~/lib/supabase')` with a chain of vi.fn() return values).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ----- Supabase client mock ------------------------------------------------

const getUserMock = vi.fn();

// Each .from() invocation returns a fresh builder; tests push the per-call
// builder responses onto `pendingChains` before exercising the API.
type Builder = {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  is: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
};

const fromCalls: string[] = [];
const pendingChains: Builder[] = [];

function chain(): Builder {
  const b: Builder = {
    select: vi.fn(() => b),
    insert: vi.fn(() => b),
    update: vi.fn(() => b),
    eq: vi.fn(() => b),
    is: vi.fn(() => b),
    maybeSingle: vi.fn(),
    single: vi.fn(),
  };
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
  // Each test must consume every pending chain it queues.
  if (pendingChains.length !== 0) {
    throw new Error(
      `Leftover pending chains: ${pendingChains.length}. Test queued more chains than the API consumed.`,
    );
  }
});

// ----- getMyExerciseNote ---------------------------------------------------

describe("getMyExerciseNote", () => {
  it("returns null and skips DB call when unauthenticated", async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: null } });

    const { getMyExerciseNote } = await import("~/api/exercise-notes");
    const result = await getMyExerciseNote("ex-1");

    expect(result).toBeNull();
    expect(fromCalls).toEqual([]);
  });

  it("returns null when no active row exists", async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: AUTHED_USER } });
    const b = chain();
    b.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    pendingChains.push(b);

    const { getMyExerciseNote } = await import("~/api/exercise-notes");
    const result = await getMyExerciseNote("ex-1");

    expect(result).toBeNull();
    expect(fromCalls).toEqual(["exercise_notes"]);
    expect(b.select).toHaveBeenCalledWith("*");
    expect(b.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(b.eq).toHaveBeenCalledWith("exercise_id", "ex-1");
    expect(b.is).toHaveBeenCalledWith("deleted_at", null);
  });

  it("returns the row when an active note exists", async () => {
    const row = {
      id: "note-1",
      user_id: "user-1",
      exercise_id: "ex-1",
      body: "grip width: shoulder-width",
      created_at: "2026-05-25T00:00:00Z",
      updated_at: "2026-05-25T00:00:00Z",
      deleted_at: null,
    };
    getUserMock.mockResolvedValueOnce({ data: { user: AUTHED_USER } });
    const b = chain();
    b.maybeSingle.mockResolvedValueOnce({ data: row, error: null });
    pendingChains.push(b);

    const { getMyExerciseNote } = await import("~/api/exercise-notes");
    const result = await getMyExerciseNote("ex-1");

    expect(result).toEqual(row);
  });

  it("throws when the SELECT returns an error", async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: AUTHED_USER } });
    const b = chain();
    b.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: { code: "PGRST301", message: "boom" },
    });
    pendingChains.push(b);

    const { getMyExerciseNote } = await import("~/api/exercise-notes");
    await expect(getMyExerciseNote("ex-1")).rejects.toMatchObject({
      code: "PGRST301",
    });
  });
});

// ----- upsertMyExerciseNote ------------------------------------------------

describe("upsertMyExerciseNote", () => {
  it("throws 'Not authenticated' when unauthenticated and skips DB", async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: null } });

    const { upsertMyExerciseNote } = await import("~/api/exercise-notes");
    await expect(upsertMyExerciseNote("ex-1", "body")).rejects.toThrow(
      "Not authenticated",
    );
    expect(fromCalls).toEqual([]);
  });

  it("INSERTS when no row exists, returns inserted row", async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: AUTHED_USER } });
    // 1: SELECT returns null
    const selB = chain();
    selB.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    pendingChains.push(selB);
    // 2: INSERT returns the row
    const insRow = {
      id: "note-1",
      user_id: "user-1",
      exercise_id: "ex-1",
      body: "new body",
      created_at: "2026-05-25T00:00:00Z",
      updated_at: "2026-05-25T00:00:00Z",
      deleted_at: null,
    };
    const insB = chain();
    insB.single.mockResolvedValueOnce({ data: insRow, error: null });
    pendingChains.push(insB);

    const { upsertMyExerciseNote } = await import("~/api/exercise-notes");
    const result = await upsertMyExerciseNote("ex-1", "new body");

    expect(result).toEqual(insRow);
    expect(fromCalls).toEqual(["exercise_notes", "exercise_notes"]);
    expect(insB.insert).toHaveBeenCalledWith({
      user_id: "user-1",
      exercise_id: "ex-1",
      body: "new body",
    });
  });

  it("UPDATES by id when an active row exists", async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: AUTHED_USER } });
    const existingRow = {
      id: "note-1",
      user_id: "user-1",
      exercise_id: "ex-1",
      body: "old body",
      created_at: "2026-05-25T00:00:00Z",
      updated_at: "2026-05-25T00:00:00Z",
      deleted_at: null,
    };
    const selB = chain();
    selB.maybeSingle.mockResolvedValueOnce({
      data: existingRow,
      error: null,
    });
    pendingChains.push(selB);

    const updatedRow = { ...existingRow, body: "patched" };
    const updB = chain();
    updB.single.mockResolvedValueOnce({ data: updatedRow, error: null });
    pendingChains.push(updB);

    const { upsertMyExerciseNote } = await import("~/api/exercise-notes");
    const result = await upsertMyExerciseNote("ex-1", "patched");

    expect(result).toEqual(updatedRow);
    expect(updB.update).toHaveBeenCalledWith({ body: "patched" });
    expect(updB.eq).toHaveBeenCalledWith("id", "note-1");
  });

  it("retries once on 23505 race: SELECT null → INSERT 23505 → SELECT row → UPDATE", async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: AUTHED_USER } });

    // Attempt 1, step 1: SELECT — no row.
    const sel1 = chain();
    sel1.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    pendingChains.push(sel1);
    // Attempt 1, step 2: INSERT — racer caused 23505.
    const ins1 = chain();
    ins1.single.mockResolvedValueOnce({
      data: null,
      error: { code: "23505", message: "duplicate key" },
    });
    pendingChains.push(ins1);
    // Attempt 2, step 1: SELECT — now picks the racer's row.
    const racerRow = {
      id: "note-racer",
      user_id: "user-1",
      exercise_id: "ex-1",
      body: "racer body",
      created_at: "2026-05-25T00:00:00Z",
      updated_at: "2026-05-25T00:00:00Z",
      deleted_at: null,
    };
    const sel2 = chain();
    sel2.maybeSingle.mockResolvedValueOnce({ data: racerRow, error: null });
    pendingChains.push(sel2);
    // Attempt 2, step 2: UPDATE — overwrites racer's body.
    const finalRow = { ...racerRow, body: "our body" };
    const upd2 = chain();
    upd2.single.mockResolvedValueOnce({ data: finalRow, error: null });
    pendingChains.push(upd2);

    const { upsertMyExerciseNote } = await import("~/api/exercise-notes");
    const result = await upsertMyExerciseNote("ex-1", "our body");

    expect(result).toEqual(finalRow);
    // Verify the loop ran exactly twice (4 .from() calls).
    expect(fromCalls).toEqual([
      "exercise_notes",
      "exercise_notes",
      "exercise_notes",
      "exercise_notes",
    ]);
    expect(upd2.eq).toHaveBeenCalledWith("id", "note-racer");
  });

  it("surfaces non-23505 INSERT errors immediately (no retry)", async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: AUTHED_USER } });

    const sel = chain();
    sel.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    pendingChains.push(sel);

    const ins = chain();
    ins.single.mockResolvedValueOnce({
      data: null,
      error: { code: "42P01", message: "relation does not exist" },
    });
    pendingChains.push(ins);

    const { upsertMyExerciseNote } = await import("~/api/exercise-notes");
    await expect(upsertMyExerciseNote("ex-1", "body")).rejects.toMatchObject({
      code: "42P01",
    });
    // Only 2 .from() calls — no retry SELECT.
    expect(fromCalls).toEqual(["exercise_notes", "exercise_notes"]);
  });

  it("surfaces SELECT errors immediately", async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: AUTHED_USER } });

    const sel = chain();
    sel.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: { code: "PGRST301", message: "boom" },
    });
    pendingChains.push(sel);

    const { upsertMyExerciseNote } = await import("~/api/exercise-notes");
    await expect(upsertMyExerciseNote("ex-1", "body")).rejects.toMatchObject({
      code: "PGRST301",
    });
    expect(fromCalls).toEqual(["exercise_notes"]);
  });
});
