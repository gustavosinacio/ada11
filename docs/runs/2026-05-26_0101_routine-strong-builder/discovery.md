# Discovery — 2026-05-26_0101_routine-strong-builder

## Feature prompt

> Strong-like routine builder with per-set targets.
>
> Today the routine builder stores ONE row per exercise in `routine_exercises` with single `target_sets / target_reps / target_weight` values, and the live workout doesn't seed any sets from the routine. We're switching to a model where each set is explicit (Set 1: 60 kg × 8, Set 2: 70 kg × 8, ...) and starting a workout from a routine pre-populates those sets as unchecked drafts on the live screen.
>
> User decisions baked into the prompt (state.md:9-14):
> 1. **Shape A**: new normalized table `routine_exercise_sets` (NOT a JSON column).
> 2. **No per-set RPE in v1.** Per-set fields: `set_number`, `set_type ∈ {'working','warmup','dropset'}`, `target_reps`, `target_weight`, `parent_set_id` (for dropsets).
> 3. **Pre-seed at session-create.** On Start, bulk-INSERT seed `sets` rows (one per `routine_exercise_sets` row, `completed_at = null`) immediately — NOT deferred to first interaction.
> 4. **Drop deprecated columns** (`target_sets`, `target_reps`, `target_weight`) in the same migration. `target_rest_seconds` stays.

Verbatim copy lives in `docs/runs/2026-05-26_0101_routine-strong-builder/state.md:3-56`.

## Scope summary

Per-set normalization refactor of the routine layer. A new `public.routine_exercise_sets` table (cascade-FK'd to `routine_exercises`, soft-delete columns, partial-unique on `(routine_exercise_id, set_number)`) carries per-set targets; `routine_exercises.target_sets / target_reps / target_weight` are backfilled in the same migration then dropped. The routine builder screen is rebuilt as an expandable per-exercise card with explicit set rows + add buttons. Session-create (entered from `<RoutineListItem>` Start) gains a bulk-seed step that copies the routine's per-set config into `sets` rows with `completed_at = null`, so the live workout shows unchecked drafts. The four `target_*` blast-radius sites are tight: 4 production files plus `docs/data-model.md`. `target_rest_seconds` is untouched (still consumed at `app/(app)/workout/[sessionId].tsx:118-127` for the rest-timer auto-start).

## Affected files (verified)

### Schema / migration

- `src/db/schema.ts:88-115` — Drizzle `routineExercises` table. `targetSets / targetReps / targetWeight` columns (lines 102-104) must be dropped. The inline comment at 111-114 (partial-unique on `(routine_id, position)` lives in 0012, no Drizzle builder support) is precedent for "SQL is source of truth, schema.ts has a comment". Same convention applies to the new `routineExerciseSets` table's partial-unique.
- `src/db/schema.ts:139-185` — `sets` table reference shape that `routine_exercise_sets` will mirror in slimmed form: `set_number integer NOT NULL`, `set_type text` with `CHECK ('warmup','working','dropset')` (line 175-178), `parent_set_id uuid` self-FK with `ON DELETE set null` (line 170-174), and the dropset/parent invariant CHECK at 179-183. Reuse these contracts verbatim where applicable.
- `src/db/types.ts:115-129` — `RoutineExerciseRow` PostgREST type. `target_sets / target_reps / target_weight` (lines 121-123) must be removed. `RoutineExerciseTargets` shrinks to `{ target_rest_seconds?, notes? }`. Add new `RoutineExerciseSetRow` type next to this (matches snake_case PostgREST output, mirrors `SetRow:145-161`).
- `supabase/migrations/0000_schema.sql:13-27` — original `routine_exercises` DDL with the three columns. Historical — migration 0013 will DROP them via ALTER TABLE; never edit 0000.
- `supabase/migrations/0001_rls_and_seed.sql:7-44` — the RLS-policy loop array at lines 20-23. **Verified fact**: the new table `routine_exercise_sets` is NOT covered by this loop (the loop is static; only re-runs would touch it, and Supabase migrations are not idempotent against historical files). The new migration must inline the 4 policies for `routine_exercise_sets`, following the `0010_exercise_notes.sql:49-67` precedent (also not in the loop).
- `supabase/migrations/0001_rls_and_seed.sql:104-130` — `touch_updated_at()` reusable function (lines 104-112) and the per-table trigger loop (114-130). **Verified fact (precedent)**: `0005_measurements.sql:92-96` and `0010_exercise_notes.sql:70-73` both `drop trigger if exists … create trigger … execute function public.touch_updated_at()` against the new table. The function is created once in 0001; migration 0013 reuses it without redefining.
- `supabase/migrations/0008_sets_unique_set_number.sql:15-17` — closest precedent for a partial-unique on `(parent_id, set_number) WHERE deleted_at IS NULL`. Verbatim shape for `routine_exercise_sets`.
- `supabase/migrations/0010_exercise_notes.sql:1-74` — closest precedent for a brand-new table migration: table + composite read index + partial-unique + 4 inline RLS policies + `touch_updated_at` trigger, end-to-end in one file with section-header comments.
- `supabase/migrations/0012_routine_exercises_unique_partial.sql:1-25` — confirmed on disk (verified with `ls` + `head`). Comment header is the canonical "partial-unique on (..., position) WHERE deleted_at IS NULL" precedent. **Already pushed to remote per state.md**.
- `supabase/migrations/0011_canonical_exercises.sql:1-66` — precedent for `CREATE OR REPLACE FUNCTION public.seed_new_user()` rewrites and policy-replacement-in-place. Not directly needed (no seed_new_user touch), but the structural shape (single-file transaction, numbered section headers) is the migration template.
- **Next migration number**: `0013` (verified via `ls supabase/migrations/` — highest is 0012).

### API layer (this feature)

- `src/api/routine-exercises.ts:1-123` — entire file is in scope.
  - Lines 4-12 — `RoutineExerciseTargets` type shrinks to `{ target_rest_seconds?, notes? }`. Callers (lines 53-58 inside `addExerciseToRoutine`, 72-77 inside `updateRoutineExercise`) follow.
  - Lines 27-64 — `addExerciseToRoutine`: drop the three target columns from the INSERT payload.
  - Lines 66-84 — `updateRoutineExercise`: drop the three target columns from the UPDATE payload.
  - Lines 99-123 — `reorderRoutineExercises` two-step swap (park at `-(i+1)` then write final positions). **Designer reuses this verbatim** for the new `reorderRoutineExerciseSets` against `(routine_exercise_id, set_number)` partial-unique.
- `src/api/routine-exercises.ts:14-25` — `listRoutineExercises` (with `exercise:exercises(*)` embed). For the builder screen, Designer may extend with a nested embed `routine_exercise_sets(*)` (or keep parallel) — Open Question OQ1.
- `src/api/sets.ts:58-96` — `logSet` "compute next set_number from `max(set_number) WHERE deleted_at IS NULL` + 1" pattern. Mirror exactly for `addRoutineExerciseSet`. Lines 78-92 show the INSERT payload structure including `completed_at: null` and `parent_set_id: ?? null`.
- `src/api/sets.ts:113-138` — `updateSet` tri-state semantics (key omitted = untouched; key=null = explicit clear; key=value = write). **The contract on the new `updateRoutineExerciseSet` MUST match this** — the codebase is already burned by inconsistent patch semantics (set-input no-op blur PATCH was the last fix at commit 77029d4).
- `src/api/sets.ts:206-212` — `softDeleteSet` (`update({ deleted_at: now() }).eq("id", id)`) — verbatim for `removeRoutineExerciseSet`.

### Hooks layer

- `src/hooks/use-routine-exercises.ts:1-58` — entire file template for the new `use-routine-exercise-sets.ts`. Note conventions:
  - `KEYS.list(routineId)` keyed at the routine level (line 13). For per-set sets, the prompt specifies key `["routine_exercise_sets", routineId]` (state.md:28) — single fetch, not N.
  - `useUpdateRoutineExercise` invalidates the parent list key (line 38). The new updateSet hook should too.
  - Hook-key convention: kebab-cased prefix string (`"routine-exercises"`) — the prompt-suggested `"routine_exercise_sets"` should be reconciled to `"routine-exercise-sets"` for consistency. Designer call (OQ2).
- `src/hooks/use-sets.ts:20-23, 44-54` — `KEYS.forSession(sessionId)` shape + `useLogSet` mutation invalidation surface (stats + progress). The new builder hooks do NOT touch `["stats"]` / `["progress"]` (those depend on `sets`, not `routine_exercise_sets`).
- `src/hooks/use-sessions.ts:43-52` — `useStartSession` flow. Today: `startSession` returns the row, `onSuccess` writes to `KEYS.active` + invalidates `KEYS.all`. The seed step must be threaded in here (or in a new sibling hook) — see "Session create flow" below.

### Session create flow (Start-from-routine pre-seed)

Trace verified by reading code, no inference:

1. **`<RoutineListItem>`** — `src/components/routine-list-item.tsx:32-49`. The outer `<Pressable>` calls `onPress` (the parent's `startFromRoutine` closure).
2. **`app/(app)/workout/index.tsx:51-65`** — `startFromRoutine`: calls `start.mutateAsync({ routine_id: r.id, name: r.name })`. The mutation resolves to the new `SessionRow`, then `router.replace(\`/(app)/workout/\${row.id}\`)`.
3. **`src/hooks/use-sessions.ts:43-52`** — `useStartSession` → `startSession`.
4. **`src/api/sessions.ts:38-60`** — `startSession`: INSERT into `sessions` with `started_at = now()`, returns the row via `.select().single()`. **Today this is the ONLY mutation that fires on Start.**
5. **`app/(app)/workout/[sessionId].tsx`** — live screen mount. `setsQ.data` is hydrated empty; the screen renders blocks for whatever routine_exercises (and ad-hoc additions) exist. **Verified fact**: there is no current seeding step; per state.md:13 this is intentional and changes here.

**Verified fact (showstopper risk negated)**: there is exactly ONE call site for `useStartSession` (`app/(app)/workout/index.tsx:22`). The seed step lives cleanly at the API or hook layer with one consumer.

**Idempotency surface** (state.md:37): the seed must not run twice if the user double-taps Start. The existing UI guard is the `hasActive` gate at `app/(app)/workout/index.tsx:36, 52-54` (re-tapping when `active.data` is set routes to the existing session, no new mutation). But that gate depends on `useActiveSession` having resolved before the press — Designer should specify a per-press in-flight guard (similar to the F22 `pickingId` pattern at `src/components/exercise-picker.tsx`, called out in `tests/e2e/routines-add-exercise-race.spec.ts:1-25`).

### UI surfaces

- **Routine builder screen** — `app/(app)/routines/[id]/index.tsx:1-277`. Today's screen:
  - Name + notes form (lines 144-179).
  - Exercises section header + Add button (lines 181-197).
  - **`<RoutineExerciseRow>` enumeration (lines 210-247)** — to be replaced by `<RoutineExerciseCard>` (or filename kept, body rewritten; Designer call).
  - `onChangeTargets` closure at lines 230-245 currently merges `entry.target_sets / target_reps / target_weight` with the patch. **Must be deleted** along with the columns.
  - Reorder/remove/add affordances at 217-229 + reorder via `useReorderRoutineExercises` stay as-is.
- **`<RoutineExerciseRow>`** — `src/components/routine-exercise-row.tsx:1-189`. Entire file replaced. The four-field grid at lines 110-151 (Sets / Reps / Weight / Rest) collapses to a per-set list + a single Rest field at card level. The `<TargetField>` inner component (lines 165-188) is the reusable input pattern for set-row fields.
- **`<ExerciseBlock>`** — `src/components/exercise-block.tsx:1-327`. Live workout block. **Designer must NOT change this** — it consumes `sets` from `setsByExercise` (`app/(app)/workout/[sessionId].tsx:264-272`), which post-seed will include the unchecked drafts identically to today's behavior. The block already renders unchecked rows with placeholder values via `previousByRowId` (lines 120-136). The "+ Working set / + Warm-up / + Drop set" buttons (lines 271-321) and the dropset parent wiring (`lastWorkingSet` walk at lines 104-110, `parent_set_id: lastWorkingSet.id` at line 309) are the terminology the builder card should mirror.
- **Live workout screen** — `app/(app)/workout/[sessionId].tsx:118-127`. The ONLY consumer of `re.target_rest_seconds`. **Verified by grep**: `grep -rn "target_rest_seconds" --include="*.ts" --include="*.tsx"` returns exactly two production sites — this block and `src/components/routine-exercise-row.tsx:18,47,54-55,146` (the builder's "Rest (s)" input). The e2e tests `rest-timer-auto-start.spec.ts` and `auto-fill-placeholder-on-check.spec.ts` admin-insert `target_rest_seconds` directly. **Conclusion: target_rest_seconds is safe to keep on `routine_exercises`** — no other code touches it.

### Tests

- `tests/rls.test.ts:1-204` — two-user RLS smoke. **Must gain an arm** for `routine_exercise_sets` SELECT/INSERT/UPDATE/DELETE (mirror the existing `routine_exercises` block; precedent for adding a new arm is the canonical-exercises run discovery referenced above).
- `tests/e2e/rest-timer-auto-start.spec.ts:71-117` — admin-seed pattern for `routine_exercises` (insert with `target_rest_seconds`, `position`). The Tester for this feature will extend with `routine_exercise_sets` inserts in the same shape. Note: this spec writes `target_rest_seconds` only — no `target_sets / target_reps / target_weight` — so dropping those columns does NOT break this spec.
- `tests/e2e/auto-fill-placeholder-on-check.spec.ts:106-122` — same shape as above; same conclusion. **No change required.**
- `tests/e2e/routines-add-exercise-race.spec.ts:1-188` — picker race spec. Doesn't touch the dropped columns. **No change required.**
- `tests/e2e/_helpers/canonical-exercise.ts:34-60` — `pickCanonicalExercise(admin, preferred)` helper. The new e2e test for this feature uses it for the seed exercise(s) — same convention.
- `tests/seed-and-auth.test.ts` — exists but not relevant; the trigger doesn't touch `routine_exercises`.

### Docs

- `docs/data-model.md:32-44` — `routine_exercises` schema box lists `target_sets / target_reps / target_weight` (lines 38-40). **Must be updated** to remove those lines and to add a `routine_exercise_sets` block. Decision 9 (`docs/decisions.md:173-194`) on `queryCacheBuster` applies here — see "queryCacheBuster bump" below.
- `docs/iphone-shakedown.md:22` — row 4 of the checklist says "target sets/reps/weight/rest". Cosmetic update (the new flow is per-set, not target-sets). Designer can defer to Implementer.

## Relevant conventions (verified by reading code)

### Schema

- **One source of truth**: Drizzle in `src/db/schema.ts`, generated DDL in `supabase/migrations/0000_schema.sql`, hand-written feature migrations in `0001+`. Partial-unique indexes, expression indexes, and CHECK constraints that don't fit Drizzle 0.38's typed builders are documented as a `// SQL is source of truth` code comment with a file:line pointer (e.g. `src/db/schema.ts:111-114`).
- **UUID PKs everywhere** with `default(sql\`gen_random_uuid()\`)`. Confirmed at `src/db/schema.ts:48, 75, 91, 120, 142, …`.
- **`user_id` is denormalized** on every user-owned table for uniform RLS — see `docs/data-model.md:84-85` and Decision 4 (`docs/decisions.md:88-89`). `routine_exercise_sets` is reachable via `routine_exercise_id → routine_id → routines.user_id`, but **Designer must include `user_id uuid NOT NULL FK auth.users(id) ON DELETE CASCADE`** anyway to keep the RLS policy `auth.uid() = user_id` shape consistent. **Verified fact**: every user-owned table in the repo carries this column (`routine_exercises:92-94`, `sets:143-145`, `exercise_notes:227-229`, `measurement_entries:191-193`).
- **`timestamps`** mixin in `src/db/schema.ts:22-30` (created_at, updated_at, deleted_at) — soft-delete + auto-touch-updated-at. Apply to the new table.
- **FK ON DELETE conventions**: `user_id` cascades, `exercise_id` restricts (to preserve history), `routine_id` cascades, `session_id` cascades, parent self-FKs in `sets` use `set null` (line 173 `name: "sets_parent_set_id_fk"`). For `routine_exercise_sets`: `routine_exercise_id` should cascade (the prompt says so, state.md:19); `parent_set_id` self-FK should mirror sets — `set null` to allow soft-delete of a parent without orphan invariant failures (Designer should re-confirm under the CHECK constraint — see Unknowns U2).

### RLS

- Standard 4-policy pattern (`docs/data-model.md:108-113`): SELECT/INSERT/UPDATE/DELETE gated on `auth.uid() = user_id`. Inlined as four explicit statements per `0010_exercise_notes.sql:49-67` (the loop in `0001_rls_and_seed.sql:25-44` is for tables present at bootstrap only; new tables get inline policies).
- `routine_exercise_sets` follows the same pattern. The `auth.uid() = user_id` predicate is sufficient because the `user_id` column is denormalized on every row.
- **`tests/rls.test.ts` is the gate**. Per `docs/development.md:49-61`, "Run this before merging any change that touches RLS or schema."

### Soft-delete

- Every list query filters `.is("deleted_at", null)`. **Verified by grep** across `src/api/*.ts` — 23 occurrences in `routine-exercises.ts` + `sets.ts`.
- Soft-delete writes: `update({ deleted_at: new Date().toISOString() })`.
- Embedded reads against `sessions!inner` MUST also filter `sessions.deleted_at` via dotted path — see `docs/data-model.md:196-213`. Not directly applicable here (the new table is parented to `routine_exercises`, not `sessions`).

### Partial-unique on (parent_id, ordinal) WHERE deleted_at IS NULL

- Three precedents: `sets_session_exercise_set_number_unique` (`0008:15-17`), `exercise_notes_user_exercise_active_uq` (`0010:45-47`), `routine_exercises_routine_position_uq` (`0012:22-24`). All share the same shape: `WHERE deleted_at IS NULL` excludes soft-deleted rows so re-insertion at the same ordinal after a soft-delete works. Mirror this for `routine_exercise_sets_set_number_uq` on `(routine_exercise_id, set_number)`.
- **Implication for `addSet`**: read `MAX(set_number) WHERE deleted_at IS NULL` then `+ 1`. Identical to `src/api/sets.ts:63-73` and `routine-exercises.ts:36-45`.

### Reorder two-step swap

- `src/api/routine-exercises.ts:99-123` — park rows at `-(i + 1)` first (negatives are valid integers, can't collide with the 0..N positive range), then write final 0..N positions. **Verbatim reuse** for `reorderRoutineExerciseSets`. The negative-stage approach is necessary because a single-pass UPDATE through 1→2, 2→1 would trip the partial-unique mid-statement.

### Hook keys

- TanStack Query keys are kebab-case strings at the prefix (`"routine-exercises"`, `"sets"`, `"exercise-notes"`, `"sessions"`). The state.md suggested `["routine_exercise_sets", routineId]` — recommend `["routine-exercise-sets", routineId]` for consistency. Mutations invalidate the parent's list key at `onSuccess`.

### Tri-state patch semantics

- `src/api/sets.ts:14-31, 113-138` — formalized contract: key omitted = untouched, key=null = explicit clear, key=value = write. Empty patches short-circuit and return `null`; hooks skip cache invalidation on `null`. **This pattern is binding** — burning the codebase recently was the `set-input` no-op blur PATCH (commit `77029d4`). The new `updateRoutineExerciseSet` must follow the same contract verbatim.

### NativeWind / UI conventions

- `border-b border-gray-100 ... dark:border-gray-900 dark:bg-black` separator rows (precedent `routine-exercise-row.tsx:60`).
- `bg-black ... dark:bg-white` primary action; `border border-gray-300 ... dark:border-gray-700` secondary; `text-red-500` destructive icons (Trash2).
- Up/down arrow reorder (`ChevronUp`/`ChevronDown` icons, `opacity-30` disabled on first/last) — `routine-exercise-row.tsx:81-98`, mirrored by `exercise-block.tsx:181-201`.
- Tap-to-edit fields use `TextInput` with `onBlur` + `onSubmitEditing` committing — see `routine-exercise-row.tsx:176-185`.
- Live workout terminology for set types: "Working set" / "Warm-up" / "Drop set" (`exercise-block.tsx:277, 303, 317-319`). Builder buttons should mirror this exactly.

### queryCacheBuster bump

- `src/lib/query-client.ts:27` — current value `"schema-2026-05-25-canonical-exercises"`. Per `docs/decisions.md:173-194` (Decision 9), bump on any schema change that adds, renames, or removes a column read by a persisted query. **This run qualifies**: `target_sets / target_reps / target_weight` are read by `<RoutineExerciseRow>` from a persisted `["routine-exercises", routineId]` query. **My recommendation**: bump to e.g. `"schema-2026-05-26-routine-sets"`. Naming convention from Decision 9: `schema-YYYY-MM-DD-<short-slug>`. Designer should confirm and Implementer should land it in the same commit as the migration.

## Constraints

- **Data**:
  - New table `routine_exercise_sets` on the user-owned RLS plane: `id uuid PK`, `user_id uuid NOT NULL FK auth.users(id) ON DELETE CASCADE`, `routine_exercise_id uuid NOT NULL FK routine_exercises(id) ON DELETE CASCADE`, `set_number integer NOT NULL`, `set_type text NOT NULL CHECK ('warmup','working','dropset')`, `target_reps integer`, `target_weight numeric(6,2)`, `parent_set_id uuid` self-FK with `ON DELETE set null`, `notes text`, `created_at / updated_at / deleted_at timestamptz`.
  - The dropset/parent-type invariant CHECK from `sets:179-183` should be mirrored to keep the table family consistent: `(set_type = 'dropset' AND parent_set_id IS NOT NULL) OR (set_type IN ('warmup','working') AND parent_set_id IS NULL)`.
  - Backfill is forward-only inside the same migration: `INSERT INTO routine_exercise_sets (user_id, routine_exercise_id, set_number, set_type, target_reps, target_weight) SELECT user_id, id, generate_series(1, COALESCE(target_sets, 0)), 'working', target_reps, target_weight FROM routine_exercises WHERE deleted_at IS NULL AND COALESCE(target_sets, 0) > 0` — Designer's call on the exact SQL, but this is the shape implied by state.md:20.
  - The DROP COLUMN steps (`target_sets`, `target_reps`, `target_weight`) come after the backfill — verify the API/UI changes are atomic enough to not break read traffic mid-migration (Supabase migrations are single-file transactions — atomicity is automatic if all SQL is in one file).
  - `routine_id` cascade chain: routines → routine_exercises → routine_exercise_sets cascade is implicit via the ON DELETE CASCADE on `routine_exercise_id` (existing FK already cascades from routines to routine_exercises per `0000_schema.sql:81`).
- **UI**:
  - Builder card and live-block terminology MUST agree on "Working set / Warm-up / Drop set" (currently consistent — preserve it).
  - Reorder via up/down chevrons, NOT drag-and-drop (out of scope per state.md:55-56).
  - Soft-delete via trash icon on each set row (mirror existing routine-exercise-row.tsx:99-106).
- **Platform**: web is the primary surface (iPhone shakedown in `docs/iphone-shakedown.md` highlights row-4 routine builder issues but these are dev-friction notes, not blockers). The Tester runs Playwright (web) against an admin-seeded backend — no iOS-specific paths in the builder layer.
- **Auth**: every read/write uses the user JWT against PostgREST. The seed-on-Start step calls Supabase JS as the signed-in user (NOT service role), so RLS applies on the bulk INSERT — every `sets` row must carry `user_id = auth.uid()` explicitly (see `src/api/sets.ts:59-61` for the read-auth pattern).
- **Performance**:
  - Builder reads: single fetch keyed by routine — Designer should embed `routine_exercise_sets(*)` in `listRoutineExercises` (one PostgREST call) OR add a parallel `listRoutineExerciseSetsForRoutine(routineId)`. The state.md hint (line 28) is single-fetch.
  - Seed-on-start: a single multi-row INSERT for all `routine_exercise_sets → sets` mappings, NOT N calls. The dropset two-pass concern (state.md:46) means Designer must spec whether to (a) insert non-dropset first and capture IDs, then insert dropsets with mapped parents, or (b) use a SQL function / `RETURNING id` ladder.
  - The persisted query cache (TanStack) covers `["routine-exercises", routineId]` — bump `queryCacheBuster` per Decision 9 because the row shape changes.

## Existing precedents

- **`exercise_notes` migration** (`0010_exercise_notes.sql:1-74`): brand-new user-owned table with composite-read index + partial-unique on `WHERE deleted_at IS NULL` + 4 inline RLS policies + `touch_updated_at` trigger. **The closest structural precedent for the 0013 migration.**
- **`sets` table** (`schema.ts:139-185`): `set_type` enum-via-CHECK, `parent_set_id` self-FK with `set null`, dropset/parent invariant CHECK. **The closest semantic precedent for `routine_exercise_sets` column shape.**
- **`reorderRoutineExercises`** (`src/api/routine-exercises.ts:99-123`): two-step negative-staging swap for partial-unique reorder. **Verbatim reusable** for `reorderRoutineExerciseSets`.
- **`logSet` set_number computation** (`src/api/sets.ts:58-96`): `MAX(set_number) WHERE deleted_at IS NULL` + 1 then INSERT. **Verbatim reusable** for `addRoutineExerciseSet`.
- **`updateSet` tri-state semantics** (`src/api/sets.ts:14-31, 113-138`): JSDoc-documented patch contract with `null` short-circuit return. **Binding for `updateRoutineExerciseSet`.**
- **`<ExerciseBlock>` add-set affordance** (`src/components/exercise-block.tsx:269-323`): "+ Working set" primary button + chevron-toggle exposing "+ Warm-up / + Drop set" + `isAddingSet` in-flight guard. **Terminology + interaction template for the builder card.**
- **`useStartSession`** (`src/hooks/use-sessions.ts:43-52`): single mutation, single consumer at `app/(app)/workout/index.tsx:22`. **Single insertion point for the seed step.**
- **Picker race fix** (`src/components/exercise-picker.tsx` + `tests/e2e/routines-add-exercise-race.spec.ts`): per-row `pickingId` in-flight guard. **Pattern for the Start-button double-tap idempotency** (state.md:47).

## Unknowns (require Designer judgment or human decision)

Format per Discovery feedback (`docs/feedback/discovery.md:20`): (a) what / (b) why / (c) recommended default.

### U1 — Dropset parent_set_id mapping on bulk-seed

(a) `routine_exercise_sets.parent_set_id` references another row in `routine_exercise_sets` (its parent's UUID). When we bulk-seed `sets` rows from a routine, every new `sets.id` is freshly generated; the child's `parent_set_id` must point to the new parent `sets.id`, not the old routine_exercise_sets.id.

(b) Without an explicit mapping, dropset children would either (i) reference the routine_exercise_set UUID (FK violation — that UUID isn't in `sets`) or (ii) be NULL (CHECK invariant violation: `set_type='dropset'` requires `parent_set_id IS NOT NULL` per the existing constraint at `sets:179-183`). Both abort the bulk insert.

(c) **Recommended default — two-pass insert**: (1) INSERT all non-dropset rows (`set_type IN ('working','warmup')`) in a single PostgREST call, RETURNING `id, routine_exercise_set_id` (requires temporarily carrying the source ID, which we can do via a parallel array passed to the API layer, not in the DB). (2) Build a Map from `routine_exercise_sets.id → sets.id` for the inserted rows. (3) INSERT all dropset rows with `parent_set_id` resolved via the Map. **This keeps the seed code in the API layer (JS), no SQL function needed.** Alternative: a Postgres function with two `INSERT … SELECT … RETURNING` blocks. The JS two-pass is more legible and respects the existing API/JS-side split (no Postgres function exists today for any feature). **Designer makes the final call.**

### U2 — `routine_exercise_sets.parent_set_id` ON DELETE behavior

(a) The self-FK on `parent_set_id`. The sets table uses `ON DELETE set null` (`sets:170-174`). But sets has the CHECK constraint that requires non-null parent_set_id for dropsets — so a hard-deleted parent leaving the child with NULL parent_set_id would violate the CHECK. The repo's actual delete pattern is soft-delete (`deleted_at = now()`), which the FK ignores — so the contradiction never fires in practice.

(b) For `routine_exercise_sets`, the same pattern applies: if Designer mirrors the dropset-parent CHECK, then `ON DELETE set null` is dead code; if Designer omits the CHECK, then ON DELETE set null wires up correctly.

(c) **Recommended default**: mirror the `sets` table exactly — both the CHECK constraint and the `ON DELETE set null` FK. Rationale: structural consistency with `sets`, and the contradiction is benign under the actual soft-delete pattern.

### U3 — Backfill correctness: NULL `target_sets` or null reps/weight

(a) State.md:45 flags this. Existing routine_exercises rows may have `target_sets = NULL` or `target_sets > 0` with `target_reps / target_weight = NULL`.

(b) NULL target_sets means the user added the exercise to a routine without specifying a target. The backfill `generate_series(1, COALESCE(target_sets, 0))` produces zero rows for these — the routine ends up with the exercise but no per-set config. The user must add sets manually on next open of the builder. **My take**: this is correct and matches the user's prior state (they had no config; they get no config).

(c) **Recommended default**: backfill `COALESCE(target_sets, 0)` rows per routine_exercise; emit `target_reps / target_weight` from the parent row even if NULL (the new columns are nullable). No special-case for null reps/weight — the user fills in on first edit. Migration is forward-only; no risk of data loss.

### U4 — Schema-as-code drift for the new table

(a) The Drizzle table definition in `src/db/schema.ts` requires a `routineExerciseSets` entry mirroring the SQL. Partial-unique can't be expressed in Drizzle 0.38; the CHECK constraints can.

(b) Per `docs/runs/2026-05-25_1921_canonical-exercises/transcript.md:47` (verified): the Drizzle snapshot in `meta/_journal.json` is "pre-existing stale at 0003 (0004-0011 hand-written without snapshot updates)". The Implementer adds an entry to schema.ts BUT does not regenerate via drizzle-kit (no guarantee 0013 would be generated correctly, and the project is on the "SQL is source of truth" track).

(c) **Recommended default**: Add `routineExerciseSets` to `src/db/schema.ts` matching the SQL columns, with the partial-unique encoded as a code comment pointing at the migration file (precedent at `schema.ts:111-114, 211-216, 244-251`). Add `RoutineExerciseSet`, `NewRoutineExerciseSet` to `src/db/types.ts` (InferSelect/Insert). Add `RoutineExerciseSetRow` snake_case PostgREST type. **Do NOT run `drizzle-kit generate`** — the snapshot is stale by 9 migrations and any regen would explode.

### U5 — Seed step location: API layer vs hook layer vs trigger

(a) The seed-on-Start step needs to fire after `startSession` resolves and before the user lands on the live screen. Three places to put it:
1. **API layer** — extend `startSession(input)` to take an optional `seedFromRoutineId` and do (i) insert session, (ii) read routine_exercise_sets, (iii) bulk insert sets, all sequentially in one JS function. Single PostgREST round-trip per step; not atomic across the three.
2. **Hook layer** — a new `useStartSessionFromRoutine` that composes `startSession` + a new `seedSetsFromRoutine`, with the mutation wrapping both. The current `useStartSession` stays for ad-hoc.
3. **DB trigger** — `AFTER INSERT ON sessions WHEN routine_id IS NOT NULL` fires a function that seeds. Single SQL transaction, atomic, but the trigger has access to `routine_exercise_sets` via the session's routine_id.

(b) The trigger path is the most idempotent + atomic but adds a new Postgres function — the codebase has only `seed_new_user()` and `touch_updated_at()`. The API/hook path is more visible and easier to test. The two-call-site question (Quick Start ad-hoc vs Start from routine) is already cleanly separated at `app/(app)/workout/index.tsx:38-65` so either approach is wiring-tolerant.

(c) **Recommended default — hook layer (option 2)**. Reasons: (i) keeps the seed visible in the TS layer where the Designer/Implementer can specify the dropset two-pass cleanly (U1's mapping); (ii) keeps the no-routine ad-hoc path unchanged (zero regression risk); (iii) gives a clean place to put the in-flight idempotency guard (mutation `isPending` flag); (iv) doesn't introduce a new Postgres function in a project that's been careful about that. Designer can override if they prefer the trigger path for atomicity reasons.

### U6 — Builder UI: card-state expansion + Reset/Save semantics

(a) The new per-exercise card is expandable (state.md:31). Open-by-default vs collapsed-by-default? Expand-on-add vs expand-on-tap? Does adding a set commit immediately to the server (Strong's behavior) or stage locally with a Save button (no precedent in this codebase)?

(b) The current `<RoutineExerciseRow>` commits each target field on blur (`routine-exercise-row.tsx:179-180`) — no Save button. This matches the rest of the routine builder ("Save details" only covers name+notes; the iPhone shakedown notes this is confusing on web — `docs/iphone-shakedown.md:56`). Inheriting blur-commit per set is consistent.

(c) **Recommended default**: Commit each set add/edit/remove immediately on the action (no Save button at card level). Match the existing routine builder semantics. Card expansion: open-by-default on mount (so the user sees their sets immediately), tap header to collapse. Designer call on whether to persist expansion state per session (recommend: no, ephemeral).

### U7 — Position semantics for warmup/dropset inside `routine_exercise_sets`

(a) Within one routine_exercise, set_number 1..N is monotonic. But warmups conventionally precede working sets, and dropsets conventionally follow their parent working set. Does the builder enforce ordering by set_type (warmups → working → dropsets), or is set_number the single source of order?

(b) The `sets` table uses set_number as the single source of order — `src/api/sets.ts:48-53` and the recent commit `5190a58` made set_number stable to fix the "checked sets bubble" bug. Mirroring that contract means the builder card lists rows by set_number ASC regardless of set_type. Dropsets at the bottom of a working set's chain naturally have a higher set_number because they're added later. The dropset/parent invariant is via `parent_set_id`, not position.

(c) **Recommended default**: set_number is the single source of order, same as `sets`. UI affordances: "+ Working set" appends; "+ Warm-up" appends (user can reorder via chevrons); "+ Drop set" appends + sets parent_set_id to the last working set in the card (mirror `exercise-block.tsx:104-110`). No enforced ordering by set_type. Designer call.

## Reusable patterns (verbatim copy-paste material for Designer)

### Migration boilerplate (mirror 0010_exercise_notes.sql)

```sql
-- =============================================================================
-- 0013_routine_exercise_sets.sql
-- Hand-written. Adds normalized per-set targets to routines.
--
-- Order of operations:
--   1. Create routine_exercise_sets (UUID, FKs, soft-delete columns).
--   2. Composite read index (routine_exercise_id, set_number).
--   3. Partial UNIQUE index (routine_exercise_id, set_number) WHERE deleted_at IS NULL.
--   4. Enable RLS + 4 inlined policies gated on auth.uid() = user_id.
--   5. Apply touch_updated_at trigger.
--   6. Backfill from routine_exercises.target_sets / target_reps / target_weight.
--   7. ALTER TABLE routine_exercises DROP COLUMN target_sets, target_reps, target_weight.
-- =============================================================================
```

### RLS 4-policy block (mirror 0010_exercise_notes.sql:49-67)

```sql
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
```

### Partial unique on (parent_id, ordinal) WHERE deleted_at IS NULL (mirror 0008:15-17)

```sql
create unique index routine_exercise_sets_set_number_uq
  on public.routine_exercise_sets (routine_exercise_id, set_number)
  where deleted_at is null;
```

### touch_updated_at trigger wiring (mirror 0010:70-73)

```sql
drop trigger if exists routine_exercise_sets_touch_updated_at on public.routine_exercise_sets;
create trigger routine_exercise_sets_touch_updated_at
  before update on public.routine_exercise_sets
  for each row execute function public.touch_updated_at();
```

### Two-step reorder swap (verbatim from src/api/routine-exercises.ts:99-123, adapted)

```ts
export async function reorderRoutineExerciseSets(
  routineExerciseId: string,
  orderedIds: string[],
): Promise<void> {
  // Step 1: park each row at -(idx + 1) so no two rows collide on the partial-unique idx.
  for (let i = 0; i < orderedIds.length; i++) {
    const id = orderedIds[i]!;
    const { error } = await supabase
      .from("routine_exercise_sets")
      .update({ set_number: -(i + 1) })
      .eq("id", id)
      .eq("routine_exercise_id", routineExerciseId);
    if (error) throw error;
  }
  // Step 2: write final positions.
  for (let i = 0; i < orderedIds.length; i++) {
    const id = orderedIds[i]!;
    const { error } = await supabase
      .from("routine_exercise_sets")
      .update({ set_number: i + 1 })
      .eq("id", id)
      .eq("routine_exercise_id", routineExerciseId);
    if (error) throw error;
  }
}
```

Note: `set_number` in `routine_exercise_sets` should be 1-indexed (matches `sets` convention at `logSet:73`). Adjust the final-positions step accordingly.

### Compute next set_number (mirror src/api/sets.ts:63-73)

```ts
const { data: existing } = await supabase
  .from("routine_exercise_sets")
  .select("set_number")
  .eq("routine_exercise_id", routineExerciseId)
  .is("deleted_at", null)
  .order("set_number", { ascending: false })
  .limit(1);
const nextNumber = (existing?.[0]?.set_number ?? 0) + 1;
```

### Hook template (mirror src/hooks/use-routine-exercises.ts:1-58)

```ts
const KEYS = {
  list: (routineId: string) => ["routine-exercise-sets", routineId] as const,
};

export function useRoutineExerciseSets(routineId: string | undefined) {
  return useQuery({
    queryKey: routineId ? KEYS.list(routineId) : ["routine-exercise-sets", "none"],
    queryFn: () => listRoutineExerciseSetsForRoutine(routineId as string),
    enabled: Boolean(routineId),
  });
}

// + useAddRoutineExerciseSet, useUpdateRoutineExerciseSet, useRemoveRoutineExerciseSet,
//   useReorderRoutineExerciseSets — all invalidate KEYS.list(routineId) on success.
```

## Out-of-scope flags

(Echo state.md:51-56, verified against the prompt:)

- **Per-set RPE input** in v1. The `sets` table has an `rpe` column but `routine_exercise_sets` does NOT in v1. User decision.
- **Per-set notes**. Use the existing per-(user, exercise) `exercise_notes` table for cues. State.md:54.
- **Set-type reordering across boundaries** (e.g. moving a warmup to between two working sets). Up/down chevrons within the card still work — they reorder by set_number — but the UX shouldn't enforce or visually break warmup/working/dropset clustering.
- **Drag-and-drop reordering**. Up/down chevrons only, matching the existing routine_exercises and exercise-block reorder pattern.

Out-of-scope but worth flagging for the Designer:

- **Migration push happens at end-of-run** per playbook (state.md:49 + the Conductor's checklist). Discovery doesn't `npm run db:push`. The 0013 file lives on disk only after Implementer writes it.
- **No `app/(app)/workout/[sessionId].tsx` change** beyond the seed step plumbing — the live block already renders unchecked drafts correctly (`exercise-block.tsx:227-267`, `set-input` toggle logic). The pre-seed feature relies on this — Designer should NOT spec new live-screen behavior, only the seed path.
- **`docs/iphone-shakedown.md:22` row 4 wording** ("target sets/reps/weight/rest") is a doc nit — Implementer can update in passing. Not a Designer concern.
