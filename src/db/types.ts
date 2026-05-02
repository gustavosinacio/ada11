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
