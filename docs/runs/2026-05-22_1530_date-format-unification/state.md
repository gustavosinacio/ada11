# Run: 2026-05-22_1530_date-format-unification

## Feature prompt

All dates can be shown as only the month and day, but if the date belongs to a previous year, the year needs to be included in the date. This is noticeable especially on the history and progress screens.

## Baseline

- Branch: main
- Commit: f949f0177e734b914cc9d7ab253f6ed808f6bd7f

## Current state

- Owner: discovery
- Step: 1. Discovery
- Status: in-progress
- Started (BRT): 2026-05-22 15:30
- Updated (BRT): 2026-05-22 15:30

## Budgets remaining

- Design ↔ Validate rounds: 3 / 3
- Implement ↔ Review rounds: 2 / 2
- Implement ↔ Test rounds: 2 / 2
- Implementer soft-callbacks: 2 / 2

## Artifacts

- [ ] discovery.md
- [ ] design-v1.md
- [ ] validation-v1.md
- [ ] implementation.md
- [ ] review-v1.md
- [ ] test-report-v1.md
- [ ] final-summary.md
- [ ] retro.md

## Decisions / events log

- 2026-05-22 15:30 BRT — run initialized. Earlier F5 already shipped year-suffix for History session-list dates (`session-summary-row.tsx`); this run extends the pattern app-wide and may drop the weekday prefix per user's "only month and day" wording.
