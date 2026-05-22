# Test report v1 — 2026-05-22_1415_rest-timer-auto-start

Testing: implementation against `design-v1.md`.

## Environment

- Commands used to run app: dev server already running on http://localhost:8081 (`npm run web`, started before this session; verified `200 OK` on `/`).
- Browser / device: Playwright Chromium (default in `playwright.config.ts`, `headless: true`).
- Test data: fresh per-test users via `admin.auth.admin.createUser`, seed exercises auto-provisioned at user creation, routine/sets seeded via service-role client.
- Node / Playwright: from repo lockfile (`@playwright/test 1.59.1`).

## Golden path

**Spec** (from design): checking a `working` set on an exercise with `target_rest_seconds > 0` flips the bottom rest-timer overlay from idle ("Rest timer" label + quick-start buttons) to running ("Resting" label + countdown + Skip), starting at the routine's target seconds.

**Steps run** (Playwright scenario 1 in `tests/e2e/rest-timer-auto-start.spec.ts:246-289`):

1. Seed a routine with `target_rest_seconds = 90` on Bench Press, `null` on Back Squat; one unchecked working set on Bench Press.
2. Sign in as the seeded user, navigate to the live session.
3. Assert overlay starts idle (`getByText("Rest timer")` visible).
4. Click the "Mark set as completed" affordance on the unchecked working set.
5. Assert overlay flips to running (`getByText("Resting")` visible within 5s) and `remainingSeconds ∈ [89, 90]`.

**Result**: **fail**

**Evidence**:

```
[failed] working-set check on exercise with rest configured → overlay shows countdown
   Error: expect(locator).toBeVisible() failed
   Locator: getByText('Resting', { exact: true })
   Expected: visible
   Timeout: 5000ms
   Error: element(s) not found
   (tests/e2e/rest-timer-auto-start.spec.ts:207 — inside expectOverlayRunning)
```

Trace screenshot saved at `docs/runs/2026-05-22_1415_rest-timer-auto-start/screenshots/failure-overlay-stays-idle.jpeg` (extracted from Playwright trace `test-results/rest-timer-auto-start-Rest-ecafd-d-→-overlay-shows-countdown/trace.zip`):

- The seeded working set on Bench Press IS visibly checked (green check icon, row highlighted green) — confirming the mutation completed.
- The rest-timer overlay at the bottom of the screen still shows the **idle** state: label "Rest timer", with the `1m / 1.5m / 2m / 3m` quick-start buttons. Countdown never appeared.
- This is the state ~5 seconds after the check click.

## Edge cases

### Edge 1: warmup-set check → overlay stays idle

**Steps**: seed warmup set; click check; wait 500ms; assert idle.
**Expected**: overlay never flips.
**Actual**: overlay stays idle.
**Result**: **pass** (but see Caveat below — this scenario is also satisfied vacuously by the underlying bug.)

**Evidence**:

```
[passed] warmup check → overlay stays idle
```

**Caveat**: because the same bug that breaks Edge 4 also prevents the running-state propagation in the golden path, a "no flip" assertion will pass even if the handler is being invoked correctly. This scenario does not, on its own, prove that the warmup gate works — but combined with Edge 4 (re-check restarts), it would, if Edge 4 passed.

### Edge 2: dropset-set check → overlay stays idle

**Steps**: seed parent working set + child dropset; click check on the drop; assert idle.
**Expected**: overlay never flips.
**Actual**: overlay stays idle.
**Result**: **pass** (same vacuous-pass caveat as Edge 1).

**Evidence**:

```
[passed] dropset check → overlay stays idle
```

### Edge 3: working-set check on exercise WITHOUT `target_rest_seconds` → overlay stays idle

**Steps**: seed working set on Back Squat (`target_rest_seconds = null`); click check; assert idle.
**Expected**: overlay never flips.
**Actual**: overlay stays idle.
**Result**: **pass** (vacuous-pass caveat).

**Evidence**:

```
[passed] working-set check on exercise WITHOUT rest configured → overlay stays idle
```

### Edge 4: re-check after uncheck restarts the timer with a fresh count

**Steps**: check working set → wait ~5s → uncheck → re-check; assert overlay running with `remainingSeconds >= 88` (proves overwrite, not 85).
**Expected**: overlay running, fresh countdown.
**Actual**: overlay never flips on the first check; test fails at the same `expectOverlayRunning` assertion.
**Result**: **fail**

**Evidence**:

```
[failed] re-check after uncheck restarts the timer with a fresh count
   Error: expect(locator).toBeVisible() failed
   Locator: getByText('Resting', { exact: true })
   Expected: visible
   Timeout: 5000ms
```

### Edge 5: bulk "Check all and finish" does NOT fire the timer

**Steps**: 2 unchecked working sets → Finish modal → "Check all and finish" → land on verdict → navigate back to session; assert overlay idle (also asserts AsyncStorage carries no leftover persisted timer).
**Expected**: overlay never flipped during the bulk path.
**Actual**: overlay stays idle throughout.
**Result**: **pass** (vacuous w.r.t. the new code path, but the design-relevant invariant — bulk-check bypasses the new handler — holds because `handleCheckAllAndFinish` calls `bulkCheckAll.mutateAsync()` directly per `[sessionId].tsx:259-269`).

**Evidence**:

```
[passed] bulk Check all and finish does NOT fire the timer
```

### Edge 6 (MIN-1): nav-away survival — timer persists across navigation

**Steps**: trigger auto-start via working-set check → navigate to `/exercises/<id>/progress` → wait 2s → navigate back; assert overlay still running with `remainingSeconds >= 80`.
**Expected**: overlay running.
**Actual**: overlay never flipped at step 1; test fails at the first `expectOverlayRunning`.
**Result**: **fail**

**Evidence**:

```
[failed] MIN-1: nav-away survival — timer persists across navigation
   Error: expect(locator).toBeVisible() failed
   Locator: getByText('Resting', { exact: true })
   Expected: visible
   Timeout: 5000ms
```

## Root cause (architectural)

`useRestTimer` in `src/hooks/use-rest-timer.ts:22-104` is a **stateful React hook with local state** (`useState` for `endsAt`, `totalSeconds`, `now`) — **not** a React Context, not a singleton, not an external store.

That means every component that calls `useRestTimer()` gets its own independent state instance:

- `app/(app)/workout/[sessionId].tsx:69` → `const restTimer = useRestTimer();` — instance **A** (used in handlers).
- `src/components/rest-timer-overlay.tsx:17` → `const { running, … } = useRestTimer();` — instance **B** (what the user sees).

`restTimer.start(90)` from the page handler mutates instance **A**'s `endsAt`. Instance **B** never observes it. The two instances communicate **only** through `AsyncStorage` on hydration mount (lines 29-51), which runs once per mount — neither component remounts during normal usage, so the running state never crosses the boundary.

The design (`design-v1.md:73`) explicitly assumed otherwise:

> "The screen-level `restTimer` instance at `[sessionId].tsx:69` and the always-mounted `<RestTimerOverlay>` at line 479 already subscribe to the same hook; flipping `endsAt` re-renders the overlay from idle → running automatically."

That premise is false. The hook does not share state across instances.

**Pre-existing add-set auto-start has the same bug.** `app/(app)/workout/[sessionId].tsx:373-376` calls `restTimer.start(rest)` after a successful add-set; that code path has no e2e coverage and was never validated end-to-end. It almost certainly also fails to flip the overlay in production (Designer + Validator + Reviewer all assumed the existing precedent worked — it appears it does not).

**Fix surface options** (Implementer's call):

1. **Lift to React Context.** Wrap `<RootLayout>` (or `<AppLayout>`) with a `<RestTimerProvider>` that owns the state; both call-sites read from the same context. Smallest delta to the call-site signature. Probably the cleanest fix.
2. **External store (e.g. Zustand) for the timer.** Same outcome; different mechanics.
3. **Module-level state + listener pattern** inside `use-rest-timer.ts`. Keeps the `useRestTimer()` ergonomic but introduces a global mutable singleton — works for web but needs care on RN HMR.

Option 1 is the most idiomatic and lowest-risk in this codebase (matches `auth-context.tsx`).

## Regression check

- **`tests/e2e/end-of-session-verdict.spec.ts`**: **pass** — 2/2 scenarios green. Bulk-check-all path untouched.
- **`tests/e2e/set-row-menu.spec.ts`**: **pass** — 3/3 scenarios green.
- **`tests/e2e/volume-target.spec.ts`**: 6/7 pass. **1 failure: "golden path: chasing copy + reps clause across multiple seeded sets"** — `getByText(/New PR/i)` not visible within 15s. **Confirmed NOT caused by the rest-timer change**: I stashed `app/(app)/workout/[sessionId].tsx`, re-ran the same test against the baseline, and it failed identically. This is a pre-existing flake or independent regression — out of scope for this run, but worth surfacing in the run state. Other 6 volume-target scenarios pass.

## Cross-platform

- **Web**: tested via Playwright Chromium (see above). **fail** on the golden path.
- **iOS**: not tested. The Implementer's notes flagged that web+iOS share `useRestTimer`. The architectural bug (independent hook instances) is platform-agnostic and will manifest identically on native — same code path. No platform-specific testing performed.
- **Android**: not tested. Same reasoning.

## Test commands

- [x] `npm run test:unit` — **214/214 pass** (13 test files, 1.37s). No unit regression.

  ```
  Test Files  13 passed (13)
       Tests  214 passed (214)
    Duration  1.37s
  ```

- [x] `npx playwright test tests/e2e/rest-timer-auto-start.spec.ts` — **3 failed / 4 passed of 7**.

  ```
  expected: 4  unexpected: 3  flaky: 0  skipped: 0
    [failed] working-set check on exercise with rest configured → overlay shows countdown
    [passed] warmup check → overlay stays idle
    [passed] dropset check → overlay stays idle
    [failed] re-check after uncheck restarts the timer with a fresh count
    [passed] working-set check on exercise WITHOUT rest configured → overlay stays idle
    [passed] bulk Check all and finish does NOT fire the timer
    [failed] MIN-1: nav-away survival — timer persists across navigation
  ```

  All three failures are the same root cause: `getByText('Resting')` never becomes visible because the overlay's hook instance never observes the page-handler's `restTimer.start(rest)` call.

- [x] Adjacent suites: `npx playwright test tests/e2e/volume-target.spec.ts tests/e2e/end-of-session-verdict.spec.ts tests/e2e/set-row-menu.spec.ts` — **11/12** (1 baseline failure in volume-target, not caused by this PR).

  ```
  expected: 11  unexpected: 1  flaky: 0
  ```

- [ ] `npm run typecheck` / `npm run lint` — not re-run (Implementer's quality gates already attested; the test failure is runtime behavior, not a type or lint issue).

## Decision

**fail**

Reasoning:

- Golden path (scenario 1) fails: rest-timer overlay does not flip to "Resting" after a working-set check on an exercise with `target_rest_seconds = 90`. The set IS checked (mutation succeeded, green tint visible in the trace screenshot), but the timer state in the overlay's hook instance never updates.
- Edge case 4 (re-check restart) fails for the same reason.
- Edge case 6 (MIN-1 nav-away survival) fails for the same reason.
- The "no-fire" scenarios (warmup, dropset, no-rest exercise, bulk) all pass — but they are **vacuously satisfied** by the underlying architectural bug, so they don't constitute positive evidence that the new gates (`set_type === "working"`, `restByExercise > 0`) work as designed. The handler may be invoked correctly; the visible side-effect cannot reach the overlay regardless.
- Root cause is architectural: `useRestTimer` is a per-component stateful hook with no shared store. The design assumed shared state at line 73; that assumption is false in the current code. Fix likely needs to move the timer into Context (or another shared-store pattern) at `<RestTimerProvider>` level above both the screen and the overlay.
- Adjacent regression: end-of-session-verdict ✓, set-row-menu ✓. Volume-target has 1 failure that **also reproduces without the rest-timer change** — not caused by this PR. Flag separately.
- Unit suite: 214/214 green, no regression introduced.

**Recommendation: return to Implementer.** This is round 1 of 2. The fix requires elevating `useRestTimer` state to a shared scope (Context or external store) so that `restTimer.start(s)` from `[sessionId].tsx` propagates to `<RestTimerOverlay>`. Once fixed, the new e2e spec should pass without modification — it already encodes the correct observable behavior. Implementer should also verify the same fix unblocks the pre-existing add-set auto-start at `[sessionId].tsx:373-376` (currently dead behavior, no test coverage).
