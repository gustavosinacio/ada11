# Test report v1 — 2026-05-21_1308_set-check-button

Testing: implementation against `design-v2.md`.

## Environment

- Dev server: `npm run web` already running on `http://localhost:8081` (verified with `curl -sS -o /dev/null -w "%{http_code}" http://localhost:8081` → `200`).
- Browser / device: Playwright Chromium (headless, web target).
- Test data: fresh confirmed-email user per test, created via `admin.auth.admin.createUser`, deleted in `afterAll`.
- Test specs written by the Tester (deleted after the run): `tests/e2e/probe-check-button.spec.ts`, `tests/e2e/probe-finish-modal.spec.ts`, `tests/e2e/probe-cascade-and-order.spec.ts`.

## Quality gates

- **`npm run typecheck`** → clean (only `tsc --noEmit` invocation echoed, no diagnostics).
- **`npm run lint`** → 0 errors, 1 warning (`router.d.ts` — pre-existing, expo-router generated).
- **`npm run test:unit`** → 7 files / 74 tests passing (`tests/unit/...` — `units`, `measurements-units`, `measurements-chart`, `formulas`, `dates`, `weekly-volume-bucketing`, `session-times-form`).

All three quality gates **pass**.

## Golden path

**Spec** (from design-v2.md): every set in a live session has a leading check button; default state is unchecked (`completed_at = null`); tapping flips state and the row tints `bg-blue-50 dark:bg-blue-950/30`. Tapping again unchecks.

**Steps run** (probe-check-button.spec.ts):

1. Quick-start session, add Bench Press, log 2 working sets.
2. Count `getByLabel("Mark set as completed", { exact: true })` → 2 marks, 0 unmarks (both unchecked, correct).
3. Tap the first check icon. Wait 800ms. Count → 1 mark, 1 unmark (one row flipped, correct).
4. Tap the remaining "Mark…". Wait 800ms. Count → 0 marks, 2 unmarks (both flipped, correct).
5. Tap Finish. Native `window.confirm` dialog fires (the all-checked path); modal does NOT open.
6. Accept dialog → navigate to `/workout`.

**Result**: `pass`

**Evidence**:

```
BEFORE: mark= 2  unmark= 0
AFTER 1: mark= 1  unmark= 1
AFTER 2: mark= 0  unmark= 2
modalVisible= false  dialogFired= true
  ✓ Probe: per-set check button › toggle + counts (13.6s)
```

Verified via direct code read:

- `src/components/set-input.tsx:105-127` — check icon Pressable, `accessibilityLabel` flips on `isChecked`, row class adds `bg-blue-50 dark:bg-blue-950/30` when `showCheckable && isChecked`.
- `src/api/sets.ts:69` — `logSet` inserts `completed_at: null` (unchecked by default).
- `src/api/sets.ts:159-180` — `checkSet` stamps `completed_at = now()`; `uncheckSet` clears it; both filtered on `deleted_at IS NULL`.

## Edge cases

### Edge 1: Finish with some unchecked → modal opens; Cancel + "Check all and finish" both work

**Spec**: `uncheckedCount > 0` at Finish → opens `<ChooseActionModal>` with 3 buttons; Cancel closes without action; "Check all and finish" bulk-checks then finishes; both checked sets persist in history.

**Steps** (probe-finish-modal.spec.ts test 1):

1. Quick-start session, add Bench Press, log 2 working sets (both unchecked).
2. Tap Finish. Assert all 3 modal buttons visible (`getByLabel("Check all and finish", { exact: true })`, `getByLabel("Finish without saving unchecked", { exact: true })`, `getByLabel("Cancel", { exact: true })`).
3. Tap Cancel. Modal disappears; URL still `/workout/<id>`.
4. Tap Finish again, modal opens, tap "Check all and finish". Navigate to `/workout`.
5. Open `/history/<id>`. Assert "Total: 2 sets" visible.

**Result**: `pass`

**Evidence**:

```
✓ Probe: finish modal › Cancel + Check-all-and-finish flow (14.6s)
```

### Edge 2: Finish with some unchecked → "Finish without saving unchecked" discards unchecked, keeps checked

**Spec**: choosing the destructive button bulk-soft-deletes unchecked sets and finishes; only checked sets persist in history.

**Steps** (probe-finish-modal.spec.ts test 2):

1. Quick-start session, add Bench Press, log 2 working sets.
2. Tap the first set's check (`Mark set as completed` exact). Poll until `Unmark…` count = 1 and `Mark…` count = 1.
3. Tap Finish → modal opens. Tap "Finish without saving unchecked".
4. Navigate to `/workout`. Open `/history/<id>`. Assert "Total: 1 set" (singular `set` enforced via regex `\b`).

**Result**: `pass`

**Evidence**:

```
✓ Probe: finish modal › Discard-unchecked-and-finish discards unchecked, keeps checked (13.9s)
```

### Edge 3 (cascade — MAJ-2 fix): unchecked parent discarded; checked dropset child SURVIVES

**Spec**: when "Finish without saving unchecked" runs and a checked dropset has an unchecked working-set parent, the dropset survives; the parent is discarded; the orphan `parent_set_id` is acceptable per design (matches pre-existing `useDeleteSet` nit).

**Steps** (probe-cascade-and-order.spec.ts test 1):

1. Quick-start session, add Bench Press, log 1 working set (unchecked).
2. Open "More set types" menu, tap "+ Drop set (chains onto set 1)". Now 2 sets total: a working parent (unchecked) and a dropset child (unchecked).
3. Tap the LAST check icon (dropset). Poll until `Unmark…` count = 1 and `Mark…` count = 1.
4. Tap Finish → modal opens. Tap "Finish without saving unchecked".
5. Navigate to `/workout`. Open `/history/<id>`. Assert "Total: 1 set".

**Result**: `pass`

**Evidence**:

```
✓ Probe: cascade + set ordering › MAJ-2 cascade: unchecked parent discarded, checked dropset child survives (14.5s)
```

Code-level verification:

- `src/api/sets.ts:233-245` — cascade step UPDATE includes `.is("completed_at", null)` so checked children are not soft-deleted. Single shared `nowIso` for parent + cascade.

### Edge 4 (set ordering — MAJ-3 fix): 3 bulk-checked sets render in set_number order

**Spec**: after `bulkCheckAllInSession` (which stamps the same `now()` on all rows), history detail must render sets ordered by `set_number` (1, 2, 3) — the secondary sort breaks the timestamp tie.

**Steps** (probe-cascade-and-order.spec.ts test 2):

1. Quick-start session, add Bench Press, log 3 working sets.
2. Tap Finish → modal opens. Tap "Check all and finish". Navigate to `/workout`.
3. Open `/history/<id>`. Assert "Total: 3 sets".
4. Collect all single-digit textnodes via `page.locator("text=/^[1-9]$/").allInnerTexts()`. Walk a monotonic-sequence cursor 1→2→3.

**Result**: `pass`

**Evidence**:

```
setNumberTexts = [ '1', '2', '3', '1', '2', '3' ]
✓ Probe: cascade + set ordering › MAJ-3 ordering: bulk-checked 3 sets render in set_number order in history (14.0s)
```

(The duplicated `[1,2,3,1,2,3]` is the per-row `set_number` Text — the inner row badge — appearing twice per row because the header total and ordering both render as text nodes. The monotonic walk still finds the 1→2→3 sequence cleanly. Per-exercise progress chart is gated on `sessions.ended_at IS NOT NULL` and uses the same secondary-sort in `src/api/progress.ts:19-20` — verified by code read; not exercised in a separate probe.)

### Edge 5 (history detail unchanged): no check icons on past-session set rows

**Spec**: history detail's `<ExerciseBlock>` invocation passes neither `showCheckable` nor `onToggleSetChecked` → both default `false`/`undefined` → no check icon rendered, no row tint, no header `w-11` spacer.

**Steps** (probe-finish-modal.spec.ts test 3):

1. Quick-start, add 2 sets, Check all and finish.
2. Open `/history/<id>`. Assert "Total: 2 sets".
3. Assert `getByLabel("Mark set as completed", { exact: true })` has **count 0**.
4. Assert `getByLabel("Unmark set as completed", { exact: true })` has **count 0**.

**Result**: `pass`

**Evidence**:

```
✓ Probe: finish modal › History detail has no check icons (showCheckable=false) (12.6s)
```

Cross-checked at code level: `app/(app)/history/[id].tsx:240` `<ExerciseBlock>` invocation does not pass `showCheckable` (verified by grep — only one `showCheckable` callsite repo-wide, in `app/(app)/workout/[sessionId].tsx:366`).

## Regression check

All adjacent specs that hit `Finish` (untouched by the implementer) continue to pass:

- **`tests/e2e/crud.spec.ts:162` workout: start ad-hoc, finish, see in history** → `pass` (5.9s). Zero sets logged → `uncheckedCount === 0` → `confirmDelete` (window.confirm) path fires unchanged.
- **`tests/e2e/crud.spec.ts:204` history: edit started_at backward by 1h** → `pass` (7.5s).
- **`tests/e2e/crud.spec.ts:282` history: edit started_at across ISO-week boundary** → `pass` (12.0s).
- **`tests/e2e/crud.spec.ts:384` profile: weight unit toggle to lbs persists** → `pass` (5.0s).
- **`tests/e2e/exercise-progress-ia.spec.ts:72` exercises golden + delete** → `pass` (7.1s).
- **`tests/e2e/exercise-progress-ia.spec.ts:152` cache: finishing session does not break progress** → `pass` (11.2s).
- **`tests/e2e/remove-exercise.spec.ts:92` removes-with-sets + removes-without-sets + empty + history** → `pass` (12.2s). One logged set is soft-deleted via `bulkSoftDeleteSetsForExerciseInSession` before Finish → `listSetsForSession` returns 0 → `uncheckedCount === 0` → confirm path fires.
- **`tests/e2e/remove-exercise.spec.ts:189` cancel: dialog cancel keeps exercise present** → `pass` (8.5s).
- **`tests/e2e/probe-strong-unify.spec.ts` (8 tests)** → all `pass`. Active-session banner, routine card gating, cold reload guard.
- **`tests/e2e/week-drill-down.spec.ts` (5 tests)** → all `pass`. Tap bar opens per-week, empty week, out-of-window, invalid date, back navigation.
- **`tests/e2e/weekly-volume-strip.spec.ts` (4 tests)** → all `pass`. Golden, empty, warmup-only, refetch.
- **`tests/e2e/measurements.spec.ts:322` regression: 4 tabs** → `pass`.

### One pre-existing flaky/stale spec — UNRELATED to this feature

- **`tests/e2e/crud.spec.ts:131` exercises: create custom exercise** → **fail** (60s timeout on `getByPlaceholder("e.g. Chest")`). Root cause: commit `b51dd01` ("exercises track muscles as required multi-select array") changed muscles input from a free-text placeholder `"e.g. Chest"` to a chip picker (`getByLabel("Arms")` etc.). The `crud.spec.ts` test was not updated. The implementer of THIS feature did not touch this spec (verified with `git diff 66b2784f -- tests/e2e/crud.spec.ts` → no output). Pre-existing debt; out of scope for this report.

## Cross-platform

- **Web**: `pass`. All probes ran in Playwright Chromium against `npm run web`.
- **iOS**: `not tested` — RN `<Modal>` cross-platform behavior was verified by code read only (`Modal` from `react-native`, standard API, no platform-specific code paths in `src/components/choose-action-modal.tsx`). The check-icon Pressable uses RN-Web-safe components (`Pressable`, `View`, `lucide-react-native` icons). No native-only modules introduced.
- **Android**: `not tested` — same as iOS.

## Failed test — the implementer's edited e2e spec

**`tests/e2e/soft-deleted-exercises-in-history.spec.ts` → `fail`** (deterministic timeout, reproduced 2x).

### Root cause

Playwright's `page.getByLabel(text)` defaults to **case-insensitive substring match**, not exact match. After the first check-icon tap:

- Set 1's `accessibilityLabel` = `"Unmark set as completed"`.
- Set 2's `accessibilityLabel` = `"Mark set as completed"`.

`page.getByLabel("Mark set as completed")` (no `{ exact: true }`) matches BOTH labels because the string "Mark set as completed" is a substring of "Unmark set as completed". `.first()` then picks set 1, **unchecking it**. The "AFTER 2: mark=2 unmark=0" probe output proves this — both rows end up unchecked despite two `.first().click()` calls.

Result: at Finish, `uncheckedCount === 2`, the 3-button modal opens (NOT `window.confirm`), the `page.once("dialog", ...)` listener never fires, no navigation occurs, the `await page.waitForURL(/\/workout$/, { timeout: 10_000 })` at line 174 times out.

### Probe evidence

Two runs against the modified test (unedited from `implementation.md`):

```
TimeoutError: page.waitForURL: Timeout 10000ms exceeded.
    172 |       page.once("dialog", (d) => void d.accept());
    173 |       await page.getByText("Finish", { exact: true }).last().click();
  > 174 |       await page.waitForURL(/\/workout$/, { timeout: 10_000 });
```

And a controlled tester probe (`probe-check-button.spec.ts`) reproducing the exact problem:

```
BEFORE: mark= 2  unmark= 0
AFTER 1: mark= 2  unmark= 1     <- substring match: "Mark…" matches BOTH labels.
AFTER 2: mark= 2  unmark= 0     <- second tap un-toggled the first row.
```

After patching the probe to use `{ exact: true }`:

```
BEFORE: mark= 2  unmark= 0
AFTER 1: mark= 1  unmark= 1
AFTER 2: mark= 0  unmark= 2     <- correct.
modalVisible= false  dialogFired= true
```

### Why this matters

1. **The validator's MIN-4 recommendation was wrong** (`validation-v2.md` told the implementer to use `.first()` twice "since each click auto-relocates"). The auto-relocate reasoning is correct ONLY with `{ exact: true }` — without it, the substring match keeps both rows in the candidate set.
2. **The implementer's edit followed MIN-4 verbatim**, so the modified spec deterministically fails.
3. The implementer's `implementation.md:46` claim "`.first().click()` twice (auto-relocates after each tap), not `.nth(0)` / `.nth(1)`" is **disproven by the probe**.

### Fix

In `tests/e2e/soft-deleted-exercises-in-history.spec.ts`, lines 168-169:

```ts
// Current (broken):
await page.getByLabel("Mark set as completed").first().click();
await page.getByLabel("Mark set as completed").first().click();

// Fix:
await page.getByLabel("Mark set as completed", { exact: true }).first().click();
await page.getByLabel("Mark set as completed", { exact: true }).first().click();
```

Either form (`.first()` chained on the exact locator, or `.nth(0)`/`.nth(1)` — both work once the substring confusion is removed) restores the all-checked path. The Implementer must apply the `{ exact: true }` qualifier to BOTH `getByLabel` calls.

## Test commands

- [x] `npm run typecheck` — clean.
- [x] `npm run lint` — 0 errors, 1 pre-existing warning (`router.d.ts`).
- [x] `npm run test:unit` — 74 / 74 tests passing.
- [x] `npm run test:e2e tests/e2e/soft-deleted-exercises-in-history.spec.ts` — **fail** (timeout at line 174 — substring match).
- [x] `npm run test:e2e` sweep on adjacent specs — all passing except pre-existing `crud.spec.ts:131` muscles-placeholder staleness (unrelated).
- [x] Tester probes (cleaned up after the run): per-set toggle, 3-button modal flow, MAJ-2 cascade, MAJ-3 ordering, history-detail-unchanged — all pass.

## Decision

**fail**

Reasoning:

- The **feature implementation itself is correct** — golden path, edge cases (modal, cancel, check-all, discard-unchecked), MAJ-2 cascade, MAJ-3 ordering, and history-detail-unchanged all verified to pass via dynamic Playwright probes against the live web app.
- However, the **one e2e spec the implementer edited deterministically fails** (`tests/e2e/soft-deleted-exercises-in-history.spec.ts`). The implementer applied the validator's MIN-4 advice verbatim, but Playwright's `getByLabel` defaults to substring match — so `getByLabel("Mark set as completed")` also matches `accessibilityLabel="Unmark set as completed"`, and the test ends with both rows un-checked → `uncheckedCount===2` → modal opens instead of native confirm → test times out.
- The fix is a small, mechanical edit (add `{ exact: true }` to both `getByLabel` calls). No production code change required.
- One pre-existing flaky spec (`crud.spec.ts:131`) — UNRELATED to this feature (muscles-chip-picker refactor from b51dd01). Out of scope.

**Recommendation**: return to Implementer with a 2-line patch to `tests/e2e/soft-deleted-exercises-in-history.spec.ts:168-169` adding `{ exact: true }`. After the patch, re-run only that spec + this report's Decision should flip to `pass`.
