import { supabase } from "~/lib/supabase";
import type { RoutineExerciseSetRow, SetType } from "~/db/types";

/**
 * Snake-case shape passed to `supabase.from("sets").insert(...)`. Matches the
 * PostgREST row shape (NOT the Drizzle InferInsertModel, which is camelCase).
 * Used internally by `seedSetsForSession` because the seed builds rows in JS
 * then bulk-inserts via PostgREST.
 */
type NewSetPayload = {
  user_id: string;
  session_id: string;
  exercise_id: string;
  set_number: number;
  set_type: SetType;
  reps: number | null;
  weight: string | null;
  rpe: string | null;
  notes: string | null;
  completed_at: string | null;
  parent_set_id: string | null;
};

export type AddRoutineExerciseSetInput = {
  routine_exercise_id: string;
  set_type: SetType;
  target_reps?: number | null;
  target_weight?: string | null;
  parent_set_id?: string | null;
  notes?: string | null;
};

/**
 * Patch shape for `updateRoutineExerciseSet`.
 *
 * Tri-state semantics per key (binding on all callers — mirrors
 * `updateSet`/`updateSetMeta`):
 *   - key omitted (or value `undefined`) → column NOT touched.
 *   - key present with value `null`      → column EXPLICITLY cleared.
 *   - key present with a value           → column written.
 *
 * Empty patch short-circuits before any network call and returns `null`.
 * Callers (useUpdateRoutineExerciseSet) MUST tolerate a `null` result
 * by skipping cache writes.
 */
export type UpdateRoutineExerciseSetInput = {
  set_type?: SetType;
  target_reps?: number | null;
  target_weight?: string | null;
  notes?: string | null;
};

export async function listRoutineExerciseSetsForRoutine(
  routineId: string,
): Promise<RoutineExerciseSetRow[]> {
  const { data, error } = await supabase
    .from("routine_exercise_sets")
    .select("*, routine_exercises!inner(routine_id)")
    .eq("routine_exercises.routine_id", routineId)
    .is("deleted_at", null)
    .order("set_number", { ascending: true });
  if (error) throw error;
  // MIN-6: strip the embedded `routine_exercises` field so the returned shape
  // is exactly RoutineExerciseSetRow[] (no leaked join column). Mirrors
  // `getLastWorkingSetForExercise`'s destructure pattern at `sets.ts:200-203`.
  return ((data ?? []) as (RoutineExerciseSetRow & { routine_exercises: unknown })[]).map(
    ({ routine_exercises: _re, ...row }) => row as RoutineExerciseSetRow,
  );
}

export async function listRoutineExerciseSetsForRoutineExercise(
  routineExerciseId: string,
): Promise<RoutineExerciseSetRow[]> {
  const { data, error } = await supabase
    .from("routine_exercise_sets")
    .select("*")
    .eq("routine_exercise_id", routineExerciseId)
    .is("deleted_at", null)
    .order("set_number", { ascending: true });
  if (error) throw error;
  return (data ?? []) as RoutineExerciseSetRow[];
}

export async function addRoutineExerciseSet(
  input: AddRoutineExerciseSetInput,
): Promise<RoutineExerciseSetRow> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error("Not authenticated");

  // Compute next set_number from MAX(set_number) WHERE deleted_at IS NULL + 1.
  // Identical pattern to `src/api/sets.ts:63-73`.
  const { data: existing, error: numErr } = await supabase
    .from("routine_exercise_sets")
    .select("set_number")
    .eq("routine_exercise_id", input.routine_exercise_id)
    .is("deleted_at", null)
    .order("set_number", { ascending: false })
    .limit(1);
  if (numErr) throw numErr;
  const nextNumber = (existing?.[0]?.set_number ?? 0) + 1;

  const { data, error } = await supabase
    .from("routine_exercise_sets")
    .insert({
      user_id: userId,
      routine_exercise_id: input.routine_exercise_id,
      set_number: nextNumber,
      set_type: input.set_type,
      target_reps: input.target_reps ?? null,
      target_weight: input.target_weight ?? null,
      parent_set_id: input.parent_set_id ?? null,
      notes: input.notes ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data as RoutineExerciseSetRow;
}

/**
 * Partial-update for one routine_exercise_set's set_type / target_reps /
 * target_weight / notes columns. Tri-state semantics per `UpdateRoutineExerciseSetInput`.
 *
 * Empty patch (`{}` or all-undefined) short-circuits before any network call
 * and returns `null`. Mirrors `updateSet` at `src/api/sets.ts:113-138`.
 */
export async function updateRoutineExerciseSet(
  id: string,
  patch: UpdateRoutineExerciseSetInput,
): Promise<RoutineExerciseSetRow | null> {
  const payload: {
    set_type?: SetType;
    target_reps?: number | null;
    target_weight?: string | null;
    notes?: string | null;
  } = {};
  if (patch.set_type !== undefined) payload.set_type = patch.set_type;
  if (patch.target_reps !== undefined) payload.target_reps = patch.target_reps;
  if (patch.target_weight !== undefined) payload.target_weight = patch.target_weight;
  if (patch.notes !== undefined) payload.notes = patch.notes;

  if (Object.keys(payload).length === 0) return null;

  const { data, error } = await supabase
    .from("routine_exercise_sets")
    .update(payload)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as RoutineExerciseSetRow;
}

export async function removeRoutineExerciseSet(id: string): Promise<void> {
  const { error } = await supabase
    .from("routine_exercise_sets")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

/**
 * Reorders sets within a routine_exercise to match the given id order. Uses
 * a two-step swap (park to negatives, then write final positions) to avoid
 * tripping the partial UNIQUE on `(routine_exercise_id, set_number) WHERE
 * deleted_at IS NULL`. set_number is 1-indexed.
 *
 * Mirrors `reorderRoutineExercises` at `src/api/routine-exercises.ts:99-123`.
 */
export async function reorderRoutineExerciseSets(
  routineExerciseId: string,
  orderedIds: string[],
): Promise<void> {
  // Step 1: park each row at -(idx + 1) so no two rows collide on the partial-unique idx.
  for (let i = 0; i < orderedIds.length; i++) {
    const id = orderedIds[i]!;
    const { error } = await supabase
      .from("routine_exercise_sets")
      .update({ set_number: -(i + 1) })
      .eq("id", id)
      .eq("routine_exercise_id", routineExerciseId);
    if (error) throw error;
  }
  // Step 2: write final positions (1-indexed).
  for (let i = 0; i < orderedIds.length; i++) {
    const id = orderedIds[i]!;
    const { error } = await supabase
      .from("routine_exercise_sets")
      .update({ set_number: i + 1 })
      .eq("id", id)
      .eq("routine_exercise_id", routineExerciseId);
    if (error) throw error;
  }
}

// ---------------------------------------------------------------------------
// Seed-on-Start
// ---------------------------------------------------------------------------

export type SeedSetsForSessionInput = {
  session_id: string;
  routine_id: string;
  user_id: string;
};

export type SeedSetsForSessionResult = {
  inserted: number;
  skipped_routine_exercise_ids: string[];
};

/**
 * Bulk-INSERT `sets` rows from a routine's per-set config. Called from
 * `useStartSessionFromRoutine` after `startSession` resolves.
 *
 * The natural key for the dropset two-pass remap is `(exercise_id, set_number)`,
 * provably unique post-migration-0013 by the new partial-unique on
 * `routine_exercises(routine_id, exercise_id) WHERE deleted_at IS NULL`
 * combined with monotonic per-exercise `set_number` assignment in step 3 below.
 *
 * Hard-fail policy (MAJ-2): any error propagates to `mutateAsync`'s caller.
 * The hook deliberately does NOT wrap this in try/catch. See
 * `useStartSessionFromRoutine` in `src/hooks/use-sessions.ts`.
 */
export async function seedSetsForSession(
  input: SeedSetsForSessionInput,
): Promise<SeedSetsForSessionResult> {
  // Step 1. Read routine config (one PostgREST call, inner-join filter on
  // active routine_exercises). The inner join on routine_exercises with the
  // dotted-path filter excludes soft-deleted parents AND, by JOIN semantics,
  // their child rows even if children are not themselves soft-deleted (which
  // would be an orphan state — see MIN-7 informational note).
  const { data: routineSetsData, error: readErr } = await supabase
    .from("routine_exercise_sets")
    .select(
      `id, set_number, set_type, target_reps, target_weight, parent_set_id,
       routine_exercises!inner ( id, exercise_id, routine_id, deleted_at )`,
    )
    .eq("routine_exercises.routine_id", input.routine_id)
    .is("deleted_at", null)
    .is("routine_exercises.deleted_at", null)
    .order("set_number", { ascending: true });
  if (readErr) throw readErr;

  type RoutineSetWithParent = {
    id: string;
    set_number: number;
    set_type: SetType;
    target_reps: number | null;
    target_weight: string | null;
    parent_set_id: string | null;
    routine_exercises: {
      id: string;
      exercise_id: string;
      routine_id: string;
      deleted_at: string | null;
    };
  };
  const routineSets = (routineSetsData ?? []) as unknown as RoutineSetWithParent[];

  // Step 2. Idempotency guard at routine_exercise_id granularity.
  // For any routine_exercise whose sets already exist (non-deleted) in this
  // session, skip ALL its routine sets. Tracking at routine_exercise_id is
  // safe because the new (routine_id, exercise_id) partial-unique (0013)
  // guarantees at most one non-deleted routine_exercise per exercise.
  const { data: existingSessionSets, error: existErr } = await supabase
    .from("sets")
    .select("exercise_id, set_number")
    .eq("session_id", input.session_id)
    .is("deleted_at", null);
  if (existErr) throw existErr;
  const seenExerciseIds = new Set<string>(
    (existingSessionSets ?? []).map((r) => r.exercise_id as string),
  );
  const skippedRoutineExerciseIds = new Set<string>();

  // Step 3. ONE pass over routineSets. Build the row arrays AND the natural-
  // key map simultaneously. The natural key is (exercise_id, set_number).
  type DropsetWork = NewSetPayload & {
    __sourceRoutineSetId: string;
    __parentRoutineSetId: string;
  };
  const nonDropsetRows: NewSetPayload[] = [];
  const dropsetRows: DropsetWork[] = [];
  const setNumberByExercise = new Map<string, number>();
  const routineSetIdToNaturalKey = new Map<string, string>();

  for (const rs of routineSets) {
    const exId = rs.routine_exercises.exercise_id;
    const reId = rs.routine_exercises.id;
    if (seenExerciseIds.has(exId)) {
      skippedRoutineExerciseIds.add(reId);
      continue;
    }
    const nextNumber = (setNumberByExercise.get(exId) ?? 0) + 1;
    setNumberByExercise.set(exId, nextNumber);

    const naturalKey = `${exId}:${nextNumber}`;
    routineSetIdToNaturalKey.set(rs.id, naturalKey);

    const base: NewSetPayload = {
      user_id: input.user_id,
      session_id: input.session_id,
      exercise_id: exId,
      set_number: nextNumber,
      reps: rs.target_reps,
      weight: rs.target_weight,
      rpe: null,
      notes: null,
      set_type: rs.set_type,
      completed_at: null,
      parent_set_id: null, // patched for dropsets in pass 2
    };

    if (rs.set_type === "dropset") {
      if (!rs.parent_set_id) {
        // DB CHECK invariant should make this unreachable; defensive throw.
        throw new Error(
          `seedSetsForSession: dropset routine_exercise_set ${rs.id} has null parent_set_id`,
        );
      }
      dropsetRows.push({
        ...base,
        __sourceRoutineSetId: rs.id,
        __parentRoutineSetId: rs.parent_set_id,
      });
    } else {
      nonDropsetRows.push(base);
    }
  }

  // Step 4. Pass 1: bulk-insert non-dropsets, RETURNING *. Re-key the inserted
  // sets by natural key (exercise_id, set_number) since PostgREST
  // .insert(rows).select() does NOT guarantee return order matches input
  // order. The natural key is unique by the existing (session_id,
  // exercise_id, set_number) partial-unique at
  // `0008_sets_unique_set_number.sql:15-17`.
  const setsIdByNaturalKey = new Map<string, string>();
  let insertedNonDropsetCount = 0;
  if (nonDropsetRows.length > 0) {
    const { data: insertedNonDropsets, error: insErr1 } = await supabase
      .from("sets")
      .insert(nonDropsetRows)
      .select();
    if (insErr1) throw insErr1;
    for (const s of insertedNonDropsets ?? []) {
      const row = s as { id: string; exercise_id: string; set_number: number };
      setsIdByNaturalKey.set(`${row.exercise_id}:${row.set_number}`, row.id);
    }
    insertedNonDropsetCount = insertedNonDropsets?.length ?? 0;
  }

  // Step 5. Pass 2: resolve dropset parent_set_id via the SAME map built in
  // step 3 (routineSetIdToNaturalKey), then look up the freshly inserted
  // sets.id via setsIdByNaturalKey. Unresolvable dropsets (parent's routine
  // row was soft-deleted between the read and this point — rare) are dropped
  // silently — better than failing the whole seed with a CHECK violation.
  let insertedDropsetCount = 0;
  if (dropsetRows.length > 0) {
    const resolved: NewSetPayload[] = [];
    for (const dr of dropsetRows) {
      const parentNatural = routineSetIdToNaturalKey.get(dr.__parentRoutineSetId);
      const parentSetId = parentNatural
        ? (setsIdByNaturalKey.get(parentNatural) ?? null)
        : null;
      if (!parentSetId) continue;
      const { __sourceRoutineSetId: _src, __parentRoutineSetId: _parent, ...row } = dr;
      resolved.push({ ...row, parent_set_id: parentSetId });
    }
    if (resolved.length > 0) {
      const { error: insErr2 } = await supabase.from("sets").insert(resolved);
      if (insErr2) throw insErr2;
      insertedDropsetCount = resolved.length;
    }
  }

  return {
    inserted: insertedNonDropsetCount + insertedDropsetCount,
    skipped_routine_exercise_ids: Array.from(skippedRoutineExerciseIds),
  };
}
