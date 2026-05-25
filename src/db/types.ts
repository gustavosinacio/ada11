import type { InferInsertModel, InferSelectModel } from "drizzle-orm";

import {
  exerciseNotes,
  exercises,
  measurementEntries,
  routineExercises,
  routines,
  sessions,
  sets,
  userPreferences,
} from "./schema";

export type UserPreferences = InferSelectModel<typeof userPreferences>;
export type Exercise = InferSelectModel<typeof exercises>;
export type NewExercise = InferInsertModel<typeof exercises>;

export type Routine = InferSelectModel<typeof routines>;
export type NewRoutine = InferInsertModel<typeof routines>;

export type RoutineExercise = InferSelectModel<typeof routineExercises>;
export type NewRoutineExercise = InferInsertModel<typeof routineExercises>;

export type Session = InferSelectModel<typeof sessions>;
export type NewSession = InferInsertModel<typeof sessions>;

export type Set = InferSelectModel<typeof sets>;
export type NewSet = InferInsertModel<typeof sets>;

export type MeasurementEntry = InferSelectModel<typeof measurementEntries>;
export type NewMeasurementEntry = InferInsertModel<typeof measurementEntries>;

export type ExerciseNote = InferSelectModel<typeof exerciseNotes>;
export type NewExerciseNote = InferInsertModel<typeof exerciseNotes>;

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
 *
 * The integer-encoded enum is the source of truth at every layer (Drizzle
 * column, PostgREST row, hook API, Profile segmented control). Mirrored by
 * the `user_preferences_max_volume_window_weeks_check` constraint in
 * `supabase/migrations/0009_max_volume_window.sql`.
 */
export type MaxVolumeWindowWeeks = 0 | 10 | 20 | 30;

/**
 * Canonical ordered list of supported window sizes. Iterated by the Profile
 * segmented control and by tests that enumerate every valid value.
 */
export const MAX_VOLUME_WINDOW_OPTIONS: readonly MaxVolumeWindowWeeks[] = [
  0, 10, 20, 30,
] as const;

// Row types matching PostgREST output (snake_case).
// Drizzle's InferSelectModel returns camelCase, but the Supabase JS client
// returns columns as-is — so screens and hooks consume these.

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
  user_id: string;
  name: string;
  muscles: string[];
  equipment: string | null;
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
  target_sets: number | null;
  target_reps: number | null;
  target_weight: string | null;
  target_rest_seconds: number | null;
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
