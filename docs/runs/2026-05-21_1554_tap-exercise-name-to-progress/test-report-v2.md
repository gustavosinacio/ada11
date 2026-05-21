# Test report v2 — 2026-05-21_1554_tap-exercise-name-to-progress

Re-test round after Implementer's fix (v2). Verifies Bug A (history-detail back-stack) and Bug B (e2e regex) are resolved without adjacent regressions.

## Environment
- Commands used to run app: `npm run web` (Expo web on `http://localhost:8081`)
- Browser / device: Playwright Chromium (headless)
- Test data: fresh per-test users via Supabase admin SDK (auto-cleaned)

## Spec re-run — `exercise-progress-ia.spec.ts --repeat-each=5`

**Result**: **pass (20/20)**, 0 flake.

Evidence (`./node_modules/.bin/playwright test ...spec.ts --repeat-each=5 --reporter=list`):
```
Running 20 tests using 1 worker
✓  1  golden + delete: list → progress → pencil → edit → save → progress; delete lands on list (7.0s)
✓  2  cache: finishing a session does not break the progress screen on re-entry (7.1s)
✓  3  name tap in live workout block routes to /exercises/{id}/progress and back (4.9s)
✓  4  name tap in history detail block routes to /exercises/{id}/progress and back to detail (7.8s)
✓  5  …golden+delete (5.9s)
✓  6  …cache (7.5s)
✓  7  …live workout (4.8s)
✓  8  …history detail (7.9s)
✓  9  …golden+delete (4.9s)
✓ 10  …cache (6.6s)
✓ 11  …live workout (5.0s)
✓ 12  …history detail (7.8s)
✓ 13  …golden+delete (5.8s)
✓ 14  …cache (7.2s)
✓ 15  …live workout (5.5s)
✓ 16  …history detail (8.5s)
✓ 17  …golden+delete (5.1s)
✓ 18  …cache (7.2s)
✓ 19  …live workout (5.0s)
✓ 20  …history detail (7.8s)

20 passed (2.2m)
```

The 4 history-detail repetitions (rows 4, 8, 12, 16, 20) directly assert what v1 caught:
1. Tap exercise name in `/history/{sessionId}` block.
2. URL reaches `/exercises/<uuid>/progress(?...)`.
3. `page.goBack()` returns to **`/history/<sessionId>`** (the same detail page, not `/history`).

This is the permanent regression guard for Bug A. 5/5 deterministic passes — the v1 failure mode (`history.length` unchanged → back skips to list) is gone.

## Edge — history-detail back-stack (Bug A fix verification)
**Spec**: After tapping the exercise name in a finished session's detail screen, browser/system back must return to the same session detail, not the history list.

**Steps run** (covered by spec arm `name tap in history detail block …`, repeated 5×):
1. Sign in fresh user.
2. Quick start workout, add Bench Press, log a working set.
3. Finish via 3-button modal → "Check all and finish" → `/workout`.
4. Open History tab → tap session row → `/history/<sessionId>`. Capture URL.
5. Tap exercise name pressable.
6. Wait for `/exercises/<uuid>/progress(\?.*)?$`.
7. `page.goBack()`.
8. Assert URL pathname equals captured `historyDetailUrl`.

**Result**: **pass (5/5)**

**Evidence**: spec arm at `tests/e2e/exercise-progress-ia.spec.ts:253` passed on each of the 5 repetitions (rows 4/8/12/16/20 above). v1's deterministic failure ("SKIP DETECTED: expected /history/<id>, got /history") does not reproduce.

## Edge — side-effect of `backBehavior="history"` on tab navigation
**Spec**: With `backBehavior="history"` on the Tabs navigator, tab switches honor the visit order on browser back. Workout → Profile → back must land back on Workout (not on root/login).

**Steps run** (throwaway probe `probe-tab-back-behavior.spec.ts`, deleted after analysis):
1. Sign in → `/workout`.
2. Tap Profile tab → `/profile`.
3. `page.goBack()` → assert URL pathname is `/workout`.
4. Second test: Workout → Exercises → History → Profile, then back-back-back walking through tab visit order.

**Result**: **pass (2/2)**

**Evidence**:
```
Running 2 tests using 1 worker
✓  1  Workout → Profile → back lands on Workout (3.1s)
✓  2  Workout → Exercises → History → Profile → back back back walks tab history (2.4s)

2 passed (6.2s)
```

No surprise. The `backBehavior="history"` change does not produce odd back-button behavior (e.g., bouncing to root or skipping tabs). It in fact matches user expectation more closely than the prior `'firstRoute'` default, which would have collapsed back to Workout from any tab.

## Edge — e2e regex now permissive of `?id=…` suffix (Bug B fix verification)
**Spec**: Both live-workout and history-detail name-tap arms must accept the URL shape `/exercises/<uuid>/progress(\?...)?` — expo-router web appends `?id=<uuid>` when navigating into a dynamic `[id]` route from outside the exercises stack.

**Steps run**: Re-read the spec at `tests/e2e/exercise-progress-ia.spec.ts:235` and `:308` — both arms now match `/\/exercises\/[0-9a-f-]+\/progress(\?.*)?$/`. Both arms passed all 5 reps above.

**Result**: **pass**.

## Regression check (adjacent e2e)

Ran the rest of `tests/e2e/` (excluding the spec-under-test and the unrelated probe).

Batch 1 — `auth.spec.ts`, `crud.spec.ts`, `measurements.spec.ts`:
```
19 passed, 2 failed (both pre-existing & unrelated to this run)
```
- **`auth.spec.ts:152 "sign-up flow: branches on email-confirmation setting"`**: failed with Supabase response `{"code":"email_address_invalid","message":"Email address \"e2e-signup-...@test.com\" is invalid"}`. Environment-side — Supabase now rejects `@test.com`. Not caused by `backBehavior="history"` (no auth code changed in this run; `git diff --stat HEAD` shows changes only in `app/(app)/_layout.tsx`, `app/(app)/history/[id].tsx`, `app/(app)/workout/[sessionId].tsx`, `src/components/exercise-block.tsx`, `tests/e2e/exercise-progress-ia.spec.ts`).
- **`crud.spec.ts:131 "exercises: create custom exercise (alongside seeded library)"`**: same pre-existing failure flagged in test-report-v1 — `getByPlaceholder("e.g. Chest")` no longer exists after muscles-as-multi-select refactor (commit `b51dd01`). Unrelated to this run.

Batch 2 — `remove-exercise.spec.ts`, `soft-deleted-exercises-in-history.spec.ts`, `volume-target.spec.ts`, `week-drill-down.spec.ts`, `weekly-volume-strip.spec.ts`:
```
18 passed (2.9m), 0 failed
```
All adjacent specs that touch tab navigation, history detail, and progress flow are green. In particular:
- `volume-target.spec.ts:509 "history detail does NOT render the strip"` — green; confirms history-detail page renders correctly after the layout change.
- `week-drill-down.spec.ts:388 "back navigation: detail → strip restores History list"` — green; confirms back-navigation from a per-week detail to History is still correct under `backBehavior="history"`.
- `soft-deleted-exercises-in-history.spec.ts` — green; confirms history-detail blocks still render exercises (including soft-deleted) without regression.
- `remove-exercise.spec.ts` — green; live-workout exercise flow unaffected.

Net adjacent: **37 passed, 2 failed (both pre-existing and unrelated)**. No new regressions attributable to this run.

## Cross-platform
- Web: **pass** — all golden paths, edges, and adjacent specs green; Bug A and Bug B fixed.
- iOS: **not tested** — no simulator/device available. Note: `backBehavior="history"` changes Android OS back-button semantics (and on iOS to a lesser extent via the gesture stack) — Implementer already flagged this. Manual smoke on a device is advisable before shipping. Not blocking for the pipeline run since this run's feature is web-first.
- Android: **not tested** — same reason.

## Test commands
- [x] `npm run typecheck` — `tsc --noEmit` exit 0, no output.
- [x] `npm run lint` — `0 errors, 1 warnings` (the warning is in auto-generated `router.d.ts`, pre-existing, unrelated).
- [x] `npm run test:unit` — **87/87 passed** (8 files, 865ms).
- [x] `npm run test:e2e tests/e2e/exercise-progress-ia.spec.ts --repeat-each=5` — **20/20 passed** (2.2m).
- [x] Adjacent e2e: **37 passed, 2 pre-existing failures unrelated** (auth env, crud refactor leftover).

## Decision

**pass**

Reasoning:
- Bug A (history-detail back-stack) is fixed and locked in by a passing spec arm executed 5× with no flake. `backBehavior="history"` is the right leverage point.
- Bug B (e2e regex) is fixed; both name-tap arms accept the `?id=` suffix; both arms pass deterministically.
- Tab-switching back-button semantics under the new `backBehavior` were spot-checked with a throwaway probe — no surprises, behavior matches user expectations.
- All quality gates green (typecheck, lint, unit).
- Adjacent e2e: 37 passed; the only 2 failures are pre-existing and orthogonal (Supabase rejecting `@test.com`, and a placeholder removed by an earlier commit).
- iOS/Android remain unverified — flagged for follow-up, not blocking for this run.

Conductor: finalize.
