# Validation v1 — 2026-05-20_2034_soft-deleted-exercises-in-history

## Summary

Core fix sound: two-hook split + 3 consumer swaps + suffix marker + invalidation contract. `ExerciseRow.deleted_at` already on the prop received by `<ExerciseBlock>` (`src/db/types.ts:69`, `src/components/exercise-block.tsx:10`) so suffix is genuinely zero-prop. Live workout swap IS necessary (not just defensive) because `routine-exercises.ts:19` embedded join returns soft-deleted exercise rows, and `exMap.get(...)` lookup at `workout/[sessionId].tsx:91` drops the block until `useAllExercises()` populates `exMap`. No blockers; 1 major (test coverage gap); 4 minors (over-engineering / scope flexibility).

## Verified facts

- `src/hooks/use-exercises.ts:12-15` — `KEYS.all = ["exercises"]`, `KEYS.detail = (id) => ["exercises", id]`. Adding `["exercises", "all"]` is unambiguous (UUIDs).
- `<ExerciseBlock>` receives full `ExerciseRow` including `deleted_at` — no new prop needed.
- `<ExerciseBlock>` header text is non-pressable; no tap-through to edit. Edit screen on `useExercise()` (404 on soft-deleted) doesn't create a dead-end click from history.
- Only path to `/exercises/[id]/progress` from in-app UI is the filtered Exercises tab. Soft-deleted exercise can't be navigated to via progress route from the tab. Designer's swap is defensive (stale cache after open + delete).
- `routine-exercises.ts:19` embedded join doesn't filter `deleted_at` — design correctly identifies live workout swap as bug-fixing, not defensive.
- `getExercise(id)` uses `.is("deleted_at", null).single()` → throws on soft-deleted. Justifies `getAnyExercise`.
- All 3 mutations currently invalidate only `KEYS.all`.

## Issues

### Blockers
None.

### Majors

**MAJOR-1 — e2e misses the picker-exclusion regression guard**
Proposed e2e covers "block renders + `(deleted)` suffix + totals match." Should also assert that after soft-delete, the picker on the history detail screen (`history/[id].tsx:295` "Add exercise") does NOT show the soft-deleted exercise. Locks the contract against future accidental swaps of the picker to `useAllExercises()`.

**Fix**: add one step to the same e2e: after asserting the deleted block renders, tap "Add exercise" → assert deleted exercise is absent from picker list.

### Minors

**MIN-1 — Dual `invalidateQueries` calls redundant under TanStack prefix matching**
`invalidateQueries({ queryKey: ["exercises"] })` already invalidates `["exercises", "all"]` etc. Designer's "invalidate both" is harmless redundancy. Implementer's choice: drop one call OR keep for grep-ability.

**MIN-2 — `useAllExercise(id)` extra round-trip on progress open**
Could derive from `useAllExercises()` cache via `.find(...)`. ~30 rows; cheap. Designer's separate hook is one extra `select where id=?`. Acceptable.

**MIN-3 — `(deleted)` suffix dim color on dark mode borderline AA**
Matches existing muscle subtitle. Accept inherited choice.

**MIN-4 — Drop the proposed unit test**
No existing Supabase mock pattern in `tests/unit/`. Scaffolding for one test duplicates the e2e indirectly. E2E sufficient.

## Designer open questions — rulings

| Q | Ruling |
|---|---|
| Q1 Dim muscle subtitle too? | **No.** Only the suffix. |
| Q2 Unit test scaffolding | **Drop.** E2E sufficient. |
| Q3 `setQueryData` on deleted-detail key | **Keep.** Mirrors existing line-49 pattern; progress screen header updates instantly on rename. |

## Decision

**go** (0 blockers, 1 major, 4 minors).

The major is a test-coverage gap, not a design defect. Implementer adds the picker-exclusion assertion to the same e2e + drops the unit test (MIN-4). MIN-1/2/3 are implementation latitude.
