# Run: 2026-05-20_0302_exercise-progress-graph

## Feature prompt
Item #5 from `docs/features.md`:

> "when clicking on an exercise, i want to see a progress graph showing important info"

## Baseline
- Branch: main
- Commit: a93ca686d3d378c1086ca122e8386f9eeab25f7a

## Current state
- Owner: conductor
- Step: Finalized → committing + deploying
- Round (current loop): n/a
- Status: done (pipeline); commit + deploy pending
- Started (BRT): 2026-05-20 03:02
- Updated (BRT): 2026-05-20 03:30

## Budgets remaining
- Design ↔ Validate rounds: 2 / 3 (closed at `go`)
- Implement ↔ Review rounds: 1 / 2 (closed at `pass`)
- Implement ↔ Test rounds: 1 / 2 (closed at `pass`)
- Implementer soft-callbacks: 2 / 2 (none used)

## Artifacts produced
- [x] discovery.md, design-v1.md, validation-v1.md
- [x] implementation.md, review-v1.md, test-report-v1.md
- [x] final-summary.md
- [ ] retro.md (post-run, owner)

## Decisions / events log
- 2026-05-20 03:02 BRT — Run folder created.
- 2026-05-20 03:04 BRT — Discovery `done`.
- 2026-05-20 03:06 BRT — Design v1 `done` (IA option A4).
- 2026-05-20 03:08 BRT — Validation v1 `go` (0 / 1 / 5). MAJ-1 folded into Implementer.
- 2026-05-20 03:15 BRT — Implementer `done` (4 files; gates green; MAJ-1 + MIN-1 + MIN-2 all folded).
- 2026-05-20 03:17 BRT — Reviewer `pass` (0 / 0 / 3).
- 2026-05-20 03:28 BRT — Tester `pass` (golden + 2/2 new e2e + adjacent green).
- 2026-05-20 03:30 BRT — Conductor finalized: `final-summary.md` written. Archiving + commit + deploy next.
