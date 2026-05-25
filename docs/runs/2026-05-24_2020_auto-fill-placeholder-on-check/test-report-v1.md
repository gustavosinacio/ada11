# Test report v1 — 2026-05-24_2020_auto-fill-placeholder-on-check

Round: Implement↔Test **round 1 of 2**.
Testing: `implementation.md` against `design-v3.md`.

## Decision

**fail** — 2/10 e2e specs in the new file fail, but **both failures are confirmed test-design bugs, NOT implementation defects**. The feature itself works correctly (verified via corrected versions of both specs which pass in isolation). Quality gates and BLK-1 regression guards pass cleanly.

**Recommendation**: return to Implementer with a narrow, surgical brief: fix the two test-design issues in `tests/e2e/auto-fill-placeholder-on-check.spec.ts` (E6 substring-match collision, E10 premature DB read). No source-code change required.

## Environment

- Commands used to run app: `npm run web` (Expo web on http://localhost:8081)
- Dev server: started fresh before this round, served all e2e runs.
- Browser: Playwright headless (Chromium 1.59.1)
- Test data: ephemeral users per spec, seeded via `supabase service_role`.
- Today's date: 2026-05-24 (BRT).

## Quality gates

| Command | Result |
|---|---|
| `npm run typecheck` | **PASS** — `tsc --noEmit` clean (0 errors). |
| `npm run lint` | **PASS** — 0 errors, 1 pre-existing `router.d.ts` warning (out of scope). |
| `npm run test:unit` | **PASS** — 21 files / 347 tests / all green (matches Implementer's claim). New `tests/unit/auto-fill-set.test.ts` contributes 15/15. |
| `npx playwright test tests/e2e/auto-fill-placeholder-on-check.spec.ts` | **8 / 10 pass, 2 fail** — see Edge cases below. |

Unit-test command output (last lines):
```
 Test Files  21 passed (21)
      Tests  347 passed (347)
   Start at  21:06:07
   Duration  1.81s
```

## Golden path

**Spec** (from design v3 §"E2E test cases", E1): prior session 120 kg × 8, fresh empty working set → tap check → row's `weight="120.00"`, `reps=8`, `completed_at != null`; visible inputs render `"120"` and `"8"`.

**Result**: **pass**

**Evidence**:
- E2E spec `E1` passed in 12.4s — assertion `parseFloat(row.weight) === 120` + `row.reps === 8` + `row.completed_at != null` all green.
- Screenshot `screenshots/01-empty-placeholder.png` shows the empty-input row with placeholders "120" and "8" before the check.
- Screenshot `screenshots/02-after-check-autofill.png` shows the row after the check: green-tinted background, "✓" icon, weight `120`, reps `8`, header volume = `960 kg` (one set of 120 × 8), rest timer counting `1:00` (routine target rest fires per design).

## BLK-1 regression guards (load-bearing per playbook)

### E2 — typed weight `"100"` (no blur) + empty reps + previous 120 × 8 → tap check
**Spec**: typed value survives; reps auto-fill from previous; weight NEVER becomes 120.

**Result**: **pass**

**Evidence**:
- E2 spec passed (8.5s). Assertion: `row.reps === 8` (load-bearing positive); `if row.weight != null: parseFloat(row.weight) === 100` (typed-value survives, never 120).
- Screenshot `screenshots/03-mid-typing-race-survived.png` shows the typed `"100"` in the weight input, reps `"8"` auto-filled, volume `800 kg` (= 100 × 8 — NOT 960). The placeholder "120" did NOT overwrite the typed `"100"`.
- Network log from a debug instrumentation run confirms only one PATCH fires for the dropset's `id` with the partial `updateSet` patch — no `weight: "120"` clobber.

### E3 — typed reps `"5"` (no blur) + empty weight + previous 120 × 8 → tap check
**Spec**: typed reps survives; weight auto-fills from previous (120).

**Result**: **pass**

**Evidence**:
- E3 spec passed (8.1s). Assertion: `parseFloat(row.weight) === 120` (load-bearing positive auto-fill); `if row.reps != null: row.reps === 5` (typed-value survives, never 8).

## Edge cases

### E4 — no previous set → check empty
**Result**: **pass** (8.1s). DB row stays `weight=null, reps=null, completed_at != null`.

### E5 — warmup set → check empty → no auto-fill (handler gate)
**Result**: **pass** (8.2s). Warmup row stays `weight=null, reps=null` even though previous 120 × 8 exists. Gate at `app/(app)/workout/[sessionId].tsx:521` (`isWorking = toggled?.set_type === "working"`) holds.

### E6 — dropset → check empty → no auto-fill (handler gate)
**Result**: **fail (TEST defect, not implementation)**.

**Spec assertion that failed**:
```
expect(page.getByLabel("Unmark set as completed").nth(1)).toBeVisible({ timeout: 5_000 });
```
Times out: only 1 "Unmark" button exists at the assertion moment.

**Root cause (verified)**:
- Playwright's `getByLabel("Mark set as completed")` does **substring** matching by default. The accessibility label string `"Mark set as completed"` is a substring of `"Unmark set as completed"`, so the locator matches BOTH labels.
- E6 seeds the parent working set as already-checked (required by DB constraint — drop set must chain off a working set). The parent's button has aria-label `"Unmark set as completed"`.
- When the test runs `getByLabel("Mark set as completed").first().click()`, Playwright picks the FIRST element matching the substring — which is the parent (aria-label = `"Unmark set as completed"`, DOM-position-0).
- Result: the click UNCHECKS the parent instead of CHECKING the dropset.

**Verified via**:
1. Debug-instrumented Playwright spec captured network requests after the click: `PATCH /rest/v1/sets?id=eq.<parentId>&deleted_at=is.null body={"completed_at":null}` (parent UNCHECK), with NO subsequent `checkSet` call on the dropset.
2. Final DB state: parent's `completed_at` was set to `null` (was originally a timestamp); dropset's `completed_at` was still `null`. Volume in header went from 800 kg → 0 kg between pre-click and post-click screenshots.
3. Other tests in the same file (E1-E4, E5, E7-E9) work because they have NO already-checked rows when the click fires — the substring collision is invisible.
4. **The same E6 test rewritten with `getByLabel("Mark set as completed", { exact: true }).first().click()` PASSES in 9.4s.** Dropset's `completed_at` flips, `weight` and `reps` stay null. The dropset-gate in the screen handler works exactly as designed.

**Implication**: the dropset gate is correct in the source. The test's selector is wrong.

### E7 — uncheck then re-check → no spurious second auto-fill
**Result**: **pass** (12.9s). After the first check, row has `weight="120.00", reps=8`. Uncheck (only `completed_at` flips), then re-check: predicate sees row already filled → `computeAutoFillPayload` returns null → no extra `updateSet` round-trip → values unchanged.

### E8 — bulk "Check all and finish" → no auto-fill
**Result**: **pass** (10.6s). Both sets get `completed_at` set by the bulk path but NEITHER gets `weight` / `reps` auto-filled. Bulk path bypasses `onToggleSetChecked` entirely (uses `useBulkCheckAllInSession`), as intended.

### E9 — lbs mode → lbs-converted display, canonical kg persisted
**Result**: **pass** (9.9s). Placeholder renders `"264.6"` (= `120 / 0.45359237 ≈ 264.5547`, then `.toFixed(1)`); after check, persisted `weight = 120.00` (canonical kg, not lbs-rounded).

### E10 — rest-timer regression (both inputs already filled → predicate null → no extra await)
**Result**: **fail (TEST defect, not implementation)**.

**Spec assertion that failed**:
```
expect(row.completed_at).not.toBeNull();
```

**Root cause (verified)**:
- Per the implementation handler (`app/(app)/workout/[sessionId].tsx:528-551`), the order of side-effects on the auto-fill path is:
  1. `Keyboard.dismiss()` (sync)
  2. compute auto-fill patch (sync, returns null for E10 since `currentInput` already has values)
  3. `restTimer.start(rest)` (sync, optimistic — overlay flips to "Resting" immediately)
  4. **`await checkSetM.mutateAsync(id)`** (async — actually writes `completed_at` to DB)
- The test assertion sequence is:
  1. `await page.getByLabel("Mark set as completed").first().click();`
  2. `await expect(page.getByText("Resting", { exact: true })).toBeVisible({ timeout: 5_000 });` ← waits for step 3 above (sync overlay flip, happens BEFORE the checkSet write lands).
  3. `const row = await getSet(setId);` ← reads DB immediately after the overlay flip, before step 4's PostgREST round-trip has had time to complete.
- The test reads `completed_at` too early — between step 3 (overlay shows "Resting") and step 4 (checkSet mutation lands).

**Verified via**:
1. The trace HTML at the failure moment confirms `"Resting"` IS present in the DOM (timer started). So the implementation's step-3 ran correctly.
2. **The same E10 test rewritten to additionally wait for the row's check-button to flip to "Unmark set as completed" (which is only visible AFTER `checkSet` invalidates the sets query) PASSES in 10.3s.** All other E10 assertions (`parseFloat(weight) ≈ 90`, `reps === 6`, `completed_at != null`) hold.

**Implication**: the timer-firing semantics work. The post-click DB-read in the test is racing the awaited mutation.

## Regression sweep

Ran `tests/e2e/rest-timer-auto-start.spec.ts`, `tests/e2e/end-of-session-verdict.spec.ts`, `tests/e2e/crud.spec.ts` in a single batch.

**Summary**: 14 passed, 1 unexpected (pre-existing, unrelated).

| Spec | Pass / Total | Notes |
|---|---|---|
| `rest-timer-auto-start.spec.ts` | **7 / 7** | All variants pass: working-set fires timer, warmup stays idle, dropset stays idle, re-check restarts timer, exercise-without-rest stays idle, bulk-check does NOT fire timer, nav-away survival. Confirms the new screen-handler reorder (rest-timer between auto-fill `await` and `checkSet`) is byte-identical on the no-fill path. |
| `end-of-session-verdict.spec.ts` | **2 / 2** | Case A (bulk-check finish-with-PR) and Case B (zero-volume empty state) both pass. The bulk-check path is untouched by the implementation; PR verdict logic still correct. |
| `crud.spec.ts` | **5 / 6** | 5 pass: routines CRUD, ad-hoc workout flow, history start_at backward edit, history ISO-week-boundary edit, weight-unit toggle. **1 timeout (PRE-EXISTING)**: `"exercises: create custom exercise (alongside seeded library)"` times out on `getByPlaceholder("e.g. Chest")` because the exercises/new screen migrated from text-input to chip-picker (per commit 9b99a69 / 895716f range), but the test was not updated. Git blame: line 150 last touched 2026-05-19 in commit 682b0ec, well before this run. **Unrelated to auto-fill changes**: this implementation does not touch `app/(app)/exercises/new` or its component tree. Re-ran the test in isolation — same timeout, same `e.g. Chest` placeholder error. |

## Cross-platform

- **Web**: tested via Expo web build (`npm run web` on http://localhost:8081). Pass on the 8/10 e2e specs + golden path manual verification via screenshots.
- **iOS / Android**: not tested. The implementation is pure JS through React Native (`Keyboard.dismiss()` is the only native call and is documented as non-load-bearing UX polish). The auto-fill correctness flows through synchronous callback args, which is platform-agnostic. **Not a blocker** for the decision per playbook scope (web is the e2e harness).

## Screenshots

Saved under `docs/runs/2026-05-24_2020_auto-fill-placeholder-on-check/screenshots/`:

| File | Captures | Validates |
|---|---|---|
| `01-empty-placeholder.png` | Empty Bench Press row 1, weight placeholder shows `120`, reps placeholder shows `8`. Volume header `0 kg`. | The placeholder source (`previousByRowId` → `useLastWorkingSet`) populates from the prior session. |
| `02-after-check-autofill.png` | Bench Press row 1 checked (✓, green tint), weight `120`, reps `8` visible. Volume `960 kg`. Rest-timer overlay shows `1:00`. Banner: "Matched your previous best — one more rep is a PR". | Auto-fill landed → DB row updated → cache invalidated → `<SetInput>` useEffect resync'd local state → input shows crisp value. PR verdict ribbon already correct. |
| `03-mid-typing-race-survived.png` | Bench Press row 1 checked (✓, green tint), weight shows the typed `100` (not `120`), reps auto-filled to `8`. Volume `800 kg` (= 100 × 8 — proves typed survived). Rest-timer `0:59`. | BLK-1 closed. The typed-but-unblurred string is honored; the placeholder value never clobbers it. |

## Diagnosis of the two e2e failures (for the Implementer)

Both failures are 1-line test-only edits. The implementation itself does not need to change.

### E6 fix
At `tests/e2e/auto-fill-placeholder-on-check.spec.ts:602` (and any other ambiguous-context `getByLabel("Mark/Unmark set as completed")` call site in the file), pass `{ exact: true }` so the substring collision goes away:
```ts
// before
await page.getByLabel("Mark set as completed").first().click();
await expect(page.getByLabel("Unmark set as completed").nth(1)).toBeVisible(...)

// after
await page.getByLabel("Mark set as completed", { exact: true }).first().click();
await expect(
  page.getByLabel("Mark set as completed", { exact: true }),
).not.toBeVisible({ timeout: 5_000 });
```
The wait-condition can rely on the only-unchecked-row becoming checked (so the Mark count drops to zero), avoiding `nth(1)` indexing.

**Also recommended**: apply `{ exact: true }` to E1, E2, E3, E4, E5, E7, E8, E9, E10 too. They pass today because none of them seed a pre-checked row that would trigger the collision — but the brittle pattern lingers. One-line each, lower-risk for future edits.

### E10 fix
At `tests/e2e/auto-fill-placeholder-on-check.spec.ts:866-868`, wait for the actual `checkSet` settlement before reading the DB. The cleanest signal is the check-button flipping label:
```ts
// before
await expect(page.getByText("Resting", { exact: true })).toBeVisible({ timeout: 5_000 });
const row = await getSet(setId);

// after
await expect(page.getByText("Resting", { exact: true })).toBeVisible({ timeout: 5_000 });
await expect(
  page.getByLabel("Unmark set as completed", { exact: true }).first(),
).toBeVisible({ timeout: 5_000 });
const row = await getSet(setId);
```
The "Resting" overlay is the optimistic indicator; the "Unmark" button only renders after `checkSet` invalidates the sets query.

## Decision rationale

Per the conductor brief's decision rules:
- **Pass = golden + BLK-1 regressions + edges + regression sweep + screenshot all green.**
- **Fail = BLK-1 regression failing is automatic fail.**

BLK-1 regressions (E2 / E3) **pass**. Golden (E1) **pass**. BLK-2-related history-edit screen mounting (verified by reading review v1's diff and the unchanged history-edit caller signature — no `showCheckable`, no `onToggleSetChecked`) — implicit pass (no test touches it).

But: E6 and E10 specs fail. Per the strict reading of the rule ("regression sweep + screenshot all green"), I cannot mark these as `pass`. The failures are TEST defects, not implementation defects — verified by independent corrected reproductions of both — but they remain failing assertions in the suite the Implementer wrote.

**Returning to Implementer (Round 2) with a narrow brief**: fix the two e2e test-design issues (E6 substring, E10 read-race). No source change.

## Test commands (full list)

- [x] `npm run typecheck` — clean, 0 errors.
- [x] `npm run lint` — 0 errors, 1 pre-existing warning.
- [x] `npm run test:unit` — 21 files / 347 tests / all pass (includes new `tests/unit/auto-fill-set.test.ts` 15/15).
- [~] `npx playwright test tests/e2e/auto-fill-placeholder-on-check.spec.ts` — 8/10 pass. E6 and E10 fail (test defects, not impl).
- [x] `npx playwright test tests/e2e/rest-timer-auto-start.spec.ts` — 7/7 pass (regression sweep).
- [x] `npx playwright test tests/e2e/end-of-session-verdict.spec.ts` — 2/2 pass (regression sweep).
- [~] `npx playwright test tests/e2e/crud.spec.ts` — 5/6 pass; 1 pre-existing unrelated timeout (`exercises/new` UI changed, test stale).

## Confidence / risk

- **Confidence: HIGH** that the auto-fill feature works correctly on the golden path, BLK-1 mid-typing race, warmup gate, dropset gate, lbs mode, and bulk-check bypass.
  - Evidence: 8/10 specs pass, plus 2 corrected reproductions of E6/E10 also pass, plus 3 screenshots show the expected UI states.
- **Confidence: HIGH** that the two failures are test-design bugs, not implementation bugs.
  - Evidence: Playwright `getByLabel` substring-match behaviour is documented; the E6 corrected version passes; E10's read-race is mechanically obvious from the implementation's `await` order and confirmed by the corrected-spec passing.
- **Risk: LOW** that the implementation has hidden defects.
  - Manual-commit path is byte-identical to today (per design v3 §"Resposta a issues do Validator"). Unit tests cover the helper. The other regression suites pass byte-identically.
- **Risk: LOW** that fixing the two tests will surface new issues. The fixes are mechanical (`{ exact: true }` and a wait-for-label step) and aligned with selector patterns already used elsewhere in the repo (e.g. `soft-deleted-exercises-in-history.spec.ts:..."Arms", { exact: true }`).
