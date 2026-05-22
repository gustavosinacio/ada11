# Run: 2026-05-22_0030_progress-page

## Feature prompt

New Progress tab + page. Dedicated top-level surface for momentum visibility. All comparisons use "lifetime best" as the anchor (never "previous week" or "previous session" alone) — matches the live-strip's existing `Max · Now · To PR` shape and is the only honest progress signal.

Page structure, top → bottom:
- **Hero**: `PRs this week: N` headline + weekly volume `Max · Now · To PR` (lifetime-best comparison).
- **Bars**: richer version of the weekly-volume chart currently on History. History mini-strip stays where it is.
- **List**: exercises trained this week, grouped by muscle group, each row shows per-exercise `Max · Now · To PR` (uses same per-session-max definition as the live strip).
- **Cards**: streak — current consecutive weeks with ≥1 finished session + best-ever streak.

Architecture:
- New bottom-tab entry "Progress".
- ISO week (Monday-Sunday, BRT) window.
- Empty state copy for early-week.
- No schema change. May need to extend `listWeeklyVolumeRows` to unbounded scope OR add a new aggregate API.

Accepted trade-off: lifetime-best anchor is strict; one outlier-peak week makes every normal week show regression. Soften only if it bites.

## Baseline

- Branch: main
- Commit: b76970eb7c6cf428cbb3e0f776b63c1d4d115575

## Current state

- Owner: tester
- Step: 6. Test
- Round (current loop): Implement↔Test r1
- Status: in-progress
- Started (BRT): 2026-05-22 00:30
- Updated (BRT): 2026-05-22 01:46

## Budgets remaining

- Design ↔ Validate rounds: 3 / 3
- Implement ↔ Review rounds: 2 / 2
- Implement ↔ Test rounds: 2 / 2
- Implementer soft-callbacks: 2 / 2

## Artifacts produced

- [x] discovery.md
- [x] design-v1.md
- [x] validation-v1.md (no-go; 2 blockers + 3 majors)
- [ ] implementation.md
- [ ] review-v1.md
- [ ] test-report-v1.md
- [ ] final-summary.md
- [ ] retro.md (post-run, filled in by owner)

## Decisions / events log

- 2026-05-22 00:30 BRT — run initialized. New top-level feature; substantial multi-component scope so going through the full feature pipeline (not direct implement).
