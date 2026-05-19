import type { InferInsertModel, InferSelectModel } from "drizzle-orm";

import {
  exercises,
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

export type SetType = "warmup" | "working" | "dropset";
export type WeightUnit = "kg" | "lbs";

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
  completed_at: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};
