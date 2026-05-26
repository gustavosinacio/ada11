# Design v1 — 2026-05-26_0101_routine-strong-builder

## Goal (1 sentence)

Replace `routine_exercises.target_sets/target_reps/target_weight` with a normalized `routine_exercise_sets` table so the routine builder stores per-set targets, and pre-seed those targets as unchecked draft `sets` rows whenever a session is started from a routine.

## Approach

Add a new user-owned table `routine_exercise_sets` shaped almost identically to the relevant subset of `sets` (no `rpe`, no `completed_at`), wired with the canonical 4-policy RLS block, a partial-unique on `(routine_exercise_id, set_number) WHERE deleted_at IS NULL`, and a `parent_set_id` self-FK plus dropset CHECK invariant. Inside the same migration, backfill one row per existing target-set, then drop the three legacy columns on `routine_exercises`. `target_rest_seconds` and `notes` stay — they remain per-exercise. The API layer mirrors `src/api/sets.ts` semantically (compute-next set_number, tri-state patches, two-step reorder swap), and a single new TanStack hook keys per-set data at `["routine-exercise-sets", routineId]` so the builder fetches once per routine. The builder UI swaps `<RoutineExerciseRow>` for a card that lists per-set rows and exposes `+ Working set / + Warm-up / + Drop set` buttons matching `<ExerciseBlock>` terminology. The Start-from-routine flow gains a new `useStartSessionFromRoutine` hook that runs `startSession` then a JS two-pass bulk seed (non-dropsets first, build `routineExerciseSetId → setId` map, then dropsets) with an idempotency guard and an in-flight guard at the Start button. Migration in one transaction, query cache buster bumped.

## Decisões nos 7 Unknowns da Discovery

| # | Title | Discovery default | **Designer decision** | Confidence / Risk |
|---|---|---|---|---|
| U1 | Dropset `parent_set_id` mapping on bulk-seed | Two-pass JS insert with `routineExerciseSetId → setId` Map | **Adopt as-is.** Two-pass JS, no Postgres function. Implementation detail spelled out in "Pre-seed at session-create" below. | HIGH / MEDIUM (FK invariant violation if mapping bug — covered by unit + e2e tests) |
| U2 | `routine_exercise_sets.parent_set_id` ON DELETE behavior | Mirror `sets`: `ON DELETE set null` + dropset CHECK invariant | **Adopt as-is.** Soft-delete is the actual delete pattern; the CHECK plus `set null` contradiction is benign and structurally consistent with `sets`. | HIGH / LOW |
| U3 | Backfill correctness (NULL `target_sets`, NULL reps/weight) | `generate_series(1, COALESCE(target_sets, 0))` rows; nullable reps/weight carried verbatim | **Adopt as-is.** NULL `target_sets` produces zero rows for that routine_exercise (the user gets the same blank-slate they had before; no information lost). NULL reps/weight carries forward — `<RoutineExerciseCard>` will render the field empty for the user to fill. | HIGH / LOW |
| U4 | Schema-as-code drift (Drizzle) | Add `routineExerciseSets` to `src/db/schema.ts` mirroring SQL, do NOT regenerate via drizzle-kit | **Adopt as-is.** The journal is stale by 9 migrations; regen would explode. Code comment points at `0013_routine_exercise_sets.sql` for partial-unique (same convention as `routine_exercises:111-114`). | HIGH / LOW |
| U5 | Seed step location: API vs hook vs DB trigger | Hook layer (`useStartSessionFromRoutine`) composing `startSession` + new `seedSetsFromRoutine` | **Adopt as-is.** Keeps the two-pass dropset remap in TS (legible, testable), keeps the existing `useStartSession` untouched (Quick start path = zero regression), gives one mutation `isPending` to gate the Start button. | HIGH / MEDIUM (failure semantics — see Risks) |
| U6 | Builder card: expansion state + Save semantics | Open-by-default, tap header to collapse, commit each set add/edit/remove immediately on action | **Adopt as-is.** Matches existing blur-commit semantics on `RoutineExerciseRow`. Expansion state is ephemeral component-local `useState`, not persisted. | MEDIUM / LOW (UX taste, easy to iterate post-merge) |
| U7 | Position semantics for warmup/dropset | `set_number` is single source of order; UI appends new rows; dropset `parent_set_id` = last working set in card | **Adopt as-is.** Matches `<ExerciseBlock>` add-set semantics (the live block already does this at `exercise-block.tsx:104-110, 309`). Builder mirrors. | HIGH / LOW |

## Mudanças por arquivo

| File | Type | Change |
|---|---|---|
| `supabase/migrations/0013_routine_exercise_sets.sql` | new | DDL + RLS + partial-unique + trigger + backfill + DROP COLUMN. Single transaction. Full SQL below. |
| `src/db/schema.ts` | edited | Drop `targetSets / targetReps / targetWeight` from `routineExercises` (lines 102-104). Add `routineExerciseSets` table mirroring SQL (UUID PK, FKs, `setNumber`, `setType` text + CHECK, `targetReps`, `targetWeight` numeric(6,2), `parentSetId` self-FK `set null`, `notes`, timestamps, dropset CHECK invariant). Code comment at the table footer pointing at 0013 for the partial-unique. |
| `src/db/types.ts` | edited | Remove `target_sets/target_reps/target_weight` from `RoutineExerciseRow` (lines 121-123). Add `RoutineExerciseSet` / `NewRoutineExerciseSet` (Drizzle inferred). Add `RoutineExerciseSetRow` snake_case PostgREST type mirroring SQL. Add `RoutineExerciseSetEntry` (= row with optional joined exercise — not required if API uses parallel fetch; finalized below). |
| `src/api/routine-exercises.ts` | edited | Shrink `RoutineExerciseTargets` to `{ target_rest_seconds?, notes? }`. Drop the three columns from `addExerciseToRoutine` and `updateRoutineExercise` INSERT/UPDATE payloads. `listRoutineExercises` unchanged (does NOT embed sets — see U5/perf rationale below). |
| `src/api/routine-exercise-sets.ts` | new | New API surface: `listForRoutine`, `listForRoutineExercise`, `addSet`, `updateSet`, `removeSet`, `reorderSets`, `seedSetsForSession`. Contracts below. |
| `src/hooks/use-routine-exercise-sets.ts` | new | TanStack hooks keyed at `["routine-exercise-sets", routineId]`. List + 4 mutations all invalidate `KEYS.list(routineId)`. Contract below. |
| `src/hooks/use-sessions.ts` | edited | Add `useStartSessionFromRoutine` composing `startSession` + `seedSetsForSession`. `useStartSession` unchanged (ad-hoc path). |
| `src/components/routine-exercise-card.tsx` | new | Replaces `<RoutineExerciseRow>` semantically. Expandable card per exercise, per-set rows, footer with set-type add buttons + per-exercise Rest field. Layout below. |
| `src/components/routine-exercise-row.tsx` | deleted | Replaced by `routine-exercise-card.tsx`. (Filename rename, not in-place rewrite — keeps git history visible as add+delete; the responsibility shifts.) |
| `app/(app)/routines/[id]/index.tsx` | edited | Import + render `<RoutineExerciseCard>` instead of `<RoutineExerciseRow>`. Delete the `onChangeTargets` closure (lines 230-245) — it merges the three dropped columns. Wire the new per-set hooks for the card's callbacks. |
| `app/(app)/workout/index.tsx` | edited | `startFromRoutine` switches to `useStartSessionFromRoutine`. In-flight guard via `start.isPending` already covers double-tap on the same render; add a per-routine `pendingRoutineId` ref to gate same-frame multi-press cleanly (mirror `pickingId`). |
| `app/(app)/workout/[sessionId].tsx` | unedited | **No change.** Live block consumes `sets` rows identically — pre-seeded rows look like any other unchecked draft. `target_rest_seconds` consumer at lines 118-127 is unchanged (the column survives). |
| `src/lib/query-client.ts` | edited | Bump `queryCacheBuster` from `"schema-2026-05-25-canonical-exercises"` to `"schema-2026-05-26-routine-sets"`. Persisted `["routine-exercises", routineId]` rows would otherwise rehydrate with the three legacy columns the new runtime no longer reads but the type no longer promises — schema mismatch on UPDATE payloads. |
| `docs/data-model.md` | edited | Remove `target_sets/target_reps/target_weight` from the `routine_exercises` block (lines 38-40). Add a `routine_exercise_sets` block mirroring the new table. |
| `docs/iphone-shakedown.md` | edited (optional, can defer) | Row 4 wording ("target sets/reps/weight/rest") becomes "per-set targets + rest". Cosmetic. |
| `tests/rls.test.ts` | edited | Add a `routine_exercise_sets` arm following the existing `exercise_notes` arm pattern (lines 134-192): A creates a routine + routine_exercise + routine_exercise_set; B's SELECT/UPDATE/DELETE/INSERT-spoof all reject. |
| `tests/e2e/routine-strong-builder.spec.ts` | new | E2E golden path: create routine → add exercise → add 3 working sets with weights/reps → start workout from routine → 3 unchecked draft sets appear with right values → check them off → finish session. Plus the dropset variant. Detailed cases below. |
| `tests/unit/routine-exercise-sets.test.ts` | new | Unit coverage for `addSet` next-number compute, `updateSet` tri-state, `reorderSets` two-step, idempotency guard, dropset two-pass remap. Detailed cases below. |

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
--   5. touch_updated_at trigger (function exists since 0001).
--   6. Backfill: one row per existing target_sets unit.
--   7. ALTER TABLE routine_exercises DROP COLUMN target_sets, target_reps,
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

-- 2. Composite read index — every list filters by routine_exercise_id, sorted
--    by set_number. Mirrors sets_session_idx convention.
create index routine_exercise_sets_routine_exercise_idx
  on public.routine_exercise_sets (routine_exercise_id, set_number);

-- 3. Partial UNIQUE — soft-deleted rows excluded so re-insertion at the same
--    set_number after a soft-delete works. Matches 0008/0010/0012 precedent.
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

-- 6. Forward-only data backfill.
--    For every non-deleted routine_exercise with target_sets > 0, emit N rows
--    set_number 1..N, set_type='working', copying target_reps / target_weight
--    (nullable carries forward). NULL or zero target_sets → zero rows for that
--    routine_exercise (the user keeps the blank-slate state they had).
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

-- 7. Drop the legacy columns. target_rest_seconds + notes survive.
alter table public.routine_exercises
  drop column target_sets,
  drop column target_reps,
  drop column target_weight;
```

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

### `src/api/routine-exercises.ts` — shrunk type

```ts
export type RoutineExerciseTargets = {
  target_rest_seconds?: number | null;
  notes?: string | null;
};
```

`addExerciseToRoutine` and `updateRoutineExercise` drop the three columns from their INSERT/UPDATE payloads. `listRoutineExercises` unchanged.

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
  set_type?: SetType;          // included to support warmup<->working swap
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
  inserted: number;            // total sets rows created
  skipped_exercises: number;   // exercises already with non-deleted sets in this session
};
export async function seedSetsForSession(
  input: SeedSetsForSessionInput,
): Promise<SeedSetsForSessionResult>;
```

**`listRoutineExerciseSetsForRoutine`** — single PostgREST call:

```ts
const { data, error } = await supabase
  .from("routine_exercise_sets")
  .select("*, routine_exercises!inner(routine_id)")
  .eq("routine_exercises.routine_id", routineId)
  .is("deleted_at", null)
  .order("set_number", { ascending: true });
```

Returns flat rows. The builder maps them client-side into `Map<routine_exercise_id, RoutineExerciseSetRow[]>`. (Inner-join filters via dotted path are the canonical PostgREST pattern in this repo — see `docs/data-model.md:196-213`.)

**`addRoutineExerciseSet`** — compute next set_number from `MAX(set_number) WHERE deleted_at IS NULL + 1`, identical pattern to `src/api/sets.ts:63-73`. Reads `auth.uid()` for `user_id`. Inserts row.

**`updateRoutineExerciseSet`** — tri-state patch matching `src/api/sets.ts:113-138` verbatim, including the empty-payload short-circuit returning `null`. The `set_type` key is included because future iteration (out of scope but the patch shape supports it) may need to swap warmup↔working; the CHECK invariant constrains it cleanly via the dropset/parent_set_id pair.

**`removeRoutineExerciseSet`** — `update({ deleted_at: now().toISOString() }).eq("id", id)`. Verbatim from `src/api/sets.ts:206-212`.

**`reorderRoutineExerciseSets`** — verbatim two-step swap from Discovery's pattern (`docs/runs/.../discovery.md:303-329`). `set_number` is 1-indexed (matches `sets`). The negative-park step uses `-(i+1)` so it cannot collide with the positive 1..N range.

**`seedSetsForSession`** — see "Pre-seed at session-create" section below for the full algorithm.

### Hook — `src/hooks/use-routine-exercise-sets.ts`

```ts
const KEYS = {
  // Single fetch per routine — the builder mounts one query for the whole
  // exercise list, not N (one per exercise). Per-exercise mutations still
  // invalidate this single key.
  list: (routineId: string) => ["routine-exercise-sets", routineId] as const,
};

export function useRoutineExerciseSets(routineId: string | undefined);
export function useAddRoutineExerciseSet(routineId: string);
export function useUpdateRoutineExerciseSet(routineId: string);
export function useRemoveRoutineExerciseSet(routineId: string);
export function useReorderRoutineExerciseSets(routineId: string);
```

**Cache-key choice: routineId, not routineExerciseId.** Rationale: (1) the builder screen consumes the full per-routine list at mount; keying per routine_exercise would fan out to N queries with N mount events, breaking the single-fetch state.md hint; (2) every mutation in the builder is in the same screen, so any per-set mutation invalidating the parent list is the same cost as invalidating a per-exercise sub-key; (3) the only other consumer of per-set data is `seedSetsForSession` which reads via the API directly, not the hook. The per-exercise `list-for-routine-exercise` API exists for tests and future call-sites but is not promoted to a hook in v1.

`useUpdateRoutineExerciseSet.onSuccess` MUST guard `if (result === null) return;` before invalidating the cache — same contract as `useUpdateSet:71-73`.

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
      try {
        await seedSetsForSession({
          session_id: session.id,
          routine_id: input.routine_id,
          user_id: userId,
        });
      } catch (err) {
        // Best-effort: surface the seed failure but DO NOT roll back the
        // session. Rationale in Risks → "Seed failure rollback policy".
        // The live screen renders an empty session; the user can add sets
        // manually. The error is logged via console.warn (matches existing
        // start-from-routine error path at workout/index.tsx:62-64).
        console.warn("Seed failed", err);
      }
      return session;
    },
    onSuccess: (row) => {
      qc.setQueryData(KEYS.active, row);
      qc.invalidateQueries({ queryKey: KEYS.all });
      // Important: invalidate ["sets", session.id] so the live screen's
      // useSetsForSession hook refetches and sees the seeded rows.
      qc.invalidateQueries({ queryKey: ["sets", row.id] });
    },
  });
}
```

### `<RoutineExerciseCard>` props

```ts
type Props = {
  entry: RoutineExerciseEntry;          // same shape as today (exercise embed)
  setsForExercise: RoutineExerciseSetRow[];   // pre-filtered + sorted by set_number ASC
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemoveExercise: () => void;
  onChangeRest: (seconds: number | null) => void;        // commits target_rest_seconds
  onAddSet: (input: { set_type: SetType; parent_set_id?: string | null }) => Promise<void>;
  onUpdateSet: (id: string, patch: { target_reps?: number | null; target_weight?: string | null }) => Promise<void>;
  onRemoveSet: (id: string) => Promise<void>;
  onReorderSets: (orderedIds: string[]) => Promise<void>;
};
```

### Layout — ASCII sketch

```
+----------------------------------------------------------------+
|  ▼  Bench Press                          [⇡] [⇣] [🗑]          |  ← collapsible header
|     Chest · Triceps · Barbell                                  |
+----------------------------------------------------------------+
|  Set #   Weight (kg)   Reps              [type]                |  ← column labels
+----------------------------------------------------------------+
|  1       [  60.0  ]    [  8  ]   working    [⇡][⇣][🗑]         |
|  2       [  70.0  ]    [  8  ]   working    [⇡][⇣][🗑]         |
|  3       [  60.0  ]    [  8  ]   dropset    [⇡][⇣][🗑]         |
|  (warmups, if any, sit wherever set_number places them)        |
+----------------------------------------------------------------+
|  [+ Working set]       [⌄ more types]                          |  ← footer add row
|     ↳ when ⌄ open:                                             |
|        [+ Warm-up]                                             |
|        [+ Drop set (chains onto set N)]                        |
+----------------------------------------------------------------+
|  Rest between sets: [  90  ] s                                 |  ← per-exercise rest
+----------------------------------------------------------------+
```

**Notes on the layout**:
- Collapsible header: tap the chevron or the exercise name to toggle. Default = expanded on mount (state.md U6 default). State is per-component `useState`, not persisted.
- Per-set row inputs use the same `<TextInput>` blur/submit-commit pattern as today's `TargetField` (`routine-exercise-row.tsx:176-185`). Tap-to-edit commits on blur via `updateSet`.
- Set-type pill is read-only in v1 (set type is fixed at creation time). Reordering across types is permitted by chevrons because `set_number` is the only ordering source — but the dropset-parent CHECK invariant means moving a dropset above its parent has no DB ramifications (the FK pointer is unchanged; the row count is preserved). The UX implication is benign and out of scope for v1 (state.md:55).
- Soft-delete a set via the trash icon on the row. Confirms via `confirmDelete` only if the set has `target_reps != null && target_weight != null` (cheap UX nicety; otherwise direct soft-delete).
- Reorder via per-row up/down chevrons. Reuse the parent's `move()` helper pattern from `app/(app)/routines/[id]/index.tsx:99-112`.
- Rest field is at card footer, commits on blur to `routine_exercises.target_rest_seconds` via the existing `useUpdateRoutineExercise(routineId)` mutation (unchanged from today).

### `<RoutineListItem>` / Start button

`app/(app)/workout/index.tsx` switches `startFromRoutine` from `useStartSession` to `useStartSessionFromRoutine`. The Quick-start path keeps `useStartSession` (ad-hoc). The Start in-flight guard becomes:

```ts
const [pendingRoutineId, setPendingRoutineId] = useState<string | null>(null);

const startFromRoutine = async (r: RoutineRow) => {
  if (active.data) { router.push(`/(app)/workout/${active.data.id}`); return; }
  if (pendingRoutineId) return;            // double-tap guard
  setPendingRoutineId(r.id);
  try {
    const row = await startFromRoutineMut.mutateAsync({ routine_id: r.id, name: r.name });
    router.replace(`/(app)/workout/${row.id}`);
  } catch (err) {
    console.warn("Start failed", err);
  } finally {
    setPendingRoutineId(null);
  }
};
```

This mirrors `pickingId` in `src/components/exercise-picker.tsx`. The `disabled` prop on `<RoutineListItem>` already exists from `hasActive`; pass an additional `pending = pendingRoutineId === r.id` if the design wants a per-row spinner (optional; can be `start.isPending` for now).

## Pre-seed at session-create — full spec

### Call path

```
RoutineListItem → onPress
  → startFromRoutine(r)
    → useStartSessionFromRoutine.mutateAsync({ routine_id, name })
      → startSession({ routine_id, name })           ← INSERT into sessions
      → seedSetsForSession({ session_id, routine_id, user_id })
        ↓ (this function — described below)
```

### `seedSetsForSession` algorithm

1. **Read routine config.** One PostgREST call with inner join:
   ```ts
   const { data: routineSets } = await supabase
     .from("routine_exercise_sets")
     .select(`
       id, set_number, set_type, target_reps, target_weight, parent_set_id,
       routine_exercises!inner ( id, exercise_id, routine_id )
     `)
     .eq("routine_exercises.routine_id", input.routine_id)
     .is("deleted_at", null)
     .is("routine_exercises.deleted_at", null)
     .order("set_number", { ascending: true });
   ```
   Returns flat rows enriched with `routine_exercises.exercise_id`. Routine_exercises soft-deleted are excluded via the dotted path filter (same convention as `getLastWorkingSetForExercise` at `src/api/sets.ts:182-204`).

2. **Idempotency guard.** Before inserting, read the set of `exercise_id` values that already have non-deleted sets in this session:
   ```ts
   const { data: existingByExercise } = await supabase
     .from("sets")
     .select("exercise_id")
     .eq("session_id", input.session_id)
     .is("deleted_at", null);
   const skipExerciseIds = new Set(existingByExercise?.map((r) => r.exercise_id) ?? []);
   ```
   For ANY exercise already represented, skip ALL its routine sets (matches state.md:37 "never re-seed on screen mount" — but here we're guarding the seed call itself in case of retry/double-fire). Increments `result.skipped_exercises` per skipped routine_exercise.

3. **Two-pass dropset remap.** Build the rows to insert:
   ```ts
   // Per-exercise set_number sequencing (mirrors logSet's compute pattern).
   // For each exercise in the routine, start at 1 and increment monotonically
   // following the routine's set_number ordering. We do NOT preserve gaps.
   const setNumberByExercise = new Map<string, number>();   // exercise_id → next set_number
   const nonDropsetRows: NewSet[] = [];
   const dropsetRows: Array<NewSet & { __sourceRoutineSetId: string; __parentRoutineSetId: string }> = [];

   for (const rs of routineSets ?? []) {
     const exId = rs.routine_exercises.exercise_id;
     if (skipExerciseIds.has(exId)) continue;
     const nextNumber = (setNumberByExercise.get(exId) ?? 0) + 1;
     setNumberByExercise.set(exId, nextNumber);

     const base = {
       user_id: input.user_id,
       session_id: input.session_id,
       exercise_id: exId,
       set_number: nextNumber,
       reps: rs.target_reps,
       weight: rs.target_weight,
       rpe: null,
       notes: null,
       set_type: rs.set_type,
       completed_at: null,                   // unchecked draft
     };

     if (rs.set_type === "dropset") {
       if (!rs.parent_set_id) {
         // CHECK invariant in DB should make this unreachable, but defend.
         throw new Error("dropset has null parent_set_id");
       }
       dropsetRows.push({
         ...base,
         parent_set_id: null,                // filled in pass 2
         __sourceRoutineSetId: rs.id,
         __parentRoutineSetId: rs.parent_set_id,
       });
     } else {
       nonDropsetRows.push({ ...base, parent_set_id: null });
     }
   }
   ```

4. **Pass 1: insert non-dropsets, capture the map.** Use one bulk insert with `RETURNING *` (PostgREST `.select()` after `.insert(rows)` does this natively):
   ```ts
   // Match each inserted sets.id back to the routine_exercise_sets.id it came from.
   // We rely on (session_id, exercise_id, set_number) being unique post-0008
   // partial-unique, so the natural-key mapping works deterministically.
   // For the routine→sets map we instead index on (exercise_id, set_number)
   // computed at row-build time.
   const { data: insertedNonDropsets } = await supabase
     .from("sets")
     .insert(nonDropsetRows.map(({ __sourceRoutineSetId, __parentRoutineSetId, ...r }) => r))
     .select();

   // Build the map: routine_exercise_sets.id → sets.id.
   // The order of returned rows MAY differ from the input order (PostgREST
   // does not guarantee ordering on insert .select()). Match by the natural
   // key (exercise_id, set_number) instead of array index.
   const setsIdByNaturalKey = new Map<string, string>();
   for (const s of insertedNonDropsets ?? []) {
     setsIdByNaturalKey.set(`${s.exercise_id}:${s.set_number}`, s.id);
   }
   // To resolve a dropset's parent later, we also need parent's NATURAL key:
   //   given parent routine_exercise_sets.id, look up its (exercise_id,
   //   set_number) from the in-memory routineSets list (already loaded above).
   const parentNaturalKeyByRoutineSetId = new Map<string, string>();   // routine_set.id → "exId:setNumber"
   for (const rs of routineSets ?? []) {
     if (rs.set_type !== 'dropset') {
       // We rebuild the assigned set_number from setNumberByExercise's path.
       // Simpler: track during the build above. (See note below — actually
       // we capture this in pass 0 by indexing the built rows.)
     }
   }
   ```

   **Refinement (cleaner):** during step 3, also build:
   ```ts
   // routine_exercise_sets.id → "exId:assignedSetNumber"
   const routineSetIdToNaturalKey = new Map<string, string>();
   // ... populated alongside nonDropsetRows.push / dropsetRows.push as we go.
   ```
   Then pass 2 resolves parent like:
   ```ts
   const parentNatural = routineSetIdToNaturalKey.get(dr.__parentRoutineSetId);
   const parentSetId = parentNatural ? setsIdByNaturalKey.get(parentNatural) : null;
   ```

5. **Pass 2: insert dropsets with mapped `parent_set_id`.**
   ```ts
   const dropsetRowsResolved = dropsetRows.map((dr) => {
     const parentNatural = routineSetIdToNaturalKey.get(dr.__parentRoutineSetId);
     const parentSetId = parentNatural ? setsIdByNaturalKey.get(parentNatural) : null;
     if (!parentSetId) {
       // Parent was either soft-deleted (excluded from pass 1) or its source
       // routine_exercise_set referenced an invalid row. We drop this dropset
       // — better than aborting the whole seed. The user can re-add manually.
       return null;
     }
     const { __sourceRoutineSetId, __parentRoutineSetId, ...row } = dr;
     return { ...row, parent_set_id: parentSetId };
   }).filter((r): r is NewSet => r !== null);

   if (dropsetRowsResolved.length > 0) {
     const { error } = await supabase.from("sets").insert(dropsetRowsResolved);
     if (error) throw error;
   }
   ```

6. **Return totals.**
   ```ts
   return {
     inserted: (insertedNonDropsets?.length ?? 0) + dropsetRowsResolved.length,
     skipped_exercises: skipExerciseIds.size,
   };
   ```

**Why JS two-pass, not a SQL function**: U5 default. The project has only two Postgres functions (`seed_new_user`, `touch_updated_at`); adding a third for one feature inflates the DB-side surface and complicates testing (mocks don't intercept SQL functions easily). The JS path is observable, debuggable, and matches the existing API/JS-side split.

**Why per-exercise (exercise_id, set_number) natural-key mapping instead of array-index**: PostgREST `.insert(rows).select()` does NOT guarantee the returned order matches the input order (see PostgREST docs; the implementation uses the partial-unique index for ordering, which depends on insertion order at the storage layer — undefined for bulk inserts). The natural key is deterministic post-0008.

### In-flight guard at Start

`useStartSessionFromRoutine`'s `mutateAsync` is wrapped at the call site (`workout/index.tsx`) by `pendingRoutineId` state. A second tap on the same routine while pending is a no-op. A tap on a different routine while one is pending is also a no-op (single-route at a time). Per state.md:47 + Discovery's `pickingId` precedent.

### Seed failure rollback policy

**Decision: do NOT roll back the session on seed failure. Log and proceed.**

Rationale:
- The session row is a degenerate-but-valid state: a workout the user can complete by adding sets manually. The user is already on the live screen at this point (or about to navigate there) — undoing the session would surprise them.
- The seed failure path is rare (single bulk INSERT, RLS scoped to the same user). The most likely failure mode is a transient network blip; the user can retry by deleting the empty session and re-tapping Start.
- Rolling back via soft-delete on the session adds a write-after-failure that could itself fail, complicating the error recovery surface. The current `useStartSession.onSuccess` doesn't roll back on `setQueryData` failure either.
- Atomic alternative (DB trigger) is rejected per U5 — would solve atomicity but at the cost of adding a new Postgres function.

**Counterpoint**: A user who taps Start, sees an empty live screen because seed failed, may not realize the seed was supposed to happen. Mitigation = surface the seed error via the existing `console.warn` (matches `app/(app)/workout/index.tsx:62-64` pattern). A future toast/banner is out of scope for v1.

## Riscos

### 1. Data integrity — dropset parent FK invariant on bulk seed
**LOAD-BEARING.** If the two-pass JS remap mis-maps a parent (e.g. parent was soft-deleted between routineSet load and sets insert, or natural-key collision), the dropset insert in pass 2 will either:
- Trip the `sets_parent_matches_type` CHECK if `parent_set_id IS NULL` is written for a dropset → batch insert aborts with 23514.
- Trip the `sets_parent_set_id_fk` FK if a stale UUID is written → 23503.

Mitigation: pass-2 row builder explicitly drops unresolvable dropsets (returns null + filter). Worst case: a dropset doesn't seed, the working set parent does — no FK violation, just one missing row. Unit test the path. **Confidence MEDIUM, Risk MEDIUM.**

### 2. Data integrity — RLS on bulk insert
The seed inserts `sets` rows as the signed-in user. RLS `sets_insert` policy is `with check (auth.uid() = user_id)` — every row carries `user_id` explicitly per the existing pattern at `src/api/sets.ts:78`. If any row carried a different user_id (shouldn't, but defense-in-depth), the whole batch would reject. Mitigation: explicitly pass `input.user_id` (= `auth.user.id` from the hook) to every row in pass 1/2. **Confidence HIGH, Risk LOW.**

### 3. Data integrity — migration atomicity
Supabase migrations are single-file transactions, so the backfill + DROP COLUMN happens atomically per file. If the backfill fails (e.g. CHECK violation), the entire migration aborts and the columns stay. The backfill writes `set_type='working'` (constant), `parent_set_id` defaulted to NULL via column default — both satisfy the CHECK trivially. The only way the backfill could fail is if `target_reps / target_weight` violated some new constraint — but no new constraint applies to those columns. **Confidence HIGH, Risk LOW.**

### 4. Data integrity — persisted-cache mismatch on rehydrate
Without bumping `queryCacheBuster`, persisted `["routine-exercises", routineId]` blobs from older builds would carry `target_sets/target_reps/target_weight` keys that the new runtime no longer references — and worse, the new `<RoutineExerciseCard>` would receive a row whose `target_rest_seconds` typing path is unchanged but whose dropped columns are still present on the persisted blob. The risk surface is `updateRoutineExercise` payloads: if the screen has stale state from rehydrated cache, it could PATCH the dropped columns and get a 400. **Mitigation: bump buster to `"schema-2026-05-26-routine-sets"`.** Decision 9 (`docs/decisions.md:173-194`) explicitly mandates this. **Confidence HIGH, Risk LOW (with the bump), HIGH (without).**

### 5. UX regression — live screen rest-timer + auto-fill placeholders
`app/(app)/workout/[sessionId].tsx:118-127` reads `routine_exercises.target_rest_seconds` — column survives, no change. `<ExerciseBlock>` reads `previousByRowId` (lines 120-136) which walks the in-session set list backwards for placeholders. Pre-seeded rows have `reps + weight` populated from the routine, so the FIRST seeded set has no in-session prior — its placeholder falls back to `lastFromHistory` (cross-session). Subsequent seeded rows DO walk backward to the prior seeded row. **Behavior: identical to the user starting from an empty session and manually filling each set.** No regression. **Confidence HIGH, Risk LOW.**

### 6. UX regression — rest-timer auto-start on bulk seed
The auto-start observer at `app/(app)/workout/[sessionId].tsx:154-180` watches for EXACTLY ONE working-set transition from unchecked to checked. The seed inserts rows with `completed_at = null` — no transition fires. The hydration ref (`checkedHydratedRef`) initializes on first data arrival without firing. **No false timer start.** **Confidence HIGH, Risk LOW.**

### 7. UX regression — checked-set bubble (commit 5190a58 fix)
`src/api/sets.ts:48-53` (recent fix) orders by `set_number` ascending so checked sets don't bubble. The seed assigns set_number 1..N per (session, exercise) deterministically. Listed in order, behaves identically. **Confidence HIGH, Risk LOW.**

### 8. Platform divergence — none
The new code is RN + RN-Web compatible (uses the same primitives as `<RoutineExerciseRow>`, `<ExerciseBlock>`). No platform-specific imports. Playwright e2e is the gate for the web path; the iOS shakedown remains a manual smoke. **Confidence HIGH, Risk LOW.**

### 9. Performance — builder fetch fan-out
`useRoutineExerciseSets(routineId)` is a single PostgREST call per routine, returning N (typical: 5-30) rows. The page-load cost is +1 query on top of `useRoutineExercises`. Acceptable. The list mapping client-side is O(N). **Confidence HIGH, Risk LOW.**

### 10. Performance — seed fetch cost
`seedSetsForSession` makes 2-4 PostgREST calls per Start:
1. Read routineSets (1 call).
2. Read existing sets for idempotency (1 call; ~10-50 rows).
3. Insert non-dropsets (1 call; N rows).
4. Insert dropsets (1 call; usually 0-2 rows; skip if empty).

Total: ≤4 round-trips for a routine of any size. Acceptable Start latency overhead (~200-400ms on slow networks). **Confidence HIGH, Risk LOW.**

### 11. RLS test regression
`tests/rls.test.ts` must gain a `routine_exercise_sets` arm. Without it, the test suite would still pass (it would just not exercise the new table's policies). The risk is silent RLS misconfiguration. **Mitigation: explicit new arm. See Tests section.** **Confidence HIGH, Risk LOW (with the arm), MEDIUM (without).**

### 12. Test-fixture migration
`tests/e2e/rest-timer-auto-start.spec.ts:71-117` and `tests/e2e/auto-fill-placeholder-on-check.spec.ts:106-122` admin-insert `routine_exercises` with `target_rest_seconds` but NOT `target_sets/target_reps/target_weight`. Discovery verified these specs don't reference the dropped columns. **No change required** to those specs. **Confidence HIGH (Discovery's grep), Risk LOW.**

### 13. The 13th risk — Mid-session routine edit
If the user edits the routine (adds/removes sets in the builder) AFTER starting a session from it, the live session DOES NOT update — seed is fire-and-forget at start. This matches state.md:42 ("edit-then-restart routine change does NOT affect already-started sessions"). Documented behavior, no fix needed. **Confidence HIGH, Risk LOW.**

## Alternativas descartadas

1. **Single-column JSON `routine_exercises.sets_json`** — would skip the migration entirely. Rejected: violates the repo's zero-JSON-column convention; would block per-set RLS extensions (none today, but path-dependent); breaks PostgREST embedding. User decision in state.md:11.

2. **Defer seed to live-screen mount** — `app/(app)/workout/[sessionId].tsx` reads `routineExerciseSetsQ` directly and writes seed rows on first mount. Rejected: violates state.md:13 (user requirement = pre-seed at session-create); creates a race where the user could navigate to the screen, see empty state, then have rows pop in.

3. **Postgres trigger `AFTER INSERT ON sessions` to seed** — atomic, single transaction. Rejected per U5: adds a new Postgres function; the dropset two-pass remap is awkward in SQL (would need a CTE with `RETURNING` chained); harder to test from JS.

4. **Single-pass dropset insert using deterministic UUID v5 derivation** — derive child `parent_set_id` deterministically from parent's natural key + session_id. Rejected: requires UUID v5 lib import, fragile against ID collisions, not how the codebase does ID generation (`gen_random_uuid()` at DB).

5. **Per-routine_exercise list query (key = routineExerciseId)** — N TanStack queries, one per exercise card. Rejected: violates state.md:28 single-fetch hint; needless cache fragmentation.

6. **Keep `<RoutineExerciseRow>` filename, rewrite body in place** — saves a delete. Rejected: the file's purpose changes from "single-row 4-field form" to "expandable card with per-set list" — the rename communicates the intent to future readers, and git follows the rename via similarity.

7. **Save-button at card level** — stage all set edits locally, commit on Save. Rejected per U6: doesn't match the rest of the routine builder's blur-commit semantics; introduces a stale-state class of bug.

8. **Drag-handle reorder for sets** — visually nicer than chevrons. Rejected per state.md:56 (explicitly out of scope v1).

9. **Per-set RPE in v1** — matches the `sets.rpe` column. Rejected per state.md:53 (user decision).

10. **Cascade backfill: also create seed sets in the CURRENT active session, if any** — convenience for users who already have a session running. Rejected: scope creep, fragile against the idempotency model.

11. **Hard-drop dropset rows during backfill (set_type='working' only)** — simpler SQL. Rejected: no existing routine has dropsets in `routine_exercises` (the old shape didn't support them) — the SQL would only ever produce working sets anyway, so the simplification is a no-op. Defensive `set_type='working'` literal is the chosen path.

12. **Rollback session on seed failure** — atomic UX. Rejected: see Risks #1 + seed-failure rollback policy above. Session is salvageable manually; rollback adds complexity to the error recovery path.

13. **Read seeding parameters from `listRoutineExercises` embed instead of separate fetch** — `select("*, routine_exercise_sets(*)")` in `listRoutineExercises`. Rejected: the embedded variant ships `routine_exercise_sets` to every consumer of `useRoutineExercises` including the live-screen consumer at `app/(app)/workout/[sessionId].tsx:193` that only reads `re.target_rest_seconds`. Bloats payload + complicates the type. Parallel fetch via `useRoutineExerciseSets(routineId)` is cleaner.

## Tests

### Unit tests — `tests/unit/routine-exercise-sets.test.ts` (new)

Run via `npm test` (vitest/jest — confirmed test runner via existing `tests/` shape). Cases:

1. **`addRoutineExerciseSet` next-set_number from MAX+1.** Insert two rows, soft-delete one, insert a third — its set_number should be `max + 1` of non-deleted rows.
2. **`updateRoutineExerciseSet` tri-state semantics.**
   - Patch `{ target_reps: 8 }` writes only `target_reps`, leaves `target_weight` untouched.
   - Patch `{ target_weight: null }` writes `target_weight = null` explicitly.
   - Empty patch `{}` returns `null` and triggers no PostgREST call (mock supabase, assert call count = 0).
3. **`reorderRoutineExerciseSets` two-step swap.** Reorder [A,B,C] → [C,A,B] and assert all 3 rows have set_number 1..3 with no intermediate unique-index trip (mock + capture call order).
4. **Idempotency guard in `seedSetsForSession`.** Pre-insert one set for exercise E in session S; call seed; assert no insert fires for exercise E.
5. **Dropset two-pass remap.** Seed a routine with [working, dropset] — assert the inserted dropset's `parent_set_id` matches the inserted working's `sets.id`, not the source `routine_exercise_sets.id`.
6. **Orphan-dropset graceful fallback.** Routine has a dropset whose `parent_set_id` references a soft-deleted routine_exercise_set; seed should drop that dropset silently (NOT throw, NOT trip CHECK). Assert returned `inserted` count excludes it.
7. **NULL `target_reps` / `target_weight` carries forward.** Routine_exercise_set with both null produces a `sets` row with both null and no CHECK violation.
8. **Per-exercise set_number monotonicity.** A routine with 3 exercises × 3 sets each produces 9 `sets` rows with set_number 1,2,3 repeating per exercise (NOT 1..9 globally).

### Backfill correctness (SQL-level, run as part of migration apply)

Tester applies the migration to a fresh DB seeded with routines having:
- One routine_exercise with `target_sets=3, target_reps=8, target_weight='60.00'` → expect 3 routine_exercise_sets rows, set_number 1..3, all 'working'.
- One routine_exercise with `target_sets=NULL` → expect 0 routine_exercise_sets rows for it.
- One routine_exercise with `target_sets=2, target_reps=NULL, target_weight=NULL` → expect 2 rows with null reps/weight.
- One soft-deleted routine_exercise with `target_sets=4` → expect 0 rows (filtered by `WHERE deleted_at IS NULL`).

These assertions live in `tests/migration-backfill.test.ts` (new), executed against a Supabase local instance the Tester spins up. If infra doesn't support that, fold into `tests/rls.test.ts` setup phase as a pre-flight assertion.

### E2E — `tests/e2e/routine-strong-builder.spec.ts` (new)

Run via `npm run e2e` (Playwright). Cases:

1. **Golden path — create routine, add exercise, add 3 working sets, start workout, finish.**
   - Admin-seed a canonical exercise (use `tests/e2e/_helpers/canonical-exercise.ts:34-60` `pickCanonicalExercise`).
   - Sign in as a fresh user, create routine, add the exercise.
   - In the new `<RoutineExerciseCard>`, tap `+ Working set` three times; in each row enter weight + reps.
   - Navigate to Workout home; tap the routine to start.
   - Verify the live screen shows 3 unchecked rows with the right weight/reps placeholders (`SetInput` reads `s.weight` / `s.reps` directly, not just placeholder — the seeded rows carry actual values).
   - Tap each row's check button; verify total volume equals 3 × weight × reps.
   - Finish session via Finish flow.

2. **Idempotency — double-tap Start.** Fire two `routineListItem.click()` events in <100ms. Verify exactly ONE session exists after settle (read via admin client). Verify exactly N seeded sets (not 2N).

3. **Dropset variant.** In the builder, add 1 working set, then expand the more-types menu and tap `+ Drop set`. Verify the dropset row appears with parent linkage visible (the row's set_type pill shows 'dropset'). Start workout; verify the live block shows the dropset as a child of the working set (`parent_set_id` populated; check via admin client read).

4. **Backfill — existing routine still works.** Pre-migration: admin-seed a routine with `target_sets=3, target_reps=8, target_weight='60.00'` via the *post-migration* schema (Tester runs against post-migration DB, so this case asserts admin-seeded routine_exercise_sets rows). Open the builder; verify 3 set rows are visible with the right values. Start workout; verify 3 seeded sets.

5. **Edit-then-restart.** Start a session from a routine (3 sets pre-seeded). Without finishing, open the routine builder in a new tab/route; remove one set. Return to the live session; verify the original 3 seeded sets are still present (the routine edit does NOT propagate to the active session — state.md:42).

6. **Soft-delete a set in the builder, re-add.** Add a set, soft-delete it via trash, add another — verify the new set's set_number is `max(non-deleted) + 1` and the partial-unique doesn't trip.

7. **Reorder via chevrons.** Add 3 working sets with distinct weights. Move set 3 up twice — verify the order persists after refresh.

### RLS — `tests/rls.test.ts` (edited)

Append a `routine_exercise_sets` arm after the `exercise_notes` arm (lines 134-192). Pattern:
- A creates a routine, routine_exercise, routine_exercise_set (all under A's user_id).
- B's SELECT returns 0 rows.
- B's UPDATE affects 0 rows.
- B's DELETE affects 0 rows.
- B's INSERT-spoof (with `user_id: a.user.id`) fails or returns 0 rows (PostgREST surfaces either; assert at least one).

## Out of scope (explicit)

- **Per-set RPE in v1** — state.md:53. `routine_exercise_sets` does NOT carry `rpe` in v1.
- **Per-set notes in v1** — use `exercise_notes` instead. State.md:54.
- **Set-type reordering across boundaries (e.g. warmup between two working sets via UI affordance)** — set_number is the single source of order; chevrons can move any row, but no UX enforcement of warmup/working/dropset clustering. State.md:55.
- **Drag-handle reorder** — up/down chevrons only, matching the existing routine_exercises and exercise-block reorder pattern. State.md:56.
- **Atomic session+seed rollback** — accepted policy is best-effort with `console.warn` on failure. Out of scope: toast/banner surfacing.
- **Mid-session routine sync** — routine edits do not propagate to already-started sessions.
- **Admin tool / scripts to mass-edit routine_exercise_sets** — out of scope.
- **`docs/iphone-shakedown.md` row 4 cosmetic update** — Implementer can update in passing; not load-bearing.
- **drizzle-kit snapshot regeneration** — explicitly out per U4. Schema.ts is hand-edited.

## Resposta a issues do Validator (only if v > 1)

n/a — this is round 1.

## Confidence + Risk per major decision

| Decision | Confidence | Risk | Notes |
|---|---|---|---|
| New table shape + RLS + partial-unique + CHECKs | HIGH | LOW | Mirrors three existing precedents (0008/0010/0012). Backfill is forward-only. |
| Backfill SQL (generate_series + COALESCE) | HIGH | LOW | NULL-safe via COALESCE. Filters soft-deleted parents. Atomic with DROP. |
| ALTER TABLE DROP COLUMN in same migration | HIGH | LOW | Single transaction; backfill must succeed first or both abort. |
| `parent_set_id` self-FK + dropset CHECK invariant | HIGH | LOW | Verbatim from sets table. |
| Hook key strategy: `["routine-exercise-sets", routineId]` | HIGH | LOW | Single fetch per builder mount. |
| `<RoutineExerciseCard>` expandable layout + blur-commit | MEDIUM | LOW | UX taste; matches existing patterns; easy to iterate. |
| Seed at hook layer (`useStartSessionFromRoutine`) | HIGH | MEDIUM | Non-atomic with session create; mitigated by best-effort policy. |
| JS two-pass dropset remap via natural-key map | MEDIUM | MEDIUM | The trickiest piece. Covered by unit + e2e tests. The natural-key fallback is deterministic post-0008. |
| In-flight guard via `pendingRoutineId` | HIGH | LOW | Mirrors `pickingId` precedent. |
| Seed-failure rollback policy: NO rollback, log + proceed | MEDIUM | MEDIUM | Trade-off chosen explicitly; user gets a salvageable empty session. |
| `queryCacheBuster` bump | HIGH | LOW | Decision 9 mandates. Cost = 1 refetch per user. |
| Test plan (unit + e2e + RLS arm + backfill SQL assertions) | HIGH | LOW | Covers every flagged edge case. |
| Filename rename routine-exercise-row → routine-exercise-card | MEDIUM | LOW | Visible signal of responsibility change; git follows via similarity. |
