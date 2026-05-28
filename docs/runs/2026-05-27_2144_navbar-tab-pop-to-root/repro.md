# Reproduction — 2026-05-27_2144_navbar-tab-pop-to-root

## Initial report
> when i'm inside of an axercise and i click the bottom navbar i don't get redirected to the exercises list. Navigating to that route whould be the default behavior of the navbar. use the pipeline fix skill

(Conductor expansion: while on `/exercises/[id]/progress` — in the `exercises` bottom-tab — tapping the **Exercises** navbar icon does NOT navigate to the exercises list root. Expected: tapping a bottom-tab navigates to that tab's root. An existing `HomeLinkTabBarButton` in `app/(app)/_layout.tsx` is meant to pop the focused tab's stack to root on re-tap.)

## Refinement (Reproducer-mode work)
The bug is **path-dependent**, not universal — this is the key finding the verbal report did not capture. The re-tap-to-pop behaviour works on one arrival path and silently fails on the two others:

| Arrival onto `/exercises/<id>/progress` | Re-tap Exercises pops to list? |
|---|---|
| **A.** Same-tab click-through (Exercises list → tap exercise → progress) | **YES** — works |
| **B.** Fresh page load / deep-link directly onto the progress route | **NO** — bug reproduces |
| **C.** Cross-tab from live workout (tap exercise name → progress, `backHref` set) | **NO** — bug reproduces |

This was runtime-verified twice (identical results both runs) via Playwright against the running dev server at `http://localhost:8081`. Raw observed URLs:

- **A:** before `…/exercises/<id>/progress` → after re-tap `…/exercises` (`poppedToList: true`).
- **B:** before `…/exercises/<id>/progress` → after re-tap `…/exercises/<id>/progress` (`poppedToList: false`, URL unchanged).
- **C:** before `…/exercises/<id>/progress?id=…&backHref=%2F(app)%2Fworkout%2F<sid>` → after re-tap **unchanged** (`poppedToList: false`).

**Why the feature was believed working:** the existing e2e `tests/e2e/bottom-tab-home-link.spec.ts` case 1 exercises **only Path A** (it deliberately avoids `page.goto` deep-link — see its own comment at lines 128–131: *"Deep-link rehydration → re-tap is a known follow-up"*). So the test passes while real usage (B and C) fails.

**Inferred cause (for Diagnostician to confirm — not asserted as root cause):** the focused-re-tap pop branch is gated at `app/(app)/_layout.tsx:79` on `childState.type === "stack"`. On Path A the child Stack is a fully-hydrated navigator state (`type === "stack"`, `index > 0`) so the guard passes and `StackActions.popToTop()` dispatches. On Paths B and C the `exercises` tab's child Stack is rehydrated from the URL as a **PartialState** whose `type` is `undefined` (not `"stack"`), so the guard short-circuits and the handler falls through to `onPress?.(e)` (`_layout.tsx:97`) — a no-op for an already-focused tab. The `backHref` query param (commit `2d5e678`) is **not** the cause: Path C fails for the same PartialState reason as Path B, and a deep-link without `backHref` (Path B) fails identically. The `backHref` change is a red herring for this specific symptom.

## Environment that triggers the bug
- Device / browser / build: Expo Router **web** app, `web.output: single` (SPA). Reproduced in headless Chromium (Playwright) against `npm run web` dev server at `http://localhost:8081`.
- OS / version: macOS (dev host); browser engine Chromium. Behaviour is web-routing-layer specific (PartialState rehydration on URL navigation).
- System theme: irrelevant (navigation-behaviour bug, not visual).
- Auth state: signed-in user (any confirmed account; repro seeded throwaway users via the e2e admin pattern).
- Network: online.
- Data state: needs at least one canonical exercise (used "Bench Press"); Path C also needs a live (un-ended) session whose routine contains the exercise.

## Affected screens (confirmed)
- `app/(app)/_layout.tsx:61-101` — `HomeLinkTabBarButton`, the custom `tabBarButton`. The focused-re-tap pop guard at `:78-94` (`childState.type === "stack"` at `:80`) is where Paths B/C fall through to the `:97` no-op.
- `app/(app)/exercises/[id]/progress.tsx:41-122` — the per-exercise progress screen; the nested route that should be popped off. Reads `backHref` (`:49`) — relevant only to confirm it is NOT the trigger.
- `app/(app)/exercises/index.tsx:8-72` — the exercises-list tab root (the expected pop-to destination, marker: "New exercise" `+` button at `:19-28`).
- `app/(app)/exercises/_layout.tsx:1-5` — the child `Stack` that should receive `popToTop`.

## Steps to reproduce
**Path B (fresh load / deep-link) — primary, simplest repro:**
1. Sign in (any confirmed user) on web at `http://localhost:8081`.
2. Navigate directly to `/(app)/exercises/<exerciseId>/progress` (open the URL / refresh the page while on that route). Note: on a real device PWA this is equivalent to a cold start or a browser refresh on the progress screen.
3. Tap the **Exercises** icon in the bottom navbar (the focused tab).
4. **Observed**: nothing happens — the URL stays at `/exercises/<id>/progress`; the user is NOT taken to the exercises list.
5. **Expected**: tapping the focused Exercises tab pops its stack to root → URL becomes `/exercises` and the exercises list is shown.

**Path C (cross-tab from a live workout):**
1. Sign in; open a live (un-ended) session at `/(app)/workout/<sessionId>` whose routine has an exercise.
2. Tap the exercise **name** → lands on `/exercises/<id>/progress?…&backHref=…`.
3. Tap the **Exercises** navbar icon.
4. **Observed**: URL unchanged; not redirected to the exercises list.
5. **Expected**: redirected to `/exercises`.

**Path A (same-tab click-through) — included to show the boundary; this one WORKS:**
1. Sign in; tap Exercises tab → list; tap an exercise → `/exercises/<id>/progress`.
2. Re-tap Exercises → URL becomes `/exercises`. Works as designed.

## Visual evidence
- Not applicable — navigation-behaviour bug, not visual rendering. Per the Conductor's evidence bar, a deterministic repro (exact steps + observed/expected URLs, runtime-confirmed) satisfies the bar; no user screenshot required.
- Evidence captured: Playwright URL assertions across Paths A/B/C, run twice with identical results. Throwaway driver: `/tmp/repro-navbar-pop.mjs` (not committed; outside the run folder by design). The behaviour is also directly reproducible via the existing project spec by adding a `page.goto`-based variant to `tests/e2e/bottom-tab-home-link.spec.ts`.

## Status
- Repro determinístico: **yes** (Paths B and C fail deterministically; Path A passes deterministically — two identical runs).
- Visual evidence obtained: not-applicable (non-visual navigation bug).

## Open questions (if any)
- For Diagnostician: confirm the PartialState (`type !== "stack"`) hypothesis by inspecting the `exercises` tab's `childState` shape on a fresh-load vs click-through arrival, and decide the correct fix scope — handle PartialState in the guard, vs an alternative pop strategy that does not depend on `childState.type === "stack"`. (Both Paths B and C share the same failing condition, so a single fix should cover them.)
