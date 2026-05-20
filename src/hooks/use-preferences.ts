import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { getMyPreferences, setLengthUnit, setWeightUnit } from "~/api/preferences";
import type { LengthUnit, WeightUnit } from "~/db/types";

const KEY = ["preferences", "me"] as const;

export function usePreferences() {
  return useQuery({
    queryKey: KEY,
    queryFn: getMyPreferences,
  });
}

export function useWeightUnit(): WeightUnit {
  const { data } = usePreferences();
  return data?.weight_unit ?? "kg";
}

export function useLengthUnit(): LengthUnit {
  const { data } = usePreferences();
  return data?.length_unit ?? "cm";
}

export function useSetWeightUnit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (unit: WeightUnit) => setWeightUnit(unit),
    onSuccess: (row) => qc.setQueryData(KEY, row),
  });
}

export function useSetLengthUnit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (unit: LengthUnit) => setLengthUnit(unit),
    onSuccess: (row) => qc.setQueryData(KEY, row),
  });
}
