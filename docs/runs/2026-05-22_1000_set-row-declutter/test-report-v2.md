# Test report v2 — 2026-05-22_1000_set-row-declutter

Testing: implementation v2 (test-harness fixes) against `design-v3.md`.

## Environment

- Dev server already running on `http://localhost:8081` (HTTP 200 verified just before run).
- Suites used:
  - `npm run test:unit`
  - `npm run test:e2e -- tests/e2e/set-row-menu.spec.ts`
- No adjacent e2e suites re-run because the v2 changes were scoped to `tests/e2e/set-row-menu.spec.ts` only (verified via `git status`, no other harness file modified).

## Decision

**fail**

Reasoning:
- The unit suite is green at the expected 198/198 — no regression there.
- The Implementer applied **fix #1 correctly** (swap `toHaveAttribute("aria-selected","true")` → `toHaveClass(/bg-emerald-500/)` at lines 126-128 and 215-217). Visible in the failing-test error messages — `Expected pattern: /bg-emerald-500/`.
- The Implementer applied **fix #2 partially** — only to the notes test, not to the two RPE-chip tests. The notes test (lines 154-176) now correctly armed `waitForResponse` for the PATCH + the cache-refresh GET before clicking Close, then awaited both before reopening. **The notes test is now green.**
- However, **tests 1 and 3 (the two RPE-chip tests) still fail** for the same race-condition reason. They tap a chip → immediately click Close → immediately reopen, with no gating on the PATCH + GET round-trip. So the menu re-mounts with stale `initialRpe = null` from the not-yet-refreshed cache, the chip is unselected on reopen, and `toHaveClass(/bg-emerald-500/)` correctly fails because the chip's class is `border border-gray-300 dark:border-gray-700` — not `bg-emerald-500`.
- The Tester v1 brief documented this race condition explicitly for the notes test, with a footnote that the same race surface exists for the RPE chip path. The Implementer fixed only the notes test. Generalizing the same gate to the two RPE tests is the v2.1 fix.

This is round 2 of the Implement↔Test loop. Round budget exhausted.

Recommendation to Conductor: **escalate / return to Implementer for a final mini-pass** (apply the same `waitForResponse` gate to the two RPE-chip tests). The fix is small and well-scoped, but mechanically we're at budget. See "What the Implementer must change in a v2.1 pass" below.

## Test commands

- [x] `npm run test:unit` — `Test Files 13 passed (13); Tests 198 passed (198)` (1.71s). Same as v1, no regression. Per-suite breakdown:
  ```
  ✓ tests/unit/units.test.ts (8)
  ✓ tests/unit/api-sets.updateSet.test.ts (7)
  ✓ tests/unit/api-sets.updateSetMeta.test.ts (7)
  ✓ tests/unit/use-sets.useUpdateSetMeta.test.ts (5)
  ✓ tests/unit/measurements-units.test.ts (11)
  ✓ tests/unit/formulas.test.ts (5)
  ✓ tests/unit/measurements-chart.test.ts (7)
  ✓ tests/unit/volume-target.test.ts (18)
  ✓ tests/unit/session-times-form.test.ts (30)
  ✓ tests/unit/dates.test.ts (13)
  ✓ tests/unit/weekly-volume-bucketing.test.ts (7)
  ✓ tests/unit/session-verdict-math.test.ts (21)
  ✓ tests/unit/progress-page-math.test.ts (59)
  ```
- [x] `npm run test:e2e -- tests/e2e/set-row-menu.spec.ts` — **1 pass / 2 fail** out of 3 tests (44.4s total).
  - ✓ `Notes commit on dismiss and survive reopen` (9.7s) — **v2 fix works**.
  - ✘ `RPE chip selection persists across reopen` (18.1s) — same race as the v1 notes failure.
  - ✘ `BLK-1 regression: editing reps after setting RPE preserves RPE` (14.8s) — same race.

- (Out of scope for v2 per the brief: typecheck, lint, adjacent-e2e regressions — re-running them was not requested and v2 modified no source code, only test code. Verified via `git status`: only `tests/e2e/set-row-menu.spec.ts` differs since v1 in the e2e tree.)

## Golden path (the v2 feature spec, re-run)

**Spec** (design-v3): per-set bottom-sheet menu (RPE + notes), with chip-tap committing immediately via `updateSetMeta` and notes committing on dismiss. Both isolated from the reps/weight `updateSet` writer.

**Steps run** (test 1, `RPE chip selection persists across reopen`):
1. Sign in fresh user, Quick-start a workout, add Bench Press, log one Working Set.
2. Click `Open set details` → menu opens. (visible: `Set 1 · Bench Press`).
3. Click `Set RPE to 9.0` chip.
4. Click `Close`.
5. Re-open the menu.
6. Assert the `Set RPE to 9.0` chip has `bg-emerald-500` class.

**Result**: **fail**.

**Evidence** (`test-results/set-row-menu-set-row-menu--7f78f-tion-persists-across-reopen/`):

PATCH from the chip-tap was extracted from the trace (`resources/729db540...json`):
```
PATCH /rest/v1/sets?id=eq.6642226c-...&select=*
  body: {"rpe":"9.0"}
  response: 200 (server time 41ms, wall time 410.93ms)
```
So the write succeeds. But the test re-opens the menu before the cache-refresh GET lands.

Playwright's final error on reopen:
```
Locator: getByLabel('Set RPE to 9.0')
Expected pattern: /bg-emerald-500/
Received string:  "css-view-g5y9jx r-cursor-1loqt21 r-touchAction-1otgn73
                   min-w-[44px] items-center justify-center rounded-full
                   px-3 py-2 border border-gray-300 dark:border-gray-700"
Timeout: 5000ms
  - 9 × locator resolved to <button … aria-label="Set RPE to 9.0"
       class="… border border-gray-300 dark:border-gray-700">
```

The locator resolved 9 times across the 5s polling window — it never flipped to emerald. That's the `<SetRowMenu>` mount-gating choice: `useState(initialRpe)` seeds **once** on mount, and on this reopen the prop is still `null` because the cache GET hasn't returned yet.

This is exactly the same race that v1 documented for the notes test, projected onto the chip path. Notes test (test 2) is now green because the v2 fix awaits the PATCH+GET there; tests 1 and 3 still don't.

## Edge cases

### Edge 1: Notes test (race fix landed)

**Steps**: Open menu → type "Felt heavy" → arm `waitForResponse` for PATCH and GET → Close → await both → reopen.

**Result**: **pass** (9.7s). The Implementer's v2 fix to the notes test is correct and complete.

**Evidence**:
```
  ✓  2 tests/e2e/set-row-menu.spec.ts:134:7 › Notes commit on dismiss and survive reopen (9.7s)
```

### Edge 2: BLK-1 regression — editing reps after setting RPE preserves RPE in the DB

**Steps**: Open menu → tap `Set RPE to 9.0` → Close → fill reps `5` → blur → wait 500ms → reopen → assert chip has `bg-emerald-500`.

**Expected** at the data layer: the reps PATCH body should be `{"reps":5,"weight":null}` (no `rpe`, no `notes` keys); DB row should retain `rpe=9.0`. This was v1-verified as **passing at the data layer** (test-report-v1 lines 112-117). The BLK-1 source-side fix is correct.

**Actual**: same race-condition failure as test 1 — the chip is unselected on reopen because the test reopens the menu before the `Set RPE to 9.0` PATCH cycle (and the subsequent reps PATCH cycle) drain through the cache. The `waitForTimeout(500)` covers the reps PATCH but not the initial RPE PATCH→GET round-trip; in practice both still race on a fresh re-mount.

**Result**: **fail (test harness only)**.

**Evidence**:
```
Locator: getByLabel('Set RPE to 9.0')
Expected pattern: /bg-emerald-500/
Received string:  "… border border-gray-300 dark:border-gray-700"
```

Important: the underlying BLK-1 source-side fix (split `updateSet` / `updateSetMeta`, partial-spread, `{reps,weight}`-only payload on inline blur) **was independently verified to work at the data layer in v1** (test-report-v1 lines 112-123) by direct inspection of the PATCH body in the trace. The v2 failure here is the same harness race, not a re-emergence of the BLK-1 bug.

### Edge 3 (positive evidence the data layer is correct)

The v2 trace's PATCH body for the chip tap is `{"rpe":"9.0"}` — `updateSetMeta` is sending the correct minimal payload. There is no data-layer regression.

## Regression check

- **Adjacent e2e suites**: not re-run (v2 modified test code only, scoped to `tests/e2e/set-row-menu.spec.ts`). Verified via `git status` that no other test or source file was touched in v2 relative to v1. The only changed file under the test tree is the one feature spec.
- **Unit suite**: 198/198 (matches v1). No regression from the v2 test-only changes (which is expected since v2 touched only one e2e spec).

## Cross-platform

- Web: **fail** — 2/3 feature e2e tests fail on the harness race.
- iOS: **not tested** — no iOS harness in repo.
- Android: **not tested** — no Android harness in repo.

## What the Implementer must change in a v2.1 pass

The v2 fix recipe for the notes test (lines 154-176) needs to be applied to the two RPE-chip tests too. Concrete diff sketch:

**Test 1** (`tests/e2e/set-row-menu.spec.ts:97-132`), insert between chip click and Close click (after line 111, before line 114):
```ts
// Tap the 9.0 chip.
const rpePatch = page.waitForResponse(
  (resp) =>
    resp.url().includes("/rest/v1/sets") &&
    resp.url().includes("id=eq.") &&
    resp.request().method() === "PATCH",
  { timeout: 10_000 },
);
const setsRefresh = page.waitForResponse(
  (resp) =>
    resp.url().includes("/rest/v1/sets") &&
    resp.url().includes("session_id=eq.") &&
    resp.request().method() === "GET",
  { timeout: 10_000 },
);
await page.getByLabel("Set RPE to 9.0").click();
await Promise.all([rpePatch, setsRefresh]);

// Close via the X button.
await page.getByLabel("Close").click();
…
```

**Test 3** (`tests/e2e/set-row-menu.spec.ts:188-221`), apply the same gate around `await page.getByLabel("Set RPE to 9.0").click()` at line 199. The existing `waitForTimeout(500)` after the reps blur can stay; it covers the reps PATCH separately. Or — better — replace `waitForTimeout(500)` with a `waitForResponse` for the reps PATCH (matches the spec's "no `rpe`/`notes` keys" intent and is deterministic).

Scope: test-file-only, ~15 lines net. Same pattern the Implementer already landed for the notes test; just generalized to the two remaining tests. No design re-open needed. The BLK-1 source-side fix has been verified working twice (v1 trace inspection + v2 trace PATCH body), so this is purely test harness.

## Notes for the Conductor

- BLK-1 fix is real and shipping. The v3 partial-spread `updateSet` was independently verified at the data layer in v1; v2 re-confirmed the chip's PATCH payload is the minimal `{"rpe":"9.0"}` form.
- The v2 fix loop closed the notes race (good). It left the RPE race open because the v1 brief described the race only in the notes context; the Implementer should have generalized.
- Per the round-budget rule (max 2 Implement↔Test rounds), this is the second test pass. Status is `budget-exhausted`. Recommendation: a final small Implementer pass to apply the same gate to the two remaining tests. If you want strict budget discipline, the alternative is to ship as-is and follow up with a separate fix run for the test harness — the production behavior is correct.
- No production source code modified by Tester. No diagnostic specs added or left behind. `git status` shows only the run docs + the in-progress test report v2.
