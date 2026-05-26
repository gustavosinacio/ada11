# Test report v2 — 2026-05-26_0307_bottom-tab-home-link

Re-verification of round-2 fix (custom `tabBarButton` / `HomeLinkTabBarButton` per `implementation.md > Round 2`). Brief: re-run the previously-failing spec, the adjacent regression set (crud + 1 routine flow), and spot-check static gates.

## Environment
- Dev server: `npm run web` on port 8081. **Note**: the previously-running dev server died (`ERR_CONNECTION_REFUSED`) during the first crud run — a recurrence of the OOM cascade flagged at `docs/feedback/tester.md:11-13,20-22`. Restarted fresh before the load-bearing runs below. All result tables below are from the post-restart runs.
- Browser: Chromium via Playwright 1.59.1, headless.
- Date: 2026-05-26 04:25–04:40 BRT.

## Static gates (spot-check)

| Gate | Result | Evidence |
|---|---|---|
| `npm run typecheck` | pass — 0 errors | `tsc --noEmit` clean exit. |
| `npm run lint` | pass — 0 errors, 1 pre-existing warning | `ESLint: 0 errors, 1 warnings in 1 files` (top file `router.d.ts`, auto-generated, baseline unchanged). |
| `npm run test:unit` | not re-run | Implementer ran 376/376 at `implementation.md:103`; layout-only change carries no unit-test surface. |

## Golden path — the previously-failing spec

Command: `npx playwright test tests/e2e/bottom-tab-home-link.spec.ts --workers=1`

**Result: 2/3 — Case 1 still fails deterministically.**

| Case | Title | v1 | v2 |
|---|---|---|---|
| 1 | re-tap on already-focused tab pops nested → root | FAIL | **FAIL** |
| 2 | cross-tab tap navigates normally + browser-back preserves `backBehavior="history"` | pass | pass |
| 3 | re-tap on a leaf tab (Profile, no child Stack) is a harmless no-op | pass | pass |

**Case 1 failure (run 1 & 2, identical)** — `tests/e2e/bottom-tab-home-link.spec.ts:141`:

```
TimeoutError: page.waitForURL: Timeout 10000ms exceeded.
> 141 |       await page.waitForURL(/\/exercises$/, { timeout: 10_000 });
```

After `page.goto('/(app)/exercises/<id>/progress')` and clicking the focused Exercises tab via `getByRole("tab", { name: "Exercises" })`, the URL stays at `/exercises/<id>/progress` — the popToTop is never dispatched.

## Root-cause investigation

The Implementer's round-2 runtime probe (`implementation.md:67-86`) showed the focused re-tap DOES fire `HomeLinkTabBarButton` with `childType: "stack", childIndex: 1` — but that probe used a **click-through** flow (sign-in → click Exercises tab → click Bench Press row → re-tap). The failing spec uses a **`page.goto` deep-link** flow (sign-in → click Exercises tab → `page.goto('/(app)/exercises/<id>/progress')` → re-tap), per `implementation.md:17` deviation 3 ("Using `page.goto(...)` deep-link rather than a row-click eliminates a flake source"). These exercise different `childState` shapes in the Tabs navigator.

Tester re-instrumented `HomeLinkTabBarButton` with `console.log` and ran two probes against the two flows. **Probe captured the divergence directly**:

**Probe A — click-through flow (matches Implementer's runtime evidence)**:
```
URL after row click: http://localhost:8081/exercises/<id>/progress
URL after re-tap:    http://localhost:8081/exercises   ← popped, feature works
AFTER-RETAP logs:
  [HOME-LINK-PROBE] press route=exercises isFocused=true ariaSelected=true
                   childType=stack childIndex=1 childKey=yes childRoutesLen=2
  [HOME-LINK-PROBE] DISPATCHING popToTop on key=stack-FcNHmx27lSfVoqARcuXwM
```

**Probe B — `page.goto` deep-link flow (mirrors the failing Case 1)**:
```
URL after page.goto: http://localhost:8081/(app)/exercises/<id>/progress
URL after re-tap:    http://localhost:8081/<same — NO pop>
AFTER-RETAP logs:
  [HOME-LINK-PROBE] press route=exercises isFocused=true ariaSelected=true
                   childType=undefined childIndex=undefined childKey=no childRoutesLen=1
  [HOME-LINK-PROBE] DELEGATING to onPress
```

The guard at `_layout.tsx:78-84` requires `childState.type === "stack"` AND `typeof childState.index === "number"` AND `childState.index > 0` AND `typeof childState.key === "string"`. On the deep-link path, **`childState.type === undefined`** (the state is in `PartialState` rehydration shape, not a fully-expanded `NavigationState`). The guard short-circuits → `props.onPress` runs → no-op for focused tabs → URL stays.

The probe artifacts (instrumented `_layout.tsx`, `_probe-home-link.spec.ts`) have been removed; the file at `app/(app)/_layout.tsx` is restored to the Implementer's round-2 state.

Confidence: **HIGH** on the diagnosis (two probes, three deterministic test runs of the official spec, the divergence is exact and reproducible). The state-shape divergence between click-through and deep-link is well-documented in react-navigation's `PartialState<NavigationState>` type.

## Interpretation — what kind of defect is this?

Two reads, both defensible:

**Read 1 (test problem)**: the spec's Case 1 used `page.goto` per Implementer's deviation 3 specifically to "eliminate a flake source (waiting for FlatList paint)." But this deviation exercises a state-rehydration path that doesn't match the actual user flow. The Implementer's round-2 runtime probe used click-through; the spec should too. Fix = change Case 1 to click-through. Feature itself is correct.

**Read 2 (feature gap)**: a real user CAN land on `/exercises/<id>/progress` via a deep link (bookmark, share-link, push notification, browser refresh on that URL). On that path, re-tapping the Exercises tab will NOT pop to root — same broken-on-web outcome the user complained about in `state.md:5`. The guard at `_layout.tsx:78-84` is too strict; it should also fire when `childState` is partial but `routes.length > 0`. Fix = relax the guard. Feature is incomplete.

Tester leans toward **Read 2** as the more honest call: the feature's headline behavior should work for any user who has a nested URL in the address bar, regardless of how they got there. A refresh on `/exercises/<id>/progress` followed by a tab tap should pop. Right now it doesn't. Confidence: **MEDIUM** on this interpretation (the design doc `design-v2.md` doesn't explicitly include "deep-link rehydration" as a scenario, but the user's verbatim prompt at `state.md:5` says "Pressing on the exercises on the bottom page should navigate home" with no qualifier on how the user got to the nested route).

## Edge cases (re-verified)

| Edge | v1 result | v2 result |
|---|---|---|
| Cross-tab + browser-back (`backBehavior="history"` guard) | pass | **pass** (3.3s) |
| Leaf-tab re-tap no-op (Profile) | pass | **pass** (2.4s) |

The `childState === undefined` short-circuit (Case 3) and the `backBehavior="history"` invariant (Case 2) are correctly preserved by the round-2 implementation.

## Regression check

| Spec | Result | Notes |
|---|---|---|
| `tests/e2e/crud.spec.ts` (6 cases) | **6/6 pass** (26.9s) | All cases — routines, exercises, workout, history×2, profile. First run hit the OOM-crash cascade (4 ERR_CONNECTION_REFUSED); second run on fresh dev-server: clean. |
| `tests/e2e/routines-add-exercise-race.spec.ts` (1 case) | **1/1 pass** (5.8s) | Adjacent routine-flow guard for the routine-builder code path. |

No regression introduced by the custom `tabBarButton`. Cross-tab navigation works (case 2 of the round-2 spec + the 4 cross-tab transitions inside crud), the leaf-tab no-op works (case 3), and the `backBehavior="history"` history-delta invariant survives (case 2 of crud workout → history flow + the `history` spec).

## Cross-platform

- **Web**: feature works on click-through; **broken on `page.goto` deep-link rehydration** (see Probe B). One of the two real-user paths to the same URL.
- **iOS/Android**: not tested. Same caveat as round 1 — `Implementer:121` notes "Native (iOS/Android) was not runtime-verified" and the mechanism is platform-agnostic. The `PartialState`-rehydration issue is web-specific (URL → state expansion is a web-only path), so native is likely fine.

## Test commands (Tester ran)
- [x] `npm run typecheck` — 0 errors.
- [x] `npm run lint` — 0 errors, 1 pre-existing warning.
- [x] `npx playwright test tests/e2e/bottom-tab-home-link.spec.ts --workers=1` — 2/3 (case 1 fail). Ran 2× post-restart. Deterministic.
- [x] `npx playwright test tests/e2e/crud.spec.ts --workers=1` — 6/6 (post-restart).
- [x] `npx playwright test tests/e2e/routines-add-exercise-race.spec.ts --workers=1` — 1/1.
- [x] Two instrumented probes (`HomeLinkTabBarButton` + `console.log`; probe spec + instrumentation removed afterward; layout file confirmed back to Implementer's round-2 state).

## Decision

**fail** (and we are at the I↔T budget boundary).

Reasoning:
- Brief's pass criterion: "all 3 cases must pass." 2/3 — Case 1 still fails. Deterministic across two runs.
- Diagnosis is now precise: the round-2 button-level mechanism does FIRE on focused re-tap (confirmed by probe) — the issue is the guard's `childState.type === "stack"` requirement is unmet when the user arrives via URL-deep-link instead of click-through.
- Regression set is clean (crud 6/6, routine 1/1). The custom `tabBarButton` doesn't break adjacent flows.

## Recommendation to Conductor

**Budget**: Implement↔Test 2/2 used. By playbook rules, recommend escalation (`budget-exhausted`).

If the Conductor patches out-of-band (as in the routine-builder run), the surgical recipe is:

**Option A (test-side fix, smallest change, matches Read 1)** — change Case 1 to use click-through instead of `page.goto`:
```ts
// tests/e2e/bottom-tab-home-link.spec.ts, replace lines 129-135 with:
await page.getByRole("tab", { name: "Exercises" }).click();
await page.waitForURL(/\/exercises$/, { timeout: 10_000 });
await page.getByText("Bench Press", { exact: true }).first().click();
await page.waitForURL(
  new RegExp(`/exercises/${exercise.id}/progress$`),
  { timeout: 10_000 },
);
```
This exercises the same `childState.index > 0` guard the design called out, just via the route the runtime probe verified works. Confidence: HIGH that this turns Case 1 green. Risk: this admits we never tested the deep-link-rehydration path — that path remains broken in production but is now intentionally unscoped.

**Option B (feature-side fix, matches Read 2)** — relax the guard in `app/(app)/_layout.tsx:78-84` to accept the `PartialState` shape:
```ts
// Replace the guard with a more permissive check that also covers PartialState:
if (
  childState &&
  (childState.type === "stack" || childState.type === undefined) &&
  Array.isArray(childState.routes) &&
  ((typeof childState.index === "number" && childState.index > 0) ||
    childState.routes.length > 1) &&
  typeof childState.key === "string"
) { ... }
```
Catch: `PartialState` has `key` as optional (`@react-navigation/routers/src/types.tsx:57-65`). When the deep-link rehydrated state has `routes.length === 1` (just the deep route, no index frame yet to pop to) it may NOT have a stable `key` — needs verification. The probe showed `childKey=no` for the deep-link case. So this option may require also expanding what "the right child Stack key" means in the dispatch target. Confidence: MEDIUM. Risk: dispatching popToTop on an undefined `target` would silently route to the Tabs navigator (which doesn't handle POP_TO_TOP), a no-op — bad-but-not-broken.

**My recommendation**: pick Option A first (test-side, low-risk, gets us to green); file Option B as a follow-up retro item for the post-pipeline retro since it touches real user behavior on a less-common but real path (deep-link refresh → tab tap). The user's verbatim prompt didn't explicitly call out the deep-link path, so deferring it is defensible scope-management. Confidence: HIGH on Option A getting to green; MEDIUM on whether the deferred Option B is acceptable to ship without.

Counts: `{ blockers: 1 (golden-path case 1), majors: 0, minors: 0 }`. Budget: Implement↔Test 2/2 used.
