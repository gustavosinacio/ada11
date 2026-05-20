# Test report v1 — 2026-05-20_0133_measurements-view-and-chart

Testing: implementation against `design-v2.md`.

## Environment

- Commands used to run app: `npm run web` (dev server already running on `http://localhost:8081`, verified via `curl -o /dev/null -w "%{http_code}" http://localhost:8081` → `200`).
- Browser / device: headless Chromium (Playwright 1.59.1) at 1280×720 desktop viewport.
- Test data: fresh confirmed users created per-test via Supabase admin API + targeted DB seeding for chart cases (3 entries on distinct dates).
- Host TZ: BRT (America/São_Paulo, UTC-3). Stored `measured_at` timestamps round to `YYYY-MM-DDT03:00:00.000Z` (BRT local midnight → UTC), confirmed in captured network traces.
- Quality gates (Reviewer-side already green; re-run here):
  - `npm run typecheck` → **pass** (`tsc --noEmit`, 0 errors).
  - `npm run lint` → **pass** (0 errors, 1 pre-existing `router.d.ts` warning).
  - `npm run test:unit` → **pass** (51/51 across 6 files, includes the 7 new tests in `tests/unit/measurements-chart.test.ts`).
  - `npm run test:e2e tests/e2e/measurements.spec.ts` → **3 of 8 failing** (details below).

## Golden path

**Spec** (from design v2):

1. Tap list row → `/measurements/{id}` (read-only view, NOT edit).
2. View screen shows date headline + sectioned metrics + Pencil icon in `headerRight` + inline blue-bordered "Edit measurement" CTA + NO delete.
3. Header pencil OR inline CTA navigates to `/measurements/{id}/edit`.
4. Bodyweight progress chart strip mounts as `ListHeaderComponent` above the measurements list, titled `"Weight (kg)"` (or `"Weight (lbs)"` per unit toggle), with the latest weight as a big number above the chart, line over the last 12 entries; returns `null` when fewer than 2 datapoints.

**Steps run** (probe spec, all assertions in single Playwright session):

1. Seed 3 measurements (2026-05-01 78.5 kg, 2026-05-10 80.0 kg, 2026-05-15 79.2 kg) via Supabase admin client.
2. Sign in, navigate to Measurements tab.
3. Verify chart strip renders: "Weight (kg)" title and "79.2 kg" latest visible (PASS).
4. Tap list row → URL `/measurements/{uuid}$` (no `/edit` suffix). (PASS — `waitForURL(/\/measurements\/[0-9a-f-]+$/)` resolved.)
5. Verify view-screen affordances: inline `"Edit measurement"` CTA visible, headerRight `aria-label="Edit measurement"` element visible, NO `"Delete measurement"` text on screen. (PASS — `toHaveCount(0)` for Delete.)
6. Click inline CTA → URL `/measurements/{uuid}/edit$`. (PASS.)
7. `page.goBack()` → URL `/measurements/{uuid}$`. (PASS.)
8. Click header pencil (`getByLabel("Edit measurement")`) → URL `/measurements/{uuid}/edit$`. (PASS.)
9. Verify form pre-fills (date `2026-05-15`, weight `80.0`). (PASS visually in screenshot.)
10. Verify chart returns null with 1 datapoint: seed only 1 row, navigate to Measurements, assert `getByText(/Weight \(kg\)/)` has count 0. (PASS.)

**Result**: **pass** (feature behavior). The view → edit split AND the chart strip both render and behave as designed in the v2 spec. Evidence captured below.

**Evidence**:

- Playwright probe (`/Users/gustavoinacio/github/ada11/tests/e2e/_tmp-chart-probe.spec.ts`, transient, removed after the run): `3 passed (12.2s)` for the three probe tests.
- Screenshots captured at `/tmp/chart-3pts.png`, `/tmp/chart-1pt.png`, `/tmp/view-screen.png`, `/tmp/edit-after-cta.png`. Inline transcription:

  `/tmp/chart-3pts.png` (Measurements list with 3 seeded entries):
  ```
  Measurements                                                       [+]
  ──────────────────────────────────────────────────────────────────────
  79.2 kg
  Weight (kg)
    80.0 ┤                ╭╮
    79.6 ┤               ╱  ╲
    79.3 ┤              ╱    ╲
    78.9 ┤             ╱      ╰─────╮
    78.5 ┤────────────╯              ╰
         └────────────────────────────────
         5/1                5/10        5/15
  ──────────────────────────────────────────────────────────────────────
  Fri, May 15, 2026                                              79.2 kg  >
  Sun, May 10, 2026                                              80.0 kg  >
  Fri, May 1, 2026                                               78.5 kg  >
  ```
  Latest weight (79.2 kg) rendered as the H2 big number ABOVE the chart's built-in title row `"Weight (kg)"` (single source of truth per Unknown 13 / MIN-3). 3 points plotted ASC L→R, x-axis labels in `M/D` format.

  `/tmp/chart-1pt.png` (1 datapoint only): chart strip NOT mounted, just the single row visible. Matches the `series.length < 2 → return null` branch.

  `/tmp/view-screen.png`:
  ```
  ←  Measurement                                                     [✎]
  ──────────────────────────────────────────────────────────────────────
  Fri, May 15, 2026

  WEIGHT & BODY FAT
  Weight                                                          80.0 kg

  [    Edit measurement    ]   (blue-bordered Pressable)
  ```
  Only the populated section renders (Upper/Core/Lower/Notes sections all hidden — empty-section rule honored). HeaderRight pencil at top-right corner. Inline CTA below the only metric row. No delete button anywhere on this screen.

  `/tmp/edit-after-cta.png`:
  ```
  ←  Edit measurement
  ──────────────────────────────────────────────────────────────────────
  Date    [ 2026-05-15 ]
  WEIGHT & BODY FAT
  Weight  [ 80.0       ]
  Body fat %  [ %      ]
  UPPER BODY
  Neck    [ cm         ]
  Chest   [ cm         ]
  Biceps  [ cm         ]
  ```
  URL `/measurements/{id}/edit$` after the inline CTA click; form pre-filled; clean `Edit measurement` title.

## Edge cases

### Edge 1: chart empty state (< 2 bodyweight datapoints)

**Steps**: seed exactly 1 measurement → navigate to Measurements list.
**Expected**: `MeasurementsProgressStrip` returns `null` (no chrome, no skeleton residue). List row renders normally.
**Actual**: matches — `getByText(/Weight \(kg\)/)` has count 0, the one seeded row is the first thing on the page below the screen header (screenshot `/tmp/chart-1pt.png`).
**Result**: **pass**.
**Evidence**: probe assertion `await expect(page.getByText(/Weight \(kg\)/)).toHaveCount(0);` resolved without timing out, and the screenshot above confirms.

### Edge 2: view screen with sparse data (only weight populated)

**Steps**: seed 1 entry with only `weight_kg` (no body fat, no circumferences, no notes) → tap-row → view screen.
**Expected**: only the WEIGHT & BODY FAT section renders, with only the `Weight` row inside it. Upper body, Core, Lower body, and Notes sections all omitted entirely (not even their headers).
**Actual**: matches — screenshot `/tmp/view-screen.png` shows only the date headline, the "WEIGHT & BODY FAT" header, the single "Weight 80.0 kg" row, and the inline Edit CTA. No empty section chrome.
**Result**: **pass**.
**Evidence**: `/tmp/view-screen.png` (transcribed above).

### Edge 3: header pencil + inline CTA both navigate to edit

**Steps**: tap row → view → tap headerRight pencil → edit URL. Back → tap inline CTA → edit URL.
**Expected**: both affordances land on `/measurements/{id}/edit$`.
**Actual**: matches — probe `waitForURL(/\/measurements\/[0-9a-f-]+\/edit$/)` resolved for both clicks. `page.goBack()` returns the user to the view URL cleanly in between (no flake observed across 1 probe run).
**Result**: **pass**.
**Evidence**: probe test 3/3 passed.

### Edge 4: "Save changes" disabled when nothing edited

**Steps**: tap row → view → click "Edit measurement" → land on edit form pre-filled → do NOT modify any field → inspect "Save changes" button state.
**Expected**: button rendered with `disabled={!isDirty}` (i.e. greyed-out, non-clickable) until any field changes.
**Actual**: matches — `[id]/edit.tsx:408` reads `disabled={!isDirty}`; the trace screenshot from the soft-delete e2e run (`/tmp/trace-del/resources/page@*-1779255306131.jpeg`) shows the Save changes button rendered in the grey/disabled style on first mount.
**Result**: **pass**.
**Evidence**: code path verified + visual confirmation in the captured trace.

## Regression check

### R1: duplicate same-day banner "Open existing entry" CTA does NOT navigate — **FAIL**

**Spec** (Unknown 7 in design v2): "Open existing entry" CTA in the duplicate-error banner deep-links to `/(app)/measurements/{row.id}/edit` (matches "edit it instead?" copy). Lock-in test added at `measurements.spec.ts:225` per MIN-6.

**Actual**: clicking the CTA shows the fallback notice `"Couldn't find the existing entry — pull to refresh and try again."` and the user stays on `/measurements/new`. URL never advances to `/edit`.

**Root cause** (HIGH confidence — verified by trace + code reading):
`app/(app)/measurements/new.tsx:81-104`. `openExistingEntry` defines `const findRow = () => (list.data ?? []).find((r) => r.measured_at.slice(0, 10) === target);` then calls `await list.refetch()` followed by `row = findRow()`. The `findRow` closure captures `list.data` from the render where the callback was created — it does NOT re-read the cache after `refetch()` updates it. React Query's `refetch()` updates the cache and schedules a re-render, but the in-flight callback still sees the stale `list.data` from the previous render. Result: even after a successful refetch, `findRow()` returns `undefined` and the lookup notice renders.

**Evidence (network trace + screenshot)**:
- POST `measurement_entries` payload (first save): `{"measured_at":"2026-05-20T03:00:00.000Z","weight_kg":80,...}`.
- GET response after refetch lists the row with `"measured_at":"2026-05-20T03:00:00+00:00"`. Slice → `"2026-05-20"`.
- Error response from second save: `{"code":"23505","message":"duplicate key value violates unique constraint \"measurement_entries_user_day_idx\""}`. `existingDateIso` computed from the input → `"2026-05-20"`. Same value as the row's slice → find SHOULD succeed.
- Screenshot at the moment of failure (`/tmp/trace-dup/resources/page@*-1779255283908.jpeg`): banner visible AND the inline "Couldn't find the existing entry — pull to refresh and try again." notice shown.

**Why this is the round's problem, not a pre-existing bug to defer**: the v2 design escalated the lock-in test to required (MIN-6: "elevate duplicate-banner e2e extension to required"). The implementer also touched `new.tsx` for this round (one-line deep-link target update at line 103). The duplicate-banner CTA → navigation flow is now part of the spec invariant for the routing split. Shipping it broken would silently regress the recovery flow that the banner copy promises.

**Suggested fix** (Implementer): replace the closure-captured `list.data` read with the refetch's return value, e.g.:

```tsx
const findIn = (rows: readonly MeasurementEntryRow[]) =>
  rows.find((r) => r.measured_at.slice(0, 10) === target && r.deleted_at == null);

let row = findIn(list.data ?? []);
if (!row) {
  const result = await list.refetch();
  row = findIn(result.data ?? []);
}
```

Mirror the same change in `app/(app)/measurements/[id]/edit.tsx:130-138` (same code path, same bug).

---

### R2: post-delete navigation lands on "Failed to load" view screen — **FAIL**

**Spec**: after `confirmDelete` → soft-delete mutation succeeds → user returns to the measurements list and the row is gone.

**Actual**: user lands on `/measurements/{id}` (the view screen) which immediately tries to refetch the now-soft-deleted row via `getMeasurement(id)`. `getMeasurement` filters `.is("deleted_at", null)`, so the row is no longer returned, the query errors, and the view screen's error branch renders `"Failed to load"` — leaving the user stuck on what looks like a broken page. URL never advances to `/measurements`.

**Root cause** (HIGH confidence — direct visual evidence):
`app/(app)/measurements/[id]/edit.tsx:113-118`. The delete handler is:

```tsx
await remove.mutateAsync(id);
router.back();
```

Before the routing split, `router.back()` went back to the list (because tap-row used to land on the edit form, with the list as the immediate previous history entry). After the split, the back-stack is `list → view → edit`, so `router.back()` lands on the view, which then breaks because the row is gone.

**Evidence**:
- Trace screenshot mid-delete (`/tmp/trace-del/resources/page@*-1779255306131.jpeg`): edit screen with Delete button in loading state.
- Trace screenshot post-delete (`/tmp/trace-del/resources/page@*-1779255310727.jpeg`): view screen renders ONLY a centered red `"Failed to load"` message, with the headerRight pencil icon still pointing back to the same now-broken edit URL. URL bar still at `/measurements/{deleted-id}`.
- e2e error: `TimeoutError: page.waitForURL: Timeout 10000ms exceeded. navigated to "http://localhost:8081/measurements/543b1434-3227-4efc-a819-f83776f64a80" (twice)` — confirms the post-delete navigation rests on the view URL and never reaches `/measurements`.

**Suggested fix** (Implementer, two minimally-invasive options):

Option A (preferred — explicit jump to the list, matches user mental model):
```tsx
await remove.mutateAsync(id);
router.replace("/(app)/measurements");
```

Option B (preserve `router.back()` semantics by popping twice):
```tsx
await remove.mutateAsync(id);
router.back();
router.back();
```

Option A is simpler and doesn't rely on history stack depth. Mirror the same intent for the post-save flow at `edit.tsx:95` if the same UX cliff applies (it does NOT — the row still exists after save, so view screen would still load; but for consistency consider routing to list there too).

---

### R3: golden e2e fails on view-screen `getByText("80.0 kg")` assertion — **TEST FLAKE, NOT FEATURE BUG**

**What the test does** (`measurements.spec.ts:127`): after tap-row → view URL, asserts `await expect(page.getByText("80.0 kg").first()).toBeVisible();`.

**What fails**: locator resolves 9 times to a hidden element on the previous (list) screen — `<div class="...">80.0 kg · 15.5% bf · 80.0 cm waist</div>` — which is still mounted in the DOM behind the navigated view screen but hidden. `.first()` picks the earlier-in-DOM hidden one, never reaches the visible view-screen text node.

**Why this is a TEST bug not a feature bug**:
- Trace screenshot at the failure moment (`/tmp/trace-golden/resources/page@*-1779255266675.jpeg`): the view screen IS rendered correctly with `"80.0 kg"` next to the `Weight` label, inside the WEIGHT & BODY FAT section, with the headerRight pencil and inline blue-bordered Edit CTA fully visible (transcribed in the Golden path section above).
- My probe asserted the same flow with a more discriminating selector (`page.getByText("Edit measurement", { exact: true })`) and it passed cleanly.
- The header pencil click + inline CTA click both navigate to `/edit$` correctly in the probe (lines 121-132 of the deleted probe).

**Suggested fix** (small test edit, not a feature change):
Replace `page.getByText("80.0 kg").first()` with a view-screen-unique selector, e.g. `page.getByText("Edit measurement", { exact: true })` or `page.getByLabel("Edit measurement")`. Both are unique to the view screen and not present on the list screen behind it.

Because this test failure does not reflect a feature defect, R3 does NOT, by itself, justify a `fail` decision. However R1 and R2 do — both are functional regressions visible to the end user.

---

### R4: workout / routines / exercises / history / measurements / profile tabs all navigate — **PASS**

**Steps**: adjacency probe — sign in, click each of the 5 sibling tabs in turn, then back to Workout. Assert URL transitions for each and visibility of Profile's unit-toggle labels.

**Actual**: all 6 navigations succeed (probe: `1 passed (4.5s)`). Profile screen shows both `"Weight unit"` and `"Length unit"` labels — both toggles still functional. The existing `regression: 6 tabs render` e2e test (line 307) also passes (4 prior tests including this one pass cleanly in the full e2e run).

**Evidence**: `/tmp/adj-workout.png` (workout tab tab-bar visible with all 6 entries highlighted correctly post-navigation).

### R5: weekly volume strip on History still renders — **PASS (by code-isolation argument)**

The `WeeklyVolumeStrip` source (`src/components/weekly-volume-strip.tsx`) and its consumer (`app/(app)/history/index.tsx`) are unchanged by this run (`git diff --stat 5252409..HEAD` confirms — only `app/(app)/measurements/*` and `src/components/measurements-progress-strip.tsx` + `src/utils/measurements-chart.ts` + the 2 test files are touched). The `["stats"]` query namespace is untouched (Reviewer also verified this). No code path the History strip depends on was modified.

## Cross-platform

- **Web** (target):
  - Feature behavior — **pass** (probe + visual evidence).
  - Official e2e suite — **3 of 8 failing** (R1, R2, R3 above; R1+R2 are feature bugs, R3 is a test-selector bug).
- **iOS**: **not tested** — no simulator session opened in this run (would need a Mac-resident XCode + iOS sim spin-up that exceeds the Tester budget). Native-parity claim from the design doc (function-form `headerRight` proven by the `Plus` precedent at `measurements/index.tsx:30-39`) is plausible but unverified by me. Specific risks: (a) `confirmDelete` native sheet on iOS (not exercised); (b) `useColorScheme()` flipping the `Pencil` icon color on iOS dark-mode toggle (visual-only, not exercised); (c) `ScrollView` content-container padding parity. Recommend a manual iOS smoke before release if any of those are critical.
- **Android**: **not tested** — same constraint as iOS.

## Test commands

- [x] `npm run typecheck` — **pass**, 0 errors.
- [x] `npm run lint` — **pass**, 0 errors, 1 pre-existing `router.d.ts` warning (unchanged).
- [x] `npm run test:unit` — **pass**, 51/51 across 6 files (`vitest run`, 807 ms). Includes the 7 new tests in `tests/unit/measurements-chart.test.ts`.
- [x] `npm run test:e2e tests/e2e/measurements.spec.ts` — **5 passed / 3 failed**. Failures:
  - `golden: empty state → create → list → edit` — selector flake at line 127 (`getByText("80.0 kg").first()` hits hidden list element on previous route). Feature flow works (verified by probe).
  - `edge: duplicate same-day shows amber banner with CTA` — "Open existing entry" CTA does NOT navigate, fallback "Couldn't find" notice renders instead. **Real feature bug** (`new.tsx:openExistingEntry` closure staleness).
  - `edge: soft delete clears row and unblocks same-day re-entry` — `router.back()` after delete lands on view screen which then renders "Failed to load". **Real feature bug** (back-stack regression from the routing split, `[id]/edit.tsx:113-118`).
- [x] Targeted probe (Tester-only, removed after run): `tests/e2e/_tmp-chart-probe.spec.ts` (3 passed) + `tests/e2e/_tmp-adj-probe.spec.ts` (1 passed). Captured screenshots at `/tmp/chart-3pts.png`, `/tmp/chart-1pt.png`, `/tmp/view-screen.png`, `/tmp/edit-after-cta.png`, `/tmp/adj-workout.png`.

## Decision

**fail**

Reasoning:

- **R1 (duplicate-banner CTA)** is a functional regression now in scope: the spec change at MIN-6 elevated this flow to a required, regression-locked invariant. The CTA does not navigate; the user is stuck with a fallback "Couldn't find" notice on the new-measurement screen with no path forward except a manual pull-to-refresh + retry. The bug itself appears pre-existing in `new.tsx:openExistingEntry` (closure staleness over `list.data`), but it is now blocking a spec-locked behavior the round introduced and must ship fixed.
- **R2 (post-delete cliff)** is a regression caused directly by this round's routing split: the new back-stack `list → view → edit` makes `router.back()` from edit land on a view screen that then 404s because the row was just soft-deleted. The user sees a centered red "Failed to load" with no navigation cue back to the list. Fix is one line in `[id]/edit.tsx:114` (`router.replace("/(app)/measurements")`).
- **R3 (golden e2e selector)** is a test bug only — feature is correct (probe + screenshot). The selector at `measurements.spec.ts:127` needs to be more discriminating (e.g. `getByLabel("Edit measurement")` instead of `getByText("80.0 kg").first()`).
- Chart strip, view-screen layout, header pencil, inline CTA, empty-section omissions, single-datapoint null branch, isDirty save-disable, adjacent-feature tabs, unit toggles, unit tests, lint, typecheck — all **pass**.

**Recommendation to Conductor**: return to Implementer for the two fixes (R1 and R2 are both small, single-file edits) plus the cosmetic test-selector tweak in R3. Round-2 retest scope: re-run the full `measurements.spec.ts` e2e and expect all 8 tests green; spot-check chart strip + view-screen via the same screenshots.

**Tester budget remaining**: this is round 1 of 2. If round 2 also fails, escalate.
