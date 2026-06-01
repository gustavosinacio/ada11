import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  addFavorite,
  listMyFavoriteExerciseIds,
  removeFavorite,
} from "~/api/exercise-favorites";

const KEYS = { list: ["exercise_favorites", "me"] as const };

/**
 * Reader: the whole set of the current user's favorite exercise ids. The e1RM
 * chart needs the set (to union favorited lines in); the star derives
 * `isFavorite = data.includes(id)`. Returns `string[]`.
 *
 * One list key (not a per-exercise key) serves both readers AND re-renders the
 * chart on toggle — the optimistic `setQueryData` below produces a new array,
 * which flips both the chart and the star together (same cache, two readers).
 */
export function useMyFavoriteExerciseIds() {
  return useQuery({
    queryKey: KEYS.list,
    queryFn: listMyFavoriteExerciseIds,
  });
}

/**
 * Optimistic favorite toggle. `favorited` = the NEXT desired state (true →
 * add, false → remove). Mirrors the optimistic `onMutate`/`onError`/`onSettled`
 * shape in `useReorderRoutineExercises` (use-routine-exercises.ts:60-78),
 * adapted for a single `string[]` cache.
 */
export function useToggleFavorite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      exerciseId,
      favorited,
    }: {
      exerciseId: string;
      favorited: boolean;
    }) => (favorited ? addFavorite(exerciseId) : removeFavorite(exerciseId)),
    onMutate: async ({ exerciseId, favorited }) => {
      await qc.cancelQueries({ queryKey: KEYS.list });
      const prev = qc.getQueryData<string[]>(KEYS.list);
      qc.setQueryData<string[]>(KEYS.list, (old = []) =>
        favorited
          ? Array.from(new Set([...old, exerciseId]))
          : old.filter((x) => x !== exerciseId),
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEYS.list, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: KEYS.list }),
  });
}
