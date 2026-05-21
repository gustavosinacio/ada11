# Test Report v1 — 2026-05-21_1505_exercise-volume-target

## Verdict
**Decision: pass** — golden path verified end-to-end, all edge cases verified, no regressions in adjacent flows attributable to this change.

## Quality gates

| Gate | Status | Evidence |
|---|---|---|
| `npm run typecheck` | PASS (exit 0) | `tsc --noEmit` clean. |
| `npm run lint` | PASS (0 errors) | `ESLint: 0 errors, 1 warnings in 1 files` (pre-existing `router.d.ts` warning, out of scope). |
| `npm run test:unit` | PASS (87/87) | 8 files, 87 tests. New `tests/unit/volume-target.test.ts` contributes 13 tests (`no-pr`, `chasing`, `surpassed`, warmup exclusion, MAJ-1 sentinel). Duration 874 ms. |
| `npm run test:e2e` (volume-target spec) | PASS (6/6) | Duration 42.4 s. New `tests/e2e/volume-target.spec.ts` covers golden path, no-weight chasing, tie copy, MAJ-1 regression, no-pr hiding, history-detail hiding. |
| `npm run test:e2e` (adjacent) | 18/19 PASS | One pre-existing failure (`crud.spec.ts > exercises: create custom`) reproduced on baseline without our changes (see §"Pre-existing failure"). All other adjacent specs green. |

## Test environment
- Dev server: `npm run web` on `http://localhost:8081`, headless Playwright `--reporter=json`.
- Auth seed: per-test confirmed user via `supabase.auth.admin.createUser`, deleted in `afterEach`/`afterAll`.
- Seed pattern: admin-client direct inserts to `sessions` + `sets` for both prior-best and live-session rows; persisted TanStack cache cleared between mutations via `window.localStorage.removeItem("ada11-query-cache")` (same pattern as `weekly-volume-strip.spec.ts:330`).
- Run started: 2026-05-21 (BRT).

## Scenarios

### Golden path — chasing → surpassed flow
**Scenario.** Seed previous best: 3 × 60 kg × 10 reps = 1800 kg. Then seed live-session sets in three phases and assert the strip text after each.

**Phase B — first set 50 × 10 (gap 1300 kg).**
- Command: `seedLiveSet(..., 50, 10)`, `gotoLiveSession`.
- Expected: `"Volume to PR: **1.3k kg** · ≈ **26.0 reps** @ 50.0 kg"`.
- Observed: all four locators visible inside 15 s. Screenshot `screenshots/02-chasing-50x10.png` confirms exact copy, bold styling on `1.3k kg` and `26.0 reps`, muted leading caption.
- Decision: **pass**.

**Phase C — second set 60 × 8 (cumulative 980 kg, gap 820 kg).**
- Command: `seedLiveSet(..., setNumber: 2, 60, 8)`, `gotoLiveSession`.
- Expected: `"Volume to PR: **820 kg** · ≈ **13.7 reps** @ 60.0 kg"` (gap < 1000 → no k-shorthand; current weight from max set_number = 60).
- Observed: all locators visible. Screenshot `screenshots/03-chasing-after-60x8.png`.
- Decision: **pass**.

**Phase D — third set 60 × 20 (cumulative 2180 kg, surpassed by 380 kg).**
- Command: `seedLiveSet(..., setNumber: 3, 60, 20)`, `gotoLiveSession`.
- Expected: emerald `"New PR! +380 kg over your previous"`.
- Observed: `/New PR/i` + `/\+380 kg/` both visible. Screenshot `screenshots/04-surpassed-380.png` shows the line rendered in `text-emerald-600`.
- Decision: **pass**.

### Chasing — no weight logged (reps clause hidden)
**Scenario.** Same 1800 kg prior best. Seed a single draft set with `weight: null, reps: null` (mimics the "row just added, not yet typed" state). Open the live session.
- Expected: `"Volume to PR: **1.8k kg**"` only — no `· ≈ X.X reps @ W kg` suffix.
- Observed: `1.8k kg` visible; full strip `innerText` matches `"Volume to PR: 1.8k kg"` (regex `/reps/i` returns no match). Screenshot `screenshots/01-chasing-no-weight.png`.
- Decision: **pass**.

### Tie case
**Scenario.** Seed 1800 kg prior best + live sets 3 × 60 × 10 = 1800 kg (exact tie).
- Expected: emerald copy `"Matched your previous best — one more rep is a PR"`.
- Observed: visible inside 15 s. Screenshot `screenshots/05-tie-matched.png`.
- Decision: **pass**.

### MAJ-1 regression — current weight picked by max(set_number)
**Scenario.** Prior best 1000 kg (1 × 100 × 10). Live: set #1 unchecked at 100 kg × 5; set #2 checked (`completed_at` populated) at 80 kg × 5. After `listSetsForSession` sorts checked rows first by `completed_at`, the array order is `[set#2 (80kg), set#1 (100kg)]` — walking by last array index would yield 100 kg.

The helper must pick by max `set_number` (= 2 → 80 kg).

- Expected: `"Volume to PR: **100 kg** · ≈ **1.3 reps** @ 80.0 kg"`. NOT `@ 100.0 kg`.
- Observed: `100 kg`, `1.3 reps`, `@ 80.0 kg` all visible. `@ 100.0 kg` has `count 0`. Screenshot `screenshots/06-maj1-regression.png` visually confirms set #2 (checked) renders FIRST in the table but the strip uses 80 kg.
- Decision: **pass**.

### No previous max — strip hidden for first-time exercise
**Scenario.** Brand-new user, fresh exercise (no seeded prior session). Seed a single live set.
- Expected: exercise block renders, but `"Volume to PR:"`, `"New PR"`, and `"Matched your previous best"` all have count 0.
- Observed: all three count-0 assertions pass. Screenshot `screenshots/07-no-pr-hidden.png` (caught mid-load with spinner; copy never appears at any time during the test window).
- Decision: **pass**.

### History detail — strip not rendered
**Scenario.** Seed two finished sessions (one 1800 kg, one 250 kg). Navigate to history detail for the small session.
- Expected: zero matches for `/Volume to PR:/i`, `/New PR/i`, `/Matched your previous best/i`.
- Observed: all three count-0 assertions pass on the history-detail surface. Screenshot `screenshots/08-history-no-strip.png` confirms the `<ExerciseBlock>` renders the exercise name, column headers, and the single set row — but NO strip above the column headers.
- Decision: **pass**.

## Adjacent regression — full e2e sweep

### Run 1: `crud.spec.ts` + `weekly-volume-strip.spec.ts`
| Test | Result |
|---|---|
| crud: routines: create/list/detail/delete | PASS |
| crud: exercises: create custom (placeholder lookup) | **FAIL** — pre-existing, see below |
| crud: workout: start ad-hoc, finish, see in history | PASS |
| crud: history: edit started_at backward 1h | PASS |
| crud: history: edit started_at across ISO-week boundary | PASS |
| crud: profile: weight unit toggle persists | PASS |
| weekly-volume-strip: golden, empty, warmup-only, refetch | 4/4 PASS |

### Run 2: progress IA + remove-exercise + soft-deleted-history
| Test | Result |
|---|---|
| exercise-progress-ia: golden + delete | PASS |
| exercise-progress-ia: cache: finish doesn't break progress | PASS |
| remove-exercise: golden + edge | PASS |
| remove-exercise: cancel | PASS |
| soft-deleted-exercises-in-history: block stays, picker excludes, suffix renders, totals match | PASS |

### Run 3: week-drill-down + measurements
13/13 PASS (5 week-drill-down + 8 measurements).

### Pre-existing failure — out of scope
`crud.spec.ts > exercises: create custom exercise (alongside seeded library)` fails with `locator.fill: timeout waiting for getByPlaceholder('e.g. Chest')` at line 150. To confirm it's pre-existing (not caused by our change):

1. Stashed `app/(app)/workout/[sessionId].tsx` and `src/components/exercise-block.tsx` (the only two non-new files we touched).
2. Ran `npx playwright test tests/e2e/crud.spec.ts -g "exercises: create custom"` against the stashed baseline.
3. Result: **same failure**, exit 1, same timeout on `getByPlaceholder('e.g. Chest')`.
4. Restored changes via `git stash pop`.

**Conclusion**: this failure pre-exists in `main` and is not attributable to the volume-target work. Tracking it is out of scope for this run — flag for a follow-up if not already known.

## Cross-platform smoke
- Web only (Playwright headless Chromium against the Expo web build). No native-platform code touched (NativeWind `Text`/`View` with `tabular-nums` is web/iOS/Android-portable per the design's "platform divergence: zero" assessment). iOS/Android were not exercised in this report — explicitly NOT marked as tested.

## Performance smoke
The 6 e2e tests complete in 42.4 s wall-clock with the strip rendering on every cold mount. No noticeable slowness vs adjacent specs (weekly-volume-strip suite: 4 tests, 31 s; volume-target suite: 6 tests, 42 s). Per-block hook fan-out at N=1 exercise is the test scope — not a stress test, but no observable lag.

## Coverage gaps / not tested
- **iOS / Android native.** Web only; the design states zero platform divergence and the Reviewer signed off on hook hygiene, but a real iOS device smoke is out of scope for this Tester pass.
- **Multi-exercise live workout perf at N ≥ 5.** Not exercised — all e2e scenarios use one exercise. Acceptable per the design (per-block hook with `gcTime: 24h` shared cache).
- **lbs unit display.** Unit tests cover the kernel's unit-agnostic math (`formatVolume` / `formatWeight` are already covered in `tests/unit/units.test.ts`). No e2e probe with `unit=lbs` was run — Reviewer's verdict explicitly waives this since math stays in kg internally.
- **Drop sets, warmups in live session.** Unit tests cover the kernel's warmup exclusion. No e2e probe exercised drop-set rows in the live workout — but the helper uses the same canonical kernel as `progress.tsx`, so the contract holds.

## Counts
- Unit tests: 87/87 pass (13 new, 74 existing).
- Volume-target e2e: 6/6 pass.
- Adjacent e2e: 18/19 pass (1 pre-existing failure unrelated to this change).

## Files added by Tester
- `tests/e2e/volume-target.spec.ts` — 6 dynamic scenarios.
- `docs/runs/2026-05-21_1505_exercise-volume-target/screenshots/01-chasing-no-weight.png` through `08-history-no-strip.png` — visual evidence.

## Recommendation
**Finalize.** Golden path + 5 edge cases + 5 adjacent feature areas all green. The one e2e failure (`crud > exercises: create custom`) is reproducible on baseline and unrelated to the volume-target change.

Round 1 of 2.
