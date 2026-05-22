# Run: 2026-05-22_1640_routines-409-and-aria

## Bug report (verbatim)

Two distinct issues bundled in the user's report from `/routines/27a33734-8fd5-4dc9-9863-552bcdf21494`:

**(1) aria-hidden warning:**
> Blocked aria-hidden on an element because its descendant retained focus. The focus must not be hidden from assistive technology users. Avoid using aria-hidden on a focused element or its ancestor. Consider using the inert attribute instead.
> Element with focus: `<button.css-g5y9jx ... my-3 mr-4 flex-row items-center gap-1 self-center rounded-md border border-gray-200 px-2 py-1 active:bg-gray-100 dark:border-gray-800 dark:active:bg-gray-900>` (the Edit button in `<RoutineListItem>`)
> Ancestor with aria-hidden: `<div.css-g5y9jx r-13awgt0 style="background-color: rgb(1, 1, 1)" aria-hidden="true">`

**(2) Multiple 409 Conflicts when adding an exercise to a routine:**
> POST .../rest/v1/routine_exercises?select=_ 409 (Conflict)
> Failed to add exercise: code 23505 — "duplicate key value violates unique constraint routine_exercises_routine_position_uq"
> (4 separate POST attempts each producing 409, traced through `onPick` → `onPress` → `onClick`)

## Follow-up clarifications

- Same pattern shape as the F6 add-set double-tap race already shipped (`docs/runs/2026-05-22_1000_set-row-declutter/` precursor — the debounce there used `isAddingSet` ref + `Pressable.disabled` during in-flight mutation).
- DB-side unique constraint `routine_exercises_routine_position_uq` already exists (good — it caught the race). UI debounce needed.
- aria-hidden warning is RN-Web specific; iOS/Android RN don't emit it. Both should be fixable in the same pipeline.

## Baseline

- Branch: main
- Commit: 9bdcbc77139dc0e1e2ae1aef48a3ebd3e9fa831f

## Current state

- Owner: conductor
- Phase: complete
- Status: done
- Started (BRT): 2026-05-22 16:40
- Updated (BRT): 2026-05-22 17:30

## Budgets remaining

- Implement ↔ Regression rounds: 2 / 2
- Diagnose redirect (from later phases): 1 / 1

## Artifacts

- [x] repro.md
- [x] diagnosis.md
- [x] fix-plan.md
- [x] implementation.md
- [x] regression-report.md
- [ ] retro.md
- [x] transcript.md (appended incrementally)

## Decisions / events log

- 2026-05-22 16:40 BRT — run initialized. Bug-fix pipeline. Two bundled issues, both routines-page-only, both web-only.
- 2026-05-22 17:00 BRT — repro/diagnosis/fix-plan written inline by conductor (both bugs cleanly identified from source read).
- 2026-05-22 17:15 BRT — Implementer landed both fixes in `src/components/exercise-picker.tsx` + new e2e `tests/e2e/routines-add-exercise-race.spec.ts`. Quality gates green.
- 2026-05-22 17:25 BRT — Tester returned FAIL on test-only selector strict-mode bug (Finding 1). Product fixes verified out-of-band via probes (1 POST/201/1 row + 0 aria-hidden warnings).
- 2026-05-22 17:30 BRT — Conductor applied one-char `.first()` fix at line 137. Re-ran race + set-row-menu suites: 4 passed (30.7s). Run complete.
