# Run: 2026-05-22_1000_set-row-declutter

## Feature prompt

Set row declutter — move RPE + notes behind a per-row menu. Today the set row crams everything inline (previous, weight, reps, RPE, check). RPE isn't used for every exercise or every set; the inline input is noise most of the time. Same for notes.

Spec:
- Add a small icon button on the set row, immediately to the right of the check button. Tapping it opens a per-row menu (bottom sheet or expandable inline panel — Designer call).
- The menu contains: RPE selector + Notes field.
- **RPE is a selector, not an input**, with the standard Strong-style values: `10, 9.5, 9, 8.5, 8, 7.5, 7, 6.5, 6, 5.5, 5` (Designer can refine the range — these are the common ones).
- Notes input is moved from the row into the menu.
- Default visual state of the row: weight + reps + previous + check only. Cleaner default.
- The menu icon should show a subtle indicator when there's data behind it (RPE or note set), so the user knows there's something to expand.

## Baseline

- Branch: main
- Commit: 8b9414153a2c9f5ab71f2f15d3020b468d2b76b5

## Current state

- Owner: discovery
- Step: 1. Discovery
- Round (current loop): n/a
- Status: in-progress
- Started (BRT): 2026-05-22 10:00
- Updated (BRT): 2026-05-22 10:00

## Budgets remaining

- Design ↔ Validate rounds: 3 / 3
- Implement ↔ Review rounds: 2 / 2
- Implement ↔ Test rounds: 2 / 2
- Implementer soft-callbacks: 2 / 2

## Artifacts produced

- [ ] discovery.md
- [ ] design-v1.md
- [ ] validation-v1.md
- [ ] implementation.md
- [ ] review-v1.md
- [ ] test-report-v1.md
- [ ] final-summary.md
- [ ] retro.md (post-run, filled in by owner)

## Decisions / events log

- 2026-05-22 10:00 BRT — run initialized. User flagged this as priority 1 of three new items.
