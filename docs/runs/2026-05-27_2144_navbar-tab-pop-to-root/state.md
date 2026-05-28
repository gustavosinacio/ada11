# Run: 2026-05-27_2144_navbar-tab-pop-to-root

## Bug report (verbatim)
i see two issues. One, when i'm inside of an axercise and i click the bottom navbar i don't get redirected to the exercises list. Navigating to that route whould be the default behavior of the navbar. use the pipeline fix skill

(Conductor note — expanded context provided to the pipeline: When viewing an exercise's progress screen (route `/exercises/[id]/progress`, in the `exercises` bottom-tab), tapping the Exercises icon in the bottom navbar does NOT navigate back to the exercises list. Expected: tapping a bottom-navbar tab should navigate to that tab's root (the exercises list) as the default navbar behavior. There is an existing `HomeLinkTabBarButton` in `app/(app)/_layout.tsx` meant to pop the focused tab's stack to root on re-tap. Possibly interacts with the recent `backHref` cross-tab nav change. Web/SPA, reproduce at localhost:8081.)

## Follow-up clarifications
- 2026-05-27 22:08 — User approved the fix plan: "Lets implement, but be ready to rollback." Rollback path: working tree only (no commits during implement); revert via `git restore` to baseline 2d5e678.

## Baseline
- Branch: main
- Commit: 2d5e67800375032244889510041f3fdaad8b8fdb

baseline_branch: main
baseline_commit: 2d5e67800375032244889510041f3fdaad8b8fdb

## Current state
- Owner: conductor
- Phase: done
- Status: done (PASS — fix in working tree; commit/deploy decision pending with user)
- Started (BRT): 2026-05-27 21:44
- Updated (BRT): 2026-05-27 23:08

## Budgets remaining
- Implement ↔ Regression rounds: 2 / 2
- Diagnose redirect (from later phases): 1 / 1

## Artifacts
- [x] repro.md
- [x] diagnosis.md
- [x] fix-plan.md
- [x] implementation.md
- [x] regression-report.md
- [x] retro.md
- [ ] transcript.md (appended incrementally)

## Decisions / events log
- 2026-05-27 21:44 — Triage: pipeline-worthy (UI bug w/o visual evidence; likely multi-file; non-trivial diagnosis). Run folder created, state initialized. Invoking Reproducer.
- 2026-05-27 21:50 — Reproducer returned `done`. Deterministic repro (2× verified). Path-dependent: A (same-tab) works; B (fresh-load) + C (cross-tab) no-op bug. backHref = red herring. Routing to Diagnostician.
- 2026-05-27 21:55 — Diagnostician returned `done`. Root cause CONFIRMED: `childState.type === "stack"` guard (_layout.tsx:80) fails on PartialState rehydration (type/key undefined) → no-op. Constraints: keep href stripped, don't pop via onPress, popToTop target unavailable on PartialState, watch backBehavior. Routing to Fix Designer.
- 2026-05-27 22:02 — Fix Designer returned `done`. Plan: `else` PartialState fallback via dismissAll/canDismiss (+ navigate(TAB_ROOTS) secondary). Conf MEDIUM, Risk LOW. APPROVAL GATE.
- 2026-05-27 22:08 — User approved ("implement, be ready to rollback"). → Implementer.
- 2026-05-27 22:30 — Implementer returned `done` w/ MAJOR deviation: dismissAll + child-Stack-gated navigate both failed at runtime (child state undefined on Path C = same as at-root). Pivoted to `useSegments()` URL gate + `router.navigate(TAB_ROOTS[name])`. Constraints held. Static green, web runtime A/B/C verified. → Regression Tester (server restarted).
- 2026-05-27 22:50 — Regression Tester returned `pass`. typecheck/lint/unit 384 + `expo export` all green; bottom-tab-home-link 5/5, exercise-progress-back-nav 1/1, exercise-progress-ia 5/5, History deep-link spot-check pass. Bug gone B/C, A unregressed. 0 regressions, 0 env noise. Flags: native unverified (manual checklist), stale dismissAll test comments.
- 2026-05-27 22:55 — Conductor corrected 3 stale `dismissAll` test comments → `router.navigate`/useSegments (grep clean). Invoking Evaluator (mandatory).
