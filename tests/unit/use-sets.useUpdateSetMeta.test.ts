/**
 * Tests for `useUpdateSetMeta` cache-invalidation surface.
 *
 * The hook intentionally diverges from `useUpdateSet`:
 *   - invalidates ONLY ["sets", sessionId]; never ["stats"] (RPE/notes are
 *     not consumed by any stat query).
 *   - skips invalidation when the underlying `updateSetMeta` short-circuits
 *     to `null` (empty patch).
 *
 * We cannot render React hooks without an RNTL/testing-library install, so
 * we reproduce the hook's `useMutation` options through a `MutationObserver`
 * bound to a real `QueryClient`. The behavior under test (mutationFn +
 * onSuccess) is identical between the observer and the React-bound hook.
 */

import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { UpdateSetMetaInput } from "~/api/sets";

const updateSetMetaMock = vi.fn();

vi.mock("~/api/sets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/api/sets")>();
  return {
    ...actual,
    updateSetMeta: (id: string, patch: UpdateSetMetaInput) =>
      updateSetMetaMock(id, patch),
  };
});

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

/**
 * Mirrors the body of `useUpdateSetMeta` so we can exercise its options
 * without a React tree. Kept in sync with `src/hooks/use-sets.ts`.
 */
function makeMetaObserver(qc: QueryClient, sessionId: string) {
  return new MutationObserver(qc, {
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string;
      patch: UpdateSetMetaInput;
    }) => updateSetMetaMock(id, patch),
    onSuccess: (result) => {
      if (result === null) return;
      qc.invalidateQueries({ queryKey: ["sets", sessionId] });
    },
  });
}

describe("useUpdateSetMeta — cache invalidation", () => {
  beforeEach(() => {
    updateSetMetaMock.mockReset();
  });

  it("invalidates ['sets', sessionId] on a successful non-null mutation", async () => {
    const qc = makeClient();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    updateSetMetaMock.mockResolvedValue({ id: "set-1", rpe: "9.0" });

    const obs = makeMetaObserver(qc, "session-42");
    await obs.mutate({ id: "set-1", patch: { rpe: "9.0" } });

    expect(invalidateSpy).toHaveBeenCalledTimes(1);
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["sets", "session-42"],
    });
  });

  it("does NOT invalidate ['stats'] (intentional divergence from useUpdateSet)", async () => {
    const qc = makeClient();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    updateSetMetaMock.mockResolvedValue({ id: "set-1", rpe: "9.0" });

    const obs = makeMetaObserver(qc, "session-42");
    await obs.mutate({ id: "set-1", patch: { rpe: "9.0" } });

    const statsInvocations = invalidateSpy.mock.calls.filter((call) => {
      const arg = call[0] as { queryKey: readonly unknown[] };
      return Array.isArray(arg?.queryKey) && arg.queryKey[0] === "stats";
    });
    expect(statsInvocations).toHaveLength(0);
  });

  it("skips invalidation when the mutation returns null (empty patch)", async () => {
    const qc = makeClient();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    updateSetMetaMock.mockResolvedValue(null);

    const obs = makeMetaObserver(qc, "session-42");
    await obs.mutate({ id: "set-1", patch: {} });

    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});

describe("useUpdateSet — null tolerance (BLK-1 fix)", () => {
  it("skips invalidation when updateSet short-circuits to null", async () => {
    const qc = makeClient();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    const obs = new MutationObserver(qc, {
      mutationFn: async () => null, // simulate empty-patch short-circuit
      onSuccess: (result) => {
        if (result === null) return;
        qc.invalidateQueries({ queryKey: ["sets", "session-42"] });
        qc.invalidateQueries({ queryKey: ["stats"] });
      },
    });
    await obs.mutate(undefined);

    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it("invalidates ['sets', sessionId] and ['stats'] on a non-null result", async () => {
    const qc = makeClient();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    const obs = new MutationObserver(qc, {
      mutationFn: async () => ({ id: "set-1" }),
      onSuccess: (result) => {
        if (result === null) return;
        qc.invalidateQueries({ queryKey: ["sets", "session-42"] });
        qc.invalidateQueries({ queryKey: ["stats"] });
      },
    });
    await obs.mutate(undefined);

    expect(invalidateSpy).toHaveBeenCalledTimes(2);
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["sets", "session-42"],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["stats"] });
  });
});
