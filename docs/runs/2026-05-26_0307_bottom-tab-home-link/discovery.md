# Discovery — 2026-05-26_0307_bottom-tab-home-link

## Feature prompt
> The top of each page needs to work like a home link. When i'm on history screen, clicking on the top of the page or the bottomsheet icon button needs to redirect me back to the home. Currently, let's say im on exercise iuewbr inside of the exercise page. The url will look like exercises/iuewbr. Pressing on the exercises on the bottom page should navigate home. We can also add a breadcrumb component to the pages.

Restated (from `state.md:7-11`): when the user is on a nested screen inside a bottom tab (e.g. `/exercises/{id}`, `/history/{id}`, `/exercises/{id}/progress`), tapping that section's tab icon should pop the navigation stack back to the section's index. Optional secondary: header-tap also pops. Optional follow-up: breadcrumb component (explicitly out of scope for v1 — `state.md:25`).

## Scope summary
Pure client navigation change. Touch the Tabs root layout at `app/(app)/_layout.tsx` (and optionally each tab's `_layout.tsx` if a per-section override is preferred) to intercept the `tabPress` event when the section's tab is already focused; on intercept, prevent the default no-op behaviour and either `navigation.popToTop()` (preserves any stack state under the root) or `router.replace("/(app)/<section>")` (replaces the whole stack). No DB, no API, no new screens. Affects all five visible bottom tabs (Workout, Exercises, History, Progress, Profile).

## Affected files (verified)

### Tabs root
- `app/(app)/_layout.tsx:1-74` — single `<Tabs>` declaration. Verified facts:
  - `import { Tabs } from "expo-router";` (line 1).
  - Five **visible** tabs: `workout` (28-34), `exercises` (39-45), `history` (46-52), `progress` (53-59), `profile` (64-70). Two **hidden** tabs (`href: null`): `routines` (35-38) and `measurements` (60-63) — Designer must decide if these still need parity (currently they have no tab icon to press; entry-points are `router.push` from Workout/Profile).
  - `backBehavior="history"` is explicitly set (line 27) with a load-bearing comment block (17-26) explaining the web-history interaction with the linking layer — adding listeners must NOT clobber this prop. The comment references run `docs/runs/2026-05-21_1554_tap-exercise-name-to-progress`.
  - `screenOptions={{ headerShown: false }}` (line 27) — the Tabs navigator itself shows no header; per-stack screens own their own header via `<Stack.Screen options={{ headerShown: true }} />`. This matters for "header press" candidates: there is no Tabs-level header to tap; every visible header belongs to a `<Stack.Screen>` inside a tab's stack.
  - **No existing `listeners` / `screenListeners` / `tabPress` handlers anywhere in the file** (verified by `grep -rn "tabPress\|popToTop\|listeners" app src` returning zero hits). Greenfield.

### Per-tab stacks (all five visible tabs)
- `app/(app)/workout/_layout.tsx:1-5` — `<Stack screenOptions={{ headerShown: false }} />`. Root route: `app/(app)/workout/index.tsx`. Nested screens: `[sessionId].tsx`, `verdict/[sessionId].tsx`.
- `app/(app)/exercises/_layout.tsx:1-5` — `<Stack screenOptions={{ headerShown: false }} />`. Root route: `exercises/index.tsx`. Nested: `[id]/index.tsx` (edit), `[id]/progress.tsx`, `new.tsx`.
- `app/(app)/history/_layout.tsx:1-5` — `<Stack screenOptions={{ headerShown: false }} />`. Root route: `history/index.tsx`. Nested: `[id].tsx`, `week/[isoWeek].tsx`.
- `app/(app)/progress/_layout.tsx:1-5` — `<Stack screenOptions={{ headerShown: false }} />`. Root route: `progress/index.tsx`. **No nested screens currently** (verified by file listing). Tap-to-pop is a no-op for this tab in the current build, but the listener is still cheap and future-proofs the tab.
- Profile: **no stack**. `app/(app)/profile.tsx:1-50` is a leaf file (no `profile/` directory), so the route is `/(app)/profile` directly. There is no `popToTop` candidate inside Profile — it cannot ever be on a "nested screen". Listener-on-already-focused-Profile-tab would be a permanent no-op; safe to omit, but Designer may choose to apply uniformly for code symmetry.

### Hidden tabs (entry-point via `router.push` from visible tabs)
- `app/(app)/routines/_layout.tsx:1-5` and `app/(app)/measurements/_layout.tsx:1-5` — both `<Stack screenOptions={{ headerShown: false }} />` with `href: null` in the Tabs config (`_layout.tsx:35-38, 60-63`). No tab icon → no tabPress event possible → out of scope for this feature.

### Nested-screen callsites (where the bug manifests today)
All nested routes currently use `<Stack.Screen options={{ title: ..., headerShown: true }} />` and most expose only a back arrow (no headerLeft override). Per-screen header construction (verified):
- `app/(app)/exercises/[id]/index.tsx:98, 107, 126, 175` — edit-exercise screen sets `title: "Exercise" | "Edit exercise"`.
- `app/(app)/exercises/[id]/progress.tsx:64-86` — progress screen builds a `<Stack.Screen>` with `title: exercise.data?.name ?? "Progress"` and a `headerRight` (pencil to navigate to edit). No `headerTitle` callable component.
- `app/(app)/history/[id].tsx:167-215` — session detail. Computes `headerTitle` as a **string** (167-171), then sets `title: headerTitle` (180) plus `headerRight` (182-214) toggling Done/Pencil. Importantly, `headerTitle` is the computed string and NOT a tappable component.
- `app/(app)/history/week/[isoWeek].tsx:112` — `<Stack.Screen options={{ title, headerShown: true }} />`.
- `app/(app)/workout/[sessionId].tsx:393, 402, 414` — three branches all use `title: "Workout"`.
- `app/(app)/workout/verdict/[sessionId].tsx:103, 125, 152` — verdict screen header (3 branches for loading/error/happy).
- `app/(app)/routines/new.tsx:51`, `app/(app)/routines/[id]/index.tsx:131, 140, 168` — routines stack (hidden tab).
- `app/(app)/measurements/[id]/index.tsx:141`, `app/(app)/measurements/[id]/edit.tsx:152, 163, 179`, `app/(app)/measurements/new.tsx:113` — measurements stack (hidden tab).

**Fact, verified by grep**: no `<Stack.Screen>` in the repo uses a `headerTitle` callable component (i.e. `headerTitle: () => <Pressable .../>`). Every header title is a plain string. So the "tap the header title to pop to root" affordance does not exist anywhere today and would have to be invented per-screen if Designer takes the optional follow-up. The lift-to-tap target is non-trivial because three screens (`history/[id].tsx`, `exercises/[id]/progress.tsx`, `workout/[sessionId].tsx`) already use a stateful `headerRight`; introducing a custom `headerTitle` component without breaking the layout requires care.

### `routines/index.tsx` is a Redirect
- `app/(app)/routines/index.tsx:1` — `import { Redirect }`. The "routines" route is a redirect-only stub; not a real index. Confirms why `routines` is `href: null` in the tab bar (35-38).

### `app/index.tsx` is also a Redirect
- `app/index.tsx:1` — top-level `Redirect`. Not relevant to the tab-tap behaviour.

## Relevant conventions (verified by reading code)

1. **Navigation API: 100% `expo-router`, mostly via `useRouter()`**. Every navigating file imports `useRouter` from `expo-router` (37 hits across `app/(app)/**` and `src/components/**`). There are **zero** uses of `useNavigation()` from `@react-navigation/native` in the codebase (verified). Implication: adopting the React-Navigation native `listeners` prop on `<Tabs.Screen>` is the path of least convention violation, but it does introduce a *first* `useNavigation`-flavoured imperative call (the listener receives `e`, `navigation`, `route` from RN, not from expo-router). The `<Tabs.Screen>` `listeners` prop is supported by Expo Router — see `node_modules/expo-router/build/layouts/TabsClient.d.ts:14-22, 63-71` declaring the full `BottomTabNavigationEventMap` (`tabPress`, `tabLongPress`, `focus`, `blur`, ...). Verified.

2. **Route literals always include the `(app)` group**. Every `router.push`/`router.replace` writes the segment explicitly: `router.push("/(app)/exercises/new")` (exercises/index.tsx:21), `router.replace("/(app)/workout")` (workout/[sessionId].tsx:367, workout/verdict/[sessionId].tsx:114, 211, measurements/[id]/edit.tsx:96, 115). Implication: if Designer picks the `router.replace(rootPath)` strategy, the literal must be `/(app)/<section>`, not `/<section>`. The 5 root paths are:
   - `/(app)/workout`
   - `/(app)/exercises`
   - `/(app)/history`
   - `/(app)/progress`
   - `/(app)/profile`

3. **`router.push` for forward nav, `router.back` for "discard/undo", `router.replace` for "this screen is done"**. Verified patterns:
   - `router.push(...)` — entering a nested screen (e.g. `exercises/index.tsx:64` push to progress; `history/index.tsx:61` push to detail; `workout/index.tsx:49, 62` push to active session).
   - `router.back()` — Cancel buttons and post-mutation returns: `exercises/new.tsx:46, 136`; `exercises/[id]/index.tsx:73, 162, 251`; `routines/new.tsx:38, 101`; `routines/[id]/index.tsx:107`; `measurements/new.tsx:72, 349`; `measurements/[id]/edit.tsx:414`; `history/[id].tsx:156`.
   - `router.replace(...)` — flow handoffs where the source screen should not be on the back stack: `history/[id].tsx:81` (history → active workout when session is incomplete); `workout/[sessionId].tsx:312` (live → verdict); `workout/[sessionId].tsx:367` and verdict/`[sessionId].tsx:114, 211` (verdict → workout root after finish); `measurements/new.tsx:104` and `measurements/[id]/edit.tsx:96, 115, 146`. The auth-gate at `app/_layout.tsx:23, 25` also uses `replace`.

4. **Tab labels are the literal `title` strings**. Title order in `app/(app)/_layout.tsx` is `Workout, Exercises, History, Progress, Profile` (lines 31, 42, 49, 56, 67). The e2e suite already uses these labels as tappable targets — `tests/e2e/auth.spec.ts:303` does `page.getByText("Profile", { exact: true }).first().click()` — so a Playwright e2e for the new behaviour can target the tab by visible label. Comments in `tests/e2e/max-volume-window.spec.ts:9` warn that **tab navigation via clicking labels can flake on web**, recommending `page.goto("/<route>")` instead. Implication for Tester: validating "tab-tap pops to root" specifically requires a real click on the tab label, not `page.goto` — pop-to-top can only be triggered by the actual `tabPress` event. Plan for some flake tolerance on web tab-clicks.

5. **`accessibilityLabel` / `accessibilityRole` are universal on pressables**. Every `<Pressable>` in the codebase includes both. The `<Tabs>` bottom-tab buttons get their accessibility labels from React Navigation's `tabBarAccessibilityLabel` defaulting to the `title`. No customization needed.

6. **Headers across the app are constructed via `<Stack.Screen options={...} />` inside the screen, not via stack-level `screenOptions`**. Both `_layout.tsx` files set `headerShown: false` at the stack level, then each screen overrides with `headerShown: true`. This means the `header` is **part of the screen's render tree** — adding a tappable `headerTitle` would happen per-screen (multi-file edit if Designer adopts the optional secondary), not in any shared layout.

## Constraints

- **Data**: none. Pure client navigation.
- **UI / nav hierarchy**: must not break `backBehavior="history"` (`_layout.tsx:27` + comment 17-26). Adding `screenListeners` or per-`Tabs.Screen` `listeners` is orthogonal to `backBehavior` (verified in the expo-router type defs — both `listeners` and `backBehavior` are independent props on the `BottomTabNavigatorProps` umbrella). Confidence: HIGH.
- **Platform**: feature must work on **iOS, Android, and web** (the project is universal — `docs/architecture.md:81`, `docs/decisions.md:30-34`). React Navigation's `tabPress` event fires on all three platforms; `preventDefault()` + `popToTop()` is the canonical cross-platform recipe.
  - Web wrinkle: with `backBehavior="history"` the tabs navigator stores per-tab history on web; when the user is on a deep route and re-presses the tab, the *default* (non-prevented) behaviour is "no-op when already focused" — i.e. there is no current navigation event to suppress. The `preventDefault` matters when the user is on a *different* tab and presses the tab they're not focused on; for the "already-focused" case we just need to detect via the listener (or via `route.state` inspection) and call `popToTop`. Designer to confirm the listener signature handles both cases.
  - On web, the URL must also reflect the pop. `navigation.popToTop()` does invoke the linking layer in `expo-router 6`, so the URL should update from `/exercises/iuewbr` → `/exercises`. If it doesn't (regression risk), fall back to `router.replace("/(app)/<section>")` — but this is a **medium-risk pattern** because it would push a new history entry whose `historyDelta` interaction with `backBehavior="history"` is the exact thing the comment block at `_layout.tsx:17-26` warns about. **Strong recommendation for Designer**: use `popToTop` not `router.replace`.
- **Auth**: `(app)` group already gated by `app/_layout.tsx:14-35`. No new auth surface.
- **Performance**: a listener per tab is a single function reference. No measurable cost.

## Existing precedents

- **Optional-callback prop with presence-based gating** — `<ExerciseBlock>` (`src/components/exercise-block.tsx:16-17, 27, 96`) uses `onMoveUp?`, `onMoveDown?`, `onRemove?`, and the recent `onPressName?` (from run 2026-05-21_1554). If Designer picks a per-tab approach (e.g. a custom `ResetOnReTapTab` wrapper), this is the codebase's precedent for optional behaviour. Not directly applicable to `<Tabs.Screen>` props, but the *style* of "presence implies behaviour" applies.

- **`router.replace(rootPath)` already used elsewhere as "go to tab root"** — `workout/verdict/[sessionId].tsx:114, 211` literally does `router.replace("/(app)/workout")` after the user finishes a workout. Same end-state as `popToTop` from inside that tab's stack. Difference: `replace` swaps the top frame; `popToTop` unwinds the stack. Either reaches the same screen but with different stack residue. The verdict-flow precedent leans toward `router.replace` as the codebase's habit, BUT the verdict flow is a *post-mutation handoff* (the source screen is meant to be discarded), not an "I want to start over" reset. The tab-re-press semantic is closer to `popToTop`.

- **Tab-click in tests** — `tests/e2e/auth.spec.ts:301-303` is the only existing place that interacts with a tab via click rather than `page.goto`. Recommended pattern for Tester. The comment in `tests/e2e/max-volume-window.spec.ts:9` warns that label-clicks can flake — Tester should plan for `.first()` and a `waitForURL` follow-up.

- **No prior "tap to reset stack" pattern in the codebase** — verified by `grep -rn "popToTop\|tabPress\|listeners"` returning zero matches across `app/` and `src/`. This feature is greenfield.

## Unknowns (require Designer judgment or human decision)

1. **`popToTop()` vs `router.replace("/(app)/<section>")`**
   (a) Which API to use when the tab is already focused on a nested screen.
   (b) `popToTop()` unwinds the existing stack frame-by-frame (any `useFocusEffect` cleanup runs as each screen unmounts in order); `router.replace` swaps the active screen with the index. Stack residue differs — after `popToTop` the back stack is empty; after `replace` of the top frame, intermediate screens are gone too (since `replace` operates on the topmost route within the stack). On web, `popToTop` interacts more predictably with `backBehavior="history"` (see Constraints above).
   (c) **My recommendation: `navigation.popToTop()` from inside the `tabPress` listener** (`e.preventDefault(); navigation.popToTop()` only when the tab is already focused — detect via `navigation.isFocused()` from the listener's `navigation` arg). Rationale: matches iOS-standard mental model the prompt cites ("Strong, Instagram"); cleanly unwinds intermediate screens; doesn't fight `backBehavior="history"`. Confidence: HIGH.

2. **Tab-bar listener: per-screen `listeners` vs navigator-level `screenListeners`**
   (a) Two implementation shapes are available (verified in `TabsClient.d.ts:14-22, 63-71`):
   - **Per-screen**: add `listeners={({ navigation }) => ({ tabPress: e => {...} })}` to each `<Tabs.Screen>`.
   - **Navigator-level**: add `screenListeners={({ navigation, route }) => ({ tabPress: e => {...} })}` once on `<Tabs>`.
   (b) Per-screen is explicit (each tab opts in, easy to scan), navigator-level is one place (DRY, but requires `route.name` switching). Navigator-level can derive "is this tab focused?" from the `navigation` arg uniformly.
   (c) **My recommendation: navigator-level `screenListeners` on `<Tabs>`** — one block of code, uniform behaviour, no per-tab divergence. Fewer lines means less drift risk. Confidence: MEDIUM (per-screen is equally defensible; this is a style call).

3. **The "bottomsheet icon button" mystery**
   (a) The prompt says "clicking on the top of the page or the bottomsheet icon button needs to redirect me back to the home". "Bottomsheet icon button" is ambiguous.
   (b) Hunted for candidates:
   - **No "bottom sheet" UI is mounted at the screen level in any tab**. The bottom-sheet-style components (`src/components/set-row-menu.tsx:111`, `src/components/week-selector.tsx:140`, `src/components/exercise-picker.tsx:50`, `src/components/plate-calculator.tsx:70`, `src/components/choose-action-modal.tsx:56`) are all transient modals invoked from specific actions inside a screen. None contains a "home" icon button. None is the "always visible at the bottom" UI element the prompt seems to describe.
   - **The only "icon at the bottom of the screen" in this app is the bottom tab bar itself**. The prompt's preceding sentence ("Pressing on the exercises on the bottom page should navigate home") makes this explicit: the user is referring to the **bottom tab icon**. "Bottomsheet" is almost certainly a malapropism for "bottom tab bar" / "bottom navigation".
   - **The "top of the page"** likely refers to the header. Since `headerShown: true` at every nested screen, "top of the page" is the title bar.
   (c) **My interpretation (confidence: HIGH)**: "the top of the page OR the bottomsheet icon button" = "the header OR the bottom tab icon". The bottom-tab is the primary affordance the feature targets (matching the iOS-app references the user cites — Strong, Instagram). The header-tap is the optional follow-up the state.md classifies as secondary. No actual "bottomsheet icon button" exists in the codebase to wire up. Designer should call this out and proceed with tab-tap as primary, header-tap as the optional follow-up. If user disagrees, escalate.

4. **Should the optional header-tap be in v1 or punted?**
   (a) `state.md:11` calls header-tap "Optional follow-up"; the original prompt lists it as an *alternative* ("the top of the page OR..."). Cost-side: 7-8 nested screens × custom `headerTitle` component, each with care around the existing `headerRight` stateful pencil/Done widget at `history/[id].tsx:182-214` and `workout/[sessionId].tsx`. Benefit-side: redundancy — the tab icon already does the job and is the iOS-standard surface.
   (b) The prompt's literal "the top of the page" reading is ambiguous because the header itself already has a back arrow that pops one frame; making the title press do "pop ALL frames" is a different verb but visually conflicts with the back arrow's affordance. Designer should weigh whether two redundant tap targets is clarifying or confusing.
   (c) **My recommendation: punt header-tap to a follow-up**. Ship tab-tap-to-pop only in v1. Reasons: (i) tab-tap is the established iOS pattern the user explicitly invoked ("Strong, Instagram, most iOS apps"); (ii) header-tap adds 7+ file edits with stateful-header collision risk; (iii) the back arrow already covers "go back one"; (iv) `state.md:25` explicitly says "Out of scope: ... breadcrumb" implying scope-discipline is welcome; the tab fix alone is the load-bearing UX win. If shipped feels incomplete, file a follow-up. Confidence: HIGH.

5. **Profile tab — listener parity or skip?**
   (a) Profile has no stack (`app/(app)/profile.tsx` is a single leaf, not a directory with `_layout.tsx`). There is no "deep route inside Profile" to pop from.
   (b) Adding a `tabPress` listener for Profile is harmless (the `popToTop` becomes a no-op) but is dead code.
   (c) **My recommendation: include it for uniformity** — if Designer picks navigator-level `screenListeners` (Unknown 2), Profile gets the same treatment for free with zero per-tab branching. If Designer picks per-screen, it's fine to omit Profile. Tester should not write a Profile-specific assertion. Confidence: MEDIUM.

6. **Progress tab — same as Profile in current build**
   (a) `progress/` has no nested screens (only `index.tsx` and `_layout.tsx`). Tap-to-pop is a no-op today.
   (b) Future-proofing argument: Progress is likely to gain nested screens (per-PR drill-down, settings) before Profile is.
   (c) **My recommendation: include Progress in the listener set** (same justification as Profile, but with stronger future-proofing). Confidence: HIGH.

7. **Hidden tabs (`routines`, `measurements`)**
   (a) Both have `href: null` (`_layout.tsx:35-38, 60-63`). No tab icon → no `tabPress` event possible. `routines` is reached via `router.push("/(app)/routines/new")` and `router.push("/(app)/routines/${id}")` from `workout/index.tsx:122-146`; `measurements` via `router.push("/(app)/measurements")` from `profile.tsx:201` plus its own `/new` and `/[id]` deep paths.
   (b) The user's prompt never mentions routines or measurements. They are not "tabs" from the user's POV.
   (c) **My recommendation: out of scope.** Do not wire listeners on hidden tabs. Their navigation back to root happens via the back arrow or via `router.back()` in their post-mutation handlers (already verified at `routines/new.tsx:38, 101`, `measurements/new.tsx:72, 349`). Confidence: HIGH.

8. **Scroll-reset on pop — yes or no?**
   (a) Strong/iOS convention: tab-tap when already at root also scrolls the FlatList/ScrollView back to top. This codebase has **no `useScrollToTop`** hook usage (verified by `grep -rn "useScrollToTop"` returning zero). The four scrollable tab roots (`history/index.tsx` FlatList, `progress/index.tsx` ScrollView, `exercises/index.tsx` FlatList, `workout/index.tsx` FlatList) have no scrollTo refs wired.
   (b) Cost to add: each tab root would need a ref to its scroller + a `useScrollToTop(ref)` from `@react-navigation/native` (already in `package.json`). Alternatively, just call `popToTop` and let the scroll position persist.
   (c) **My recommendation: NOT in v1**. Keep this run scope-tight (the prompt does not mention scroll reset). If the user wants Strong-parity scroll-to-top, file a follow-up that wires `useScrollToTop` to each tab root's scroller. Confidence: HIGH.

## Reusable patterns

- **`<Tabs.Screen>` `listeners` prop pattern** (verified available via `TabsClient.d.ts:14-22, 63-71`):
  ```tsx
  // Per-screen shape — illustrative; not a final design.
  <Tabs.Screen
    name="exercises"
    listeners={({ navigation }) => ({
      tabPress: (e) => {
        if (navigation.isFocused()) {
          e.preventDefault();
          navigation.popToTop();
        }
      },
    })}
    options={{ ... }}
  />
  ```
- **Navigator-level `screenListeners` shape** (verified available):
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
  ```
- **Existing test pattern for tab-label click** — `tests/e2e/auth.spec.ts:301-303`:
  ```ts
  await page.getByText("Profile", { exact: true }).first().click();
  await page.waitForURL(/\/profile/, { timeout: 10_000 });
  ```
  Reusable for the new e2e: navigate to `/exercises/{id}`, click "Exercises" tab label, assert `waitForURL(/\/exercises$/)`.

## Out-of-scope flags
- **Breadcrumb component** — `state.md:25` explicitly out of scope. Prompt phrases it as "We can also add" (suggestive, not load-bearing). Punt.
- **Long-press on tab** — `state.md:26` out of scope. Some apps reset to root on long-press; not requested here.
- **Header-tap to pop** — recommend punt (Unknown 4). If Designer disagrees, scope grows by 7-8 files and needs custom `headerTitle` components without breaking existing `headerRight` widgets.
- **Scroll-to-top on already-at-root tap** — out of scope (Unknown 8). No `useScrollToTop` in codebase today.
- **Hidden tabs** — out of scope (Unknown 7). No tab icon → no event to listen for.
- **Profile-specific listener** — Designer's call (Unknown 5); either include for uniformity (recommended) or skip without functional loss.
