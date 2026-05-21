# Review v1 — 2026-05-21_1505_exercise-volume-target

## Verdict
**Decision: pass** — 0 blockers, 0 majors, 2 minors.

Implementation lands all the validator-flagged items: MAJ-1 is folded (max-`set_number` reduce, sentinel test in place), MIN-2 (tie copy), MIN-3 (no `sessionId` prop), and MIN-4 (real template literals). Both documented deviations from design v1 (chasing lead-in `"Volume to PR"` and surpassed-state emerald palette) come from the Conductor's slot spec, are visually equivalent, and are explicitly waived in `implementation.md`. Quality gates green: typecheck 0, lint 0 errors (1 pre-existing warning in `router.d.ts`), 87/87 unit tests including 13 new.

## Quality gates (re-run for sanity)
- `npm run typecheck` — pass (exit 0).
- `npm run lint` — pass (0 errors, 1 pre-existing warning in `router.d.ts`, not in scope).
- `npm run test:unit` — pass (8 files, 87 tests, all green; new file contributes 13 tests).

## Checklist results

| # | Check | Status | Evidence |
|---|---|---|---|
| 1 | MAJ-1 fix: pick `currentWeight` by max `set_number` via `.reduce` (not last array index) | PASS | `src/utils/volume-target.ts:106-111` — `s.set_number > best.set_number`. Sentinel test `tests/unit/volume-target.test.ts:278-315`. |
| 2 | Volume kernel: `parseFloat(weight) * reps`, skip warmups, guard `w > 0 && r > 0` | PASS | `src/utils/volume-target.ts:48-59`. Mirrors `app/(app)/exercises/[id]/progress.tsx:73-82`. |
| 3 | State machine: `no-pr` / `chasing` / `surpassed`; tie (`gapKg <= 0`) → surpassed with `overflowKg = 0` | PASS | `src/utils/volume-target.ts:88-101`. Test `tests/unit/volume-target.test.ts:225-241`. |
| 4 | `<VolumeTargetSlot>` calls `useExerciseProgress(id)` and `useWeightUnit()` unconditionally; returns `null` on loading / no-pr | PASS | `src/components/volume-target-slot.tsx:33-34` (both hooks before any early return); `:47-48` (null returns). |
| 5 | `<ExerciseBlock>`: `showVolumeTarget?: boolean` default `false`; NO `sessionId` prop added | PASS | `src/components/exercise-block.tsx:37,55`. No `sessionId` prop in `Props`. |
| 6 | Live workout passes `showVolumeTarget={true}` | PASS | `app/(app)/workout/[sessionId].tsx:367` (boolean-shorthand `showVolumeTarget`). |
| 7 | History detail does NOT pass `showVolumeTarget` | PASS | `app/(app)/history/[id].tsx:240-272`. Default `false` keeps the strip off. |
| 8 | Math in kg; display via `formatVolume` / `formatWeight` | PASS | Helper returns `*Kg` fields. Slot uses `formatVolume(gapKg, unit)` (line 51), `formatVolume(overflowKg, unit)` (line 94), `formatWeight(currentWeightKg, unit)` (line 58). |
| 9 | Accessibility label assembled with JS template literals (real `${...}`) | PASS | `src/components/volume-target-slot.tsx:61-65,98-100`. |
| 10 | Sentinel test: `[set#2(checked, w=80), set#1(unchecked, w=100)]` → `currentWeightKg === 80` | PASS | `tests/unit/volume-target.test.ts:291-314`. Also asserts `repsToBeat ≈ 1.25`. |
| 11 | No new `any`, no `// @ts-ignore`, no stray `console.log` | PASS | Grep on the four new/edited files: zero hits. |

## Verified deviations from design v1 (acceptable)

Both deviations are documented in `implementation.md:14-20` and trace back to the Conductor's slot-spec; neither alters the math or the state machine.

| Deviation | Design v1 said | Implemented | Verdict |
|---|---|---|---|
| Chasing lead-in copy | `"To beat PR: …"` | `"Volume to PR: "` (`volume-target-slot.tsx:74`) | acceptable — clearer "volume gap" framing, accessibility label remains `"Need {gap} more to beat your previous best."`. No measurable UX regression. |
| Surpassed-state color token | `text-blue-500 dark:text-blue-400` | `text-emerald-600 dark:text-emerald-400` (`volume-target-slot.tsx:107`) | acceptable — emerald is in Tailwind's default palette (verified by typecheck/lint pass), no Tailwind config change. The codebase already uses other non-blue accent tokens elsewhere (e.g. `text-red-500` on Trash2 button line 153), so this isn't a token novelty. |

## Issues

### Blockers
None.

### Majors
None.

### Minors

**MIN-R1** — `src/components/volume-target-slot.tsx:114` casts `currentSet.weight as string`. Safe at runtime because the reducer (`volume-target.ts:106-111`) only retains sets where `parseFloat(s.weight)` returned a finite positive number, which requires `s.weight` to be a non-null parseable string. But the cast costs a re-parse and shifts the typing burden onto the reader. **Suggested fix**: return the parsed weight from the reducer too, so the slot doesn't need to re-parse or cast:
```ts
// in volume-target.ts — extend the reducer to carry both pieces
let currentWeightKg: number | null = null;
let bestSetNumber = -Infinity;
for (const s of currentSessionSets) {
  const w = s.weight ? parseFloat(s.weight) : NaN;
  if (!Number.isFinite(w) || w <= 0) continue;
  if (s.set_number > bestSetNumber) { bestSetNumber = s.set_number; currentWeightKg = w; }
}
```
Severity: minor. Doesn't change behavior.

**MIN-R2** — `src/components/volume-target-slot.tsx:42` — `useMemo` dependency array uses `currentSessionSets` (object identity). The parent (`exercise-block.tsx:163`) passes `sets` straight through, and `sets` flows in from `workout/[sessionId].tsx` via `setsByExercise.get(ex.id) ?? []`. The `?? []` allocates a new empty array on each render when an exercise has no sets, which forces `useMemo` to recompute every render for that case. Practical impact is nil (empty array reduces to `0` in microseconds), but if you want to harden it, consider a stable empty constant or `useMemo` the fallback in the workout screen. Severity: minor (cosmetic).

## Concerns reviewed and dismissed

- **Hook hygiene**: the conditional MOUNTING pattern (`exercise-block.tsx:160-165` renders `<VolumeTargetSlot>` only when `showVolumeTarget` is truthy) is the canonical workaround. The hooks inside the slot are unconditional. No rules-of-hooks violation.
- **RLS / security**: zero new `from('table').*` calls. Both `useExerciseProgress` and `useWeightUnit` already enforce `auth.uid()` upstream. No new tables, no migrations, no service-role usage, no public env vars touched.
- **Cache-buster bump**: N/A — no schema change.
- **History detail surface**: confirmed grep — only `workout/[sessionId].tsx` passes `showVolumeTarget`. Other `<ExerciseBlock>` callsite (`history/[id].tsx:240`) keeps the default `false`.
- **Style conventions**: imports follow project order (package then `~/` aliases), files in conventional folders (`src/utils/`, `src/components/`, `tests/unit/`), no inline comments narrating "what" (the helper has "why" comments at lines 61-73, 104-105 explaining the MAJ-1 fix and the tie-collapse decision).
- **MIN-1 (formatVolume k-shorthand precision)** acknowledged in `implementation.md:17`. Matches existing codebase precedent (`weekly-volume-strip.tsx:106`). Not a regression.

## Counts
- Blockers: 0
- Majors: 0
- Minors: 2

## Recommendation
Proceed to **Tester**. Implementation is ready for e2e validation per the test-plan hints in `implementation.md:40-42`.

Round 1 of 2.
