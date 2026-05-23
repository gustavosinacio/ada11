# Final summary — 2026-05-23_1805_session-total-volume-header

## Outcome
- **Feature**: Session total volume in the workout header — the live workout `<SessionHeader>` now renders a second metric block (`Volume · X kg/lbs`) alongside the existing `Elapsed` block. Updates live as sets are checked/unchecked/edited/added/removed via the shared `["sets", sessionId]` cache.
- **Pipeline result**: **shipped**
- **Branch / baseline**: `main` / `65ff20e107c35583cb3736cdf70581f394955aa2`
- **Files**: 2 source + 2 new tests (4 total).

## Metrics

| Metric | Value |
|---|---|
| Feature works end-to-end? | yes (5 new e2e + golden + 320pt screenshot verified) |
| Human interventions during run | 0 |
| Total round-trips (sum of all loops) | 3 (1 D↔V + 1 I↔R + 1 I↔T — all pass first try) |
| Design ↔ Validate rounds | 1 (round 1 → go with 1 known-debt major + 4 minors) |
| Implement ↔ Review rounds | 1 (pass first try) |
| Implement ↔ Test rounds | 1 (pass first try) |
| Implementer soft-callbacks | 0 |
| Wall-clock duration | ~47 min (18:05 → 18:52 BRT) |
| Token cost | n/a |

## Decisions of record (the 8 Discovery unknowns)

1. **Kernel**: reuse `sumLiveVolume(sets)` from `src/utils/volume-target.ts:88-100` (checked + non-warmup + dropsets-in + `weight>0` + `reps>0`).
2. **Empty/loading state**: render `0 kg` (matches verdict + per-exercise "Now" semantics).
3. **Format**: label-above-number block (`Volume` / `12,345 kg`) mirroring the existing `Elapsed` treatment.
4. **Placement**: second metric column inside `<SessionHeader>` in a `flex-row gap-6` wrapper; Finish pressable unchanged at the right.
5. **Loading state**: `0 kg` (no skeleton — derived synchronously from cache).
6. **Cancel-workout interplay**: non-issue (Cancel lives below in ScrollView, not in header).
7. **Scope**: live workout screen only. Verdict, history, per-exercise strip already show the same number via the same kernel.
8. **A11y label**: pinned as `Session total volume: ${formatVolume(volumeKg, unit)}`.

## Validator catches (the load-bearing wins)

- **MAJ-1**: iPhone SE 320pt overflow risk on lbs power users with `1:23:45` elapsed + `27,210 lbs` volume + Finish button. Validator surfaced the back-of-envelope width estimate and forced a pinning decision before code. Implementer adopted option (a) — both metric blocks at `text-xl` from the start. Tester confirmed at 320×568 viewport with `1:00:08` + `22,046 lbs` + Finish: no wrap, no overlap, no h-scroll (`scrollWidth === clientWidth === 320`, gap between numeral and Finish = 13.55px).
- **MIN-1**: prevented duplicate-import / duplicate-identifier errors from a literal-reader Implementer (`useMemo` + `useWeightUnit` already imported, `unit` already declared at `[sessionId].tsx:79`).
- **MIN-2**: prevented Playwright strict-mode collision — single-exercise sessions would have made `getByText("1,000 kg")` match both the header AND the per-exercise `<VolumeTargetSlot>` numeral. Forced `getByLabelText(/^Session total volume:/)` scope from the start.
- **MIN-3**: a11y label placement aligned with the established `volume-target-slot.tsx` pattern (inner `<Text>`).
- **MIN-4**: dropped the "if not already present" hedge in design instructions.

## Files touched

### Edited (source)
- `src/components/session-header.tsx` — added `volumeKg + unit` props, new metric block with a11y label, both numerals demoted to `text-xl`.
- `app/(app)/workout/[sessionId].tsx` — added `useMemo([setsQ.data])` computing `totalVolumeKg` via `sumLiveVolume`; passed `volumeKg + unit` props to `<SessionHeader>`. Only new import: `sumLiveVolume`.

### New (tests)
- `tests/unit/session-header-total-volume.test.ts` — 16 unit cases (empty, kg, lbs, a11y label, kernel reuse).
- `tests/e2e/session-total-volume-header.spec.ts` — 5 Playwright scenarios (initial 0, seeded volume, check via UI, edit weight, uncheck).

### New (artifacts)
- `docs/runs/2026-05-23_1805_session-total-volume-header/` — full run folder.
- `docs/runs/2026-05-23_1805_session-total-volume-header/screenshots/320pt-worst-case.png` — iPhone SE worst-case visual evidence pinned by Tester.

**Diff size**: +58 / -6 lines on production code; +~470 lines on new test files.

## Quality gates at end of run
- Typecheck: clean (Reviewer + Tester both re-ran).
- Lint: 0 errors, 1 pre-existing warning in `router.d.ts` (unrelated).
- Unit tests: 284/284 pass (+16 new vs prior baseline 268).
- E2E new: 5/5 pass.
- 320pt visual: passes (no wrap, no h-scroll, 13.55px clearance).

## Pre-existing flakes flagged by Tester (NOT caused by this run)
1. `tests/e2e/crud.spec.ts:131` — exercise-creation muscle field `getByPlaceholder('e.g. Chest')` timeout. Reproduces on baseline `HEAD`.
2. `tests/e2e/remove-exercise.spec.ts:92,189` and `tests/e2e/soft-deleted-exercises-in-history.spec.ts:87` — `waitForURL(/\/workout$/)` after Finish needs to accept `/workout/verdict/<uuid>` post the end-of-session-verdict feature (commit `4871d33`). Pre-existing, reproduces on baseline.

These should be tightened in a separate run; out of scope here.

## Why we stopped
Not escalated — pipeline completed cleanly. Budgets at end: D↔V 2/3, I↔R 1/2, I↔T 1/2, soft-callbacks 2/2.

## Artifacts
- [`state.md`](./state.md)
- [`discovery.md`](./discovery.md)
- [`design-v1.md`](./design-v1.md) ← shipped
- [`validation-v1.md`](./validation-v1.md) → go (0 / 1 major as known debt / 4 minors — all resolved at Implement)
- [`implementation.md`](./implementation.md)
- [`review-v1.md`](./review-v1.md) → pass (0/0/0)
- [`test-report-v1.md`](./test-report-v1.md) → pass
- [`transcript.md`](./transcript.md)
- `screenshots/320pt-worst-case.png` — load-bearing visual evidence

## Bugs found post-merge (backfill within 7 days)
- (none yet)

## Archive
- Archived to vault: `$VAULT/AIground/multi-agent-pipeline/pipeline-runs/2026-05-23_1805_session-total-volume-header/` on 2026-05-23.
