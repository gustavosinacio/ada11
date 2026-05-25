# Data Model

## Schema (canonical)

Source of truth: `src/db/schema.ts`. Generated SQL: `supabase/migrations/0000_schema.sql`.

```
auth.users               (managed by Supabase; we only reference it via FK)

user_preferences         1:1 with auth.users
  user_id      uuid PK FK -> auth.users.id (cascade)
  weight_unit  text NOT NULL default 'kg'   -- 'kg' | 'lbs'
  created_at, updated_at, deleted_at

exercises                Per-user library
  id              uuid PK
  user_id         uuid FK -> auth.users.id (cascade)
  name            text NOT NULL
  primary_muscle  text?
  equipment       text?
  created_at, updated_at, deleted_at
  index: (user_id)

routines                 Training program templates
  id        uuid PK
  user_id   uuid FK -> auth.users.id (cascade)
  name      text NOT NULL
  notes     text?
  created_at, updated_at, deleted_at
  index: (user_id)

routine_exercises        Template entries (which exercises in which routine)
  id                    uuid PK
  user_id               uuid FK -> auth.users.id (cascade)        -- denormalized for RLS
  routine_id            uuid FK -> routines.id (cascade)
  exercise_id           uuid FK -> exercises.id (restrict)
  position              integer NOT NULL                          -- order within routine
  target_sets           integer?
  target_reps           integer?
  target_weight         numeric(6,2)?                              -- kg
  target_rest_seconds   integer?                                   -- for rest timer
  notes                 text?
  created_at, updated_at, deleted_at
  index: (routine_id), unique (routine_id, position)

sessions                 A workout instance
  id           uuid PK
  user_id      uuid FK -> auth.users.id (cascade)
  routine_id   uuid? FK -> routines.id (set null)                  -- nullable for ad-hoc
  started_at   timestamptz NOT NULL
  ended_at     timestamptz?                                         -- null while in progress
  notes        text?
  created_at, updated_at, deleted_at
  index: (user_id, started_at)

sets                     Every logged set
  id              uuid PK
  user_id         uuid FK -> auth.users.id (cascade)               -- denormalized for RLS
  session_id      uuid FK -> sessions.id (cascade)
  exercise_id     uuid FK -> exercises.id (restrict)
  set_number      integer NOT NULL                                  -- 1, 2, 3 within session/exercise
  reps            integer?
  weight          numeric(6,2)?                                     -- kg, internal
  rpe             numeric(3,1)?                                     -- 6.0..10.0
  set_type        text NOT NULL                                     -- 'warmup' | 'working' | 'dropset'
  parent_set_id   uuid? FK -> sets.id (set null)                    -- drop sets point to their working set
  completed_at    timestamptz NOT NULL
  created_at, updated_at, deleted_at
  index: (session_id), (exercise_id, completed_at)

  CHECK sets_set_type_valid:
    set_type IN ('warmup', 'working', 'dropset')

  CHECK sets_parent_matches_type:
    (set_type = 'dropset' AND parent_set_id IS NOT NULL)
    OR (set_type IN ('warmup', 'working') AND parent_set_id IS NULL)
```

## Why these specific shapes

### UUIDs everywhere
IDs are UUIDs (`gen_random_uuid()`), not auto-incrementing integers. Reason: clients can generate IDs locally without round-tripping the server, which is groundwork for future offline-first sync.

### `user_id` denormalized on every user-owned table
`routine_exercises` and `sets` could reach `user_id` through a join (via `routines` or `sessions`). We store `user_id` directly anyway. Why: RLS policies become uniformly `auth.uid() = user_id` on every table, with no joins. This is the pattern AI implements correctly first-time, every time. The redundancy cost is trivial; the security simplification is large.

### `set_type` + `parent_set_id` instead of `is_warmup` / `is_dropset` booleans
Three states (warmup, working, dropset) compress cleanly to one enum-shaped column. The CHECK constraint enforces "drop sets MUST have a parent, warmups/working sets MUST NOT" — the database itself rejects malformed inserts, no app-layer guard required. Drop chains are reconstructable: `WHERE parent_set_id = ?` returns all drops from a given working set.

### Weights in kg internally, unit per-user in `user_preferences`
Single source of truth; no per-row unit field. Conversion happens in `src/utils/units.ts` at the UI boundary.

### Soft delete (`deleted_at` on every table)
`UPDATE … SET deleted_at = now()` instead of `DELETE`. Reasons:
- History stays intact (you don't lose past sessions when you remove an exercise from your library).
- FKs use `ON DELETE RESTRICT` for `exercises` so the database refuses hard-delete if any history references the exercise — pushes you toward soft-delete.
- Future offline sync needs tombstones to propagate deletes; soft-delete provides them for free.

### `created_at`, `updated_at`, `deleted_at` on every table
`updated_at` is maintained by the `touch_updated_at()` trigger (defined in `0001_rls_and_seed.sql`) — no app-layer responsibility. Future offline sync uses `updated_at` for "pull rows newer than my last sync".

## Row-Level Security (RLS)

### The pattern

Every user-owned table has the same four policies:

```sql
CREATE POLICY t_select ON t FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY t_insert ON t FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY t_update ON t FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY t_delete ON t FOR DELETE USING (auth.uid() = user_id);
```

A loop in `0001_rls_and_seed.sql` applies this uniformly across `user_preferences`, `exercises`, `routines`, `routine_exercises`, `sessions`, `sets`.

### Verification

`tests/rls.test.ts` creates two users via Supabase's admin API, has user A insert a row, and asserts user B can't read, update, or delete it. **Run this before merging any change that touches RLS or schema.**

### Why this works

- **Authentication**: Supabase Auth issues a JWT containing `sub: <user_id>`. The Supabase JS client sends it on every request. Postgres (via PostgREST) runs queries as the matching role, with `auth.uid()` returning the user's ID.
- **Authorization**: RLS policies sit between the query and the rows. Even a buggy app-layer that "forgets to filter by user_id" cannot leak — the database itself filters.
- **Service role bypass**: the `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS. **Never expose it to the client.** It's used only by `drizzle-kit`, the supabase CLI, and the RLS test.

## TypeScript types

Defined in `src/db/types.ts`. Inferred from Drizzle's schema:

```ts
export type Exercise = InferSelectModel<typeof exercises>;
export type NewExercise = InferInsertModel<typeof exercises>;
// ... and so on for each table
export type SetType = "warmup" | "working" | "dropset";
export type WeightUnit = "kg" | "lbs";
```

Using `Exercise` for read shapes and `NewExercise` for write shapes keeps optional/auto fields straight. The `SetType` and `WeightUnit` literal types match the CHECK constraint and the `weight_unit` column.

## Sync model (current)

Online-first with TanStack Query cache persisted to AsyncStorage. There is no write queue or sync engine.

- **Reads**: TanStack Query fetches from Supabase, caches by query key, persists. Stale data served while refetching.
- **Writes**: Supabase JS client direct. Failure → error surfaced to UI.
- **Offline UX**: stale reads work; writes fail with a toast/banner.

The schema is **already shaped to support offline-first** (UUIDs, `updated_at`, `deleted_at`). Adding the sync engine later is a code change, not a migration.

## What it would take to go offline-first (future)

1. Add `expo-sqlite` + a Drizzle SQLite schema mirror of `src/db/schema.ts`.
2. Add a `_dirty: boolean` column to each *local* table (not pushed to Supabase).
3. Sync function:
   - **Pull**: `select() where updated_at > last_pull_at` per table.
   - **Push**: `select() where _dirty = true` locally, upsert to Supabase, clear flag.
   - **Conflict**: highest `updated_at` wins (single user → real conflicts ~never).
4. Triggers: app foreground, network reconnect, every 30s while open.

Estimated 300-500 lines of code plus error/retry handling. Don't do this preemptively; do it when the gym pain is real.

## Seed data

The trigger `seed_new_user()` runs on `auth.users` INSERT and:
1. Inserts a `user_preferences` row (`weight_unit = 'kg'`).
2. Inserts ~30 common lifts into `exercises` (squat, bench, deadlift, OHP, row, pull-up, dips, rows, curls, lateral raises, leg press, plank, etc.).

Edit the lift list in `0001_rls_and_seed.sql` if the owner wants different defaults. The trigger runs `SECURITY DEFINER` so it can write rows that RLS would block during the trigger context.

## Common queries (cheat sheet)

All against the Supabase JS client — RLS scopes everything to the current user automatically.

```ts
// All non-deleted exercises, alphabetized
supabase.from("exercises").select("*").is("deleted_at", null).order("name");

// Recent sessions
supabase.from("sessions").select("*").is("deleted_at", null)
  .order("started_at", { ascending: false }).limit(20);

// All sets for a session, in chronological order
supabase.from("sets").select("*").eq("session_id", sessionId)
  .is("deleted_at", null).order("completed_at");

// PRs for an exercise (max weight × reps among working sets)
supabase.from("sets").select("*")
  .eq("exercise_id", exerciseId).eq("set_type", "working")
  .is("deleted_at", null).order("weight", { ascending: false }).limit(10);

// Drops belonging to a working set
supabase.from("sets").select("*").eq("parent_set_id", workingSetId);
```

## Embedded-resource filters: `sets` joined to `sessions`

When a query reads `sets` via a PostgREST embed (`sessions!inner`), filters on the **embedded** table go through the same `.is(...)` / `.not(...)` shape with a dotted path:

```ts
// Reads sets from FINISHED, NON-DELETED sessions, excluding warmups and uncommitted sets.
// Note BOTH deleted_at filters: the parent `sets.deleted_at` AND the embedded `sessions.deleted_at`.
supabase
  .from("sets")
  .select("completed_at, weight, reps, set_type, sessions!inner(started_at, ended_at)")
  .is("deleted_at", null)                          // sets.deleted_at
  .is("sessions.deleted_at", null)                 // sessions.deleted_at (embedded — dotted path)
  .not("completed_at", "is", null)                 // sets.completed_at
  .not("sessions.ended_at", "is", null)            // sessions.ended_at (embedded)
  .neq("set_type", "warmup");
```

**Forgetting `.is("sessions.deleted_at", null)` is a leak vector**: `softDeleteSession` only stamps `sessions.deleted_at` — the child `sets` rows keep `deleted_at = null`, so the join surfaces them despite the session being "deleted" from the user's perspective. Three queries previously suffered this leak (`listWeeklyVolumeRows`, `listSetsForExercise`, `getLastWorkingSetForExercise`) — fixed in `docs/runs/2026-05-25_0933_soft-deleted-session-volume-leak/`.

The dotted-path filter compiles cleanly against `@supabase/supabase-js@^2.47.0` — no need for `.not("sessions.deleted_at", "is", null)` style. PostgREST flattens the embed to `?sessions.deleted_at=is.null` on the wire.

