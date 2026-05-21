# Run: 2026-05-20_2034_soft-deleted-exercises-in-history

## Feature prompt
"Soft-deleted exercises should remain fully visible in past workout history..."

## Baseline
- Branch: main
- Commit: 52d7a76739d3e27ab07b1fccefc4f5397dd666d9

## Current state
- Owner: conductor
- Step: Finalized → committing + deploying
- Round (current loop): n/a
- Status: done (pipeline)
- Updated (BRT): 2026-05-20 22:08

## Budgets remaining
- Design ↔ Validate rounds: 2 / 3 (closed at `go`)
- Implement ↔ Review rounds: 1 / 2 (closed at `pass`)
- Implement ↔ Test rounds: 0 / 2 (closed at `pass` on round 2)
- Implementer soft-callbacks: 2 / 2 (none used)

## Decisions / events log
- 2026-05-20 20:38 BRT — Discovery `done`.
- 2026-05-20 20:41 BRT — Design v1 `done`.
- 2026-05-20 20:43 BRT — Validation v1 `go` (0 / 1 / 4).
- 2026-05-20 21:13 BRT — Implementer `done`.
- 2026-05-20 21:15 BRT — Reviewer `pass` (0 / 0 / 4 advisory).
- 2026-05-20 21:30 BRT — Tester `fail` (e2e flake, not feature bug).
- 2026-05-20 21:58 BRT — Implementer fix `done` (test-only; 13/13 under stress).
- 2026-05-20 22:06 BRT — Tester re-test `pass` (5/5 under --repeat-each=5).
- 2026-05-20 22:08 BRT — Conductor finalized. Commit + deploy next.
