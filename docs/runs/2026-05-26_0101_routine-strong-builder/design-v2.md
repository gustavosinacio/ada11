# Design v2 — 2026-05-26_0101_routine-strong-builder

## Diff vs v1 (high-signal summary)

This v2 inherits v1 wholesale where Validator did not flag. Concrete changes:

- **MAJ-1 resolved**: Pre-seed pseudo-code rewritten as ONE canonical algorithm. Removed the "Refinement (cleaner)" sub-block and the vestigial post-pass-1 reconstruction loop. The `routineSetIdToNaturalKey` map is now populated inside the row-build pass (step 3); there is no `parentNaturalKeyByRoutineSetId` map at all.
- **MAJ-2 resolved**: Seed failure policy flipped from "log + proceed" to **hard fail (reject the mutation, surface the error toast, user stays on routine list)**. The `try/catch` around `seedSetsForSession` is removed. Risk #1 and the Risks/Confidence table updated accordingly.
- **MAJ-3 resolved**: New partial-unique `(routine_id, exercise_id) WHERE deleted_at IS NULL` added to `0013_routine_exercise_sets.sql` (option a). The natural key `(exercise_id, set_number)` is now provably unique by DB schema, not by hope. The "duplicate exercise in routine" path is foreclosed at insert time with `23505` — Implementer must handle the existing-row case in `addExerciseToRoutine` (see MIN-on-MIN clarification below).
- **MIN-1**: Decision pinned — no `RoutineExerciseSetEntry` type. Parallel fetch via `useRoutineExerciseSets(routineId)`; `<RoutineExerciseCard>` receives `entry: RoutineExerciseEntry` + `setsForExercise: RoutineExerciseSetRow[]`.
- **MIN-2**: New labeled "Drizzle schema" subsection with the two verbatim `check()` builder entries.
- **MIN-3**: `<RoutineExerciseCard>` props gains a typed `confirmRemoveSet` predicate prop owning the gesture.
- **MIN-4**: Backfill assertions re-anchored as a `tests/migration-backfill.ts` `main()`-style script invoked from the same npm-test runner as `tests/rls.test.ts` and `tests/seed-and-auth.test.ts`. No vitest/jest dependency added.
- **MIN-5**: `<RoutineListItem>` props pin: add `pending?: boolean` that maps to the existing `disabled` visual; explicit forward, no new style.
- **MIN-6**: `listRoutineExerciseSetsForRoutine` strips the embedded `routine_exercises` field before returning, mirroring `getLastWorkingSetForExercise`'s destructure pattern.
- **MIN-7**: Informational — design unchanged; added explanatory comment to the `seedSetsForSession` SQL block calling out the inner-join filter semantics.
- **MIN-8**: Dissolves with MAJ-2 resolution (no more `console.warn` line at the seed level — the mutation rejects, the existing `console.warn("Start failed", err)` at `workout/index.tsx:62-64` fires instead, which already includes the error context).

All sections below are full v2 content (no diff-only) so the Implementer can read this file standalone.

## Goal (1 sentence)

Replace `routine_exercises.target_sets / target_reps / target_weight` with a normalized `routine_exercise_sets` table so the routine builder stores per-set targets, and pre-seed those targets as unchecked draft `sets` rows whenever a session is started from a routine.

## Approach

Add a new user-owned table `routine_exercise_sets` shaped almost identically to the relevant subset of `sets` (no `rpe`, no `completed_at`), wired with the canonical 4-policy RLS block, a partial-unique on `(routine_exercise_id, set_number) WHERE deleted_at IS NULL`, and a `parent_set_id` self-FK plus dropset CHECK invariant. **Same migration also adds a partial-unique `(routine_id, exercise_id) WHERE deleted_at IS NULL` on `routine_exercises`** to enforce the one-exercise-per-routine assumption that the seed's natural-key relies on. Inside the same migration, backfill one row per existing target-set, then drop the three legacy columns on `routine_exercises`. `target_rest_seconds` and `notes` stay. The API layer mirrors `src/api/sets.ts` semantically (compute-next set_number, tri-state patches, two-step reorder swap). A single new TanStack hook keys per-set data at `["routine-exercise-sets", routineId]`. The builder UI swaps `<RoutineExerciseRow>` for a card listing per-set rows. The Start-from-routine flow gains a new `useStartSessionFromRoutine` hook that runs `startSession` then a JS two-pass bulk seed; **on seed failure the mutation rejects and the user stays on the routine list**. Migration in one transaction, query cache buster bumped.

## Decisões nos 7 Unknowns da Discovery

| # | Title | Discovery default | **Designer decision** | Confidence / Risk |
|---|---|---|---|---|
| U1 | Dropset `parent_set_id` mapping on bulk-seed | Two-pass JS insert with `routineExerciseSetId → setId` Map | **Adopt as-is.** Two-pass JS, no Postgres function. Algorithm spelled out in "Pre-seed at session-create" (single canonical version, no refinement variant). | HIGH / MEDIUM |
| U2 | `routine_exercise_sets.parent_set_id` ON DELETE behavior | Mirror `sets`: `ON DELETE set null` + dropset CHECK invariant | **Adopt as-is.** | HIGH / LOW |
| U3 | Backfill correctness (NULL target_sets, NULL reps/weight) | `generate_series(1, COALESCE(target_sets, 0))` rows | **Adopt as-is.** | HIGH / LOW |
| U4 | Schema-as-code drift (Drizzle) | Add `routineExerciseSets` to `src/db/schema.ts`, do NOT regen drizzle-kit | **Adopt as-is.** | HIGH / LOW |
| U5 | Seed step location: API vs hook vs DB trigger | Hook layer (`useStartSessionFromRoutine`) composing `startSession` + new `seedSetsForSession` | **Adopt as-is.** | HIGH / MEDIUM |
| U6 | Builder card: expansion state + Save semantics | Open-by-default, tap header to collapse, commit each set add/edit/remove immediately | **Adopt as-is.** | MEDIUM / LOW |
| U7 | Position semantics for warmup/dropset | `set_number` is single source of order; UI appends new rows; dropset `parent_set_id` = last working set | **Adopt as-is.** | HIGH / LOW |

## Mudanças por arquivo

| File | Type | Change |
|---|---|---|
| `supabase/migrations/0013_routine_exercise_sets.sql` | new | DDL + RLS + partial-unique on `routine_exercise_sets(routine_exercise_id, set_number)` + **new partial-unique on `routine_exercises(routine_id, exercise_id)`** + trigger + backfill + DROP COLUMN. Single transaction. Full SQL below. |
| `src/db/schema.ts` | edited | Drop `targetSets / targetReps / targetWeight` from `routineExercises` (lines 102-104). Add `routineExerciseSets` table mirroring SQL: UUID PK, FKs, `setNumber`, `setType` text + CHECK, `targetReps`, `targetWeight` numeric(6,2), `parentSetId` self-FK `set null`, `notes`, timestamps, dropset CHECK invariant. Both `check()` builder entries verbatim — see "Drizzle schema" subsection. Code comment at table footer pointing at 0013 for both partial-uniques. |
| `src/db/types.ts` | edited | Remove `target_sets/target_reps/target_weight` from `RoutineExerciseRow` (lines 121-123). Add `RoutineExerciseSet` / `NewRoutineExerciseSet` (Drizzle inferred) and `RoutineExerciseSetRow` (snake_case PostgREST). **No** `RoutineExerciseSetEntry` (decision pinned — parallel fetch only). |
| `src/api/routine-exercises.ts` | edited | Shrink `RoutineExerciseTargets` to `{ target_rest_seconds?, notes? }`. Drop the three columns from `addExerciseToRoutine` and `updateRoutineExercise` INSERT/UPDATE payloads. `listRoutineExercises` unchanged. **`addExerciseToRoutine`: handle 23505 from the new `(routine_id, exercise_id)` partial-unique** by surfacing a typed error the picker UI maps to "already in routine" (the picker `excludeIds` already filters; this is defense-in-depth — see MAJ-3 below). |
| `src/api/routine-exercise-sets.ts` | new | New API surface: `listForRoutine`, `listForRoutineExercise`, `addSet`, `updateSet`, `removeSet`, `reorderSets`, `seedSetsForSession`. Contracts below. |
| `src/hooks/use-routine-exercise-sets.ts` | new | TanStack hooks keyed at `["routine-exercise-sets", routineId]`. List + 4 mutations all invalidate `KEYS.list(routineId)`. Contract below. |
| `src/hooks/use-sessions.ts` | edited | Add `useStartSessionFromRoutine` composing `startSession` + `seedSetsForSession`. **No `try/catch` around the seed call** — failure rejects the mutation. `useStartSession` unchanged. |
| `src/components/routine-exercise-card.tsx` | new | Replaces `<RoutineExerciseRow>` semantically. Expandable card per exercise, per-set rows, footer with set-type add buttons + per-exercise Rest field. Props + layout below. |
| `src/components/routine-exercise-row.tsx` | deleted | Replaced by `routine-exercise-card.tsx`. |
| `src/components/routine-list-item.tsx` | edited | Add `pending?: boolean` prop. When `pending`, forward to the existing `disabled` visual (same opacity/dimming the `hasActive` branch already uses) — no new style. |
| `app/(app)/routines/[id]/index.tsx` | edited | Import + render `<RoutineExerciseCard>` instead of `<RoutineExerciseRow>`. Delete the `onChangeTargets` closure (lines 230-245). Wire the new per-set hooks for the card's callbacks. |
| `app/(app)/workout/index.tsx` | edited | `startFromRoutine` switches to `useStartSessionFromRoutine`. In-flight guard via per-routine `pendingRoutineId` ref. Pass `pending={pendingRoutineId === r.id}` to `<RoutineListItem>`. On mutation reject, the existing `console.warn("Start failed", err)` catch fires (already in place at lines 62-64); user stays on the routine list. |
| `app/(app)/workout/[sessionId].tsx` | unedited | **No change.** Live block consumes `sets` rows identically. |
| `src/lib/query-client.ts` | edited | Bump `queryCacheBuster` from `"schema-2026-05-25-canonical-exercises"` to `"schema-2026-05-26-routine-sets"`. |
| `docs/data-model.md` | edited | Remove `target_sets/target_reps/target_weight` from the `routine_exercises` block (lines 38-40). Add a `routine_exercise_sets` block mirroring the new table. Note the new `(routine_id, exercise_id)` partial-unique in the `routine_exercises` constraints box. |
| `docs/iphone-shakedown.md` | edited (optional, can defer) | Row 4 wording. Cosmetic. |
| `tests/rls.test.ts` | edited | Add a `routine_exercise_sets` arm following the existing `exercise_notes` arm pattern. |
| `tests/migration-backfill.ts` | new | `main()`-style script (mirrors `tests/rls.test.ts` and `tests/seed-and-auth.test.ts` shape) — seeds a fresh routine_exercises set pre-migration via admin client, applies migration via Supabase CLI helper, asserts row counts. Invoked via existing `npm test` runner. No vitest/jest dependency. |
| `tests/e2e/routine-strong-builder.spec.ts` | new | E2E golden + dropset + idempotency + backfill + edit-then-restart + soft-delete-readd + reorder. Detailed cases below. |
| `tests/unit/routine-exercise-sets.test.ts` | new | Unit coverage for `addSet`, `updateSet` tri-state, `reorderSets` two-step, idempotency guard, dropset two-pass remap. Detailed cases below. |

## Contratos de I/O

### SQL — `supabase/migrations/0013_routine_exercise_sets.sql`

```sql
-- =============================================================================
-- 0013_routine_exercise_sets.sql
-- Hand-written. Per-set normalization for routines.
--
-- Order of operations (single transaction):
--   1. Create routine_exercise_sets (UUID, FKs, set fields, soft-delete cols).
--   2. Composite read index (routine_exercise_id, set_number).
--   3. Partial UNIQUE (routine_exercise_id, set_number) WHERE deleted_at IS NULL.
--   4. Enable RLS + 4 inlined policies gated on auth.uid() = user_id.
--   5. touch_updated_at trigger.
--   6. NEW: Partial UNIQUE on routine_exercises(routine_id, exercise_id)
--      WHERE deleted_at IS NULL. Enforces one routine_exercise per (routine,
--      exercise) on the active plane, which the seed's natural-key relies on.
--   7. Backfill: one row per existing target_sets unit.
--   8. ALTER TABLE routine_exercises DROP COLUMN target_sets, target_reps,
--      target_weight. KEEP target_rest_seconds + notes.
-- =============================================================================

-- 1. Table.
create table public.routine_exercise_sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  routine_exercise_id uuid not null
    references public.routine_exercises(id) on delete cascade,
  set_number integer not null,
  set_type text not null,
  target_reps integer,
  target_weight numeric(6,2),
  parent_set_id uuid,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint routine_exercise_sets_set_type_valid
    check (set_type in ('warmup','working','dropset')),
  constraint routine_exercise_sets_parent_matches_type
    check (
      (set_type = 'dropset' and parent_set_id is not null)
      or (set_type in ('warmup','working') and parent_set_id is null)
    ),
  constraint routine_exercise_sets_parent_set_id_fk
    foreign key (parent_set_id)
    references public.routine_exercise_sets(id)
    on delete set null
);

-- 2. Composite read index.
create index routine_exercise_sets_routine_exercise_idx
  on public.routine_exercise_sets (routine_exercise_id, set_number);

-- 3. Partial UNIQUE on (routine_exercise_id, set_number) WHERE deleted_at IS NULL.
create unique index routine_exercise_sets_set_number_uq
  on public.routine_exercise_sets (routine_exercise_id, set_number)
  where deleted_at is null;

-- 4. RLS — enable + 4 explicit policies.
alter table public.routine_exercise_sets enable row level security;

drop policy if exists routine_exercise_sets_select on public.routine_exercise_sets;
create policy routine_exercise_sets_select on public.routine_exercise_sets
  for select using (auth.uid() = user_id);

drop policy if exists routine_exercise_sets_insert on public.routine_exercise_sets;
create policy routine_exercise_sets_insert on public.routine_exercise_sets
  for insert with check (auth.uid() = user_id);

drop policy if exists routine_exercise_sets_update on public.routine_exercise_sets;
create policy routine_exercise_sets_update on public.routine_exercise_sets
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists routine_exercise_sets_delete on public.routine_exercise_sets;
create policy routine_exercise_sets_delete on public.routine_exercise_sets
  for delete using (auth.uid() = user_id);

-- 5. touch_updated_at trigger.
drop trigger if exists routine_exercise_sets_touch_updated_at
  on public.routine_exercise_sets;
create trigger routine_exercise_sets_touch_updated_at
  before update on public.routine_exercise_sets
  for each row execute function public.touch_updated_at();

-- 6. NEW partial UNIQUE on routine_exercises(routine_id, exercise_id)
--    WHERE deleted_at IS NULL.
--    Rationale: the bulk seed's per-exercise natural-key (exercise_id,
--    set_number) requires that no two non-deleted routine_exercises rows
--    share an exercise_id within the same routine. The picker UI already
--    filters duplicates (routine-add picker `excludeIds`), so this is
--    primarily a schema guarantee + defense-in-depth against soft-delete-
--    then-readd races and admin-seed paths. Mirrors the (routine_id, position)
--    partial-unique from 0012; soft-deleted rows are excluded so re-adding
--    an exercise after removing it stays legal.
create unique index routine_exercises_routine_exercise_uq
  on public.routine_exercises (routine_id, exercise_id)
  where deleted_at is null;

-- 7. Forward-only data backfill.
--    For every non-deleted routine_exercise with target_sets > 0, emit N rows
--    set_number 1..N, set_type='working', copying target_reps / target_weight
--    (nullable carries forward). NULL or zero target_sets → zero rows.
--
--    Pre-flight assumption: no existing routine has two non-deleted
--    routine_exercises rows for the same exercise_id (or step 6 would have
--    failed). If that fires in CI/production, the migration aborts atomically
--    and Designer/Implementer must hand-soft-delete the duplicate first.
insert into public.routine_exercise_sets
  (user_id, routine_exercise_id, set_number, set_type, target_reps, target_weight)
select
  re.user_id,
  re.id,
  gs.set_number,
  'working',
  re.target_reps,
  re.target_weight
from public.routine_exercises re
cross join lateral generate_series(1, coalesce(re.target_sets, 0)) as gs(set_number)
where re.deleted_at is null
  and coalesce(re.target_sets, 0) > 0;

-- 8. Drop the legacy columns. target_rest_seconds + notes survive.
alter table public.routine_exercises
  drop column target_sets,
  drop column target_reps,
  drop column target_weight;
```

### Drizzle schema — `src/db/schema.ts`

(Promoted from a bullet — explicit code per MIN-2.)

```ts
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
    setType: text("set_type").notNull(),
    targetReps: integer("target_reps"),
    targetWeight: numeric("target_weight", { precision: 6, scale: 2 }),
    parentSetId: uuid("parent_set_id"),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => ({
    parentFk: foreignKey({
      columns: [t.parentSetId],
      foreignColumns: [t.id],
      name: "routine_exercise_sets_parent_set_id_fk",
    }).onDelete("set null"),
    setTypeCheck: check(
      "routine_exercise_sets_set_type_valid",
      sql`${t.setType} in ('warmup','working','dropset')`,
    ),
    parentInvariant: check(
      "routine_exercise_sets_parent_matches_type",
      sql`(${t.setType} = 'dropset' and ${t.parentSetId} is not null)
          or (${t.setType} in ('warmup','working') and ${t.parentSetId} is null)`,
    ),
    // Partial UNIQUE (routine_exercise_id, set_number) WHERE deleted_at IS NULL
    // is in supabase/migrations/0013_routine_exercise_sets.sql (Drizzle 0.38
    // does not support partial uniques directly). SQL is source of truth.
  }),
);
```

The two `check()` blocks are verbatim from the `sets` table precedent at `src/db/schema.ts:175-183`. The Implementer copies this block as-is.

Also in `src/db/schema.ts`: append a footer comment under the `routineExercises` block pointing at 0013 for BOTH partial-uniques (existing `(routine_id, position)` from 0012, new `(routine_id, exercise_id)` from 0013).

### TypeScript types — `src/db/types.ts`

```ts
// REMOVED from RoutineExerciseRow:
//   target_sets: number | null;
//   target_reps: number | null;
//   target_weight: string | null;
// KEPT:
//   target_rest_seconds: number | null;
//   notes: string | null;

export type RoutineExerciseSetRow = {
  id: string;
  user_id: string;
  routine_exercise_id: string;
  set_number: number;
  set_type: SetType; // 'warmup' | 'working' | 'dropset'
  target_reps: number | null;
  target_weight: string | null;       // numeric(6,2) — kg, internal
  parent_set_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};
```

**Decision pinned (MIN-1)**: no `RoutineExerciseSetEntry` joined type. Parallel fetch is the chosen path. `<RoutineExerciseCard>` receives `entry: RoutineExerciseEntry` (existing) and `setsForExercise: RoutineExerciseSetRow[]` (new from the parallel hook).

### `src/api/routine-exercises.ts` — shrunk type + duplicate handling

```ts
export type RoutineExerciseTargets = {
  target_rest_seconds?: number | null;
  notes?: string | null;
};
```

`addExerciseToRoutine` and `updateRoutineExercise` drop the three columns from their INSERT/UPDATE payloads. `listRoutineExercises` unchanged.

**New: 23505 handling on the new partial-unique.** When `addExerciseToRoutine` inserts and the new `routine_exercises_routine_exercise_uq` partial-unique rejects (existing non-deleted row for the same `(routine_id, exercise_id)`), the API surfaces a typed error so the picker UI maps it to a "already in this routine" toast. The picker already prevents this via `excludeIds` in `app/(app)/routines/[id]/index.tsx:265`, so the typed error is defense-in-depth (matches the existing `addExerciseToRoutine` 23505 handler pattern from the `(routine_id, position)` race fix). Specific implementation:

```ts
// inside addExerciseToRoutine, after .insert(...).select().single()
if (error?.code === "23505") {
  if (error.message?.includes("routine_exercises_routine_exercise_uq")) {
    throw Object.assign(
      new Error("Exercise already in routine"),
      { code: "ROUTINE_EXERCISE_DUPLICATE" as const },
    );
  }
  // existing position-conflict path stays
}
```

### New API — `src/api/routine-exercise-sets.ts`

```ts
import { supabase } from "~/lib/supabase";
import type { RoutineExerciseSetRow, SetType } from "~/db/types";

export type AddRoutineExerciseSetInput = {
  routine_exercise_id: string;
  set_type: SetType;
  target_reps?: number | null;
  target_weight?: string | null;
  parent_set_id?: string | null;
  notes?: string | null;
};

/**
 * Tri-state patch — mirrors src/api/sets.ts updateSet contract verbatim.
 *   key omitted    → column NOT touched.
 *   key === null   → column EXPLICITLY cleared.
 *   key === value  → column written.
 * Empty patch short-circuits to `null`; hook must skip cache invalidation.
 */
export type UpdateRoutineExerciseSetInput = {
  set_type?: SetType;
  target_reps?: number | null;
  target_weight?: string | null;
  notes?: string | null;
};

export async function listRoutineExerciseSetsForRoutine(
  routineId: string,
): Promise<RoutineExerciseSetRow[]>;

export async function listRoutineExerciseSetsForRoutineExercise(
  routineExerciseId: string,
): Promise<RoutineExerciseSetRow[]>;

export async function addRoutineExerciseSet(
  input: AddRoutineExerciseSetInput,
): Promise<RoutineExerciseSetRow>;

export async function updateRoutineExerciseSet(
  id: string,
  patch: UpdateRoutineExerciseSetInput,
): Promise<RoutineExerciseSetRow | null>;

export async function removeRoutineExerciseSet(id: string): Promise<void>;

export async function reorderRoutineExerciseSets(
  routineExerciseId: string,
  orderedIds: string[],
): Promise<void>;

/** Seed-on-Start: bulk-INSERT `sets` rows from a routine's per-set config. */
export type SeedSetsForSessionInput = {
  session_id: string;
  routine_id: string;
  user_id: string;
};
export type SeedSetsForSessionResult = {
  inserted: number;
  skipped_routine_exercise_ids: string[];   // tracked at routine_exercise_id granularity per MAJ-3 fix
};
export async function seedSetsForSession(
  input: SeedSetsForSessionInput,
): Promise<SeedSetsForSessionResult>;
```

**`listRoutineExerciseSetsForRoutine`** — single PostgREST call with embed:

```ts
const { data, error } = await supabase
  .from("routine_exercise_sets")
  .select("*, routine_exercises!inner(routine_id)")
  .eq("routine_exercises.routine_id", routineId)
  .is("deleted_at", null)
  .order("set_number", { ascending: true });
if (error) throw error;
// MIN-6: strip the embedded `routine_exercises` field so the returned shape
// is exactly RoutineExerciseSetRow[] (no leaked join column).
return (data ?? []).map(({ routine_exercises: _re, ...row }) => row as RoutineExerciseSetRow);
```

The strip pattern mirrors `getLastWorkingSetForExercise` at `src/api/sets.ts:200-203` (`const { sessions: _sessions, ...row } = data`).

**`addRoutineExerciseSet`** — compute next set_number from `MAX(set_number) WHERE deleted_at IS NULL + 1`, identical pattern to `src/api/sets.ts:63-73`. Reads `auth.uid()` for `user_id`. Inserts row.

**`updateRoutineExerciseSet`** — tri-state patch matching `src/api/sets.ts:113-138` verbatim, including the empty-payload short-circuit returning `null`.

**`removeRoutineExerciseSet`** — `update({ deleted_at: now().toISOString() }).eq("id", id)`.

**`reorderRoutineExerciseSets`** — verbatim two-step swap. `set_number` is 1-indexed. Negative-park step uses `-(i+1)`.

**`seedSetsForSession`** — see "Pre-seed at session-create" below for the full canonical algorithm.

### Hook — `src/hooks/use-routine-exercise-sets.ts`

```ts
const KEYS = {
  list: (routineId: string) => ["routine-exercise-sets", routineId] as const,
};

export function useRoutineExerciseSets(routineId: string | undefined);
export function useAddRoutineExerciseSet(routineId: string);
export function useUpdateRoutineExerciseSet(routineId: string);
export function useRemoveRoutineExerciseSet(routineId: string);
export function useReorderRoutineExerciseSets(routineId: string);
```

`useUpdateRoutineExerciseSet.onSuccess` MUST guard `if (result === null) return;` before invalidating (matches `useUpdateSet:71-73`).

### `useStartSessionFromRoutine` — `src/hooks/use-sessions.ts`

```ts
export function useStartSessionFromRoutine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { routine_id: string; name?: string | null }) => {
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth.user?.id;
      if (!userId) throw new Error("Not authenticated");

      const session = await startSession({
        routine_id: input.routine_id,
        name: input.name ?? null,
      });
      // MAJ-2 RESOLUTION: hard fail on seed failure. No try/catch — the error
      // propagates out of mutateAsync. The caller's catch (workout/index.tsx
      // :62-64 `console.warn("Start failed", err)`) keeps the user on the
      // routine list. The orphan session row remains in the DB; it shows up
      // in History as in-progress. The user can delete it from History or
      // resume it manually (it is salvageable). This is intentionally simpler
      // than a rollback-the-session policy, which would add a write-after-
      // failure path that can itself fail.
      await seedSetsForSession({
        session_id: session.id,
        routine_id: input.routine_id,
        user_id: userId,
      });
      return session;
    },
    onSuccess: (row) => {
      qc.setQueryData(KEYS.active, row);
      qc.invalidateQueries({ queryKey: KEYS.all });
      qc.invalidateQueries({ queryKey: ["sets", row.id] });
    },
  });
}
```

### `<RoutineExerciseCard>` props (MIN-3 resolved)

```ts
type Props = {
  entry: RoutineExerciseEntry;
  setsForExercise: RoutineExerciseSetRow[];   // pre-filtered + sorted by set_number ASC
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemoveExercise: () => void;
  onChangeRest: (seconds: number | null) => void;
  onAddSet: (input: { set_type: SetType; parent_set_id?: string | null }) => Promise<void>;
  onUpdateSet: (id: string, patch: { target_reps?: number | null; target_weight?: string | null }) => Promise<void>;
  onRemoveSet: (id: string) => Promise<void>;
  onReorderSets: (orderedIds: string[]) => Promise<void>;

  // MIN-3 — the card owns the confirm-before-delete gesture. The predicate is
  // applied to each set row: if it returns true, the trash icon shows
  // confirmDelete first; otherwise it soft-deletes directly. Default at the
  // parent screen: (set) => set.target_reps != null && set.target_weight != null.
  confirmRemoveSet: (set: RoutineExerciseSetRow) => boolean;
};
```

### `<RoutineListItem>` props (MIN-5 resolved)

```ts
type Props = {
  // ...existing...
  disabled?: boolean;     // existing — fired when hasActive
  pending?: boolean;      // NEW — fired when this routine's Start is in flight
};
```

`pending` maps to the existing `disabled` visual (same opacity/style), no new design tokens. The two are OR'd at render time: `effectivelyDisabled = disabled || pending`. The component contract becomes: "the parent says whether the row is interactive; the visual treatment is identical regardless of which signal disabled it." If the parent later wants a spinner specifically for `pending`, that's a follow-up.

### Layout — ASCII sketch

(Unchanged from v1 — Validator did not flag.)

```
+----------------------------------------------------------------+
|  ▼  Bench Press                          [⇡] [⇣] [🗑]          |
|     Chest · Triceps · Barbell                                  |
+----------------------------------------------------------------+
|  Set #   Weight (kg)   Reps              [type]                |
+----------------------------------------------------------------+
|  1       [  60.0  ]    [  8  ]   working    [⇡][⇣][🗑]         |
|  2       [  70.0  ]    [  8  ]   working    [⇡][⇣][🗑]         |
|  3       [  60.0  ]    [  8  ]   dropset    [⇡][⇣][🗑]         |
+----------------------------------------------------------------+
|  [+ Working set]       [⌄ more types]                          |
|     ↳ when ⌄ open:                                             |
|        [+ Warm-up]                                             |
|        [+ Drop set (chains onto set N)]                        |
+----------------------------------------------------------------+
|  Rest between sets: [  90  ] s                                 |
+----------------------------------------------------------------+
```

### Start-from-routine wiring at `app/(app)/workout/index.tsx`

```ts
const [pendingRoutineId, setPendingRoutineId] = useState<string | null>(null);
const startFromRoutineMut = useStartSessionFromRoutine();

const startFromRoutine = async (r: RoutineRow) => {
  if (active.data) { router.push(`/(app)/workout/${active.data.id}`); return; }
  if (pendingRoutineId) return;
  setPendingRoutineId(r.id);
  try {
    const row = await startFromRoutineMut.mutateAsync({ routine_id: r.id, name: r.name });
    router.replace(`/(app)/workout/${row.id}`);
  } catch (err) {
    // MAJ-2: seed failure rejects the mutation; we land here.
    // The user stays on the routines list. The orphan session row exists in
    // the DB but the user is not navigated to it.
    console.warn("Start failed", err);
  } finally {
    setPendingRoutineId(null);
  }
};

// in render:
<RoutineListItem
  key={r.id}
  routine={r}
  onPress={() => startFromRoutine(r)}
  disabled={Boolean(active.data)}
  pending={pendingRoutineId === r.id}
/>
```

## Pre-seed at session-create — full spec (CANONICAL ALGORITHM, MAJ-1 resolved)

### Call path

```
RoutineListItem → onPress
  → startFromRoutine(r)
    → useStartSessionFromRoutine.mutateAsync({ routine_id, name })
      → startSession({ routine_id, name })           ← INSERT into sessions
      → seedSetsForSession({ session_id, routine_id, user_id })
        ↓
```

### `seedSetsForSession` — single canonical algorithm

There is one algorithm. There are no "refinement" variants. The Implementer copies this verbatim.

```ts
export async function seedSetsForSession(
  input: SeedSetsForSessionInput,
): Promise<SeedSetsForSessionResult> {
  // Step 1. Read routine config (one PostgREST call, inner-join filter on
  // active routine_exercises). The inner join on routine_exercises with the
  // dotted-path filter excludes soft-deleted parents AND, by JOIN semantics,
  // their child rows even if children are not themselves soft-deleted (which
  // would be an orphan state — see MIN-7 informational note).
  const { data: routineSets, error: readErr } = await supabase
    .from("routine_exercise_sets")
    .select(`
      id, set_number, set_type, target_reps, target_weight, parent_set_id,
      routine_exercises!inner ( id, exercise_id, routine_id, deleted_at )
    `)
    .eq("routine_exercises.routine_id", input.routine_id)
    .is("deleted_at", null)
    .is("routine_exercises.deleted_at", null)
    .order("set_number", { ascending: true });
  if (readErr) throw readErr;

  // Step 2. Idempotency guard at routine_exercise_id granularity.
  // For any routine_exercise whose sets already exist (non-deleted) in this
  // session, skip ALL its routine sets. Tracking at routine_exercise_id is
  // safe even without the new 0013 partial-unique because we look up the
  // routine_exercise of each routineSet directly (no exercise_id collision
  // possible — the new (routine_id, exercise_id) partial-unique guarantees
  // at most one non-deleted routine_exercise per exercise anyway).
  const { data: existingSessionSets, error: existErr } = await supabase
    .from("sets")
    .select("exercise_id, set_number")
    .eq("session_id", input.session_id)
    .is("deleted_at", null);
  if (existErr) throw existErr;
  const seenExerciseIds = new Set(
    (existingSessionSets ?? []).map((r) => r.exercise_id),
  );
  const skippedRoutineExerciseIds = new Set<string>();

  // Step 3. ONE pass over routineSets. Build the row arrays AND the natural-
  // key map simultaneously. The natural key is (exercise_id, set_number) AND
  // is guaranteed unique by the new 0013 partial-unique on
  // routine_exercises(routine_id, exercise_id) WHERE deleted_at IS NULL —
  // because per-exercise set_numbers are emitted monotonically below,
  // and no two non-deleted routine_exercises can share an exercise_id.
  type DropsetWork = NewSet & {
    __sourceRoutineSetId: string;
    __parentRoutineSetId: string;
  };
  const nonDropsetRows: NewSet[] = [];
  const dropsetRows: DropsetWork[] = [];
  const setNumberByExercise = new Map<string, number>();
  const routineSetIdToNaturalKey = new Map<string, string>();   // ← the ONE map

  for (const rs of routineSets ?? []) {
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

    const base: NewSet = {
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
      parent_set_id: null,    // patched for dropsets in pass 2
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

  // Step 4. Pass 1: bulk-insert non-dropsets, RETURNING *.
  // Re-key the inserted sets by natural key (exercise_id, set_number) since
  // PostgREST .insert(rows).select() does NOT guarantee return order matches
  // input order. The natural key is unique by the new (session_id,
  // exercise_id, set_number) partial-unique (0008) — keyed insertions are
  // deterministic.
  const setsIdByNaturalKey = new Map<string, string>();
  let insertedNonDropsetCount = 0;
  if (nonDropsetRows.length > 0) {
    const { data: insertedNonDropsets, error: insErr1 } = await supabase
      .from("sets")
      .insert(nonDropsetRows)
      .select();
    if (insErr1) throw insErr1;
    for (const s of insertedNonDropsets ?? []) {
      setsIdByNaturalKey.set(`${s.exercise_id}:${s.set_number}`, s.id);
    }
    insertedNonDropsetCount = insertedNonDropsets?.length ?? 0;
  }

  // Step 5. Pass 2: resolve dropset parent_set_id via the SAME map built in
  // step 3 (routineSetIdToNaturalKey), then look up the freshly inserted
  // sets.id via setsIdByNaturalKey. Unresolvable dropsets (parent's routine
  // row was soft-deleted between the read and this point — rare) are dropped
  // silently — better than failing the whole seed.
  let insertedDropsetCount = 0;
  if (dropsetRows.length > 0) {
    const resolved: NewSet[] = [];
    for (const dr of dropsetRows) {
      const parentNatural = routineSetIdToNaturalKey.get(dr.__parentRoutineSetId);
      const parentSetId = parentNatural
        ? setsIdByNaturalKey.get(parentNatural) ?? null
        : null;
      if (!parentSetId) continue;
      const { __sourceRoutineSetId, __parentRoutineSetId, ...row } = dr;
      resolved.push({ ...row, parent_set_id: parentSetId });
    }
    if (resolved.length > 0) {
      const { error: insErr2 } = await supabase.from("sets").insert(resolved);
      if (insErr2) throw insErr2;
      insertedDropsetCount = resolved.length;
    }
  }

  // Step 6. Return totals.
  return {
    inserted: insertedNonDropsetCount + insertedDropsetCount,
    skipped_routine_exercise_ids: Array.from(skippedRoutineExerciseIds),
  };
}
```

**What is NOT in this algorithm** (explicitly, to prevent Implementer drift): no `parentNaturalKeyByRoutineSetId` map; no post-pass-1 reconstruction loop; no rebuild-from-built-rows logic; no "refinement" variant. The single map is `routineSetIdToNaturalKey`, populated inside step 3 alongside the row builders.

**Why JS two-pass, not a SQL function**: U5 default. No new Postgres function.

**Why natural-key (exercise_id, set_number) is safe post-MAJ-3**: the new partial-unique on `routine_exercises(routine_id, exercise_id) WHERE deleted_at IS NULL` (step 6 of the migration) guarantees at most ONE non-deleted routine_exercise per (routine, exercise). Combined with monotonic per-exercise set_number assignment in step 3 above, every `(exercise_id, set_number)` produced is unique across the entire routineSets pass. The natural key into `sets` is then unique by the existing partial-unique at `0008_sets_unique_set_number.sql:15-17` (session_id + exercise_id + set_number).

### In-flight guard at Start

Per-routine `pendingRoutineId` state in `workout/index.tsx`. Second tap on the same routine while pending is a no-op. Tap on a different routine while one is pending is also a no-op (single-route at a time).

### Seed failure policy — final (MAJ-2 resolved)

**Decision: hard fail. The mutation rejects. The user stays on the routines list.**

- The `try/catch` around `seedSetsForSession` is **removed** from `useStartSessionFromRoutine`. The error propagates to `mutateAsync`'s caller (`startFromRoutine` in `workout/index.tsx`), where the existing `catch (err) { console.warn("Start failed", err); }` at lines 62-64 logs the error. The `router.replace(...)` in the success branch never fires.
- The session row created by `startSession` becomes an orphan empty session. It appears in History as in-progress. The user can manually resume or delete it. This is acceptable degraded state — no data is lost, and the user is on the routine list with a console error (and on web, dev tools open will show the seed failure cause).
- We do NOT roll back the session for three reasons: (i) the rollback is itself a write that can fail (compounding the error surface); (ii) the orphan session is salvageable, not destructive; (iii) consistency with the existing `useStartSession` ad-hoc path, which also doesn't roll back if the post-INSERT cache write throws.
- **What we do NOT do**: silent `console.warn("Seed failed", ...)` followed by navigating to an empty live screen. That was the v1 path; it's the silent-failure UX Validator flagged.
- **Counterpoint (acknowledged)**: a user might want a more affirmative error surface (toast on the routines screen). That's a follow-up; the v1 minimum is "do not navigate the user into a broken state silently." The `console.warn` + non-navigation does that.

**Updated Confidence/Risk on this decision**: HIGH / LOW. The previous v1 calibration was MEDIUM / MEDIUM (silent-failure ambiguity); v2 is concrete and consistent with existing patterns.

## Riscos

### 1. Data integrity — dropset parent FK invariant on bulk seed
LOAD-BEARING. If pass-2 mis-maps a parent (parent's source row soft-deleted between routineSet load and sets insert, or stale UUID), pass 2 either drops the dropset silently (the chosen path: filter out unresolvable rows) or trips a CHECK/FK. The algorithm above explicitly filters unresolvable dropsets. Worst case: one dropset missing, working set parent succeeds — no FK violation, no batch abort. Unit test path. **Confidence MEDIUM, Risk MEDIUM.**

### 2. Data integrity — RLS on bulk insert
Seed inserts `sets` as the signed-in user. Every row carries `user_id = input.user_id` (= `auth.user.id` from the hook), so `sets_insert` policy `with check (auth.uid() = user_id)` accepts. **Confidence HIGH, Risk LOW.**

### 3. Data integrity — migration atomicity
Supabase migrations are single-file transactions. Backfill + DROP COLUMN + new partial-uniques happen atomically per file. The new `routine_exercises_routine_exercise_uq` partial-unique (step 6) runs BEFORE the backfill (step 7) — if the production DB has an existing duplicate `(routine_id, exercise_id)` non-deleted pair, the migration aborts atomically and no destructive change ships. The Implementer's pre-flight check (see Tests / Backfill correctness) catches this in CI before the production push. **Confidence HIGH, Risk LOW.**

### 4. Data integrity — persisted-cache mismatch on rehydrate
Without bumping `queryCacheBuster`, persisted `["routine-exercises", routineId]` blobs would carry the dropped columns. PATCH attempts on the dropped columns would 400. Mitigation: bump to `"schema-2026-05-26-routine-sets"`. **Confidence HIGH, Risk LOW with the bump.**

### 5. UX regression — live screen rest-timer + auto-fill placeholders
`target_rest_seconds` column survives. The seeded rows have `reps + weight` populated; the first seeded set has no in-session prior, placeholder falls back to `lastFromHistory` (cross-session). Identical to the user starting empty + manually filling. **Confidence HIGH, Risk LOW.**

### 6. UX regression — rest-timer auto-start on bulk seed
Auto-start watches for ONE working-set transition from unchecked to checked. Seed inserts with `completed_at = null` — no transition fires. **Confidence HIGH, Risk LOW.**

### 7. UX regression — checked-set bubble (commit 5190a58)
Sets ordered by `set_number` ASC. Seed assigns 1..N per (session, exercise). Listed in order; no bubble. **Confidence HIGH, Risk LOW.**

### 8. UX regression (NEW) — seed-failure orphan session in History
The hard-fail policy leaves an empty session in `sessions` with `started_at` set but no `sets`. History screen shows it as in-progress. The user can resume or delete it manually. **No data loss, no destructive state.** A future cleanup (auto-prune empty sessions older than X hours) is out of scope. **Confidence HIGH, Risk LOW.**

### 9. Platform divergence — none
RN + RN-Web compatible. **Confidence HIGH, Risk LOW.**

### 10. Performance — builder fetch fan-out
`useRoutineExerciseSets(routineId)` is a single PostgREST call per routine, N rows (typical 5-30). +1 query on top of `useRoutineExercises`. Acceptable. **Confidence HIGH, Risk LOW.**

### 11. Performance — seed fetch cost
`seedSetsForSession` makes ≤4 PostgREST calls per Start (read routineSets, read existingSessionSets, insert non-dropsets, optional insert dropsets). Acceptable Start latency (~200-400ms on slow networks). **Confidence HIGH, Risk LOW.**

### 12. RLS test regression
`tests/rls.test.ts` gains a `routine_exercise_sets` arm. Without it, silent RLS misconfiguration risk. **Confidence HIGH, Risk LOW with the arm.**

### 13. Test-fixture migration
Existing e2e fixtures (`rest-timer-auto-start.spec.ts`, `auto-fill-placeholder-on-check.spec.ts`, `routines-add-exercise-race.spec.ts`) admin-insert `target_rest_seconds` only — verified clean by Discovery. **No spec change required for the dropped columns.** The race spec depends on the existing `(routine_id, position)` partial-unique; the new `(routine_id, exercise_id)` partial-unique does not affect that spec's path (the spec adds the same exercise twice and asserts the in-flight guard wins — but with the new partial-unique, the second insert would ALSO 23505 if the guard somehow failed; the spec still passes either way because the assertion is "exactly +1 row in routine_exercises", which holds). **Confidence HIGH, Risk LOW.**

### 14. Mid-session routine edit
Routine edits after session start do NOT propagate to active sessions. Documented behavior. **Confidence HIGH, Risk LOW.**

### 15. New risk (NEW) — backfill aborts on existing duplicate exercise
The new partial-unique runs before the backfill. If production has any non-deleted duplicate `(routine_id, exercise_id)` pair, the migration's step 6 `create unique index` aborts the whole file. Mitigation: a CI pre-flight that queries for duplicates and reports them; Implementer manually soft-deletes the offenders before pushing. This is the cost of MAJ-3 option (a) — paid once. **Confidence HIGH (the duplicate query is trivial), Risk LOW.**

## Alternativas descartadas

1. **Single-column JSON `routine_exercises.sets_json`** — violates the repo's zero-JSON-column convention. User decision state.md:11.
2. **Defer seed to live-screen mount** — violates state.md:13 (pre-seed required) + races visibility.
3. **Postgres trigger `AFTER INSERT ON sessions` to seed** — atomic but adds a new Postgres function and SQL dropset two-pass is awkward.
4. **Single-pass dropset insert via UUID v5 derivation** — fragile, not how the codebase generates IDs.
5. **Per-routine_exercise list query (key = routineExerciseId)** — violates single-fetch hint, cache fragmentation.
6. **Keep `<RoutineExerciseRow>` filename, rewrite body in place** — the rename communicates responsibility shift.
7. **Save-button at card level** — breaks blur-commit consistency.
8. **Drag-handle reorder for sets** — state.md:56 explicitly out of scope.
9. **Per-set RPE in v1** — state.md:53.
10. **Cascade seed into the CURRENT active session** — scope creep.
11. **Hard-drop dropset rows during backfill** — no existing routine has dropsets (old shape didn't support); simplification is a no-op.
12. **MAJ-2 alternative: roll back session on seed failure** — REJECTED. Adds a write-after-failure path that can itself fail. Orphan session in History is salvageable, not destructive. Hard-fail keeps the error path identical to the existing `useStartSession` ad-hoc failure flow.
13. **MAJ-2 alternative: show banner on live screen ("seed failed, add sets manually")** — REJECTED. Requires new UI surface + i18n on a screen we explicitly said NOT to change (`workout/[sessionId].tsx` is "unedited" in the file changes). The hard-fail policy with the user staying on the routine list achieves the same "user is informed" property without that surface.
14. **MAJ-3 alternative (b): document the assumption + runtime check** — REJECTED. Runtime checks are reactive and leave a race window (between read and insert). A DB constraint is proactive and constant-time. Cost is one extra index.
15. **MAJ-3 alternative (c): natural key = `(routine_exercise_id, set_number)`** — REJECTED. The map keying would change but the seed algorithm would still need the per-exercise set_number assignment for the `sets` table (where `(session_id, exercise_id, set_number)` is the partial-unique). Two keying schemes — fragmented. Option (a) is one schema fact, simpler.
16. **Read seeding parameters via embed on `listRoutineExercises`** — bloats payload + complicates live-screen consumer that only reads `target_rest_seconds`.

## Tests

### Unit — `tests/unit/routine-exercise-sets.test.ts` (new)

Run via existing `npm test` runner. Cases:

1. **`addRoutineExerciseSet` next-set_number from MAX+1.** Soft-delete the only row; next insert gets `set_number = max(non-deleted) + 1`.
2. **`updateRoutineExerciseSet` tri-state.**
   - `{ target_reps: 8 }` writes only target_reps.
   - `{ target_weight: null }` writes target_weight=null explicitly.
   - `{}` returns `null`, no PostgREST call (mock assertion).
3. **`reorderRoutineExerciseSets` two-step swap.** Reorder [A,B,C] → [C,A,B]; all 3 rows end with set_number 1..3; no partial-unique trip.
4. **Idempotency guard at routine_exercise_id granularity.** Pre-insert one set for exercise E in session S; seed; no insert fires for E; `skipped_routine_exercise_ids` includes E's routine_exercise.id.
5. **Dropset two-pass remap (golden).** Routine with [working, dropset]; inserted dropset's `parent_set_id` = inserted working's `sets.id`.
6. **Orphan-dropset graceful fallback.** Dropset's `parent_set_id` points to a soft-deleted routine_exercise_set; seed drops that dropset; no CHECK violation; `inserted` excludes it.
7. **NULL target_reps + target_weight carries forward.** Set inserted with both null; no CHECK violation.
8. **Per-exercise set_number monotonicity.** 3 exercises × 3 sets → 9 `sets` rows; set_number 1,2,3 per exercise (NOT 1..9 globally).
9. **NEW: duplicate-exercise-in-routine impossible after migration.** Admin-seed two non-deleted routine_exercises with the same exercise_id; the second insert should 23505 — assert. (Defense-in-depth on MAJ-3 option a.)

### Backfill correctness — `tests/migration-backfill.ts` (new, MIN-4 resolved)

`main()`-style script run via the existing `npm test` runner — mirrors `tests/rls.test.ts` shape (no vitest/jest). Cases:

- routine_exercise with `target_sets=3, target_reps=8, target_weight='60.00'` → expect 3 routine_exercise_sets rows, set_number 1..3, all 'working'.
- routine_exercise with `target_sets=NULL` → expect 0 rows.
- routine_exercise with `target_sets=2, target_reps=NULL, target_weight=NULL` → expect 2 rows with null reps/weight.
- soft-deleted routine_exercise with `target_sets=4` → expect 0 rows.
- **NEW: pre-flight duplicate detection.** Before migration apply, the script queries `SELECT routine_id, exercise_id, COUNT(*) FROM routine_exercises WHERE deleted_at IS NULL GROUP BY 1,2 HAVING COUNT(*) > 1` against a snapshot of the production DB. If non-empty, the migration would fail step 6 — Implementer's pre-flight ritual is to soft-delete the duplicates first. The script asserts the query is empty against the test DB.

Run flow:
```
npm test   # invokes existing runner that already wraps rls.test.ts + seed-and-auth.test.ts
```

### E2E — `tests/e2e/routine-strong-builder.spec.ts` (new)

Playwright, via `npm run e2e`. Cases:

1. **Golden path** — create routine, add exercise, add 3 working sets, start, finish.
2. **Idempotency — double-tap Start.** Two `routineListItem.click()` events in <100ms. Exactly ONE session post-settle, exactly N seeded sets.
3. **Dropset variant.** Add 1 working set + 1 dropset; start; verify live block shows dropset with correct `parent_set_id`.
4. **Backfill — existing routine works.** Admin-seed via post-migration schema (admin-inserts routine_exercise_sets directly); open builder; verify rows.
5. **Edit-then-restart.** Start from routine (3 sets seeded); without finishing, edit routine in new tab (remove one set); active session still has original 3.
6. **Soft-delete a set in builder, re-add.** New set's set_number = max(non-deleted) + 1; partial-unique doesn't trip.
7. **Reorder via chevrons.** Add 3 sets distinct weights; move set 3 up twice; order persists post-refresh.
8. **NEW: Seed-failure — hard fail path (MAJ-2 verification).** Intercept the seed's second `.insert("sets")` call with a route fulfill that returns 500. Tap Start. Assert (a) console error logged, (b) URL stays on `/workout` (no `/workout/{id}` redirect), (c) one orphan session exists in `sessions` (admin client query), (d) `sets` for that session count = 0.
9. **NEW: Duplicate-exercise rejection (MAJ-3 verification).** Use admin client to attempt two non-deleted routine_exercises with the same (routine_id, exercise_id); assert second insert fails 23505. Soft-delete the first, retry the second — assert success (the partial-unique excludes deleted).

### RLS — `tests/rls.test.ts` (edited)

Append a `routine_exercise_sets` arm after the `exercise_notes` arm. Same shape as the existing arm: A creates routine + routine_exercise + routine_exercise_set; B's SELECT/UPDATE/DELETE/INSERT-spoof all reject.

## Out of scope (explicit)

- Per-set RPE in v1.
- Per-set notes in v1 (use exercise_notes).
- Set-type reordering across boundaries.
- Drag-handle reorder.
- Toast/banner on seed failure (the v1 surface is console.warn + non-navigation; future polish to add an in-app toast is parked).
- Auto-prune of orphan empty sessions left by hard-fail seed.
- Admin tool for mass-edit routine_exercise_sets.
- `docs/iphone-shakedown.md` row 4 cosmetic.
- drizzle-kit snapshot regeneration.
- Mid-session routine sync.

## Response to Validator issues (round 1)

### MAJ-1 — Pseudo-code inconsistency
Rewritten as one canonical algorithm in "Pre-seed at session-create — full spec (CANONICAL ALGORITHM)" above. The `routineSetIdToNaturalKey` map is the ONE map; it's populated inside step 3 alongside the row arrays. There is no `parentNaturalKeyByRoutineSetId` map. There is no "refinement" subsection. Step labeling explicit (Step 1 → Step 6). The "What is NOT in this algorithm" paragraph names the dead-code patterns to prevent Implementer drift.

### MAJ-2 — Seed-failure rollback policy
Adopted Validator's recommended option (a): hard fail, no rollback. The `try/catch` around `seedSetsForSession` is removed from `useStartSessionFromRoutine`. The mutation rejects; the parent's existing `catch (err) { console.warn("Start failed", err); }` at `workout/index.tsx:62-64` fires; the user stays on the routines list. The orphan session row remains in History as in-progress (salvageable, not destructive). New Risk #8 (orphan session in History) added. Confidence/Risk on this decision recalibrated: HIGH / LOW (was MEDIUM / MEDIUM in v1). New e2e case #8 (Seed-failure — hard fail path) verifies the path.

### MAJ-3 — Natural-key uniqueness
Adopted option (a): new partial-unique on `routine_exercises(routine_id, exercise_id) WHERE deleted_at IS NULL` in the same migration (step 6 of 0013). The natural key is now provably unique by schema. The migration aborts atomically if production has a pre-existing duplicate (new Risk #15); pre-flight CI check in `tests/migration-backfill.ts` catches it. The idempotency guard in `seedSetsForSession` is tightened to track at `routine_exercise_id` granularity (`skipped_routine_exercise_ids: string[]` in the return type). New unit test #9 + e2e #9 verify the constraint. `addExerciseToRoutine` gains a typed 23505 handler for the new constraint as defense-in-depth.

### MIN-1 — `RoutineExerciseSetEntry` finalization
Pinned: no such type. Parallel fetch via `useRoutineExerciseSets(routineId)`. `<RoutineExerciseCard>` props use `entry: RoutineExerciseEntry` + `setsForExercise: RoutineExerciseSetRow[]`. Updated in the "Mudanças por arquivo" → `src/db/types.ts` row and in the Props block.

### MIN-2 — Drizzle schema explicit code
Promoted from a bullet to a "Drizzle schema" labeled subsection with both `check()` builder entries verbatim (`setTypeCheck` + `parentInvariant`). Implementer copies as-is.

### MIN-3 — Confirm-delete predicate ownership
Added `confirmRemoveSet: (set: RoutineExerciseSetRow) => boolean` to `<RoutineExerciseCard>` props. The card owns the gesture; the parent screen supplies the predicate. Default predicate stated.

### MIN-4 — Backfill test infra
Re-anchored as `tests/migration-backfill.ts` (`main()`-style script, no vitest/jest dependency), invoked via existing `npm test` runner. Mirrors `tests/rls.test.ts` and `tests/seed-and-auth.test.ts` shape.

### MIN-5 — `<RoutineListItem>` pending prop
Pinned: `pending?: boolean` added explicitly to `<RoutineListItem>`. Maps to the existing `disabled` visual (no new styling). Parent forwards `pendingRoutineId === r.id`. Future spinner is follow-up.

### MIN-6 — Embed strip in listForRoutine
Added the explicit destructure: `(data ?? []).map(({ routine_exercises: _re, ...row }) => row as RoutineExerciseSetRow)`. Mirrors `getLastWorkingSetForExercise` pattern at `sets.ts:200-203`.

### MIN-7 — Soft-delete cascade comment
Informational per Validator's own re-classification. Added an explanatory comment to the seed's SQL block calling out the inner-join filter semantics: a soft-deleted `routine_exercises` parent excludes its child `routine_exercise_sets` from the result regardless of the child's `deleted_at` value, because the inner join requires both sides. The design is correct; the comment makes it visible.

### MIN-8 — `console.warn` message detail
Dissolves with MAJ-2 resolution. There is no longer a seed-level `console.warn`; the mutation rejects, and the existing `console.warn("Start failed", err)` at `workout/index.tsx:62-64` carries the error context (`err` is the propagated PostgrestError with code, message, details — sufficient for triage).

## Confidence + Risk per major decision

| Decision | Confidence | Risk | Notes |
|---|---|---|---|
| New table shape + RLS + partial-unique + CHECKs | HIGH | LOW | Mirrors three precedents. |
| Backfill SQL (generate_series + COALESCE) | HIGH | LOW | NULL-safe. |
| ALTER TABLE DROP COLUMN in same migration | HIGH | LOW | Single transaction. |
| `parent_set_id` self-FK + dropset CHECK invariant | HIGH | LOW | Verbatim from sets. |
| Hook key strategy: `["routine-exercise-sets", routineId]` | HIGH | LOW | Single fetch per builder mount. |
| `<RoutineExerciseCard>` expandable layout + blur-commit | MEDIUM | LOW | UX taste; iterate post-merge. |
| Seed at hook layer (`useStartSessionFromRoutine`) | HIGH | LOW | Hard-fail policy simplifies the failure surface (was MEDIUM in v1). |
| JS two-pass dropset remap via natural-key map | HIGH | LOW | The new (routine_id, exercise_id) partial-unique makes the natural key provably unique; algorithm canonical (was MEDIUM / MEDIUM in v1). |
| In-flight guard via `pendingRoutineId` | HIGH | LOW | Mirrors `pickingId`. |
| **Seed-failure policy: HARD FAIL, no rollback** | **HIGH** | **LOW** | **Was MEDIUM / MEDIUM in v1. Now concrete: mutation rejects; user stays on routines list; orphan session in History is salvageable.** |
| **New partial-unique `(routine_id, exercise_id)`** | **HIGH** | **LOW** | **New in v2. Schema guarantee for the seed's natural-key. Pre-flight CI check for existing duplicates.** |
| `queryCacheBuster` bump | HIGH | LOW | Decision 9 mandates. |
| Test plan (unit + e2e + RLS arm + backfill script) | HIGH | LOW | Two new cases added (seed-failure verification, duplicate rejection). |
| Filename rename routine-exercise-row → routine-exercise-card | MEDIUM | LOW | Git follows via similarity. |
| `<RoutineListItem>` `pending` prop | HIGH | LOW | Pinned in v2. |
| Backfill tests as `main()`-style script | HIGH | LOW | No new dev dependency. |
