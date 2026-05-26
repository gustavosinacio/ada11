# Validation v2 — 2026-05-26_0307_bottom-tab-home-link

Reviewing: `design-v2.md` (D↔V round 2 of max 3)

## Verification of v1 issue resolutions

| v1 issue | v2 stance | Verified? | Evidence |
|---|---|---|---|
| **BLK-1** — `navigation.popToTop()` doesn't exist on `BottomTabNavigationProp` | Replaced with `navigation.dispatch({ ...StackActions.popToTop(), target: childState.key })` | **yes** | `StackActions.popToTop()` returns `{ type: 'POP_TO_TOP' }` (`node_modules/@react-navigation/routers/src/StackRouter.tsx:148-150`). `target` is a valid `NavigationAction` override (`StackRouter.tsx:36-39` — the `POP_TO_TOP` action variant explicitly types `target?: string`). The expo-router fork uses the exact same dispatch shape at `createNativeStackNavigator.js:62-65`. `StackActions` is re-exported via `@react-navigation/native` → `@react-navigation/core` (`core/src/index.tsx:47` `export * from '@react-navigation/routers'`) → `routers/src/index.tsx:20` `export { StackActions, StackRouter } from './StackRouter'`. The dispatch routes to the child Stack because `target: childState.key` matches the Stack's navigator key. Type-safe under strict mode. |
| **MAJ-1** — Expo Router's fork already auto-pops; v1's unconditional preventDefault would disable it | Investigation §1-§4: web-only `<Link>` + `linkTo` race vs. fork's RAF; v2's listener is on for all platforms because it's idempotent on native (the fork no-ops via `!e.defaultPrevented` since we now preventDefault only when actually popping) | **yes — investigation tracks the source** | Fork's listener at `node_modules/expo-router/build/fork/native-stack/createNativeStackNavigator.js:52-68` matches Designer's quote verbatim (line numbers also match). `BaseExpoRouterLink.js:50-93` confirms the `onPress` calls **both** `rest.onPress?.(e)` (the BottomTabBar's `tabPress`-emitter) **and** `props.onPress(e)` (`useLinkToPathProps.onPress` at `useLinkToPathProps.js:30-38` which calls `linkTo`). `TabsClient.js:16-44` confirms web returns `props.children` directly while native wraps in `<Pressable>`. `routingQueue.add()` at `routing.js:79-84` enqueues actions; `routingQueue.run()` is invoked via a `useEffect` in `imperative-api.js:25-28` — i.e. NOT synchronous with `linkTo`. The race detailed in §2 is real. The mechanism that fixes it on native is *primarily* `e.preventDefault()` on the nav event (the fork's RAF check `!e.defaultPrevented` fails) rather than the closure-captured `state.index > 0` (which is the render-time state, not post-dispatch state — see Minor below). Designer's net conclusion holds; the framing as "state.index = 0 synchronously" is slightly overstated but harmless because preventDefault is the actual neutraliser. |
| **MAJ-2** — Confidence/Risk uncalibrated | Decomposed to MEDIUM-HIGH (web root cause) / HIGH (action shape & native idempotency) / LOW risk | **yes — calibration is reasonable** | The `Confiança & Risco` block (`design-v2.md:304-307`) names the specific evidence-backed claim (HIGH) vs. the reasoned-but-not-runtime-traced claim (MEDIUM-HIGH). Matches the global rule on per-claim calibration. |
| **MIN-1** — line counts were buggy | Dropped magnitudes; DRY-on-principle | **yes** | `Alternativas descartadas #1` (`design-v2.md:235`) argues uniformity + future-proofing for new tabs without citing numbers. |
| **MIN-2** — `history.replaceState` was unverified speculation | Removed; Riscos #3 limits the claim to "dispatch is targeted at child Stack so the Tabs `history` array is unmodified" | **yes** | The Tabs `history` array is `TabNavigationState.history` (`routers/src/TabRouter.tsx:43-54`). Our dispatch with `target: childState.key` routes to the child Stack, not the Tabs — so the Tabs `history` is untouched. No claim about `pushState` vs `replaceState`. |
| **MIN-3** — leaf vs single-route-stack conflation | Behaviour matrix now distinguishes Profile (`childState === undefined`) from Progress (`childState.index === 0`) | **yes** | Matrix at `design-v2.md:198-207` lists both cases with the specific short-circuit clause each one hits. |
| **MIN-4** — admin-seed fixture unnamed | Pinned to `tests/e2e/exercise-note.spec.ts:46-89` and `tests/e2e/_helpers/canonical-exercise.ts:34-60` | **yes — referenced precisely** | `Test plan > E2E tests` block (`design-v2.md:267-302`) cites both files for the fixture shape. |

## New verification (v2-specific claims)

| Claim | Verified? | Evidence |
|---|---|---|
| `StackActions.popToTop()` produces `{type: "POP_TO_TOP"}`; the StackRouter rewrites to POP and the POP handler at `currentIndex === 0` returns `null` (no state change) | **yes** | `StackRouter.tsx:148-150` (`popToTop` factory) + `:565-573` (POP_TO_TOP → POP) + `:543-563` (POP returns `null` when `currentIndex === 0`). |
| `navigation.dispatch` with `target` routes the action to the matching navigator | **yes** | The fork's own dispatch at `createNativeStackNavigator.js:62-65` uses exactly the same shape (`{...StackActions.popToTop(), target: state.key}`). React Navigation's action routing via `target` is documented behaviour and is the only way to send a stack action from outside the stack. |
| `TabNavigationState.history` is the substrate `backBehavior="history"` reads from; targeted Stack actions don't mutate it | **yes** | `routers/src/TabRouter.tsx:43-54` — `TabNavigationState.history` is a tab-router-specific field. Stack reducer paths (`StackRouter.tsx:543-573`) only mutate their own state. |
| Function-form `screenListeners` provides `BottomTabNavigationProp<ParamListBase, string, undefined>` with `dispatch`, `getState`, `isFocused` | **yes** | `TabsClient.d.ts:23-35` (and the identical declarations at `:63-83`, `:107-127`). |
| `NavigationRoute.state?: NavigationState \| PartialState<NavigationState>` — guard chain handles partial state defensively | **yes** | `routers/src/types.tsx:5-10`. Designer's `typeof childState.index === "number"` guard correctly handles `PartialState` where `index` may be absent. |
| The `<Link>` wraps the tab-bar button on web, the wiring fires both `tabPress` and `linkTo` on click | **yes** | `node_modules/expo-router/build/layouts/TabsClient.js:16-44` (the `tabBarButton: (props) => <Link {...props} href={href} ...>` pattern); `BaseExpoRouterLink.js:77-82` (the `onPress` calls both `rest.onPress?.(e)` and `props.onPress(e)`). |
| `useLinkToPathProps.onPress` could be aborted by DOM-event `preventDefault` (but the nav-event `preventDefault` from our listener is on a different event, so it does NOT abort `linkTo`) | **yes — and this clarifies the mechanism** | `useLinkToPathProps.js:11-38` — `eventShouldPreventDefault(e)` and `shouldHandleMouseEvent(e)` both check the DOM `event.defaultPrevented`. The BottomTabBar's `onPress` (`@react-navigation/bottom-tabs/src/views/BottomTabBar.tsx:398-411`) emits a synthetic navigation event via `navigation.emit({type:'tabPress', ..., canPreventDefault:true})` — our screen listener's `e.preventDefault()` acts on **that** synthetic event, not the DOM event. So `linkTo` still runs after our pop dispatch. This is consistent with Designer's §2 (`linkTo` IS called, but lands on a Stack already collapsed by our pop). |

## Issues found

### Blockers

None.

### Majors

None.

### Minors

- **[MIN-NEW-1]** Investigation §2's claim "Our dispatch sets `state.index = 0` synchronously" (`design-v2.md:84`) is **slightly overstated**. React Navigation state updates flow through `setState` in `useNavigationBuilder.tsx:743-757` (via `useScheduleUpdate`) and are subject to React 18 batching — they are not guaranteed to be observable in the same synchronous call stack to subsequent reads of `navigationRef.getRootState()` (e.g. the `getRootState()` call inside `linkTo` at `routing.js:197`). The **mechanism that actually neutralises the fork on native** is the conditional `e.preventDefault()` on the nav event (the fork's `!e.defaultPrevented` guard fails — see `createNativeStackNavigator.js:59`), not the closure-captured `state.index > 0` (which is the render-time value, re-bound by the useEffect deps `state.index, state.key` at `:68`). The net behavioural conclusion holds because: (i) our pop dispatch and the linkTo NAVIGATE both flow through the same `routingQueue`/reducer chain, (ii) when both land, the StackRouter's POP_TO_TOP + subsequent NAVIGATE-with-`action.payload.name === currentRoute.name` collapse to a clean `routes=[index]`, and (iii) the e2e suite covers the user-observable outcome. **Suggested fix**: in `Investigation §2`'s last paragraph, soften the synchronous-state claim to "our pop dispatch is enqueued before linkTo's NAVIGATE; both flow through the reducer in order and the NAVIGATE collapses to a no-op". No code change required.

- **[MIN-NEW-2]** Designer claims (`design-v2.md:231`) that adding the import is "first first-party usage of this import" yet later notes `@react-navigation/native` is transitively used by expo-router itself. The Discovery (`discovery.md:52`) already established no first-party uses of `useNavigation()` from `@react-navigation/native`. Importing `StackActions` from `@react-navigation/native` is fine — but a future grep for "first-party uses of @react-navigation/native" would now flip from 0 to 1, slightly muddying that convention. **Suggested fix**: optionally import from `@react-navigation/routers` instead (`import { StackActions } from "@react-navigation/routers";` — same source per `routers/src/index.tsx:20`), which keeps `@react-navigation/native` greenfield as a direct dep. Or import from `expo-router` directly if it re-exports — Designer should check. (Not load-bearing; either choice works.)

- **[MIN-NEW-3]** The Behaviour matrix row "On `/exercises/abc` | childState = `{type: 'stack', index: 1, key: 'Stack-X', routes: [index, [id]]}`" (`design-v2.md:201`) implies the child state's `type` is unconditionally `"stack"`. But `NavigationRoute.state?: NavigationState | PartialState<NavigationState>` and `PartialState` may not even include `type` (rehydration scenario). The guard chain `childState && childState.type === "stack" && typeof childState.index === "number" && childState.index > 0` defends against this, but the matrix row reads as if `type === "stack"` is guaranteed. **Suggested fix**: optional — annotate the matrix to say "on a hot-rehydrated state, `childState.type` may be undefined and the guard returns false → no-op". The code is correct; only the prose is loose.

## Issues raised in previous validation

- **BLK-1**: resolved (verified above).
- **MAJ-1**: resolved with thorough investigation (verified above; one slight overstatement flagged as MIN-NEW-1).
- **MAJ-2**: resolved (calibration reasonable).
- **MIN-1..4**: all resolved.

## Decision

**go**

Reasoning:
- Zero blockers.
- Zero majors.
- Three minors (MIN-NEW-1..3), all prose-only: MIN-NEW-1 is a slight overstatement of the synchronous-state claim that doesn't change the net mechanism (preventDefault is the real neutraliser; the e2e covers the user-observable behaviour). MIN-NEW-2 is an optional import-source nit. MIN-NEW-3 is a Behaviour-matrix prose-vs-code-defensiveness drift.
- Per playbook decision rule: 0 blockers + 0 majors + only minors → `go`.
- v2 substantively responded to every v1 issue with code-verified resolutions. The Investigation §1-§4 is the headline improvement — it correctly identifies the web race between `<Link>`'s `linkTo` and the fork's RAF auto-pop, names the load-bearing files, and arrives at a fix shape (explicit dispatch + conditional preventDefault) that is provably idempotent on native (the fork's `!e.defaultPrevented` guard fails after our preventDefault).
- The remaining MEDIUM-HIGH confidence on the web root cause is appropriately scoped: e2e Case 1 is the empirical close-loop, and the worst-case regression is a single matrix row misbehaving on web — which the test suite catches.

D↔V budget after this round: 1/3 remaining (round 3 unused — leave for emergencies if Implementer surfaces a contradiction).

Recommendation to Conductor: **invoke Implementer**. Pass the three minors as advisory notes — Implementer can choose to address MIN-NEW-1 (prose softening) and MIN-NEW-2 (import source) in passing; MIN-NEW-3 is opt-in polish.
