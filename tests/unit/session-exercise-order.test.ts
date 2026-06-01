/**
 * Unit tests for the per-session exercise-order helper.
 *
 * Run-id: 2026-06-01_0941_session-finish-exercise-order
 *
 * `orderExerciseIds` is the pure core of the History detail's persisted-aware
 * exercise ordering (the BLOCKER fix). It orders discovered exercise ids by a
 * persisted `session_exercise_order` array with a deterministic
 * first-occurrence fallback. Testing it here pins the contract independent of
 * the React screen.
 */

import { describe, expect, it } from "vitest";

import { orderExerciseIds } from "~/utils/session-exercise-order";

describe("orderExerciseIds", () => {
  it("returns the discovered order unchanged when persistedOrder is null (legacy session)", () => {
    expect(orderExerciseIds(["b", "c", "a"], null)).toEqual(["b", "c", "a"]);
  });

  it("returns the discovered order unchanged when persistedOrder is undefined", () => {
    expect(orderExerciseIds(["b", "c", "a"], undefined)).toEqual(["b", "c", "a"]);
  });

  it("returns the discovered order unchanged when persistedOrder is empty", () => {
    expect(orderExerciseIds(["b", "c", "a"], [])).toEqual(["b", "c", "a"]);
  });

  it("orders discovered ids by the persisted sequence (the headline fix)", () => {
    // Discovered (set first-occurrence / insertion) order is b,c,a; the user
    // saw a,b,c (snapshotted). History must render a,b,c.
    expect(orderExerciseIds(["b", "c", "a"], ["a", "b", "c"])).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("appends ids absent from the persisted order after the ordered ones (edit-added exercise)", () => {
    // a,b persisted; d was added in History edit after the snapshot.
    expect(orderExerciseIds(["b", "a", "d"], ["a", "b"])).toEqual([
      "a",
      "b",
      "d",
    ]);
  });

  it("keeps the first-occurrence order among the appended (unpersisted) ids", () => {
    // Persisted only knows "a"; d and e were both added later — they keep their
    // discovered relative order (d before e).
    expect(orderExerciseIds(["e", "a", "d"], ["a"])).toEqual(["a", "e", "d"]);
  });

  it("ignores persisted ids that are not in the discovered set (stale / removed / never-logged)", () => {
    // "x" is persisted (e.g. an added-but-never-logged exercise from a prior
    // reorder) but has no surviving sets, so it is not discovered → dropped.
    expect(orderExerciseIds(["a", "b"], ["x", "b", "a"])).toEqual(["b", "a"]);
  });

  it("handles a fully-persisted, fully-discovered set with a permutation", () => {
    expect(
      orderExerciseIds(["a", "b", "c", "d"], ["d", "c", "b", "a"]),
    ).toEqual(["d", "c", "b", "a"]);
  });

  it("returns an empty list for no discovered exercises regardless of persisted order", () => {
    expect(orderExerciseIds([], ["a", "b"])).toEqual([]);
    expect(orderExerciseIds([], null)).toEqual([]);
  });

  it("does not mutate its inputs", () => {
    const discovered = ["b", "a"];
    const persisted = ["a", "b"];
    orderExerciseIds(discovered, persisted);
    expect(discovered).toEqual(["b", "a"]);
    expect(persisted).toEqual(["a", "b"]);
  });

  it("places a single persisted id first and appends the rest in discovered order (legacy first-reorder snapshot)", () => {
    // Legacy recovery: the persisted column was just written with one move
    // applied; the rest of the discovered ids follow in their original order.
    expect(orderExerciseIds(["a", "b", "c"], ["b", "a", "c"])).toEqual([
      "b",
      "a",
      "c",
    ]);
  });
});
