import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  bulkCheckAllInSession,
  bulkSoftDeleteSetsForExerciseInSession,
  bulkSoftDeleteUncheckedInSession,
  checkSet,
  getLastWorkingSetForExercise,
  listSetsForSession,
  logSet,
  softDeleteSet,
  uncheckSet,
  updateSet,
  updateSetMeta,
  type CheckSetFill,
  type LogSetInput,
  type UpdateSetInput,
  type UpdateSetMetaInput,
} from "~/api/sets";
import type { SetRow } from "~/db/types";

const KEYS = {
  forSession: (sessionId: string) => ["sets", sessionId] as const,
  lastWorking: (exerciseId: string) =>
    ["sets", "last-working", exerciseId] as const,
};

export function useLastWorkingSet(exerciseId: string | undefined) {
  return useQuery({
    queryKey: exerciseId
      ? KEYS.lastWorking(exerciseId)
      : ["sets", "last-working", "none"],
    queryFn: () => getLastWorkingSetForExercise(exerciseId as string),
    enabled: Boolean(exerciseId),
  });
}

export function useSetsForSession(sessionId: string | undefined) {
  return useQuery({
    queryKey: sessionId ? KEYS.forSession(sessionId) : ["sets", "none"],
    queryFn: () => listSetsForSession(sessionId as string),
    enabled: Boolean(sessionId),
  });
}

export function useLogSet(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LogSetInput) => logSet(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.forSession(sessionId) });
      qc.invalidateQueries({ queryKey: ["stats"] });
      qc.invalidateQueries({ queryKey: ["progress"] });
    },
  });
}

/**
 * Partial-update mutation for a set's reps / weight / rpe / notes.
 *
 * Type intent: pass only the keys you want to write. `patch.X = undefined`
 * is tolerated but discouraged — omit the key instead. `patch.X = null`
 * explicitly clears the column.
 *
 * Returns null when the patch was empty (no keys with defined values); the
 * onSuccess handler then skips invalidation since nothing changed.
 */
export function useUpdateSet(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateSetInput }) =>
      updateSet(id, patch),
    onSuccess: (result) => {
      // result is null when the patch was empty. No invalidation needed.
      if (result === null) return;
      qc.invalidateQueries({ queryKey: KEYS.forSession(sessionId) });
      qc.invalidateQueries({ queryKey: ["stats"] });
      qc.invalidateQueries({ queryKey: ["progress"] });
    },
  });
}

/**
 * Partial-update hook for RPE and/or notes only. Diverges from useUpdateSet:
 *
 * - Uses updateSetMeta (true partial spread, not clobber).
 * - Invalidates ONLY ["sets", sessionId]. Does NOT invalidate ["stats"]
 *   because RPE and notes are not inputs to any stat query (volume = weight
 *   × reps; PR signals do not read rpe/notes). Skipping the stats
 *   invalidation avoids needless refetches on every chip tap.
 */
export function useUpdateSetMeta(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateSetMetaInput }) =>
      updateSetMeta(id, patch),
    onSuccess: (result) => {
      // result is null when the patch was empty. No invalidation needed.
      if (result === null) return;
      qc.invalidateQueries({ queryKey: KEYS.forSession(sessionId) });
    },
  });
}

export function useDeleteSet(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => softDeleteSet(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.forSession(sessionId) });
      qc.invalidateQueries({ queryKey: ["stats"] });
      qc.invalidateQueries({ queryKey: ["progress"] });
    },
  });
}

export function useRemoveExerciseFromSession(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (exerciseId: string) =>
      bulkSoftDeleteSetsForExerciseInSession({
        sessionId,
        exerciseId,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.forSession(sessionId) });
      qc.invalidateQueries({ queryKey: ["stats"] });
      qc.invalidateQueries({ queryKey: ["progress"] });
    },
  });
}

// Per-set check/uncheck and bulk Finish-flow helpers. These intentionally
// invalidate only the per-session sets cache: ["stats"] / ["progress"] are
// finished-session-only and are invalidated by useFinishSession.onSuccess
// (see use-sessions.ts).
export function useCheckSet(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, fill }: { id: string; fill?: CheckSetFill }) =>
      checkSet(id, fill),
    // Optimistic: stamp completed_at (plus any auto-fill weight/reps) into the
    // cached row synchronously so the check button flips to "done" on the same
    // frame as the tap — no waiting on the PATCH round-trip + invalidation
    // refetch. Mirrors the reorder precedent in use-routine-exercises.ts. The
    // weight/reps fold into the same write so F10 "checked = committed" stays
    // atomic (no window where a checked working set has null weight/reps).
    onMutate: async ({ id, fill }) => {
      await qc.cancelQueries({ queryKey: KEYS.forSession(sessionId) });
      const previous = qc.getQueryData<SetRow[]>(KEYS.forSession(sessionId));
      const nowIso = new Date().toISOString();
      qc.setQueryData<SetRow[]>(KEYS.forSession(sessionId), (old) =>
        old?.map((s) => {
          if (s.id !== id) return s;
          const next: SetRow = { ...s, completed_at: nowIso };
          if (fill?.weight !== undefined) next.weight = fill.weight;
          if (fill?.reps !== undefined) next.reps = fill.reps;
          return next;
        }),
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous !== undefined) {
        qc.setQueryData(KEYS.forSession(sessionId), ctx.previous);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: KEYS.forSession(sessionId) });
    },
  });
}

export function useUncheckSet(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => uncheckSet(id),
    // Optimistic clear of completed_at so the uncheck reads instant too.
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: KEYS.forSession(sessionId) });
      const previous = qc.getQueryData<SetRow[]>(KEYS.forSession(sessionId));
      qc.setQueryData<SetRow[]>(KEYS.forSession(sessionId), (old) =>
        old?.map((s) => (s.id === id ? { ...s, completed_at: null } : s)),
      );
      return { previous };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.previous !== undefined) {
        qc.setQueryData(KEYS.forSession(sessionId), ctx.previous);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: KEYS.forSession(sessionId) });
    },
  });
}

export function useBulkCheckAllInSession(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => bulkCheckAllInSession(sessionId),
    onSuccess: async () => {
      // Await the refetch so `mutateAsync` resolves only after the sets cache
      // for this session is fresh. The verdict screen (mounted right after the
      // Finish mutation that follows this one) depends on `setsQ.data`
      // reflecting the post-bulk-check state to render the correct total
      // volume + PR list. Fire-and-forget invalidation would leave a race
      // window where the verdict reads pre-bulk-check (mostly `completed_at =
      // null`) sets and under-counts. See run
      // `2026-05-22_0152_end-of-session-verdict` MAJ-2.
      await qc.refetchQueries({ queryKey: KEYS.forSession(sessionId) });
    },
  });
}

export function useBulkSoftDeleteUncheckedInSession(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => bulkSoftDeleteUncheckedInSession(sessionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.forSession(sessionId) });
    },
  });
}
