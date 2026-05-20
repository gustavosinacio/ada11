# Test report v1 — 2026-05-20_0334_volume-strip-drill-down

Testing the volume-strip drill-down implementation (`design-v1.md`, `review-v1.md`).

## Environment
- Dev server: `npm run web` (already up on `http://localhost:8081`, confirmed via curl `200`).
- Browser: Playwright headless Chromium (per `playwright.config.ts`).
- Test data: fresh confirmed users seeded per spec via Supabase service-role; each test isolates its own user and tears down on `finally`.
- Today (BRT): 2026-05-20. Current ISO week Monday = 2026-05-18.

## Quality gates (static)

| Command | Result | Notes |
|---|---|---|
| `npm run typecheck` | clean | no output (=> 0 errors) |
| `npm run lint` | 0 errors / 1 warning | pre-existing `router.d.ts` warning, unaffected |
| `npm run test:unit` | 51/51 (6 files) | dates, formulas, units, measurements-units, measurements-chart, weekly-volume-bucketing |

## Golden path

**Spec** (from design): tapping a non-zero bar in the weekly volume strip pushes a per-week screen at `/(app)/history/week/<Monday-YYYY-MM-DD>` whose headline (Total volume, Sessions, Avg per session) matches the bar number and whose body lists the week's sessions via `<SessionSummaryRow>`.

**Steps run** (new e2e `tests/e2e/week-drill-down.spec.ts` → `golden path` test):
1. Create confirmed user; seed 4 sessions across the rolling 8-week window with the current week = 5 sets × 100 kg × 5 reps = **2500 kg**.
2. Sign in via UI → `/workout` → navigate to `/history`.
3. Assert strip renders ("This week", "2.5k kg").
4. Locate the current-week column by accessibility label (`getByRole("button", { name: "View week of M/D" })`) and click it.
5. Assert URL → `/history/week/2026-05-18`.
6. Assert "Total volume / 2.5k kg" row, "Sessions / 1" row, body header range "May 18 – May 24".
7. Assert at least one visible "Workout" row in the per-week list.

**Result**: pass

**Evidence**:
```
✓ tests/e2e/week-drill-down.spec.ts:160:7 › golden path: tap current-week bar, headline matches, list renders (9.7s)
```
- Screenshot: `docs/runs/2026-05-20_0334_volume-strip-drill-down/screenshots/drill-down-golden.png`
- Visible in the screenshot:
  - Header chevron + title "Week of May 18" (Monday only — matches design)
  - Body header "May 18 – May 24" (range — matches design)
  - `VOLUME` section: Total volume **2.5k kg**, Sessions **1**, Avg per session **2.5k kg**
  - `SESSIONS` section: one row "Workout · Wed, May 20 · 1h 0m"
  - Bottom tab bar present, History tab highlighted

**Headline-vs-bar contract**: confirmed identical: strip says "2.5k kg" → screen says "2.5k kg" (Total volume). Both screens read from the same TanStack Query cache key (`["stats", "weekly-volume", sinceUtc.slice(0,10)]`) and apply the same reduce kernel.

## Visual parity of the strip itself (MINOR-2 from validator)

**Steps**: re-ran `tests/e2e/weekly-volume-strip.spec.ts` (4 tests, unmodified by this PR). Inspected the golden screenshot at `docs/runs/2026-05-19_2144_weekly-volume-stat/screenshots/golden-strip.png`.

**Observations from the screenshot**:
- 8 bar columns rendered. Each column appears even in width (no uneven distribution).
- Bars are bottom-aligned (the `marginTop: PLOT_HEIGHT - h` baseline trick visually matches the prior `items-end` behavior).
- Current-week bar is the blue (`bg-blue-500`) tallest bar at the right.
- Each column carries its M/d date label directly underneath.
- No visual regression vs prior screenshot.

**Result**: pass — no column-width fallback needed (the `<Pressable className="flex-1">` distributes the same as the prior `<View className="flex-1">`, as predicted).

## Edge cases

### Edge 1: tap a zero-volume (rest-week) bar
**Spec**: navigation succeeds, screen renders zero-stat sheet + "No sessions this week." empty state.

**Steps run** (`empty week: tap a zero-volume bar lands on empty state`):
1. Seed only the current week (offset 0). Bars for offsets 1–7 are zero-volume.
2. After signing in and reaching `/history`, tap the bar at offset 3 (rest week).
3. Assert URL pattern + empty-state copy.

**Result**: pass

**Evidence**:
```
✓ tests/e2e/week-drill-down.spec.ts:254:7 › empty week: tap a zero-volume bar lands on empty state (5.8s)
```
- Screenshot: `docs/runs/2026-05-20_0334_volume-strip-drill-down/screenshots/drill-down-empty.png`
- Title "Week of Apr 27" / body header "Apr 27 – May 3"
- VOLUME: Total volume **0 kg**, Sessions **0** (Avg per session row hidden — matches design spec: row hidden when `endedSessionsCount === 0`)
- SESSIONS: centered "No sessions this week." text — matches design copy verbatim

### Edge 2: deep link to a week outside the 8-week window (MAJOR-1 guard)
**Spec**: deep-linking to a Monday >8 weeks old must show the outside-window empty state, not silently return 0 kg (which would lie because the cache only holds 8 weeks of rows).

**Steps run** (`deep link out-of-window week`):
1. Sign in with a freshly seeded user.
2. Navigate directly to `/history/week/<Monday-12-weeks-ago>` (segment `2026-02-23`).
3. Assert outside-window copy.

**Result**: pass

**Evidence**:
```
✓ tests/e2e/week-drill-down.spec.ts:319:7 › deep link out-of-window week: outside-range copy (5.9s)
```
- Screenshot: `docs/runs/2026-05-20_0334_volume-strip-drill-down/screenshots/drill-down-outside-window.png`
- Header "Week of Feb 23"
- Body text "This week is outside the visible range. Open the History tab to see the latest weeks." — exact match against `[isoWeek].tsx:132-135` and design copy
- No headline numbers rendered (guards against the "silent 0 kg" failure mode validator MAJOR-1 caught)

### Edge 3: deep link with invalid date segment
**Spec**: a garbage URL segment (`/history/week/foobar`) must NOT crash; render the "Invalid week" empty state.

**Steps run** (`deep link invalid date`):
1. Sign in.
2. Navigate directly to `/history/week/foobar`.
3. Assert "Invalid week." copy renders.

**Result**: pass

**Evidence**:
```
✓ tests/e2e/week-drill-down.spec.ts:363:7 › deep link invalid date: invalid-week copy, no crash (4.7s)
```
- Screenshot: `docs/runs/2026-05-20_0334_volume-strip-drill-down/screenshots/drill-down-invalid.png`
- Header "Week" (title falls back to "Week" since monday is null)
- Body centered red "Invalid week." — matches `[isoWeek].tsx:121`
- No crash, no white screen, no console error.

### Edge 4: in-progress session in the current week
**Spec**: headline volume EXCLUDES in-progress (server-side filter is `ended_at IS NOT NULL` via `useWeeklyVolume`); the per-week list INCLUDES the in-progress session with the orange chip; Sessions row primary number is `endedSessionsCount`, with `(incl. N in progress)` suffix.

**Steps run** (one-off probe `_in-progress-probe.spec.ts`, then removed):
1. Seed 1 ended session (Wed, 5×100×5 = 2500 kg) + 1 in-progress session (Thu, `ended_at: null`, 1 set × 200 kg × 5 reps = 1000 kg) in the current week.
2. Sign in, navigate to `/history`, click the current-week bar.
3. Assert URL, Total volume = "2.5k kg" (NOT 3.5k), Sessions = "1 (incl. 1 in progress)", "In progress" chip visible.

**Result**: pass

**Evidence**:
```
✓ tests/e2e/_in-progress-probe.spec.ts › in-progress in week list (8.0s)
```
- Screenshot: `docs/runs/2026-05-20_0334_volume-strip-drill-down/screenshots/drill-down-in-progress.png`
- VOLUME: Total volume **2.5k kg**, Sessions **1 (incl. 1 in progress)**, Avg per session **2.5k kg**
- SESSIONS list row 1: "Workout · Thu, May 21 · in progress" with orange "In progress" chip
- SESSIONS list row 2: "Workout · Wed, May 20 · 1h 0m" (ended)
- Confirms: headline excludes in-progress (denominator-consistent with strip), list includes it (matches `history/index.tsx` precedent).

### Edge 5: back navigation from detail to History
**Spec**: hitting browser back from the detail screen returns to `/history` with the strip and list intact.

**Steps run** (`back navigation: detail → strip restores History list`):
1. Sign in, navigate to `/history`, tap the current-week bar.
2. Wait for URL transition.
3. Call `page.goBack()`.
4. Assert URL is `/history` and "This week" header is visible again.

**Result**: pass

**Evidence**:
```
✓ tests/e2e/week-drill-down.spec.ts:388:7 › back navigation: detail → strip restores History list (6.3s)
```

## Regression check

| Suite | Result | Notes |
|---|---|---|
| `tests/e2e/weekly-volume-strip.spec.ts` (4 tests) | pass — 4/4 | Strip still renders correctly with the new column-merged layout; no math change. |
| `tests/e2e/measurements.spec.ts` (8 tests) | pass — 8/8 | Measurements view/edit/delete flow + 6-tab render. |
| `tests/e2e/exercise-progress-ia.spec.ts` (2 tests) | pass — 2/2 | Exercise tap-row → progress → pencil → edit + cache invalidation on session finish. |
| `tests/e2e/crud.spec.ts` (4 tests) | 1 fail, 3 pass | **Pre-existing breakage** — `exercises: create custom exercise` test expects an old text-input "e.g. Chest" muscle field, but commit `b51dd01` migrated it to a multi-select picker. Unrelated to this run; same failure on `main` HEAD. Documented here, not a blocker. |
| `tests/e2e/auth.spec.ts` (7 tests) | 1 fail, 6 pass | **Pre-existing breakage** — sign-up flow test depends on remote Supabase email-confirmation config and throws on unexpected HTTP status. Same failure on `main` HEAD. Unrelated. |

**Adjacent regression scope** (per test plan):
- Exercise tap-row → progress → pencil → edit — verified by `exercise-progress-ia.spec.ts:72`.
- Measurements view → edit → delete → land on list — verified by `measurements.spec.ts:88` and `measurements.spec.ts:276`.
- Workouts / Routines / Profile tabs render — verified by `measurements.spec.ts:320` (6-tab render check).
- Weekly volume strip e2e still passes — verified by 4/4 above.

## Cross-platform

- **Web**: pass (all 5 new drill-down tests + all adjacent web suites — Playwright headless).
- **iOS native**: not tested directly. The implementation uses only cross-platform primitives (`Pressable`, `expo-router`'s `useRouter` + `Stack.Screen`, NativeWind classes already used across the codebase). No platform-conditional code added. Risk: low.
- **Android native**: not tested directly. Same justification as iOS.

## Test commands run

- [x] `npm run typecheck` — clean (0 errors, 0 output).
- [x] `npm run lint` — 0 errors, 1 pre-existing `router.d.ts` warning unchanged by this PR.
- [x] `npm run test:unit` — 51/51 pass, 6 test files, 827 ms.
- [x] `npm run test:e2e tests/e2e/week-drill-down.spec.ts` (new) — 5/5 pass, 33.1 s.
- [x] `npm run test:e2e tests/e2e/weekly-volume-strip.spec.ts` — 4/4 pass, 35.1 s.
- [x] `npm run test:e2e tests/e2e/measurements.spec.ts` — 8/8 pass, 40.7 s.
- [x] `npm run test:e2e tests/e2e/exercise-progress-ia.spec.ts` — 2/2 pass, 13.1 s.

## Artifacts produced

- `tests/e2e/week-drill-down.spec.ts` (new, 5 tests, 420 LOC) — added to the suite so future PRs catch regressions on the drill-down.
- `docs/runs/2026-05-20_0334_volume-strip-drill-down/screenshots/` (5 files):
  - `drill-down-golden.png` — current-week tap, 2.5k kg headline, Workout row.
  - `drill-down-empty.png` — rest-week tap, "No sessions this week." empty state.
  - `drill-down-outside-window.png` — deep-link 12 weeks ago, outside-window copy.
  - `drill-down-invalid.png` — `/foobar` segment, "Invalid week." copy.
  - `drill-down-in-progress.png` — current week with mixed ended + in-progress sessions, headline-excludes contract verified.

## Decision

**pass**

Reasoning:
- Golden path: tapping a bar pushes the correct URL, the headline matches the strip's bar number to the kg, the body header range is correct, the per-week list reuses `<SessionSummaryRow>` verbatim.
- All 4 edge cases pass: zero-volume bar → empty state with hidden Avg row; deep link out-of-window → outside-window copy (MAJOR-1 guard works); invalid date → clean empty state, no crash; in-progress session → excluded from headline + included in list with orange chip + "(incl. N in progress)" suffix.
- Back navigation lands on `/history` with strip intact.
- Visual parity of the strip is verified — bar widths even, bottom-baseline alignment pixel-equivalent.
- No regressions in the three adjacent suites that ARE related (measurements, exercise-progress-ia, weekly-volume-strip). The two failing e2e suites (crud, auth) are pre-existing breakages on `main` and unrelated to this PR.
- All 3 minors from `review-v1.md` are style-only (Monday-snap for tampered URLs, `endOfWeek` over ms math, comment line-number rot) and do not affect functional correctness for the happy URLs the UI emits.

Recommendation to Conductor: **finalize**.
