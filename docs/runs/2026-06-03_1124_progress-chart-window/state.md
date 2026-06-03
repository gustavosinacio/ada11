# Run: 2026-06-03_1124_progress-chart-window

## Feature prompt
The progress graphs are showing all historycal data. We don't need this. We need to add a date picker and default the date to the selected max-volume window in the profile page.

## Baseline
- Branch: main
- baseline_branch: main
- Commit: 25db98beb5bb219b3405b7d2fa75a13849665d92
- baseline_commit: 25db98beb5bb219b3405b7d2fa75a13849665d92

> NOTE (pre-existing uncommitted changes): the working tree already carries an
> uncommitted cache-buster fix from a prior task — 5 source files
> (`src/lib/query-client.ts`, `src/utils/progress-page-math.ts`,
> `src/utils/weekly-volume-strip-math.ts`, `src/hooks/use-progress-page.ts`,
> `app/(app)/history/week/[isoWeek].tsx`) plus a rebuilt `dist/`. These are
> UNRELATED to this feature. Conductor recommends committing them before the
> Implement stage so this run's diff stays clean. The Evaluator should treat the
> `row.exercises?.equipment` guards + buster bump as out-of-run noise if still
> present at diff time.

## Current state
- Owner: conductor
- Step: 7. Finalize — COMPLETE (Evaluator scored all 6 agents; run archived to vault; README indexed)
- Round (current loop): n/a (all gates passed round 1)
- Status: done
- Started (BRT): 2026-06-03 11:24
- Updated (BRT): 2026-06-03 12:18

## Budgets remaining
- Design ↔ Validate rounds: 3 / 3
- Implement ↔ Review rounds: 2 / 2
- Implement ↔ Test rounds: 2 / 2
- Implementer soft-callbacks: 2 / 2

## Artifacts produced
- [x] discovery.md
- [x] design-v1.md
- [x] validation-v1.md (GO — 0 blockers / 1 major / 4 minors)
- [x] implementation.md (12 files; typecheck/lint clean; vitest 485/485)
- [x] review-v1.md (PASS — 0 blockers / 0 majors / 2 minors)
- [x] test-report-v1.md (PASS — unit 485/485; new e2e 3/3; regression 21/21)
- [x] final-summary.md
- [ ] retro.md (post-run, filled in by owner)

## Follow-up clarifications
- 2026-06-03 11:30 — Human resolved the 3 escalated unknowns:
  - **U1 (picker type)** → **Discrete weeks selector**. Reuse `MAX_VOLUME_WINDOW_OPTIONS` (`0/10/20/30/40/50`); NO calendar/date-picker dependency. "date picker" = time-range selector.
  - **U2 (scope)** → **Progress TAB only**: `<WeeklyMuscleVolumeSection>` + `<E1rmStrengthSection>`. Per-exercise screen (`exercises/[id]/progress.tsx`) and the 8-bar strip are OUT of scope.
  - **U4 (statefulness)** → **View-only / ephemeral local state**, default-seeded from `useMaxVolumeWindowWeeks()`. Do NOT write back to the pref.
- Designer should adopt Discovery's recommended defaults for the remaining unknowns: U3 one page-level control threaded into both sections, U5 filter at top of each presenter row-loop (axis auto-shrinks via `isoWeeksBetween`), U6 keep the selector mounted independent of each chart's empty/null branch, U7 reuse `MAX_VOLUME_WINDOW_OPTIONS` verbatim, U9 strip out of scope.

## Decisions / events log
- 2026-06-03 11:24 — Conductor: run scaffolded from _template; baseline recorded; Discovery invoked.
- 2026-06-03 11:24 — Conductor: flagged pre-existing uncommitted cache-buster fix in working tree (unrelated to this run).
