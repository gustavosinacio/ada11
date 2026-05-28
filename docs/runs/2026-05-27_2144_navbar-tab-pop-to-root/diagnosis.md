# Diagnosis — 2026-05-27_2144_navbar-tab-pop-to-root

## Hypothesis (stated BEFORE searching)
Given the repro (Path A click-through pops; Paths B deep-link / refresh and C cross-tab-from-workout are no-ops), I suspect the cause is the focused-re-tap pop guard in `HomeLinkTabBarButton` (`app/(app)/_layout.tsx`) requiring `childState.type === "stack"`. On URL-driven rehydration (deep-link / refresh / cross-tab arrival) the `exercises` tab's child Stack is reconstructed from the URL as a **PartialState** whose `type` is `undefined` (not `"stack"`), so the guard short-circuits and the press falls through to the default `onPress` (`:97`) — a no-op for an already-focused tab. The `backHref` query param is a red herring (Path B fails without it; Path C fails for the same PartialState reason).

**Verdict after investigation: CONFIRMED as fact.** This is not merely inferred — the prior run (`2026-05-26_0307_bottom-tab-home-link`) empirically observed the exact PartialState divergence at runtime via an instrumented probe and documented it as a known, deferred follow-up.

## Evidence

### Source-of-truth files (verified by reading)

- **`app/(app)/_layout.tsx:78-94`** — the pop guard. The conjunction requires `childState.type === "stack"` (`:80`), `typeof childState.index === "number"` (`:81`), `childState.index > 0` (`:82`), and `typeof childState.key === "string"` (`:83`) before dispatching `StackActions.popToTop({ target: childState.key })`. If ANY conjunct is false the handler falls through to `onPress?.(e)` (`:97`). Verified at `file:line`.
- **`app/(app)/_layout.tsx:119`** — `tabBarButton: HomeLinkTabBarButton` is set at the `<Tabs>` `screenOptions` level, so this **single** button component is the `tabBarButton` for **every** visible tab (workout, exercises, history, progress, profile). Verified. Implication: the bug is not exercises-specific; the same guard runs for every focused-tab re-tap (see Candidate locations).
- **`app/(app)/_layout.tsx:62-64,73`** — `useNavigation()` + `useRoute()` + reading `props["aria-selected"]`. `navigation.getState()` here returns the **Tabs** navigator state; `aria-selected === true` identifies the focused tab; `focusedRoute.state` (`:77`) is the **child Stack's** nested state. The parent Tabs is hydrated (so `aria-selected` is reliable) even when the child Stack's nested `.state` is still partial — this asymmetry is exactly why Path B/C reach the focused branch but fail the `type === "stack"` conjunct.
- **`node_modules/@react-navigation/bottom-tabs/src/views/BottomTabBar.tsx:436-439`** — each tab button is wrapped in `<NavigationProvider navigation={descriptors[route.key].navigation}>`. Confirms (fact) that inside `HomeLinkTabBarButton`, `useNavigation()` yields the Tabs navigator and `navigation.getState()` returns the `TabNavigationState`. `BottomTabItem.tsx:342` sets `'aria-selected': focused` — confirms the focused-tab detection the button relies on.
- **`node_modules/@react-navigation/routers/lib/typescript/src/types.d.ts:6-50`** — `NavigationState` has **required** `type: string`, `index: number`, `key: string`, `stale: false`. `PartialState` (`:47-50`) is `Partial<Omit<State,'stale'|'routes'>> & { stale?: true; routes: PartialRoute[] }` — i.e. on a PartialState `type`, `index`, **and `key` are all optional/absent**, while `routes` is **always present**. The doc comment at `:29` ("During rehydration, the state will be discarded if type doesn't match with router type") confirms `type` is the rehydration-discriminator and is absent until the child navigator hydrates itself. Verified.
- **`node_modules/expo-router/build/fork/getStateFromPath.js:469-499`** (`createStateObject` / `createNestedStateObject`) — the deep-link parser builds nested route states as `{ routes: [...] }` or `{ index: 1, routes: [...] }` — **no `type`, no `key`, no `stale: false`**. This is the literal source of the PartialState the child Stack is rehydrated from on URL navigation. Verified — this is the mechanism that produces `childState.type === undefined`.
- **`docs/runs/2026-05-26_0307_bottom-tab-home-link/implementation.md:73-80`** — the prior run's **runtime probe** logged, on the focused re-tap: click-through path → `{childType: stack, childIndex: 1}` (guard passes, URL popped to `/exercises`); and the pre-retap cross-tab press → `{childType: undefined, childIndex: undefined}`. Direct runtime confirmation of the PartialState shape, not inference.
- **`tests/e2e/bottom-tab-home-link.spec.ts:127-131`** — the spec's own comment: *"that path rehydrates the child Stack as a single-route PartialState with `type === undefined`, which the guard short-circuits. Deep-link rehydration → re-tap is a known follow-up."* The existing case 1 deliberately uses click-through (Path A) and avoids `page.goto`, which is precisely why the green test masked the Path B/C failure the user reported.
- **`docs/runs/2026-05-26_0307_bottom-tab-home-link/final-summary.md:30-34`** — documents this exact bug as the deferred "Known follow-up", including a candidate fix scope (`tabRoot` map + `router.replace(tabRoot)` fallback). The user's report is this follow-up surfacing in real usage.
- **`app/(app)/exercises/[id]/progress.tsx:49,90-104`** — reads `backHref` and renders a custom header back button when present. Verified this is **independent** of the tab-button pop path: `backHref` only changes the in-screen header-left affordance; it has no bearing on `HomeLinkTabBarButton`'s `getState()` inspection. Confirms `backHref` is a red herring for this symptom (matches Reproducer's finding).

### Candidate locations affected by the same root cause

| File:Line | Token / pattern | Context | Severity |
|---|---|---|---|
| `app/(app)/_layout.tsx:80` | `childState.type === "stack"` | The conjunct that fails on PartialState rehydration. Primary fault site. | blocker |
| `app/(app)/_layout.tsx:83` + `:91` | `typeof childState.key === "string"` … `target: childState.key` | Even if `:80` is relaxed, a PartialState has **no `key`** (`types.d.ts:47-50`), so the existing `popToTop` dispatch target is unavailable on the failing paths. Any fix must supply an alternative pop/navigate strategy, not merely drop the `type` check. | blocker |
| `app/(app)/_layout.tsx:97` | `onPress?.(e)` | The fall-through no-op the bug lands on for an already-focused tab. Symptom exit point, not the cause. | major |
| `app/(app)/_layout.tsx:119` | `tabBarButton: HomeLinkTabBarButton` | Single button serves all tabs ⇒ the same bug affects deep-link/refresh/cross-tab arrivals into **history** (`[id]`, `week/[isoWeek]`) and **workout** (`[sessionId]`, `verdict/[sessionId]`), not only exercises. Scope marker. | major |
| `tests/e2e/bottom-tab-home-link.spec.ts:127-145` | `page.goto` avoidance comment + case 1 | The test only exercises Path A by design, which is why the regression went unnoticed. A fix run should add a deep-link (`page.goto`) variant covering Paths B/C. | minor |

### Cross-environment confirmation

**Why Path A works but B/C don't — explained at the mechanism level (not "happens to"):**

- The `navigation` the button reads is the **Tabs (parent) navigator**, which hydrates eagerly on mount; that is why `aria-selected === true` is reliable on every path and the handler always reaches the focused branch.
- The child Stack's nested `.state` — the thing the guard inspects — hydrates only when/where the navigation tree is built:
  - **Path A (click-through):** the `exercises` child Stack navigator has been mounted and live since the user clicked into it. `navigation.getState()` returns the `exercises` route with a fully-hydrated child `NavigationState` (`type: "stack"`, `index: 1`, `key: <string>`). All five guard conjuncts pass → `popToTop` dispatches → URL pops to `/exercises`. (Runtime-proven: probe `{childType: stack, childIndex: 1}`, `implementation.md:77`.)
  - **Path B (deep-link / browser refresh):** the whole tree is reconstructed from the URL via `getStateFromPath`, which emits the child as a `{ routes: [...] }` **PartialState** (`getStateFromPath.js:469-499`) — `type === undefined`, `key === undefined`. The `:80` conjunct (`type === "stack"`) is false → short-circuit → `:97` no-op. URL unchanged.
  - **Path C (cross-tab from live workout):** identical mechanism — arriving at `/exercises/<id>/progress` from the workout tab navigates into the `exercises` tab via the linking layer, producing the same partial nested state for the freshly-entered tab. The `backHref` param rides along but is irrelevant to `getState()`. Same `type === undefined` short-circuit. (This is why a **single** fix covers B and C.)

The explanation fully accounts for the environment specificity (web SPA, URL-driven rehydration). The bug is web-routing-layer specific because PartialState rehydration from a URL is a deep-link concern; on native a true cold deep-link would hit the same partial-state path, but the user's repro is web. No residual gap between observable and explanation — the root cause is fully nailed down.

## Root cause

**Symptom:** re-tapping the focused Exercises bottom-tab does not navigate to the exercises list when the user arrived on `/exercises/<id>/progress` by deep-link/refresh (Path B) or cross-tab from a live workout (Path C).

**Cause:** the focused-re-tap pop branch in `HomeLinkTabBarButton` (`app/(app)/_layout.tsx:78-94`) is gated on the child Stack's `childState.type === "stack"` (and on `childState.key` being a string for the `popToTop` target). On URL-driven rehydration the parent Tabs navigator is hydrated but the child Stack's nested state is still a **PartialState** (`type === undefined`, `key === undefined`, but `routes` present) — produced by `expo-router`'s `getStateFromPath` (`getStateFromPath.js:469-499`). The guard's `type` conjunct is false, the press falls through to the default `onPress` (`:97`) which is a no-op for an already-focused tab, and nothing happens. This is the deferred "Known follow-up" from run `2026-05-26_0307_bottom-tab-home-link` (`final-summary.md:30-34`) now reported as a live bug. It affects **all** tabs with nested routes (exercises, history, workout), not only the one the user noticed.

## Severity classification

- **Blocker** — must fix; user-facing.
  - `app/(app)/_layout.tsx:80` — `childState.type === "stack"` short-circuits on every deep-link / refresh / cross-tab arrival; this is the direct cause of the reported no-op.
  - `app/(app)/_layout.tsx:83,91` — PartialState carries no `key`, so the current `popToTop` dispatch target is unavailable on the failing paths; the fix cannot simply relax the `type` check, it must supply an alternative pop/navigate route. Flagging as a blocker-level constraint so the Fix Designer does not ship a half-fix that relaxes `:80` and then dispatches `popToTop` with `target: undefined` (which routes to the Tabs navigator and is itself a no-op — exactly the failure mode the 5th guard at `:83` was added to prevent in the prior run).
- **Major** — should address in this run.
  - `app/(app)/_layout.tsx:119` (scope) — confirm/repair for history and workout deep-link arrivals too, since they share the one button. A per-tab "root path" mapping is the natural carrier for any `router.replace(tabRoot)` fallback.
  - `app/(app)/_layout.tsx:97` — the no-op fall-through; the fix changes what happens here for the partial-state focused case.
- **Minor (out of scope by default — note for the fix run, not a separate fix)** —
  - `tests/e2e/bottom-tab-home-link.spec.ts:127-145` — add a `page.goto` deep-link case (Path B) and ideally a cross-tab case (Path C) so the regression is locked. Strictly this is test coverage the fix run should bundle, not itself a defect.

## Symptom-only fix risk

The candidate fix the prior run pre-scoped — relax the guard for PartialState and fall back to `router.replace("/(app)/<tabRoot>")` — is a **legitimate root-cause fix** at the navigation layer (it makes re-tap reach the tab root on the rehydration path), **not** a symptom patch. Two constraints the Fix Designer must respect, both verified against the prior run's hard-won history:

1. **Do not reintroduce the web `<a>` / `linkTo` race.** The header comment at `_layout.tsx:42-48` and `:85-88` documents why `href` is stripped (PlatformPressable renders `<div role="button">` not `<a>`) and why the pop path **skips** `props.onPress` (to avoid emitting `tabPress` and the expo-router fork's RAF auto-pop + the routing-queue `linkTo` race round 1 fought). A fix must keep the press resolving as a plain button and must not re-route the pop through `onPress`/`href`.
2. **`router.replace` has a `backBehavior="history"` interaction risk.** The load-bearing comment at `_layout.tsx:107-116` (and Discovery `2026-05-26_0307/discovery.md:78`) warns that a `replace` pushes a history entry whose `historyDelta` can clobber the per-tab history invariant. If the fix uses `router.replace(tabRoot)`, the Fix Designer must verify it does not break the browser-back invariant that `bottom-tab-home-link.spec.ts` case 2 guards (cross-tab → `goBack()` returns to the source deep route). An alternative worth evaluating: derive a pop/navigate target from the partial state's `routes` (always present) rather than `replace`, if a stable child key can be obtained post-hydration.

These are fix-design decisions, not diagnosis. The cause is fully identified.

## Security relevance

`security_relevant: no`.

The root cause and all candidate locations are purely client-side navigation/UI state (which screen is shown after a tab re-tap). No authentication, session handling, RLS, access policy, credential, or untrusted-input surface is touched. The `(app)` route group is already auth-gated upstream (`app/_layout.tsx:14-35`, unchanged), and the exercises/admin RLS gates referenced in `progress.tsx:72-84` are server-authoritative and orthogonal to this navigation behaviour. A fix that changes only the re-tap pop logic does not alter any access decision.

## Peer invocations

None. The evidence chain was self-contained: framework type definitions (`@react-navigation/routers`), framework source (`@react-navigation/bottom-tabs`, `expo-router/fork/getStateFromPath`), the prior run's runtime probe (`implementation.md:73-80`), and the existing spec's documenting comment (`bottom-tab-home-link.spec.ts:127-131`) together confirm the root cause as fact without needing a Reproducer or Discovery re-invocation.
