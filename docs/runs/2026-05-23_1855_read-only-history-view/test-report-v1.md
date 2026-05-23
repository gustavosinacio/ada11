# Test report v1 — 2026-05-23_1855_read-only-history-view

Testing: implementation against `design-v2.md` (final approved) + Conductor's
five test surfaces and four regression specs.

Round: Implement↔Test round 1 of 2.

## Environment

- Commands used to run app: `npm run web` (Expo dev server on http://localhost:8081).
- Browser / device: Chromium via Playwright (default), plus a 320×568 viewport
  context to smoke iPhone SE-class width.
- Test data: fresh confirmed users created per spec via the Supabase service
  role; sessions/sets seeded directly through `admin.from(...)`. Cleanup via
  `admin.auth.admin.deleteUser` in `finally` blocks. No production data
  touched.
- Baseline SHA (untouched HEAD): `3ab2cfed12a9d2af64de18b6cf8e13d24877cf44`.

## Golden path

**Spec** (from design-v2 `Visual delta` table + `Test surfaces`): the history
detail screen defaults to a read-only view with no editable affordances; the
header Pencil flips a screen-level `isEditing` flag that mounts the editable
`<ExerciseBlock>` family, the session-name `<TextInput>`, the "Add exercise"
and "Delete workout" affordances, and the `<ExercisePicker>` modal. Done blurs
any focused input first so the existing `onBlur=commit` path fires before
unmount.

**Steps run** (all five exercised by `tests/e2e/read-only-history.spec.ts`,
executed against the live Expo web build at localhost:8081):

1. Seed `Read-only target` session with two ended exercises + sets, navigate
   to `/history/<sessionId>`. Assert: Pencil count = 1, "Edit start and end
   times" count = 1, no `input[inputmode="decimal"|"numeric"]`, no
   `Delete set`, no `Open set details`, no `+ Working set`, no `Add exercise`,
   no `Delete workout`, no `Workout` placeholder. **Verified pass.**
2. Tap `Edit workout`. Header swaps to `Exit edit mode`; both seeded blocks
   reveal weight + reps inputs (count 2 + 2), trash + menu (count 2 + 2),
   per-block `+ Working set` (count 2), `Add exercise` / `Delete workout`
   visible, session-name placeholder visible. Time-edit pencil still present.
   **Verified pass.**
3. Tap `Exit edit mode`. Reverts to read-only + Pencil with zero editable
   affordances. **Verified pass.**
4. MAJ-2 regression guard: enter Edit → `repsInputs.first().fill("12")` (keeps
   focus on the input) → tap Done WITHOUT manually blurring → re-enter Edit →
   assert `repsInputs.first()` has value `"12"`. Proves `Keyboard.dismiss()`
   blurred the focused `<TextInput>` so `<SetInput>`'s `onBlur=commit`
   dispatched the `useUpdateSet.mutateAsync` before unmount. **Verified pass.**
5. Per-screen scope: enabling Edit unlocks all blocks at once (two blocks → 2
   weight + 2 reps inputs + 2 footers). **Verified pass.**

**Result**: **pass**.

**Evidence**:

```
$ npx playwright test tests/e2e/read-only-history.spec.ts --reporter=list

Running 5 tests using 1 worker

  ✓  1 tests/e2e/read-only-history.spec.ts:158:7 › Read-only history detail (web) › (1) default render is read-only: no inputs, no trash, no add-set, no add-exercise, no delete-workout, no session-name edit (6.9s)
  ✓  2 tests/e2e/read-only-history.spec.ts:215:7 › Read-only history detail (web) › (2) tap Pencil → header swaps to Done + editable affordances appear (5.7s)
  ✓  3 tests/e2e/read-only-history.spec.ts:266:7 › Read-only history detail (web) › (3) tap Done → revert to read-only + Pencil (6.9s)
  ✓  4 tests/e2e/read-only-history.spec.ts:309:7 › Read-only history detail (web) › (4) MAJ-2: edit a value, tap Done, re-enter Edit → edited value persists (Keyboard.dismiss blur path) (6.9s)
  ✓  5 tests/e2e/read-only-history.spec.ts:360:7 › Read-only history detail (web) › (5) per-screen scope: enabling Edit unlocks all blocks at once (6.6s)

  5 passed (33.7s)
```

Screenshots:
- Read-only view (desktop 1280×800): `docs/runs/2026-05-23_1855_read-only-history-view/screenshots/read-only-desktop.png`
- Edit-mode view (desktop 1280×800): `docs/runs/2026-05-23_1855_read-only-history-view/screenshots/edit-mode-desktop.png`
- Read-only view (iPhone SE-class 320×568): `docs/runs/2026-05-23_1855_read-only-history-view/screenshots/read-only-320pt.png`

The desktop read-only screenshot shows the Pencil in the header-right slot,
the time-edit pencil on the meta row (preserved per prompt), three set rows
rendered as static text with green check glyphs, the second row showing the
`9` RPE chip + notes glyph (no Pressable wrappers), and **zero** `<TextInput>`
borders, `+ Working set` footers, or bottom action buttons. The edit-mode
screenshot shows the header swap to "Done", the `NAME` `<TextInput>` block,
weight/reps inputs, per-row menu + trash, per-block `+ Working set` footers,
and the bottom Add-exercise / Delete-workout area. The 320pt screenshot
confirms the layout doesn't break on a narrow viewport — header + meta block
+ rows render cleanly with sensible wrapping.

## Edge cases

### Edge 1: soft-deleted exercise renders with `(deleted)` suffix in read-only

**Steps**: Verified via the pure-helper contract test (`tests/unit/read-only-history-display.test.ts`)
because the existing e2e `soft-deleted-exercises-in-history.spec.ts:87` cannot
be exercised end-to-end on this branch (its Finish-flow step times out — see
"Regression check" below; failure pre-exists on baseline).

**Expected**: `presentReadOnlyExerciseBlock({...deleted_at: "<iso>"}, n)` sets
`showDeletedSuffix=true`; `<ReadOnlyExerciseBlock>` then appends a `(deleted)`
suffix to the rendered name (`read-only-exercise-block.tsx:47-49`).

**Actual**: Unit test `flags the deleted suffix when the exercise has been
soft-deleted` passes. The component reads `p.showDeletedSuffix` and conditionally
renders ` (deleted)` with the same leading-space copy used by
`exercise-block.tsx:140` (the editable counterpart).

**Result**: **pass** (contract-level — see "Limitations" below).

**Evidence**:
```
$ npm run test:unit
 ✓ tests/unit/read-only-history-display.test.ts (23 tests)
 ...
 Test Files  18 passed (18)
      Tests  307 passed (307)
```

### Edge 2: empty-exercise block ("No sets logged for this exercise.")

**Steps**: Pure-helper unit test `renders the empty state when sets.length === 0`
plus runtime contract: `<ReadOnlyExerciseBlock>` only renders the column-header
strip when `p.showColumnHeader=true` (sets.length > 0), and renders the
italic `<Text className="px-4 py-3 text-sm italic text-gray-500">` line when
`p.showEmptyState=true`.

**Expected**: When a user enters Edit mode, opens the picker, picks a new
exercise, exits without logging a set, then re-enters read-only, the new block
renders the empty-state copy.

**Actual**: Unit test pins the copy against the exported `READ_ONLY_BLOCK_EMPTY_TEXT`
constant; both the JSX (line 96-98 of `read-only-exercise-block.tsx`) and the
test consume the same constant, so the runtime string is the unit-tested
string.

**Result**: **pass** (contract-level).

**Evidence**: 23/23 unit tests in `read-only-history-display.test.ts` pass.
Specifically: `renders the empty state when sets.length === 0` covers
`showEmptyState=true`, `showColumnHeader=false`, and `emptyStateText` equality
to `READ_ONLY_BLOCK_EMPTY_TEXT` ("No sets logged for this exercise.").

### Edge 3: loading state — Pencil visible (MIN-4 consistency tradeoff)

**Steps**: Read the source. `screenOptions` const is lifted before the loading
/ error / happy-path branches (`history/[id].tsx:180-216`, confirmed by
review-v1). Tap-during-loading flips `isEditing=true` but `orderedExercises`
is empty so the loading spinner stays — design-documented as an accepted
tradeoff for visual consistency with the measurements precedent.

**Expected**: Pencil renders in the header during loading; tapping it has no
observable effect (spinner continues until `session.data` / `setsQ.data`
arrive).

**Actual**: Verified statically against the source. The e2e suite does not
have a deterministic hook to freeze the loading state (Expo+Supabase usually
resolves in <500ms), so this is a static-confirmation only.

**Result**: **pass** (verified by source inspection; design-acknowledged
tradeoff).

**Evidence**: `history/[id].tsx:221, 230, 242` — `<Stack.Screen options={screenOptions} />`
shared across loading / error / happy-path branches; same `headerRight`
function reads `isEditing` from the closure.

### Edge 4: time-edit pencil works in BOTH read-only and edit modes

**Steps**: e2e spec (1) asserts `getByLabel("Edit start and end times")` count
= 1 in read-only mode (line 184). e2e spec (2) re-asserts count = 1 after
entering edit mode (line 240). The full crud.spec.ts time-edit flow
(crud.spec.ts:215, :293) was also re-run on this branch.

**Expected**: Pencil visible and functional in both modes; its accessibility
label disambiguates it from the new header Pencil.

**Actual**: Both spec (1) and spec (2) of the new suite assert count = 1; the
existing crud.spec.ts time-edit specs (which click the pencil and edit
`started_at`) both pass.

**Result**: **pass**.

**Evidence**:
```
$ npx playwright test tests/e2e/crud.spec.ts --reporter=list -g 'history: edit started_at'

  ✓  1 tests/e2e/crud.spec.ts:215:7 › Ada11 CRUD flows (web) › history: edit started_at backward by 1h, duration updates (7.0s)
  ✓  2 tests/e2e/crud.spec.ts:293:7 › Ada11 CRUD flows (web) › history: edit started_at across ISO-week boundary — list moves, strip stays (8.3s)

  2 passed (16.1s)
```

## Regression check

The Conductor specified four regression-target specs. Three of them (the ones
whose pre-history-detail setup uses the `Finish` button + `waitForURL(/\/workout$/)`
pattern) fail because the **session-finish flow now redirects to**
**`/workout/verdict/<sessionId>`** instead of back to `/workout` — introduced by
commit `4871d33 feat(workout): end-of-session verdict screen` on `main`. The
verdict screen is unrelated to this run.

To prove the failures are pre-existing on baseline (not introduced by this
read-only change), I stashed all six touched files (1 edited + 5 new) with
`git stash push -u` and re-ran the same four specs against the bare baseline.
**The same four tests failed at the same lines with the same `waitForURL` →
`/workout/verdict/<id>` timeout.** The stash was then `git stash pop`ed cleanly
(verified with `git status --short`).

Therefore these failures are **NOT regressions** introduced by this feature.
They were present on `3ab2cfed` already and need a separate fix (update the
shared `Finish` flow in those specs, or change the post-finish redirect, or
both — out of scope here).

The four regression specs the Conductor asked me to verify:

- **`tests/e2e/crud.spec.ts:215` — history: edit started_at backward by 1h**:
  **pass** on this branch. Time-edit pencil unchanged; read-only/edit toggle
  does not gate it.

  ```
  ✓ tests/e2e/crud.spec.ts:215:7 › Ada11 CRUD flows (web) › history: edit started_at backward by 1h, duration updates (7.0s)
  ```

- **`tests/e2e/crud.spec.ts:293` — history: edit started_at across ISO-week**:
  **pass** on this branch. Same component, same flow.

  ```
  ✓ tests/e2e/crud.spec.ts:293:7 › Ada11 CRUD flows (web) › history: edit started_at across ISO-week boundary — list moves, strip stays (8.3s)
  ```

- **`tests/e2e/volume-target.spec.ts:555` — history detail does NOT render
  the strip**: **pass** on this branch. (Conductor wrote the line range as
  579-601; the spec actually starts at line 555 — see `--list` output. The
  test body is the one that asserts the per-exercise volume-target strip is
  absent on the history detail.) `<ReadOnlyExerciseBlock>` does not mount
  `<VolumeTargetSlot>`, matching the assertion.

  ```
  ✓ tests/e2e/volume-target.spec.ts:555:7 › Volume-target strip (live workout) › history detail does NOT render the strip (7.0s)
  ```

- **`tests/e2e/remove-exercise.spec.ts:92` — golden + edge: ... history hides**:
  **pre-existing fail on baseline**. The history-detail assertion at line
  181-183 (`getByLabel(/^Remove .* from workout$/)` count 0) is unreachable
  because the test times out at line 172 (Finish→`/workout`) before it gets
  to the history-detail check. **Confirmed pre-existing on baseline (stash
  experiment)** — this is the verdict-screen redirect change, not this
  feature.

  ```
  ✘  3 tests/e2e/remove-exercise.spec.ts:92:7 › Remove exercise from session (web) › golden + edge: removes-with-sets, removes-without-sets, empty state, history hides
       TimeoutError: page.waitForURL: Timeout 10000ms exceeded.
         waiting for navigation until "load"
           navigated to "http://localhost:8081/workout/verdict/<id>"
        at tests/e2e/remove-exercise.spec.ts:172:18
  ```

  However, the assertion the spec ultimately makes (`Remove .* from workout`
  trash count 0 on history detail) was always *true* in read-only mode (no
  trash icons render at all). The read-only default does not weaken that
  invariant — it strengthens it. So the assertion's intent is preserved
  even if the spec's setup is broken upstream.

- **`tests/e2e/soft-deleted-exercises-in-history.spec.ts:87` — block stays,
  picker excludes, suffix renders**: **pre-existing fail on baseline**, same
  Finish→`/workout/verdict/<id>` redirect issue at line 187. The
  `(deleted)` suffix assertion is unreachable end-to-end on this branch.

  The suffix rendering is covered at the contract level by the new unit test
  `flags the deleted suffix when the exercise has been soft-deleted` plus the
  component code at `read-only-exercise-block.tsx:47-49`, which uses the same
  ` (deleted)` leading-space copy as the editable `exercise-block.tsx:140`.
  When the upstream `Finish` issue is fixed, the existing e2e will pass
  unchanged because the read-only block emits the same suffix string.

Additional adjacent flows verified to still work on this branch by spot-running
their tests:

- **time-edit pencil flow** (crud.spec.ts:215, :293): **pass** (see above).
- **volume-target on history (no strip)** (volume-target.spec.ts:555):
  **pass** (see above).

## Cross-platform

- **Web**: **pass**. Five new e2e specs + two history-time-edit regression
  specs + one volume-target history regression spec all green via Chromium
  headless. Screenshots at desktop (1280×800) and iPhone SE-class (320×568)
  confirm layout integrity.
- **iOS**: **not tested — no simulator available in this run environment**.
  The change uses standard React Native primitives only (`<View>`, `<Text>`,
  `<Pressable>`, `Keyboard.dismiss()`, `useColorScheme`); no
  platform-specific APIs. Design risk section explicitly addresses the
  cross-platform contract for `Keyboard.dismiss()` (iOS triggers blur on
  focused `<TextInput>`s synchronously, identical contract to web).
- **Android**: **not tested — no emulator/device available**. Same RN-only
  surface as iOS; same cross-platform argument applies. Worth a manual
  shakedown when convenient.

## Test commands

- [x] `npm run typecheck` — `tsc --noEmit` exits 0, **no errors**.
- [x] `npm run lint` — **0 errors, 1 warnings** (only the pre-existing
  `router.d.ts` warning, baseline unchanged).
- [x] `npm run test:unit` — **18 test files, 307 tests passed** (including
  the new `read-only-history-display.test.ts` with 23 tests).
  ```
  Test Files  18 passed (18)
       Tests  307 passed (307)
    Duration  1.96s
  ```
- [x] `npm run test:e2e -- --grep "Read-only history"` (the new spec) —
  **5/5 passed** in 33.7s.
- [x] Regression spot-runs:
  - `crud.spec.ts -g 'history: edit started_at'` → **2/2 passed**.
  - `volume-target.spec.ts -g 'history detail does NOT render'` → **1/1 passed**.
  - `remove-exercise.spec.ts:92` + `soft-deleted-...:87` → **pre-existing
    failures** unrelated to this change (verified via stash experiment).

## Limitations

- **Edge cases 1 & 2 (deleted-suffix, empty-state)** are verified only at the
  contract level (unit tests + source inspection). End-to-end coverage of
  those exists in `soft-deleted-exercises-in-history.spec.ts` and would also
  cover the empty-state path indirectly through manual exercise add → no
  set → exit, but both e2e routes traverse the broken Finish→`/workout`
  navigation that times out on this branch (and on baseline). Mitigation:
  the new components consume the same `present*` helpers covered by the unit
  tests, so the unit-tested contract is the runtime contract.
- **Edge case 3 (loading state)** verified by source inspection only. No
  deterministic hook to pause the load.
- **iOS / Android dynamic verification** not run — see Cross-platform.
- **Pre-existing flakiness on `Finish`-→`/workout` navigation** in three e2e
  specs (`remove-exercise.spec.ts`, `soft-deleted-exercises-in-history.spec.ts`,
  and `crud.spec.ts:131`) is unrelated to this change but worth flagging to
  the Conductor as a follow-up: the `Finish` button now lands on
  `/workout/verdict/<sessionId>` (commit `4871d33`), and ~3 existing specs
  still wait for `/\/workout$/`. A simple fix (update the regex to
  `/\/workout(\/verdict\/.*)?$/`) would unblock them.

## Decision

**pass**

Reasoning:
- Golden path (all five Conductor-specified test surfaces) verified end-to-end
  via Playwright on the live Expo web build: **5/5 specs green**.
- Edge cases (deleted-suffix, empty-state, loading-state, time-edit pencil
  independence) verified — three at contract level via unit tests + source
  inspection (with explicit Limitations section), one via the e2e suite (4
  passes including time-edit regression specs).
- Regression sweep clean for everything reachable: the time-edit-pencil flow
  (crud.spec.ts:215, :293) and the volume-target-not-on-history flow
  (volume-target.spec.ts:555) both pass. The two failing regression specs
  fail **pre-existing on baseline** (verified by `git stash`/re-run/`git
  stash pop`) due to an unrelated verdict-screen redirect change introduced
  by `4871d33 feat(workout): end-of-session verdict screen`.
- All quality gates green: typecheck clean, lint clean (1 pre-existing
  warning baseline), 307/307 unit tests pass (including 23 new), 5/5 new
  e2e pass, 3/3 reachable regression specs pass.
- Screenshots pinned at desktop + 320pt confirm visual contract.

No fixes required for the Implementer. Recommendation: **finalize**. The
pre-existing `Finish`→`/workout` flakiness should be filed as a separate
issue, but it is out of scope for this run.
