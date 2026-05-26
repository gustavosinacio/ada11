import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  addRoutineExerciseSet,
  listRoutineExerciseSetsForRoutine,
  removeRoutineExerciseSet,
  reorderRoutineExerciseSets,
  updateRoutineExerciseSet,
  type AddRoutineExerciseSetInput,
  type UpdateRoutineExerciseSetInput,
} from "~/api/routine-exercise-sets";

const KEYS = {
  list: (routineId: string) => ["routine-exercise-sets", routineId] as const,
};

export function useRoutineExerciseSets(routineId: string | undefined) {
  return useQuery({
    queryKey: routineId ? KEYS.list(routineId) : ["routine-exercise-sets", "none"],
    queryFn: () => listRoutineExerciseSetsForRoutine(routineId as string),
    enabled: Boolean(routineId),
  });
}

export function useAddRoutineExerciseSet(routineId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AddRoutineExerciseSetInput) => addRoutineExerciseSet(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.list(routineId) }),
  });
}

/**
 * Partial-update mutation for one routine_exercise_set's set_type /
 * target_reps / target_weight / notes columns.
 *
 * `updateRoutineExerciseSet` returns `null` for an empty patch — the
 * onSuccess guard MUST skip invalidation on a `null` result to avoid an
 * unnecessary refetch (matches `useUpdateSet` at
 * `src/hooks/use-sets.ts:71-73`).
 */
export function useUpdateRoutineExerciseSet(routineId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string;
      patch: UpdateRoutineExerciseSetInput;
    }) => updateRoutineExerciseSet(id, patch),
    onSuccess: (result) => {
      // result is null when the patch was empty. No invalidation needed.
      if (result === null) return;
      qc.invalidateQueries({ queryKey: KEYS.list(routineId) });
    },
  });
}

export function useRemoveRoutineExerciseSet(routineId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => removeRoutineExerciseSet(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.list(routineId) }),
  });
}

export function useReorderRoutineExerciseSets(routineId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      routineExerciseId,
      orderedIds,
    }: {
      routineExerciseId: string;
      orderedIds: string[];
    }) => reorderRoutineExerciseSets(routineExerciseId, orderedIds),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.list(routineId) }),
  });
}
