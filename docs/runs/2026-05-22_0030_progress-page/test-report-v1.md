# Test report v1 — 2026-05-22_0030_progress-page

Testing: implementation against `design-v3.md` (Reviewer passed, 3 minors all cosmetic).

## Environment
- Commands used to run app: `npm run web` (dev server already running on `http://localhost:8081`, returns 200; not restarted during test).
- Browser / device: Playwright headless Chromium (default Playwright runner) for the suites; additional one-shot Chromium at 375x812 viewport via `scratch-iphone-smoke.mjs` (removed after run).
- Test data: per-test ephemeral users via `admin.auth.admin.createUser` + service role; each test seeds and tears down its own user. iPhone smoke probe seeded a separate ephemeral user with 2 finished sessions (heavier 3 weeks ago, lighter this week) on the auto-seeded Back Squat exercise.
- Tool versions: typecheck clean (`tsc --noEmit`, no output); lint 0 errors / 1 pre-existing warning in `router.d.ts`.

## Golden path
**Spec** (from design-v3 §"Goal" / §"Page composition"): brand-new Progress tab between History and Profile renders Hero (PRs this week + weekly Max·Now·To PR), 8-week volume strip with lifetime-best overlay, per-exercise list grouped by primary muscle with PR pills, and a Streak card. No regressions to History.

**Steps run**:
1. `npm run typecheck` — clean.
2. `npm run lint` — 0 errors.
3. `npm run test:unit` — 158 tests across 9 files, all green.
4. `npm run test:e2e -- tests/e2e/progress-page.spec.ts` — 7 tests, all green.
5. Manual iPhone 375 viewport probe — page renders cleanly, no overflow, single-row hero, single-row Max·Now·To PR.

**Result**: pass

**Evidence**:

Unit suite:
```
 ✓ tests/unit/formulas.test.ts (5 tests)
 ✓ tests/unit/measurements-chart.test.ts (7 tests)
 ✓ tests/unit/measurements-units.test.ts (11 tests)
 ✓ tests/unit/volume-target.test.ts (18 tests)
 ✓ tests/unit/units.test.ts (8 tests)
 ✓ tests/unit/weekly-volume-bucketing.test.ts (7 tests)
 ✓ tests/unit/dates.test.ts (13 tests)
 ✓ tests/unit/session-times-form.test.ts (30 tests)
 ✓ tests/unit/progress-page-math.test.ts (59 tests)
 Test Files  9 passed (9)
      Tests  158 passed (158)
   Duration  1.24s
```

Spot-checks (per the Conductor's call-out list):
- BLK-3 null filter — tests #42-#45 (`tests/unit/progress-page-math.test.ts:798-842`). #42 asserts `.not("completed_at", "is", null)` on lifetime branch via a spy on the supabase builder. #43 asserts same for `sinceUtc` branch. #44 asserts post-fetch assert throws on a null row. #45 asserts narrowed return type on a clean payload. All four green.
- Single-prior PR boundary — tests #23 + #24 (`:432-470`). #23 (one prior 500, this-week 600) → 1 PR. #24 (one prior 500, this-week 400) → 0 (strict `>`). Both green.
- Max-aware chart denominator — tests #39-#41 (`:726-747`). #39 (bestWeekKg > maxKg → bars shrink, overlay at top), #40 (bestWeekKg ≤ maxKg → bars unaffected, overlay below top), #41 (History mount with `bestWeekKg` undefined → byte-identical with old formula). All three green.
- Soft-fallback streak — test #32 (`:639-643`). Session last week, none this week → `{current: 1, best: 1}` (trailing display preserved). Green.

E2E suite (Progress page):
```
 ✓  1 tests/e2e/progress-page.spec.ts:147:7 › Progress page › 1. tab visibility — Progress tab renders on the bottom bar (5.3s)
 ✓  2 tests/e2e/progress-page.spec.ts:162:7 › Progress page › 2. empty user — day-zero empty states render without crashing (5.5s)
 ✓  3 tests/e2e/progress-page.spec.ts:194:7 › Progress page › 3. populated user mid-week — hero, bars, list, streak all render (6.6s)
 ✓  4 tests/e2e/progress-page.spec.ts:251:7 › Progress page › 4. per-row navigation — tapping a list row routes to /(app)/exercises/{id}/progress (6.7s)
 ✓  5 tests/e2e/progress-page.spec.ts:296:7 › Progress page › 5. empty current ISO week with prior history — list shows empty copy, hero/bars still render (5.0s)
 ✓  6 tests/e2e/progress-page.spec.ts:333:7 › Progress page › 6. PR badge — a row that beats its lifetime best this week renders the PR pill (6.1s)
 ✓  7 tests/e2e/progress-page.spec.ts:378:7 › Progress page › 7. 5-tab regression — History, Progress, Profile labels coexist on the bar (2.2s)
 7 passed (38.2s)
```

## Edge cases

### Edge 1: Empty-week state (Tuesday morning-ish — current ISO week has zero finished sessions, but history exists)
**Steps**: Progress e2e test #5 seeds a session 3 weeks ago, then signs in on the current ISO week and navigates to `/progress` without seeding anything for this week.
**Expected**: Hero + strip render with prior-week data; per-exercise list shows the empty-list copy ("No exercises trained this week yet. Log a session to get started.").
**Actual**: Test passes; copy is verified visible via `page.getByText(...)`.
**Result**: pass
**Evidence**: `tests/e2e/progress-page.spec.ts:296` (test #5 — "empty current ISO week with prior history — list shows empty copy, hero/bars still render (5.0s)"). The actual copy lives at `src/components/exercises-this-week-list.tsx:77`. Note: the task brief's paraphrase "Go log a session" maps to the actual literal copy "Log a session to get started" — the empty-state intent is the same.

### Edge 2: Day-zero new user (never logged a session — completely empty)
**Steps**: Progress e2e test #2 creates a brand-new user with no sessions ever, navigates to `/progress`.
**Expected**: Hero shows "Log your first session to see weekly volume." + list shows empty copy + Streak card shows "Finish a session this week to start a streak." No crash.
**Actual**: All three empty-state strings render and are asserted visible. Screenshot saved.
**Result**: pass
**Evidence**: `tests/e2e/progress-page.spec.ts:162` (test #2 — "empty user — day-zero empty states render without crashing (5.5s)"). Screenshot at `docs/runs/2026-05-22_0030_progress-page/screenshots/empty-state.png`.

### Edge 3: Streak soft-fallback (current week empty + last week qualified → display trailing count)
**Steps**: Unit test #32 in `tests/unit/progress-page-math.test.ts:639` — pass a single finished session whose `started_at` is 7 days before `NOW`, current week empty.
**Expected**: `computeStreaks` returns `{current: 1, best: 1}` (the trailing-week display rule from design-v3 §Streak math).
**Actual**: `{current: 1, best: 1}` matches.
**Result**: pass
**Evidence**: Test #32 green in the unit suite output above.

### Edge 4: Multi-muscle exercise lands in only ONE group (primary = `muscles[0]`)
**Steps**: Unit tests #26 (`progress-page-math.test.ts:572`) and #55 (`:957`) — exercise with `muscles: ["Chest", "Shoulders"]`.
**Expected**: Lands in `"Chest"` group only; "Shoulders" is ignored for grouping.
**Actual**: `grouped.get("Chest")?.length === 1` and `group === "Chest"` both green.
**Result**: pass
**Evidence**: tests #26 + #55 green in unit suite output above. Code path: `src/utils/progress-page-math.ts:266-288`.

### Edge 5: Empty muscles array → "Other" group
**Steps**: Unit tests #27 (`:579`) and #54 (`:950`) — exercise with `muscles: []`.
**Expected**: Lands in `"Other"` group.
**Actual**: `grouped.get("Other")?.length === 1` and `group === "Other"` both green.
**Result**: pass
**Evidence**: tests #27 + #54 green in unit suite output above.

### Edge 6: BLK-3 null `completed_at` filter survives the lifetime read path
**Steps**: Unit tests #42-#45 (`:798-842`) — spies on the supabase builder, asserts both branches issue `.not("completed_at", "is", null)`; #44 simulates a null row slipping through and asserts the post-fetch assertion throws.
**Expected**: Filter applied on both branches; assertion fires on null row; no `RangeError` from `parseISO(null)` reaching the renderer.
**Actual**: All four tests green.
**Result**: pass
**Evidence**: tests #42-#45 green in the unit suite output. Code path: `src/api/stats.ts:56` (sinceUtc) + `:79` (lifetime), assertion at `:63-67` + `:90-94`.

### Edge 7: 5-tab regression — Workout, Exercises, History, Progress, Profile all visible
**Steps**: Progress e2e test #7 (`:378`).
**Expected**: All 5 labels render on the bar simultaneously (so adding the new tab didn't crowd one out).
**Actual**: All 5 visible labels render.
**Result**: pass
**Evidence**: test #7 green; iPhone 375 viewport screenshot confirms the full 5-tab bar fits with no truncation.

## Regression check

- **`tests/e2e/weekly-volume-strip.spec.ts`** (the strip on `/(app)/history`): pass — `4 passed (27.9s)`. History mount renders without overlay (`bestWeekKg` undefined → `denom === model.maxKg` byte-identical to pre-change), empty state still works, warmup-only state still works, post-refetch cache invalidation still works.
- **`tests/e2e/week-drill-down.spec.ts`** (tap a History bar opens per-week screen): pass — `5 passed (28.6s)`. Golden tap-current-week, tap-zero-volume bar, deep-link out-of-window, deep-link invalid date, back navigation — all green.
- **`tests/e2e/volume-target.spec.ts`** (live-workout Max·Now·To PR strip — shares semantic with the Progress page line): pass — `7 passed (49.9s)`. Chasing copy, no-weight clause, tie case, MAJ-1 set_number regression, hidden when no PR exists, history detail hides strip, checked-only running volume lockstep — all green.

## Cross-platform
- Web: pass — Progress page renders cleanly at the dev server (`localhost:8081`) on Playwright headless Chromium at default 1280px and at 375px iPhone viewport. Cold-start sign-in→Hero-rendered measured at 2.96s on the populated user (well under the 5s known-debt threshold from design-v2 MIN-3).
- iOS: not tested — requires a real device or simulator that's not exposed to this headless environment. The implementation does not touch any iOS-specific code (no `Platform.OS === "ios"` branches in any new/edited file per `grep` of touched files); the change is React-Native-Web-driven Tabs + display chrome.
- Android: not tested — same reason as iOS.

### iPhone 375 viewport probe (manual smoke, MIN-3 from design-v2)
- Tool: one-shot `scratch-iphone-smoke.mjs` (chromium at `viewport: { width: 375, height: 812 }`); created an ephemeral user with 2 finished sessions, signed in, navigated to `/progress`, screenshotted, dumped layout metrics. Script removed after run.
- Wall-clock cold-start (sign-in → "PRs this week" rendered): **2,962 ms** — below the 5,000 ms known-debt threshold called out in design-v3 §Riscos.
- Layout probe at 375x812:
  ```
  layout probe: {"docW":375,"bodyW":375,"viewportW":375,"horizontalOverflow":false}
  Max·Now line bbox: {"x":16,"y":169,"width":343,"height":20}
  PRs this week bbox: {"x":16,"y":84,"width":343,"height":16}
  ```
  No horizontal overflow; Hero PR-count + Max·Now·To PR line both fit on a single 343-px-wide row. Per-exercise list "Max · Now · To PR" line on the Back Squat row also fits on a single row.
- Visual confirmation: screenshot at `docs/runs/2026-05-22_0030_progress-page/screenshots/iphone375-progress.png` shows full Progress page (Hero → Strip with overlay → "Legs" group → Back Squat row → Streak card → 5-tab bottom bar) rendering cleanly without wrap or truncation.

## Test commands
- [x] `npm run typecheck` — clean (no output, exit 0).
- [x] `npm run lint` — `ESLint: 0 errors, 1 warnings in 1 files` (pre-existing in `router.d.ts`).
- [x] `npm run test:unit` — `Test Files 9 passed (9); Tests 158 passed (158)` in 1.24s.
- [x] `npm run test:e2e -- tests/e2e/progress-page.spec.ts` — `7 passed (38.2s)`.
- [x] `npm run test:e2e -- tests/e2e/weekly-volume-strip.spec.ts` — `4 passed (27.9s)`.
- [x] `npm run test:e2e -- tests/e2e/week-drill-down.spec.ts` — `5 passed (28.6s)`.
- [x] `npm run test:e2e -- tests/e2e/volume-target.spec.ts` — `7 passed (49.9s)`.

## Cold-start latency (MIN-3 from design-v2 / v1)
- Wall-clock from sign-in click → Hero "PRs this week" rendered, populated user with 2 finished sessions (8 working sets total): **~2.96 s**.
- Sample size: 1 (single cold load against the dev account on the local Supabase project).
- Population caveat: the test account has light history (2 sessions). The MIN-3 risk is about lifetime reads against an account with **substantial** history (thousands of sets). With ~8 set rows here, the paginated lifetime read terminates after one short page; the measurement does NOT exercise the worst case. **Known-debt flag deferred** — a deeper benchmark would need a backfilled account (out of Tester scope; design-v3 §Riscos already calls this out as unmeasured).
- Within the available scope, no perf concern surfaced.

## Decision

**pass**

Reasoning:
- Golden path verified: Hero, strip with overlay, per-muscle list with PR pills, Streak card all render correctly in the e2e populated-mid-week test, with the new Progress tab landing in source order between History and Profile per design.
- All target edge cases covered with evidence: BLK-3 null-completed_at filter (#42-#45), single-prior PR boundary (#23-#24), max-aware chart denominator (#39-#41), soft-fallback streak (#32), multi-muscle primary-only grouping (#26/#55), empty-muscles → "Other" (#27/#54), day-zero new user (e2e #2), empty current week with prior history (e2e #5), 5-tab regression (e2e #7).
- Adjacent regression: all three adjacent suites green — History strip rendering byte-identical when `bestWeekKg` is undefined (degrade-to-existing-formula confirmed), week drill-down still routes correctly, live-workout volume-target strip (the shared Max·Now·To PR semantic) still works end-to-end.
- iPhone 375px viewport check: no horizontal overflow, no wrap issues on Hero PR-count + Max·Now·To PR line nor on the per-exercise list row. Cold-start under 3s on the populated test user.
- Cross-platform: web fully verified (1280px + 375px). iOS / Android not tested in this environment — explicitly flagged. The implementation has no iOS/Android-specific branches.
- Counts: 158/158 unit + 23/23 e2e (7 progress-page + 4 weekly-volume-strip + 5 week-drill-down + 7 volume-target) all green. Typecheck + lint clean.
- Reviewer's 3 minors (MIN-1 duplicate import, MIN-2 undocumented `prIds` field, MIN-3 verbose comment block in `findBestWeek`) are all pure style — none surfaced in dynamic testing and none block the decision; they can be folded into a follow-up cleanup or recorded as retro debt.

Recommendation to Conductor: **finalize**.
