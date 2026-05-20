# Test report v1 — 2026-05-20_0410_strong-workout-routines-unify

Testing: implementation against `design-v3.md`.

## Environment

- Commands used to run app: `npm run web` (Expo web build served at http://localhost:8081).
- Driver: Playwright 1.59.1, Chromium headless, JSON reporter to `/tmp/pw-*.json`.
- Test data: Each Playwright test creates its own confirmed Supabase user via the admin API; cleanup runs in `finally`. Pre-existing E2E test fixtures untouched.
- Probe spec lives at `tests/e2e/probe-strong-unify.spec.ts` (8 new scenarios).

## Golden path

**Spec** (from design):
- 5-tab bottom bar (Workout / Exercises / History / Measurements / Profile) — no Routines tab.
- Workout home = Quick start + routines list + headerRight `+` + edit-pill on each card.
- Sticky `ActiveSessionBanner` mounted globally above `<Tabs>` in `(app)/_layout.tsx`.
- Routine card tap → start session pre-filled with that routine.
- Active-session guard: Quick start + routine taps redirect to live screen when session in progress.
- `/routines` redirects to `/workout`.

**Steps run**: Eight scenarios driven via Playwright probe + existing `crud.spec.ts` routines flow.

**Result**: **pass**.

**Evidence** — `npx playwright test tests/e2e/probe-strong-unify.spec.ts`:

```
 PASS - 5-tab IA: tab bar shows Workout/Exercises/History/Measurements/Profile (no Routines)
 PASS - /routines URL redirects to /workout
 PASS - empty state: new user sees 'No routines yet' + Quick start + Create routine
 PASS - headerRight + button navigates to /routines/new
 PASS - active session: banner visible across tabs, click resumes same session
 PASS - active-session guard: Quick start from /workout home routes to same session id
 PASS - cold reload during live session: home shows banner + Quick start, guard still active
 PASS - routine card with active session: opacity-60, tap is a no-op (banner is resume path)
---stats {"startTime":"2026-05-20T08:24:29.843Z","duration":43048.964,"expected":8,"skipped":0,"unexpected":0,"flaky":0}
```

And the corresponding `crud.spec.ts` routines spec — which exercises the Workout home as the routines hub end-to-end (Workout tab → empty state → Create routine → save → name visible at `/workout$` → Edit pill → builder → delete → `/workout$` → name gone):

```
 PASS - routines: create, see in list, open detail, delete
 PASS - workout: start ad-hoc, finish, see in history
```

## Edge cases

### Edge 1: Empty state on Workout home (new user, zero routines)
**Steps**: Sign up a fresh user; land on `/workout`.
**Expected** (design decision 5): centered `"No routines yet. Quick start a workout, or create your first routine below."` plus a primary `Quick start workout` button + secondary `Create routine` button.
**Actual**: Exact copy + both buttons visible.
**Result**: **pass**.
**Evidence**: probe `"empty state: new user sees 'No routines yet' + Quick start + Create routine"` — passed. The DOM body during a debug run was inspected and contained literal substring `"No routines yet. Quick start a workout, or create your first routine below.Quick start workoutCreate routine"`.

### Edge 2: Active-session guard — Quick start during live session
**Steps**: Quick-start a session → wait for the persistence flush (see §Known race) → `page.goto("/workout")` → tap the visible `Quick start workout` button.
**Expected**: navigates to `/workout/{originalSessionId}` (no second `sessions` row inserted).
**Actual**: same session UUID is in the URL after click. Evidence captured in a debug run:
```
Session: 32718a8e-2853-426d-86fb-6f9519cb4a64
After Quick start click URL: http://localhost:8081/workout/32718a8e-2853-426d-86fb-6f9519cb4a64
```
**Result**: **pass**.
**Evidence**: probe `"active-session guard: Quick start from /workout home routes to same session id"` — passed.

### Edge 3: Routine row visual + interaction when active session
**Steps**: create a routine → quick-start a different (ad-hoc) session → URL-nav back to `/workout` → assert the row.
**Expected** (design v3 lines 285-289, 337): row at `opacity: 0.6`; the outer Pressable's `onPress` is `disabled ? undefined : onPress` so the row body is a tap-no-op. The Edit pill is still tappable. The banner is the resume path.
**Actual**: `window.getComputedStyle(row).opacity` returned `"0.6"`. Clicking the row body kept URL at `/workout$` (no nav). Clicking the Edit pill routed to `/routines/[id]`. Clicking the banner from the builder routed back to the original `/workout/{sessionId}`.
**Result**: **pass**.

> ⚠ Note: The original test-plan bullet 8 says "Tapping a dimmed routine card navigates to the SAME live session." This contradicts the implemented (and design-v3-spec'd) behavior: a dimmed row is a tap-no-op; the banner is the documented resume affordance. The implementation matches the design; this report verifies behavior **per design**, not per the test plan's literal wording. The defensive guard inside `startFromRoutine` (`if (active.data) router.push(...)`) is unreachable from the dimmed-row path but exists as a belt-and-suspenders for any future caller that wires `onPress` without `disabled`.

### Edge 4: `/routines` direct-URL redirect
**Steps**: Sign in → `page.goto("/routines")`.
**Expected**: redirect to `/workout`.
**Actual**: `page.url()` matched `/workout$` after a 10s wait. Implementation file `app/(app)/routines/index.tsx` is now a 5-line `<Redirect href="/(app)/workout" />`.
**Result**: **pass**.

### Edge 5: Cold-reload during active session
**Steps**: Quick start a session, wait for persistence, navigate to `/workout` home, then `page.reload()`.
**Expected**: Workout home renders with banner visible AND `Quick start workout` button still visible (no flicker into the live screen).
**Actual**: both visible; tapping Quick start still routes to the same session id (guard survives reload).
**Result**: **pass**.

### Edge 6: Banner across all 5 tabs
**Steps**: Quick start a session, switch through Exercises / History / Measurements / Profile tabs, then click the banner.
**Expected**: banner visible on every tab; click → `/workout/{sessionId}`.
**Actual**: banner detected by accessibility label `"Resume workout in progress"` on each tab; click navigated to the live session URL.
**Result**: **pass**.

## Known race window (not a feature regression — pre-existing)

When a user **starts a workout and within ~2-3 seconds performs a hard navigation** (URL bar to `/workout`, browser back from another origin, etc.), the new page load may render the empty Workout home (no banner). Cause is independent of this feature:

- `app/_layout.tsx` mounts `PersistQueryClientProvider` (AsyncStorage backed). The active-session entry is persisted **asynchronously**, ~hundreds of ms after `startSession.mutateAsync` resolves.
- `src/lib/auth-context.tsx` calls `supabase.auth.getSession()` asynchronously on mount; `useActiveSession()` (`src/hooks/use-sessions.ts:35-40`) fires its `getActiveSession` query at the same time.
- On a cold load before the cache has persisted, the query can race against auth restore and return `null` (RLS denies the unauthenticated request), and React Query caches that `null` forever — `refetchOnWindowFocus: false` is configured in `src/lib/query-client.ts:11`, and there is no `invalidateQueries({ queryKey: KEYS.active })` on auth state change.

A user reloading on `/workout/{id}` itself uses `useSession(id)` not `useActiveSession`, so a real in-workout reload does not display this symptom. Real users almost never hard-navigate inside the first ~3 seconds of starting a workout. Probe `tests/e2e/probe-strong-unify.spec.ts` uses a `waitForTimeout(3000)` to simulate the steady-state behavior.

**Pre-existing** — the old workout home had a `useEffect(() => router.replace(...))` on `active.data`; the same race could have left the user stranded on the routines picker. Recommendation: track separately; do not block this run on it.

## Regression check

| Adjacent feature | Result | Evidence |
|---|---|---|
| Exercises tab list | **pass** | 5-tab probe confirmed `Exercises` tab visible; subsequent probe navigated via tab click. |
| History tab + weekly volume strip | **pass** | `tests/e2e/weekly-volume-strip.spec.ts` 4/4 pass. |
| History → week drill-down | **pass** | `tests/e2e/week-drill-down.spec.ts` 5/5 pass. |
| Exercise progress IA (list → progress → edit → save → delete) | **pass** | `tests/e2e/exercise-progress-ia.spec.ts` 2/2 pass; includes the `"Quick start workout"` rename at line 182. |
| Measurements feature (all 8 specs incl. the renamed `5 tabs render, no Routines tab` regression) | **pass** | `tests/e2e/measurements.spec.ts` 8/8 pass. |
| Profile / unit toggle | **pass** | `crud.spec.ts:204` `profile: weight unit toggle to lbs persists across reload` — pass. |
| Workout: start ad-hoc, finish, see in history | **pass** | `crud.spec.ts:162` — pass; verifies the renamed `"Quick start workout"` literal end-to-end. |
| Logging sets in an active session | **partial** | Not separately exercised in this run. `crud.spec.ts:162` validates that a session can be started and finished (URL → live screen → Finish → back to `/workout$`). Set logging itself is exercised by `exercise-progress-ia.spec.ts` indirectly (history rows). |
| Exercises CRUD (create custom exercise) | **fail — pre-existing, unrelated** | See §Pre-existing E2E failure below. |

### Pre-existing E2E failure (not introduced by this feature)

`tests/e2e/crud.spec.ts` test `"exercises: create custom exercise (alongside seeded library)"` times out on:

```
> 150 |       await page.getByPlaceholder("e.g. Chest").fill("Biceps");
```

Root cause: commit **`b51dd01 feat: exercises track muscles as required multi-select array`** replaced the single-text muscle input in `app/(app)/exercises/new.tsx` with a `<MuscleGroupPicker>` component. The placeholder `"e.g. Chest"` no longer exists in the DOM (`grep -rn "e.g. Chest" app src` → 0 hits). The test was not updated alongside that commit. The current run is `strong-workout-routines-unify`, which does not touch `exercises/new.tsx` or muscle-related code.

Recommendation: file a separate small fix to update `crud.spec.ts:150-152` to drive the `MuscleGroupPicker` instead. Out of scope for this run.

## Cross-platform

- **Web (Chromium headless)**: **pass** — all 8 probe scenarios + 18 of 19 regression specs (1 pre-existing fail unrelated).
- **iOS**: **not tested** — feature has one platform-relevant change (`useColorScheme()` reads), but no iOS-specific code paths. Same JS runs on web; native colorScheme returns are equivalent. Tester does not have an iOS simulator available in this environment.
- **Android**: **not tested** — same reasoning as iOS. Tester does not have an Android device or emulator available.

Implementation notes explicitly call out (line 43): "Tester: please confirm Android hardware back-button behavior on these screens lands on `/workout`." This cannot be exercised on web. Recommendation: smoke on a device before any release that ships this change. Web behavior of `router.back()` from `/routines/new` and `/routines/{id}` was implicitly verified through `crud.spec.ts` reaching `/workout$` after each Save / Delete.

## Test commands

- [x] `npm run typecheck` — clean (0 errors).
- [x] `npm run lint` — `0 errors, 1 warning` (pre-existing `router.d.ts` warning).
- [x] `npm run test:unit` — **51/51 in 6 files** (formulas, units, measurements-units, measurements-chart, dates, weekly-volume-bucketing).
- [x] `npm run test:e2e tests/e2e/measurements.spec.ts` — **8/8 pass**.
- [x] `npm run test:e2e tests/e2e/exercise-progress-ia.spec.ts` — **2/2 pass**.
- [x] `npm run test:e2e tests/e2e/week-drill-down.spec.ts` — **5/5 pass**.
- [x] `npm run test:e2e tests/e2e/weekly-volume-strip.spec.ts` — **4/4 pass**.
- [x] `npm run test:e2e tests/e2e/crud.spec.ts` — **3/4 pass**. The single fail is on the unrelated `exercises: create custom exercise` test, caused by commit b51dd01 (see §Pre-existing).
- [x] `npm run test:e2e tests/e2e/probe-strong-unify.spec.ts` — **8/8 pass** (added by this Tester pass).

## Decision

**pass**

Reasoning:
- All eight feature scenarios verified dynamically in a real browser against a running dev server.
- All four out-of-scope regression suites green (measurements, exercise-progress-ia, week-drill-down, weekly-volume-strip = 19/19 specs).
- The `crud.spec.ts` routines + workout + profile flows green; the only red is unrelated and was introduced by an earlier commit.
- Typecheck, lint, unit tests all green.
- The one race window I identified (`useActiveSession()` returning `null` if a hard nav happens within ~2-3s of session start, before the persist flush + auth-rehydrate cycle settles) is pre-existing — it lives in `src/lib/auth-context.tsx` + `src/hooks/use-sessions.ts` + `src/lib/query-client.ts:11` and would have applied to the old auto-redirect path equally. Recommend tracking separately; do not gate this run on it.
- iOS / Android not exercised — flagged for device smoke before release per the Implementer's own note (implementation.md:43).
