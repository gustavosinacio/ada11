# Validation v3 — 2026-05-24_2020_auto-fill-placeholder-on-check

Round: Design↔Validate round 3 of ≤3 (LAST).
Reviewing: `design-v3.md`.

## v2 issue status

| ID | Addressed? |
|---|---|
| BLK-1 (same-tick post-blur cache read impossible) | YES — replaced by sync callback args from `<SetInput>` local state |
| BLK-2 (`sessionId` prop breaks history-edit caller) | YES — prop removed entirely |
| MAJ-1 (shim collides with `useUpdateSet` invalidation) | YES — shim removed |
| MAJ-2 (shim clears unrelated fields on partial commit) | YES — shim removed |
| MIN-1/2/3/4/5 (v1 minors carried) | YES |

## Verified claims

| Claim | Verified? |
|---|---|
| `<SetInput>` owns local `weight`/`reps` strings at `set-input.tsx:86-87` | YES |
| Toggle thunk to widen at `set-input.tsx:115`: `() => onToggleChecked?.(!isChecked)` | YES |
| `<ExerciseBlock>` forwards `onToggleChecked` at `exercise-block.tsx:238-242` with access to `previousByRowId.get(s.id)` at line 235 | YES |
| History-edit caller at `history/[id].tsx:310-352` does NOT pass `onToggleSetChecked`/`showCheckable` | YES — signature widening invisible there |
| `<ReadOnlyExerciseBlock>` doesn't mount the toggle | YES |
| Only 3 production callers reference `onToggleChecked`/`onToggleSetChecked` | YES (`set-input.tsx`, `exercise-block.tsx`, `workout/[sessionId].tsx`) |
| No test files import `onToggleChecked`/`onToggleSetChecked` | YES — zero test churn from prop widening |
| `SetRow.weight: string \| null`, `SetRow.reps: number \| null` match helper's structural shape | YES |
| `checkSet` only flips `completed_at`; uncheck preserves weight/reps (E7 invariant) | YES |
| Bulk "Check all and finish" bypasses `onToggleSetChecked` (E8 invariant) | YES |
| E9 lbs pin `"264.6"` — `120 / 0.45359237 ≈ 264.5547`, `.toFixed(1) === "264.6"` | YES |

## Findings

### Blockers
None.

### Majors
None.

### Minors

- **MIN-1 — Inline math comment cites wrong conversion direction.** v3 writes `kgToLbs(120) = 120 × 2.20462 = 264.5544` but the actual implementation at `src/utils/units.ts:6-8` is `kg / KG_PER_LB`. The pinned `"264.6"` final string is correct either way; comment misleads. Fix at Implement time.

- **MIN-2 — Open question #1 answered: NO test files import the old callback shapes.** Verifier already grepped; zero test churn from widening. Pin in implementation brief.

- **MIN-3 — `Keyboard.dismiss()` polish has tiny ambiguity.** Keeping it could fire TWO `updateSet` round-trips per check (blur-driven commit + auto-fill commit). Non-overlapping shapes, no logical race, but Reviewer should know when reading network logs in E2.

- **MIN-4 — In-session walk of `previousByRowId` doesn't filter `set_type`.** A working set can auto-fill from a warmup row when no prior working set exists in-session AND `lastFromHistory` is null. Design v3 acknowledges as deliberate (stays consistent with placeholder). Known UX edge case, not blocking.

- **MIN-5 — E10 byte-identity check doesn't measure auto-fill path's added timer delay.** Worth optional E11 asserting `restTimer.remainingSeconds < target` within ~500ms after check. Tester discretion.

## Decision

**go**

Counts: blockers=0, majors=0, minors=5.

Confidence: HIGH on all closures (verified file:line). Risk: LOW — no schema/RLS change, manual-commit path byte-identical, auto-fill adds one round-trip on happy path, mid-typing race architecturally closed.

## Recommendation

**Invoke Implementer**. Hand-off notes:
- MIN-1: fix the inline comment (`120 / 0.45359237`).
- MIN-2: no test churn needed.
- MIN-3: `Keyboard.dismiss()` optional — one-line revert if Reviewer flags.
- MIN-4: warmup-as-previous fallback intentional, out of scope.
- MIN-5: timer-delay-bound assertion optional at Tester discretion.
