# Implementation — 2026-05-27_2144_navbar-tab-pop-to-root

Based on: `fix-plan.md` (approved by user on 2026-05-27 22:08 BRT — "Lets implement, but be ready to rollback"). Baseline commit: `2d5e67800375032244889510041f3fdaad8b8fdb`.

## Files changed
- `app/(app)/_layout.tsx` (edited) — added the URL-rehydration fallback to `HomeLinkTabBarButton` so a focused-tab re-tap pops to the tab root on deep-link (Path B) and cross-tab-from-live-workout (Path C) arrivals; kept the existing live-stack keyed-`popToTop` fast path (Path A) untouched. Added the `TAB_ROOTS: Record<string, Href>` map, the `router`/`useSegments`/`Href` imports, and rewrote the header comment.
- `tests/e2e/bottom-tab-home-link.spec.ts` (edited) — added case 4 (Path B deep-link) and case 5 (Path C cross-tab from a live workout) with the live-session seed helpers (mirrors `exercise-progress-back-nav.spec.ts:56-121`); softened the `:127-131` "known follow-up" deferral comment and updated the file-header case list. Cases 1–3 untouched.

## Deviations from plan

### Deviation 1 (MAJOR — mechanism): the fallback uses `router.navigate(TAB_ROOTS[route.name])` gated on `useSegments()`, NOT on the child-Stack shape, and NOT `dismissAll`/`canDismiss`.

The plan's PRIMARY mechanism (`if (router.canDismiss()) { router.dismissAll(); return; }`) and its documented SECONDARY (`router.navigate(TAB_ROOTS[route.name])` gated on the PartialState's `routes`/`index`) **both failed at runtime** on web. The plan explicitly anticipated this (MEDIUM confidence on the `dismissAll`-on-PartialState behavioural claim; I/O `TODO`) and instructed me to deviate to the secondary and document it. The secondary as literally specified (gate on child-Stack `routes`) ALSO did not work, so I went one step further to a URL-based gate. Full runtime evidence (captured via an instrumented probe — temporary `console.log` + `usePathname`/`useSegments`, all removed before declaring done):

| Path | Tab child `state` at press time | `canDismiss()` | Conclusion |
|---|---|---|---|
| A (click-through) | `{ type:"stack", index:1, key:"...", routes:[…2] }` — fully hydrated | true | keyed fast path fires (unchanged) |
| B (deep-link / refresh) | `{ routes:[{ name:"[id]/progress" }] }` — single-route PartialState, `type`/`key`/`index` undefined | **false** | `dismissAll` no-ops; only 1 route so `index>0`/`routes.length>1` never true |
| C (cross-tab from live workout) | **`undefined`** entirely | **false** | child state cannot be inspected at all |
| Genuine at-root (cross-tab to list) | **`undefined`** entirely | **false** | SAME shape as Path C — child state cannot distinguish "must pop" from "no-op" |

The decisive finding: **the Tabs child-Stack state cannot discriminate Path C (nested, must pop) from a genuine at-root cross-tab arrival — both yield `childState === undefined`.** Any gate built on the child Stack (the plan's secondary) is therefore unsound. The reliable source of truth is the URL itself: `useSegments()` returns `["(app)", "<tab>"]` (length 2) at any tab root and is deeper on a nested route. The shipped gate is:
```ts
const onNestedRoute =
  segments[0] === "(app)" && segments[1] === route.name && segments.length > 2;
if (tabRoot && onNestedRoute) { router.navigate(tabRoot); return; }
```
Constraints respected: still NOT routed through `props.onPress`/`href` (imperative `router` call); still NOT `router.replace` (used `navigate`, to protect the `backBehavior="history"` browser-back invariant — case 2 stays green); `TAB_ROOTS` typed-route literals typecheck under `typedRoutes: true`. `useSegments` is an existing project pattern (`app/_layout.tsx:16`).

### Deviation 2 (minor — import style): `Href` is imported inline (`import { Tabs, router, useSegments, type Href } from "expo-router"`) rather than as a separate `import type { Href }`.

Matches the established project convention at `app/(app)/exercises/[id]/progress.tsx:1` (`import { ..., type Href } from "expo-router"`). Same net effect; one import line instead of two.

### Deviation 3 (minor — `dismissAll`/`canDismiss` not in final code): because the URL-based gate replaced the child-Stack gate, `router.dismissAll`/`canDismiss` are not referenced in the shipped code (the plan kept them as the primary). They were genuinely tried first and runtime-disproven (see Deviation 1 table). `TAB_ROOTS` IS used (by `navigate`), so no unused-symbol lint warning.

## Soft callbacks made
- None. The plan's own `TODO: Implementer to verify` (runtime, web) + the explicit "deviate to the secondary and record it" instruction covered the ambiguity; no Designer escalation needed.

## Quality gates
- [x] `npm run typecheck` — pass (0 errors; `TAB_ROOTS: Record<string, Href>` typechecks under `typedRoutes: true`).
- [x] `npm run lint` — pass (0 errors; the only warning is the pre-existing, baseline-unchanged auto-generated `.expo/types/router.d.ts` "unused eslint-disable directive". My two edited files: 0/0.)
- [x] `npm run test:unit` — 384/384 passed.
- [x] e2e `bottom-tab-home-link.spec.ts` — 5/5 passed on the fix (full-suite green run captured during verification). Cases 4 & 5 confirmed RED on the pre-fix source (stashed `_layout.tsx` to baseline, ran, confirmed both fail at the `waitForURL(/\/exercises$/)` assertion) and GREEN on the fix → they genuinely exercise the bug.
- [~] `npx expo export --platform web` — NOT run by Implementer this round (dev server crashed under verification load; see Process notes). Listed in the plan's static gates for the Regression Tester to run.
- [x] No new `any`.
- [x] No new `// @ts-ignore` / `eslint-disable`.
- [x] No stray `console.log` (probe instrumentation fully removed; `grep` clean).

## Runtime verification (MANDATORY — web, localhost:8081)
- **Path A (must NOT regress):** spec case 1 (same-tab click-through → progress → re-tap) PASS. Keyed fast path unchanged.
- **Path B (deep-link):** probe — `page.goto(/exercises/<id>/progress)` → re-tap Exercises → URL became `/exercises`. Spec case 4 PASS.
- **Path C (cross-tab from live workout):** probe — open live session → tap exercise name → `/exercises/<id>/progress?...&backHref=...` → re-tap Exercises → URL became `/exercises`. Spec case 5 PASS.
- **Browser-back invariant (case 2):** cross-tab tap + `page.goBack()` returns to the source deep route — PASS (the `navigate`-not-`replace` choice protects this).
- **Leaf no-op (case 3):** Profile re-tap stays on `/profile` — PASS.

## Process notes (for retro)
- The plan's MEDIUM confidence was correctly placed: BOTH the primary (`dismissAll`) and the literal secondary (`navigate` gated on child-Stack `routes`) failed on web. The root reason is deeper than the plan modeled — the focused tab's child-Stack state is not just a "single-route PartialState" (Path B) but is sometimes `undefined` entirely (Path C and at-root cross-tab), making the child Stack an unsound discriminator. The fix pivoted to `useSegments()` (the URL) as the gate.
- Heeded the prior-run feedback ("a runtime probe must exercise the SAME flow as the spec"): the probe used the exact Path B (`page.goto` deep-link) and Path C (live-session seed → tap exercise name) flows that spec cases 4/5 use, and I probed the genuine at-root cross-tab case too — which is what surfaced the `undefined`-vs-`undefined` ambiguity that the plan's child-Stack gate would have silently shipped broken.
- During verification I generated heavy repeated Playwright load against the single dev server; near the end the externally-managed `npm run web` server crashed (process gone, all fetches fail). The last full-suite run's case 4/5 failures were all at `signInAndLand`/`page.goto` (server unavailable), NOT logic — the fix had already passed the full suite + isolated probes while the server was healthy. The server must be restarted before the Regression Tester runs.

## Notes for Regression Tester
- **Restart the dev server first** (`npm run web`) — it crashed under my verification load (environment, not code). Confirm `http://localhost:8081` responds before running the suite.
- Run the full e2e suite. `bottom-tab-home-link.spec.ts` cases 1–5 should be green. Spot-check a **History** deep-link arrival (`/(app)/history/<id>` → re-tap History → `/history`) to confirm the single-button fix generalises beyond exercises (the segments gate is tab-agnostic: `segments[1] === route.name`).
- Original repro at `repro.md` — Paths B and C no longer no-op (verified); Path A unchanged.
- The fix is web-runtime-verified only. Native (iOS/Android) cold deep-link → tab re-tap is NOT verified in this run (no device/simulator). `useSegments`/`router.navigate` are platform-agnostic so the same logic should apply, but flag as a manual native spot-check if a device is available.
- Rollback path (user requested readiness): working-tree-only edits to exactly `app/(app)/_layout.tsx` and `tests/e2e/bottom-tab-home-link.spec.ts`. `git restore` on those two files cleanly reverts to baseline `2d5e678`.
</content>
