# Review v1 — 2026-05-26_0101_routine-strong-builder

Reviewing: the diff for the implementation against `design-v2.md`.

## Diff scope

- Diff command: `git diff 77029d4cd609631877a5870b91dc16e4e1b7bf4c...HEAD` (working-tree, files untracked since baseline)
- New files (7): `supabase/migrations/0013_routine_exercise_sets.sql`, `src/api/routine-exercise-sets.ts`, `src/hooks/use-routine-exercise-sets.ts`, `src/components/routine-exercise-card.tsx`, `tests/migration-backfill.ts`, `tests/unit/routine-exercise-sets.test.ts`, `tests/e2e/routine-strong-builder.spec.ts`
- Edited files (8): `src/db/schema.ts`, `src/db/types.ts`, `src/api/routine-exercises.ts`, `src/hooks/use-sessions.ts`, `src/components/routine-list-item.tsx`, `app/(app)/routines/[id]/index.tsx`, `app/(app)/workout/index.tsx`, `src/lib/query-client.ts`, plus `tests/rls.test.ts`, `docs/data-model.md`, `package.json`
- Deleted: `src/components/routine-exercise-row.tsx`
- Sanity: `npm run typecheck` clean (single re-run by Reviewer)

## Verification of implementation.md claims

| Claim | Verified? | Notes |
|---|---|---|
| Migration: table + 4 RLS + composite read idx + partial-unique on `(routine_exercise_id, set_number)` + partial-unique on `routine_exercises(routine_id, exercise_id)` + trigger + backfill + DROP COLUMN | yes | `0013_routine_exercise_sets.sql:19-123` — order matches design step 1→8. Note: Supabase CLI wraps each migration in a single transaction (no precedent uses explicit BEGIN/COMMIT); atomicity property holds. |
| Backfill SQL uses `generate_series(1, COALESCE(target_sets, 0))` + `re.deleted_at IS NULL` + `target_sets > 0` | yes | `0013_routine_exercise_sets.sql:105-117` — verbatim. |
| `parent_set_id` self-FK ON DELETE set null, dropset CHECK invariant | yes | `0013_routine_exercise_sets.sql:36-45` + `schema.ts:251-264`. Both `check()` builder entries mirror `sets` precedent at `schema.ts:178-186`. |
| New partial-unique `(routine_id, exercise_id) WHERE deleted_at IS NULL` on `routine_exercises` | yes | `0013_routine_exercise_sets.sql:92-94`; schema-comment-only note at `schema.ts:106-117` (Drizzle 0.38 has no `.where()` on uniqueIndex — consistent with the 0012/0010/0008 pattern). |
| New `src/api/routine-exercise-sets.ts` with 7 exported fns including `seedSetsForSession` | yes | `routine-exercise-sets.ts:53-381`. |
| `seedSetsForSession` canonical 6-step algorithm | yes | `routine-exercise-sets.ts:228-380`. ONE `routineSetIdToNaturalKey` map (line 286), populated in step 3 (line 299). No `parentNaturalKeyByRoutineSetId` map. No "refinement" variant. Matches design-v2 lines 562-708 verbatim modulo `NewSetPayload` rename (justified deviation #3). |
| Hard-fail seed policy | yes | `use-sessions.ts:71-97` — no try/catch around `seedSetsForSession`. Caller `workout/index.tsx:60-83` catches and `console.warn`s; user stays on routines screen via `pendingRoutineId` reset. |
| 23505 typed handler in `addExerciseToRoutine` | yes | `routine-exercises.ts:36-48,95-100`. `DuplicateRoutineExerciseError` class + `isDuplicateRoutineExerciseConstraint` helper, mirrors `measurements.ts:42-53` precedent. |
| Picker UI does NOT consume the typed error | yes — by design | `routines/[id]/index.tsx:330-335` still uses generic `console.warn`. Design v2 explicitly called this defense-in-depth ("picker already filters via excludeIds"). |
| `<RoutineExerciseCard>` props match design (MIN-3 `confirmRemoveSet` predicate) | yes | `routine-exercise-card.tsx:13-39` — typed predicate prop owned by the card. Parent supplies default at `routines/[id]/index.tsx:305-307`. |
| Add buttons: `+ Working set` / `+ Warm-up` / `+ Drop set (chains onto set N)` | yes | `routine-exercise-card.tsx:225-282`. Dropset button is disabled when no working set exists (line 271). Mirrors `<ExerciseBlock>` terminology. |
| `useStartSessionFromRoutine` invalidates `["sets", row.id]` | yes | `use-sessions.ts:91-95`. `KEYS.forSession(id) = ["sets", id]` in `use-sets.ts:20-24` — exact-prefix match invalidates live screen reads. |
| `<RoutineListItem>` adds `pending?: boolean`, OR'd with `disabled` | yes | `routine-list-item.tsx:16-34`. `effectivelyDisabled = disabled \|\| pending`; same opacity class, no new tokens (MIN-5 pinned). |
| `queryCacheBuster` bumped to `"schema-2026-05-26-routine-sets"` | yes | `query-client.ts:27`. |
| `tests/rls.test.ts` gets a `routine_exercise_sets` arm (SELECT/UPDATE/DELETE/INSERT-spoof) | yes | `rls.test.ts:308-401` — shape mirrors `exercise_notes` arm. |
| 12 new unit cases in `tests/unit/routine-exercise-sets.test.ts` | yes | 2 add + 4 update + 1 reorder + 5 seed = 12. |
| 7 e2e cases in `tests/e2e/routine-strong-builder.spec.ts` | yes | Golden + dropset + idempotency + soft-delete-re-add + edit-then-restart + hard-fail + duplicate-23505. |
| `tests/migration-backfill.ts` `main()`-style script wired to `npm run test:migration` | yes | `package.json:19` adds the script; file at `tests/migration-backfill.ts` mirrors `rls.test.ts` shape. |
| Drop three legacy columns + drizzle `routineExercises` block | yes | `0013_routine_exercise_sets.sql:120-123` + `schema.ts:88-118` (footer comment now references both 0012 & 0013). `RoutineExerciseRow` shrunk in `types.ts:119-130`. |
| No new `any` / `@ts-ignore` | yes | Greps clean across changed files. Two `as unknown as` casts in `routine-exercise-sets.ts:66-67` and `:259` — first one is the documented embed-strip pattern (mirrors `sets.ts:200-203`); second matches existing `stats.ts:63,87` precedent for PostgREST embedded-row reshaping. No new looseness. |
| Typecheck clean (lint untouched) | yes | Re-ran `npm run typecheck`: 0 errors. Lint warning in `.expo/types/router.d.ts` is auto-generated by Expo Router and pre-existing. |

## Deviation audit (each deviation declared in implementation.md, against design-v2)

| # | Deviation | Justified? | Notes |
|---|---|---|---|
| 1 | `npm run test:migration` script added (vs design's vague `npm test ...`) | yes | Validator MIN-NEW-1 explicitly recommended this. The codebase precedent for `rls.test.ts` / `seed-and-auth.test.ts` is `npx tsx <file>`. The new script wraps that idiom. `tsx` is fetched via `npx` (no devDep added). |
| 2 | `DuplicateRoutineExerciseError` class + `isDuplicateRoutineExerciseConstraint` helper | yes | Validator MIN-NEW-2 already flagged design's "existing 23505 handler" claim as inaccurate. The implementation matches the typed-23505 precedent at `measurements.ts:42-53` and `exercise-notes.ts:91-92`. |
| 3 | `NewSetPayload` snake-case shadow type instead of Drizzle's `NewSet` | yes | Drizzle's `InferInsertModel` returns camelCase; PostgREST `.insert(...)` consumes snake_case. The local type is internal-only and documented (`routine-exercise-sets.ts:4-22`). |
| 4 | `qc.invalidateQueries({ queryKey: ["sets", row.id] })` — adopted from design snippet | yes | Verified: `use-sets.ts:21` defines `forSession(id) = ["sets", id]`. Prefix-match invalidates the live screen `setsQ`. |
| 5 | `useState` for `pendingRoutineId` (matches design's code block, contradicts the prose) | yes | The visual `pending` prop on `<RoutineListItem>` requires re-render; `useState` is the correct choice. Picker precedent `exercise-picker.tsx:32` also uses `useState`. |
| 6 | SQL uppercase keywords inside `check()` builders | yes | Mirrors `sets` precedent at `schema.ts:178-186`. |
| 7 | Backfill pre-flight scoped to live test DB rather than "snapshot of production" | yes | Production rollout is a one-time operator concern; the script's header comment documents the manual production step. |

All 7 deviations are justified, documented, and either explicitly recommended by Validator (1, 2) or driven by typecheck constraints (3) / spec-prose-vs-snippet conflicts (5).

## Cross-checks against the security checklist

- **RLS**: ✓ — new `routine_exercise_sets` table has 4 explicit policies (`0013...sql:56-73`), all gated on `auth.uid() = user_id`. New partial-unique on `routine_exercises` is a constraint, not a new query surface.
- **No service-role key in client**: ✓ — `grep SERVICE_ROLE src/ app/` is clean. All admin clients live in `tests/`.
- **Raw SQL**: ✓ — every call is PostgREST through `supabase.from(...)`. No `rpc` or string concat.
- **`EXPO_PUBLIC_*`**: ✓ — no new public env vars introduced.
- **Bulk insert RLS**: ✓ — `seedSetsForSession` reads `auth.user.id` first (via `useStartSessionFromRoutine`), every row carries `user_id = userId`. The `sets_insert` policy `with check (auth.uid() = user_id)` accepts.

## Issues

### Blockers

None.

### Majors

None.

### Minors

- **[MIN-1]** `tests/e2e/routine-strong-builder.spec.ts:212-215` — dead-code `getByLabel` block. The expression `routineId.slice(0, 0) || ""` evaluates to `""`, then `.first().waitFor(...).catch(() => undefined)` silently swallows the failure. The next line uses the actually-correct `locator('[aria-label^="Start workout: Golden RSB"]').first()` selector. Fix: remove lines 211-215 (the swallowed `.catch` is the only signal the author noticed they wrote the wrong thing — replacing with the clean locator-only selector is the right move). Cosmetic; the test still works.

- **[MIN-2]** `tests/migration-backfill.ts:78-225` — the "backfill correctness" assertions admin-insert `routine_exercise_sets` rows AFTER the migration applied, then verify the rows can be queried back. This validates the post-migration *schema shape* (CHECK constraints accept the values, partial-unique enforces invariants), but does NOT exercise the SQL `INSERT ... SELECT ... FROM generate_series` backfill statement itself. The header comment is honest about this (lines 21-31), and the limitation is intrinsic ("target_sets is dropped post-backfill, can't reproduce the input shape on a post-migration DB"). The pre-flight duplicate-detection assertion at lines 52-76 IS load-bearing. Recommendation: either rename the script to drop "backfill correctness" from the prose, or move the actual backfill verification to a `db:reset`-anchored CI step on a fresh DB pre-migration. Not blocker — the e2e + the migration's own atomicity catches the SQL-level failure mode (transaction aborts).

- **[MIN-3]** `src/components/routine-exercise-card.tsx:326-329` — the `useEffect` reset of local input state (`setWeight`/`setReps`) on `[set.target_weight, set.target_reps]` change will clobber an in-flight user edit if the cache invalidates while the user is typing (e.g. another tab edits the row, or the user's own commit lands and the row refreshes). The behavior matches no existing component (the live `<ExerciseBlock>` has no equivalent local-state reset). For v1 — single-user, single-tab — this is fine. Note: not a regression of any existing path; just a robustness foot-gun for future contributors. Fix (if Tester surfaces flake): gate the reset on a `lastCommittedAt` ref or use an uncontrolled input pattern.

- **[MIN-4]** `src/api/routine-exercise-sets.ts:316-320` — the defensive `throw new Error(...)` inside step 3 is reachable only if the DB CHECK constraint `routine_exercise_sets_parent_matches_type` was bypassed (i.e., never). Since the seed throws and `useStartSessionFromRoutine` propagates, this would hard-fail the entire Start. Acceptable — a CHECK violation is an irrecoverable corruption signal — but the comment ("DB CHECK invariant should make this unreachable") might mislead a future reader into thinking the throw is dead code. Suggested rewording: "Defensive: a `parent_set_id = NULL` dropset would violate the DB CHECK invariant; if we observe one, something has corrupted the row and aborting the seed is the safe choice."

- **[MIN-5]** `src/api/routine-exercise-sets.ts:1` — the import `import { supabase } from "~/lib/supabase";` precedes the `import type { ... } from "~/db/types";` block. The codebase convention (every other file in `src/api/`) does packages first, then `~/` alias paths. The current ordering is correct; this is informational.

## Decision

**pass**

Reasoning:
- 0 blockers, 0 majors, 5 minors — all of MIN-1..5 are cosmetic, doc-only, or future-robustness notes that the Implementer can fold in trivially OR are intentional v1 trade-offs documented in implementation.md.
- The hard-fail seed policy (MAJ-2 in design) is correctly wired: no try/catch in `useStartSessionFromRoutine`, caller's `console.warn` fires, `pendingRoutineId` resets, user stays on routes list, orphan session row survives in History.
- The 6-step `seedSetsForSession` algorithm is verbatim per design-v2; the dropset two-pass remap uses the ONE `routineSetIdToNaturalKey` map populated in step 3 (no dead `parentNaturalKeyByRoutineSetId`).
- New partial-unique `(routine_id, exercise_id)` ships in the same migration as the new table; backfill is atomic; the 23505 typed handler is plumbed into `addExerciseToRoutine` with the same shape as `measurements.ts`/`exercise-notes.ts` precedents.
- RLS posture clean: 4 explicit policies on the new table, all gated by `auth.uid() = user_id`. RLS arm appended to `tests/rls.test.ts` with the same B-can't-read/update/delete/spoof shape as the `exercise_notes` arm.
- Test coverage matches the design plan: 12 unit + 7 e2e + RLS arm + migration backfill script. Edge cases (orphan dropset, NULL reps/weight forward, per-exercise set_number monotonicity, idempotency, hard-fail, duplicate-23505) all present.
- Style/architecture: no new `any` or `@ts-ignore`; `as unknown as` casts match established `stats.ts`/`sets.ts` precedent; the typed-23505 handler conforms to the codebase convention.

Recommendation: invoke Tester.
