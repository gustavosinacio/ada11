# Validation v2 — 2026-05-26_0101_routine-strong-builder

Reviewing: `design-v2.md` (round 2 of D↔V; budget after this round: 1/3 remaining).

## Resolution check on v1 issues

### Majors

| v1 ID | Status in v2 | Evidence in v2 |
|---|---|---|
| MAJ-1 (pseudo-code two-map inconsistency) | **Resolved** | `design-v2.md:557-711` — single canonical `seedSetsForSession` algorithm. ONE map: `routineSetIdToNaturalKey`, populated inside step 3 alongside the row arrays (line 626). The "What is NOT in this algorithm" footnote at line 711 explicitly forbids `parentNaturalKeyByRoutineSetId` and the post-pass-1 reconstruction loop. No refinement subsection remains. Walked the algorithm end-to-end: data flow steps 1→2→3→4→5→6 is consistent; no dead variables; the unresolvable-dropset guard at line 692 is explicit. |
| MAJ-2 (silent seed-failure UX) | **Resolved (option a chosen)** | `design-v2.md:425-447, 524-532, 721-731`. `try/catch` around `seedSetsForSession` removed from `useStartSessionFromRoutine`. Mutation propagates failure to the caller. `startFromRoutine` catch at `app/(app)/workout/index.tsx:62-64` (verified: `catch (err) { console.warn("Start failed", err); }`) keeps user on routines list. New Risk #8 acknowledges the orphan empty-session in History. New e2e case #8 verifies the path (intercept seed insert with 500, assert URL stays on `/workout`, orphan session row + zero sets via admin client). |
| MAJ-3 (natural-key uniqueness) | **Resolved (option a chosen)** | `design-v2.md:152-164` — new partial-unique `routine_exercises_routine_exercise_uq ON (routine_id, exercise_id) WHERE deleted_at IS NULL` in the same migration. Idempotency guard tightened to `routine_exercise_id` granularity (`design-v2.md:582-598`, return shape: `skipped_routine_exercise_ids: string[]`). Defense-in-depth 23505 handler proposed for `addExerciseToRoutine` (lines 287-298). New unit case #9 + e2e case #9 verify constraint behavior. Index naming `routine_exercises_routine_exercise_uq` does not collide with existing indexes (grep across 0000-0012 confirms no conflict). |

### Minors

| v1 ID | Status in v2 |
|---|---|
| MIN-1 (RoutineExerciseSetEntry) | Resolved. `design-v2.md:272` pins "no joined type, parallel fetch only". |
| MIN-2 (Drizzle `check()` blocks verbatim) | Resolved. `design-v2.md:200-238` has explicit "Drizzle schema" subsection with both `setTypeCheck` and `parentInvariant`. Mirrors `schema.ts:175-183` precedent (verified). |
| MIN-3 (confirm-delete predicate ownership) | Resolved. `design-v2.md:471` adds `confirmRemoveSet: (set) => boolean` prop on `<RoutineExerciseCard>`. |
| MIN-4 (backfill test infra) | **Partially resolved — see MIN-NEW-1 below.** Designer re-anchored to `tests/migration-backfill.ts` `main()`-style script but the proposed invocation ("`npm test` runner") is factually wrong. |
| MIN-5 (`<RoutineListItem>.pending` prop) | Resolved. `design-v2.md:477-485` adds `pending?: boolean` mapping to existing `disabled` visual. |
| MIN-6 (embed strip in listForRoutine) | Resolved. `design-v2.md:378-380` adds verbatim destructure. Mirrors `getLastWorkingSetForExercise` at `sets.ts:200-203` (verified). |
| MIN-7 (inner-join filter informational) | Resolved. Comment added at the seed SQL block (lines 568-570). |
| MIN-8 (`console.warn` message detail) | Dissolved with MAJ-2 resolution. |

All v1 issues addressed.

## Verification of NEW v2 surfaces

| Claim | Verified? | Evidence |
|---|---|---|
| `routine_exercises_routine_exercise_uq` index name doesn't collide | yes | No prior index named that across `0000-0012`. |
| Step 6 (new partial-unique on `routine_exercises`) runs BEFORE step 7 (backfill) in the SQL | yes | `design-v2.md:152-164` precedes `design-v2.md:175-187`. Order matters for atomic-abort semantics. |
| `workout/index.tsx:62-64` catch block exists and would fire on rejection | yes (exact) | `app/(app)/workout/index.tsx:62-64`: `} catch (err) {\n  console.warn("Start failed", err);\n}`. Verbatim match — design's reference is precise. |
| `useStartSession` exists at `src/hooks/use-sessions.ts:43-52`; new `useStartSessionFromRoutine` can be co-located | yes | Module-level `KEYS` constant available in scope. Design's snippet references `KEYS.active`/`KEYS.all` correctly. |
| `getLastWorkingSetForExercise` destructure pattern at `sets.ts:200-203` | yes (exact) | `const { sessions: _sessions, ...row } = data` matches. |
| `routine_exercises` columns 102-104 are `targetSets/targetReps/targetWeight` | yes (exact) | `src/db/schema.ts:102-104` lines match. |
| `RoutineExerciseRow` columns at `types.ts:121-123` are the three to drop | yes (exact) | Verified. |
| Existing `addExerciseToRoutine` has a 23505 handler "from the (routine_id, position) race fix" | **NO — claim is wrong** | `src/api/routine-exercises.ts:27-64` has zero 23505 handling. The race fix lives in `src/components/exercise-picker.tsx:32+` (UI in-flight guard `pickingId`); the DB-level 23505 was caught by `routine_exercises_routine_position_uq` but the API never decoded the error. Design's wording at `design-v2.md:285` ("matches the existing `addExerciseToRoutine` 23505 handler pattern") is incorrect — see MIN-NEW-2. The 23505 precedent the design actually mirrors lives in `src/api/measurements.ts:50` and `src/api/exercise-notes.ts:91-92`. |
| Partial-unique index pre-flight in `tests/migration-backfill.ts` runs via `npm test` | **NO — claim is wrong** | `package.json:6-19` has scripts `test:unit` (vitest) and `test:e2e` (playwright), but no `test` script. The existing `tests/rls.test.ts` and `tests/seed-and-auth.test.ts` are unwired stub scripts run via `npx tsx <file>` (per `tests/seed-and-auth.test.ts:17` comment). See MIN-NEW-1. |
| `routines-add-exercise-race.spec.ts` still passes with new partial-unique | yes | The spec asserts exactly 1 POST hits `/rest/v1/routine_exercises` and exactly 1 row inserted; the in-flight guard is the path under test, and the new partial-unique is strictly stricter without changing the success path. |
| `addExerciseToRoutine` insert payload (post-shrink) still satisfies NOT NULL constraints | yes | The three dropped columns (`target_sets/target_reps/target_weight`) are nullable in current schema (`schema.ts:102-104` — no `.notNull()`). After migration 0013 drops them, no payload constraint changes. |

## Issues found

### Blockers

(none)

### Majors

(none)

### Minors

- **[MIN-NEW-1]** `design-v2.md:62, 819, 828-831` (test runner mechanism for `tests/migration-backfill.ts`): the design says "invoked via the existing `npm test` runner" and writes a literal `npm test` block. `package.json:6-19` has no `test` script — only `test:unit` (vitest) and `test:e2e` (playwright). The existing similar-shape scripts (`tests/rls.test.ts`, `tests/seed-and-auth.test.ts`) actually run via `npx tsx <file>` (verified at `tests/seed-and-auth.test.ts:17`). Suggested fix: Implementer should add a `test:migration` script entry to `package.json` (or `test:integration`) that runs `npx tsx tests/migration-backfill.ts`, and the design's pseudo-invocation block should read `npm run test:migration` (or equivalent). Same fix retroactively benefits `rls.test.ts` and `seed-and-auth.test.ts` (currently runnable only via the explicit command in their comment headers). **This is the exact same lesson MIN-4 raised in v1** — the v1 fix re-anchored the file path but kept the wrong runner story.

- **[MIN-NEW-2]** `design-v2.md:285` (claim of "matches the existing `addExerciseToRoutine` 23505 handler pattern"): `addExerciseToRoutine` has NO existing 23505 handler — verified by reading `src/api/routine-exercises.ts:27-64` end to end. The 23505 precedents in the codebase live in `src/api/measurements.ts:21,50` and `src/api/exercise-notes.ts:43,91-92`. The proposed implementation block at `design-v2.md:288-297` is correct in shape; only the prose justification is wrong. Suggested fix: Designer note (or Implementer at write time) replaces "matches the existing `addExerciseToRoutine` 23505 handler pattern from the `(routine_id, position)` race fix" with "follows the typed-23505 discriminator precedent at `src/api/measurements.ts:50` and `src/api/exercise-notes.ts:91-92` — `addExerciseToRoutine` does not currently decode 23505 errors; the position-conflict path mentioned by the comment is the *physical* unique-index trigger, not an existing code handler." This is doc-only.

- **[MIN-NEW-3]** `design-v2.md:514, 56` (in-flight guard: "per-routine `pendingRoutineId` ref"): the design's text at line 56 of the file changes table says "per-routine `pendingRoutineId` ref", but the code block at `design-v2.md:514` uses `useState<string | null>` (not `useRef`). The picker precedent (`exercise-picker.tsx:32`) is also `useState`. The wording at line 56 is loose; the actual snippet is correct. Suggested fix: align prose at line 56 to "`pendingRoutineId` state (mirrors `pickingId` at `exercise-picker.tsx:32`)".

- **[MIN-NEW-4]** `design-v2.md:826` (pre-flight duplicate detection in `tests/migration-backfill.ts`): "Before migration apply, the script queries... against a snapshot of the production DB" — this is hand-wavy. In the local test flow, there IS no production snapshot; the script should query against the test DB (likely a local Supabase instance pre-migration). Suggested fix: re-spec as "asserts the test DB has no duplicate `(routine_id, exercise_id)` non-deleted pairs before 0013 applies. For production rollout, the Implementer runs the same query against the production DB via service-role admin client and soft-deletes any duplicates manually before `npm run db:push`." Implementer can resolve at write time.

- **[MIN-NEW-5]** `design-v2.md:201-238` (Drizzle CHECK SQL casing): the Drizzle schema block uses lowercase `in (...)` and `is not null` inside `sql\`\`` template strings (e.g. `sql\`${t.setType} in ('warmup','working','dropset')\``), while the precedent `sets` table at `schema.ts:175-183` uses uppercase `IN` and `IS NOT NULL`. Postgres is case-insensitive on SQL keywords so this is functionally equivalent, but the project's house style appears to be uppercase keywords in `sql\`\`` blocks (one sample is not exhaustive — Implementer should pick whichever matches the prevailing style in `schema.ts`). Pure stylistic minor.

## Decision

**go**

Reasoning:
- 0 blockers, 0 majors, 5 minors. Playbook rule "0 blockers + ≤1 major → go" applies; all minors are doc/prose-level and addressable during Implement without redesign.
- All 3 v1 majors are resolved with the strongest version of each fix (MAJ-1 single canonical algorithm with explicit forbidden patterns, MAJ-2 hard-fail with verified catch site, MAJ-3 schema constraint + tightened guard + DB test).
- All 8 v1 minors are resolved (MIN-7 was already informational; MIN-8 dissolved with MAJ-2; the other six have concrete v2 fixes).
- The 5 new minors (MIN-NEW-1..5) are: 1 doc-script mismatch (MIN-NEW-1), 2 prose inaccuracies (MIN-NEW-2, MIN-NEW-3), 1 test-DB ambiguity (MIN-NEW-4), 1 cosmetic SQL casing (MIN-NEW-5). None require design changes. The Implementer should be alerted to MIN-NEW-1 explicitly because mis-wiring the test invocation could leave a useful pre-flight check uninvoked in CI.
- D↔V budget remaining after this round: 1/3. Reserving that round for unexpected issues in Implementer-time discovery is preferable to spending it on prose tweaks.

Recommendation to Conductor: **invoke Implementer**. Pass MIN-NEW-1 explicitly in the kickoff message ("add a `test:migration` (or similar) npm script that runs `npx tsx tests/migration-backfill.ts`; the v2 design's `npm test` reference is wrong").
