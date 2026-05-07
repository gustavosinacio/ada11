import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  listSetsForSession,
  logSet,
  softDeleteSet,
  updateSet,
  type LogSetInput,
  type UpdateSetInput,
} from "~/api/sets";

const KEYS = {
  forSession: (sessionId: string) => ["sets", sessionId] as const,
};

export function useSetsForSession(sessionId: string | undefined) {
  return useQuery({
    queryKey: sessionId ? KEYS.forSession(sessionId) : ["sets", "none"],
    queryFn: () => listSetsForSession(sessionId as string),
    enabled: Boolean(sessionId),
  });
}

export function useLogSet(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LogSetInput) => logSet(input),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: KEYS.forSession(sessionId) }),
  });
}

export function useUpdateSet(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateSetInput }) =>
      updateSet(id, patch),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: KEYS.forSession(sessionId) }),
  });
}

export function useDeleteSet(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => softDeleteSet(id),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: KEYS.forSession(sessionId) }),
  });
}
