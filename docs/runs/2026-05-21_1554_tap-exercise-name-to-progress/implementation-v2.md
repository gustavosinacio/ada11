# Implementation v2 — 2026-05-21_1554_tap-exercise-name-to-progress

Fix round addressing Tester's two findings in `test-report-v1.md`:
- **Bug A (product)**: history detail → exercise progress → browser back skips past `/history/{id}` and lands on `/history` (the list). Root cause was non-obvious — required reading expo-router's web linking integration.
- **Bug B (test)**: `$`-anchored URL regex in the new live-workout arm didn't allow expo-router's `?id=…` query suffix; also missing a sister arm for the history-detail flow.

## Root cause of Bug A

The Tabs navigator at `app/(app)/_layout.tsx` was using the default `backBehavior` of `'firstRoute'`. With `'firstRoute'`, the Tabs navigator's internal `history` array length is computed by `getRouteHistory` in `@react-navigation/routers/lib/module/TabRouter.js`:

- focused index === 0 → `history.length = 1` (just the focused tab)
- focused index !== 0 → `history.length = 2` (the first tab + the focused tab)

expo-router's web linking integration (`node_modules/expo-router/build/fork/useLinking.js:354-397`) decides between `history.pushState` vs `history.replaceState` by comparing the **focused state's history length** before and after the navigation, via `findMatchingState`:

```js
const historyDelta = (focusedState.history ? focusedState.history.length : focusedState.routes.length) -
    (previousFocusedState.history ? ...);
if (historyDelta > 0)      history.push(...)
else if (historyDelta < 0) history.go(...)
else                       history.replace(...)   // ← bug path
```

When `findMatchingState` walks down from the root, it stops as soon as it finds a state object where either the focused route key changed or the history length changed. For our two cases, the focused tab changes at the Tabs level, so `findMatchingState` returns the **Tabs navigator** as the focused state on both sides.

- **Workout case (works)**: source = workout-tab (index=0, history.length=**1**), dest = exercises-tab (index !== 0, history.length=**2**). Delta = +1 → `history.pushState`. ✓
- **History case (bug)**: source = history-tab (index !== 0, history.length=**2**), dest = exercises-tab (index !== 0, history.length=**2**). Delta = 0 → `history.replaceState`. The URL changed but the browser history stack did NOT grow. Browser back popped to `/history` instead of `/history/{id}`. ✗

The bug is entirely **expo-router's web routing layer interacting with the Tabs `backBehavior='firstRoute'` default**. It's not a callsite bug, not a component bug, not a `router.push` vs `router.replace` choice. The same `router.push("/(app)/exercises/${id}/progress")` call worked or didn't depending on whether the source tab was the first tab (workout) or not (history, exercises, profile). This is why Tester's observation "live-workout works, history-detail doesn't" was the key diagnostic clue.

Confidence: HIGH. Mechanism is reproducible from the source code of expo-router + react-navigation TabRouter. Verified empirically: e2e test for the history-detail flow now passes 3×, including the back-stack assertion against `/history/{sessionId}` (not `/history`).

## Chosen fix

**One-line config change**: set `backBehavior="history"` on the Tabs navigator in `app/(app)/_layout.tsx`.

With `'history'`:
- Each `JUMP_TO` to a tab appends the new tab key to the Tabs history array (with dedupe of the prior entry for the same key).
- Going from history-tab → exercises-tab grows Tabs history from `[workout-key, history-key]` (length 2) to `[workout-key, history-key, exercises-key]` (length 3). Delta = +1 → `history.pushState`. ✓

Side effects considered:
- **Native back-button behavior**: with `'firstRoute'`, the OS back button on Android pops to the workout tab from anywhere. With `'history'`, it pops to the previously-focused tab. The new behavior arguably matches user mental model better, and matches web browser-back semantics. No tests assert the old behavior.
- **Web browser back**: now always a true `pushState` for tab transitions. Confirmed by passing 12/12 e2e in `exercise-progress-ia.spec.ts` and 22/22 in adjacent specs that exercise back-navigation across tabs (`week-drill-down`, `measurements`, `volume-target`, `remove-exercise`, `soft-deleted-exercises-in-history`).
- **No code changes in callsites or in `<ExerciseBlock>`**: live-workout callsite untouched (verified correct by Tester), `<ExerciseBlock>` untouched. The fix is at the layout level.

Why not a callsite-level fix (e.g., `router.navigate`, `Href` object form, `window.history.pushState` shim)?
- `router.navigate` reaches the same `linkTo` codepath — same outcome.
- `Href` object form (`{pathname: "/(app)/exercises/[id]/progress", params: {id: ex.id}}`) goes through `resolveHref` to the same string — same outcome.
- A `window.history.pushState` shim after `router.push` would race expo-router's own state→URL sync. Brittle.
- The bug is global to "any cross-tab navigation when the source tab is non-zero". Fixing it once at the Tabs config is leverage; fixing per-callsite would also fail to cover future callsites (any tap from profile, exercises, history, etc., to a different tab via deep route).

## Files changed

- `app/(app)/_layout.tsx` (edited) — added `backBehavior="history"` to `<Tabs>`, with an in-file comment explaining the why. Single config prop, no logic change.
- `tests/e2e/exercise-progress-ia.spec.ts` (edited):
  - Relaxed URL regex in the existing live-workout arm at line 233 from `/\/exercises\/[0-9a-f-]+\/progress$/` to `/\/exercises\/[0-9a-f-]+\/progress(\?.*)?$/` to allow expo-router web's `?id=<uuid>` query suffix.
  - Added a sister e2e arm `name tap in history detail block routes to /exercises/{id}/progress and back to detail` that creates a workout, adds Bench Press, logs a working set, finishes via the 3-button modal, opens History, taps the session row, taps the exercise name, asserts `/exercises/{uuid}/progress` URL, then asserts `goBack()` returns to `/history/{sessionId}` (NOT `/history`). This is the permanent regression guard for Bug A.

## Deviations from design

- **None.** The original `design-v1.md` did not anticipate Bug A (the back-stack regression was a routing-layer side effect, not a design omission). The fix preserves the design's callsite wiring (`router.push("/(app)/exercises/${ex.id}/progress")` from both `app/(app)/workout/[sessionId].tsx:325` and `app/(app)/history/[id].tsx:246`) verbatim. The `<ExerciseBlock>` change from implementation-v1 (`onPressName` prop with `<Pressable>` wrapper) is unchanged.

## Soft callbacks made (during this fix pass)

- None. Root cause was discoverable from expo-router and react-navigation source. No human input required.

## Quality gates

- [x] `npm run typecheck` passed — `tsc --noEmit` exit 0, no output.
- [x] `npm run lint` passed — `0 errors, 1 warnings`. Only warning is pre-existing in auto-generated `router.d.ts` (unrelated to this run).
- [x] `npm run test:unit` — **87/87 passed** (8 files, 0.92s).
- [x] No new `any` in any touched file.
- [x] No new `// @ts-ignore`.
- [x] No stray `console.log` (verified by grep on touched files).
- [x] `npm run test:e2e tests/e2e/exercise-progress-ia.spec.ts` — **4/4 passed** on a single run, **12/12 passed** with `--repeat-each=3` (deterministic, no flake).
- [x] Adjacent e2e under `--repeat-each=1`: `week-drill-down.spec.ts`, `measurements.spec.ts`, `volume-target.spec.ts`, `remove-exercise.spec.ts`, `soft-deleted-exercises-in-history.spec.ts` — **22/22 passed**. No regressions from the `backBehavior` change.

## Notes for Reviewer / Tester

- **Reviewer**: the leverage of this fix is its smallest-surface-area property. Single prop change at the layout level. No new abstractions, no per-callsite branching, no platform-conditional code. The in-file comment explains the failure mode so future devs don't accidentally remove the prop. Suggest re-reading `node_modules/expo-router/build/fork/useLinking.js:340-397` and `@react-navigation/routers/lib/module/TabRouter.js:58-87` (the `changeIndex` and `getRouteHistory` functions) to corroborate the root cause analysis above.
- **Reviewer**: the change does NOT affect any prop, screen, or component file other than `app/(app)/_layout.tsx`. The implementation-v1 `<ExerciseBlock>` and callsite wiring are preserved unchanged. So everything reviewed in `review-v1.md` for those pieces still applies.
- **Tester**: the new e2e arm in `exercise-progress-ia.spec.ts` (`name tap in history detail block routes to /exercises/{id}/progress and back to detail`) is the regression guard for Bug A. If it ever fails again, the most likely culprit is someone removing `backBehavior="history"` from `app/(app)/_layout.tsx`, or expo-router/react-navigation changing their tab-history accounting.
- **Tester**: the existing live-workout arm's URL regex was relaxed to `\/exercises\/[0-9a-f-]+\/progress(\?.*)?$`. The same suffix-permissive pattern is used in the new history-detail arm. Apply this idiom to any future arm that asserts a `/exercises/{id}/progress` URL when the source tab is NOT the exercises tab — expo-router web appends `?id=<uuid>` in that case.
- **Tester**: the new arm uses "Check all and finish" from the 3-button modal to handle the unchecked-set state after logging a working set. This exercises a different finish path than the existing live-workout arm (which adds an exercise but no set, and finishes via the 2-button confirm dialog). Both paths now have at least one passing arm in this spec.
- **Tester**: the row selector for the history list uses the regex `/·\s*\d+m\b/` to match the duration substring (e.g. " · 0m") — unique to a session-summary row and absent from the tab bar. The history list doesn't currently pass `totalSets` to `<SessionSummaryRow>`, so I cannot anchor on "N sets" / "N set" text. If the list ever starts passing `totalSets`, the selector can be tightened.
- **Native testing**: iOS and Android were not tested in this environment. The fix is web-routing-layer-specific (the issue was in `useLinking.js` which is only used on web), but `backBehavior="history"` does change OS back-button semantics on Android. Recommend a manual smoke on a physical device or simulator before shipping a release.
