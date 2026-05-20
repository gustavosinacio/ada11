# Run: <run-id>

## Feature prompt
<paste the user's feature prompt verbatim here>

## Baseline
- Branch: <branch at start of run>
- Commit: <git rev-parse HEAD at start>

## Current state
- Owner: <agent name | conductor>
- Step: <pipeline step name>
- Round (current loop): <e.g. "Design↔Validate round 1">
- Status: <queued | in-progress | blocked-question | escalated | done>
- Started (BRT): <YYYY-MM-DD HH:mm>
- Updated (BRT): <YYYY-MM-DD HH:mm>

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
- <BRT timestamp> — <event>
