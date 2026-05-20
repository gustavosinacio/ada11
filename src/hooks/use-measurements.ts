import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createMeasurement,
  getMeasurement,
  listMeasurements,
  softDeleteMeasurement,
  updateMeasurement,
  type MeasurementInput,
} from "~/api/measurements";

const KEYS = {
  all: ["measurements"] as const,
  detail: (id: string) => ["measurements", id] as const,
};

export function useMeasurements() {
  return useQuery({
    queryKey: KEYS.all,
    queryFn: listMeasurements,
  });
}

export function useMeasurement(id: string | undefined) {
  return useQuery({
    queryKey: id ? KEYS.detail(id) : KEYS.all,
    queryFn: () => getMeasurement(id as string),
    enabled: Boolean(id),
  });
}

export function useCreateMeasurement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: MeasurementInput) => createMeasurement(input),
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: KEYS.all });
      qc.setQueryData(KEYS.detail(row.id), row);
    },
  });
}

export function useUpdateMeasurement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: MeasurementInput }) =>
      updateMeasurement(id, patch),
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: KEYS.all });
      qc.setQueryData(KEYS.detail(row.id), row);
    },
  });
}

export function useSoftDeleteMeasurement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => softDeleteMeasurement(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.all });
    },
  });
}
