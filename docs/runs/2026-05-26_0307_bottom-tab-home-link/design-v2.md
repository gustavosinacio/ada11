# Design v2 — 2026-05-26_0307_bottom-tab-home-link

## Diff vs v1 (what changed and why)

| Validator issue | v1 stance | v2 resolution | Where in this doc |
|---|---|---|---|
| **BLK-1** — `navigation.popToTop()` does not exist on Tabs' `BottomTabNavigationProp` (TypeError at runtime + strict-TS error) | called `navigation.popToTop()` directly | dispatch `StackActions.popToTop()` with explicit `target: childStackState.key` read from `navigation.getState().routes[index].state` | Approach, Contratos > Listener body, Riscos #1 |
| **MAJ-1** — Expo Router's forked native-stack already auto-pops on focused `tabPress` (`node_modules/expo-router/build/fork/native-stack/createNativeStackNavigator.js:52-68`); v1's unconditional `e.preventDefault()` would have DISABLED the working framework behavior | unaware of fork; unconditional preventDefault | **kept the explicit dispatch on all platforms** (not platform-gated) because investigation shows the fork's auto-pop is **silently shadowed on web** by a second dispatch — see Investigation below. Our explicit dispatch is **idempotent on native** (after it runs, `state.index === 0`, so the fork's RAF check `state.index > 0` is false and the fork no-ops). | Investigation, Approach, Riscos #2, Behaviour matrix |
| **MAJ-2** — Confidence/Risk uncalibrated (HIGH/LOW unsupported by the BLK-1 type error and MAJ-1 framework conflict) | HIGH / LOW | **MEDIUM-HIGH / LOW** with explicit caveats: confidence is HIGH on the verified action shape and the order-of-dispatch analysis (Investigation §2), MEDIUM on the precise web-side root cause (the exact `findDivergentState` / Stack-NAVIGATE path is reasoned through but not yet runtime-traced). Risk stays LOW because the failure mode is "the existing bug persists", not "a working surface regresses". | Confiança & Risco |
| **MIN-1** — Per-screen vs navigator-level line count comparison cited specific numbers that depended on the buggy `popToTop()` shape | "7 lines vs 25 lines" | Argue DRY on principle (single block, no per-tab `route.name` switching, future-proof for added tabs); drop the magnitudes. | Alternativas descartadas #1 |
| **MIN-2** — Claim that `popToTop` issues `history.replaceState` on web was unverified speculation | asserted as fact | Removed. `Riscos #3` now states only that our dispatch is _targeted_ at the child Stack (not Tabs), so the Tabs `history` array (the load-bearing `backBehavior="history"` substrate) is **unmodified**; whether the browser-history transition is `pushState` vs `replaceState` is left to expo-router's linking layer and not asserted. | Riscos #3 |
| **MIN-3** — Behaviour matrix conflated "leaf route, no Stack" with "single-route Stack, pop is idempotent" — both are no-ops for different reasons | conflated under "no-op" | Matrix now distinguishes the two cases explicitly: Profile is "no child Stack state" (the listener's guard `childState?.type === "stack"` fails); Progress is "Stack but `state.index === 0`" (the `childState.index > 0` guard fails). | Contratos > Behaviour matrix |
| **MIN-4** — Test plan referenced "the existing admin-seed fixture" without naming a file | unnamed | Pinned to `tests/e2e/exercise-note.spec.ts:46-89` shape (admin client + `createConfirmedUser` + `signInAndLand`) and `tests/e2e/_helpers/canonical-exercise.ts:34-60` for the exercise pick. | Test plan |

---

## Investigation (load-bearing — answers MAJ-1)

### §1 Why is the user reporting the bug if the framework already auto-pops?

The fork at `node_modules/expo-router/build/fork/native-stack/createNativeStackNavigator.js:52-68` attaches an effect that subscribes to the parent navigator's `tabPress`:

```js
React.useEffect(() =>
  navigation?.addListener?.('tabPress', (e) => {
    const isFocused = navigation.isFocused();
    requestAnimationFrame(() => {
      if (state.index > 0 && isFocused && !e.defaultPrevented) {
        navigation.dispatch({ ...StackActions.popToTop(), target: state.key });
      }
    });
  }), [navigation, state.index, state.key]);
```

This effect lives inside the **child Stack** (the per-tab `<Stack>`), and `navigation` here is the **Stack's** navigation prop, which (per `core/src/useNavigationCache.tsx` and `BaseRouter` injection) **does** carry `popToTop` from `StackActionHelpers`. So inside the Stack, `popToTop()` is real. v1 was wrong only because v1 called it at the **Tabs** level. The fork's effect is correct.

### §2 The platform divergence — why native works and web doesn't

The Tabs root `<Tabs>` is the expo-router fork at `node_modules/expo-router/build/layouts/TabsClient.js`. Crucially, the **tab button rendering** diverges by platform (`TabsClient.js:16-44`):

```js
tabBarButton: (props) => {
  // ...
  const children = Platform.OS === 'web'
    ? props.children
    : <Pressable>{props.children}</Pressable>;
  return <Link {...props}
                style={[{ display: 'flex' }, props.style]}
                href={href}
                asChild={Platform.OS !== 'web'}
                children={children}/>;
}
```

`<Link>` here is expo-router's `BaseExpoRouterLink` (`node_modules/expo-router/build/link/BaseExpoRouterLink.js:50-93`). The spread `{...props}` includes the BottomTabBar's `onPress` (which is the function that **emits `tabPress`** — `node_modules/@react-navigation/bottom-tabs/src/views/BottomTabBar.tsx:398-411`). The Link's body then synthesises a local `onPress` (`BaseExpoRouterLink.js:77-82`):

```js
const onPress = (e) => {
  if ('onPress' in rest) {
    rest.onPress?.(e);   // ← BottomTabBar's onPress: emit('tabPress')
  }
  props.onPress(e);      // ← useLinkToPathProps' onPress: linkTo(href)
};
```

The wiring at lines 88-93 attaches this to either `onClick` (web) or `onPress` (native).

**On native** (iOS/Android), the inner `<Pressable>` wraps `props.children`. The native bottom-tab button's tap dispatches RN's gesture, ending up in `<PlatformPressable>`'s `onPress` (from `BottomTabItem`'s `button({onPress: rest.onPress, ...})`). Per the type signature and the spread order in `<Component {...props} {...hrefAttrs} {...rest}>` (`BaseExpoRouterLink.js:88`), `rest.onPress` (= the BottomTabBar's `tabPress`-emitter) wins. The Link's `onPress`/`onClick` listener is wired but the **inner Pressable's onPress** is what actually fires when the user taps. So on native: only `tabPress` emits → fork's listener fires → `popToTop` dispatch runs in a RAF → stack unwinds. Works.

**On web**, the rendered DOM is an `<a href>` (because `<Component>` is `Text` from react-native-web, with `hrefAttrs` and `role: "link"` — see the `Platform.select({web: {onClick: onPress}, default: {onPress}})` block). The browser click fires the `onClick` handler, which IS the local `onPress` that calls **both**:
1. `rest.onPress(e)` — emits `tabPress`. The fork's listener catches it and schedules a RAF to call `popToTop`.
2. `props.onPress(e)` — `useLinkToPathProps.onPress` (`node_modules/expo-router/build/link/useLinkToPathProps.js:30-38`) calls `linkTo(href, {})`. The href is the tab's index path (`/(app)/exercises`).

`linkTo` (`node_modules/expo-router/build/global-state/routing.js:172-210`) computes a NAVIGATE action against the nested state and enqueues it. The action targets the **child Stack** (not the Tabs), because the divergence point is inside the Stack (the action wants the index route; the current Stack top is `[id]`). It dispatches `{type: 'NAVIGATE', target: <stackKey>, payload: {name: 'index', params: ...}}`.

The Stack's `getStateForAction` (StackRouter via expo-router's `stackRouterOverride` at `StackClient.js:67-216`) processes this NAVIGATE. With `state.routes = [{name: 'index'}, {name: '[id]'}]`, `currentRoute.name === '[id]' !== 'index'`, so the early-match branch at line 82-87 misses. Falling through to line 161-194, the router **pushes a fresh `index` route on top** (because `route` is undefined and the `!route` branch at line 184 appends). Final state: `routes = [{index}, {[id]}, {index_new}]`, `state.index = 2`. URL becomes `/exercises` (the linking layer reads the top route).

Meanwhile, the fork's RAF callback fires **after** the routingQueue drains. By the time RAF runs, `state.index = 2` (still > 0) and the focused-tab check still holds, so the fork ALSO dispatches `popToTop`. This unwinds back to `[{index}]`. **End result on web**: the user sees `/exercises`, but the round-trip went `[index, [id]]` → `[index, [id], index_new]` → `[index]`. The intermediate state pushed an unwanted route, then the fork cleaned it up.

But here's the actual user-observable failure: **the RAF runs in the next microtask but the `linkTo` enqueued NAVIGATE may not have been dispatched yet** (`routingQueue` subscribers may batch across the same task). The exact race depends on `react-navigation`'s state-flush and the React-batched scheduling, and is plausibly different across React 18 strict-mode dev vs. prod. Different timings produce different observable outcomes: a stuck `[index, [id], index_new]` if the fork's RAF runs before linkTo's dispatch (RAF sees `state.index = 1`, dispatches popToTop, then linkTo's NAVIGATE arrives on the resulting `[index]` state and either no-ops or re-introduces the same problem); or a clean `[index]` if order is reversed. In neither case is the **back button** semantically clean — the Tabs `history` array got mutated by the routingQueue's NAVIGATE side effect, which is the exact substrate `backBehavior="history"` reads from for browser back.

The user-visible symptom space: (a) URL doesn't go back to `/exercises` (broken on first click); (b) the URL flickers; (c) the back button takes the user somewhere unexpected. All are reproducible from the wiring above; the exact one the user is seeing is bug-report-detail-level and our fix should be robust to any of them.

**Conclusion**: the framework's auto-pop is technically wired on web too, but it competes with `linkTo`'s NAVIGATE through the routingQueue, which the fork doesn't anticipate. Our explicit dispatch in `screenListeners` runs **synchronously inside the same `emit('tabPress')` call** — before `linkTo`'s NAVIGATE is even enqueued, and before the fork's RAF schedules. Our dispatch sets `state.index = 0` synchronously, so:
- The fork's RAF check `state.index > 0` is `false` → fork no-ops.
- The subsequent `linkTo` NAVIGATE hits a Stack at `[index]` index=0 with `action.payload.name === 'index'`. The match at `StackClient.js:82-87` is hit (`currentRoute.name === action.payload.name === 'index'`), `route = currentRoute`. The reuse branch at line 145-158 collapses to a params-only update. Stack stays `[index]`, URL stays `/exercises`. Clean.

So **the explicit dispatch from `screenListeners` is the correct fix on web** and is **idempotent on native** (the fork's `state.index > 0` check fails after our dispatch, so the fork does nothing). No platform gate is required; the listener is always-on and behavior is unified.

### §3 Why not platform-gate (Platform.OS === "web")?

Three reasons:
1. **Single code path is easier to reason about and test.** The listener body is unconditionally correct on both platforms.
2. **Idempotency on native is verified by the fork's own guard** (`state.index > 0`). After our dispatch, the guard fails — zero double-dispatch risk.
3. **Future-proofs against framework changes**: if a future expo-router release removes or changes the fork's listener, our code keeps working. If a future release improves the web path so `linkTo` no longer races with the tabPress listener, our code is still a correct (idempotent) duplicate, not a regression vector.

### §4 Why preventDefault?

The BottomTabBar emits `tabPress` with `canPreventDefault: true`. The BottomTabBar's own `onPress` (`BottomTabBar.tsx:398-411`) only dispatches `CommonActions.navigate(route)` when `!focused && !event.defaultPrevented`. When focused, the BottomTabBar already doesn't dispatch — so `preventDefault` is moot for the BottomTabBar.

`preventDefault` IS load-bearing for the fork's listener (`!e.defaultPrevented`). Since we're doing the same job, calling `preventDefault` neutralises the fork (good, avoids the RAF race) AND makes our intent explicit ("we've handled this event"). We call `preventDefault` **only** when we're actually going to pop (i.e., focused AND child Stack has depth > 0). If we don't pop, we don't preventDefault — the framework's default (a no-op since focused, but defensive) stays.

---

## Goal (1 sentence)

When a bottom-tab section is already focused, tapping its tab icon pops that section's stack back to the section's index route (Strong / Instagram convention), via an explicit `StackActions.popToTop()` dispatch targeted at the child Stack — fixing the web-platform race between `expo-router`'s built-in auto-pop and the bottom-tab's `<Link>`-routed click handler.

## Approach

Single-file edit to `app/(app)/_layout.tsx`: add a navigator-level `screenListeners` prop on the existing `<Tabs>` element. The handler intercepts `tabPress`, checks (a) `navigation.isFocused()` (the pressed tab IS the focused one), (b) `tabState.routes[tabState.index].state?.type === "stack"` (the focused tab has a child Stack — guards against Profile leaf), and (c) `childState.index > 0` (the child Stack has at least one nested route on top — guards against being at the tab's index already). When all three hold, call `e.preventDefault()` and `navigation.dispatch({ ...StackActions.popToTop(), target: childState.key })`. Import `StackActions` from `@react-navigation/native` (transitively present via `expo-router`; first first-party usage of this import, justified). The `target: childState.key` is **mandatory** — without it the dispatch routes to the Tabs navigator (which doesn't handle stack actions) and silently drops; with it, the dispatch is routed by `useNavigationBuilder` straight to the child Stack's router.

Strategy is **navigator-level `screenListeners`** rather than per-`<Tabs.Screen>` `listeners` because the behaviour is uniform (no per-tab branching), the guards work for all five visible tabs without divergence, and the single-block code is the canonical shape from the React Navigation docs.

## Mudanças por arquivo

| File | Type | Change |
|---|---|---|
| `app/(app)/_layout.tsx` | edited | (1) Add `import { StackActions } from "@react-navigation/native";` to imports. (2) Add `screenListeners` prop on the existing `<Tabs>` element. Body inspects `navigation.getState()`, applies three guards, then dispatches `popToTop` with `target` set to the child Stack's key. The existing `backBehavior="history"` prop and its load-bearing comment block (lines 17-26) stay verbatim; the five visible `<Tabs.Screen>` blocks (workout/exercises/history/progress/profile) and the two hidden tabs (routines/measurements with `href: null`) are untouched. |
| `tests/e2e/bottom-tab-home-link.spec.ts` | new | Playwright e2e with three deterministic cases: re-tap pops nested → root; cross-tab tap still navigates normally + browser-back preserves `backBehavior="history"` invariant; re-tap at tab root is a harmless no-op. Uses admin-seed fixture pattern from `tests/e2e/exercise-note.spec.ts:46-89` and `tests/e2e/_helpers/canonical-exercise.ts`. |

Total: 1 edited file, 1 new test file. One responsibility per file.

## Contratos de I/O

### Edit to `app/(app)/_layout.tsx`

```tsx
import { Tabs } from "expo-router";
import { StackActions } from "@react-navigation/native";  // NEW
import {
  Dumbbell,
  History,
  TrendingUp,
  User,
  Wrench,
} from "lucide-react-native";
import { View } from "react-native";

import { ActiveSessionBanner } from "~/components/active-session-banner";

export default function AppLayout() {
  return (
    <View className="flex-1 bg-white dark:bg-black">
      <ActiveSessionBanner />
      {/*
        backBehavior="history": each tab focus change appends to the Tabs
        navigator's `history` array, so expo-router's web linking layer sees a
        positive `historyDelta` and calls `history.pushState` (not
        `replaceState`). Without this, navigating from one non-zero tab to
        another non-zero tab (e.g. /history/[id] → /exercises/[id]/progress)
        leaves history.length unchanged and the linking layer treats the push
        as a REPLACE — browser back then skips past the source detail screen.
        See run docs/runs/2026-05-21_1554_tap-exercise-name-to-progress.
      */}
      <Tabs
        backBehavior="history"
        screenOptions={{ headerShown: false }}
        screenListeners={({ navigation }) => ({
          tabPress: (e) => {
            if (!navigation.isFocused()) return;
            const tabState = navigation.getState();
            const focusedTabRoute = tabState.routes[tabState.index];
            const childState = focusedTabRoute?.state;
            if (
              childState &&
              childState.type === "stack" &&
              typeof childState.index === "number" &&
              childState.index > 0
            ) {
              e.preventDefault();
              navigation.dispatch({
                ...StackActions.popToTop(),
                target: childState.key,
              });
            }
          },
        })}
      >
        {/* Five <Tabs.Screen> blocks + two hidden tabs — unchanged */}
      </Tabs>
    </View>
  );
}
```

### Type contract (verified)

- `screenListeners` accepts a function `({navigation, route}) => Partial<{ tabPress: EventListenerCallback<…, "tabPress", true> }>` per `node_modules/expo-router/build/layouts/TabsClient.d.ts:14-22, 63-71, 107-128`. Function form gives a `BottomTabNavigationProp<ParamListBase, string, undefined>` (line 25, 74, 118).
- `e: EventArg<"tabPress", true>` is `cancelable` (verified at `node_modules/@react-navigation/bottom-tabs/src/types.tsx:31-36` — `tabPress: { data: undefined; canPreventDefault: true }`). `e.preventDefault()` is type-safe.
- `navigation.isFocused(): boolean` — `node_modules/@react-navigation/core/src/types.tsx:379`.
- `navigation.getState(): TabNavigationState<ParamListBase>` — `node_modules/@react-navigation/core/src/types.tsx:406` returns the navigator's own state.
- `TabNavigationState.routes[i]: NavigationRoute<…>` includes `state?: NavigationState | PartialState<NavigationState>` (`node_modules/@react-navigation/routers/src/types.tsx:5-10`). For a Stack child, `state.type === "stack"`, `state.key` is the Stack navigator's key, `state.index` is its current route index.
- `StackActions.popToTop(): { type: "POP_TO_TOP" }` — `node_modules/@react-navigation/routers/src/StackRouter.tsx:65-72`. Spread with `target: childState.key` is the supported override per `NavigationAction.target` (`node_modules/@react-navigation/routers/src/types.tsx:99-116`) and is exactly the shape the expo-router fork itself uses (`node_modules/expo-router/build/fork/native-stack/createNativeStackNavigator.js:62-65`).
- `import { StackActions } from "@react-navigation/native"` — re-exported via `@react-navigation/native`'s `export * from '@react-navigation/core'` (`node_modules/@react-navigation/native/src/index.tsx:17`) → `@react-navigation/core`'s `export * from '@react-navigation/routers'` (`node_modules/@react-navigation/core/src/index.tsx:47`). Verified type-safe.

### Behaviour matrix

| User state | tabPress fires for | `isFocused()` | `childState?` | `childState.type === "stack" && childState.index > 0` | Action |
|---|---|---|---|---|---|
| On `/exercises/abc` | "Exercises" tab | `true` | `{ type: "stack", index: 1, key: "Stack-X", routes: [index, [id]] }` | `true` | preventDefault + dispatch popToTop target=Stack-X → Stack collapses to `[index]`, URL → `/exercises` |
| On `/exercises` (root) | "Exercises" tab | `true` | `{ type: "stack", index: 0, key: "Stack-X", routes: [index] }` | `false` (index === 0) | no-op; default behaviour passes through (BottomTabBar already no-ops when focused) |
| On `/history/xyz` | "Exercises" tab (different tab) | `false` | n/a (early-return) | n/a | default behaviour → BottomTabBar dispatches `navigate(exercises)`; stack restored per `backBehavior="history"` |
| On `/profile` (leaf, no Stack) | "Profile" tab | `true` | `undefined` (Profile has no child navigator) | `false` (childState is undefined → second clause short-circuits) | no-op |
| On `/progress` (Stack with only `index`) | "Progress" tab | `true` | `{ type: "stack", index: 0, key: "Stack-Y", routes: [index] }` | `false` (index === 0) | no-op |

The two no-op cases (Profile, Progress-at-root) are intentionally distinguished — Profile because there is no child Stack state at all, Progress because the Stack exists but has nothing to pop. Per MIN-3, both are correctly handled by the listener body without any per-tab branching.

### No DB / API / new UI changes

- DB: none.
- API: none.
- UI props: no `<Tabs.Screen>` block changes. The new `screenListeners` is a navigator-level addition, orthogonal to the existing `backBehavior="history"` and `screenOptions={{headerShown:false}}` props (per `node_modules/expo-router/build/layouts/TabsClient.d.ts:6-50` — all three are independent siblings on the `BottomTabNavigatorProps` umbrella).

## Riscos

1. **Action-shape correctness (resolves BLK-1)**. `StackActions.popToTop()` produces `{type: "POP_TO_TOP"}`, which the StackRouter handles by rewriting to `{type: "POP", payload: {count: routes.length - 1}}` (`node_modules/@react-navigation/routers/src/StackRouter.tsx:565-573`); the POP handler at `:543-563` returns `null` (no state change) when `currentIndex === 0`. Adding `target: childState.key` routes the action to the Stack navigator (whose `state.key` matches), per the dispatch routing in `core/src/useNavigationBuilder` and the explicit fork example at `createNativeStackNavigator.js:62-65`. Verified type-safe under strict mode. **Risk: LOW**. Confidence: HIGH.

2. **MAJ-1 — interaction with expo-router's built-in auto-pop**. The fork at `createNativeStackNavigator.js:52-68` already attaches a `tabPress` listener inside every child Stack. On native, our dispatch runs synchronously inside `emit('tabPress')`, setting `state.index = 0`; the fork's RAF callback then sees `state.index > 0 === false` and no-ops — perfectly idempotent. On web, our dispatch pre-empts the entire race detailed in Investigation §2: by the time `linkTo`'s NAVIGATE arrives at the routingQueue, the Stack is already at `[index]` and the NAVIGATE collapses to a no-op via the early-match branch at `StackClient.js:82-87` (action.payload.name === currentRoute.name). **Risk: LOW**. Confidence: HIGH on native (the fork's guard is explicit); MEDIUM-HIGH on web (the synchronous-before-async ordering is reasoned through but not runtime-traced — see Riscos #7 for the test contract that covers it).

3. **`backBehavior="history"` interaction (load-bearing per Discovery `:75-78`)**. Our dispatch is targeted at the **child Stack's key** (`childState.key`), not at the Tabs navigator's key. The Tabs `history` array — the one `backBehavior="history"` reads from — lives in `TabNavigationState.history` (`node_modules/@react-navigation/routers/src/TabRouter.tsx:43-59`). Stack actions targeted at a child stack do not touch the parent Tabs `history`. So the load-bearing `backBehavior="history"` invariant is preserved. (No claim about `history.pushState` vs `replaceState` semantics — that's an expo-router-linking-layer concern outside our scope.) **Risk: LOW**. Confidence: HIGH. Covered by e2e Case 2.

4. **UX regression: scroll position persists after pop**. When popping from `/exercises/abc` → `/exercises`, the FlatList in `exercises/index.tsx` retains its scroll position. Discovery Unknown 8 (`:134-137`) recommends punting `useScrollToTop`; state.md does not mention scroll. **Risk: LOW** (consistency with cross-tab navigation, which also preserves scroll). Follow-up in Out-of-scope.

5. **UX regression: header back-arrow now coexists with tab-tap as two pop affordances**. Both pop, with different semantics (back-arrow = pop one frame; tab-tap = pop all frames). Discovery `:115-117` raised this; Strong/Instagram ship both. **Risk: LOW**.

6. **Platform divergence**. Investigated above: native works via the fork (and our dispatch is idempotent); web works because our dispatch pre-empts the `linkTo` race. **Risk: LOW**. Confidence: MEDIUM-HIGH (web side reasoned through but not runtime-traced — e2e Case 1 covers the user-observable outcome).

7. **Performance**. One closure stored on the Tabs navigator. The `getState()` call is O(1) (returns a cached reference). The guard chain short-circuits on `!isFocused()` for the common cross-tab tap. **Risk: NONE**.

8. **First-party import of `@react-navigation/native`**. Discovery `:52` notes zero current `@react-navigation/native` imports in the codebase. Adding one for `StackActions` introduces the package as a direct first-party import. `@react-navigation/native` is a transitive dep of `expo-router` (verified — exposed as a sibling under `node_modules/`); no new install needed. Convention-wise, `expo-router` itself imports from `@react-navigation/native` (e.g. `createNativeStackNavigator.js:37` does `const native_1 = require("@react-navigation/native")`), so this isn't a layering violation. **Risk: LOW**.

## Alternativas descartadas

1. **Per-`<Tabs.Screen>` `listeners` prop**. Same `tabPress` handler attached to each visible tab. Descartada because: (a) the handler body is uniform across all five visible tabs — a navigator-level listener avoids duplicated near-identical blocks and the drift risk that comes with them; (b) the guards (`isFocused`, child-stack-type, child-stack-index) already work for any number of tabs without per-tab branching; (c) Profile (leaf, no Stack) is handled naturally by the guard chain. DRY on principle.

2. **Platform-gate the listener (`if (Platform.OS === "web") ...`)**. Apply the dispatch only on web, rely on the fork for native. Descartada because: (a) single-code-path simplicity beats two-platform reasoning; (b) the fork's `state.index > 0` guard means our dispatch is provably idempotent on native (zero double-dispatch); (c) future-proofs against framework changes to either side. Investigation §3 details.

3. **`router.replace("/(app)/<section>")` instead of `StackActions.popToTop()`**. Descartada because: (a) `router.replace` hits the routingQueue NAVIGATE path that's part of the problem on web (it would essentially do what `linkTo` already does, racing with the fork); (b) requires hard-coding five path literals that would drift if a tab is renamed; (c) doesn't unwind intermediate frames — replaces the top frame only; (d) `popToTop` matches the user's cited Strong/Instagram mental model more cleanly.

4. **`navigation.dispatch({...StackActions.popToTop()})` WITHOUT `target`**. Descartada because: without `target`, dispatch routes to the **current navigator** (the Tabs navigator), whose TabRouter doesn't handle `POP_TO_TOP` and returns the state unchanged (`node_modules/@react-navigation/routers/src/TabRouter.tsx:352-425` only handles JUMP_TO/NAVIGATE/SET_PARAMS/GO_BACK/PRELOAD/etc.). The action would silently drop. The `target: childState.key` override is what makes the dispatch hit the child Stack's router — exactly as the expo-router fork itself does (`createNativeStackNavigator.js:62-65`).

5. **Read the child Stack's `useNavigation()` from inside each tab and wire a per-screen `useEffect`**. Descartada because: (a) requires touching N tab `_layout.tsx` files (4 changes, with the same code each time); (b) `screenListeners` at the Tabs root is the canonical React Navigation idiom for this exact use case; (c) would re-introduce the per-tab drift risk.

6. **Include header-tap to pop in v1**. `state.md:11` calls it "optional follow-up"; Discovery Unknown 4 recommends punting. Descartada because: (a) cost is 7+ files of stateful `<Stack.Screen options={{ headerTitle: () => <Pressable ... /> }} />` retrofits colliding with existing stateful `headerRight` widgets (`history/[id].tsx:182-214`, `exercises/[id]/progress.tsx:64-86`, `workout/[sessionId].tsx`); (b) tab-tap is the iOS-standard primary surface the user explicitly cited; (c) the back-arrow already handles "pop one"; introducing a "pop all" affordance on the header title is visually ambiguous next to the back-arrow.

7. **Add `useScrollToTop` for tab-root scroll-reset**. Descartada because: (a) state.md does not mention scroll; (b) requires 4 scroller-ref retrofits across `history/index.tsx`, `progress/index.tsx`, `exercises/index.tsx`, `workout/index.tsx`; (c) explicit scope-discipline cue in `state.md:24-26`.

8. **Wire listeners on hidden tabs (`routines`, `measurements`)**. Both have `href: null` → no tab icon → no `tabPress` event possible. Listener dead code. The navigator-level `screenListeners` does fire for all hidden routes including these, but the guards naturally no-op when their child stack is at index 0 (most common state, since the user is always reaching them via direct deep-link).

## Out of scope

- **Header-tap to pop** — punted per Alternative 6. Follow-up if user explicitly wants two redundant tap targets.
- **Scroll-to-top on already-at-root re-tap** — punted per Alternative 7.
- **Breadcrumb component** — explicit out-of-scope per `state.md:25`.
- **Long-press on tab to reset** — explicit out-of-scope per `state.md:26`.
- **Hidden tabs (`routines`, `measurements`)** — no tab icon → unreachable event.
- **Reset of in-screen UI state on pop** — unsaved-form discards (`exercises/new.tsx`, `exercises/[id]/index.tsx`) will run their existing unmount cleanup as the stack unwinds; no new "are you sure?" prompts introduced. Confirmation-on-pop-from-dirty-form is a follow-up if the user requests it.
- **File a bug upstream against `expo-router`** for the web `<Link>` + `tabPress` race documented in Investigation §2. Worth doing eventually; not in scope for this run. (Our fix is independent of an upstream fix and stays idempotent if the upstream is later corrected.)

## Test plan

### Unit tests

**None.** The change is ~12 lines of glue between `expo-router`'s `<Tabs>` and React Navigation's listener API. There is no extractable pure function to unit-test; mocking would test the framework, not our code.

### E2E tests — `tests/e2e/bottom-tab-home-link.spec.ts`

Three deterministic cases in one new spec file. Pattern reused from `tests/e2e/exercise-note.spec.ts:46-89` (admin client + `createConfirmedUser` + `signInAndLand`) and `tests/e2e/_helpers/canonical-exercise.ts:34-60` (canonical exercise pick — Bench Press as the seed).

**Setup (verbatim shape from `exercise-note.spec.ts:46-89`)**:
- `createConfirmedUser(email)` — admin client creates a fresh `email_confirm: true` user with a unique `e2e-bothome-${Date.now()}@test.com` email.
- `pickCanonicalExercise(admin, "Bench Press")` — picks the deterministic canonical exercise to deep-link into.
- `signInAndLand(page, email)` — signs in, waits for `/workout`.
- `afterAll`: `deleteUserSafe(userId)` cleanup.

**Case 1: Re-tap pops nested → root (Exercises tab)**
1. Sign in → on `/workout`.
2. Click the "Exercises" tab label: `page.getByText("Exercises", { exact: true }).first().click()` (per `tests/e2e/auth.spec.ts:301-303`).
3. `page.waitForURL(/\/exercises$/, { timeout: 10_000 })`.
4. Click the Bench Press row to deep-link into edit: `page.getByText("Bench Press", { exact: true }).first().click()`.
5. `page.waitForURL(/\/exercises\/[^/]+$/, { timeout: 10_000 })`.
6. Click "Exercises" tab again: `page.getByText("Exercises", { exact: true }).first().click()`.
7. **Assert** `page.waitForURL(/\/exercises$/, { timeout: 10_000 })`.
8. **Assert** the exercises list root is visible (stable selector — search field placeholder, or the "New exercise" CTA).

**Case 2: Cross-tab tap still navigates normally + browser-back preserves `backBehavior="history"` invariant** (regression guard for the load-bearing comment block at `_layout.tsx:17-26`)
1. Sign in → on `/workout`. Navigate to `/exercises`, click Bench Press to land on `/exercises/<id>`.
2. Click "History" tab label.
3. `page.waitForURL(/\/history$/)`; assert history-root marker visible.
4. `page.goBack()`.
5. **Assert** URL returns to `/exercises/<id>` (the deep route — Discovery `:75-78`).

**Case 3: Re-tap at tab root is harmless (Profile leaf, no Stack)**
1. Sign in → on `/workout`. Click "Profile" tab → on `/profile`.
2. Click "Profile" tab again (already focused, no child Stack).
3. **Assert** URL stays `/profile`, no console error, profile content still visible.
4. Optionally: query `page.evaluate(() => window.console.error)` for any error-class output during the re-tap.

**Why three cases**: Case 1 is the headline behaviour the user requested. Case 2 protects the load-bearing `backBehavior="history"` invariant. Case 3 covers the no-op-on-leaf guard (`childState === undefined` branch). Adding more cases (History detail → History root, Workout active-session → Workout root) tests the same code path with different routes — diminishing returns.

**Flake mitigation per Discovery `:66, 88`**: every tab-label click uses `.first()` and is followed by `waitForURL` rather than relying on inner-page state assertions.

## Confiança & Risco

- **Confidence**: **HIGH on the action shape and idempotency** (verified against `core/src/types.tsx:340-407`, `routers/src/StackRouter.tsx:65-72, 543-573`, expo-router's own use of the same shape at `createNativeStackNavigator.js:62-65`); **MEDIUM-HIGH on the precise web-side root cause** (Investigation §2 reasons through the `linkTo` race and the synchronous-emit-vs-RAF ordering, but does not include a runtime trace — the e2e suite is the empirical confirmation). Per the MAJ-2 calibration mandate: confidence is no longer a blanket HIGH but is decomposed by claim.
- **Risk**: **LOW**. Single-file behavioural addition; no schema/API/auth surface; no destructive change; no data path touched. Worst-case regression is one of the five behaviour-matrix cases misbehaving on one platform, which all three e2e cases cover. The fallback (revert the listener + import) is a ~13-line removal.

## Resposta a issues do Validator

- **[BLK-1]** Fixed in Approach + Contratos: replaced `navigation.popToTop()` (a TabActionHelpers method that doesn't exist on `BottomTabNavigationProp`) with `navigation.dispatch({...StackActions.popToTop(), target: childState.key})` — the exact shape the expo-router fork itself uses (`createNativeStackNavigator.js:62-65`). The dispatch routes to the child Stack via `target`. Type-safe under strict mode. Verified action shape against `routers/src/StackRouter.tsx:65-72, 543-573`.
- **[MAJ-1]** Addressed in Investigation §1-§4 + Riscos #2. Root cause: on web, the tab button is rendered as `<Link>`, whose `onPress` calls **both** the BottomTabBar's `tabPress`-emitter AND `linkTo`. The two compete via a routingQueue + RAF race that the fork's auto-pop listener doesn't anticipate. Our explicit dispatch runs synchronously inside `emit('tabPress')`, pre-empting the race. The dispatch is **idempotent on native** (after our dispatch, the fork's `state.index > 0` guard fails — no double-pop). No platform-gate needed. The unconditional `preventDefault` of v1 was indeed harmful; v2 calls `preventDefault` **only when we actually pop** (focused + child-Stack + index > 0), preserving the framework's default everywhere else.
- **[MAJ-2]** Confidence re-calibrated per Confiança & Risco: HIGH on action shape/idempotency (decomposed from verified file:line evidence), MEDIUM-HIGH on web-side root cause (reasoned, not runtime-traced — e2e is the empirical close-loop). Risk stays LOW with the explicit failure-mode breakdown.
- **[MIN-1]** Line counts dropped. DRY argument now on principle only (single block, no per-tab branching, future-proof).
- **[MIN-2]** Removed the `history.replaceState` assertion. Riscos #3 now only states that our dispatch targets the **child Stack's** key, so the Tabs `history` array (the `backBehavior="history"` substrate) is unmodified. No claim about browser-history primitives.
- **[MIN-3]** Behaviour matrix now explicitly distinguishes "leaf route, no child Stack state" (Profile — `childState === undefined`) from "child Stack at index 0" (Progress — `childState.index === 0`). Both are no-ops but the guard chain handles them via different short-circuit clauses.
- **[MIN-4]** Test plan pins `tests/e2e/exercise-note.spec.ts:46-89` (`createConfirmedUser`, `signInAndLand`) and `tests/e2e/_helpers/canonical-exercise.ts:34-60` as the named admin-seed + canonical-exercise sources.
