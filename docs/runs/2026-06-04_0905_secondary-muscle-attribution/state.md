# Run: 2026-06-04_0905_secondary-muscle-attribution

## Feature prompt
Secondary-muscle volume attribution — fractional credit to secondary muscles (bench → partial Arms/Shoulders) instead of primary-only `muscles[0]`. (refines Phase 1)

## Baseline
- Branch: main
- baseline_branch: main
- Commit: e098314cc30eb5e4d809fb48ebb18dfb117c09ff
- baseline_commit: e098314cc30eb5e4d809fb48ebb18dfb117c09ff

> Working tree clean at baseline except pre-existing screenshot PNG noise in
> OTHER runs' folders (+ favorites run state.md). Not part of this run.

## Current state
- Owner: conductor
- Step: 1. Discovery → DEFERRED by owner (closed before Design)
- Round (current loop): n/a
- Status: done (outcome: deferred/cancelled)
- Started (BRT): 2026-06-04 09:05
- Updated (BRT): 2026-06-04 09:14

## Budgets remaining
- Design ↔ Validate rounds: 3 / 3
- Implement ↔ Review rounds: 2 / 2
- Implement ↔ Test rounds: 2 / 2
- Implementer soft-callbacks: 2 / 2

## Artifacts produced
- [x] discovery.md
- [~] design-v1.md (n/a — deferred before Design)
- [~] validation-v1.md (n/a — deferred)
- [~] implementation.md (n/a — deferred)
- [~] review-v1.md (n/a — deferred)
- [~] test-report-v1.md (n/a — deferred)
- [x] final-summary.md (outcome: deferred)
- [ ] retro.md (post-run, filled in by owner)

## Follow-up clarifications
- 2026-06-04 09:14 — Human DEFERRED the feature (all 3 questions → "defer"). Rationale: the prompt's premise is data-falsified (secondaries don't exist in `muscles[]`; 81/95 single-muscle), so the feature is a subjective per-exercise muscle-fraction authoring task (~14 multi-muscle compounds), not a code change — not worth the data investment / fraction-value subjectivity right now. Run closed before Design. Outcome: deferred. No code/migration/deploy. Feature #2 stays OPEN in docs/features.md, annotated with this finding + the single-seam location for whenever it's revisited.

## Decisions / events log
- 2026-06-04 09:05 — Conductor: run scaffolded; baseline e098314 (clean). Feature = secondary-muscle fractional attribution (refines Phase 1's per-muscle charts). Likely needs a data-model decision (how to store secondary muscles + fractions) + a backfill migration → prod-DB approval gate expected. Both the tonnage AND hard-sets per-muscle metrics share the `muscles[0]` attribution path (from the just-shipped hard-sets run) — #2 must change that ONE shared site so both metrics get fractional attribution. Discovery invoked.
