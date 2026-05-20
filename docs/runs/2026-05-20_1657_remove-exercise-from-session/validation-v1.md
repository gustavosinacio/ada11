# Validation v1 — 2026-05-20_1657_remove-exercise-from-session

## Claims verified true

| # | Claim | Evidence |
|---|---|---|
| 1 | RLS on `sets` is `auth.uid() = user_id` for all 4 verbs, applied per-row on bulk UPDATE | `supabase/migrations/0001_rls_and_seed.sql:25-44` DO block loops over `['sets', ...]` |
| 2 | `.select("id")` after `.update()` returns affected rows array | Pattern used at `src/api/sets.ts:75-86`, `src/api/sessions.ts:64-70`, `src/api/routine-exercises.ts:71-82` (with `.single()`); array form is the supabase-js/PostgREST contract |
| 3 | `adHocExerciseIds`/`exerciseOrderOverride` are session-local React state, lost on reload | `app/(app)/workout/[sessionId].tsx:45,51-53` |
| 4 | `<ExerciseBlock>` is shared by live + history; history wouldn't pass `onRemove` | Live: `workout/[sessionId].tsx:212-254`. History: `history/[id].tsx:244-278` (only `exercise/sets/unit/onAddSet/onUpdateSet/onDeleteSet`) |
| 5 | `confirmDelete` supports message strings, multi-line on web + native | `src/components/confirm-delete.tsx:14-39` |
| 6 | `routine-exercise-row` already uses chevron+chevron+trash cluster | `routine-exercise-row.tsx:80-108`; `Trash2 color="#ef4444" size={18}` |
| 7 | `tests/e2e/crud.spec.ts` covers only quick-start → finish; no exercise-remove coverage | confirmed |
| 8 | `useDeleteSet` invalidates `["sets", sessionId]` + `["stats"]` | `src/hooks/use-sets.ts:60-69` |
| 9 | `softDeleteSet` precedent for single-row pattern | `src/api/sets.ts:119-125` |
| 10 | `<ExerciseBlock>` uses `showReorder = !!onMoveUp \|\| !!onMoveDown` as render gate | `exercise-block.tsx:79,101` |

### Filter placement (open Q3) — VERIFIED correct
The proposed insertion point (after union build, before reorder pass) is **mandatory**: the override loop at `[sessionId].tsx:107-122` uses `out` directly, would resurrect any removed exercise via either the override branch or the trailing append. Filter must run on `out` before the reorder. Design is correct.

## Issues

### Blockers
None.

### Majors

**M1** — `.select("id")` is dead code. Handler reads `setCount` from `setsByExercise` BEFORE the mutation runs (line 173) and discards the resolved value. The `.select()` payload field is wasted.
- Fix: either (a) drop `.select("id")` and return `void` (matches `softDeleteSet`), or (b) keep `.select("id")` and use the returned count to detect M2's race (assert `affected === setCount`; warn-log on drift).

**M2** — `logSet` race is reachable by a fast user, not a ms-timing artifact. Sequence: tap "+ Working set" → tap "Remove" while set-insert is in flight → bulk update misses the new row → set lands with `deleted_at=null` → `removedExerciseIds` still hides the exercise visually but the orphan set persists invisibly into history.
- Fix: add `disabled={logSet.isPending}` to the Remove pressable (one line), OR `await logSet.mutateAsync` before issuing the bulk update.

### Minors

- **m1** — `out` → `filtered` rename ambiguity. `out` is referenced inside the override branch at lines 112, 118 (not just at the insertion point). Spec needs to clarify either rename all references or `const filtered = out.filter(...)` and switch downstream.
- **m2** — `setCount` is read from `setsByExercise` which may be stale if a recent `logSet` invalidation hasn't completed. Copy could be off-by-one. Accept-and-document is sufficient.
- **m3** — `data?.length ?? 0` defensive nullish — supabase-js `.update().select()` returns `[]` not `null`. Cosmetic; moot if M1 (a) is taken.
- **m4** — Trash size 18 vs chevron size 20 inconsistency — matches `routine-exercise-row.tsx` precedent. Leave.
- **m5** — Header layout math: design says "~144px" for the cluster; actual is ~98px. Conclusion (fits at 320pt) is correct; the number is wrong.
- **m6** — `handleRemoveExercise` needs `if (!sessionId) return;` guard. The `??""` fallback would otherwise pass empty `sessionId` to the mutation and invalidate `KEYS.forSession("")`. Existing handlers (`onFinish`) have this guard at line 155.
- **m7** — `removedExerciseIds` must be added to the `orderedExercises` `useMemo` dep array (line 125-131). Without it, the filter runs against a stale closure. Lint would catch but should be explicit.

## Concerns explicitly cleared
- `<ExerciseBlock>` prop addition safe — no other consumer.
- `confirmDelete` `confirmLabel` ignored on web — design acknowledges in Riscos.
- History-detail enablement scoped correctly.
- Empty session after removal uses existing empty state.
- No e2e coverage today — Tester must add a spec arm.

## Decision

**no-go** — 0 blockers, 2 majors, 7 minors. Per rule (≥ 2 majors → `no-go`).

Both majors have one-line fixes; v2 should land in a single Designer revision.

Designer must address in v2:
1. **M1**: drop `.select("id")` (match `softDeleteSet`) OR wire it into race detection.
2. **M2**: add `disabled={logSet.isPending}` to Remove pressable OR await `logSet` before bulk delete.
3. **m1**: clarify `out` → `filtered` rename across all references.
4. **m6**: add `if (!sessionId) return;` guard to `handleRemoveExercise`.
5. **m7**: explicitly add `removedExerciseIds` to `useMemo` dep array.

Round 1 of 3; well within budget.
