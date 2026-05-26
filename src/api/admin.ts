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
 * Server-side guard raises 42501 if the caller is not an admin — the RPC
 * surfaces that as a PostgREST error which becomes a thrown Error here.
 */
export async function adminListUsers(): Promise<AdminUserRow[]> {
  const { data, error } = await supabase.rpc("admin_list_users");
  if (error) throw error;
  return (data ?? []) as AdminUserRow[];
}

export type AdminRoutineRow = RoutineRow;

export async function adminListRoutinesForUser(
  userId: string,
): Promise<AdminRoutineRow[]> {
  const { data, error } = await supabase
    .from("routines")
    .select("*")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as AdminRoutineRow[];
}

export type AdminSessionRow = SessionRow;

export async function adminListSessionsForUser(
  userId: string,
): Promise<AdminSessionRow[]> {
  const { data, error } = await supabase
    .from("sessions")
    .select("*")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("started_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as AdminSessionRow[];
}

export type AdminRoutineDetail = {
  routine: RoutineRow;
  entries: (RoutineExerciseRow & { exercise: ExerciseRow })[];
  sets: RoutineExerciseSetRow[];
};

/** Read-only detail load for one routine — routine + entries (with their
 * exercise FK joined) + all per-set targets across the routine. */
export async function adminGetRoutineDetail(
  routineId: string,
): Promise<AdminRoutineDetail> {
  const [routineRes, entriesRes, setsRes] = await Promise.all([
    supabase
      .from("routines")
      .select("*")
      .eq("id", routineId)
      .is("deleted_at", null)
      .single(),
    supabase
      .from("routine_exercises")
      .select("*, exercise:exercises(*)")
      .eq("routine_id", routineId)
      .is("deleted_at", null)
      .order("position", { ascending: true }),
    supabase
      .from("routine_exercise_sets")
      .select("*")
      .in(
        "routine_exercise_id",
        // Inline subquery via PostgREST `in.(values)` is not possible; we
        // accept a small over-fetch and filter client-side. For typical
        // routines (≤10 exercises × ≤8 sets) this is a non-issue.
        (
          await supabase
            .from("routine_exercises")
            .select("id")
            .eq("routine_id", routineId)
            .is("deleted_at", null)
        ).data?.map((r) => r.id) ?? [],
      )
      .is("deleted_at", null)
      .order("set_number", { ascending: true }),
  ]);
  if (routineRes.error) throw routineRes.error;
  if (entriesRes.error) throw entriesRes.error;
  if (setsRes.error) throw setsRes.error;
  return {
    routine: routineRes.data as RoutineRow,
    entries: (entriesRes.data ?? []) as (RoutineExerciseRow & {
      exercise: ExerciseRow;
    })[],
    sets: (setsRes.data ?? []) as RoutineExerciseSetRow[],
  };
}

export type AdminSessionDetail = {
  session: SessionRow;
  sets: (SetRow & { exercise: ExerciseRow })[];
};

/** Read-only detail load for one session — session row + all non-deleted
 * sets joined with their exercise. Server-side ordered by set_number
 * (matching the live workout's stable-order convention from `sets.ts`). */
export async function adminGetSessionDetail(
  sessionId: string,
): Promise<AdminSessionDetail> {
  const [sessionRes, setsRes] = await Promise.all([
    supabase
      .from("sessions")
      .select("*")
      .eq("id", sessionId)
      .is("deleted_at", null)
      .single(),
    supabase
      .from("sets")
      .select("*, exercise:exercises(*)")
      .eq("session_id", sessionId)
      .is("deleted_at", null)
      .order("set_number", { ascending: true }),
  ]);
  if (sessionRes.error) throw sessionRes.error;
  if (setsRes.error) throw setsRes.error;
  return {
    session: sessionRes.data as SessionRow,
    sets: (setsRes.data ?? []) as (SetRow & { exercise: ExerciseRow })[],
  };
}
