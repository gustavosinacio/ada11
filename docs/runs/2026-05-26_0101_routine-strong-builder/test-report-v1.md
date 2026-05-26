# Test report v1 — 2026-05-26_0101_routine-strong-builder

Testing: implementation against `design-v2.md`.

## Environment
- Commands used to run app: dev server already running at http://localhost:8081 (`npm run web`)
- Browser / device: Playwright headless Chromium (1.59.1) per `playwright.config.ts`
- Test data: fresh per-test users created via admin client (`e2e-rsb-{tag}-${ts}@test.com`); `afterAll` deletes them
- DB target: linked Supabase project per `.env.local` (`EXPO_PUBLIC_SUPABASE_URL`)
- Migration 0013 status at start of run: Local only. Pushed by Tester per Conductor's instructions (decision tree: e2e need it remote).

## Static gates
- `npm run typecheck` — pass (0 errors).
- `npm run lint` — pass (0 errors, 1 pre-existing warning in `.expo/types/router.d.ts`, unchanged from baseline).
- `npm run test:unit` — pass (24 files, 376 tests, 2.05s; includes new `tests/unit/routine-exercise-sets.test.ts` with 12 cases).

Tail of unit run:
```
 ✓ tests/unit/routine-exercise-sets.test.ts (12 tests) 38ms
 …
 Test Files  24 passed (24)
      Tests  376 passed (376)
   Duration  2.05s
```

## Migration push & backfill verification

### Push
```
$ npm run db:push
Applying migration 0013_routine_exercise_sets.sql...
NOTICE (00000): policy "routine_exercise_sets_*" for relation does not exist, skipping
…
Finished supabase db push.
```

### Migration list (post-push)
```
   Local | Remote | Time (UTC)
   …
   0013  | 0013   | 0013
```
Local + Remote both at 0013.

### Backfill script (`npm run test:migration`)
```
✅ pre-flight duplicate detection: no active (routine_id, exercise_id) dupes
✅ backfill shape A: 3 sets, set_number 1..3, all 'working'
✅ backfill shape B: target_sets=0 → 0 rows
✅ backfill shape C: null reps/weight carries forward
✅ backfill shape D: soft-deleted parent → 0 rows
✅ Migration 0013 backfill correctness verified.
```

Pre-flight ran twice: once before push (only the duplicate check; admin insert of `routine_exercise_sets` then failed because the table did not yet exist remotely — expected per the script's design comment), then after push (full pass). The pre-flight assertion is load-bearing because the new `(routine_id, exercise_id)` partial-unique would have aborted the migration if any duplicates existed in production.

### RLS arm
```
$ npx tsx tests/rls.test.ts
✅ RLS test passed — B cannot read/update/delete A's data; canonical rows visible to both users + immutable via RLS; routine_exercise_sets arm OK.
```

## Golden path

**Spec** (from design `design-v2.md` test plan case 1): Create a routine with 3 working sets at distinct weights → start a session → 3 seeded unchecked `sets` rows appear with the routine's weights/reps; live screen renders them; user can check them off and volume updates.

**Steps run**:
1. Admin-seeded user, routine `Shot RSB <ts>` with 2 exercises: Bench Press (3 working sets at 60/70/80 kg × 8/8/6) and Back Squat (2 working + 1 dropset).
2. Signed in as the test user, opened the routine builder → screenshot 1.
3. Tapped Start on the routine → URL navigated to `/workout/<uuid>`.
4. Live screen rendered with 3 unchecked draft sets for Bench Press at the routine's weights/reps → screenshot 2.
5. Checked set 1 (60 × 8) and set 3 (80 × 6) → screenshot 3.

**Result**: pass (visually + semantically).

**Evidence**:
- Screenshots: `docs/runs/2026-05-26_0101_routine-strong-builder/screenshots/01-routine-builder.png`, `02-live-workout-drafts.png`, `03-live-workout-checking.png`.
- Volume in screenshot 3: 960 kg = 60×8 + 80×6 (set 2 unchecked). Verdict math correct.
- Set checkboxes render as drafts (unchecked) on initial load — confirms `completed_at` is null on the seed.
- "Back Squat (deleted)" label on screenshot 2/3 is a Tester-fixture artifact (an environment-pre-existing soft-deleted canonical row in `exercises` for that name) and unrelated to the feature. The seed correctly only renders non-deleted parents; the deleted-tagged row is the existing exercise gating UI doing its job.

## Edge cases

E2E suite `tests/e2e/routine-strong-builder.spec.ts` — 7 cases. 6 pass, 1 fails:

| # | Title | Duration | Result | Notes |
|---|---|---|---|---|
| 1 | golden path: 3 working sets seed 3 unchecked rows in live session | 7.97 s | **fail** | See below — test-assertion bug, not a feature bug. |
| 2 | dropset variant: routine with 1 working + 1 dropset → live shows correct parent_set_id | 6.25 s | pass | |
| 3 | idempotency: rapid double-tap on Start produces exactly ONE session | 6.14 s | pass | In-flight `pendingRoutineId` guard verified. |
| 4 | soft-delete then re-add: new set's set_number = max(non-deleted) + 1 | 6.33 s | pass | Partial-unique respected. |
| 5 | edit-then-restart: removing a routine set after Start does NOT remove the seeded set in the active session | 5.66 s | pass | Active-session isolation verified. |
| 6 | hard fail: seed insert fault → user stays on routines, orphan session exists, zero sets | 6.86 s | pass | MAJ-2 hard-fail policy verified via route-fulfill 500. |
| 7 | duplicate-exercise: second non-deleted (routine_id, exercise_id) insert fails 23505 | 2.14 s | pass | MAJ-3 partial-unique verified. |

Stats line from the run: `expected: 6, unexpected: 1, skipped: 0, flaky: 0`.

### Edge 1 (Spec #1): Golden path assertion failure

**Steps**: reproducer `set -a && . .env.local && set +a && npx playwright test tests/e2e/routine-strong-builder.spec.ts -g "golden path"`.

**Expected**: 3 seeded sets with weights `["60.00", "70.00", "80.00"]` (strings).

**Actual**:
```
expect(received).toEqual(expected)

Array [
-   "60.00",
-   "70.00",
-   "80.00",
+   60,
+   70,
+   80,
]
  at tests/e2e/routine-strong-builder.spec.ts:246:40
```

Error context: `test-results/routine-strong-builder-Rou-d5c32-…/error-context.md` (and `video.webm`).

**Result**: fail (test-side), pass (feature-side).

**Root cause**: PostgREST's JS client returns `numeric(6,2)` columns as JavaScript `number` in this stack. Verified via a one-off probe against the same DB:

```js
// Live read of sets table
weight: 100, weight_type: 'number'
weight: 80,  weight_type: 'number'
weight: 130, weight_type: 'number'
```

The assertion at line 246 expects the value to round-trip as a quoted decimal string (which is the SQL/CSV display form), but the runtime PostgREST shape is a JS number. The feature stored the correct integer-kg weights (60, 70, 80); the assertion's expected shape was authored incorrectly.

Precedent in the codebase already acknowledges this: `tests/e2e/auto-fill-placeholder-on-check.spec.ts:340` uses `expect(parseFloat(row.weight as string)).toBeCloseTo(120, 1)` (the `as string` cast is a TypeScript narrowing aid even though the runtime value is a number).

**Recommended fix** (Implementer round 2, ≤1-line):
```ts
// tests/e2e/routine-strong-builder.spec.ts:246
expect(sets?.map((s) => Number(s.weight))).toEqual([60, 70, 80]);
```
or, to match the existing precedent more literally:
```ts
expect(sets?.map((s) => parseFloat(s.weight as unknown as string))).toEqual([60, 70, 80]);
```

The seed itself, dropset path, idempotency, soft-delete-re-add, edit-isolation, hard-fail, and 23505 paths all pass (6/7).

### Edge 2 (Spec #6): Hard-fail (MAJ-2 verification)

**Steps**: spec at `routine-strong-builder.spec.ts:455-516` intercepts the second `.from("sets").insert()` PostgREST call with `route.fulfill({ status: 500 })`. Taps Start. Asserts (a) URL stays on `/workout` (no `/workout/{id}` redirect), (b) admin query confirms one orphan session in `sessions`, (c) `sets.count = 0` for that session.

**Expected**: mutation rejects, user stays on routine list, orphan session exists, zero seeded sets.

**Actual**: all three assertions pass.

**Result**: pass.

**Evidence**: spec ran in 6.86 s with status `passed`; no errors; the assertion that `count(sessions) === 1 && count(sets) === 0` for the affected user holds.

### Edge 3 (Spec #3): Idempotency (double-tap Start)

**Steps**: spec at `routine-strong-builder.spec.ts:303-344` fires `Promise.all([startBtn.click(), startBtn.click()])`. Asserts exactly one session + one seeded set for a 1-set routine.

**Expected**: `count(sessions) === 1`, `count(sets) === 1`.

**Actual**: assertion holds. `pendingRoutineId` in-flight guard wins; second click is a no-op.

**Result**: pass.

**Evidence**: 6.14 s, `passed`.

## Regression check

All adjacent flows tested in isolation post-migration-push. Each `npm test:e2e` invocation reports `.last-run.json` as `passed` with empty `failedTests`.

- **`routines-add-exercise-race.spec.ts`** (May-22 race fix + new MAJ-3 schema-layer): pass. The new `(routine_id, exercise_id)` partial-unique would now also reject the second insert if the in-flight guard ever fails; the spec's assertion "exactly +1 row in routine_exercises" holds either way.
- **`auto-fill-placeholder-on-check.spec.ts`** (4 cases under "Auto-fill placeholder on check"): pass. Set check + auto-fill + soft-delete adjacencies unaffected by the seed.
- **`rest-timer-auto-start.spec.ts`** (rest timer fires on first working-set check): pass. Seeded drafts arrive with `completed_at = null`; the unchecked-to-checked transition fires the timer exactly once on user check, identical to pre-feature behavior.
- **`end-of-session-verdict.spec.ts`**: pass. Verdict math walks seeded `sets` rows the same way it walks user-entered rows.
- **`soft-deleted-session-volume-leak.spec.ts`** (May-19 fix): pass. Volume aggregation continues to exclude soft-deleted sessions/sets.
- **`remove-exercise.spec.ts`**: pass. Routine-exercise cascade-delete to `routine_exercise_sets` (new in 0013) does not affect live-session removal of an exercise.
- **`crud.spec.ts`**: pass. Routine create / list / delete still work; `<RoutineListItem>` `pending?: boolean` change is non-breaking.
- **`set-row-menu.spec.ts`**: pass. Live-screen set-row menu UI unchanged.
- **May-26 set-ordering fix** (sets sort by set_number alone): visually confirmed in screenshot 2 — Bench Press shows 60/70/80 in set_number order (1, 2, 3). Seed assigns monotonic `set_number` per `(session, exercise)` matching the existing pattern.

## Cross-platform
- Web: pass (the one e2e failure is a test-code defect, not a runtime defect).
- iOS: not tested. Reason: design touched only RN-Web-compatible code (TanStack hooks, PostgREST mutations, NativeWind layout); no native modules. Risk LOW.
- Android: not tested. Same rationale as iOS.

## Test commands
- [x] `npm run typecheck` — clean
- [x] `npm run lint` — 0 errors, 1 pre-existing warning
- [x] `npm run test:unit` — 376/376 (24 files)
- [x] `npm run test:migration` — 5 assertions clean (pre-flight + 4 shape assertions)
- [x] `npx tsx tests/rls.test.ts` — pass (incl. new `routine_exercise_sets` arm)
- [x] `npm run db:push` — applied 0013 to remote
- [x] `npx supabase migration list --linked` — 0013 in both Local + Remote
- [x] `npx playwright test tests/e2e/routine-strong-builder.spec.ts` — 6/7 (1 fail, see Edge 1)
- [x] Adjacent specs (race, auto-fill, rest-timer, verdict, soft-delete leak, remove-exercise, crud, set-row-menu) — all pass

## Decision

**fail**

Reasoning:
- One e2e spec fails (`golden path`, line 246 assertion). Per playbook: "any e2e spec fails (even one) → fail".
- The failure is a **test-code defect**, not a product defect. The feature behavior is correct (verified by 6/7 sibling e2e specs, the visual screenshot showing 960 kg volume = 60×8 + 80×6 = correct kg-integer multiplication, and a one-off PostgREST probe confirming the runtime numeric shape).
- The fix is ≤1 line — change line 246 from `expect(sets?.map((s) => s.weight)).toEqual(["60.00", "70.00", "80.00"])` to `expect(sets?.map((s) => Number(s.weight))).toEqual([60, 70, 80])` (mirrors the existing `parseFloat(row.weight as string)` precedent at `auto-fill-placeholder-on-check.spec.ts:340`).
- All other gates green: typecheck, lint, unit (376), migration push, backfill, RLS, 8 adjacent e2e suites, visual smoke. Pre-flight duplicate detection ran and confirmed no production-blocking dupes existed at push time.
- I↔T round budget: 1 / 2 used; 1 remaining. Recommendation: **return to Implementer** for the 1-line assertion fix. Confidence HIGH on the root cause and the fix recipe (precedent + runtime probe both confirm).

### What the Implementer must do

1. Edit `tests/e2e/routine-strong-builder.spec.ts:246` — coerce the runtime `number` to compare against the expected `number[]`:
   ```ts
   expect(sets?.map((s) => Number(s.weight))).toEqual([60, 70, 80]);
   ```
   Or, to match the live `auto-fill-placeholder-on-check.spec.ts:340` precedent more literally:
   ```ts
   expect(sets?.map((s) => parseFloat(s.weight as unknown as string))).toEqual([60, 70, 80]);
   ```
2. Re-run the golden test alone to confirm: `npx playwright test tests/e2e/routine-strong-builder.spec.ts -g "golden path"`.
3. No source change to `src/api/routine-exercise-sets.ts` or `useStartSessionFromRoutine` is needed — the feature is correct.

Confidence: HIGH on diagnosis (probe-verified PostgREST shape + 6 sibling specs passing on the same seed), HIGH on fix recipe (precedent in repo), LOW risk on the fix itself (test-only one-liner; no side effects).
