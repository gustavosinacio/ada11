# Run: 2026-05-30_2006_e1rm-strength-chart

## Feature prompt

Phase 2a — e1RM strength-progress chart on the Progress page.

GOAL: Add a curated multi-exercise estimated-1RM (e1RM) trend chart to the Progress page so the owner can see "am I lifting heavier over time" — the strength complement to the weekly per-muscle VOLUME chart that just shipped (run 2026-05-30_0126_bodyweight-volume-per-muscle). Second half of the owner's "I want to see progress" goal.

SCOPE (this run = Phase 2a ONLY):
- New Progress-page section: a multi-line chart, one line per exercise, showing that exercise's best e1RM per session (or per week) over time, oldest left.
- e1RM = Epley via existing `epley1RM(weight, reps)` in `src/utils/formulas.ts` (used by `app/(app)/exercises/[id]/progress.tsx`). Reuse it.
- e1RM MUST be computed from LOGGED weight, NOT bodyweight-adjusted (hard consistency rule shipped in Phase 0 — "Invariant D": a 0-weight bodyweight set produces a volume point but NO e1RM point). The chart follows the same rule: bodyweight-only movements (weight=0) produce no e1RM points.
- Exercise selection = AUTO: auto-populate with the owner's MOST-PERFORMED exercises (top N by sessions/sets appeared in). Derive from existing data — NO new DB column, NO migration.
- SELECTABLE lines with check-all/uncheck-all, mirroring the muscle chart UX.
- REUSE `<MultiSeriesChart>` (`src/components/multi-series-chart.tsx`, created in Phase 1) if it fits; Discovery evaluates reuse-vs-small-extension. Strongly prefer reuse.

OUT OF SCOPE (tracked in docs/features.md "## Open"):
- FAVORITES (Phase 2b): favorite toggle on exercise detail + per-user `user_exercise_favorites(user_id, exercise_id)` join table + RLS — separate run. This run = auto-selection ONLY.
- Bodyweight leverage factors, secondary-muscle attribution, "hard sets/week" dose metric.

CONTEXT:
- Owner is sole user. Dates BRT (today 2026-05-30).
- Data source: `useLifetimeWeeklyVolume()` / `WeeklyVolumeRow[]` (now carries `exercises.equipment`); per-exercise muscle/equipment via `useAllExercises`. Each WeeklyVolumeRow has weight, reps, exercise_id, session_id, sessions.started_at.
- `app/(app)/exercises/[id]/progress.tsx` already plots a single-exercise e1RM trend — study its e1RM computation as the reference kernel; it computes e1RM inline and was touched in Phase 0 with a two-variable w/effW split. Read its CURRENT (post-3c00d8e) state.
- Decide best-e1RM per SESSION vs per WEEK on the x-axis (Designer decides with rationale).
- No DB migration expected (confirm in Discovery).

PROCESS NOTE (carry-in lesson from the last run's retro): produce an EXHAUSTIVE inventory of where e1RM is computed today (close-the-set grep) so no site is missed; if a shared e1RM helper is created, wire ALL its call sites in one pass.

## Baseline
- Branch: main
- baseline_branch: main
- Commit: 3c00d8e02ac15eedf2dcd42e1b06909fef7c669a
- baseline_commit: 3c00d8e02ac15eedf2dcd42e1b06909fef7c669a

## Current state
- Owner: conductor
- Step: DONE (shipped — summary + Evaluator + vault archive + features.md Done complete; committing)
- Round (current loop): n/a (all loops closed)
- Status: done
- Started (BRT): 2026-05-30 20:06
- Updated (BRT): 2026-05-30 21:30
- Note: Tester r1 FAIL was test-only — feature PASS (444/444, e2e 3/3, line renders + trends up). The new e1RM legend chip broke `progress-page.spec.ts:278`'s fragile `getByText(name).first()`; fix = role+name locator per sibling :448. Feature code is correct.

## Budgets remaining
- Design ↔ Validate rounds: 2 / 3 (loop CLOSED at GO after round 1)
- Implement ↔ Review rounds: 1 / 2 (loop CLOSED at PASS after round 1)
- Implement ↔ Test rounds: 0 / 2 (loop CLOSED at PASS after round 2)
- Implementer soft-callbacks: 2 / 2

## Artifacts produced
- [x] discovery.md
- [x] design-v1.md
- [x] validation-v1.md
- [x] implementation.md
- [x] review-v1.md
- [x] test-report-v1.md (round 1: FAIL — test-only locator regression)
- [x] test-report-v2.md (round 2: PASS)
- [x] final-summary.md
- [x] retro.md (Evaluator)
- [x] feedback/* appended (all 6 agents + evaluator self)
- [x] archived to vault + README index updated
- [x] docs/features.md: e1RM chart moved to "## Done" (Phase 2b favorites stays Open)
- [ ] validation-v1.md
- [ ] implementation.md
- [ ] review-v1.md
- [ ] test-report-v1.md
- [ ] final-summary.md
- [ ] retro.md (post-run, filled in by owner)

## Decisions / events log
- 2026-05-30 20:06 — Run initialized. Baseline main @ 3c00d8e (the Phase 0/1 ship commit). Builds on the just-shipped `<MultiSeriesChart>` + bodyweight-aware kernel. e1RM stays logged-weight (Invariant D carried forward). Auto-selection only; favorites (2b) explicitly deferred.
