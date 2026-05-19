import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  numeric,
  pgSchema,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Reference to Supabase's managed auth.users table — we don't define columns,
// just declare it for FK targets.
const authSchema = pgSchema("auth");
export const authUsers = authSchema.table("users", {
  id: uuid("id").primaryKey(),
});

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
};

export const userPreferences = pgTable("user_preferences", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => authUsers.id, { onDelete: "cascade" }),
  weightUnit: text("weight_unit").notNull().default("kg"),
  ...timestamps,
});

export const exercises = pgTable(
  "exercises",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    primaryMuscle: text("primary_muscle"),
    equipment: text("equipment"),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => ({
    userIdx: index("exercises_user_idx").on(t.userId),
  }),
);

export const routines = pgTable(
  "routines",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => ({
    userIdx: index("routines_user_idx").on(t.userId),
  }),
);

export const routineExercises = pgTable(
  "routine_exercises",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    routineId: uuid("routine_id")
      .notNull()
      .references(() => routines.id, { onDelete: "cascade" }),
    exerciseId: uuid("exercise_id")
      .notNull()
      .references(() => exercises.id, { onDelete: "restrict" }),
    position: integer("position").notNull(),
    targetSets: integer("target_sets"),
    targetReps: integer("target_reps"),
    targetWeight: numeric("target_weight", { precision: 6, scale: 2 }),
    targetRestSeconds: integer("target_rest_seconds"),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => ({
    routineIdx: index("routine_exercises_routine_idx").on(t.routineId),
    routinePosUnique: uniqueIndex("routine_exercises_routine_position_uq").on(
      t.routineId,
      t.position,
    ),
  }),
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    routineId: uuid("routine_id").references(() => routines.id, {
      onDelete: "set null",
    }),
    name: text("name"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => ({
    userStartedIdx: index("sessions_user_started_idx").on(t.userId, t.startedAt),
  }),
);

export const sets = pgTable(
  "sets",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    exerciseId: uuid("exercise_id")
      .notNull()
      .references(() => exercises.id, { onDelete: "restrict" }),
    setNumber: integer("set_number").notNull(),
    reps: integer("reps"),
    weight: numeric("weight", { precision: 6, scale: 2 }),
    rpe: numeric("rpe", { precision: 3, scale: 1 }),
    setType: text("set_type").notNull(), // 'warmup' | 'working' | 'dropset'
    parentSetId: uuid("parent_set_id"),
    notes: text("notes"),
    completedAt: timestamp("completed_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (t) => ({
    sessionIdx: index("sets_session_idx").on(t.sessionId),
    exerciseCompletedIdx: index("sets_exercise_completed_idx").on(
      t.exerciseId,
      t.completedAt,
    ),
    parentFk: foreignKey({
      columns: [t.parentSetId],
      foreignColumns: [t.id],
      name: "sets_parent_set_id_fk",
    }).onDelete("set null"),
    setTypeCheck: check(
      "sets_set_type_valid",
      sql`${t.setType} IN ('warmup','working','dropset')`,
    ),
    parentInvariant: check(
      "sets_parent_matches_type",
      sql`(${t.setType} = 'dropset' AND ${t.parentSetId} IS NOT NULL)
          OR (${t.setType} IN ('warmup','working') AND ${t.parentSetId} IS NULL)`,
    ),
  }),
);
