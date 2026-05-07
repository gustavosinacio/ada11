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
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.list(routineId) }),
  });
}
