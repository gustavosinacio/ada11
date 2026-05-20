# Final summary — 2026-05-20_1657_remove-exercise-from-session

## Outcome
- **Feature**: "Allow user to remove exercise from current session in progress." Each `<ExerciseBlock>` on the live workout screen now has a trash icon (rightmost in the chevron+chevron+trash header cluster); tap → confirm → bulk-soft-delete all non-deleted sets for that exercise in the session + suppress via client-only `removedExerciseIds: Set<string>`.
- **Pipeline result**: **shipped** (typecheck/lint clean, 51/51 unit, 2/2 new e2e, 30/31 adjacent — the one failure is a pre-existing unrelated flake).
- **Baseline commit**: `49aac97`.

## Metrics

| Metric | Value |
|---|---|
| Feature works end-to-end? | yes (web; Playwright 2/2 new + adjacent green) |
| Human interventions | 0 |
| Total round-trips | 1 (1 D↔V respin) |
| Design ↔ Validate rounds | 2 (v1 `no-go`, v2 `go`) |
| Implement ↔ Review rounds | 1 (`pass`) |
| Implement ↔ Test rounds | 1 (`pass`) |
| Implementer soft-callbacks | 0 |
| Wall-clock duration | ~44 min (16:57 → 17:41 BRT) |

## What shipped (4 files + 1 new e2e)

- **EDIT** `src/api/sets.ts` — added `bulkSoftDeleteSetsForExerciseInSession({ sessionId, exerciseId })` returning `Promise<void>`. Mirrors `softDeleteSet` precedent.
- **EDIT** `src/hooks/use-sets.ts` — added `useRemoveExerciseFromSession(sessionId)` mutation. Invalidates `["sets", sessionId]` + `["stats"]`.
- **EDIT** `src/components/exercise-block.tsx` — added optional `onRemove?` + `removeDisabled?` props; render gate updated to `showActions = !!onMoveUp || !!onMoveDown || !!onRemove`; trash icon (`Trash2`, color `#ef4444`, size 18) rendered rightmost with `opacity-30` when disabled (per validator m8, matches chevron precedent).
- **EDIT** `app/(app)/workout/[sessionId].tsx` — `removedExerciseIds: Set<string>` state, `orderedExercises` `useMemo` filter (with `removedExerciseIds` as 6th dep entry), `handleRemoveExercise` handler with `!sessionId || logSet.isPending` early-return + `confirmDelete()` flow + variant copy by `setCount`; wires `onRemove` + `removeDisabled={logSet.isPending}` to each block.
- **NEW** `tests/e2e/remove-exercise.spec.ts` — 2 Playwright scenarios (golden + zero-set variant); both pass.

## Decisions

1. **Hydration suppression** = client-only `removedExerciseIds: Set<string>` (Strategy (a)). Mirrors `adHocExerciseIds` lifecycle. Trade-off: routine-sourced exercises with zero sets reappear after reload. Accepted.
2. **Removal action** = bulk soft-delete via `.update({ deleted_at: now() }).eq().eq().is(deleted_at, null)`. Returns `Promise<void>` (no `.select("id")` — validator M1 fix).
3. **Affordance** = trash icon rightmost in the action cluster. Mirrors `routine-exercise-row.tsx:80-107` pattern.
4. **Confirm copy** variants by `setCount`: with sets ("X logged set(s) will be removed") vs without ("This exercise will be removed").
5. **History-detail screen** does NOT pass `onRemove` — read-only.
6. **`logSet` race protection** = two layers: `removeDisabled={logSet.isPending}` on the button + `if (logSet.isPending) return;` in handler (validator M2 fix).
7. **`opacity-30` for disabled trash** (matches chevron precedent, per validator m8).

## Bugs caught and fixed (Validator → Designer/Implementer)
- **v1 M1**: `.select("id")` was dead code. Dropped; API returns `void`.
- **v1 M2**: `logSet` race reachable by fast user. Fixed with `removeDisabled` prop + handler guard.
- **v1 m1**: `out` → `filtered` rename ambiguity. Explicit `const filtered = ...` + all 3 refs switched.
- **v1 m6**: `!sessionId` guard added to handler.
- **v1 m7**: `removedExerciseIds` added to `useMemo` dep array.

## Known-debt (non-gating)
- **v2 M3** (Validator-acknowledged): `useLogSet(sessionId)` is session-scoped, so `removeDisabled` over-blocks across unrelated exercises. UX cost: brief dimming during any set save. Follow-up: scope per-exercise via `useIsMutating` once mutation keys exist.
- **Client-only suppression**: routine-sourced zero-set exercises reappear after reload (design accepted).
- **Implementation MIN-1**: handler guard split into two `if` statements instead of `||`-joined.
- **Implementation MIN-2**: `if (setCount > 0)` skip around `mutateAsync` is a benign optimization; could use a "why" comment.

## Why we stopped
- Feature complete. All gates green. 1 D↔V respin (typical for a feature with a real race-condition consideration); I↔R + I↔T single-pass.

## Artifacts
- discovery.md, design-v1.md, validation-v1.md, design-v2.md, validation-v2.md
- implementation.md, review-v1.md, test-report-v1.md
- state.md, transcript.md, final-summary.md
- retro.md (post-run, owner)

## Notes for the owner
- **Working tree uncommitted.** Suggested split: `feat(workout): remove exercise from in-progress session` + `docs(pipeline): archive remove-exercise-from-session run`.
- **No migration / no API surface change** beyond a new helper.
- **Backlog after this**: 2 items remaining in `docs/features.md` — measurements-to-profile (already shipped; needs marking done) + soft-deleted exercise visibility in history.

## Archive
- To archive: `cp -r docs/runs/2026-05-20_1657_remove-exercise-from-session "$VAULT/AIground/multi-agent-pipeline/pipeline-runs/2026-05-20_1657_remove-exercise-from-session"` + vault README entry.
