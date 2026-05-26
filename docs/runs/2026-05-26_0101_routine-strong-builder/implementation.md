# Implementation — 2026-05-26_0101_routine-strong-builder

Based on: `design-v2.md` (approved) and `validation-v2.md` (`go`, 5 cheap minors).

## Files changed

### New
- `supabase/migrations/0013_routine_exercise_sets.sql` (new) — DDL + RLS + composite read index + partial-unique on `(routine_exercise_id, set_number)` + new partial-unique on `routine_exercises(routine_id, exercise_id)` + `touch_updated_at` trigger + backfill + DROP COLUMN. Single transaction.
- `src/api/routine-exercise-sets.ts` (new) — `listForRoutine`, `listForRoutineExercise`, `addRoutineExerciseSet`, `updateRoutineExerciseSet` (tri-state), `removeRoutineExerciseSet`, `reorderRoutineExerciseSets` (two-step swap), `seedSetsForSession` (single canonical algorithm, hard-fail).
- `src/hooks/use-routine-exercise-sets.ts` (new) — TanStack hooks keyed at `["routine-exercise-sets", routineId]`. `useUpdateRoutineExerciseSet.onSuccess` skips invalidation on `null` result (matches `useUpdateSet`).
- `src/components/routine-exercise-card.tsx` (new) — Expandable card per exercise, per-set rows with weight/reps inputs + set-type label, footer with `+ Working set` / `+ Warm-up` / `+ Drop set`, per-exercise rest input. Owns the confirm-delete predicate. Replaces `<RoutineExerciseRow>`.
- `tests/migration-backfill.ts` (new) — `main()`-style script. Pre-flight duplicate-detection assertion (no active `(routine_id, exercise_id)` dupes) + backfill-shape correctness (3 / 0 / 2-with-null-reps-weight / soft-deleted-parent). Run via `npm run test:migration`.
- `tests/unit/routine-exercise-sets.test.ts` (new) — 12 cases covering add/update tri-state/reorder + 5 cases of `seedSetsForSession` (idempotency, dropset two-pass remap, orphan-dropset graceful fallback, NULL forward, per-exercise set_number monotonicity).
- `tests/e2e/routine-strong-builder.spec.ts` (new) — 7 cases: golden, dropset, idempotency, soft-delete-re-add, edit-then-restart, seed-failure hard-fail (route fulfill 500), duplicate-exercise 23505.

### Edited
- `src/db/schema.ts` — drop `targetSets`/`targetReps`/`targetWeight` from `routineExercises`; add `routineExerciseSets` table (UUID PK, FKs, set fields, both `check()` builders verbatim from `sets` precedent at `schema.ts:175-183`); footer comment in `routineExercises` block pointing at 0013 for both partial-uniques.
- `src/db/types.ts` — remove three columns from `RoutineExerciseRow`; add `RoutineExerciseSet`/`NewRoutineExerciseSet` (Drizzle inferred) + `RoutineExerciseSetRow` (snake_case PostgREST). No `RoutineExerciseSetEntry` (MIN-1 pinned).
- `src/api/routine-exercises.ts` — shrink `RoutineExerciseTargets` to `{ target_rest_seconds?, notes? }`; drop the three columns from INSERT/UPDATE payloads; **add `DuplicateRoutineExerciseError` class + 23505 discriminator on `addExerciseToRoutine` for `routine_exercises_routine_exercise_uq`**. Modeled on `src/api/measurements.ts:33-53` typed-23505 precedent (per MIN-NEW-2).
- `src/hooks/use-sessions.ts` — add `useStartSessionFromRoutine` composing `startSession` + `seedSetsForSession`. No try/catch around the seed call (MAJ-2 hard-fail). `onSuccess` writes to `KEYS.active`, invalidates `KEYS.all` + `["sets", row.id]`.
- `src/components/routine-list-item.tsx` — add `pending?: boolean` prop, OR'd with `disabled` for the visual treatment (same opacity, no new tokens; MIN-5 pinned).
- `app/(app)/workout/index.tsx` — switch `startFromRoutine` to `useStartSessionFromRoutine`; per-routine `pendingRoutineId` state guard (mirrors `pickingId` at `exercise-picker.tsx:32`). Forward `pending={pendingRoutineId === item.id}` to `<RoutineListItem>`. Existing `catch (err) { console.warn("Start failed", err); }` handles the hard-fail path; no extra UI surface added.
- `app/(app)/routines/[id]/index.tsx` — swap `<RoutineExerciseRow>` for `<RoutineExerciseCard>`. Wire the new per-set hooks (`useAddRoutineExerciseSet`, `useUpdateRoutineExerciseSet`, `useRemoveRoutineExerciseSet`, `useReorderRoutineExerciseSets`). Group sets by `routine_exercise_id` for O(1) per-card lookup. `onChangeTargets` closure removed; replaced with `onChangeRest` that only forwards the rest field.
- `src/lib/query-client.ts` — bump `queryCacheBuster` to `"schema-2026-05-26-routine-sets"` (Decision 9).
- `docs/data-model.md` — drop three columns from `routine_exercises` block; add `routine_exercise_sets` block; document both partial-uniques on `routine_exercises`.
- `tests/rls.test.ts` — append `routine_exercise_sets` arm (SELECT/UPDATE/DELETE/INSERT-spoof). Mirrors the `exercise_notes` arm shape.
- `package.json` — add `"test:migration": "tsx tests/migration-backfill.ts"` script (per MIN-NEW-1 — design's `npm test` invocation was wrong; the codebase precedent for `tests/rls.test.ts` and `tests/seed-and-auth.test.ts` is `npx tsx <file>`).

### Deleted
- `src/components/routine-exercise-row.tsx` — replaced by `routine-exercise-card.tsx`.

## Deviations from design

1. **MIN-NEW-1 doc-script mismatch — resolved by adding `test:migration` npm script.** Design v2 referenced `npm test ... tests/migration-backfill.ts` as the invocation; `package.json` has no `test` script and the codebase precedent for stub `main()`-style scripts (`rls.test.ts`, `seed-and-auth.test.ts`) is `npx tsx <file>`. Added `"test:migration": "tsx tests/migration-backfill.ts"`. The Validator flagged this explicitly; documenting here for completeness.

2. **MIN-NEW-2 prose inaccuracy — implemented per the validator's recommended precedent.** Design v2 said `addExerciseToRoutine` had an "existing 23505 handler" — it did not (raw read confirmed `src/api/routine-exercises.ts:27-64` pre-edit had zero 23505 logic). The implementation follows the typed-23505 discriminator precedent at `src/api/measurements.ts:50` and `src/api/exercise-notes.ts:91-92`: a `DuplicateRoutineExerciseError` class with a `readonly code = "ROUTINE_EXERCISE_DUPLICATE" as const` discriminator + an `isDuplicateRoutineExerciseConstraint` helper that matches `error.code === "23505" && message.includes("routine_exercises_routine_exercise_uq")`. The picker UI already filters duplicates via `excludeIds` (defense-in-depth — no UI re-wire needed for the typed error in v1).

3. **`NewSetPayload` shadow type inside `seedSetsForSession`.** Design v2 referenced `NewSet` (Drizzle's `InferInsertModel<typeof sets>`) for the seed's row arrays. Drizzle's inferred type is camelCase (`userId`, `sessionId`, ...) but the seed builds rows for `supabase.from("sets").insert(...)`, which expects snake_case. I introduced a local `NewSetPayload` snake-case type alias in `src/api/routine-exercise-sets.ts:5-19` to match the PostgREST insert contract. Typecheck-driven discovery; no semantic change.

4. **Hook-key invalidation surface in `useStartSessionFromRoutine.onSuccess`.** Design v2 snippet had `qc.invalidateQueries({ queryKey: ["sets", row.id] })`. Adopted as-is. The actual `["sets", sessionId]` key shape at `use-sets.ts:21` is `KEYS.forSession(sessionId) = ["sets", sessionId]`, so this is a valid prefix-match invalidation and the live screen's `setsQ` refetches.

5. **MIN-NEW-3 prose loose — picked `useState`, matching the snippet.** The design's prose at line 56 said "ref" but the code block at line 514 used `useState`. I used `useState` to match the picker precedent and the code block.

6. **MIN-NEW-5 SQL casing — house style was uppercase keywords, kept.** The two `check()` blocks I added to `routineExerciseSets` use `IN ('warmup','working','dropset')` and `IS NOT NULL` (uppercase) to match the `sets` precedent at `schema.ts:175-183`.

7. **Backfill duplicate-detection scoped to test DB.** Per MIN-NEW-4, the design's "snapshot of production DB" wording is hand-wavy. The script in `tests/migration-backfill.ts` queries the live test DB at run time (whichever DB `EXPO_PUBLIC_SUPABASE_URL` points at). Production rollout requires the Implementer to run the same query against production via service-role admin client and soft-delete any duplicates before `npm run db:push`. Documented in the script's header comment.

## Soft callbacks made (during this implementation pass)

- None. (0 / 2 used.)

## Quality gates

- [x] `npm run typecheck` passed — 0 errors.

  Tail:
  ```
  > tsc --noEmit
  (clean)
  ```

- [x] `npm run lint` passed — 0 errors, 1 pre-existing warning in auto-generated `.expo/types/router.d.ts` (same as last run; unrelated to this diff).

  Tail:
  ```
  ESLint: 0 errors, 1 warnings in 1 files
  Top files:
    router.d.ts (1 issues)
  ```

- [x] `npm run test:unit` passed — 376 tests, 24 files (was 364 / 23 pre-run; +12 new from `tests/unit/routine-exercise-sets.test.ts`).

  Tail:
  ```
   ✓ tests/unit/routine-exercise-sets.test.ts (12 tests) 19ms
   ...
   Test Files  24 passed (24)
        Tests  376 passed (376)
     Duration  1.98s
  ```

- [x] No new `any`.
- [x] No new `// @ts-ignore`.
- [x] No stray `console.log` — only the existing `console.warn("Start failed", err)` site at `app/(app)/workout/index.tsx` (load-bearing for MAJ-2 hard-fail logging) and other pre-existing `console.warn` failure-path sites.
- [x] No new `eslint-disable`.

## Notes for Reviewer

- **The migration is on disk only.** The Conductor handles `db:push` at end-of-run per playbook. Reviewer should NOT push the migration during code review.

- **The seed's dropset two-pass logic is the trickiest piece.** Three things to scrutinize in `src/api/routine-exercise-sets.ts:seedSetsForSession`:
  1. Step 3 builds `routineSetIdToNaturalKey` (the ONE map per MAJ-1) and the row arrays inline. The `setNumberByExercise` Map increments per `exercise_id` so the natural key `(exercise_id, set_number)` is provably monotonic-and-unique post-MAJ-3.
  2. Step 4 re-keys the inserted non-dropset rows by `(exercise_id, set_number)` since PostgREST `.insert([]).select()` does not guarantee return-order matches input order.
  3. Step 5 resolves each dropset via the two-map lookup; unresolvable dropsets are dropped silently (rather than aborting the whole seed with a CHECK violation).

- **The hard-fail policy leaves an orphan empty session.** The user can resume or delete it from History; no auto-prune in scope. Risk #8 documented this in the design.

- **`tests/migration-backfill.ts` is NOT auto-run by `npm run test:unit`** (it requires `.env.local` + a live test DB). Reviewer should treat it like `rls.test.ts` and `seed-and-auth.test.ts` — invoke manually before the migration push to validate pre-flight + post-backfill shape. CI wiring is a follow-up.

- **The e2e spec uses `[aria-label^="Start workout: ..."]` selectors** to find the routine row's tap target. The label format is "Start workout: <routine name>" from `RoutineListItem`'s existing `accessibilityLabel`.

- **`useStartSessionFromRoutine` is the only consumer of `seedSetsForSession`** — the ad-hoc `useStartSession` path is unchanged (zero regression risk on Quick Start workouts).

- **`<RoutineExerciseCard>` does not call `useLastWorkingSet` cross-session lookup** — only the live `<ExerciseBlock>` does. Dropset add in the builder chains onto the last working set _within the card_ (the same heuristic `<ExerciseBlock>` uses for the live screen). If there's no working set yet, the "+ Drop set" button is disabled.

## Notes for Tester

- E2E covers: golden, dropset, idempotency (double-tap), soft-delete-re-add, edit-then-restart, hard-fail (route fulfill 500), duplicate-exercise 23505.
- The `routines-add-exercise-race.spec.ts` e2e should still pass: the new partial-unique is strictly stricter without changing the success path, and the spec asserts "exactly +1 row" which holds whether the in-flight guard or the new DB unique wins.
- `rest-timer-auto-start.spec.ts` and `auto-fill-placeholder-on-check.spec.ts` admin-insert `target_rest_seconds` only and do not touch the dropped columns; no test-fixture migration needed.
- Conductor: `npm run db:push` at end-of-run will apply `0013_routine_exercise_sets.sql`. The pre-flight duplicate check in `tests/migration-backfill.ts` is the safety net — Implementer recommends running it BEFORE `db:push` to catch any production duplicate that would abort the migration.

## Round 2 (I↔T fix)

Per Tester's `test-report-v1.md` recipe — Test 1 (golden) failed asserting weight column shape. PostgREST returns `numeric` columns as JS `number`, not `"60.00"` strings. Single-line fix.

- **File**: `tests/e2e/routine-strong-builder.spec.ts:246`
- **Precedent**: `tests/e2e/auto-fill-placeholder-on-check.spec.ts:340` uses the same `Number(s.weight)` coercion pattern.

Before:
```ts
expect(sets?.map((s) => s.weight)).toEqual(["60.00", "70.00", "80.00"]);
```

After:
```ts
expect(sets?.map((s) => Number(s.weight))).toEqual([60, 70, 80]);
```

Gates re-run after edit: `npm run typecheck` (clean), `npm run lint` (0 errors, 1 pre-existing warning in `router.d.ts`), `npm run test:unit` (376/376 passing). E2E intentionally not re-run — that is Tester's job in round 2.
