# Run: 2026-05-20_0042_exercise-block-undefined-muscles

## Bug report (verbatim)
> Lets go for the next bug. This bug happens on mobile ios only (i have not tested android yet). Info is in the print

**Visual evidence (from the screenshot)**:
- iOS native red error overlay.
- Title: `Render Error`
- Message: `Cannot read property 'length' of undefined`
- Source frame 1: `exercise-block.tsx (86:29)` — code shown:
  ```tsx
  84 |   {exercise.name}
  85 | </Text>
  86 | {(exercise.muscles.length > 0 || exercise.equipment) &&
  87 |   <Text className="mt-0.5 text-sm text-gray-500">
  88 |     {[
  89 |       exercise.muscles.length > 0
  ```
- Source frame 2: `exercise-block.tsx (28:8)` — component declaration `export function ExerciseBlock({ exercise, sets, unit, ...`
- Component Stack: `<ExerciseBlock />` at exercise-block.tsx:28, inside ScrollView Wrapper.

## Follow-up clarifications
- Android not yet tested by user. Web confirmed working (recent deploy `0ab8dda` runs fine on PWA).

## Baseline
- Branch: main
- Commit: `0ab8dda`

## Current state
- Owner: conductor
- Phase: regression report done; awaiting deploy + user PWA/iOS verification
- Status: code-ready
- Started (BRT): 2026-05-20 00:44
- Updated (BRT): 2026-05-20 00:55

## Triage decision
- Pipeline-worthy: YES.
- Rationale: render error in a shared component (`exercise-block.tsx`), iOS-only behavior, potential multi-data-source impact (the same component renders across history detail, routine detail, workout flow), regression risk on adjacent screens. Visual evidence already provided.

## Budgets remaining
- Implement ↔ Regression rounds: 2 / 2
- Diagnose redirect (from later phases): 1 / 1

## Artifacts
- [ ] repro.md
- [ ] diagnosis.md
- [ ] fix-plan.md
- [ ] implementation.md
- [ ] regression-report.md
- [ ] retro.md
- [x] transcript.md (initialized; will be appended incrementally)

## Decisions / events log
- 2026-05-20 00:42 — User reported bug with iOS error overlay screenshot
- 2026-05-20 00:44 — Triage: pipeline-worthy. Run folder bootstrapped.
- 2026-05-20 00:44 — Invoking Reproducer.
- 2026-05-20 00:46 — Custom subagent_type not auto-dispatched in this environment; Conductor inlined the role per agent spec instead. Logged for retro.
- 2026-05-20 00:47 — Reproducer phase done: repro.md written. Visual evidence yes, repro deterministic yes (conditional on stale-cache state).
- 2026-05-20 00:49 — Diagnostician phase done: diagnosis.md written. Root cause = consumer code trusts TS type + persister has no buster; iOS-only explained by AsyncStorage retention + fresh PWA today on web.
- 2026-05-20 00:50 — Fix Designer phase done: fix-plan.md written. Two-part fix (defensive reads in 4 components + persister buster). Confiança ALTA, Risco BAIXO. Awaiting approval.
- 2026-05-20 00:51 — User approved fix plan ("Vamos implementar").
- 2026-05-20 00:53 — Implementer phase: 11 edits across 6 files. First typecheck failed (replace_all also rewrote the const initializer — `const muscles = muscles ?? []`). Fixed via 3 targeted Edits restoring initializers.
- 2026-05-20 00:54 — Static gates green: typecheck (1 pre-existing measurements e2e error unrelated to fix), lint (1 pre-existing router.d.ts warning), 44/44 unit, web export 21 routes.
- 2026-05-20 00:55 — Regression report written. Decision: pass (static + adjacent build OK; iOS device replay requires user).
- 2026-05-20 00:55 — Awaiting user decision on commit + deploy.
