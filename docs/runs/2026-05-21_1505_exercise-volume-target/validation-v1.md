# Validation v1 — 2026-05-21_1505_exercise-volume-target

## Verdict
**Decision: go** — 0 blockers, 1 major, 4 minors.

The design is sound: volume kernel matches canonical precedent (`progress.tsx:74-82`); no schema/cache-buster work; `<VolumeTargetSlot>` extraction preserves hook hygiene; gating story clean. One real risk worth fixing during implementation, plus polish items.

## Verified claims

| Claim | Status | Evidence |
|---|---|---|
| Volume kernel: `parseFloat(weight) * reps`, skip warmups, guard `w>0 && r>0` | TRUE | `exercises/[id]/progress.tsx:73-82`, `weekly-volume-strip.tsx:43-51` |
| `useFinishSession.onSuccess` invalidates `["progress"]` | TRUE | `use-sessions.ts:63` |
| `useLogSet`/`useCheckSet`/`useUncheckSet`/`useDeleteSet` do NOT invalidate `["progress"]` | TRUE | `use-sets.ts:42-50, 65-74, 95-113` |
| Active session excluded from `["progress"]` by `.not("sessions.ended_at", "is", null)` | TRUE | `progress.ts:15` |
| History detail does NOT pass `showCheckable` to `<ExerciseBlock>` | TRUE | `history/[id].tsx:240-272` |
| Live workout passes `showCheckable` + sets prop | TRUE | `workout/[sessionId].tsx:320, 366-377` |
| `useExerciseProgress(id)` returns `SessionSets[]` (per-session-grouped) | TRUE | `use-progress.ts:5-11`, `progress.ts:10-39` |
| `<VolumeTargetSlot>` sub-component preserves hook-rule compliance | TRUE | Conditional MOUNTING (not conditional hook call) is the canonical workaround |
| `["progress", exerciseId]` cache shared with per-exercise progress screen | TRUE | `use-progress.ts:7` |
| No cache-buster bump needed | TRUE | No schema change |
| Per-block fan-out at N≤8 acceptable | TRUE | TanStack dedupes by key; ~sub-second cold-start on warm network |

## Issues

### Major

**MAJ-1** — "Current weight" picker walks the array backwards assuming `set_number`-monotonic order, but `listSetsForSession` orders by `completed_at ASC nullsFirst:false, set_number ASC` (`src/api/sets.ts:31-32`). NULLs sort last → array order is: [checked sets by completion+set_number, then unchecked sets by set_number]. Walking backwards from the last index does NOT reliably pick the highest-`set_number` set.

Counterexample:
1. User logs set #1 (w=100, unchecked).
2. User logs set #2 (w=80, unchecked).
3. User checks ONLY set #2.
Array becomes: `[set#2(checked, w=80), set#1(unchecked, w=100)]`. Walking backwards → picks set #1 (w=100) as "current weight" — but set #2 is most recent.

**Fix**: pick by max `set_number` directly with a `.reduce` (not "last in array"). One-line change in the helper.

### Minors

- **MIN-1** `formatVolume` k-shorthand precision: gap of 1049 kg → "1.0k kg" (precision loss). Matches existing precedent (`weekly-volume-strip.tsx:106`); acknowledge in §Riscos.
- **MIN-2** Tie copy when `gapKg === 0`: design collapses into chasing showing "0 kg". Cleaner UX: flip to `surpassed` on `gapKg <= 0` and special-case `overflowKg === 0` → "Matched your previous best".
- **MIN-3** `sessionId` defensive-exclusion prop unnecessary — `progress.ts:15` already excludes active session. Adds API surface noise.
- **MIN-4** `accessibilityLabel` example in design doc uses curly-brace placeholders; should be JS template literals (`${...}`).

## Concerns dismissed
- Reps `.toFixed(1)` rounding direction — fine for estimate.
- Cache key sharing with progress chart — TanStack guarantees single in-flight fetch.
- Cross-feature with F10 check semantics — drift documented and accepted.
- `previousMax === 0` → no-pr (handled).
- `currentWeight === 0 || null` → hide reps clause (handled).
- `repsToBeat === Infinity` — guarded.

## Decision

**go** — Implementer should fold MAJ-1 fix during implementation (one-line `.reduce` over `set_number`).

Round 1 of 3.
