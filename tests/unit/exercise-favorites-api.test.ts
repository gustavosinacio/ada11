/**
 * Tests for `src/api/exercise-favorites.ts`.
 *
 * Covers:
 *   - Auth gating: `listMyFavoriteExerciseIds` returns [] when unauth (no DB
 *     call); `addFavorite` / `removeFavorite` throw "Not authenticated".
 *   - `listMyFavoriteExerciseIds` maps rows → ids; null `data` → [].
 *   - `addFavorite` issues a plain INSERT; SWALLOWS SQLSTATE 23505 (already
 *     favorited → idempotent no-op); re-throws any other error.
 *   - `removeFavorite` issues `.delete().eq(user_id).eq(exercise_id)`; re-throws.
 *
 * Test strategy mirrors exercise-notes-api.test.ts (`vi.mock('~/lib/supabase')`
 * with a chain of vi.fn() return values + a pendingChains queue).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ----- Supabase client mock ------------------------------------------------

const getUserMock = vi.fn();

const fromCalls: string[] = [];
const pendingChains: ChainBuilder[] = [];

// A builder that is awaitable: the final value the API awaits is provided by
// `result`, surfaced via a thenable so `await supabase.from(...).select(...)`
// (or `.insert(...)`, `.delete().eq().eq()`) resolves to `{ data, error }`.
type ChainBuilder = {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  then: (resolve: (v: { data: unknown; error: unknown }) => unknown) => unknown;
};

function chain(result: { data: unknown; error: unknown }): ChainBuilder {
  const b: ChainBuilder = {
    select: vi.fn(() => b),
    insert: vi.fn(() => b),
    delete: vi.fn(() => b),
    eq: vi.fn(() => b),
    // Thenable: awaiting the builder resolves to `result`.
    then: (resolve) => resolve(result),
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
  if (pendingChains.length !== 0) {
    throw new Error(
      `Leftover pending chains: ${pendingChains.length}. Test queued more chains than the API consumed.`,
    );
  }
});

// ----- listMyFavoriteExerciseIds -------------------------------------------

describe("listMyFavoriteExerciseIds", () => {
  it("returns [] and skips DB call when unauthenticated", async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: null } });

    const { listMyFavoriteExerciseIds } = await import(
      "~/api/exercise-favorites"
    );
    const result = await listMyFavoriteExerciseIds();

    expect(result).toEqual([]);
    expect(fromCalls).toEqual([]);
  });

  it("maps rows to exercise_ids", async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: AUTHED_USER } });
    const b = chain({
      data: [{ exercise_id: "ex-1" }, { exercise_id: "ex-2" }],
      error: null,
    });
    pendingChains.push(b);

    const { listMyFavoriteExerciseIds } = await import(
      "~/api/exercise-favorites"
    );
    const result = await listMyFavoriteExerciseIds();

    expect(result).toEqual(["ex-1", "ex-2"]);
    expect(fromCalls).toEqual(["user_exercise_favorites"]);
    expect(b.select).toHaveBeenCalledWith("exercise_id");
    expect(b.eq).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("returns [] when data is null", async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: AUTHED_USER } });
    pendingChains.push(chain({ data: null, error: null }));

    const { listMyFavoriteExerciseIds } = await import(
      "~/api/exercise-favorites"
    );
    expect(await listMyFavoriteExerciseIds()).toEqual([]);
  });

  it("throws when the SELECT returns an error", async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: AUTHED_USER } });
    pendingChains.push(
      chain({ data: null, error: { code: "PGRST301", message: "boom" } }),
    );

    const { listMyFavoriteExerciseIds } = await import(
      "~/api/exercise-favorites"
    );
    await expect(listMyFavoriteExerciseIds()).rejects.toMatchObject({
      code: "PGRST301",
    });
  });
});

// ----- addFavorite ---------------------------------------------------------

describe("addFavorite", () => {
  it("throws 'Not authenticated' when unauthenticated and skips DB", async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: null } });

    const { addFavorite } = await import("~/api/exercise-favorites");
    await expect(addFavorite("ex-1")).rejects.toThrow("Not authenticated");
    expect(fromCalls).toEqual([]);
  });

  it("issues a plain INSERT of {user_id, exercise_id}", async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: AUTHED_USER } });
    const b = chain({ data: null, error: null });
    pendingChains.push(b);

    const { addFavorite } = await import("~/api/exercise-favorites");
    await addFavorite("ex-1");

    expect(fromCalls).toEqual(["user_exercise_favorites"]);
    expect(b.insert).toHaveBeenCalledWith({
      user_id: "user-1",
      exercise_id: "ex-1",
    });
  });

  it("SWALLOWS a 23505 (already favorited) — resolves, no throw", async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: AUTHED_USER } });
    pendingChains.push(
      chain({ data: null, error: { code: "23505", message: "duplicate key" } }),
    );

    const { addFavorite } = await import("~/api/exercise-favorites");
    await expect(addFavorite("ex-1")).resolves.toBeUndefined();
  });

  it("re-throws a non-23505 error", async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: AUTHED_USER } });
    pendingChains.push(
      chain({
        data: null,
        error: { code: "42P01", message: "relation does not exist" },
      }),
    );

    const { addFavorite } = await import("~/api/exercise-favorites");
    await expect(addFavorite("ex-1")).rejects.toMatchObject({ code: "42P01" });
  });
});

// ----- removeFavorite ------------------------------------------------------

describe("removeFavorite", () => {
  it("throws 'Not authenticated' when unauthenticated and skips DB", async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: null } });

    const { removeFavorite } = await import("~/api/exercise-favorites");
    await expect(removeFavorite("ex-1")).rejects.toThrow("Not authenticated");
    expect(fromCalls).toEqual([]);
  });

  it("issues .delete().eq(user_id).eq(exercise_id)", async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: AUTHED_USER } });
    const b = chain({ data: null, error: null });
    pendingChains.push(b);

    const { removeFavorite } = await import("~/api/exercise-favorites");
    await removeFavorite("ex-1");

    expect(fromCalls).toEqual(["user_exercise_favorites"]);
    expect(b.delete).toHaveBeenCalled();
    expect(b.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(b.eq).toHaveBeenCalledWith("exercise_id", "ex-1");
  });

  it("re-throws a DELETE error", async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: AUTHED_USER } });
    pendingChains.push(
      chain({ data: null, error: { code: "PGRST301", message: "boom" } }),
    );

    const { removeFavorite } = await import("~/api/exercise-favorites");
    await expect(removeFavorite("ex-1")).rejects.toMatchObject({
      code: "PGRST301",
    });
  });
});
