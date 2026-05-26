# Test report v1 — 2026-05-26_0307_bottom-tab-home-link

Testing: implementation against `design-v2.md` (Validator-approved `go` at `validation-v2.md:55-66`).

## Environment
- Commands used to run app: `npm run web` (dev server already running on port 8081; verified via `curl -s -o /dev/null -w "%{http_code}" http://localhost:8081` → 200).
- Browser / device: Chromium via Playwright 1.59.1, headless web (per `playwright.config.ts:21` `use.headless: true`).
- Test data: fresh users created per-test via `createConfirmedUser` admin-seed pattern (matches the spec's fixture).
- Date: 2026-05-26 03:50–04:10 BRT.

## Static gates (re-verify pre-Test)

| Gate | Result | Evidence |
|---|---|---|
| `npm run typecheck` | pass — 0 errors | `tsc --noEmit` clean exit. |
| `npm run lint` | pass — 0 errors, 1 pre-existing warning | `ESLint: 0 errors, 1 warnings in 1 files`; top file `router.d.ts` (auto-generated, identical to baseline). |
| `npm run test:unit` | pass — 376/376 | 24 files, all passed. Implementer's report identical (`implementation.md:29`). |

Static gates all green — same baseline as Implementer's report (`implementation.md:27-29`) and Reviewer's re-verification (`review-v1.md:23`).

## Golden path

**Spec** (from `design-v2.md > Goal`, line 105-107):
> When a bottom-tab section is already focused, tapping its tab icon pops that section's stack back to the section's index route (Strong / Instagram convention).

**Steps run** (new spec at `tests/e2e/bottom-tab-home-link.spec.ts`):

Command: `npx playwright test tests/e2e/bottom-tab-home-link.spec.ts --workers=1`

Ran twice for confirmation. Identical outcome both runs.

**Result**: **fail** — Case 1 (the golden path) times out deterministically. Cases 2 and 3 pass.

| Case | Title | Result run 1 | Result run 2 |
|---|---|---|---|
| 1 | re-tap on already-focused tab pops nested → root | **FAIL** | **FAIL** |
| 2 | cross-tab tap navigates normally + browser-back preserves `backBehavior="history"` | pass | pass |
| 3 | re-tap on a leaf tab (Profile, no child Stack) is a harmless no-op | pass | pass |

**Evidence — case 1 failure (run 1)** — from `/Users/gustavoinacio/Library/Application Support/rtk/tee/1779778207_playwright.log`:

```
"title": "case 1: re-tap on already-focused tab pops nested → root",
"ok": false,
"status": "failed",
"duration": 16846,
"error": "TimeoutError: page.waitForURL: Timeout 10000ms exceeded.
  126 |       // popToTop on the child Stack. URL should return to /exercises.
  127 |       await page.getByText(\"Exercises\", { exact: true }).first().click();
> 128 |       await page.waitForURL(/\\/exercises$/, { timeout: 10_000 });"
```

Trace inspection (`/Users/gustavoinacio/github/ada11/test-results/bottom-tab-home-link-Botto-51b37-used-tab-pops-nested-→-root/trace.zip` → unique URL transitions):

```
call@8  → http://localhost:8081/sign-in
call@18 → http://localhost:8081/workout
call@23 → http://localhost:8081/exercises               (cross-tab click)
call@31 → http://localhost:8081/exercises/<id>/progress (page.goto deep-link)
call@37 → (still) http://localhost:8081/exercises/<id>/progress  ← re-tap had NO effect
```

After re-tapping the focused Exercises tab, the URL does not change. `waitForURL(/\/exercises$/)` times out at 10s.

## Root cause investigation (load-bearing — Tester ran a code-instrumented probe)

To rule out test-side artifacts (`page.goto` deep-linking might synthesize a single-route stack, in which case the listener's `childState.index > 0` guard would correctly short-circuit), Tester temporarily instrumented the listener with `console.log` calls and wrote a probe spec that uses a click-through navigation (the real user flow), then restored the listener to the Implementer's original.

Probe scenario:
1. Sign in → /workout.
2. Click Exercises tab → /exercises (cross-tab).
3. Click Bench Press row → `router.push("/(app)/exercises/<id>/progress")` → URL `/exercises/<id>/progress`.
4. Re-tap Exercises tab.
5. Capture the listener's `console.log` output (forwarded to Playwright's `page.on("console")`).

Probe result (from `/Users/gustavoinacio/Library/Application Support/rtk/tee/1779778978_playwright.log`):

```
ERR-MSG: Error: BOTTOM-TAB-PROBE events: 1; logs=["[BOTTOM-TAB-PROBE] tabPress
  {\"focused\":false,\"focusedTabName\":\"workout\",\"childPresent\":false}"]

URL after re-tap: http://localhost:8081/exercises/<id>/progress
                  (pre-retap: http://localhost:8081/exercises/<id>/progress)
```

**Diagnosis**: the `tabPress` event was emitted exactly ONCE during the entire test — for the initial cross-tab click from `/workout` to `/exercises` (with `focused: false`, correctly short-circuiting). When the user re-taps the focused Exercises tab while on `/exercises/<id>/progress`, **the bottom-tab bar does NOT emit `tabPress` at all** on web. The listener never fires; the dispatch never runs; the URL stays.

This means: the feature is non-functional on web for the very user-visible behavior the design promised. The Investigation §2 narrative in `design-v2.md:39-88` — which reasoned that `screenListeners.tabPress` would fire synchronously and pre-empt the `linkTo` race — is not what happens in practice on this version of expo-router. The listener is registered correctly (the cross-tab click at step 2 fires it), but the re-tap on a focused tab whose child Stack is non-empty never reaches the listener.

Confidence: **HIGH** on the observable failure (two deterministic test runs + an instrumented probe with one tabPress event captured vs. the four expected). MEDIUM on the precise framework-side root cause (likely either the BottomTabBar's `onPress` handler being suppressed when the route is "already" the URL target, or the `<Link>`/`Pressable` wrapping in TabsClient skipping the second click; I did not fully unwind the framework call chain). Either way, **the artifact ships broken on web**.

## Edge cases

### Edge 1: Cross-tab + browser-back (regression guard for `backBehavior="history"`)
**Steps**: Sign in → page.goto `/exercises/<id>/progress` → click History tab → page.goBack.
**Expected**: URL returns to `/exercises/<id>/progress`.
**Actual**: pass — URL returns to deep route as expected. Duration 3.7s.
**Result**: **pass**.
**Evidence**: `"case 2: ... ok: true, duration: 3666"` in run 1 and run 2 logs.

### Edge 2: Leaf-tab re-tap no-op (Profile has no child Stack)
**Steps**: Sign in → click Profile tab → click Profile tab again.
**Expected**: URL stays `/profile`, Sign out still visible.
**Actual**: pass — URL stays, content visible. Duration 2.7s.
**Result**: **pass**.
**Evidence**: `"case 3: ... ok: true, duration: 2675"` in run 1 and run 2 logs.

### Edge 3: Click-through nav (real user flow) — confirms the golden path is broken
**Steps**: Sign in → click Exercises → click Bench Press row → click Exercises again.
**Expected**: URL pops to `/exercises`.
**Actual**: URL stays at `/exercises/<id>/progress`. Instrumented listener never received tabPress for the re-tap.
**Result**: **fail** (reinforces case 1).
**Evidence**: probe-spec output captured above; trace at `/Users/gustavoinacio/github/ada11/test-results/_probe-listener-probe-list-d9587--then-re-tap-dispatchEvent-/trace.zip`.

## Regression check
- **`tests/e2e/crud.spec.ts`** (touches Routines, Exercises, Workout, History, Profile tabs in 6 different scenarios): **pass — 6/6**. Stats: `expected: 6, unexpected: 0, flaky: 0, duration: 33970ms`. Confirms that the navigator-level `screenListeners` addition does not regress cross-tab navigation or `Stack.push`/`router.push`.
- **`tests/e2e/auth.spec.ts`** (tab presence, sign-out via Profile tab): **6/7 pass; 1 pre-existing fail unrelated to this change**. Sub-tests #1, #3-7 pass. Sub-test #2 (signup flow) fails with `Email address \"e2e-signup-<ts>@test.com\" is invalid` (Supabase auth `email_address_invalid` 400 response — a Supabase project-side email-domain rejection independent of the Tabs code path). The tab-navigation-touching tests (#1 redirect-to-sign-in, #3 sign-in → workout, #5 Profile → Sign out → sign-in) all pass.

## Cross-platform
- **Web**: **fail** — golden path broken (case 1 + instrumented probe).
- **iOS**: not tested. Reason: the design's Investigation §2 (`design-v2.md:67-69`) reasons that native works via the expo-router fork's RAF-deferred `popToTop` and our explicit dispatch is idempotent there. With the web-platform failure confirmed, native behavior is moot — the artifact does not ship in a working state regardless of native correctness. Native verification is a follow-up for the next round, after the web fix.
- **Android**: not tested. Same reason as iOS.

## Test commands (Tester ran)
- [x] `npm run typecheck` — 0 errors. Clean.
- [x] `npm run lint` — 0 errors, 1 pre-existing warning in `router.d.ts` (auto-generated, unchanged baseline).
- [x] `npm run test:unit` — 24 files / 376 tests, all pass (1.97s).
- [x] `npx playwright test tests/e2e/bottom-tab-home-link.spec.ts --workers=1` — 2/3 pass, 1/3 fail (case 1). Run twice. Deterministic.
- [x] `npx playwright test tests/e2e/auth.spec.ts --workers=1` — 6/7 pass (1 pre-existing supabase auth side issue, unrelated).
- [x] `npx playwright test tests/e2e/crud.spec.ts --workers=1` — 6/6 pass.

## Decision

**fail**

Reasoning:
- The headline behavior the user explicitly requested ("Pressing on the exercises on the bottom page should navigate home" — `state.md:5`) does NOT work on web. Tested with both the design's `page.goto` deep-link approach (case 1 of the new spec) AND a click-through probe (which mirrors the actual user flow). Both deterministically leave the URL at the nested route.
- The instrumented probe traces the failure to `tabPress` not being emitted at all on the re-tap. The screenListeners listener is wired correctly (verified by the cross-tab click triggering it), but the framework does not fire `tabPress` when re-tapping a focused tab whose child Stack has nested frames on web. This invalidates the synchronous-emit reasoning in `design-v2.md:84-87`.
- Cases 2 and 3 pass, but they do not exercise the user-requested feature — Case 2 is a `backBehavior="history"` guard (cross-tab + goBack), Case 3 is a leaf-tab no-op. Neither validates the popToTop behavior.
- Adjacent regression checks (crud, auth) show no regression — the listener does not break existing flows; it just doesn't deliver the new behavior.
- Static gates (typecheck / lint / unit) are clean.

Recommendation to Conductor: **return to Implementer (Implement↔Test round 2)** with a clear scope note:
1. The current `screenListeners.tabPress` approach does not capture the focused-tab re-tap on web — design assumption from Investigation §2 was wrong about the synchronous-emit ordering. The framework does not emit `tabPress` for that gesture on web at all.
2. Implementer should investigate alternative mechanisms. Two candidates worth exploring:
   - **Custom `tabBarButton`**: replace the default render with a `Pressable` that explicitly checks `focused` and calls `navigation.popToTop()` (or dispatches StackActions) on press, bypassing the framework's tabPress emission entirely. The fork's hidden-tab path (`TabsClient.js:25-43`) already shows the pattern of wrapping `tabBarButton` with `<Link>`/`<Pressable>`.
   - **Per-tab `<Stack.Screen listeners={...}>`** in each child `_layout.tsx` (workout, exercises, history, progress), attaching a tab-focus-based handler that pops when the focused-tab state has nested routes on re-press. The discovery's earlier framing of "per-`<Tabs.Screen>` listeners" (alternative discarded as MIN-1 of the design diff) may need re-evaluation — possibly the listener needs to be inside the child Stack's navigator, not at the Tabs level.
   - Either way, the next design pass needs **runtime verification** (a quick smoke before committing) that the chosen approach actually receives the re-tap event on web.
3. The Test spec at `tests/e2e/bottom-tab-home-link.spec.ts` is mostly fine — Case 1 correctly captures the requirement. Implementer may want to change Case 1 from `page.goto` deep-link to a click-through (`/exercises` → click Bench Press row → re-tap) so the test exercises the actual user flow and not the URL-rehydration path. The fix itself should make the existing test pass.

Counts: `{ blockers: 1 (golden path fails), majors: 0, minors: 0 }`. Budget: Implement↔Test 1/2 used; 1 round remaining.
