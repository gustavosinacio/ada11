# Test report v1 — 2026-05-20_0856_measurements-move-to-profile

Testing implementation against `design-v1.md`.

## Environment
- Commands used to run app: `npm run web` (Expo web dev server on http://localhost:8081)
- Browser / device: Playwright Chromium (headless), curl probes for HTML
- Test data: fresh Supabase users created per-test via service role
- Date: 2026-05-20 BRT

## Golden path

**Spec** (from design):
1. Bottom tab bar shows 4 tabs (Workout / Exercises / History / Profile) — no Measurements, no Routines.
2. Profile renders Preferences (weight + length toggles) above a single bordered Pressable "Measurements" row (Ruler + label + ChevronRight) above the About section.
3. Tapping the Profile Measurements row navigates to `/(app)/measurements/` (list/history screen).
4. From the list, tap a row → view → Edit → save / delete still works.
5. Back-navigate from Measurements → returns to Profile.

**Steps run**:
1. Dynamic — Expo web dev server confirmed reachable (`curl http://localhost:8081/` → HTTP 200).
2. Playwright e2e: `tests/e2e/measurements.spec.ts` golden-path test signs in a fresh user, navigates Profile → Measurements via `getByLabel("Measurements")`, asserts empty-state copy, creates a measurement, returns to list, opens row view, exercises both header-pencil and inline Edit paths, saves, asserts updated weight on list.
3. Playwright e2e: `tests/e2e/measurements.spec.ts:322` tab-count regression — asserts no "Measurements" text in tab bar BEFORE Profile click; asserts `getByLabel("Measurements")` is visible AFTER Profile click; weight + length toggle assertions on Profile.
4. Playwright e2e: `tests/e2e/probe-strong-unify.spec.ts:66` 4-tab IA — explicit `getByText("Measurements").toHaveCount(0)` against the tab bar.
5. HTML probe of `/measurements` directly via curl (URL-bookmark contract).

**Result**: **pass**

**Evidence**:

```
node node_modules/.bin/playwright test tests/e2e/measurements.spec.ts tests/e2e/probe-strong-unify.spec.ts --reporter=line
Running 16 tests using 1 worker
[1/16] measurements.spec.ts:90:7  golden: empty state → create → list → edit
[2/16] measurements.spec.ts:156:7 MAJ-1 regression: impossible date submit ...
[3/16] measurements.spec.ts:195:7 edge: empty form shows at-least-one error
[4/16] measurements.spec.ts:211:7 edge: duplicate same-day shows amber banner with CTA
[5/16] measurements.spec.ts:239:7 edge: weight out of range shows inline error
[6/16] measurements.spec.ts:260:7 edge: notes >500 chars shows inline error
[7/16] measurements.spec.ts:278:7 edge: soft delete clears row and unblocks same-day re-entry
[8/16] measurements.spec.ts:322:7 regression: 4 tabs render, no Routines or Measurements tab, Profile shows weight + length unit toggles + Measurements row
[9/16] probe-strong-unify.spec.ts:66:7 4-tab IA: tab bar shows Workout/Exercises/History/Profile (no Routines, no Measurements)
[10/16] probe-strong-unify.spec.ts:80:7 /routines URL redirects to /workout
[11/16] probe-strong-unify.spec.ts:91:7 empty state: new user sees 'No routines yet' + Quick start + Create routine
[12/16] probe-strong-unify.spec.ts:102:7 headerRight + button navigates to /routines/new
[13/16] probe-strong-unify.spec.ts:112:7 active session: banner visible across tabs, click resumes same session
[14/16] probe-strong-unify.spec.ts:138:7 active-session guard: Quick start from /workout home routes to same session id
[15/16] probe-strong-unify.spec.ts:162:7 cold reload during live session: home shows banner + Quick start, guard still active
[16/16] probe-strong-unify.spec.ts:188:7 routine card with active session: opacity-60, tap is a no-op (banner is resume path)
  16 passed (1.3m)
EXIT=0
```

Note: the very first run of the suite (cold Metro bundle for `/measurements`) showed one flake on the golden test at line 99 (10s timeout waiting for empty-state text). On warm-bundle re-run the test passed cleanly both in isolation and as part of the full file. No code change required.

## Edge cases

### Edge 1: Direct URL `/measurements` still resolves (no redirect, bookmark contract)

**Steps**: `curl -s -o /tmp/measurements-html.html -w "HTTP=%{http_code}" http://localhost:8081/measurements`
**Expected**: HTTP 200; Measurements list screen rendered; tab bar shows exactly Workout/Exercises/History/Profile.
**Actual**: HTTP 200. HTML contains the empty-state text `"No measurements logged yet. Log your first to start tracking progress."` and the "Log measurement" CTA. The tablist DOM contains 6 `<a role="tab">` slots, but the two that map to Routines and Measurements have inline `style="...display:none"` on their wrapper — visually hidden, while still keeping their direct URL resolvable. Visible tab labels: Workout, Exercises, History, Profile.
**Result**: **pass**
**Evidence**:
```
HTTP=200
<div ...>No measurements logged yet. Log your first to start tracking progress.</div>
<button role="button" ...>Log measurement</button>
...
<div ... style="...display:none"></div>   # Routines slot
<div ... style="...display:none"></div>   # Measurements slot
...visible tabs: Workout, Exercises, History, Profile
```

### Edge 2: Tab-bar negative + positive Profile row assertions (regression guard)

**Steps**: Test `measurements.spec.ts:322` lines 329 + 341. (a) Before clicking Profile tab, assert `getByText("Measurements", { exact: true })` is `not.toBeVisible()` (proves no Measurements tab). (b) After clicking Profile tab, assert `getByLabel("Measurements")` is visible (proves the new Profile row exists). Plus `probe-strong-unify.spec.ts:66` asserting `toHaveCount(0)` for Measurements in the 4-tab IA.
**Expected**: Both assertions pass — Measurements absent from tab bar, present on Profile.
**Actual**: Both assertions pass on both files. No false positives.
**Result**: **pass**
**Evidence**: see `[8/16]` and `[9/16]` in golden-path block.

### Edge 3: Form CRUD pathway preserved end-to-end (golden flow exercises this)

**Steps**: Within `measurements.spec.ts:90` — fill weight, body fat, chest, biceps, waist, notes → Save → list shows `80.0 kg` → tap row → view → click header pencil (`getByLabel("Edit measurement")`) → edit screen → back to view → click inline "Edit measurement" → edit screen → mutate weight to 80.5 → "Save changes" → list shows `80.5 kg`.
**Expected**: Every navigation hop succeeds, mutation persists, list updates.
**Actual**: Passes. The full sub-flow validates that the navigation from a Profile-pushed `/measurements` route does NOT corrupt the existing stack semantics (router.push, not router.replace).
**Result**: **pass**
**Evidence**: see `[1/16]` in golden-path block.

## Regression check

- **Workout / Exercises / History / Profile tabs render** — `probe-strong-unify.spec.ts:66` (4-tab IA): pass.
- **Weekly volume strip + drill-down (History tab)** —
  - `tests/e2e/weekly-volume-strip.spec.ts`: 3/4 passed in the full-suite run. `warmup-only` test failed once on the contended full-suite run (60s timeout), but **passed cleanly in isolation** on this branch (`1 passed (6.2s)`). Verified flake, not a regression. The other 3 strip tests (golden, empty state, refetch path) pass.
  - `tests/e2e/week-drill-down.spec.ts`: 5/5 passed (golden + empty week + outside window + invalid date + back navigation).
- **Workout home (Strong-style IA, Quick start, routines, ActiveSessionBanner)** — `probe-strong-unify.spec.ts` 8/8 passed (covers /routines redirect, empty-state, headerRight nav, banner-across-tabs, active-session guard, cold reload, routine card behavior).
- **Exercise progress IA (list → progress → pencil → edit)** — `tests/e2e/exercise-progress-ia.spec.ts`: 2/2 passed (golden + cache-after-finish).
- **CRUD baseline (routines, workout, profile-toggle)** —
  - `tests/e2e/crud.spec.ts`: 3/4 passed. The `exercises: create custom exercise` test failed (`page.getByPlaceholder("e.g. Chest")` timeout). **Confirmed pre-existing baseline failure**: the form was migrated to `MuscleGroupPicker` in commit `b51dd01` (`feat: exercises track muscles as required multi-select array`), but `crud.spec.ts:150` still expects the old text placeholder. I stashed this run's diff and re-ran the same test against baseline `main` — it failed identically (same locator, same timeout). Not a regression from this run.

Evidence (baseline-vs-branch comparison):
```
# Stashed this run's 4 code changes, ran the same test:
node node_modules/.bin/playwright test tests/e2e/crud.spec.ts -g "create custom exercise"
  1 failed (locator.fill timeout on getByPlaceholder("e.g. Chest")) → baseline-stale test
# git stash pop, re-ran the warmup-only test in isolation:
node node_modules/.bin/playwright test tests/e2e/weekly-volume-strip.spec.ts -g "warmup-only"
  1 passed (6.2s) → flake from earlier contended full-suite run
```

## Cross-platform
- **Web**: pass (all targeted scenarios above).
- **iOS**: not tested — no native build invoked. The change is platform-neutral (Tabs.Screen `href: null` is the same pattern already used for Routines, see commit `14953e0`; `useRouter().push` is shared). No iOS-specific code touched.
- **Android**: not tested — same reasoning.

## Test commands
- [x] `npm run typecheck` — clean (`> tsc --noEmit`, no errors).
- [x] `npm run lint` — `ESLint: 0 errors, 1 warnings in 1 files` (`router.d.ts` warning is the pre-existing baseline).
- [x] `npm run test:unit` — `Test Files 6 passed (6) / Tests 51 passed (51) / Duration 804ms`.
- [x] `npm run test:e2e tests/e2e/measurements.spec.ts tests/e2e/probe-strong-unify.spec.ts` — `16 passed (1.3m)` on warm bundle (Exit 0).
- [x] `npm run test:e2e tests/e2e/crud.spec.ts tests/e2e/exercise-progress-ia.spec.ts tests/e2e/week-drill-down.spec.ts tests/e2e/weekly-volume-strip.spec.ts` — `13 passed, 2 failed`. Both failures investigated: `crud.spec.ts:131` is pre-existing baseline (reproduced on stashed `main`); `weekly-volume-strip.spec.ts:230` is a load-contention flake that passes cleanly in isolation on this branch.

## Decision

**pass**

Reasoning:
- Golden path passes — 4-tab bottom IA, Profile row navigation, full Measurements CRUD round-trip, direct `/measurements` URL contract.
- 3 edge cases pass — direct URL HTML probe; negative+positive tab-bar regression guards; full CRUD sub-flow under the new entry point.
- Quality gates green (typecheck, lint, 51/51 unit tests).
- Adjacent regression: 8/8 probe-strong-unify, 5/5 week-drill-down, 2/2 exercise-progress-ia, 3/4 weekly-volume-strip (the 4th is a verified flake), 3/4 crud (the 4th is a verified pre-existing baseline failure caused by commit `b51dd01`, unrelated to this run).
- Recommendation: **finalize**.
