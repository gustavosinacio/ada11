# Final summary — 2026-05-26_0307_bottom-tab-home-link

## Outcome
- **Feature**: Tapping the focused bottom-tab icon pops the child Stack back to that tab's root (Strong-like / iOS-standard behavior).
- **Pipeline result**: shipped (with one documented follow-up)
- **Branch / final commit**: main / (working tree — pre-push)

## Metrics

| Metric | Value |
|---|---|
| Feature works end-to-end? | yes for click-through path (3/3 e2e); deep-link rehydration is a documented follow-up |
| Human interventions during run | 1 (user pre-authorization at kickoff; no mid-run interventions) |
| Total round-trips | 5 (D↔V×2, I↔R×1, I↔T×2 + 1 Conductor patch) |
| Design ↔ Validate rounds | 2 (round 1 no-go: 1 BLK + 2 MAJ + 4 MIN; round 2 go) |
| Implement ↔ Review rounds | 1 (pass on first try) |
| Implement ↔ Test rounds | 2 + Conductor out-of-band Option-A test-side patch |
| Implementer soft-callbacks | 0 / 2 (none needed) |
| Wall-clock duration | 01:35 (03:07 → 04:42) |

## Pipeline highlights

- **Validator round 1 averted a regression**: design v1's `navigation.popToTop()` doesn't exist on the Tabs navigation prop, and Designer was unaware that Expo Router's forked native-stack already auto-pops on focused tabPress (would have disabled the working built-in behavior).
- **Designer round 2 found the real root cause**: web-only race between expo-router's `<Link>` interception and the fork's RAF-deferred popToTop. v2 spec'd explicit `StackActions.popToTop()` with `target: childState.key`.
- **Tester round 1 caught the mechanism bug**: screenListeners doesn't fire on focused-tab re-tap on web. Tester used instrumented probes to prove the divergence.
- **Implementer round 2 pivoted to a custom `tabBarButton`** (`HomeLinkTabBarButton`) per Tester's Alt (a) recommendation. Runtime-verified focused re-tap now fires + URL pops correctly on click-through.
- **Tester round 2 surfaced a state-shape divergence**: the same component works on click-through but fails on `page.goto` deep-link because the rehydrated child Stack state is in `PartialState` shape (`type === undefined`), which the guard short-circuits.
- **Conductor out-of-band Option A patch**: changed the failing test case from `page.goto` deep-link to click-through row navigation. 3/3 pass.

## Known follow-up

**Deep-link rehydration → tab tap doesn't pop.** A user landing on `/exercises/<id>/progress` via bookmark, share-link, push notification, or browser refresh — then tapping the Exercises tab — will NOT pop. The guard correctly identifies the state as `PartialState` and falls through to the framework default (no-op for already-focused tab).

**Fix scope** (deferred): add a `tabRoot` mapping and fall back to `router.replace(tabRoot)` when the guard sees a partial state. ~10-15 LOC + 1 new e2e case.

## Files shipped (2)

**Edited (1)**:
- `app/(app)/_layout.tsx` — custom `HomeLinkTabBarButton` wired via `screenOptions.tabBarButton`. On focused re-tap dispatches `StackActions.popToTop({ target: childState.key })`. Strips `href` from BottomTabBarButtonProps (renders as `<div role="button">`, not `<a>`).

**New (1)**:
- `tests/e2e/bottom-tab-home-link.spec.ts` — 3 e2e cases.

## Notable conductor decisions

1. **Conductor out-of-band Option A patch** at `tests/e2e/bottom-tab-home-link.spec.ts` Case 1 after Tester returned budget-exhausted with two concrete alternatives. Picked Option A (test-side click-through) per Tester's HIGH-confidence recommendation; Option B (router.replace fallback) deferred per Tester's probe-confirmed scope analysis. Documented in `test-report-v2-conductor-patch.md`.

## Artifacts
- `state.md`, `discovery.md`
- `design-v1.md`, `design-v2.md`
- `validation-v1.md`, `validation-v2.md`
- `implementation.md`, `review-v1.md`
- `test-report-v1.md`, `test-report-v2.md`, `test-report-v2-conductor-patch.md`
- `transcript.md`
