# Run: 2026-05-22_0152_end-of-session-verdict

## Feature prompt

End-of-session verdict screen. When the user taps Finish (after the existing unchecked-sets dialog, if any), show a brief summary screen: `+N PRs · Y kg total volume · Zh Wm duration`, with a list of which exercises hit a new PR. Closes the loop on the in-session `Volume to PR` strip — today, hitting Finish just navigates away with no payoff for the work tracked. Strong's equivalent is the post-workout summary. The verdict screen has a single "Done" button that navigates back to the workout tab.

## Baseline

- Branch: main
- Commit: 5267443505a471dd984e5fe4f43adba6be1bcb77 (Progress page just shipped)

## Current state

- Owner: discovery
- Step: 1. Discovery
- Round (current loop): n/a
- Status: in-progress
- Started (BRT): 2026-05-22 01:52
- Updated (BRT): 2026-05-22 01:52

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

- 2026-05-22 01:52 BRT — run initialized. Scope is tighter than Progress page; many helpers already exist (`computePrExerciseIdsThisWeek`, `computeLifetimeMaxPerExercise`, `formatVolume`).
