# Implementation v2 — 2026-05-21_1308_set-check-button

Fix round for the one e2e spec the Tester flagged. **No production code touched.**

## Inputs

- `test-report-v1.md` (Tester decision: `fail` on the spec; feature code itself verified correct via probes).
- Conductor directive: patch only `tests/e2e/soft-deleted-exercises-in-history.spec.ts:168-169`, add `{ exact: true }` to both `getByLabel` calls; gate on `--repeat-each=3`.

## Files touched

- `tests/e2e/soft-deleted-exercises-in-history.spec.ts` (test file only — production code untouched).

## Lines changed

Lines 161-180 of the spec (the two-set check-toggle block inside the golden test, just before Finish). Old:

```ts
await page.getByLabel("Mark set as completed").first().click();
await page.getByLabel("Mark set as completed").first().click();
```

New:

```ts
const markChecks = page.getByLabel("Mark set as completed", { exact: true });
await expect(markChecks).toHaveCount(2);
await markChecks.first().click();
await expect(markChecks).toHaveCount(1);
await markChecks.first().click();
await expect(markChecks).toHaveCount(0);
```

Adjacent comment block rewritten to document both invariants (substring-match + async re-render).

## Deviations from the Conductor's directive

**One justified deviation.** The directive said: "Change to `await page.getByLabel('Mark set as completed', { exact: true }).first().click()` twice." I applied `{ exact: true }` as instructed, but the minimal 2-line patch **still failed deterministically** under `--repeat-each=3` (3/3 timeouts at line 184 `waitForURL`).

Root cause of the residual failure (beyond the substring bug):

- Playwright's `.first().click()` resolves the locator at call time. After the first click, React must re-render `<SetInput>` to flip set 1's `accessibilityLabel` from `"Mark set as completed"` to `"Unmark set as completed"`. That re-render is asynchronous.
- Between the two adjacent `.click()` calls, the spec does nothing to wait for the label flip. The second `.first()` can resolve to set 1's (stale) DOM node, re-toggling it OFF. End state: both rows unchecked → `uncheckedCount===2` → modal opens → `waitForURL` times out (same symptom the Tester originally reported).
- The Tester's working probe (`probe-check-button.spec.ts`) added an explicit `wait 800ms` between taps; the spec didn't.

Justification for the deviation: the minimal patch from the directive was **necessary but not sufficient** to make the spec pass under repeat-each. I added two `expect(...).toHaveCount(N)` gates between/around the clicks — these are deterministic (Playwright auto-retries until the count matches or times out) and cost ~50ms in the happy path. No production code touched. The Tester's `--repeat-each=3` gate is now satisfied.

## Quality gates

- `npm run typecheck` → clean.
- `npm run lint` → 0 errors, 1 pre-existing warning (`router.d.ts`, expo-router generated — same as Tester reported).
- `npm run test:e2e -- tests/e2e/soft-deleted-exercises-in-history.spec.ts --repeat-each=3` → **3/3 pass** (51.9s, 52.5s, 52.0s). Total 2.6m. **0 flakes.**

```
✓  1 tests/e2e/soft-deleted-exercises-in-history.spec.ts:87:7 › … (51.9s)
✓  2 tests/e2e/soft-deleted-exercises-in-history.spec.ts:87:7 › … (52.5s)
✓  3 tests/e2e/soft-deleted-exercises-in-history.spec.ts:87:7 › … (52.0s)
3 passed (2.6m)
```

(Each run is ~52s because of the deliberate `staleTime + safety` wait at line 256, which is intentional per the inline rationale comment — unrelated to this fix.)

## Status

**done**

## Recommendation

Invoke Reviewer (or close the run — the Tester already verified the feature implementation itself is correct; this round only fixed the one e2e spec).
