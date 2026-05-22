# Run: 2026-05-22_1130_chart-scroll-week-selector

## Feature prompt

Weekly chart horizontal scrolling + week selector. Today the weekly-volume strips (History mini + Progress full) show a fixed 8-week window.

- Both strips become horizontally scrollable to navigate through the user's full ISO-week history.
- Add a week selector (likely a "jump to date" affordance — tappable header showing the current window, opens a date picker). Designer call on exact UI.
- Lifetime-best overlay on the Progress chart stays anchored to the lifetime max (doesn't change as you scroll). The "you're behind your lifetime best" visual signal must stay correct under scrolling.
- ISO-week boundary semantics unchanged (Monday-Sunday, BRT).

## Baseline

- Branch: main
- Commit: cdf5f2bfb6fd55eb74659bab94cb6c209224c0c1

## Current state

- Owner: discovery
- Step: 1. Discovery
- Round (current loop): n/a
- Status: in-progress
- Started (BRT): 2026-05-22 11:30
- Updated (BRT): 2026-05-22 11:30

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
- [ ] retro.md

## Decisions / events log

- 2026-05-22 11:30 BRT — run initialized. Priority 2 of 4 open items.
