# Final summary — 2026-05-26_0101_routine-strong-builder

## Outcome
- **Feature**: Strong-like routine builder with per-set targets (per-set weight/reps editing in the routine builder; sets pre-seeded into the live workout as unchecked drafts when starting from a routine)
- **Pipeline result**: shipped
- **Branch / final commit**: main / (working tree — pre-push)

## Metrics

| Metric | Value |
|---|---|
| Feature works end-to-end? | yes (7/7 e2e pass after Conductor `.first()` patch) |
| Human interventions during run | 1 (user pre-authorized full run + push at kickoff; no mid-run interventions) |
| Total round-trips (sum of all loops) | 5 (D↔V×2, I↔R×1, I↔T×2 + 1 Conductor patch) |
| Design ↔ Validate rounds | 2 (round 1 no-go: 3 MAJ + 8 MIN; round 2 go: 0/0/5 MIN) |
| Implement ↔ Review rounds | 1 (pass on first try) |
| Implement ↔ Test rounds | 2 + Conductor out-of-band test-only patch |
| Implementer soft-callbacks | 0 / 2 (none needed) |
| Wall-clock duration | 01:54 (01:01 → 02:55) |
| Token cost (if known) | n/a |

## Pipeline highlights

- **Design tightening across 2 D↔V rounds** prevented a silent-failure UX (MAJ-2 v1: log+proceed → hard-fail in v2) and a hidden runtime-assumption hole (MAJ-3 v1: natural-key relied on undeclared invariant → v2 adds partial-unique `(routine_id, exercise_id) WHERE deleted_at IS NULL` on `routine_exercises`).
- **Migration 0013** ships table + 4 RLS + partial-unique + trigger + backfill + DROP COLUMN as a single atomic transaction. Pushed to remote during I↔T round 1 (`0013 | 0013`).
- **Pre-seed at session-create** with canonical 6-step algorithm (no two-pass-vs-refinement ambiguity) and a JS two-pass dropset parent_set_id remap via `(exercise_id, set_number)` natural key.
- **Defense-in-depth on the routine_exercises picker**: new partial-unique + 23505-typed handler (`DuplicateRoutineExerciseError`) discriminator + UI picker filter via `excludeIds`.
- **Hard-fail seed policy**: mutation rejects; user stays on routines list; existing `console.warn("Start failed", err)` at `workout/index.tsx:62-64` fires; orphan session row remains salvageable in History (intentional — see design-v2).
- **`queryCacheBuster`** bumped to `"schema-2026-05-26-routine-sets"` per Decision 9 (clears persisted client cache after schema break).

## Test coverage delta

- **Unit**: +12 tests (376 / 376 pass).
- **E2E**: +7 specs, all pass after round-2 test fix + Conductor `.first()` patch (golden / dropset / idempotency / soft-delete-re-add / edit-then-restart / hard-fail seed / 23505 duplicate-exercise).
- **RLS arm**: User A insert → User B cannot SELECT/UPDATE/DELETE; INSERT-spoof rejected.
- **Migration**: `tests/migration-backfill.ts` admin-inserts post-migration rows to verify the new constraint matrix.

## Why we stopped
- Shipped. No escalation.

## Notable conductor decisions
1. **Conductor out-of-band `.first()` patch** at `tests/e2e/routine-strong-builder.spec.ts:376` after Tester returned budget-exhausted with that exact recipe. Authorized by user's "keep going + push everything" pre-authorization. Documented in `test-report-v2-conductor-patch.md` and `transcript.md`.

## Artifacts
- `state.md`
- `discovery.md`
- `design-v1.md`, `design-v2.md`
- `validation-v1.md`, `validation-v2.md`
- `implementation.md` (with round-2 fix section)
- `review-v1.md`
- `test-report-v1.md` (initial fail), `test-report-v2.md` (budget-exhausted), `test-report-v2-conductor-patch.md` (final pass)
- `transcript.md`
- `screenshots/` (3 golden screenshots pinned by Tester)

## Bugs found post-merge
- (none yet — owner updates this section as bugs surface)

## Archive
- Archived to vault: pending finalization

## Files shipped (15)

**New (8)**:
- `supabase/migrations/0013_routine_exercise_sets.sql`
- `src/api/routine-exercise-sets.ts`
- `src/hooks/use-routine-exercise-sets.ts`
- `src/components/routine-exercise-card.tsx`
- `tests/e2e/routine-strong-builder.spec.ts`
- `tests/migration-backfill.ts`
- (plus 2 unit-test files; see implementation.md)

**Edited (7)**:
- `src/db/schema.ts` (added `routineExerciseSets` table; trimmed dropped columns from `routineExercises`)
- `src/api/routine-exercises.ts` (typed 23505 handler; `DuplicateRoutineExerciseError`)
- `src/hooks/use-sessions.ts` (`useStartSessionFromRoutine` with hard-fail seed composition)
- `src/components/routine-list-item.tsx` (`pending` prop wiring)
- `app/(app)/workout/index.tsx` (pendingRoutineId in-flight guard)
- `package.json` (`test:migration` npm script)
- `docs/data-model.md` (new shape documented)

**Deleted (1)**:
- `src/components/routine-exercise-row.tsx` (replaced by `<RoutineExerciseCard>`)
