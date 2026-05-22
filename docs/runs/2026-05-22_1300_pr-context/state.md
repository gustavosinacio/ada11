# Run: 2026-05-22_1300_pr-context

## Feature prompt

"PRs this week" needs to show WHICH PRs + better in-app context for the numbers in general.

- The Progress page hero shows `+N PRs · Y · Z` but doesn't surface which exercises hit a PR. Either (a) make the PR count tappable → expands a list of "this week's PR rows" (exercise + new max + previous max), or (b) add a dedicated "PR'd this week" section above the per-muscle list, or (c) tag PR rows in the per-muscle list with a distinct visual treatment. Designer picks. The verdict screen already shows a similar list for the just-finished session — Progress should show the cumulative this-week version.
- Broader UX: review the screens for places where numbers are surfaced without context (e.g., "Volume to PR: 4,900 kg" — what does that mean to a user who hasn't seen the per-exercise live strip? "Max · Now · To PR" — what's "Now"?). Add inline copy / labels / a brief help affordance where helpful. Designer call on scope; minimum bar = the Progress hero PR section.

## Baseline

- Branch: main
- Commit: ccc3d7294435f5a44bc403a9e81d2fec38ad36fc

## Current state

- Owner: discovery
- Step: 1. Discovery
- Round (current loop): n/a
- Status: in-progress
- Started (BRT): 2026-05-22 13:00
- Updated (BRT): 2026-05-22 13:00

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

- 2026-05-22 13:00 BRT — run initialized.
