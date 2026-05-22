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
  type LogSetInput,
  type UpdateSetInput,
} from "~/api/sets";

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
    },
  });
}

export function useUpdateSet(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateSetInput }) =>
      updateSet(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.forSession(sessionId) });
      qc.invalidateQueries({ queryKey: ["stats"] });
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
    mutationFn: (id: string) => checkSet(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.forSession(sessionId) });
    },
  });
}

export function useUncheckSet(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => uncheckSet(id),
    onSuccess: () => {
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
