# Design v1 — 2026-05-26_0307_bottom-tab-home-link

## Goal (1 sentence)
When a bottom-tab section is already focused, tapping its tab icon pops that section's stack back to its index route (iOS/Strong/Instagram convention).

## Approach
Single-file edit to `app/(app)/_layout.tsx`: add a `screenListeners` prop to the existing `<Tabs>` element that intercepts `tabPress`, checks `navigation.isFocused()` (which is true only when the user is *already on* the tab being pressed), calls `e.preventDefault()` and `navigation.popToTop()` to unwind the tab's stack. No other files change, no schema/API/auth surface touched. The strategy is **navigator-level `screenListeners`** (vs per-`Tabs.Screen` `listeners`) because the behaviour is uniform across all five visible tabs — one block of code with no per-tab branching, and dead branches (Profile leaf, Progress empty stack) are zero-cost (`popToTop` on a stack with no children is a no-op). `popToTop` is preferred over `router.replace("/(app)/<section>")` because (a) it cleanly unwinds intermediate frames (each child screen's `useFocusEffect` cleanup runs in order), (b) `router.replace` would push a new history entry on web whose interaction with the load-bearing `backBehavior="history"` invariant is the exact pitfall documented in the existing comment block at `app/(app)/_layout.tsx:17-26`, and (c) `popToTop` matches the user's cited mental model.

## Mudanças por arquivo
| File | Type | Change |
|---|---|---|
| `app/(app)/_layout.tsx` | edited | Add `screenListeners` prop on the existing `<Tabs>` element. The prop is a function `({ navigation }) => ({ tabPress: (e) => { if (navigation.isFocused()) { e.preventDefault(); navigation.popToTop(); } } })`. No other props change; `backBehavior="history"` and `screenOptions={{ headerShown: false }}` stay verbatim. The five `<Tabs.Screen>` blocks are untouched. |
| `tests/e2e/bottom-tab-home-link.spec.ts` | new | Playwright e2e covering the two load-bearing behaviours (re-tap pops to root; first-tap-from-different-tab still navigates normally without popping). See Test plan. |

Total: 1 edited file, 1 new test file.

## Contratos de I/O

### Edit to `app/(app)/_layout.tsx`
Change is a single new prop on `<Tabs>`. Final element (showing only the changed line and its immediate context — other props/comment block stay verbatim):

```tsx
<Tabs
  backBehavior="history"
  screenOptions={{ headerShown: false }}
  screenListeners={({ navigation }) => ({
    tabPress: (e) => {
      if (navigation.isFocused()) {
        e.preventDefault();
        navigation.popToTop();
      }
    },
  })}
>
  {/* five <Tabs.Screen> blocks unchanged */}
</Tabs>
```

**Type contract** (verified against `node_modules/expo-router/build/layouts/TabsClient.d.ts:14-22, 63-71` per Discovery `:52`):
- `screenListeners` accepts `(props: { navigation, route }) => Partial<BottomTabNavigationEventMap-handlers>`.
- `tabPress` event handler signature: `(e: EventArg<"tabPress", true>) => void`. The event is `cancelable` (the `true` generic) → `e.preventDefault()` is type-safe.
- `navigation.isFocused()` is part of the React Navigation `NavigationProp` surface and returns `boolean` synchronously.
- `navigation.popToTop()` is provided by the **child** Stack navigator (each tab is a `<Stack>` per Discovery `:22-26`). When the focused tab's screen tree contains a Stack, `popToTop` unwinds it. When the focused tab is a leaf (`profile`), the call resolves to no-op without throwing (React Navigation tolerates `popToTop` on a stack with one route).

**Behaviour matrix** (codifies the four cases):
| User state | tabPress fires for | `navigation.isFocused()` | Action |
|---|---|---|---|
| On `/exercises/abc` | "Exercises" tab | `true` | preventDefault + popToTop → `/exercises` |
| On `/exercises` (root) | "Exercises" tab | `true` | preventDefault + popToTop → no-op (stack has 1 route) |
| On `/history/xyz` | "Exercises" tab | `false` | default behaviour → navigate to Exercises (stack restored per `backBehavior="history"`) |
| On `/profile` (leaf) | "Profile" tab | `true` | preventDefault + popToTop → no-op (no stack) |

### No DB / API / UI-prop changes
- DB: none.
- API: none.
- UI props: none added or changed. The five `<Tabs.Screen>` blocks keep their existing `name` / `options.title` / `options.tabBarIcon` / `options.href` props verbatim.

## Riscos

1. **`backBehavior="history"` interaction (load-bearing)** — Discovery `:75-78` flags this as the only real platform-divergence risk. `screenListeners` and `backBehavior` are independent props on `BottomTabNavigatorProps` (verified in Discovery `:75`). The listener calls `popToTop` on the child Stack navigator, not on the Tabs navigator itself — so the Tabs `history` array (the one `backBehavior="history"` mutates) is **not** touched by `popToTop`. The web linking layer therefore does not see a Tabs-level history mutation; it observes a Stack-level pop, which expo-router translates to a URL update from `/exercises/abc` → `/exercises` via `history.replaceState` (not `pushState`). This is the correct browser-history outcome (back button still works). **Risk: LOW**. Mitigation: e2e covers the "different-tab → first-tap navigates normally" case to verify history-aware tab switching still works.

2. **`navigation.isFocused()` semantics across nesting** — when the Tabs `screenListeners` fires `tabPress`, the `navigation` arg is the **Tabs navigator's** navigation prop scoped to the pressed tab (`route` is the tab's route). `isFocused()` returns `true` iff that tab is the currently-focused tab in the Tabs navigator. This is the documented behaviour and Discovery's pattern at `:165-171` uses exactly this idiom. **Risk: LOW**. Confidence: HIGH (the same pattern ships in `react-navigation` docs).

3. **`popToTop` on a stack with no children** — for Profile (no stack, just `profile.tsx` as a leaf) and Progress (Stack with only `index.tsx` per Discovery `:25`), `popToTop` is invoked but no-ops. Verified safe by React Navigation source — `popToTop` is idempotent on a single-route stack. **Risk: LOW**. Dead behaviour is uniform and cheap (no extra render, no warning).

4. **UX regression: scroll position persists after pop** — when popping from `/exercises/abc` → `/exercises`, the FlatList in `exercises/index.tsx` will preserve its scroll position. Strong/iOS convention is also to scroll-to-top, but Discovery Unknown 8 (`:134-137`) explicitly punts this; the prompt does not mention scroll. **Risk: LOW** (consistency with cross-tab navigation, which also preserves scroll). Follow-up filed in Out-of-scope.

5. **UX regression: header back-arrow now coexists with tab-tap as two pop affordances** — both surfaces pop, but with different semantics (back-arrow = pop one frame; tab-tap = pop all frames). Discovery `:115-117` raised this; my judgement (`:118` mirrors it) is that the two affordances are independently useful (Strong/Instagram ship both). **Risk: LOW**.

6. **Platform divergence (iOS/Android/web)** — `tabPress` fires on all three platforms (Discovery `:76`). The listener API is identical. The only web-specific concern is URL update on pop, addressed in Risk #1. **Risk: LOW**.

7. **Performance** — one closure stored on the Tabs navigator. No re-renders triggered. No measurable cost. **Risk: NONE**.

8. **Existing e2e flakiness on tab-label clicks** — Discovery `:66` cites `tests/e2e/max-volume-window.spec.ts:9` comment about tab-label clicks flaking on web. New e2e mitigates via `.first()` + `waitForURL` (per Discovery `:172-177` pattern). **Risk: LOW**.

## Alternativas descartadas

1. **Per-screen `listeners` on each `<Tabs.Screen>`** — verified-available shape from Discovery `:142-156`. Descartada because: (a) the behaviour is identical across all five visible tabs → DRY favours navigator-level; (b) navigator-level adds 7 lines to one file, per-screen adds ~5 lines × 5 tabs = 25 lines across one file with five near-duplicate blocks (drift risk over time); (c) navigator-level handles Progress (currently empty stack, future-proofing per Discovery `:127`) and Profile (leaf, harmless per Discovery `:122`) without per-tab branching. The per-screen approach is equally correct, just verbose. (Discovery's confidence on the recommendation was MEDIUM; this design overrides to HIGH because the uniform-behaviour argument is decisive.)

2. **`router.replace("/(app)/<section>")` instead of `popToTop`** — referenced from existing `workout/verdict/[sessionId].tsx:114, 211` (Discovery `:64, 86`). Descartada because: (a) it pushes a new history entry on web, which directly antagonises the load-bearing `backBehavior="history"` comment block at `_layout.tsx:17-26`; (b) it swaps the top frame but the React Navigation Stack's deeper frames remain "below" semantically (different residue than `popToTop`); (c) it requires hard-coding five path literals (`/(app)/workout`, `/(app)/exercises`, `/(app)/history`, `/(app)/progress`, `/(app)/profile`) which drift if anyone renames a tab segment, whereas `popToTop` is segment-agnostic.

3. **Include header-tap to pop in v1** — `state.md:11` calls it "optional follow-up"; Discovery Unknown 4 (`:114-117`) recommends punting with HIGH confidence. Descartada because: (a) cost is 7+ files of stateful `<Stack.Screen options={{ headerTitle: () => <Pressable .../> }} />` retrofits that collide with the existing stateful `headerRight` in `history/[id].tsx:182-214`, `workout/[sessionId].tsx`, and `exercises/[id]/progress.tsx:64-86` (Discovery `:42`); (b) tab-tap is the iOS-standard primary surface the user explicitly cited (Strong, Instagram); (c) the back-arrow already handles "pop one"; introducing a "pop all" affordance on the header title is visually ambiguous against the adjacent back-arrow. Punt to a follow-up.

4. **Add `useScrollToTop` for tab-root scroll-reset** — Discovery Unknown 8 (`:134-137`). Descartada because: (a) prompt does not mention scroll; (b) requires 4 separate scroller-ref retrofits across `history/index.tsx`, `progress/index.tsx`, `exercises/index.tsx`, `workout/index.tsx`; (c) scope-discipline cited in `state.md:24-26` ("Out of scope" explicit). Punt.

5. **Wire listeners on hidden tabs (`routines`, `measurements`)** — Discovery Unknown 7 (`:129-132`). Descartada because both have `href: null` (no tab icon → no `tabPress` event possible). The listener would be dead code. The navigator-level `screenListeners` does fire for all routes including hidden ones, but since `navigation.isFocused()` would be true only when the user is on `/routines` or `/measurements` AND the user pressed... a tab that doesn't exist — the case is unreachable.

6. **Per-tab opt-in via a custom `ResetOnReTapTab` wrapper component** — Discovery `:84` cites the `<ExerciseBlock onPressName?>` pattern of "presence implies behaviour" as the codebase's idiom for optional behaviour. Descartada because (a) `<Tabs.Screen>` is from `expo-router` and not user-extensible; (b) the wrapper would need to inject `listeners` via a render-prop pattern, which is heavier than the 7-line `screenListeners` block; (c) no per-tab divergence justifies the abstraction.

## Out of scope

- **Header-tap to pop** — punted per Alternative 3. Document as a follow-up if the user explicitly wants two redundant tap targets.
- **Scroll-to-top on already-at-root re-tap** — punted per Alternative 4. File a follow-up "wire `useScrollToTop` to tab-root scrollers" if user reports the gap.
- **Breadcrumb component** — explicit out-of-scope per `state.md:25`. Prompt phrases as "we can also add" (suggestive, not load-bearing).
- **Long-press on tab to reset** — explicit out-of-scope per `state.md:26`.
- **Hidden tabs (routines, measurements)** — no tab icon, no event surface. See Alternative 5.
- **Reset of any in-screen UI state on pop** — e.g. unsaved-form discards in `exercises/new.tsx` or `exercises/[id]/index.tsx` would still fire their existing unmount cleanup as the stack unwinds, but no new "are you sure?" prompts are introduced. If the user wants confirmation on pop-from-dirty-form, that's a follow-up.

## Test plan

### Unit tests
**None.** The change is 7 lines of glue between `expo-router`'s `<Tabs>` and React Navigation's listener API. There is no extractable pure function to unit-test; mocking `<Tabs>`/`screenListeners` would test the framework, not our code. The e2e suite below covers the load-bearing behaviour end-to-end with real navigation.

### E2E tests — `tests/e2e/bottom-tab-home-link.spec.ts`
Three deterministic cases, all in one new spec file, following the pattern from `tests/e2e/auth.spec.ts:301-303` (tab-label click + `waitForURL`).

**Setup**: Reuse the existing `admin-seed` + auth fixture from `tests/e2e/*.spec.ts` (any spec that needs an exercise will reference an admin-seeded one — see how `tests/e2e/max-volume-window.spec.ts` and the recent exercise-note spec do it).

**Case 1: Re-tap pops nested → root (Exercises tab)**
1. Navigate via deep-link to a nested screen: `page.goto("/(app)/exercises/<id>")` (admin-seeded id).
2. Confirm header shows the exercise name; URL is `/exercises/<id>`.
3. Click "Exercises" tab label: `page.getByText("Exercises", { exact: true }).first().click()`.
4. Assert `page.waitForURL(/\/exercises$/, { timeout: 10_000 })`.
5. Assert the exercises list root is visible (a stable selector from `exercises/index.tsx`, e.g. the "New exercise" CTA).

**Case 2: Cross-tab tap still navigates normally (regression guard for `backBehavior="history"`)**
1. Navigate to `/(app)/exercises/<id>`.
2. Click "History" tab label.
3. Assert `page.waitForURL(/\/history$/)` and history-root marker visible.
4. Click browser back: `page.goBack()`.
5. Assert URL returns to `/exercises/<id>` (the load-bearing `backBehavior="history"` invariant — Discovery `:75-78`).

**Case 3: Re-tap at tab root is harmless (Profile leaf)**
1. Navigate to `/(app)/profile`.
2. Click "Profile" tab label (already focused).
3. Assert URL stays `/profile`, no console error, profile content still visible.

**Why three cases**: Case 1 is the headline behaviour. Case 2 protects the `backBehavior="history"` invariant that Discovery `:17-26` flagged as load-bearing. Case 3 covers the no-op-on-leaf path that Alternative 1 and Risk #3 both depend on. Adding more cases (History detail → History root, Workout active-session → Workout root) would test the same code path with different routes — diminishing returns.

**Flake mitigation per Discovery `:66, 88`**: every tab-label click uses `.first()` and is followed by `waitForURL` rather than relying on inner-page state assertions, mirroring the existing pattern.

## Confiança & Risco

- **Confidence**: HIGH. The pattern is verified-available (Discovery `:52, 142-156, 158-171`), the navigation API is canonical React Navigation idiom, the only platform-divergence concern (`backBehavior="history"` interaction) is independent of `screenListeners` (Discovery `:75`) and explicitly covered by Test Case 2.
- **Risk**: LOW. Single-file behavioural addition with no schema/API/auth surface, no destructive change, no data path touched. Worst-case regression is one of the four behaviour-matrix cases misbehaving on one platform, which Test Cases 1–3 catch. The fallback (revert the `screenListeners` prop) is a 7-line removal.

## Response to Validator issues
N/A — this is design-v1.
