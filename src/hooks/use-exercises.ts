import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createExercise,
  getAnyExercise,
  getExercise,
  listAllExercises,
  listExercises,
  softDeleteExercise,
  updateExercise,
  type ExerciseInput,
} from "~/api/exercises";

// Cache key layout. Two parallel reader surfaces:
//   - `all` / `detail(id)`                       → soft-deleted EXCLUDED (picker, library).
//   - `allIncludingDeleted` / `detailIncludingDeleted(id)` → soft-deleted INCLUDED (history, progress).
// `["exercises"]` is a strict prefix of every other key here, so
// `invalidateQueries({ queryKey: KEYS.all })` invalidates BOTH surfaces and
// every detail variant via TanStack's prefix match. Mutations rely on that.
const KEYS = {
  all: ["exercises"] as const,
  detail: (id: string) => ["exercises", id] as const,
  allIncludingDeleted: ["exercises", "all"] as const,
  detailIncludingDeleted: (id: string) => ["exercises", "all", id] as const,
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

export function useAllExercises() {
  return useQuery({
    queryKey: KEYS.allIncludingDeleted,
    queryFn: listAllExercises,
  });
}

export function useAllExercise(id: string | undefined) {
  return useQuery({
    queryKey: id ? KEYS.detailIncludingDeleted(id) : KEYS.allIncludingDeleted,
    queryFn: () => getAnyExercise(id as string),
    enabled: Boolean(id),
  });
}

export function useCreateExercise() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ExerciseInput) => createExercise(input),
    onSuccess: () => {
      // Prefix-invalidate `["exercises"]` → covers both `all` and `allIncludingDeleted`.
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
      // Prefix-invalidate `["exercises"]` → covers both list keys + every detail variant.
      qc.invalidateQueries({ queryKey: KEYS.all });
      // Seed both detail caches so the rename reflects instantly on the next
      // detail render (filtered edit screen + include-deleted progress header).
      qc.setQueryData(KEYS.detail(row.id), row);
      qc.setQueryData(KEYS.detailIncludingDeleted(row.id), row);
    },
  });
}

export function useSoftDeleteExercise() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => softDeleteExercise(id),
    onSuccess: () => {
      // Prefix-invalidate `["exercises"]` → both filtered list (row drops out)
      // and unfiltered list (row stays, now flagged via `deleted_at`).
      qc.invalidateQueries({ queryKey: KEYS.all });
    },
  });
}
