# Fix plan — 2026-05-27_2144_navbar-tab-pop-to-root

> `security_relevant: no` (carried forward from `diagnosis.md:73`; this plan introduces no
> new auth / RLS / endpoint / untrusted-input surface — see "Security relevance carry-forward" below).

## Scope

**In scope (blockers + majors from `diagnosis.md`):**
- `app/(app)/_layout.tsx:78-97` (BLOCKER) — `HomeLinkTabBarButton`'s focused-re-tap branch fails on URL-driven
  PartialState rehydration (`childState.type === undefined`, `childState.key === undefined`), so Paths B
  (fresh-load / deep-link / refresh) and C (cross-tab from a live workout) fall through to the `:97`
  no-op. Add a **PartialState fallback** that pops the focused tab's child Stack to root via an imperative
  `router` call that does **not** require the (absent) child Stack `key`.
- `app/(app)/_layout.tsx:119` (MAJOR — scope) — the single `HomeLinkTabBarButton` serves **all** visible
  tabs, so the same fallback must work for any tab's nested deep-link arrival (exercises **and** history
  **and** workout), not only exercises. Achieved by deriving the tab-root from the focused tab's route name
  via a small explicit map (no per-tab branching).
- `app/(app)/_layout.tsx:97` (MAJOR) — the fall-through no-op for the partial-state focused case is what
  changes behaviour; after the fix it pops to the tab root instead of doing nothing.
- `tests/e2e/bottom-tab-home-link.spec.ts` (TEST COVERAGE — bundled, not a separate defect; see
  `diagnosis.md:59-60`) — add a deep-link (Path B) case and a cross-tab (Path C) case so the masking gap
  (the suite only covers Path A today, `:127-131`) is closed and the regression is locked.

**Explicitly NOT in scope (see "Out of scope" section):** scroll-to-top on re-tap, header-tap-to-pop,
hidden-tab parity (`routines`, `measurements`, `admin`), the optional breadcrumb, and any refactor of the
existing live-stack fast-path. This is a **single-file production change + one test file edit**.

## Approach

Keep the existing, runtime-proven live-stack fast-path **exactly as-is** (Path A: `childState.type === "stack"`
+ `index > 0` + `key` is a string → `StackActions.popToTop({ target: childState.key })`). The bug is that on
PartialState rehydration this guard is correctly skipped but nothing replaces it — so add an **`else` fallback**
that runs only on the focused tab when the fast-path did not fire. The fallback pops the focused tab's child Stack
to root using `expo-router`'s imperative `router`, which operates on the **current focused route's stack** and
therefore does not need the child Stack `key` that a PartialState lacks (constraint 2). The press stays a plain
button handler — the fallback is an imperative `router.*` call, **not** a re-route through `props.onPress` and not
via an `href`/`<a>` (constraint 1, the round-1 race surface). The primary fallback primitive is
`router.dismissAll()` guarded by `router.canDismiss()` because it dispatches a pop directly (no `linkTo`/href
resolution; closest to the existing dispatch model and furthest from the round-1 routing-queue race);
`router.navigate("/(app)/<tabRoot>")` (built from an explicit `TAB_ROOTS` map) is the documented secondary if
`dismissAll` proves unreliable on a partial state at runtime. `router.replace(...)` is **rejected** as the
mechanism because the diagnosis and the prior run both flag its `historyDelta` interaction with
`backBehavior="history"` (constraint 3). The fallback is gated by `canDismiss()` so an already-at-root re-tap stays
a clean no-op (no spurious history mutation), preserving the spec's case-2 / case-3 invariants and not regressing
Path A.

## Mudanças por arquivo

| File | Type | Change |
|---|---|---|
| `app/(app)/_layout.tsx` | edited | (1) Add `import { router } from "expo-router";` (alongside the existing `import { Tabs } from "expo-router";`) and `import type { Href } from "expo-router";`. (2) Add a module-scope `TAB_ROOTS: Record<string, Href>` map of typed-route literals for the 5 visible tabs: `workout → "/(app)/workout"`, `exercises → "/(app)/exercises"`, `history → "/(app)/history"`, `progress → "/(app)/progress"`, `profile → "/(app)/profile"`. (Used only by the secondary fallback; see I/O `TODO`. Keep it even if the primary `dismissAll` path works — it documents the bounded tab set and is the carrier the secondary needs.) (3) In `handlePress`, inside `if (isFocused)`, **keep** the existing live-stack fast-path (`:78-94`) untouched; add an `else` branch: when the fast-path did NOT fire, pop to the tab root via `if (router.canDismiss()) { router.dismissAll(); return; }`. When `canDismiss()` is false (genuinely at the tab root, or a leaf tab like Profile) fall through to the existing `onPress?.(e)` no-op (`:97`). (4) Update the header comment block (`:50-59`) to document the new PartialState fallback branch and why it uses `dismissAll`/`canDismiss` rather than a keyed `popToTop`. |
| `tests/e2e/bottom-tab-home-link.spec.ts` | edited | Add **case 4 (Path B, deep-link)**: `signInAndLand` → `page.goto("/(app)/exercises/<id>/progress")` → `waitForURL(.../progress$)` → click the `Exercises` tab (`getByRole("tab", { name: "Exercises" })`) → assert `waitForURL(/\/exercises$/)` and the `New exercise` list-root marker is visible. Add **case 5 (Path C, cross-tab from live workout)**: seed a live (un-ended) session whose routine contains the canonical exercise (mirror the live-session seed pattern in sibling specs), open the workout, tap the exercise name to reach `/exercises/<id>/progress?...&backHref=...`, click the `Exercises` tab, assert `waitForURL(/\/exercises$/)`. Update the file-header comment to note the deep-link/cross-tab cases now cover what the `:127-131` "known follow-up" comment deferred; soften/remove that deferral note. **Do not modify cases 1–3.** |

## Contratos de I/O

- **Function signatures / types added or changed**: None changed. `HomeLinkTabBarButton(props: BottomTabBarButtonProps)`
  keeps its exact signature. One new module-scope constant `const TAB_ROOTS: Record<string, Href>` (import
  `Href` from `expo-router`) — internal to `_layout.tsx`, not exported, not a public contract.
- **DB columns / queries**: None. Pure client-side navigation state.
- **UI props / state**: None added to any component's prop surface. The forwarded `PlatformPressable` props are
  unchanged (`href` stays stripped; `onPress` still wraps the same `handlePress`). No new React state/hooks.

### API-surface verification (per Fix Designer contract)

- `router.dismissAll` — **verified present** at `node_modules/expo-router/build/imperative-api.d.ts:60`
  ("Returns to the first screen in the closest stack. This is similar to `popToTop`.") and exported at
  `node_modules/expo-router/build/global-state/routing.d.ts:27`.
- `router.canDismiss` — **verified present** at `imperative-api.d.ts:66` / `routing.d.ts:30`.
- `router.navigate(href, options?)` (secondary fallback) — **verified present** at `imperative-api.d.ts:37` /
  `routing.d.ts:20`.
- `router.replace` (rejected mechanism) — verified present (`imperative-api.d.ts:45`); rejected on the
  `backBehavior` risk, not on availability.
- `Href` type — exported from `expo-router` (`imperative-api.d.ts:4` imports it from `./types`); `typedRoutes: true`
  is enabled (`app.json:49`), so the `TAB_ROOTS` values must be **string literals** matching the typed-route surface
  (a `` `/(app)/${route.name}` `` template string would NOT typecheck against `Href` — this is **why** the explicit
  map is used instead of string interpolation).
- **`TODO: Implementer to verify` (runtime, web):** the *behavioural* claim that `router.dismissAll()` (guarded by
  `router.canDismiss()`), invoked from the focused tab while its child Stack is a freshly-rehydrated **PartialState**
  showing `[id]/progress` on top, pops that child Stack to its index and updates the URL to `/exercises` — is asserted
  from the documented `dismissAll` semantics ("closest stack" = the current focused route's stack) but is **not**
  statically provable for the PartialState shape. The diagnosis establishes this whole area is web-routing-specific and
  was only ever runtime-confirmed for the live-stack path (`implementation.md:73-88`). The Implementer MUST runtime-verify
  Paths B and C on web (dev server / Playwright) before declaring done; if `dismissAll` does not pop on PartialState,
  **deviate to the documented secondary** `router.navigate(TAB_ROOTS[route.name])` and record the deviation in
  `implementation.md` (still must NOT route through `props.onPress` and must NOT use `router.replace`).

## Riscos

- **Regressões em fluxos adjacentes**: The button is the `tabBarButton` for **every** visible tab
  (`_layout.tsx:119`). The fallback fires only on the focused tab and only when the live-stack fast-path did
  not run, so:
  - **Path A (live stack)** is unchanged — the existing `popToTop({ target })` still fires first; the new
    branch is `else`-only. Spec case 1 must still pass.
  - **Cross-tab tap (different tab focused)** never reaches the focused branch (`isFocused === false` →
    `props.onPress`), so spec case 2's cross-tab navigate + `backBehavior="history"` browser-back invariant is
    untouched. **This is the load-bearing invariant** (`_layout.tsx:107-116`) — the fallback does not run on
    cross-tab taps.
  - **Leaf tab (Profile) / already-at-root re-tap**: `router.canDismiss()` is false (nothing below the top) →
    no dismiss, falls through to the existing `onPress?.(e)` no-op. Spec case 3 (Profile leaf no-op) must still
    pass. This `canDismiss()` gate is what prevents a spurious history mutation on an at-root re-tap.
  - **`router.replace` rejected precisely to avoid** the `historyDelta` clobber the diagnosis (constraint 3)
    and discovery (`2026-05-26_0307/discovery.md:78`) warn about.
- **Data integrity**: None. No auth, RLS, migration, or denormalized column touched. `(app)` stays auth-gated
  upstream (`app/_layout.tsx`, unchanged). RLS in `progress.tsx` is server-authoritative and orthogonal.
- **Platform-specific**: The bug is web-SPA-specific (URL-driven PartialState rehydration). The fix uses no
  `Platform.OS` branch — `router.dismissAll`/`canDismiss` are platform-agnostic expo-router primitives. On
  native, a cold deep-link would hit the same partial-state path and the same fallback applies; the live in-app
  path on native already auto-pops via the expo-router fork (unchanged). **Native is not runtime-verified in this
  run** (same caveat the prior run logged, `implementation.md:121`); the Regression Tester's primary surface is
  web (where the bug reproduces). Flag native as manual spot-check if a device is available.
- **Performance**: Negligible. The map is a module-scope constant (one allocation at import). The fallback adds at
  most one `canDismiss()` check + one `dismissAll()` dispatch per focused re-tap — no render-path or query-path cost.

## Alternativas descartadas

1. **Relax the `:80` `type === "stack"` guard and reuse `StackActions.popToTop({ target: childState.key })`** —
   descartada porque on a PartialState there is **no `key`** (`types.d.ts:47-50`); dispatching with
   `target: undefined` routes the action to the Tabs navigator, which does not handle `POP_TO_TOP`, producing the
   **same no-op** — exactly the failure mode the 5th guard at `:83` was added in round 1 to prevent
   (`diagnosis.md:55`). It would ship a half-fix.
2. **`router.replace("/(app)/<tabRoot>")` as the pop mechanism** — descartada porque `replace` swaps the current
   history entry; its `historyDelta` interaction with `backBehavior="history"` is the documented medium-risk pattern
   the prior run's discovery explicitly warned against (`2026-05-26_0307/discovery.md:78`) and the diagnosis flags as
   constraint 3 (risk to the spec case-2 browser-back invariant). A pop-style primitive (`dismissAll`) reaches the
   same screen without the history-swap risk.
3. **Force synchronous hydration of the child Stack inside the press handler to recover a `key`, then keyed
   `popToTop`** — descartada porque it is fragile (depends on hydration timing within a single synchronous press
   handler), adds complexity, and `dismissAll`/`canDismiss` reach the same end-state without ever needing the key.
4. **`router.navigate("/(app)/<tabRoot>")` as the *primary* mechanism** — not discarded outright; retained as the
   **documented secondary fallback** (see I/O `TODO`). Demoted from primary because `navigate` routes through `linkTo`
   → the `routingQueue` (the subsystem round 1 fought, `_layout.tsx:85-88`); while the DOM `<a>` race is avoided
   (imperative call, not an anchor click), `dismissAll` dispatches a pop directly and stays further from that surface,
   so it is the lower-risk first choice.

## Out of scope (follow-up)

- **Scroll-to-top on re-tap** — Strong/iOS parity scrolls the list to top on tab re-tap. No `useScrollToTop` in the
  codebase (`2026-05-26_0307/discovery.md:135`). Not requested. Follow-up.
- **Header-tap-to-pop** — the original feature prompt's optional "top of the page" affordance; punted in the prior
  run, still out of scope (7-8 file edits with stateful-`headerRight` collision risk).
- **Hidden-tab parity** (`routines`, `measurements`, `admin` — all `href: null`) — no tab icon, no re-tap event
  possible. Out of scope.
- **Breadcrumb component** — explicitly out of scope since the original run.
- **Refactor `HomeLinkTabBarButton` for testability** (e.g. extracting the pop decision into a pure helper) —
  tempting "while I'm here", but inflates regression surface on a load-bearing nav component. Not in this run.

## Regression test plan (preview — Regression Tester will execute)

- **Static gates**: `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npx expo export --platform web`.
  (The `TAB_ROOTS: Record<string, Href>` map must typecheck under `typedRoutes: true`; a typecheck failure here means
  a value isn't a valid typed-route literal.)
- **Replay original reproduction** from `repro.md` and confirm the bug no longer fires:
  - **Path B** (primary repro): deep-link / refresh onto `/(app)/exercises/<id>/progress`, re-tap **Exercises** →
    URL becomes `/exercises`, list shown. (Was: no-op.)
  - **Path C**: from a live workout, tap exercise name → `/exercises/<id>/progress?...&backHref=...`, re-tap
    **Exercises** → URL becomes `/exercises`. (Was: no-op.)
  - **Path A** (must NOT regress): same-tab click-through → progress → re-tap **Exercises** → `/exercises`.
- **Coverage gap closed**: the new **case 4 (Path B)** and **case 5 (Path C)** in `bottom-tab-home-link.spec.ts` lock
  the regression. Note for the Tester: the existing suite covered **only Path A** by design (`:127-131`), which is
  exactly why the user-reported failure shipped green. Confirm cases 4 and 5 **fail on the pre-fix code** (sanity that
  they actually exercise the bug) and pass post-fix.
- **Adjacent regression checks (run the existing suite, do not just author new cases):**
  - `bottom-tab-home-link.spec.ts` **case 1** — Path A pop still works (fast-path untouched).
  - `bottom-tab-home-link.spec.ts` **case 2** — cross-tab tap + `page.goBack()` still returns to the source deep
    route (the `backBehavior="history"` invariant the `dismissAll` mechanism was chosen to protect).
  - `bottom-tab-home-link.spec.ts` **case 3** — Profile leaf re-tap stays a no-op (`canDismiss()` false path).
  - Spot-check a **History** deep-link arrival (`/(app)/history/<id>`) re-tap pops to `/history` — confirms the
    "single button, all tabs" fix (`_layout.tsx:119`) generalises beyond exercises.
- **Manual verification needed?** **Yes (light):** native (iOS/Android) is not runtime-verified in this run — if a
  device/simulator is handy, spot-check a cold deep-link → tab re-tap pops to root. Web is the authoritative surface
  for this bug and is covered by the e2e cases.

## Confidence / Risk

- **Confiança**: **MÉDIA** — root cause is CONFIRMED as fact (`diagnosis.md`, with a prior-run runtime probe of the
  exact PartialState divergence), and the chosen primitives are verified present in the expo-router type defs. The one
  gap holding this below HIGH: the *behavioural* claim that `router.dismissAll()` pops a freshly-rehydrated
  **PartialState** child Stack to root on web is asserted from documented semantics but not statically provable — it
  requires the Implementer's runtime verification (with `router.navigate(TAB_ROOTS[...])` as the labelled fallback).
  This is an inherent property of a web-routing-layer fix, not a hole in the diagnosis.
- **Risco**: **BAIXO** — single production-file change, purely additive (`else` branch; live-stack fast-path and
  cross-tab path untouched), no DB/auth/RLS surface, `canDismiss()`-gated so at-root re-taps stay no-ops, and
  `router.replace` deliberately avoided to protect the one load-bearing browser-back invariant. The blast radius is
  one nav component already covered (post-fix) by 5 e2e cases.

### Security relevance carry-forward

`security_relevant: no` — confirmed against `diagnosis.md:71-75`. This plan adds **no** new endpoint, auth path,
credential handling, or untrusted-input surface. The only new code is client-side navigation (an imperative `router`
pop + a static route-name→path map). No upgrade warranted.

## Awaiting
Human approval before Implement phase.
