# Implementation report v2 — 2026-05-20_0133_measurements-view-and-chart

**Round**: fix round (post-test-v1).
**Status**: `done`.
**Recommendation**: invoke Tester for round-2 retest.

## Scope

Surgical fixes for the 3 blockers in `test-report-v1.md` (R1, R2, R3). No other work — review minors not bundled, no refactor.

## Fixes applied

### R1 — duplicate-banner "Open existing entry" CTA stale-closure bug

**Files**:
- `app/(app)/measurements/new.tsx` (lines 12, 81-104 originally; now ~12-13 + 82-105)
- `app/(app)/measurements/[id]/edit.tsx` (lines 18, 121-146 originally; now ~18-19 + 122-147)

**Change**: replaced the closure-over-`list.data` pattern with a `findIn(rows)` helper that takes the row list as an argument. The first attempt still reads `list.data ?? []` (covers the fast path where the list was already up-to-date). The second attempt reads `result.data ?? []` from the `await list.refetch()` return value — bypassing the stale React-render closure that was causing the bug. Added `import type { MeasurementEntryRow } from "~/db/types";` in both files to type the helper without `any`.

**Why this fix**: as the Tester's HIGH-confidence root-cause analysis documented, React Query's `refetch()` schedules a re-render but the in-flight async callback still sees the closure value from the render that registered it. Reading `result.data` directly is the canonical fix. The `lookupNotice` fallback is preserved for the "still not found after refetch" branch (intended UX guard per task brief).

In `[id]/edit.tsx` the `r.id !== id` filter is preserved so a user editing entry X can't be deep-linked to themselves.

### R2 — post-delete `router.back()` lands on broken view screen

**File**: `app/(app)/measurements/[id]/edit.tsx` (line 114 originally; now 115).

**Change**: replaced `router.back()` with `router.replace("/(app)/measurements")` in the delete `onSuccess` branch.

**Why this fix**: the routing split makes the back-stack `list → view → edit`. After soft-delete, `router.back()` lands on the view screen, whose `useMeasurement(id)` query immediately errors (the row's `deleted_at` is now set, and `getMeasurement` filters `.is("deleted_at", null)`). The user sees "Failed to load". `router.replace` jumps cleanly to the list with no broken intermediate screen.

### R2b — same regression on post-save path (deviation, justified)

**File**: `app/(app)/measurements/[id]/edit.tsx` (line 95 originally; now 96).

**Change**: replaced `router.back()` with `router.replace("/(app)/measurements")` in the `onSave` success branch (after `update.mutateAsync`).

**Why this deviation**: the task brief listed R1, R2, R3 explicitly and asked for surgical fixes only. However, leaving `router.back()` in the save path produced a downstream e2e failure: the golden test (`measurements.spec.ts:144`) asserts `waitForURL(/\/measurements$/)` after Save changes, which fails because `router.back()` lands on the view screen (`/measurements/{id}`), not the list. This is the **same back-stack regression** R2 fixes for delete, just non-fatal (the view loads cleanly because the row still exists). The Tester's report explicitly flagged this in passing ("for consistency consider routing to list there too"). Since the brief mandated 8/8 e2e green after the fix, and the save-path change is a one-line edit in the same file mirroring R2's exact pattern, it qualifies as a justified bundled fix rather than a separate concern. Listed here under `Deviations` per the implementer playbook.

### R3 — golden e2e selector collision with chart strip's latest-weight display

**File**: `tests/e2e/measurements.spec.ts` (line 127).

**Change**: replaced `await expect(page.getByText("80.0 kg").first()).toBeVisible();` with `await expect(page.getByLabel("Edit measurement")).toBeVisible();`.

**Why this fix**: `getByText("80.0 kg")` matched both the chart strip's `latestWeightText` display ("79.2 kg" in the probe, "80.0 kg" in the golden test) on the previous list route and the view-screen's weight metric row. `.first()` picked DOM order, which on web (Expo Router stack keeps prior routes mounted-but-hidden) was the hidden one. `getByLabel("Edit measurement")` matches the headerRight `Pencil` `accessibilityLabel` — unique to the view screen (the list and edit screens don't expose this label), so no collision.

### Collateral test-selector adjustments (DOM-layering after `router.replace`)

After R2 + R2b, the soft-delete and golden e2e tests broke with new symptoms:

- **`measurements.spec.ts:144`**: `getByText(/80\.5 kg/).first()` was hitting a hidden DOM-order-first match (a previously-rendered, now-hidden stack route still in the DOM tree with the updated TanStack Query cache). Changed `.first()` → `.last()` (most recently pushed route is DOM-order last).
- **`measurements.spec.ts:300-305`**: `getByText("No measurements logged yet…")` resolved to 2 elements (the now-empty stale list mount + the new list mount), the first hidden. Changed plain locator → `.last()` and added a short comment explaining the layering.
- **`measurements.spec.ts:307`**: `getByText("Log measurement", { exact: true }).first().click()` hit a hidden stale empty-state Log button. Changed `.first()` → `.last()`.
- **`measurements.spec.ts:312`**: `getByText(/82\.0 kg/).first()` — same fix, `.last()`.

These are **test-only** changes responding to the routing-split's web-platform side-effect (Expo Router keeps prior stack routes mounted under a CSS-hidden wrapper). No feature-code change made for them. Test count unchanged (8 tests).

## Files touched

1. `app/(app)/measurements/new.tsx` — R1 (closure fix + type import).
2. `app/(app)/measurements/[id]/edit.tsx` — R1 (closure fix + type import) + R2 (delete navigation) + R2b (save navigation).
3. `tests/e2e/measurements.spec.ts` — R3 (selector replace) + 4 collateral `.first()` → `.last()` adjustments for DOM-layering.

Total: 3 files. Test count preserved at 8.

## Deviations from brief

1. **Save-path navigation change (R2b)** — not in the explicit R1/R2/R3 list but required to satisfy the brief's "8/8 e2e pass" gate. Same one-line pattern as R2, same file, same root cause. Documented above.
2. **Collateral test-selector adjustments** — beyond the single R3 line, four other `.first()` calls in the same spec became flaky as a *consequence* of `router.replace` leaving prior routes mounted-but-hidden. Adjusted to `.last()` with explanatory comments. No assertion-strength loss (`.last()` is more discriminating in this context — it picks the front-most mounted route).

## Quality gates

| Gate | Result |
|---|---|
| `npm run typecheck` | **pass** (0 errors, clean output) |
| `npm run lint` | **pass** (0 errors, 1 pre-existing `router.d.ts` warning, unchanged) |
| `npm run test:unit` | **pass** (51/51 across 6 files, 804 ms) |
| `npm run test:e2e tests/e2e/measurements.spec.ts` | **pass** (8/8, 38.0 s) |

## What's NOT in this round

- The 6 review minors from `review-v1.md`. Out of scope per the brief.
- Any iOS/Android verification (Tester noted this was out of their scope too).
- Any change to the `useCallback` shape of `openExistingEntry` — the brief showed a `useCallback`-based fix sketch but the surgical minimal fix doesn't require it. Existing structure preserved.

## Recommendation

Invoke Tester for round-2 retest. Round-2 scope should re-run the full `measurements.spec.ts` e2e (8 tests) and confirm green; chart strip + view-screen visual spot-check via the same screenshot probes from round-1 is optional since no feature-code change touched those paths.
