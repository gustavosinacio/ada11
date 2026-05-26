import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { seedSetsForSession } from "~/api/routine-exercise-sets";
import {
  finishSession,
  getActiveSession,
  getSession,
  listSessions,
  softDeleteSession,
  startSession,
  updateSessionName,
  updateSessionNotes,
  updateSessionTimes,
} from "~/api/sessions";
import { supabase } from "~/lib/supabase";

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

/**
 * Start a session from a routine AND pre-seed `sets` rows from the routine's
 * per-set config in one mutation.
 *
 * Failure policy: HARD FAIL (MAJ-2 in design-v2). No try/catch around
 * `seedSetsForSession` — any seed error propagates to `mutateAsync`'s caller.
 * The caller (`startFromRoutine` in `app/(app)/workout/index.tsx`) has its
 * own `catch (err) { console.warn("Start failed", err); }` that keeps the
 * user on the routines list. The orphan empty session row remains in the DB;
 * it shows up in History as in-progress and the user can resume or delete
 * it manually.
 *
 * No rollback: a rollback is itself a write that can fail, and an empty
 * session is salvageable rather than destructive.
 */
export function useStartSessionFromRoutine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { routine_id: string; name?: string | null }) => {
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth.user?.id;
      if (!userId) throw new Error("Not authenticated");

      const session = await startSession({
        routine_id: input.routine_id,
        name: input.name ?? null,
      });
      // No try/catch — propagate seed failures (MAJ-2 hard-fail policy).
      await seedSetsForSession({
        session_id: session.id,
        routine_id: input.routine_id,
        user_id: userId,
      });
      return session;
    },
    onSuccess: (row) => {
      qc.setQueryData(KEYS.active, row);
      qc.invalidateQueries({ queryKey: KEYS.all });
      qc.invalidateQueries({ queryKey: ["sets", row.id] });
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
      qc.invalidateQueries({ queryKey: ["stats"] });
      qc.invalidateQueries({ queryKey: ["progress"] });
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

export function useUpdateSessionName() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string | null }) =>
      updateSessionName(id, name),
    onSuccess: (row) => {
      qc.setQueryData(KEYS.detail(row.id), row);
      qc.invalidateQueries({ queryKey: KEYS.all });
    },
  });
}

export function useUpdateSessionTimes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      started_at,
      ended_at,
    }: {
      id: string;
      started_at: string;
      ended_at: string;
    }) => updateSessionTimes(id, { started_at, ended_at }),
    onSuccess: (row) => {
      qc.setQueryData(KEYS.detail(row.id), row);
      qc.invalidateQueries({ queryKey: KEYS.all });
      qc.invalidateQueries({ queryKey: KEYS.active });
      qc.invalidateQueries({ queryKey: ["stats"] });
      qc.invalidateQueries({ queryKey: ["progress"] });
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
      qc.invalidateQueries({ queryKey: ["stats"] });
      qc.invalidateQueries({ queryKey: ["progress"] });
    },
  });
}
