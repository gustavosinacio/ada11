# Test report v1 — 2026-05-19_2353_measurements-tracking

Testing: implementation against `design-v2.md` and `review-v1.md` (which flagged MAJ-1).

## Environment

- Commands used to run app:
  - `npm run web` — Expo web dev server on `http://localhost:8081` (already running from a prior shell; the new invocation detected port collision and skipped).
  - `npx playwright test tests/e2e/measurements.spec.ts` — new Playwright spec authored for this run.
  - `set -a && . ./.env.local && set +a && npx tsx tests/rls.test.ts` — RLS integration test.
  - `set -a && . ./.env.local && set +a && npx tsx tests/seed-and-auth.test.ts` — seed/auth integration test.
- Browser / device: Chromium (Playwright headless) targeting Expo web, RN-web 0.21.0, Expo SDK 54.
- Test data: fresh confirmed users created per-test via the Supabase admin API; users (and their cascaded rows) deleted in `afterAll`.
- Tooling versions: Playwright 1.59.1, Vitest 3.2.4, Node 23.10.

## Test commands

- [x] `npm run typecheck` — passed, no errors.
- [x] `npm run lint` — `0 errors, 1 warnings` (only the pre-existing `router.d.ts` warning).
- [x] `npm run test:unit` — `44 passed (44)` across 5 files (including the new `measurements-units.test.ts` with 11 tests).
- [x] `npx tsx tests/rls.test.ts` — `RLS test passed — B cannot read/update/delete A's data.` (covers both `exercises` and `measurement_entries`).
- [x] `npx tsx tests/seed-and-auth.test.ts` — passed. `user_preferences seeded (weight_unit=kg, length_unit=cm)` + `exercises seeded (31 rows)`. Confirms `seed_new_user()` was untouched (MAJ-1 Path A) and the `length_unit` default fires correctly.
- [x] `npx playwright test tests/e2e/measurements.spec.ts` — **7 passed / 1 failed** (the 1 failure is the MAJ-1 detector intentionally throwing to flag the live crash; see MAJ-1 section).

## Golden path

**Spec** (from design): empty state → tap "Log measurement" → fill 6-section form (5 metrics + notes) → save → row appears in list with headline metrics + notes preview → tap row → edit screen pre-populates with display strings → change weight → save while `isDirty` → list reflects updated value.

**Steps run** (in `tests/e2e/measurements.spec.ts > golden`):

1. Create confirmed user via admin API; sign in; land on `/workout`.
2. Tap "Measurements" tab → URL becomes `/measurements`.
3. Assert empty-state copy `"No measurements logged yet. Log your first to start tracking progress."` is visible.
4. Tap "Log measurement" CTA → URL becomes `/measurements/new`.
5. Assert 5 section headers visible (`Weight & body fat`, `Upper body`, `Core`, `Lower body`, `Notes`) + the `Notes (optional)` input label.
6. Fill: weight `80.0`, body-fat `15.5`, chest `100.0`, biceps `35.0`, waist `80.0`, notes `"first entry"` (date defaults to today via `emptyMeasurementFormValues(new Date())`).
7. Tap "Save measurement" → URL returns to `/measurements`.
8. Assert list row shows `/80\.0 kg/` headline + `"first entry"` notes preview.
9. Tap the row → URL becomes `/measurements/{uuid}`.
10. Assert the weight input has value `"80.0"` (pre-populated via `rowToFormValues`).
11. Change weight to `80.5`; tap "Save changes"; URL returns to `/measurements`.
12. Assert list row now shows `/80\.5 kg/` — cache invalidation works without manual refresh.

**Result**: **pass**.

**Evidence**:

```
$ npx playwright test tests/e2e/measurements.spec.ts -g "golden" --reporter=line
"title": "golden: empty state → create → list → edit",
"ok": true,
"status": "passed",
```

## Edge cases

### Edge 1: MAJ-1 — impossible-but-regex-passing date submit (`2026-13-99`)

**Spec**: Reviewer flagged that the date-input regex `^\d{4}-\d{2}-\d{2}$` accepts impossible calendar dates such as `2026-13-99` / `2026-02-30` / `2026-02-29` (2026 is not a leap year), and `parse(...).toISOString()` then throws `RangeError: Invalid time value`. The submit handler only catches `z.ZodError` and `DuplicateMeasurementDateError`, so the `RangeError` propagates out.

**Steps**:

1. Navigate to `/measurements/new`.
2. Fill date input with `2026-13-99` (passes the regex).
3. Fill weight with `80`.
4. Tap Save.
5. Listen on `page.on("pageerror")` and `page.on("console")` for `Invalid time value`.

**Expected** (per Reviewer's preferred behaviour): an inline `"Invalid date"` error against the Date field, no crash, no pageerror.

**Actual**: `pageerror` fires with `RangeError: Invalid time value`. The submit handler throws asynchronously; react-hook-form's `handleSubmit` does NOT swallow the throw — it surfaces as an unhandled promise rejection that Expo dev-overlay captures and shows as a red error banner on web. No inline field error is rendered against the Date input. URL stays on `/measurements/new` because the throw aborts before `router.back()`.

**Result**: **fail** (MAJ-1 is a real crash, not a theoretical concern).

**Evidence**:

```
$ npx playwright test tests/e2e/measurements.spec.ts -g "MAJ-1"
"title": "MAJ-1: impossible date submit (2026-13-99) — does it crash?",
"ok": false,
"status": "failed"

stdout:
  MAJ-1 url: http://localhost:8081/measurements/new
  MAJ-1 pageerrors: [ 'RangeError: Invalid time value' ]
  MAJ-1 consoleErrors (top 3): []

error:
  MAJ-1 CONFIRMED: RangeError "Invalid time value" surfaced on impossible date.
  URL=http://localhost:8081/measurements/new
```

**Unit-level repro** (confirms the path inside `buildSubmitPayload`):

```
$ node -e 'import("date-fns").then(m => { ... })'
Input: 2026-13-99       passes regex: true    isNaN: true   toISOString() threw: RangeError - Invalid time value
Input: 2026-02-30       passes regex: true    isNaN: true   toISOString() threw: RangeError - Invalid time value
Input: 2026-02-29       passes regex: true    isNaN: true   toISOString() threw: RangeError - Invalid time value
Input: 2026-99-99       passes regex: true    isNaN: true   toISOString() threw: RangeError - Invalid time value
Input: 2026-05-20       passes regex: true    isNaN: false  toISOString() succeeded: 2026-05-20T03:00:00.000Z
```

**Suggested fix** (Reviewer's recommendation, verified by code reading): in `src/utils/measurements-form.ts` `buildSubmitPayload`, between `const parsed = parse(...)` and `parsed.toISOString()`, insert:

```ts
if (Number.isNaN(parsed.getTime())) {
  throw new z.ZodError([{ code: z.ZodIssueCode.custom, path: ["measuredAt"], message: "Invalid date" }]);
}
```

The screens already catch `z.ZodError` and route the issue to `setError("measuredAt", ...)`, so the failure mode becomes an inline field error consistent with the rest of the form.

### Edge 2: Empty form (no metric filled)

**Steps**: navigate to `/measurements/new`; click Save without filling any metric.

**Expected**: inline error `"Log at least one measurement"` against the Weight field (the at-least-one refine targets `weightKg`).

**Actual**: error rendered as expected.

**Result**: **pass**.

**Evidence**:

```
"title": "edge: empty form shows at-least-one error",
"ok": true,
"status": "passed"
```

### Edge 3: Duplicate same-day entry

**Steps**:

1. Create a measurement for today (weight 80).
2. Navigate back to `/measurements/new` directly (`page.goto("/measurements/new")`).
3. Fill weight 81; click Save.

**Expected**: server returns Postgres `23505` on the `measurement_entries_user_day_idx` partial unique index; API throws `DuplicateMeasurementDateError`; screen renders amber banner with "You already have a measurement for YYYY-MM-DD — edit it instead?" + "Open existing entry" CTA.

**Actual**: amber banner + CTA both visible. No row inserted (verified by re-creating a new measurement after soft-delete in Edge 6 — the previous duplicate attempt left no row).

**Result**: **pass**.

**Evidence**:

```
"title": "edge: duplicate same-day shows amber banner with CTA",
"ok": true,
"status": "passed"
```

### Edge 4: Bodyweight out of range (19, 401)

**Steps**: enter weight `19`, click Save; enter weight `401`, click Save.

**Expected**: inline error `"Must be between 20 and 400"` against Weight in both cases.

**Actual**: both submissions surface the inline error as expected. Note: `parseFloat("19")` → `19` (canonical kg with weightUnit=kg), then range-check throws a `z.ZodError`, then `setError("weightKg", ...)` renders the message under the input. Same for `401`.

**Result**: **pass**.

**Evidence**:

```
"title": "edge: weight out of range shows inline error",
"ok": true,
"status": "passed"
```

### Edge 5: Notes >500 chars

**Steps**: fill weight 80, fill notes with 501 "a"s, click Save.

**Expected**: inline error `"Too long"` against Notes (zod `.max(500, "Too long")`).

**Actual**: inline error renders as expected at zodResolver layer (before `buildSubmitPayload` is even called).

**Result**: **pass**.

**Evidence**:

```
"title": "edge: notes >500 chars shows inline error",
"ok": true,
"status": "passed"
```

### Edge 6: Soft delete clears row + unblocks same-day re-entry

**Steps**:

1. Create measurement (weight 80) today.
2. Open edit screen.
3. Tap "Delete measurement"; accept the `window.confirm` dialog (RN's `confirmDelete` uses native confirm on web).
4. Verify list returns to empty state.
5. Tap "Log measurement" again; fill weight 82; Save.

**Expected**: row gone from list; new same-day entry succeeds (the UNIQUE partial index has `WHERE deleted_at IS NULL`, so soft-deleted rows do not block).

**Actual**: empty state copy renders after delete; re-creation of an entry for the same day succeeds; new row visible with `/82\.0 kg/`.

**Result**: **pass**.

**Evidence**:

```
"title": "edge: soft delete clears row and unblocks same-day re-entry",
"ok": true,
"status": "passed"
```

This is also evidence that:

- Cache invalidates after delete (no manual refresh).
- Cache invalidates after create (no manual refresh).
- The soft-deleted row truly does not block the duplicate-date partial index — confirmed dynamically against the live DB.

## Regression check

### Regression 1: 6-tab bottom bar + Profile screen

**Steps**: sign in; assert each of the 6 tab labels is visible; tap History → land on `/history`; tap Profile → land on `/profile`; assert both `"Weight unit"` and `"Length unit"` row labels visible.

**Result**: **pass**.

**Evidence**:

```
"title": "regression: 6 tabs render, Profile shows weight + length unit toggles",
"ok": true,
"status": "passed"
```

### Regression 2: Routines + Workout CRUD (existing E2E)

`crud.spec.ts` was re-run alongside the new spec:

| Test | Result |
|---|---|
| routines: create, see in list, open detail, delete | pass |
| exercises: create custom exercise (alongside seeded library) | fail — pre-existing |
| workout: start ad-hoc, finish, see in history | pass |
| profile: weight unit toggle to lbs persists across reload | pass |

The exercises test failure is **pre-existing and unrelated** to this feature: it expects an `e.g. Chest` placeholder for the muscle field, which was removed in commit `b51dd01 feat: exercises track muscles as required multi-select array` before this run started. The test was authored in `682b0ec` and never updated for the multi-select refactor. No measurements code modifies the exercises screen.

### Regression 3: Integration (RLS + seed)

| Test | Result |
|---|---|
| `tests/rls.test.ts` (exercises + measurement_entries) | pass — B cannot read/update/delete A's data. |
| `tests/seed-and-auth.test.ts` (length_unit default seeds; 31 exercises still seed) | pass — confirms `seed_new_user()` untouched and the `length_unit` column default fires. |

### Regression 4: Unit math

`npm run test:unit` → 44/44 pass, including the new 11 in `measurements-units.test.ts` (cmToIn / inToCm / formatLength / parseLengthToCm round-trips and edge cases).

## Cross-platform

- **Web**: tested live via Playwright + Chromium against `expo start --web` on localhost:8081. All scenarios except MAJ-1 pass.
- **iOS**: not tested — no Simulator booted in this environment; the change is platform-neutral except that `confirmDelete` uses the native confirm dialog on web vs `Alert.alert` on native (existing project precedent). The MAJ-1 `RangeError` would surface as a LogBox red overlay on iOS dev builds.
- **Android**: not tested — same reasoning as iOS.

## Notes / observations not part of the test plan

- **Tab insertion line numbers**: `app/(app)/_layout.tsx` correctly places the `measurements` `<Tabs.Screen>` between `history` and `profile`. Verified via E2E (tab order assertion) and by the fact that all 6 tabs render together.
- **Length-unit toggle reformatting**: not exercised dynamically, but the implementation reads `useLengthUnit()` on every render and re-derives display strings via `formatLength(...)`. The unit tests in `measurements-units.test.ts` cover the math; a render-time bug would have shown up in the golden-path edit-screen prefill check (which uses `rowToFormValues` against the user's current unit prefs).
- **Dark mode**: not exercised dynamically. All new screens use the project's standard `bg-white dark:bg-black` / `text-black dark:text-white` token pairs as called out in the design. No new untokened backgrounds spotted in code review.
- **The pre-existing `crud.spec.ts > exercises` failure** is unrelated to this feature; flagged for follow-up but not gating.

## Decision

**fail**.

Reasoning:

- 7/8 measurement scenarios pass (golden, 5 edges, regression).
- **MAJ-1 reproduces live on web**. The reviewer's hypothesis was correct: typing a regex-passing but impossible date (`2026-13-99` and friends including `2026-02-29`/`2026-02-30`) and tapping Save raises an uncaught `RangeError: Invalid time value` from `.toISOString()` inside `buildSubmitPayload`. The error escapes the screen's try/catch (which only handles `z.ZodError` / `DuplicateMeasurementDateError`), surfaces as an unhandled promise rejection in the dev overlay, and on production native would silently break the Save flow with no inline error guidance for the user.
- This is the exact failure mode the Reviewer warned about (`review-v1.md` MAJ-1), and they recommended a one-line guard (`if (Number.isNaN(parsed.getTime())) throw new z.ZodError(...)` keyed on `measuredAt`). The Implementer should land that fix and the I↔T round should re-test the impossible-date path.
- All other scenarios (empty-form, duplicate-date banner, range error, notes-too-long, soft-delete + same-day re-entry, 6-tab regression) pass cleanly. No cross-domain cache pollution observed (workout + profile flows still work). Integration tests (RLS, seed) still green. Quality gates (typecheck, lint, unit tests) all green.

**Recommendation**: return to Implementer for the MAJ-1 one-line fix in `src/utils/measurements-form.ts:123-127`. I↔T round 1 of 2.

## New permanent regression test added

`tests/e2e/measurements.spec.ts` (8 scenarios, 7 currently passing). Once MAJ-1 is fixed, the MAJ-1 detector test should flip from "fails on `Invalid time value` pageerror" to "passes because no pageerror + inline error visible against the Date field". Suggest the Implementer adjusts the expectation in the MAJ-1 test from `if (rangeErrorHit) throw` to `expect(page.getByText("Invalid date")).toBeVisible()` (and remove the throw).
