# Final summary — 2026-05-21_1505_exercise-volume-target

## Outcome
- **Feature**: Per-exercise volume-target strip in the live workout. Shows "Volume to PR: X kg · ≈ Y.Z reps @ Wkg" when chasing previous best; "Matched your previous best" on tie; "🎉 New PR! +X kg" on surpass. Hidden when no previous max exists and in history detail.
- **Pipeline result**: **shipped** (typecheck/lint clean, 87/87 unit incl. 13 new + sentinel test, 6/6 new e2e + adjacent green).
- **Baseline commit**: `8e29614`.

## Metrics

| Metric | Value |
|---|---|
| Feature works end-to-end? | yes (web; 6/6 new e2e + 18/19 adjacent) |
| Human interventions | 0 |
| Total round-trips | 0 (single-pass D↔V, I↔R, I↔T) |
| Design ↔ Validate rounds | 1 (`go` with 1 major absorbed by Implementer) |
| Implement ↔ Review rounds | 1 (`pass`) |
| Implement ↔ Test rounds | 1 (`pass`) |
| Implementer soft-callbacks | 0 |
| Wall-clock duration | ~47 min (15:05 → 15:52 BRT) |

## What shipped (5 production/test files + 1 unit + 1 e2e spec)

**New:**
- `src/utils/volume-target.ts` — pure helper `computeVolumeTarget`. Returns one of `no-pr` / `chasing` / `surpassed` discriminated union. Math in kg. Current weight picked by `max(set_number)` reduce (validator MAJ-1 fix); kernel mirrors `progress.tsx:73-82`.
- `src/components/volume-target-slot.tsx` — presentational. Calls `useExerciseProgress(id)` + `useWeightUnit()` UNCONDITIONALLY (hook hygiene). Returns null on loading / no-pr.
- `tests/unit/volume-target.test.ts` — 13 unit tests incl. MAJ-1 sentinel (array order `[set#2-checked-w80, set#1-unchecked-w100]` → currentWeight === 80).
- `tests/e2e/volume-target.spec.ts` — 6 e2e (golden chasing, no-weight, tie, MAJ-1 regression, no-pr hidden, history hidden).

**Edited:**
- `src/components/exercise-block.tsx` — `showVolumeTarget?: boolean` prop (default false). No `sessionId` prop (validator MIN-3).
- `app/(app)/workout/[sessionId].tsx` — passes `showVolumeTarget={true}` to each block.

## Decisions
1. **Data fetch** = reuse `useExerciseProgress(id)` cache per block, compute max client-side. No new API.
2. **"Current weight"** = most recently logged set (by max `set_number`) with finite positive weight.
3. **Running volume** = includes unchecked drafts (aggressive — motivating). Drift from post-finish history acknowledged.
4. **Display placement** = single-line strip below exercise name, above set list.
5. **No-pr state** = hide the strip entirely.
6. **Tie/surpass** = both flow through `surpassed` state; tie special-cases to "Matched your previous best — one more rep is a PR".
7. **Reps-left math** = `gapKg / currentWeightKg`, `.toFixed(1)` per prompt.
8. **History detail** = does NOT pass `showVolumeTarget` (default false) → unchanged.
9. **Cache invalidation** = none new (`useFinishSession.onSuccess` already invalidates `["progress"]`).

## Bugs caught by the pipeline
- **v1 MAJ-1** Validator: "current weight" walking array backwards is wrong under F10's checked-before-unchecked ordering. Fixed in Implementer with max-`set_number` reduce. Sentinel test + screenshot evidence on the post-F10 ordering case.
- **v1 MIN-2** Validator: tie case `gapKg <= 0` collapsing into chasing showed weakly. Fixed by routing tie to surpassed with `overflowKg = 0`.

## Known-debt (non-gating)
- 2 Reviewer minors: `weight as string` cast in slot could return parsed value from reducer; `useMemo` empty-array fallback allocates per render.
- 2 documented design deviations: chasing lead-in copy `"Volume to PR"` (vs `"To beat PR"`); surpassed-state emerald palette (vs blue). Both came from Conductor's slot spec; visually equivalent.
- Pre-existing unrelated `crud.spec.ts > exercises: create custom exercise` failure (b51dd01 muscles-picker refactor).

## Why we stopped
- Feature complete. Cleanest run-pattern: single-pass through every loop.

## Artifacts
- discovery.md, design-v1.md, validation-v1.md
- implementation.md, review-v1.md, test-report-v1.md
- screenshots/ (8 PNGs)
- state.md, transcript.md, final-summary.md
- retro.md (post-run, owner)

## Notes for the owner
- **Working tree uncommitted.** Suggested split: `feat(workout): per-exercise volume-target strip ("To PR: X kg · ≈ Y reps")` + `docs(pipeline): archive exercise-volume-target run`.
- **No DB / API change.**
- **F12 (tap exercise name → progress route) is next in the queue.**

## Archive
- To archive: `cp -r docs/runs/2026-05-21_1505_exercise-volume-target "$VAULT/AIground/multi-agent-pipeline/pipeline-runs/2026-05-21_1505_exercise-volume-target"` + vault README entry.
