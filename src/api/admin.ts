import { supabase } from "~/lib/supabase";
import type {
  ExerciseRow,
  RoutineExerciseRow,
  RoutineExerciseSetRow,
  RoutineRow,
  SessionRow,
  SetRow,
} from "~/db/types";

export type AdminUserRow = {
  id: string;
  email: string | null;
  created_at: string;
  last_sign_in_at: string | null;
};

/**
 * True iff the current authenticated user is an admin. Resolves false when
 * unauthenticated or on transport error — the admin UI gates on `true` so a
 * false answer is the safe default.
 */
export async function isCurrentUserAdmin(): Promise<boolean> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) return false;
  const { data, error } = await supabase.rpc("is_admin", { uid });
  if (error) return false;
  return Boolean(data);
}

/**
 * Lists all auth.users via the SECURITY DEFINER `admin_list_users()` RPC.
 * Server-side guard raises 42501 if the caller is not an admin — surfaces
 * here as a thrown PostgrestError.
 */
export async function adminListUsers(): Promise<AdminUserRow[]> {
  const { data, error } = await supabase.rpc("admin_list_users");
  if (error) throw error;
  return (data ?? []) as AdminUserRow[];
}

export type AdminRoutineRow = RoutineRow;

/**
 * Admin-only RPC. The original client-side query (`from('routines').eq('user_id', X)`)
 * leaked admin RLS into every page — see 0017 migration header. Now goes
 * through `admin_routines_for_user`, which checks `is_admin(auth.uid())`
 * before bypassing RLS via SECURITY DEFINER.
 */
export async function adminListRoutinesForUser(
  userId: string,
): Promise<AdminRoutineRow[]> {
  const { data, error } = await supabase.rpc("admin_routines_for_user", {
    target_user_id: userId,
  });
  if (error) throw error;
  return (data ?? []) as AdminRoutineRow[];
}

export type AdminSessionRow = SessionRow;

export async function adminListSessionsForUser(
  userId: string,
): Promise<AdminSessionRow[]> {
  const { data, error } = await supabase.rpc("admin_sessions_for_user", {
    target_user_id: userId,
  });
  if (error) throw error;
  return (data ?? []) as AdminSessionRow[];
}

export type AdminRoutineDetail = {
  routine: RoutineRow;
  entries: (RoutineExerciseRow & { exercise: ExerciseRow })[];
  sets: RoutineExerciseSetRow[];
};

/**
 * Single RPC round-trip — server-side jsonb_build_object packs routine +
 * entries (with `exercise` joined) + per-set targets into one payload.
 */
export async function adminGetRoutineDetail(
  routineId: string,
): Promise<AdminRoutineDetail> {
  const { data, error } = await supabase.rpc("admin_routine_detail", {
    target_routine_id: routineId,
  });
  if (error) throw error;
  return data as AdminRoutineDetail;
}

export type AdminSessionDetail = {
  session: SessionRow;
  sets: (SetRow & { exercise: ExerciseRow })[];
};

export async function adminGetSessionDetail(
  sessionId: string,
): Promise<AdminSessionDetail> {
  const { data, error } = await supabase.rpc("admin_session_detail", {
    target_session_id: sessionId,
  });
  if (error) throw error;
  return data as AdminSessionDetail;
}
