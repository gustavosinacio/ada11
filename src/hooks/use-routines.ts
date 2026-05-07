import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createRoutine,
  getRoutine,
  listRoutines,
  softDeleteRoutine,
  updateRoutine,
  type RoutineInput,
} from "~/api/routines";

const KEYS = {
  all: ["routines"] as const,
  detail: (id: string) => ["routines", id] as const,
};

export function useRoutines() {
  return useQuery({
    queryKey: KEYS.all,
    queryFn: listRoutines,
  });
}

export function useRoutine(id: string | undefined) {
  return useQuery({
    queryKey: id ? KEYS.detail(id) : KEYS.all,
    queryFn: () => getRoutine(id as string),
    enabled: Boolean(id),
  });
}

export function useCreateRoutine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RoutineInput) => createRoutine(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.all });
    },
  });
}

export function useUpdateRoutine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: RoutineInput }) =>
      updateRoutine(id, patch),
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: KEYS.all });
      qc.setQueryData(KEYS.detail(row.id), row);
    },
  });
}

export function useSoftDeleteRoutine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => softDeleteRoutine(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.all });
    },
  });
}
