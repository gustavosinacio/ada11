/**
 * Tests for `updateSetMeta` partial-spread semantics.
 *
 * `updateSetMeta` writes only the rpe and/or notes columns provided in the
 * patch. Tri-state: undefined = absent, null = explicit clear, value = write.
 * Empty patches short-circuit before any network call.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

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

describe("updateSetMeta — partial-spread payload", () => {
  beforeEach(() => {
    resetChain();
  });

  it("writes only rpe when patch = { rpe: '9.0' }", async () => {
    const { updateSetMeta } = await import("~/api/sets");
    await updateSetMeta("set-1", { rpe: "9.0" });

    expect(fromMock).toHaveBeenCalledWith("sets");
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledWith({ rpe: "9.0" });
    expect(eqMock).toHaveBeenCalledWith("id", "set-1");
    expect(selectMock).toHaveBeenCalledTimes(1);
    expect(singleMock).toHaveBeenCalledTimes(1);
  });

  it("writes rpe: null (explicit clear) for { rpe: null }", async () => {
    const { updateSetMeta } = await import("~/api/sets");
    await updateSetMeta("set-1", { rpe: null });

    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledWith({ rpe: null });
  });

  it("short-circuits for { rpe: undefined }", async () => {
    const { updateSetMeta } = await import("~/api/sets");
    const result = await updateSetMeta("set-1", { rpe: undefined });

    expect(result).toBeNull();
    expect(updateMock).not.toHaveBeenCalled();
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("writes both columns in one call for { rpe, notes }", async () => {
    const { updateSetMeta } = await import("~/api/sets");
    await updateSetMeta("set-1", { rpe: "9.0", notes: "x" });

    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledWith({ rpe: "9.0", notes: "x" });
  });

  it("writes only notes when patch = { notes: null }", async () => {
    const { updateSetMeta } = await import("~/api/sets");
    await updateSetMeta("set-1", { notes: null });

    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledWith({ notes: null });
  });

  it("short-circuits for empty patch {}", async () => {
    const { updateSetMeta } = await import("~/api/sets");
    const result = await updateSetMeta("set-1", {});

    expect(result).toBeNull();
    expect(updateMock).not.toHaveBeenCalled();
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("short-circuits when every key is explicitly undefined", async () => {
    const { updateSetMeta } = await import("~/api/sets");
    const result = await updateSetMeta("set-1", {
      rpe: undefined,
      notes: undefined,
    });

    expect(result).toBeNull();
    expect(updateMock).not.toHaveBeenCalled();
    expect(fromMock).not.toHaveBeenCalled();
  });
});
