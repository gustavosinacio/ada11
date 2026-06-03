import type { InferInsertModel, InferSelectModel } from "drizzle-orm";

import {
  exerciseNotes,
  exercises,
  measurementEntries,
  routineExercises,
  routineExerciseSets,
  routines,
  sessions,
  sets,
  userExerciseFavorites,
  userPreferences,
} from "./schema";

export type UserPreferences = InferSelectModel<typeof userPreferences>;
export type Exercise = InferSelectModel<typeof exercises>;
export type NewExercise = InferInsertModel<typeof exercises>;

export type Routine = InferSelectModel<typeof routines>;
export type NewRoutine = InferInsertModel<typeof routines>;

export type RoutineExercise = InferSelectModel<typeof routineExercises>;
export type NewRoutineExercise = InferInsertModel<typeof routineExercises>;

export type RoutineExerciseSet = InferSelectModel<typeof routineExerciseSets>;
export type NewRoutineExerciseSet = InferInsertModel<typeof routineExerciseSets>;

export type Session = InferSelectModel<typeof sessions>;
export type NewSession = InferInsertModel<typeof sessions>;

export type Set = InferSelectModel<typeof sets>;
export type NewSet = InferInsertModel<typeof sets>;

export type MeasurementEntry = InferSelectModel<typeof measurementEntries>;
export type NewMeasurementEntry = InferInsertModel<typeof measurementEntries>;

export type ExerciseNote = InferSelectModel<typeof exerciseNotes>;
export type NewExerciseNote = InferInsertModel<typeof exerciseNotes>;

export type UserExerciseFavorite = InferSelectModel<
  typeof userExerciseFavorites
>;
export type NewUserExerciseFavorite = InferInsertModel<
  typeof userExerciseFavorites
>;

export type SetType = "warmup" | "working" | "dropset";
export type WeightUnit = "kg" | "lbs";
export type LengthUnit = "cm" | "in";

/**
 * User-selectable "max-volume window" sizes.
 *
 *   0  → lifetime (default — preserves pre-feature behaviour).
 *   10 → trailing 10 ISO weeks.
 *   20 → trailing 20 ISO weeks.
 *   30 → trailing 30 ISO weeks.
 *   40 → trailing 40 ISO weeks.
 *   50 → trailing 50 ISO weeks.
 *
 * The integer-encoded enum is the source of truth at every layer (Drizzle
 * column, PostgREST row, hook API, Profile segmented control). Mirrored by
 * the `user_preferences_max_volume_window_weeks_check` constraint in
 * `supabase/migrations/0009_max_volume_window.sql` (extended to add 40, 50
 * in `supabase/migrations/0015_max_volume_window_40_50.sql`).
 */
export type MaxVolumeWindowWeeks = 0 | 10 | 20 | 30 | 40 | 50;

/**
 * Canonical ordered list of supported window sizes. Iterated by the Profile
 * segmented control and by tests that enumerate every valid value.
 */
export const MAX_VOLUME_WINDOW_OPTIONS: readonly MaxVolumeWindowWeeks[] = [
  0, 10, 20, 30, 40, 50,
] as const;

/**
 * Display labels for each window size. "All" stands in for `0` (lifetime).
 * Single source of truth shared by the Profile segmented control
 * (`app/(app)/profile.tsx`) and the Progress-page window selector
 * (`src/components/progress-window-selector.tsx`).
 */
export const MAX_VOLUME_WINDOW_LABELS: Record<MaxVolumeWindowWeeks, string> = {
  0: "All",
  10: "10w",
  20: "20w",
  30: "30w",
  40: "40w",
  50: "50w",
};

// Row types matching PostgREST output (snake_case).
// Drizzle's InferSelectModel returns camelCase, but the Supabase JS client
// returns columns as-is — so screens and hooks consume these.

/**
 * Canonical equipment values. Catalog rows store lowercase canonical tokens
 * (normalised in `supabase/migrations/0014_backfill_exercise_muscles.sql`).
 * User-owned legacy rows MAY hold arbitrary strings — picker treats unknown
 * values as "none" without crashing.
 */
export type Equipment =
  | "barbell"
  | "bodyweight"
  | "cable"
  | "dumbbell"
  | "machine";

export const EQUIPMENT_OPTIONS: readonly Equipment[] = [
  "barbell",
  "bodyweight",
  "cable",
  "dumbbell",
  "machine",
] as const;

const EQUIPMENT_LABELS: Record<Equipment, string> = {
  barbell: "Barbell",
  bodyweight: "Bodyweight",
  cable: "Cable",
  dumbbell: "Dumbbell",
  machine: "Machine",
};

export function equipmentLabel(value: Equipment): string {
  return EQUIPMENT_LABELS[value];
}

/**
 * Display equipment from a possibly-legacy string. Canonical lowercase values
 * render with the labeled capitalisation ("barbell" → "Barbell"); unknown
 * legacy strings render verbatim so existing user-owned rows aren't lost.
 */
export function formatEquipment(value: string | null | undefined): string | null {
  if (!value) return null;
  if ((EQUIPMENT_OPTIONS as readonly string[]).includes(value)) {
    return equipmentLabel(value as Equipment);
  }
  return value;
}

export type MuscleGroup =
  | "Chest"
  | "Upper back"
  | "Lower back"
  | "Shoulders"
  | "Arms"
  | "Legs"
  | "Core";

export const MUSCLE_GROUPS: readonly MuscleGroup[] = [
  "Chest",
  "Upper back",
  "Lower back",
  "Shoulders",
  "Arms",
  "Legs",
  "Core",
] as const;

export type ExerciseRow = {
  id: string;
  // `null` = canonical row (shared catalog, admin-managed via service role
  // — visible to every authenticated user via the widened RLS SELECT policy
  // `user_id IS NULL OR auth.uid() = user_id` introduced in
  // supabase/migrations/0011_canonical_exercises.sql).
  // Non-null = user-owned exercise (the "Created by you" chip predicate is
  // `user_id !== null`).
  user_id: string | null;
  name: string;
  muscles: string[];
  equipment: string | null;
  // Per-exercise bodyweight leverage factor (push-up ≈ 0.64, pull-up/dip ≈
  // 1.0). `numeric` ⇒ the Supabase JS client returns it as a STRING (matches
  // every sibling numeric on these row types). Rides `select("*")` on every
  // read path. NULL ⇒ the app coalesces to 1.0 (NEVER 0). See migration
  // 0021_bodyweight_factor.sql.
  bodyweight_factor: string | null;
  notes: string | null;
  source: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type RoutineRow = {
  id: string;
  user_id: string;
  name: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type RoutineExerciseRow = {
  id: string;
  user_id: string;
  routine_id: string;
  exercise_id: string;
  position: number;
  target_rest_seconds: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type RoutineExerciseSetRow = {
  id: string;
  user_id: string;
  routine_exercise_id: string;
  set_number: number;
  set_type: SetType; // 'warmup' | 'working' | 'dropset'
  target_reps: number | null;
  target_weight: string | null; // numeric(6,2) — kg, internal
  parent_set_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type SessionRow = {
  id: string;
  user_id: string;
  routine_id: string | null;
  name: string | null;
  started_at: string;
  ended_at: string | null;
  notes: string | null;
  source: string | null;
  // Ordered exercise_id[] (the per-session exercise display order). Postgres
  // `uuid[]` round-trips as a JS `string[]` via supabase-js/PostgREST — same
  // as `exercises.muscles` (`text[]` → `string[]`). Nullable: legacy /
  // in-progress sessions are NULL and the read side falls back to a
  // deterministic first-occurrence order.
  session_exercise_order: string[] | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type SetRow = {
  id: string;
  user_id: string;
  session_id: string;
  exercise_id: string;
  set_number: number;
  reps: number | null;
  weight: string | null;
  rpe: string | null;
  set_type: SetType;
  parent_set_id: string | null;
  notes: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type MeasurementEntryRow = {
  id: string;
  user_id: string;
  measured_at: string;
  weight_kg: string | null;
  body_fat_pct: string | null;
  neck_cm: string | null;
  chest_cm: string | null;
  biceps_cm: string | null;
  forearm_cm: string | null;
  waist_cm: string | null;
  hips_cm: string | null;
  thigh_cm: string | null;
  calf_cm: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type ExerciseNoteRow = {
  id: string;
  user_id: string;
  exercise_id: string;
  body: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type UserExerciseFavoriteRow = {
  user_id: string;
  exercise_id: string;
  created_at: string;
};
