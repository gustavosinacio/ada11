import { useQuery } from "@tanstack/react-query";

import {
  adminGetRoutineDetail,
  adminGetSessionDetail,
  adminListRoutinesForUser,
  adminListSessionsForUser,
  adminListUsers,
  isCurrentUserAdmin,
} from "~/api/admin";

const KEYS = {
  isAdmin: ["admin", "is-admin"] as const,
  users: ["admin", "users"] as const,
  routinesForUser: (userId: string) =>
    ["admin", "routines", userId] as const,
  sessionsForUser: (userId: string) =>
    ["admin", "sessions", userId] as const,
  routineDetail: (routineId: string) =>
    ["admin", "routine-detail", routineId] as const,
  sessionDetail: (sessionId: string) =>
    ["admin", "session-detail", sessionId] as const,
};

export function useIsAdmin() {
  return useQuery({
    queryKey: KEYS.isAdmin,
    queryFn: isCurrentUserAdmin,
    staleTime: 60_000,
  });
}

export function useAdminUsers(enabled: boolean) {
  return useQuery({
    queryKey: KEYS.users,
    queryFn: adminListUsers,
    enabled,
    staleTime: 30_000,
  });
}

export function useAdminRoutinesForUser(userId: string | null) {
  return useQuery({
    queryKey: userId
      ? KEYS.routinesForUser(userId)
      : ["admin", "routines", "none"],
    queryFn: () => adminListRoutinesForUser(userId as string),
    enabled: Boolean(userId),
    staleTime: 15_000,
  });
}

export function useAdminSessionsForUser(userId: string | null) {
  return useQuery({
    queryKey: userId
      ? KEYS.sessionsForUser(userId)
      : ["admin", "sessions", "none"],
    queryFn: () => adminListSessionsForUser(userId as string),
    enabled: Boolean(userId),
    staleTime: 15_000,
  });
}

export function useAdminRoutineDetail(routineId: string | null) {
  return useQuery({
    queryKey: routineId
      ? KEYS.routineDetail(routineId)
      : ["admin", "routine-detail", "none"],
    queryFn: () => adminGetRoutineDetail(routineId as string),
    enabled: Boolean(routineId),
    staleTime: 15_000,
  });
}

export function useAdminSessionDetail(sessionId: string | null) {
  return useQuery({
    queryKey: sessionId
      ? KEYS.sessionDetail(sessionId)
      : ["admin", "session-detail", "none"],
    queryFn: () => adminGetSessionDetail(sessionId as string),
    enabled: Boolean(sessionId),
    staleTime: 15_000,
  });
}
