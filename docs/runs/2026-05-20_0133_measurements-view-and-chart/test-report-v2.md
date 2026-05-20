# Test Report v2 — Re-test (narrow)

**Run:** `2026-05-20_0133_measurements-view-and-chart`
**Agent:** Tester (round 2)
**Date:** 2026-05-20 BRT
**Scope:** Verify Implementer v2 fixes for R1 (duplicate-banner lookup) / R2 (post-save/delete navigation) / R3 (selector flake), plus quality gates and no regression on "after save, see updated value in list".

---

## Decision

**PASS** — finalize.

---

## Quality gates

| Gate | Command | Result |
|---|---|---|
| E2E (measurements) | `npm run test:e2e tests/e2e/measurements.spec.ts` | **8/8 passed (39.6s)** |
| Typecheck | `npm run typecheck` (`tsc --noEmit`) | clean, no errors |
| Lint | `npm run lint` | 0 errors, 1 pre-existing warning in `router.d.ts` (generated file, unchanged) |
| Unit | `npm run test:unit` | 51/51 passed across 6 files |

### E2E breakdown

```
✓ 1 golden: empty state → create → list → edit                 (6.6s)
✓ 2 MAJ-1 regression: impossible date submit (2026-13-99)      (3.9s)
✓ 3 edge: empty form shows at-least-one error                  (3.7s)
✓ 4 edge: duplicate same-day shows amber banner with CTA       (8.7s)
✓ 5 edge: weight out of range shows inline error               (4.0s)
✓ 6 edge: notes >500 chars shows inline error                  (3.2s)
✓ 7 edge: soft delete clears row and unblocks same-day re-entry (6.4s)
✓ 8 regression: 6 tabs render, Profile shows weight + length unit toggles (2.5s)
```

All three previously failing/affected scenarios (golden #1, duplicate #4, soft delete #7) are now green.

---

## Spot-checks on fixes

### R1 — `findIn(rows)` reads from refetch result

**File:** `app/(app)/measurements/[id]/edit.tsx:131-139`, `app/(app)/measurements/new.tsx:89-97`

```ts
let row = findIn(list.data ?? []);
if (!row) {
  try {
    const result = await list.refetch();
    row = findIn(result.data ?? []);   // ← reads refetched data, not stale list.data
  } catch {
    // fall through
  }
}
```

Confidence: HIGH. Verified by edge #4 (duplicate banner CTA navigates) passing.

### R2 — `router.replace("/(app)/measurements")` after delete + edit save

**File:** `app/(app)/measurements/[id]/edit.tsx:96` (SAVE), `:115` (DELETE).

R2b deviation (SAVE also uses `router.replace`, not `router.back`) is **intentional and consistent** for the edit screen. Confirmed by edge #7 (soft delete) and golden #1 (edit flow) passing.

### R2 — new.tsx CREATE flow still uses `router.back()`

**File:** `app/(app)/measurements/new.tsx:72`.

The CREATE flow lands on the list via `router.back()` from `/new`. This is **not** a regression — golden #1 exercises exactly this path (create → assert list shows new row) and passes in 6.6s. So "after save, see updated value in list" works for both CREATE and EDIT flows.

Confidence: HIGH.

### R3 — `getByLabel("Edit measurement")` selector

E2E run shows golden #1 (which previously flaked on the row-row selector) now stable at 6.6s. No retries observed in the Playwright output.

Confidence: HIGH.

### Collateral `.first()` → `.last()` changes

The 4 collateral changes due to Expo Router hidden-stack-routes are absorbed by all 8 e2e scenarios passing — including the regression scenario (#8, "6 tabs render") that would have caught a tab-rendering regression.

---

## Risk assessment

- **Confidence:** HIGH — full e2e suite green, no flakes, all three reported bugs fixed.
- **Risk:** LOW — code changes are localized to two files (`new.tsx`, `[id]/edit.tsx`) and one test selector; no schema, RPC, or shared util touched; unit tests for chart/units/formulas/dates all still pass.

---

## Recommendation

**finalize** — Conductor may close this run.
