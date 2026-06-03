# Final summary — 2026-06-03_1124_progress-chart-window

## Outcome
- **Feature**: Page-level discrete weeks-window selector (`0/10/20/30/40/50`) on the Progress tab that bounds the two trend charts (per-muscle weekly volume + e1RM strength), defaulting (seed-once, ephemeral, view-only) to the user's `max_volume_window_weeks` profile preference. Implemented via an optional `windowStartMs?: number` param on the two pure presenters; no calendar dependency, no write-back, no migration.
- **Pipeline result**: **shipped** (working tree — NOT committed; awaiting owner's commit decision).
- **Branch / final commit**: `main`; baseline `25db98b`; feature changes uncommitted in the working tree (12 feature files alongside the unrelated pre-existing cache-buster noise).

## Metrics

| Metric | Value |
|---|---|
| Feature works end-to-end? | **yes** (Tester: new e2e 3/3, 0-flake over 9 runs; chart geometry proven to redraw 53→9 pts on All→10w) |
| Human interventions during run | 1 (one AskUserQuestion batch resolving U1 picker-type / U2 scope / U4 statefulness) |
| Total round-trips (sum of all loops) | 0 re-loops — every gate passed on round 1 |
| Design ↔ Validate rounds | 1 (go on r1) |
| Implement ↔ Review rounds | 1 (pass on r1) |
| Implement ↔ Test rounds | 1 (pass on r1) |
| Implementer soft-callbacks | 0 (budget 2/2 intact) |
| Wall-clock duration | ~00:52 (11:24 → 12:16 BRT) |
| Token cost (if known) | n/a |

## Quality gates (final)
- `npm run typecheck`: 0 errors.
- `npm run lint`: 0 errors / 1 pre-existing `router.d.ts` warning (baseline-unchanged).
- `npx vitest run`: **485 / 485** (+8 over the 477 baseline) — includes W-0 Invariant-W deepEqual anchors (both presenters) + W-1..W-5.
- e2e new spec `progress-window-selector.spec.ts`: **3/3**, 0-flake over 9 (`--repeat-each=3`).
- e2e regression (`weekly-muscle-volume`, `e1rm-strength`, `progress-page`, `max-volume-window`): **21/21**, 0 flaky — Invariant W holds end-to-end at the default window.

## Key decisions (human-locked)
- Picker = discrete weeks selector reusing `MAX_VOLUME_WINDOW_OPTIONS` (NOT a calendar date picker — none installed, none added).
- Scope = the two Progress-TAB charts only (per-exercise screen + 8-bar strip explicitly out).
- State = ephemeral/view-only, seed-once from the pref, NO write-back (avoids shifting Max/Best-week/PR numbers app-wide).

## Files changed (12: 10 edited, 2 new)
Production: `src/utils/weekly-muscle-volume.ts`, `src/utils/e1rm-strength.ts`, `src/db/types.ts`, `app/(app)/profile.tsx`, `src/components/progress-window-selector.tsx` (new), `app/(app)/progress/index.tsx`, `src/components/weekly-muscle-volume-section.tsx`, `src/components/e1rm-strength-section.tsx`.
Tests: `tests/unit/weekly-muscle-volume.test.ts`, `tests/unit/e1rm-strength.test.ts`, `tests/unit/profile-max-volume-window.test.ts`, `tests/e2e/progress-window-selector.spec.ts` (new).

## Validator/Reviewer findings resolved
- MAJ-1 (e2e shrink-assertion had no teeth → assert old-only legend chip disappears, not x-axis label count): fixed + verified by Tester (chip `toHaveCount(1)→0→1`).
- MIN-1/MIN-2 (single-source label map): `MAX_VOLUME_WINDOW_LABELS` lifted to `db/types.ts`; profile + unit test import the shared map.
- MIN-4 (same-series shrink preserves toggled-off line): e2e sub-step added.
- MIN-3 (R-6 cold-mount seed flicker): accepted verdict, consistent with existing `bestWeekLabel` tolerance — no action.
- Residual MIN (rank-flip with two survivors): optional coverage-completeness, not a defect.

## Notes / out-of-run
- **Pre-existing uncommitted cache-buster noise** (`src/lib/query-client.ts`, `src/utils/progress-page-math.ts`, `src/utils/weekly-volume-strip-math.ts`, `src/hooks/use-progress-page.ts`, `app/(app)/history/week/[isoWeek].tsx` + rebuilt `dist/`) is UNRELATED to this run; verified to carry zero feature additions. The owner should commit it separately from this feature.
- iOS/Android not exercised (web-only e2e harness); change is RN-Web-compatible-only, Risk LOW.

## Artifacts
- [`state.md`](./state.md)
- [`discovery.md`](./discovery.md)
- [`design-v1.md`](./design-v1.md)
- [`validation-v1.md`](./validation-v1.md)
- [`implementation.md`](./implementation.md)
- [`review-v1.md`](./review-v1.md)
- [`test-report-v1.md`](./test-report-v1.md)
- [`transcript.md`](./transcript.md)
- [`screenshots/`](./screenshots/) (01-all-history, 02-window-10w, 03-empty-window)
- [`retro.md`](./retro.md) (filled in by owner after reviewing artifacts)

## Bugs found post-merge (backfill within 7 days)
- (none yet — owner updates this section as bugs surface)

## Archive
- Archived to vault: `$VAULT/AIground/multi-agent-pipeline/pipeline-runs/2026-06-03_1124_progress-chart-window/` on 2026-06-03 12:16 BRT.
