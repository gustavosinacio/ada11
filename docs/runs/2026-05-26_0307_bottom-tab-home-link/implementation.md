# Implementation — 2026-05-26_0307_bottom-tab-home-link

Based on: `design-v2.md` (Validator-approved `go` at `validation-v2.md:55-66`).

## Files changed

- `app/(app)/_layout.tsx` (edited) — added `import { StackActions } from "@react-navigation/native"` and a navigator-level `screenListeners.tabPress` block on the existing `<Tabs>`. Listener guards: focused + child Stack present + `childState.index > 0` + `typeof childState.key === "string"`; on match, calls `e.preventDefault()` then `navigation.dispatch({ ...StackActions.popToTop(), target: childState.key })`. The load-bearing comment block on `backBehavior="history"` (lines 17-26 pre-edit) and every `<Tabs.Screen>` block are untouched.
- `tests/e2e/bottom-tab-home-link.spec.ts` (new) — three Playwright cases:
  - Case 1: deep-link to `/exercises/<id>/progress`, re-tap the Exercises tab, assert URL returns to `/exercises` and the list root marker (`New exercise` accessibilityLabel) is visible.
  - Case 2: from `/exercises/<id>/progress`, cross-tab tap History (waits for `/history$`), then `page.goBack()` and assert URL returns to `/exercises/<id>/progress` — the `backBehavior="history"` invariant guard.
  - Case 3: re-tap on Profile (leaf, no child Stack); URL stays `/profile`, "Sign out" still visible — exercises the `childState === undefined` short-circuit branch.

## Deviations from design

- **Imported `StackActions` from `@react-navigation/native` (not `@react-navigation/routers`)**. Validator's advisory MIN-NEW-2 (`validation-v2.md:43`) suggested optionally importing from `@react-navigation/routers` to keep `@react-navigation/native` "greenfield as a direct dep". Verified by grep that `@react-navigation/native` is **already** a first-party import in this codebase (`app/_layout.tsx:3` imports `{ DarkTheme, DefaultTheme, ThemeProvider }` from it). The MIN-NEW-2 premise ("greenfield") is therefore moot. Sticking with `@react-navigation/native` matches the existing import precedent and the design's `Contratos` snippet verbatim.
- **Added a 5th guard `typeof childState.key === "string"`**. `NavigationRoute.state?: NavigationState | PartialState<NavigationState>` and `PartialState` makes `key` optional (`node_modules/@react-navigation/routers/src/types.tsx:57-65`); without this guard, a hot-rehydrated state with `childState.key === undefined` would dispatch with `target: undefined`, silently routing to the Tabs navigator (which doesn't handle `POP_TO_TOP`). This addresses Validator MIN-NEW-3's prose-vs-code-defensiveness concern (`validation-v2.md:45`) by hardening the code rather than annotating the matrix — both achieve the same correctness goal, and the defensive guard is one extra cheap conjunct on a path that already short-circuits on every cross-tab tap.
- **E2E Case 1 deep-links to `/exercises/<id>/progress` (not `/exercises/<id>`)**. Design's Test plan (`design-v2.md:281-284`) clicks a row to reach `/exercises/<id>`. The actual UI route is `/exercises/<id>/progress` (verified at `app/(app)/exercises/index.tsx:64` — `onPress={() => router.push(\`/(app)/exercises/${item.id}/progress\`)}`). Both paths push frames onto the same child Stack and exercise the same `childState.index > 0` guard, so the deviation is behaviour-equivalent for what we're testing. Using `page.goto(...)` deep-link rather than a row-click eliminates a flake source (waiting for FlatList paint of the canonical catalog).
- **E2E Case 1 uses `getByLabel("New exercise")` as the list-root marker** (instead of the design's "search field placeholder, or the 'New exercise' CTA"). The exercises index has no search field placeholder (`app/(app)/exercises/index.tsx` has only a FlatList, ActivityIndicator, and the headerRight "+" Pressable with `accessibilityLabel="New exercise"`). The accessibilityLabel is the stable selector.
- **Case 3 uses `Sign out` (exact) as the Profile marker.** Verified at `app/(app)/profile.tsx:219`. The design said "profile content still visible" without naming a selector; pinning to `Sign out` matches the suite's `auth.spec.ts:307` precedent (which also uses `getByText("Sign out", { exact: true })`).

## Soft callbacks made (during this implementation pass)

None. Soft-callback budget remains 2/2.

## Quality gates

- [x] `npm run typecheck` passed (0 errors; ran after each edit and after the spec write).
- [x] `npm run lint` passed (0 errors; 1 pre-existing warning in auto-generated `.expo/types/router.d.ts`, identical to previous runs' baseline).
- [x] `npm run test:unit` passed (376/376; same total as previous run — this change is layout-only and not unit-testable).
- [x] No new `any`.
- [x] No new `// @ts-ignore`.
- [x] No stray `console.log` / debug statements.

## Notes for Reviewer / Tester

- **Reviewer**: the listener's `target: childState.key` is the exact dispatch shape expo-router's own forked native-stack uses internally (`node_modules/expo-router/build/fork/native-stack/createNativeStackNavigator.js:62-65`), so the Tabs-vs-Stack-routing correctness is upstream-validated. The extra `typeof childState.key === "string"` guard (deviation 2) is cheap and short-circuits before the dispatch — please verify it's not overly defensive (the alternative was prose annotation per Validator MIN-NEW-3; I chose code-level defensiveness).
- **Reviewer**: I did NOT soften Investigation §2's "synchronous-state" prose per Validator MIN-NEW-1 (`validation-v2.md:41`). That's a documentation change to a design doc, not a code change; the Implementer scope is code + implementation.md. The behavioural correctness is unaffected.
- **Tester**: All three e2e cases use `.first()` on tab-label clicks per the codebase precedent (8 sibling specs listed at `docs/feedback/implementer.md:22`). Cross-tab and re-tap clicks are both followed by `waitForURL` rather than inner-page assertions to mitigate the web tab-click flake warning at `tests/e2e/max-volume-window.spec.ts:9`.
- **Tester**: Case 2 specifically exercises the `backBehavior="history"` invariant — if the listener accidentally mutated the Tabs `history` array, `page.goBack()` from `/history` would land on `/workout` (the initial route the user landed on after `signInAndLand`) instead of `/exercises/<id>/progress`. This is the regression guard for the load-bearing comment at `_layout.tsx:17-26`.
- **Tester**: Case 3's 300ms `waitForTimeout` after the second Profile tap is intentional — it lets any erroneous dispatch / navigation propagate before we read `page.url()`. Without it, an immediate URL check could pass on a vacuous read before the bad navigation completes.

---

## Round 2 (I↔T) — 2026-05-26 04:25 BRT

### Alternative chosen

**Alt (a) — Custom `tabBarButton`**. The round-1 mechanism (`<Tabs screenListeners.tabPress>`) does NOT receive the focused-tab re-tap on web — Tester's instrumented probe captured exactly 1 `tabPress` event during the entire flow (the cross-tab click) and 0 on the re-tap (`test-report-v1.md:78-86`). Alt (b) (per-tab listener inside the child Stack) would still depend on `tabPress` firing, which it doesn't on web — same broken mechanism, different location. Alt (a) owns the press at the button level, bypassing the framework's `tabPress` event chain entirely.

### Implementation

`app/(app)/_layout.tsx`:
- Replaced the round-1 `screenListeners` prop with `screenOptions.tabBarButton: HomeLinkTabBarButton`.
- `HomeLinkTabBarButton(props: BottomTabBarButtonProps)`:
  - Uses `useNavigation<NavigationProp<ParamListBase>>()` and `useRoute()` to read the per-tab navigation prop and route (`<NavigationProvider>` at `BottomTabBar.tsx:436` wraps the button with the descriptor's navigation, so `navigation.getState()` returns the Tabs `TabNavigationState` and `route` is this tab's route).
  - On press, when `aria-selected === true` AND `tabsState.routes[i].state.type === "stack"` AND `state.index > 0` AND `typeof state.key === "string"`, dispatches `{ ...StackActions.popToTop(), target: childState.key }`. Otherwise, delegates to `props.onPress` (the BottomTabBar's onPress that emits `tabPress` + dispatches navigate).
  - Strips `href` from `BottomTabBarButtonProps` before forwarding to `PlatformPressable`. With `href`, react-native-web renders an `<a>` whose browser-native click semantics interfered with the synthetic-event onPress in round 1's reasoning. Without `href`, PlatformPressable renders a `<div role="button">` (or `role="tab"` since the BottomTabBar passes `role: "tab"` in `rest`, which spreads after PlatformPressable's role default and wins). The framework default `tabBarButton` injection for `href: null` routes (`routines`, `measurements` — see `node_modules/expo-router/build/layouts/TabsClient.js:18-44`) still applies because per-screen options override the navigator-level `screenOptions.tabBarButton`; those tabs still render as `null`.
- Cleaned up the round-1 `screenListeners` block and the now-unused `screenListeners` prop entirely.

`tests/e2e/bottom-tab-home-link.spec.ts`:
- Switched every tab-bar click from `page.getByText("<Tab>", { exact: true }).first()` to `page.getByRole("tab", { name: "<Tab>" })`. The page's `<HeaderTitle>` renders as `<Text role="heading" aria-level=1>` whose text can collide with the tab name (e.g. on `/exercises/<id>/progress`, an `Exercises` header h1 appears in DOM before the tab bar item, often as a non-visible element that `.first()` keeps retrying-until-timeout). `getByRole("tab")` disambiguates via the role attribute that `BottomTabItem.tsx:341` sets on every tab-bar button. This locator was empirically verified during the runtime probe (see below).

### Runtime probe (mandatory per round-2 brief)

A temporary probe spec at `tests/e2e/_probe-home-link.spec.ts` (deleted after the run) instrumented `HomeLinkTabBarButton` with a `console.log` on every press and exercised the click-through flow: sign-in → click Exercises tab → click Bench Press row → re-tap Exercises tab. The probe ran via `npx playwright test tests/e2e/_probe-home-link.spec.ts --workers=1` against the dev server already running on `http://localhost:8081`.

**Probe result** (parsed from `/tmp/probe-results-3.json`):

```
status: passed
duration: 5377 ms
stdout entries: 4
  [PROBE-DRIVER] logs BEFORE retap (1):
    [HOME-LINK-PROBE] press {routeName: exercises, isFocused: false, ariaSelected: false, childType: undefined, childIndex: undefined}
  [PROBE-DRIVER] logs AFTER retap (2):
    [HOME-LINK-PROBE] press {routeName: exercises, isFocused: false, ariaSelected: false, childType: undefined, childIndex: undefined}
    [HOME-LINK-PROBE] press {routeName: exercises, isFocused: true, ariaSelected: true, childType: stack, childIndex: 1}
  [PROBE-DRIVER] NEW logs from retap (1):
    [HOME-LINK-PROBE] press {routeName: exercises, isFocused: true, ariaSelected: true, childType: stack, childIndex: 1}
  [PROBE-DRIVER] URL after retap: http://localhost:8081/exercises
```

What this proves:
1. Before re-tap (after click-through to `/exercises/<id>/progress`): 1 press log from the original cross-tab click, with `isFocused: false` (workout was focused at the time). Default branch ran, delegating to `props.onPress` → tabPress emitted → cross-tab navigate worked.
2. After re-tap: a NEW press log fired with `isFocused: true, ariaSelected: true, childType: "stack", childIndex: 1`. The custom button RECEIVED the click on the focused tab — which is exactly what round 1's `screenListeners.tabPress` did NOT.
3. URL after re-tap is `http://localhost:8081/exercises` — the popToTop dispatch on the child Stack's key reduced the child Stack from `[index, [id]/progress]` (index=1) to `[index]` (index=0). The user-visible behaviour the round-1 spec required.

This is the empirical close-loop the round-1 design lacked — Designer reasoned about the framework's listener registration but never verified that `tabPress` fires on focused re-tap on web. It doesn't. The button-level approach is reliable because it doesn't depend on the event chain.

The probe spec and its `console.log` instrumentation were removed before declaring done. The probe spec is intentionally NOT a permanent fixture — its job was a one-shot runtime confirmation, and the round-2 `bottom-tab-home-link.spec.ts` (with the `getByRole("tab")` locators) now covers the same flow.

### Deviations from round-2 brief

- **Brief allowed either Alt (a) or Alt (b)**. I picked Alt (a). Justification: Alt (b) listens for the same `tabPress` event that Tester's probe showed doesn't fire on focused re-tap — moving the listener location wouldn't fix the source of the failure. Alt (a) replaces the event-driven trigger with a direct press handler.
- **Stripped `href` from `BottomTabBarButtonProps`**. The brief hinted at "custom Pressable that knows whether it's the currently-focused tab" without specifying whether to keep or drop `href`. I dropped it because keeping `href` would (a) re-introduce the `<a>` element that may have been part of the round-1 failure mode and (b) makes the button's role inconsistent (`role="link"` from PlatformPressable's `href`-conditional vs `role="tab"` from the BottomTabBar's spread). Stripping `href` means right-click "open in new tab" on web no longer works for the tab bar — acceptable trade-off for a in-app shell; the tab bar isn't meant to be a deep-link surface.
- **Updated the e2e spec's locators**. Brief said "the existing test is fine — Implementer may want to change Case 1 from `page.goto` deep-link to a click-through". I kept the `page.goto` deep-link (it's faster than the click-through and exercises the same `childState.index > 0` guard) but DID change the tab-bar locators from `getByText(...).first()` to `getByRole("tab", { name })` to fix the `<HeaderTitle>` collision (which was the WHY behind my round-2 probe's first failure — the locator was matching a non-visible h1 on the route header, not the tab bar item). Locator change is also the kind of "convention-driven authoring" lesson called out in `docs/feedback/implementer.md:20` from the routine-builder run.
- **Probe spec not retained**. Per the round-2 brief's emphasis on runtime verification, I kept the probe long enough to capture the evidence then deleted it. A permanent probe spec would duplicate what `bottom-tab-home-link.spec.ts` already covers (now with corrected locators).

### Quality gates (post-round-2)

- [x] `npm run typecheck` — 0 errors. Verified after each `Edit` to `app/(app)/_layout.tsx` and to the e2e spec.
- [x] `npm run lint` — 0 errors, 1 pre-existing warning in auto-generated `.expo/types/router.d.ts` (baseline unchanged).
- [x] `npm run test:unit` — 24 files / 376 tests pass (1.98 s). Layout-only change; no unit tests added.
- [x] No new `any` (the only `as` cast is the generic on `useNavigation<NavigationProp<ParamListBase>>` — the standard React Navigation generic shape).
- [x] No `// @ts-ignore` / `eslint-disable`.
- [x] No stray `console.log` — temporary probe `console.log` removed; only the existing `console.warn("Start failed", err)` site (unchanged) elsewhere in the codebase.

### Soft callbacks made (during round 2)

None. Soft-callback budget remains 2/2.

### Files touched in round 2

- `app/(app)/_layout.tsx` — replaced `screenListeners` with `HomeLinkTabBarButton` via `screenOptions.tabBarButton`; added imports for `PlatformPressable`, `useNavigation`, `useRoute`, `BottomTabBarButtonProps`.
- `tests/e2e/bottom-tab-home-link.spec.ts` — replaced 6 `getByText("<Tab>").first()` calls with `getByRole("tab", { name })`; updated the file-header comment block.

### Notes for Tester (round-2 re-run)

- The button-level mechanism is empirically verified on web for the focused re-tap (probe evidence above).
- The e2e spec now uses `getByRole("tab", { name })` for tab-bar clicks; this should disambiguate from the `<HeaderTitle>` `<Text role="heading">` collision that was a flake source on `/exercises/<id>/progress`. If the e2e suite still flakes on tab clicks, double-check that `role="tab"` is reaching the DOM via the `BottomTabBar`'s `role` prop spreading into the button (`BottomTabBar.tsx:341` + the custom button's `{...rest}`).
- Native (iOS/Android) was not runtime-verified — same caveat as round 1's design doc. The button-level mechanism is platform-agnostic (no `Platform.OS` branches) and uses the same dispatch shape the expo-router fork itself uses internally. Reasonable confidence it works on native; please flag if you find otherwise.
