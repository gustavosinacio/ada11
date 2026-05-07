import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  finishSession,
  getActiveSession,
  getSession,
  listSessions,
  softDeleteSession,
  startSession,
  updateSessionNotes,
} from "~/api/sessions";

const KEYS = {
  all: ["sessions"] as const,
  active: ["sessions", "active"] as const,
  detail: (id: string) => ["sessions", id] as const,
};

export function useSessions() {
  return useQuery({
    queryKey: KEYS.all,
    queryFn: listSessions,
  });
}

export function useSession(id: string | undefined) {
  return useQuery({
    queryKey: id ? KEYS.detail(id) : ["sessions", "none"],
    queryFn: () => getSession(id as string),
    enabled: Boolean(id),
  });
}

export function useActiveSession() {
  return useQuery({
    queryKey: KEYS.active,
    queryFn: getActiveSession,
  });
}

export function useStartSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: startSession,
    onSuccess: (row) => {
      qc.setQueryData(KEYS.active, row);
      qc.invalidateQueries({ queryKey: KEYS.all });
    },
  });
}

export function useFinishSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => finishSession(id),
    onSuccess: (row) => {
      qc.setQueryData(KEYS.active, null);
      qc.invalidateQueries({ queryKey: KEYS.all });
      qc.setQueryData(KEYS.detail(row.id), row);
    },
  });
}

export function useUpdateSessionNotes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, notes }: { id: string; notes: string | null }) =>
      updateSessionNotes(id, notes),
    onSuccess: (row) => {
      qc.setQueryData(KEYS.detail(row.id), row);
      qc.invalidateQueries({ queryKey: KEYS.all });
    },
  });
}

export function useSoftDeleteSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => softDeleteSession(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.all });
      qc.invalidateQueries({ queryKey: KEYS.active });
    },
  });
}
