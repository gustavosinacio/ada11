# Run: 2026-05-30_0126_bodyweight-volume-per-muscle

## Feature prompt

Two-phase feature for the Progress page.

PHASE 0 — Make the canonical volume kernel bodyweight-aware (applies to EVERY volume surface, not just the new chart — this is a deliberate decision by the owner to preserve the app's "same volume number everywhere" invariant).

- Today the volume kernel is `weight * reps` guarded by `w > 0 && r > 0` (see `src/utils/volume-target.ts` `sumLiveVolume`/`sumPastVolume`, and `src/utils/progress-page-math.ts`). Bodyweight exercises (equipment = "bodyweight", per `src/db/types.ts` Equipment) are logged with weight = 0, so they currently contribute ZERO volume everywhere — that is the bug to fix.
- New behavior: a set on a bodyweight-equipment exercise contributes `(bodyweightKgAsOfSession + addedLoadKg) * reps`, where `addedLoadKg` is the logged `weight` (0 for unweighted, >0 for weighted pull-ups/dips). Non-bodyweight exercises are unchanged.
- Bodyweight as-of-session = the user's bodyweight from `measurement_entries` (`measured_at`, `weight_kg` — both nullable-aware: `weight_kg` can be NULL on circumference-only entries, so pick the nearest PRIOR entry with a non-null `weight_kg`). Define and document a fallback when no weigh-in precedes the session (candidate: nearest-later entry, else treat as 0 / skip — Design decides, but state it explicitly).
- This requires the volume queries to know each set's exercise equipment and the user's bodyweight timeline. `listWeeklyVolumeRows` in `src/api/stats.ts` currently selects only sets+sessions; it (and/or the kernel callers) will need exercise equipment + a measurements fetch. Design must specify the data-plumbing.
- BLAST RADIUS / RISK (call out and regression-test): this retroactively changes historical volume for bodyweight movements across history rows, the verdict screen, weekly strip, per-exercise progress, AND PR/max detection — so it can CREATE or ERASE past PRs and shift max-volume numbers. Regression Tester must cover that PRs/max for bodyweight exercises change as expected and that non-bodyweight numbers are byte-for-byte unchanged.
- Leverage factors (push-up ≈ 0.64 BW etc.) are OUT OF SCOPE — full-bodyweight approximation only. Tracked in docs/features.md "## Open".

PHASE 1 — New "weekly volume per muscle group" chart on the Progress page, and REMOVE the existing per-session volume chart.

- Remove `SessionVolumeChartSection` (`src/components/session-volume-chart-section.tsx`, mounted in `app/(app)/progress/index.tsx`) and its presenter `presentSessionVolumeChart` in `src/utils/progress-page-math.ts` (plus its tests). The new chart supersedes it.
- New chart: per-muscle-group weekly volume over time. Bucket WEEKLY (ISO week), not per-session — matches how hypertrophy volume is dosed. Muscle attribution = primary muscle only (`muscles[0]`, via existing `groupExercisesByPrimaryMuscle`); secondary-muscle fractional attribution is OUT OF SCOPE (tracked in "## Open").
- The 7 muscle groups come from `MUSCLE_GROUPS` in `src/db/types.ts` (Chest, Upper back, Lower back, Shoulders, Arms, Legs, Core).
- UI: SELECTABLE muscle lines (multi-line chart) with a check-all / uncheck-all control. Owner explicitly chose selectable lines over stacked area or small-multiples. Reuse the existing `<ProgressChart>` where it fits, or extend it for multi-series — Design decides.
- Volume per muscle MUST use the Phase 0 bodyweight-aware kernel (pull-ups feed Upper back / Arms volume, etc.).
- Owner motivation for keeping volume (beyond progress): volume is the primary hypertrophy driver, so the chart's job is to make a silent drop in weekly per-muscle volume visible. Consistency-over-time framing is a separate FUTURE concern, not this build.

Context: owner is the sole user; today's split is PPL but splits change over time (so per-muscle grouping is preferred over per-workout-type grouping because muscle groups are stable across split changes). Dates are BRT. Both phases ship together. Phase 0 is foundational and must land before/with Phase 1 since Phase 1 depends on the corrected kernel.

## Baseline
- Branch: main
- baseline_branch: main
- Commit: 5a2382b7135d19b488b52ad23e6f180edb9432a9
- baseline_commit: 5a2382b7135d19b488b52ad23e6f180edb9432a9

## Current state
- Owner: conductor
- Step: DONE (shipped — final-summary + Evaluator + vault archive complete)
- Round (current loop): n/a (all loops closed)
- Status: done
- Started (BRT): 2026-05-30 01:26
- Updated (BRT): 2026-05-30 03:25
- Note: Tester round 1 FAIL was test-only (e2e seeds non-existent "Pull-up"; use "Chin-up"). Feature verified working live (2,560 kg Upper back). 2 chart-scroll-week-selector e2e failures are PRE-EXISTING (proved via stash to baseline), NOT this run's regression — out of scope.
- Note: Design↔Validate closed GO at round 2. Carry-in must-fix for Implementer: MAJ-3-NEW (wire `history/index.tsx` groupSessionVolumes with `{ measurements }` + mount useMeasurements) — see validation-v2.md.

## Budgets remaining
- Design ↔ Validate rounds: 1 / 3 (loop CLOSED at GO after round 2)
- Implement ↔ Review rounds: 1 / 2 (loop CLOSED at PASS after round 1)
- Implement ↔ Test rounds: 0 / 2 (loop CLOSED at PASS after round 2)
- Implementer soft-callbacks: 2 / 2

## Artifacts produced
- [x] discovery.md
- [x] design-v1.md
- [x] validation-v1.md
- [x] design-v2.md
- [x] validation-v2.md
- [x] implementation.md
- [x] review-v1.md
- [x] test-report-v1.md (round 1: FAIL — test-only)
- [x] test-report-v2.md (round 2: PASS)
- [x] final-summary.md
- [x] retro.md (Evaluator)
- [x] feedback/* appended (all 6 agents + evaluator self)
- [x] archived to vault + README index updated
- [x] docs/features.md: Phase 0 + Phase 1 moved to "## Done"
- [ ] implementation.md
- [ ] review-v1.md
- [ ] test-report-v1.md
- [ ] final-summary.md
- [ ] retro.md (post-run, filled in by owner)

## Decisions / events log
- 2026-05-30 01:26 — Run initialized. Baseline main @ 5a2382b. Owner pre-confirmed two decisions before launch: (1) bodyweight-as-load applied CANONICALLY (every volume surface), not scoped to the new chart, to preserve the single-kernel consistency invariant; (2) chart uses selectable muscle lines + check-all/uncheck-all. Leverage factors + secondary-muscle attribution + e1RM chart + favorites are deferred to docs/features.md "## Open".
