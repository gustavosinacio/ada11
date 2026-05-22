/**
 * Tests for `updateSet` partial-spread semantics (BLK-1 regression coverage).
 *
 * `updateSet` historically clobbered every column in the payload — passing
 * `{rpe: undefined}` collapsed to literal `null` and erased the user's saved
 * RPE on every reps/weight commit. The v3 fix switches to a tri-state
 * partial-spread (undefined = absent, null = explicit clear, value = write).
 *
 * These tests pin the contract by asserting the exact payload shape passed
 * to `supabase.from("sets").update(...)`.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted mock for the supabase client. We reach into the same module
// resolved by `~/lib/supabase` so the import in `~/api/sets` picks it up.
const updateMock = vi.fn();
const eqMock = vi.fn();
const selectMock = vi.fn();
const singleMock = vi.fn();
const fromMock = vi.fn();

function resetChain(returnRow: unknown = { id: "set-1" }) {
  updateMock.mockReset();
  eqMock.mockReset();
  selectMock.mockReset();
  singleMock.mockReset();
  fromMock.mockReset();

  // Fluent chain: from(...).update(...).eq(...).select().single() → { data, error }.
  singleMock.mockResolvedValue({ data: returnRow, error: null });
  selectMock.mockReturnValue({ single: singleMock });
  eqMock.mockReturnValue({ select: selectMock });
  updateMock.mockReturnValue({ eq: eqMock });
  fromMock.mockReturnValue({ update: updateMock });
}

vi.mock("~/lib/supabase", () => ({
  supabase: {
    from: (...args: unknown[]) => fromMock(...args),
  },
}));

describe("updateSet — partial-spread payload (BLK-1)", () => {
  beforeEach(() => {
    resetChain();
  });

  it("writes only reps when patch = { reps: 5 } (BLK-1 regression case)", async () => {
    const { updateSet } = await import("~/api/sets");
    await updateSet("set-1", { reps: 5 });

    expect(fromMock).toHaveBeenCalledWith("sets");
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledWith({ reps: 5 });
    expect(eqMock).toHaveBeenCalledWith("id", "set-1");
    expect(selectMock).toHaveBeenCalledTimes(1);
    expect(singleMock).toHaveBeenCalledTimes(1);
  });

  it("writes only weight when patch = { weight: '100' }", async () => {
    const { updateSet } = await import("~/api/sets");
    await updateSet("set-1", { weight: "100" });

    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledWith({ weight: "100" });
  });

  it("writes only rpe when patch = { rpe: '9.0' }", async () => {
    const { updateSet } = await import("~/api/sets");
    await updateSet("set-1", { rpe: "9.0" });

    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledWith({ rpe: "9.0" });
  });

  it("writes rpe: null (explicit clear) when patch = { rpe: null }", async () => {
    const { updateSet } = await import("~/api/sets");
    await updateSet("set-1", { rpe: null });

    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledWith({ rpe: null });
  });

  it("writes all four columns when patch is full", async () => {
    const { updateSet } = await import("~/api/sets");
    await updateSet("set-1", {
      reps: 5,
      weight: "100",
      rpe: "9.0",
      notes: "felt heavy",
    });

    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledWith({
      reps: 5,
      weight: "100",
      rpe: "9.0",
      notes: "felt heavy",
    });
  });

  it("short-circuits and returns null for empty patch", async () => {
    const { updateSet } = await import("~/api/sets");
    const result = await updateSet("set-1", {});

    expect(result).toBeNull();
    expect(updateMock).not.toHaveBeenCalled();
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("short-circuits when every key is explicitly undefined", async () => {
    const { updateSet } = await import("~/api/sets");
    const result = await updateSet("set-1", {
      reps: undefined,
      weight: undefined,
    });

    expect(result).toBeNull();
    expect(updateMock).not.toHaveBeenCalled();
    expect(fromMock).not.toHaveBeenCalled();
  });
});
