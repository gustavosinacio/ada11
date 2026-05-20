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
  lengthUnit: text("length_unit").notNull().default("cm"),
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
    muscles: text("muscles").array().notNull().default(sql`'{}'::text[]`),
    equipment: text("equipment"),
    notes: text("notes"),
    source: text("source"),
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
    source: text("source"),
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

export const measurementEntries = pgTable(
  "measurement_entries",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    measuredAt: timestamp("measured_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    weightKg: numeric("weight_kg", { precision: 6, scale: 2 }),
    bodyFatPct: numeric("body_fat_pct", { precision: 4, scale: 1 }),
    neckCm: numeric("neck_cm", { precision: 6, scale: 2 }),
    chestCm: numeric("chest_cm", { precision: 6, scale: 2 }),
    bicepsCm: numeric("biceps_cm", { precision: 6, scale: 2 }),
    forearmCm: numeric("forearm_cm", { precision: 6, scale: 2 }),
    waistCm: numeric("waist_cm", { precision: 6, scale: 2 }),
    hipsCm: numeric("hips_cm", { precision: 6, scale: 2 }),
    thighCm: numeric("thigh_cm", { precision: 6, scale: 2 }),
    calfCm: numeric("calf_cm", { precision: 6, scale: 2 }),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => ({
    // Plain ASC composite. Postgres reads it backwards for
    // ORDER BY measured_at DESC (matches sessions_user_started_idx precedent).
    userMeasuredIdx: index("measurement_entries_user_measured_idx").on(
      t.userId,
      t.measuredAt,
    ),
    // The UNIQUE partial expression index
    //   (user_id, date(measured_at AT TIME ZONE 'UTC')) WHERE deleted_at IS NULL
    // cannot be expressed ergonomically in Drizzle's typed index builder
    // (no first-class support for `date(... AT TIME ZONE ...)` or partial
    // predicates). Source of truth is supabase/migrations/0005_measurements.sql.
  }),
);
