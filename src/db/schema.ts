import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  numeric,
  pgSchema,
  pgTable,
  primaryKey,
  text,
  timestamp,
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
  // Encodes the user's "max-volume window" preference. `0` = lifetime
  // (default — preserves the pre-feature behaviour); `10/20/30` = trailing N
  // ISO weeks. CHECK constraint lives in supabase/migrations/0009_max_volume_window.sql.
  maxVolumeWindowWeeks: integer("max_volume_window_weeks").notNull().default(0),
  ...timestamps,
});

export const exercises = pgTable(
  "exercises",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    // Nullable: `null` = canonical (shared catalog, admin-managed via service
    // role); non-null = a user-owned exercise. See migration
    // 0011_canonical_exercises.sql. RLS SELECT widens to
    // `user_id IS NULL OR auth.uid() = user_id`; the mutating policies stay
    // scoped to `auth.uid() = user_id`, so canonical rows are app-immutable.
    userId: uuid("user_id").references(() => authUsers.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    muscles: text("muscles").array().notNull().default(sql`'{}'::text[]`),
    equipment: text("equipment"),
    // Per-exercise bodyweight leverage factor (push-up ≈ 0.64, pull-up/dip ≈
    // 1.0). Nullable, no default → existing/non-bodyweight rows stay NULL,
    // which the app coalesces to 1.0. Backfilled on canonical bodyweight rows
    // by supabase/migrations/0021_bodyweight_factor.sql.
    bodyweightFactor: numeric("bodyweight_factor"),
    notes: text("notes"),
    source: text("source"),
    ...timestamps,
  },
  // canonical-exercises: index `exercises_user_idx` dropped in 0011 — no client
  // query exercises it, the planner seq-scans 127 rows. Reintroduce as a
  // partial index `(user_id) WHERE user_id IS NOT NULL` if user-owned row
  // volume ever climbs (matches the SQL-source-of-truth precedent for partial
  // indexes — see measurement_entries_user_day_idx and
  // exercise_notes_user_exercise_active_uq comments below).
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
    targetRestSeconds: integer("target_rest_seconds"),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => ({
    routineIdx: index("routine_exercises_routine_idx").on(t.routineId),
    // Partial uniques live in SQL — drizzle-orm 0.38 has no .where() on
    // uniqueIndex:
    //   - `routine_exercises_routine_position_uq` on (routine_id, position)
    //     WHERE deleted_at IS NULL — `0012_routine_exercises_unique_partial.sql`.
    //   - `routine_exercises_routine_exercise_uq` on (routine_id, exercise_id)
    //     WHERE deleted_at IS NULL — `0013_routine_exercise_sets.sql` (step 6).
    //     Defense-in-depth on the bulk-seed natural-key in
    //     `seedSetsForSession`; the picker already filters via `excludeIds`.
    // Same convention as 0008/0010 partial uniques.
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
    // Ordered exercise_id[] capturing the per-session EXERCISE display order.
    // Nullable: snapshotted from the live screen at Finish and editable in
    // History edit mode; legacy/in-progress sessions stay NULL and the read
    // side falls back to a deterministic first-occurrence order. SQL source of
    // truth is supabase/migrations/0019_session_exercise_order.sql.
    sessionExerciseOrder: uuid("session_exercise_order").array(),
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
    // Nullable: null = unchecked draft (live session only),
    // non-null = checked / persisted. See migrations/0007_set_completed_at_nullable.sql.
    completedAt: timestamp("completed_at", { withTimezone: true }),
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

export const routineExerciseSets = pgTable(
  "routine_exercise_sets",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    routineExerciseId: uuid("routine_exercise_id")
      .notNull()
      .references(() => routineExercises.id, { onDelete: "cascade" }),
    setNumber: integer("set_number").notNull(),
    setType: text("set_type").notNull(), // 'warmup' | 'working' | 'dropset'
    targetReps: integer("target_reps"),
    targetWeight: numeric("target_weight", { precision: 6, scale: 2 }),
    parentSetId: uuid("parent_set_id"),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => ({
    routineExerciseIdx: index("routine_exercise_sets_routine_exercise_idx").on(
      t.routineExerciseId,
      t.setNumber,
    ),
    parentFk: foreignKey({
      columns: [t.parentSetId],
      foreignColumns: [t.id],
      name: "routine_exercise_sets_parent_set_id_fk",
    }).onDelete("set null"),
    setTypeCheck: check(
      "routine_exercise_sets_set_type_valid",
      sql`${t.setType} IN ('warmup','working','dropset')`,
    ),
    parentInvariant: check(
      "routine_exercise_sets_parent_matches_type",
      sql`(${t.setType} = 'dropset' AND ${t.parentSetId} IS NOT NULL)
          OR (${t.setType} IN ('warmup','working') AND ${t.parentSetId} IS NULL)`,
    ),
    // Partial UNIQUE (routine_exercise_id, set_number) WHERE deleted_at IS NULL
    // lives in supabase/migrations/0013_routine_exercise_sets.sql (Drizzle 0.38
    // does not support partial uniques directly). SQL is source of truth.
  }),
);

export const exerciseNotes = pgTable(
  "exercise_notes",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    exerciseId: uuid("exercise_id")
      .notNull()
      .references(() => exercises.id, { onDelete: "restrict" }),
    body: text("body").notNull(),
    ...timestamps,
  },
  (t) => ({
    // Composite read index — every read filters on (user_id, exercise_id).
    userExerciseIdx: index("exercise_notes_user_exercise_idx").on(
      t.userId,
      t.exerciseId,
    ),
    // The UNIQUE partial index
    //   (user_id, exercise_id) WHERE deleted_at IS NULL
    // and the CHECK (char_length(body) <= 2000) constraint live in
    // supabase/migrations/0010_exercise_notes.sql. Drizzle's typed builders
    // have no first-class support for partial predicates or column-level
    // CHECK — matches measurement_entries_user_day_idx precedent
    // (schema.ts:211-216).
  }),
);

export const userExerciseFavorites = pgTable(
  "user_exercise_favorites",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    exerciseId: uuid("exercise_id")
      .notNull()
      .references(() => exercises.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.exerciseId] }),
    // RLS (3 policies) lives in supabase/migrations/0020_user_exercise_favorites.sql.
    // SQL is source of truth. A favorite is presence/absence — no soft-delete,
    // no mutable column, hence no UPDATE policy and no partial-unique.
  }),
);
