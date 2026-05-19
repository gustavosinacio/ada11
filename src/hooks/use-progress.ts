import { useQuery } from "@tanstack/react-query";

import { listSetsForExercise } from "~/api/progress";

export function useExerciseProgress(exerciseId: string | undefined) {
  return useQuery({
    queryKey: ["progress", exerciseId],
    queryFn: () => listSetsForExercise(exerciseId!),
    enabled: !!exerciseId,
  });
}
