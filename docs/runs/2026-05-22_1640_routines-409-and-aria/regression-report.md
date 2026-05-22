# Regression report — 2026-05-22_1640_routines-409-and-aria

Testing the two fixes in `src/components/exercise-picker.tsx`:

1. **Bug 1 (409 race)** — per-row `pickingId` in-flight guard on the row Pressable.
2. **Bug 2 (aria-hidden)** — `Modal.onShow` blurs `document.activeElement` on web.

## Environment

- Web server: `CI=1 npx expo start --web --port 8081` (port held by a stale lock from a defunct expo process initially; relaunched non-interactive once cleared).
- Playwright: `1.59.1`, headless Chromium, `baseURL=http://localhost:8081`, `workers=1`.
- Result aggregation: forced JSON reporter via `PLAYWRIGHT_JSON_OUTPUT_NAME=…` to bypass terminal truncation in this env.
- Baseline commit: `9bdcbc7` (state.md). Working tree contains only the fix to `src/components/exercise-picker.tsx` + the new `tests/e2e/routines-add-exercise-race.spec.ts`.

## Quality gates

| Gate | Command | Result | Notes |
|---|---|---|---|
| TypeScript | `npm run typecheck` (`tsc --noEmit`) | **pass** | exit 0, no output |
| Lint | `npm run lint` (`expo lint`) | **pass** | 0 errors; 1 pre-existing warning in `router.d.ts` (unrelated) |
| Unit tests | `npm run test:unit` (vitest) | **pass** | 229/229 across 14 files in 1.45s |

## E2E results

| File | Test | Status | Duration | Notes |
|---|---|---|---|---|
| `tests/e2e/routines-add-exercise-race.spec.ts` | rapid double-click on the same row fires only one POST and inserts one row | **PASS** | ~7s | After conductor applied `.first()` fix to line 137 (per Finding 1). Re-run confirmed 1 POST, 201, 1 row. |
| `tests/e2e/crud.spec.ts` | routines: create, see in list, open detail, delete | pass | (part of 88.97s suite) | |
| `tests/e2e/crud.spec.ts` | exercises: create custom exercise (alongside seeded library) | **FAIL** | 60s timeout | **Pre-existing, not a regression** — see Finding 2. |
| `tests/e2e/crud.spec.ts` | workout: start ad-hoc, finish, see in history | pass | — | |
| `tests/e2e/crud.spec.ts` | history: edit started_at backward by 1h, duration updates | pass | — | |
| `tests/e2e/crud.spec.ts` | history: edit started_at across ISO-week boundary — list moves, strip stays | pass | — | |
| `tests/e2e/crud.spec.ts` | profile: weight unit toggle to lbs persists across reload | pass | — | |
| `tests/e2e/set-row-menu.spec.ts` | RPE chip selection persists across reopen | pass | (24.98s file total) | |
| `tests/e2e/set-row-menu.spec.ts` | Notes commit on dismiss and survive reopen | pass | — | |
| `tests/e2e/set-row-menu.spec.ts` | BLK-1 regression: editing reps after setting RPE preserves RPE | pass | — | |

## Findings

### Finding 1 (BLOCKING) — selector bug in the new e2e file

`tests/e2e/routines-add-exercise-race.spec.ts:137`:

```ts
await expect(page.getByText("Exercises", { exact: true })).toBeVisible({
  timeout: 10_000,
});
```

Playwright strict-mode violation (verbatim, captured from JSON reporter):

```
Locator: getByText('Exercises', { exact: true })
Expected: visible
Error: strict mode violation: getByText('Exercises', { exact: true }) resolved to 2 elements:
    1) <div ...>Exercises</div> aka getByText('Exercises').first()
    2) <div ...> aka getByRole('tab', { name: 'Exercises' })

  at /Users/gustavoinacio/github/ada11/tests/e2e/routines-add-exercise-race.spec.ts:137:66
```

Root cause: the routine detail page has two elements with the exact text "Exercises" — the workout-tab in the bottom nav (`getByRole('tab', { name: 'Exercises' })`) and the section header on the routine page (`app/(app)/routines/[id]/index.tsx:184`). The new test forgot `.first()`. The five other e2e tests in the suite that target the same string already call `.first()`:

- `tests/e2e/measurements.spec.ts:330`
- `tests/e2e/exercise-progress-ia.spec.ts:82, 162`
- `tests/e2e/probe-strong-unify.spec.ts:72`

**Fix**: add `.first()` to the locator chain at line 137. One-character change in the test file. No product code change needed.

### Finding 2 (NOT a regression — pre-existing stale test)

`tests/e2e/crud.spec.ts:150` — `page.getByPlaceholder("e.g. Chest").fill("Biceps")` times out after 60s because the "Muscle" text field with placeholder `e.g. Chest` no longer exists in the product:

- Commit **`b51dd01` — feat: exercises track muscles as required multi-select array** (2026-05-19, 3 days before this fix) replaced the free-text `primary_muscle` field with a fixed-enum multi-select (`Chest · Upper back · Lower back · Shoulders · Arms · Legs · Core`).
- Grepping the entire `app/` and `src/` trees for `e.g. Chest` returns zero hits.
- Working-tree diff confirms only `src/components/exercise-picker.tsx` is changed; no product change in this run touches the exercises-create form.

The crud subtest is stale and should be updated by a follow-up — out of scope here. **Recorded as known-flake; does NOT fail the gate.**

## Direct verification that the fixes themselves work (out-of-band probes)

To prove Finding 1 is a test-only defect and the product fixes do work, I ran two throwaway Playwright probes against the running web app. Both were created in `tests/e2e/__probe-*.spec.ts`, executed, and deleted (they are not committed).

### Probe A — aria-hidden absence (Bug 2)

Reproduces the original repro path: sign in → navigate to `/routines/{id}` → click `Add exercise` → wait → assert no `aria-hidden` console warning.

```
PASS aria-hidden probe — open routine, click Add exercise, verify no aria-hidden warning
STDOUT: ARIA_WARNINGS_COUNT=0
```

**Conclusion**: `Modal.onShow` blurring `document.activeElement` suppresses the warning. **Bug 2 fix verified.**

### Probe B — race-safe insertion (Bug 1)

Same as the failing official e2e, with the selector typo fixed (`.first()` added):

```
PASS race probe (selector-corrected): double-click → 1 POST, 1 row, no 409
STDOUT: INSERTS_COUNT=1
STDOUT: INSERT_STATUS=201
STDOUT: DB_ROW_COUNT=1
```

- Exactly **1** POST to `/rest/v1/routine_exercises`.
- That POST returned **201** (not 409).
- DB end-state: **1** row in `routine_exercises` for the routine.

**Conclusion**: the `pickingId` in-flight guard prevents the double-fire. **Bug 1 fix verified.**

## Adjacent regression checks (summary)

- **`<ExercisePicker>` on the workout flow** (covered by `tests/e2e/crud.spec.ts > workout: start ad-hoc, finish, see in history` and `set-row-menu.spec.ts`): **pass**. No regression to the live workout consumer of the picker.
- **Modal pattern (`set-row-menu.spec.ts`)**: **pass** (3/3). The `onShow` `document.activeElement.blur()` is scoped to the picker's Modal and does not affect other Modals.

## Code-level confirmation

| File | Before | After |
|---|---|---|
| `src/components/exercise-picker.tsx:24` | `onPick: (exercise: ExerciseRow) => void` | `onPick: (exercise: ExerciseRow) => void \| Promise<void>` |
| `src/components/exercise-picker.tsx:31` | n/a | `const [pickingId, setPickingId] = useState<string \| null>(null);` |
| `src/components/exercise-picker.tsx:54-60` | `<Modal …>` without `onShow` | `<Modal … onShow={() => { if (typeof document !== "undefined") (document.activeElement as HTMLElement \| null)?.blur(); }}>` |
| `src/components/exercise-picker.tsx:106-152` | sync `onPress`; no busy flag | `async onPress` with `try/finally` around `pickingId`; `disabled = already \|\| isBusy`; spinner in-row |

## Out-of-scope confirmation

- iOS / Android RN paths untouched. Bug 2 fix is correctly guarded by `typeof document !== "undefined"`.
- No DB / schema / migration / RLS change.
- No call-site change in `app/(app)/routines/[id]/index.tsx` or `app/(app)/workout/[sessionId].tsx`.

## Decision

**PASS** (after conductor applied the one-character `.first()` fix to `tests/e2e/routines-add-exercise-race.spec.ts:137`). Re-running the new race spec + `set-row-menu` adjacent suite on the running web app: **4 passed (30.7s)**.

### Original first-pass decision (preserved for trace)

Tester initially returned FAIL — test-only reason (Playwright strict-mode collision in the newly added test). Conductor applied the recommended one-character fix and re-verified. No product code change needed.

**Reasoning**:

- The product fixes in `src/components/exercise-picker.tsx` are correct and have been verified dynamically against the running app (probes A and B above).
- The committed e2e `tests/e2e/routines-add-exercise-race.spec.ts` is part of the Implementer's deliverable and must pass under `npm run test:e2e`. It does not — line 137 violates Playwright strict mode. This is the same test the next CI run / PR review will execute.
- Returning `pass` while a test in the diff fails would mis-report the gate. Route back to Implementer for the one-line selector fix.

**What the Implementer must address (single change)**:

In `tests/e2e/routines-add-exercise-race.spec.ts:137`, change

```ts
await expect(page.getByText("Exercises", { exact: true })).toBeVisible({
```

to

```ts
await expect(page.getByText("Exercises", { exact: true }).first()).toBeVisible({
```

No product code change is needed; no other adjustments needed in this file. Re-running the e2e after that one-character addition will produce the same successful trace already captured by Probe B.

## Follow-ups (do NOT block this run)

- `tests/e2e/crud.spec.ts:150` is stale due to the muscles-as-multi-select migration (`b51dd01`). Worth a small dedicated PR to repair the "exercises: create custom exercise" subtest. Do not lump into this routines/aria run.

## Post-deploy manual verification (filled in after user confirms)

- Verified by user on <environment>: <pass | fail>.
- Confirmation timestamp (BRT): <YYYY-MM-DD HH:mm>.
- User statement: "<verbatim>"
