import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  addExerciseToRoutine,
  listRoutineExercises,
  removeExerciseFromRoutine,
  reorderRoutineExercises,
  updateRoutineExercise,
  type RoutineExerciseTargets,
} from "~/api/routine-exercises";

const KEYS = {
  list: (routineId: string) => ["routine-exercises", routineId] as const,
};

export function useRoutineExercises(routineId: string | undefined) {
  return useQuery({
    queryKey: routineId ? KEYS.list(routineId) : ["routine-exercises", "none"],
    queryFn: () => listRoutineExercises(routineId as string),
    enabled: Boolean(routineId),
  });
}

export function useAddExerciseToRoutine(routineId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { exerciseId: string; targets?: RoutineExerciseTargets }) =>
      addExerciseToRoutine({ routineId, ...input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.list(routineId) }),
  });
}

export function useUpdateRoutineExercise(routineId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: RoutineExerciseTargets }) =>
      updateRoutineExercise(id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.list(routineId) }),
  });
}

export function useRemoveExerciseFromRoutine(routineId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => removeExerciseFromRoutine(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.list(routineId) }),
  });
}

export function useReorderRoutineExercises(routineId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orderedIds: string[]) =>
      reorderRoutineExercises(routineId, orderedIds),
    // Optimistic: rewrite the cache order synchronously so the chevron tap
    // feels instant. The actual reorder is 2N sequential PATCHes (two-phase
    // swap in routine-exercises.ts) which takes seconds on a 10-row routine.
    // The user's spec: "If we can't remove a delay, we need to show a loading
    // state somewhere" — optimistic UI removes the delay outright.
    onMutate: async (orderedIds) => {
      await qc.cancelQueries({ queryKey: KEYS.list(routineId) });
      const previous = qc.getQueryData(KEYS.list(routineId));
      qc.setQueryData(
        KEYS.list(routineId),
        (old: unknown) => {
          if (!Array.isArray(old)) return old;
          const byId = new Map(old.map((e: { id: string }) => [e.id, e]));
          return orderedIds.map((id) => byId.get(id)).filter(Boolean);
        },
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous !== undefined) {
        qc.setQueryData(KEYS.list(routineId), ctx.previous);
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: KEYS.list(routineId) }),
  });
}
