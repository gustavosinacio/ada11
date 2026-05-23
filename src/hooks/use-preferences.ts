import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  getMyPreferences,
  setLengthUnit,
  setMaxVolumeWindowWeeks,
  setWeightUnit,
} from "~/api/preferences";
import type {
  LengthUnit,
  MaxVolumeWindowWeeks,
  WeightUnit,
} from "~/db/types";

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

/**
 * Returns the user's configured "max-volume window" preference. Defaults to
 * `0` (lifetime) when no preferences row has been loaded yet — keeps
 * downstream kernels on their existing semantics until the real value arrives
 * from the server. See `MaxVolumeWindowWeeks` for the integer encoding.
 */
export function useMaxVolumeWindowWeeks(): MaxVolumeWindowWeeks {
  const { data } = usePreferences();
  return data?.max_volume_window_weeks ?? 0;
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

export function useSetMaxVolumeWindowWeeks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (weeks: MaxVolumeWindowWeeks) =>
      setMaxVolumeWindowWeeks(weeks),
    onSuccess: (row) => qc.setQueryData(KEY, row),
  });
}
