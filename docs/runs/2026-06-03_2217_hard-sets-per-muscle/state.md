# Run: 2026-06-03_2217_hard-sets-per-muscle

## Feature prompt
Add a "hard sets per muscle per week" view to the Progress per-muscle chart, AUGMENTING (not replacing) the existing weekly tonnage chart. Decided in the dose-metric memo (open feature #3, "augment"): hard sets per muscle/week is the literature-aligned hypertrophy dose metric; tonnage stays as the overload signal. Definition: count each non-warmup working set = 1 hard set per its muscle, bucketed by ISO week, same attribution + axis/zero-fill as the tonnage chart. Likely a kg↔sets toggle (or second series) on <WeeklyMuscleVolumeSection>. No new query (reuses useLifetimeWeeklyVolume); no migration.

## Baseline
- Branch: main
- baseline_branch: main
- Commit: 80621ba9c5b2925d1c7d4b1e3915e5c4dfe3c394
- baseline_commit: 80621ba9c5b2925d1c7d4b1e3915e5c4dfe3c394

> Working tree clean at baseline except pre-existing screenshot PNG noise in
> OTHER runs' folders (+ favorites run state.md). Not part of this run.
> Decision memo (the spec source): SecondBrainground/personal/ada11/
> 2026-06-03_2205_hard-sets-vs-tonnage-per-muscle-dose-metric.md

## Current state
- Owner: conductor → evaluator
- Step: 7. Finalize (Test PASS; final-summary + Evaluator)
- Round (current loop): n/a (D↔V 1 go; I↔R 1 pass; I↔T 1 pass)
- Status: done
- Started (BRT): 2026-06-03 22:17
- Updated (BRT): 2026-06-03 23:20

## Budgets remaining
- Design ↔ Validate rounds: 3 / 3
- Implement ↔ Review rounds: 2 / 2
- Implement ↔ Test rounds: 2 / 2
- Implementer soft-callbacks: 2 / 2

## Artifacts produced
- [x] discovery.md
- [x] design-v1.md
- [x] validation-v1.md (GO — 0 blockers / 1 major / 4 minors)
- [x] implementation.md (4 files; typecheck/lint clean; vitest 515/515; 13 tonnage tests unchanged)
- [x] review-v1.md (PASS — 0 blockers / 0 majors / 2 minors)
- [x] test-report-v1.md (PASS — unit 515/515; teeth proven RED→GREEN; regression 54/54)
- [x] final-summary.md
- [ ] retro.md (post-run, filled in by owner)

## Follow-up clarifications
- 2026-06-03 22:26 — Human resolved the 2 escalated unknowns:
  - **U3 (dropset)** → **Count WORKING sets only**: one hard set per `set_type === 'working'`, non-dangling, in-window row. Dropset rows do NOT add a count (a dropset extends one effort). Cheap — `set_type` is on `WeeklyVolumeRow`; NO stats.ts/SELECT change. NOTE: this INTENTIONALLY diverges from tonnage on dropsets (tonnage counts working+dropset rows with w>0; hard-sets counts working-only) — the shared scaffold must parameterize the per-row INCLUSION filter, not just the accumulator.
  - **U2 (UI)** → **kg↔sets segmented toggle on the ONE existing chart** (`<WeeklyMuscleVolumeSection>`), ephemeral `useState`, defaults to **kg**, shares the per-muscle line-selection state. Mirror `<ProgressWindowSelector>`'s segmented idiom. NOT a second chart.
- LOCKED correctness (U1): the sets reduce must NOT inherit the tonnage `w>0 && r>0` guard — count a qualifying working row regardless of load/reps (a bodyweight set weight=0 IS a hard set). 
- Designer adopts Discovery defaults for the rest: U4 count a working row even if reps=0/null (user logged it); U5 shared `bucketByMuscleWeek` scaffold parameterized by (per-row include-predicate + per-row contribution); U6 sets shares the SAME `muscles[0]` attribution path as tonnage so feature #2 changes one place; U7 integer unitless formatter + header label for sets mode ("Weekly hard sets per muscle"); U8 the drop-all-zero branch is harmless (kept); U9 default kg, ephemeral non-persisted mode.

## Decisions / events log
- 2026-06-03 22:17 — Conductor: run scaffolded; baseline 80621ba (clean). Feature = "hard sets/week" per-muscle mode (augment), per the #3 dose-metric decision memo. No migration expected. Discovery invoked. Sibling open feature #2 (secondary-muscle attribution) still deferred; its attribution must later weight BOTH tonnage and hard-sets.
