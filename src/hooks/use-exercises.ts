import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createExercise,
  getExercise,
  listExercises,
  softDeleteExercise,
  updateExercise,
  type ExerciseInput,
} from "~/api/exercises";

const KEYS = {
  all: ["exercises"] as const,
  detail: (id: string) => ["exercises", id] as const,
};

export function useExercises() {
  return useQuery({
    queryKey: KEYS.all,
    queryFn: listExercises,
  });
}

export function useExercise(id: string | undefined) {
  return useQuery({
    queryKey: id ? KEYS.detail(id) : KEYS.all,
    queryFn: () => getExercise(id as string),
    enabled: Boolean(id),
  });
}

export function useCreateExercise() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ExerciseInput) => createExercise(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.all });
    },
  });
}

export function useUpdateExercise() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: ExerciseInput }) =>
      updateExercise(id, patch),
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: KEYS.all });
      qc.setQueryData(KEYS.detail(row.id), row);
    },
  });
}

export function useSoftDeleteExercise() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => softDeleteExercise(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.all });
    },
  });
}
