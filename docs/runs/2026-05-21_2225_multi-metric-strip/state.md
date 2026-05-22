# Run: 2026-05-21_2225_multi-metric-strip

## Feature prompt

Per-exercise info during a live workout currently shows only "Volume to PR" (in `src/components/volume-target-slot.tsx`). Extend the strip so the user can see the full story of where they are in the exercise: add (a) **Max volume** — the previous-best single-session volume for this exercise — and (b) **Current session volume** — the running sum of CHECKED working sets in this live session. Render alongside the existing "Volume to PR" target.

Per F10's spec, current session volume must count only sets marked done (checked). Volume to PR keeps its current per-session-max definition (no kernel change). Use `formatVolume` (already updated to show full integers with thousands separator — e.g. `"4,900 kg"`).

User goal: resolve the perception that "Volume to PR" looks wrong by surfacing the reference points (Max + Current) next to the gap.

## Baseline

- Branch: main
- Commit: 4e30d1561a2877ae14b435e627590a99594780b8 (working tree dirty from the prior run — `src/utils/units.ts` etc.)

## Current state

- Owner: tester
- Step: 6. Test
- Round (current loop): Implement↔Test r1
- Status: in-progress
- Started (BRT): 2026-05-21 22:25
- Updated (BRT): 2026-05-21 23:00

## Budgets remaining

- Design ↔ Validate rounds: 3 / 3
- Implement ↔ Review rounds: 2 / 2
- Implement ↔ Test rounds: 2 / 2
- Implementer soft-callbacks: 2 / 2

## Artifacts produced

- [x] discovery.md
- [x] design-v1.md
- [x] validation-v1.md
- [x] implementation.md
- [x] review-v1.md
- [ ] test-report-v1.md
- [ ] final-summary.md
- [ ] retro.md (post-run, filled in by owner)

## Decisions / events log

- 2026-05-21 22:25 BRT — run initialized. Baseline includes the uncommitted formatVolume change from `docs/runs/2026-05-21_2155_volume-math-wrong/` (intentional: this feature consumes that formatter).
