# Final summary — 2026-05-22_1000_set-row-declutter

## Outcome

- **Feature**: Set row declutter — RPE + notes moved behind a per-row bottom-sheet menu. Default row visual: weight + reps + previous placeholder + check + `MoreHorizontal` trigger. RPE is now a chip selector (12 chips: `—, 5.0, 5.5, …, 10.0`), not a free-form input. Menu icon tints blue when there's data behind it.
- **Pipeline result**: **shipped** — including a load-bearing data-loss fix in `updateSet` (BLK-1) that was promoted from latent footgun to triggered-on-every-blur by the row narrowing.
- **Branch / final commit**: `main`. Working tree dirty.

## Metrics

| Metric | Value |
|---|---|
| Feature works end-to-end? | yes (198/198 unit, 3/3 set-row-menu e2e green) |
| Human interventions during run | 2 (1 mid-run features.md addition; 1 Conductor v2.1 inline test-harness fix after I↔T budget exhaustion) |
| Total round-trips | 5 (D↔V 3, I↔R 1, I↔T 2 + 1 Conductor closure) |
| Design ↔ Validate rounds | 3 (v1 `no-go` 0/2/7 → v2 `no-go` 1/0/2 → v3 `go` 0/0/2) |
| Implement ↔ Review rounds | 1 (`pass`) |
| Implement ↔ Test rounds | 2 (v1 fail on e2e harness → v2.1 Conductor closure green) |
| Implementer soft-callbacks | 0 |
| Wall-clock duration | ~90 min (10:00 → 11:30 BRT) |
| Token cost | n/a |

## What shipped

**11 files**:

**New:**
- `src/components/set-row-menu.tsx` — bottom-sheet modal (KAV-wrapped).
- `tests/unit/api-sets.updateSet.test.ts` — 7 cases including BLK-1 regression.
- `tests/unit/api-sets.updateSetMeta.test.ts` — 7 cases.
- `tests/unit/use-sets.useUpdateSetMeta.test.ts` — 5 cases.
- `tests/e2e/set-row-menu.spec.ts` — 3 cases (RPE persistence, notes persistence, BLK-1 regression).

**Edited:**
- `src/api/sets.ts` — `updateSet` partial-spread + new `updateSetMeta` export. **BLK-1 root-cause fix.**
- `src/hooks/use-sets.ts` — `useUpdateSet` null-tolerance + new `useUpdateSetMeta`.
- `src/components/set-input.tsx` — inline RPE + notes removed; `MoreHorizontal` trigger added; menu mount-gated.
- `src/components/exercise-block.tsx` — `onUpdateSetMeta` prop wiring; header column updated.
- `app/(app)/workout/[sessionId].tsx` — `useUpdateSetMeta` mutation wired.
- `app/(app)/history/[id].tsx` — same wiring.

## Bugs caught by the pipeline

- **v1 MAJ-1**: `updateSetMeta` undefined-vs-absent semantic. Caller-passed `{rpe: undefinedVar}` would clobber. Fixed in v2 with `if (patch.X !== undefined)` checks.
- **v1 MAJ-2**: design v1 claimed Modal unmounts children when `visible=false` (false on RN-Web). Fixed in v2 via `{menuOpen ? <SetRowMenu …/> : null}` JSX-gated mount.
- **v2 BLK-1 (the big one)**: v1's `updateSet` clobber footgun (which design v1 wanted to leave latent) gets PROMOTED to triggered-on-every-reps/weight-blur data loss when v2's narrowing of `<SetInput>.onCommit` makes `rpe`/`notes` undefined in the patch. The unchanged `?? null` mapping then writes `null` to the DB. Caught at v2 review. v3 fixed at the root by applying the same partial-spread pattern to `updateSet` — `if (patch.X !== undefined) payload.X = patch.X` for all 4 columns.

## Known debt (non-gating)

- 2 Reviewer style nits (comment narrating "what" not "why"; `accessibilityRole="none"` on backdrop shield).
- 2 Validator v3 cosmetic minors (design test-count description vs Test plan; "narrowing" claim is JSDoc-only).
- Trash tap-target debt (~24pt) — pre-existing, logged as a separate follow-up.

## Why we stopped

Feature complete. All gates green.

## Artifacts

- [`state.md`](./state.md), [`transcript.md`](./transcript.md)
- [`discovery.md`](./discovery.md)
- [`design-v1.md`](./design-v1.md), [`validation-v1.md`](./validation-v1.md) — no-go
- [`design-v2.md`](./design-v2.md), [`validation-v2.md`](./validation-v2.md) — no-go (BLK-1)
- [`design-v3.md`](./design-v3.md), [`validation-v3.md`](./validation-v3.md) — **go**
- [`implementation.md`](./implementation.md)
- [`review-v1.md`](./review-v1.md) — pass
- [`test-report-v1.md`](./test-report-v1.md) — fail (e2e harness)
- [`test-report-v2.md`](./test-report-v2.md) — pass (Conductor v2.1 closure)

## Notes for the owner

- **Working tree uncommitted.** Suggested split:
  - `feat(workout): set-row declutter — RPE/notes behind per-row menu (+ updateSet partial-spread fix)` — covers the 11 files.
  - `docs(pipeline): archive set-row-declutter run` — the run dir + features.md.
- **Manual visual check**: open a live workout, log a set, set RPE via the menu, then edit reps inline. Confirm the RPE survives. (Pre-fix this would have been silently NULLed.)
- **`docs/features.md` priority 1 item** → close on commit.

## Archive

- Pending Conductor archive command.
