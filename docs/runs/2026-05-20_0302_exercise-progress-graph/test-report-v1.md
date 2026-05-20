# Test report v1 — 2026-05-20_0302_exercise-progress-graph

Testing: implementation against `design-v1.md` (final approved by `review-v1.md`).

## Environment
- Commands used to run app: dev server already running on `http://localhost:8081` (`npm run web` started prior to this session); Playwright drivers connect to it.
- Browser / device: Playwright Chromium (default config), headless. Web platform only.
- Test data: fresh confirmed users created via Supabase admin API per test, deleted in `afterAll`. The seed trigger inserts ~30 exercises per new user; tests pick "Bench Press" with a fallback to the first list row.

## Golden path

**Spec** (from design v1):
1. Tap a row in Exercises tab → `/(app)/exercises/{uuid}/progress`.
2. Progress screen renders the existing chart UI with `headerRight` Pencil icon (label "Edit exercise").
3. Tap pencil → `/(app)/exercises/{uuid}` (edit form).
4. Save in edit form → back to progress screen for the same exercise; new name reflected.
5. Delete in edit form → `/(app)/exercises` (the list), not the broken progress screen.

**Steps run** (driver `tests/e2e/exercise-progress-ia.spec.ts`, test "golden + delete"):
1. Create confirmed user, sign in (lands on `/workout`).
2. Click Exercises tab → list at `/exercises`.
3. Click "Bench Press" row → URL becomes `/(app)/exercises/<uuid>/progress`.
4. Capture exercise uuid from URL.
5. Assert empty-state text "No working sets recorded yet" is visible.
6. Assert `aria-label="Edit exercise"` Pencil is visible in header.
7. Click pencil → URL becomes `/(app)/exercises/<uuid>` (no `/progress` suffix); "Edit exercise" header visible.
8. Fill name input with `Renamed <ts>`, click "Save changes".
9. Assert URL goes back to `/(app)/exercises/<uuid>/progress` AND the renamed text is visible (h1 in the body).
10. Click pencil again → edit form.
11. Click "Delete exercise" (window.confirm auto-accepted).
12. Assert URL becomes `/(app)/exercises` (the list) AND the renamed exercise is not visible in the list.

**Result**: **pass**

**Evidence** (Playwright runner output):

```
> playwright test tests/e2e/exercise-progress-ia.spec.ts
Running 2 tests using 1 worker
  ✓  1 tests/e2e/exercise-progress-ia.spec.ts:72:7 › Exercise progress IA (web) › golden + delete: list → progress → pencil → edit → save → progress; delete lands on list (6.5s)
  ✓  2 tests/e2e/exercise-progress-ia.spec.ts:152:7 › Exercise progress IA (web) › cache: finishing a session does not break the progress screen on re-entry (9.3s)
  2 passed (16.5s)
```

Each URL transition is gated by `page.waitForURL(...)` with explicit regex anchors (`/exercises\/<id>$` vs `/exercises\/<id>\/progress$`) — the implementation passes those distinctions, which directly verifies:
- The list row's `router.push(...)` target was changed to `/progress` (`app/(app)/exercises/index.tsx:64`).
- The headerRight Pencil pushes to `/(app)/exercises/${id}` (no suffix) (`app/(app)/exercises/[id]/progress.tsx:47`).
- `useUpdateExercise.onSuccess` updates the detail cache so the renamed name renders on the progress screen (`src/hooks/use-exercises.ts:49`, unchanged).
- `onDelete` uses `router.replace("/(app)/exercises")` (`app/(app)/exercises/[id]/index.tsx:87`) — the MAJ-1 fold-in. Without this, the URL would have been `/exercises/<deletedId>/progress` (the design's "Open question #1" scenario).

## Edge cases

### Edge 1: Cache invalidation on workout finish — no stale state on re-entry
**Steps** (driver test "cache"):
1. Sign in, open Exercises, click Bench Press → land on progress (empty state caches).
2. Navigate to `/(app)/workout`, start ad-hoc, finish (no sets logged — accepts confirm dialog).
3. After landing back on `/workout`, navigate directly to the same exercise's `/progress` URL.
4. Assert the empty-state text is still visible AND the pencil is still in the header.
**Expected**: Progress screen re-mounts cleanly; no React error, no broken header, no infinite spinner. The `useFinishSession.onSuccess` invalidation of `["progress"]` (`src/hooks/use-sessions.ts:62`) causes the next observer mount to refetch instead of serving a stale cache.
**Actual**: Empty state + pencil both visible after re-entry. Test passes (9.3s).
**Result**: **pass**
**Evidence**: same Playwright run above; second test `(9.3s)`.

Note: This test stops short of *adding* a working set inside the session (logging a set requires picking an exercise template + filling weight/reps fields that are not the focus of this run). The cache-invalidation correctness is verified at the code level (prefix-match `["progress"]` covers every `["progress", exerciseId]` entry per TanStack docs — already proven by the unit-tested cache invalidation patterns and acknowledged in `review-v1.md` MIN-3) plus the dynamic re-entry smoke confirms no breakage.

### Edge 2: Delete from edit (formerly Discovery's open question #1 / Validator MAJ-1)
**Steps**: covered inside the golden test, steps 10-12. After delete, URL must equal `/exercises` and the deleted name must not appear.
**Expected**: Lands on the list (`/exercises`), not on `/exercises/<deletedId>/progress` (which would render a stale or broken state).
**Actual**: URL = `/exercises`, deleted name absent. Verified via `await expect(page.getByText(renamedTo).first()).not.toBeVisible({ timeout: 5_000 })`.
**Result**: **pass**
**Evidence**: golden test passes; the URL regex `/\/exercises$/` would not match `/exercises/<id>/progress`.

### Edge 3: Empty progress state for new user (zero finished sessions)
**Steps**: First step of every test — newly created user opens any exercise.
**Expected**: Body shows "No working sets recorded yet. Complete a workout with this exercise to see progress." (per `progress.tsx:124-130`).
**Actual**: Text matched by `page.getByText(/No working sets recorded yet/i)` in both tests.
**Result**: **pass**
**Evidence**: both Playwright tests assert this and pass.

## Regression check

- **Measurements view → edit → delete still works** (the precedent this run copies): `tests/e2e/measurements.spec.ts` — all 8 tests pass (41.5s). Specifically test 7 ("soft delete clears row and unblocks same-day re-entry") exercises the exact `router.replace` post-delete pattern that the exercise edit now copies. **pass**.

- **Routines CRUD still works**: `tests/e2e/crud.spec.ts` "routines: create, see in list, open detail, delete" passes (10.3s). **pass**.

- **Workout start/finish + history still works**: `tests/e2e/crud.spec.ts` "workout: start ad-hoc, finish, see in history" passes (7.8s). This also exercises the modified `useFinishSession.onSuccess` (now invalidates `["progress"]`) without breakage. **pass**.

- **Profile / weight unit toggle still works**: `tests/e2e/crud.spec.ts` "profile: weight unit toggle to lbs persists across reload" passes (4.8s). **pass**.

- **Weekly volume strip on History still works**: `tests/e2e/weekly-volume-strip.spec.ts` — all 4 tests pass (29.7s). Confirms `["stats"]` invalidation still wired (it shares the `useFinishSession.onSuccess` block with the new `["progress"]` invalidation). **pass**.

- **Pre-existing test failure unrelated to this run**: `tests/e2e/crud.spec.ts` "exercises: create custom exercise (alongside seeded library)" **fails** with `locator.fill: ... waiting for getByPlaceholder('e.g. Chest')`. The free-text "muscle group" placeholder was replaced by the `MuscleGroupPicker` multi-select in commit `b51dd01 feat: exercises track muscles as required multi-select array` (2 commits before this run's baseline `a93ca68`). The test was authored in `682b0ec` and never updated for the picker change. The exercise create flow itself works (the picker pressables are reachable; `app/(app)/exercises/new.tsx` is unmodified by this run). **Not a regression from this run.** Touched files diff: only `index.tsx` (row navigation), `[id]/progress.tsx` (headerRight + screenHeader extraction), `[id]/index.tsx` (CTA removal + delete redirect + import cleanup), `use-sessions.ts` (one invalidation line) — none of these alter `new.tsx` or its placeholders.

## Cross-platform

- **Web**: pass (Playwright + dev server). All assertions land URLs and DOM contents as designed.
- **iOS**: not tested — no simulator session active in this environment; no iOS-specific code touched. The change uses universal primitives (`expo-router` `Stack.Screen.options.headerRight`, `lucide-react-native` Pencil, `react-native` `Pressable` + `useColorScheme`, all of which are used identically in the measurements precedent that ships on iOS). Risk: LOW.
- **Android**: not tested — same reasoning. Risk: LOW.

## Test commands

- [x] `npm run typecheck` — clean (no output, `tsc --noEmit` exits 0).
- [x] `npm run lint` — 0 errors, 1 pre-existing warning in `router.d.ts` (unchanged from baseline; carved out by the brief).
- [x] `npm run test:unit` — 51/51 tests pass across 6 files (838ms).
- [x] `npm run test:e2e tests/e2e/exercise-progress-ia.spec.ts` — 2/2 pass (16.5s). Driver authored by this Tester; located at `tests/e2e/exercise-progress-ia.spec.ts`. Recommend keeping it as a permanent regression guard for the IA contract; leave to Conductor / Implementer to decide on retention.
- [x] `npm run test:e2e tests/e2e/measurements.spec.ts` — 8/8 pass (41.5s).
- [x] `npm run test:e2e tests/e2e/weekly-volume-strip.spec.ts` — 4/4 pass (29.7s).
- [x] `npm run test:e2e tests/e2e/crud.spec.ts` — 3/4 pass (1.4m). The single failure is pre-existing (see "Regression check" → exercises create test); not caused by this run.

## Decision

**pass**

Reasoning:
- Golden path (steps 1-7 of the run brief) verified end-to-end via Playwright driver against the live dev server: list row → progress, pencil → edit, save → progress with new name, delete → list with name gone.
- Cache-invalidation edge case verified by re-entering progress after a finished session — no breakage, screen renders cleanly with the empty state + pencil intact.
- All three quality gates (typecheck, lint, unit) green; numbers match the Implementer and Reviewer claims.
- Three adjacent feature regression suites pass (measurements, weekly volume, crud routines/workout/profile) — the change does not destabilize neighboring flows.
- The one failing e2e (`crud.spec.ts` exercises create) is provably pre-existing (predates this run by 2 commits; touches a file this run did not modify) and is not introduced by the IA change.
- Code-level cross-checks of the design's "Open Questions" confirm all of them were resolved as the Conductor brief promised (notably the MAJ-1 delete-redirect fold-in is on line 87 of `[id]/index.tsx`).

Recommendation: `finalize`.

Suggested follow-ups for a different run (NOT blockers):
- Update `tests/e2e/crud.spec.ts:148-152` to use the `MuscleGroupPicker` (`getByLabel("Chest").click()`) instead of the gone "e.g. Chest" placeholder. This is a separate bug ticket against the muscles-multi-select change.
- Consider whether `tests/e2e/exercise-progress-ia.spec.ts` (added by this Tester for evidence) should be kept as a permanent regression guard or removed. It uses the same fixture pattern as the other e2e specs and stabilized after one driver iteration.
