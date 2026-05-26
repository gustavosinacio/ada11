# Validation v1 — 2026-05-26_0307_bottom-tab-home-link

Reviewing: `design-v1.md`

## Verification of Designer's claims

| Claim | Verified? | Evidence |
|---|---|---|
| `screenListeners` is a valid prop on `<Tabs>` in expo-router 6.0.23 | yes | `node_modules/expo-router/build/layouts/TabsClient.d.ts:14-35, 63-85, 107-128` — three structurally identical declarations of `screenListeners?: Partial<{ tabPress: ... }> \| ((props: { route, navigation }) => Partial<{...}>)`. Installed version verified at `node_modules/expo-router/package.json:3` = `"6.0.23"`. |
| `tabPress` event is `cancelable` (`canPreventDefault: true`) | yes | `node_modules/@react-navigation/bottom-tabs/src/types.tsx:31-36` — `tabPress: { data: undefined; canPreventDefault: true }`. The generic third arg `true` on `EventListenerCallback<…, "tabPress", true>` in `TabsClient.d.ts:15, 27, 64, …` confirms `e.preventDefault()` is type-safe. |
| `navigation.isFocused()` returns `boolean` synchronously | yes | `node_modules/@react-navigation/core/src/types.tsx:379` — `isFocused(): boolean` is on `NavigationProp`. |
| `navigation.popToTop()` is a method on the navigation prop passed to `screenListeners.tabPress` | **NO — FALSE CLAIM** | `BottomTabNavigationProp` = `NavigationProp<…> & TabActionHelpers<…>` (`bottom-tabs/src/types.tsx:58-70`). `TabActionHelpers` exposes ONLY `jumpTo` (`routers/src/TabRouter.tsx:61-75`). `NavigationProp` exposes `navigate / preload / reset / goBack / isFocused / canGoBack / getId / getParent / getState` (`core/src/types.tsx:340-407`) — **no `popToTop`**. `CommonActions` injected at `core/src/useNavigationCache.tsx:80-83, 180-183` has no `popToTop` either (only `navigate, goBack, reset, setParams, preload`). `popToTop` lives ONLY on `StackActionHelpers` (`routers/src/StackRouter.tsx:65, 148-150`), which is mixed into Stack/native-stack navigation props, NOT Tabs. Under TypeScript strict mode (`tsconfig.json:"strict": true`), `navigation.popToTop()` from the Tabs-level `screenListeners` is a **type error**, and at runtime it would throw `TypeError: navigation.popToTop is not a function` (the navigation object is built from `{...base, ...helpers, ...emitter, dispatch, ...}` at `useNavigationCache.tsx:198-203` with `helpers` derived only from `router.actionCreators ∪ CommonActions`). |
| `popToTop` on a stack with one route is a safe no-op | yes | `routers/src/StackRouter.tsx:565-573` — `POP_TO_TOP` is rewritten to `POP { count: routes.length - 1 }`. With one route, count = 0; the `POP` handler at `:543-563` checks `currentIndex > 0` first and returns `null` (no state change) when `currentIndex === 0`. Designer's "harmless on leaf" claim is correct **in principle** — but moot because the call never reaches the stack router (see previous row). |
| `backBehavior` and `screenListeners` are independent props | yes (orthogonality) | Both are independent fields on the `BottomTabNavigatorProps` declared at `TabsClient.d.ts:6-50` — `backBehavior` is inherited (via `Omit<…, "screenListeners">`) from `BottomTabNavigatorProps`; `screenListeners` is added back as a sibling field. No co-dependency. **However**, see BLK-1 — the design's *control flow* breaks even though the prop slot is orthogonal. |
| Five visible tabs (Workout, Exercises, History, Progress, Profile) | yes | `app/(app)/_layout.tsx:28-70` — `workout` (28-34), `exercises` (39-45), `history` (46-52), `progress` (53-59), `profile` (64-70). Hidden tabs `routines` (35-38) and `measurements` (60-63) both `href: null`. |
| Each visible tab is a `<Stack>` (so `popToTop` semantically applies) | partial | Workout/Exercises/History/Progress all use `<Stack screenOptions={{ headerShown: false }} />` from `expo-router` (verified in their `_layout.tsx` files). Profile is a single leaf file `app/(app)/profile.tsx` with NO stack — but it's a top-level route, so the Tabs navigator's child for `profile` is just the screen, not a Stack. The Designer's "uniformity" claim is fine **only because** the call no-ops on Profile — but again, moot because the call throws first (BLK-1). |
| `router.replace("/(app)/<section>")` precedent at `workout/verdict/[sessionId].tsx:114, 211` | yes | Verified via `grep -n "router.replace" app/(app)/workout/verdict/[sessionId].tsx` — `:114` and `:211` use `router.replace("/(app)/workout")`. The Designer's rejection rationale ("pushes a new history entry on web → antagonises `backBehavior=history`") is **plausible but unverified**: `router.replace` should issue `replaceState`, not `pushState`, on web. Designer's prose is a soft-confused on the actual semantics, but the rejection's net direction (prefer non-`replace`) is not load-bearing for the validation. |
| Expo Router's `<Stack>` fork already auto-pops on tabPress | **CLAIM NOT MADE — but DISCOVERY MISSED IT** | `node_modules/expo-router/build/fork/native-stack/createNativeStackNavigator.js:54-67` (and the source map at `:1` exposing the original `.tsx`) — every `<Stack>` rendered under `<Tabs>` already subscribes via `navigation.addListener('tabPress', …)`, checks `state.index > 0 && navigation.isFocused() && !e.defaultPrevented` in a `requestAnimationFrame`, then `navigation.dispatch({ ...StackActions.popToTop(), target: state.key })`. This means the feature behaviour the user wants **should already be working out-of-the-box for the four tabs that use `<Stack>`** (Workout, Exercises, History, Progress). Discovery `:90` claimed "No prior tap-to-reset stack pattern in the codebase — greenfield", which is **incomplete**: greenfield in *our* code, but the framework already implements it. The Designer inherited Discovery's framing without verifying. This re-frames the entire problem — see MAJ-1. |
| Existing tab-label e2e pattern at `tests/e2e/auth.spec.ts:301-303` | yes | Verified — `page.getByText("Profile", { exact: true }).first().click()` then `waitForURL(/\/profile/)`. Designer's proposed test shape is consistent with this. |

## Issues found

### Blockers

- **[BLK-1]** `design-v1.md:26-32` and `:43` ("`navigation.popToTop()` is provided by the **child** Stack navigator"): the proposed code calls `navigation.popToTop()` where `navigation` is the **Tabs**'s `BottomTabNavigationProp`, which has no `popToTop` method (verified at `bottom-tabs/src/types.tsx:58-70`, `routers/src/TabRouter.tsx:61-75`, `core/src/types.tsx:340-407`, and `core/src/useNavigationCache.tsx:80-91, 180-196`). Under `strict: true` (tsconfig.json), this is a type error; at runtime it throws `TypeError: undefined is not a function`. The Designer's claim that `popToTop` is "provided by the child Stack navigator" (`design-v1.md:43`) is factually wrong — `popToTop` lives on `StackActionHelpers` (mixed into the Stack's `navigation`), not the Tabs', and there is no implicit forwarding via prototype, `getParent`, or dispatch. **Suggested fix**: route the action explicitly through `navigation.dispatch`. Two viable shapes:
  1. **Dispatch with a `target`** — read the focused tab's child Stack state key from `navigation.getState()` and dispatch a stack action targeted at it:
     ```ts
     screenListeners={({ navigation }) => ({
       tabPress: (e) => {
         if (!navigation.isFocused()) return;
         const tabState = navigation.getState();
         const childState = tabState.routes[tabState.index].state;
         if (childState?.type === "stack" && childState.index > 0) {
           e.preventDefault();
           navigation.dispatch({
             ...StackActions.popToTop(),
             target: childState.key,
           });
         }
       },
     })}
     ```
     Requires `import { StackActions } from "@react-navigation/native";` (a first occurrence of this import in the codebase — Discovery `:52` confirmed zero current `@react-navigation/native` imports beyond what's transitively bundled, but `StackActions` is explicitly re-exported from `@react-navigation/native` which is already a transitive dependency via `expo-router`).
  2. **Rely on expo-router's built-in auto-pop** — see MAJ-1: the fork at `node_modules/expo-router/build/fork/native-stack/createNativeStackNavigator.js:54-67` already does this for any `<Stack>` under `<Tabs>`. If the built-in behaviour is in fact firing in this codebase, the Designer's whole intervention may be redundant. Designer/Implementer must reproduce the user's "pressing the tab does not pop" report against the current `main` (no design change) **before** committing to either fix.

### Majors

- **[MAJ-1]** Discovery `:90` and design `:7, :60, :135` premise the design on "greenfield, no existing tap-to-reset pattern". This is **false at the framework level**: every `<Stack>` rendered under expo-router's `<Tabs>` already auto-pops on focused-tabPress via `navigation.addListener('tabPress', …)` → `StackActions.popToTop()` inside `node_modules/expo-router/build/fork/native-stack/createNativeStackNavigator.js:54-67` (source map at `:1` shows the original `.tsx`). Mainline react-navigation has the equivalent at `node_modules/@react-navigation/native-stack/src/navigators/createNativeStackNavigator.tsx:59-87`. **Implications**:
  - The user's report ("pressing on the exercises on the bottom page should navigate home") could mean one of three things, and the Designer never disambiguates: (a) the built-in auto-pop works but the user didn't try it correctly; (b) the auto-pop works on native but breaks on web (the `requestAnimationFrame` in the fork is suspicious on web — `e.defaultPrevented` could be racing with something else); (c) the auto-pop is actually broken for some other reason in this codebase.
  - The Designer's `screenListeners.tabPress` handler with unconditional `e.preventDefault()` would **disable the built-in auto-pop** by setting `defaultPrevented` before the fork's RAF callback runs — i.e. even if BLK-1 is fixed by removing the throwing `popToTop` call, the design as written would *break* a working feature, not enable a missing one.
  - **Suggested fix**: before any code change, the Implementer (or Designer in v2) must reproduce the user's bug against `main` on web AND iOS/Android. If the auto-pop works on a platform, the design's intervention is unneeded there. If it's broken only on web, the right fix is much smaller and targeted (e.g. a web-only listener, or filing an expo-router bug).

- **[MAJ-2]** `design-v1.md:60-66, :135` — the "Risk: LOW" / "Confidence: HIGH" calibration is unjustified given BLK-1 and MAJ-1. The design claims confidence HIGH on the basis that the pattern is "verified-available" (`:134`), but the verification only confirmed the API surface (`screenListeners` exists), NOT the behaviour (the action call). A confidence label must include actual semantic verification of the dispatched action. **Suggested fix**: in v2, calibrate confidence to MEDIUM until either (a) the auto-pop / reproduction question from MAJ-1 is settled, or (b) a runtime test of the proposed action shape is provided.

### Minors

- **[MIN-1]** `design-v1.md:78` — alternative #1 description says the navigator-level approach saves lines vs per-screen ("7 lines vs 25 lines"). This count includes the throwing `popToTop` call; the post-fix navigator-level version is ~12 lines (with the `getState()` traversal). The per-screen version is also longer when written safely (each `<Tabs.Screen>` listener would need to inspect its own child stack state via `navigation.getState()`). Designer should re-do the line count after BLK-1 is resolved — DRY argument may still hold but the magnitudes change. **Suggested fix**: drop the specific line counts; argue DRY on principle.

- **[MIN-2]** `design-v1.md:60` — claim that `popToTop` issues `history.replaceState` on web is unverified speculation. The expo-router linking layer's translation of stack actions to browser-history operations is non-trivial; the design asserts the "correct browser-history outcome (back button still works)" without citation. Given that the auto-pop already exists in the framework (MAJ-1), this prose is moot — but it shouldn't be presented as verified. **Suggested fix**: remove the "via `history.replaceState`" assertion or cite the expo-router source line that proves it.

- **[MIN-3]** `design-v1.md:51` (Behaviour matrix row "On `/profile` (leaf)") — Profile is a leaf file (no Stack), so `popToTop` would not be dispatched even via the correct `getState()` traversal (the child route has no `state.type === "stack"`). The matrix's "no-op (no stack)" outcome is correct in spirit, but the *reason* is "child has no stack state" not "popToTop is idempotent on single-route stack". **Suggested fix**: in v2, update the matrix and risk #3 prose to distinguish "leaf route (no stack to pop)" from "single-route stack (pop is idempotent)" — both are no-ops but for different reasons, and conflating them obscures BLK-1.

- **[MIN-4]** Test plan (`design-v1.md:107`) reuses `admin-seed` fixture by reference ("Reuse the existing `admin-seed` + auth fixture") without naming it. The exercise-note spec at `tests/e2e/exercise-note.spec.ts` and `tests/e2e/_helpers/` is the canonical place but the design doesn't pin the import path. **Suggested fix**: in v2, name the exact helper module (`tests/e2e/_helpers/<file>`) the new spec will import.

## Issues raised in previous validation (only if N > 1)

N/A — this is validation-v1.

## Decision

**no-go**

Reasoning:
- **BLK-1**: the proposed code throws at runtime and fails strict TypeScript. The single substantive line of the design (`navigation.popToTop()` on the Tabs nav prop) is wrong. This alone forces no-go per the playbook ("any blocker → no-go").
- **MAJ-1 + MAJ-2** independently also push to no-go (2+ majors), but more importantly they reframe the problem: the framework already implements the desired behaviour, and the Designer's intervention may be (a) unnecessary on some platforms, or (b) actively harmful (the unconditional `preventDefault()` would *disable* the built-in auto-pop).
- For v2, the Designer must:
  1. Reproduce the user's report against `main` on web AND a native target (iOS or Android) without any code change — confirm whether the built-in auto-pop actually fires.
  2. If the auto-pop works on some platforms and not others, narrow the design to the broken platform.
  3. If the auto-pop doesn't fire anywhere (unlikely but possible), use the dispatch-with-target shape from BLK-1's suggested fix #1 — NOT `navigation.popToTop()`.
  4. Re-calibrate Confidence/Risk based on verified action shape, not on API-surface availability.
  5. Address MIN-1..MIN-4 in passing.

Round budget: this was round 1 of 3 D↔V. Two rounds remain. Recommend Conductor invoke Designer for v2.
