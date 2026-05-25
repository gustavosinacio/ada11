import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  getMyExerciseNote,
  upsertMyExerciseNote,
} from "~/api/exercise-notes";

const KEYS = {
  detail: (exerciseId: string) =>
    ["exercise_note", exerciseId, "me"] as const,
};

/**
 * Reader for the current user's note on `exerciseId`. Disabled until
 * `exerciseId` resolves. Returns `null` when no row exists.
 */
export function useMyExerciseNote(exerciseId: string | undefined | null) {
  return useQuery({
    queryKey: KEYS.detail(exerciseId ?? ""),
    queryFn: () => getMyExerciseNote(exerciseId as string),
    enabled: !!exerciseId,
  });
}

/**
 * Writer for the current user's note on `exerciseId`. Read-then-write under
 * the hood — see `src/api/exercise-notes.ts` for the partial-UNIQUE race
 * discussion. On success, the freshly-saved row is written into the cache
 * keyed by `["exercise_note", exerciseId, "me"]`.
 */
export function useUpsertMyExerciseNote(exerciseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => upsertMyExerciseNote(exerciseId, body),
    onSuccess: (row) => qc.setQueryData(KEYS.detail(exerciseId), row),
  });
}
