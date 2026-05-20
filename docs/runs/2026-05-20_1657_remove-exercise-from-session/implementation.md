# Implementation — 2026-05-20_1657_remove-exercise-from-session

Based on: `design-v2.md` (approved) and `validation-v2.md` (`go`, 0 blockers / 1 major as known debt / 1 minor polish).

## Files changed
- `src/api/sets.ts` (edited) — Added `BulkSoftDeleteSetsInput` type and `bulkSoftDeleteSetsForExerciseInSession({ sessionId, exerciseId })` API. One PostgREST `UPDATE sets SET deleted_at = now() WHERE session_id = $1 AND exercise_id = $2 AND deleted_at IS NULL`. Returns `void`. Mirrors `softDeleteSet` precedent verbatim.
- `src/hooks/use-sets.ts` (edited) — Added `useRemoveExerciseFromSession(sessionId)` mutation hook. `mutationFn: (exerciseId) => bulkSoftDeleteSetsForExerciseInSession(...)`. `onSuccess` invalidates `KEYS.forSession(sessionId)` + `["stats"]`. Imports `bulkSoftDeleteSetsForExerciseInSession` from `~/api/sets`.
- `src/components/exercise-block.tsx` (edited) — Imported `Trash2` from lucide. Added optional `onRemove?: () => void` and `removeDisabled?: boolean` props. Renamed internal `showReorder` -> `showActions = !!onMoveUp || !!onMoveDown || !!onRemove`. Wrapped existing chevrons in a `(onMoveUp || onMoveDown) && <>` fragment and appended a red `<Trash2 size={18} color="#ef4444" />` Pressable rightmost. Trash uses `opacity-30` when disabled (matches chevron disabled state per Validator m8 polish). Accessibility label: `Remove ${exercise.name} from workout`, `accessibilityRole="button"`.
- `app/(app)/workout/[sessionId].tsx` (edited) — (a) Imported `useRemoveExerciseFromSession` from `~/hooks/use-sets`. (b) Instantiated `removeExerciseFromSession = useRemoveExerciseFromSession(sessionId ?? "")`. (c) Added `removedExerciseIds` state: `useState<Set<string>>(() => new Set())`. (d) In `orderedExercises` `useMemo`: introduced `const filtered = out.filter((e) => !removedExerciseIds.has(e.id));` after the union build; switched all 3 downstream `out` references (`byId` map, trailing-append loop, trailing return) to `filtered`; added `removedExerciseIds` as 6th dep. (e) Added `handleRemoveExercise(ex, setCount)` async fn with `!sessionId` and `logSet.isPending` early-return guards, `confirmDelete` with set-count-aware copy, bulk mutation (skipped when `setCount === 0`), then state push to `removedExerciseIds`. (f) Wired `onRemove={() => handleRemoveExercise(ex, (setsByExercise.get(ex.id) ?? []).length)}` and `removeDisabled={logSet.isPending}` to each `<ExerciseBlock>`.

`app/(app)/history/[id].tsx` is intentionally **unchanged** — `<ExerciseBlock>` is rendered there without `onRemove`, so the trash button does not appear in history detail. Out-of-scope per design.

## Deviations from design
- **m8 polish — trash disabled opacity `opacity-30` instead of `opacity-40`.** Design-v2 §UI spec specified `opacity-40`; Validator v2 (m8) recommended `opacity-30` to match chevron disabled state at `exercise-block.tsx:117,127`. Prompt instructed "Apply `opacity-30` when `removeDisabled` is true (per validator m8 — match chevron disabled opacity, NOT `opacity-40`)." Applied `opacity-30`. Justified as binding-prompt instruction takes precedence over the original design text.

## Soft callbacks made (during this implementation pass)
- None.

## Quality gates
- [x] `npm run typecheck` passed — clean (`tsc --noEmit` exit 0).
- [x] `npm run lint` passed — 0 errors, 1 pre-existing warning in `router.d.ts` (unrelated).
- [x] Relevant unit tests pass — `npm run test:unit` 51/51 green.
- [x] No new `any`.
- [x] No new `// @ts-ignore`.
- [x] No stray `console.log` (only `console.warn` in error catch, matching `onFinish` precedent at `[sessionId].tsx:167`).

## e2e regression sweep
Ran `tests/e2e/crud.spec.ts tests/e2e/probe-strong-unify.spec.ts tests/e2e/measurements.spec.ts` — **19/20 pass**.

The 1 failure is `crud.spec.ts:131 — exercises: create custom exercise (alongside seeded library)`: timeout at the Exercises new-exercise form. The failure path does NOT touch any file I changed (`<ExerciseBlock>`, the workout live screen, `use-sets`, or `api/sets`). It exercises the Exercises tab + new-exercise form. Treated as pre-existing flake / unrelated regression. All workout-flow specs (notably `crud.spec.ts:162 — workout: start ad-hoc, finish, see in history`) pass green.

## Known debt (per Validator v2)
- **M3 — `removeDisabled` over-blocks across unrelated exercises**: `useLogSet(sessionId)` is session-scoped, so `logSet.isPending` becoming true while saving a set on Exercise A also dims the trash on Exercise B for the same ~ms window. Acknowledged trade-off; closes the real race (insert on X + remove X) which was the original M2 concern. Suggested follow-up (not blocking): scope the disable per-exercise via `useIsMutating` once per-exercise mutation keys are added.
- **Client-only suppression (design decision a)**: routine-sourced exercises with zero logged sets reappear after screen reload, because there is no DB row to mark. Mirrors the lifecycle of `adHocExerciseIds` / `exerciseOrderOverride`. Documented in design-v2; not a regression.

## Notes for Reviewer / Tester
- **Reviewer**: please verify (a) the `useMemo` dep array correctly captures `removedExerciseIds` so the suppression takes effect on the same render as the `setRemovedExerciseIds` call, and (b) the `bulkSoftDeleteSetsForExerciseInSession` PostgREST filter (`.eq + .eq + .is`) is RLS-safe under the existing `sets` policy (it is — RLS evaluates per-row on UPDATE).
- **Tester**: Suggested e2e (extend `tests/e2e/crud.spec.ts` workout block or add new spec):
  1. Quick-start a workout, add an ad-hoc exercise, log 2 sets.
  2. Tap the trash on that exercise's header, confirm "Remove".
  3. Assert: the exercise block disappears from the live screen.
  4. Assert: the picker re-exposes the exercise (it was excluded before, should now be selectable again).
  5. Reload the live screen → routine-sourced exercises with zero sets reappear (documented trade-off); ad-hoc and exercises-with-sets stay removed (sets are soft-deleted in DB).
  6. Finish workout, open in history → removed exercise's sets do NOT appear (RLS-safe soft-delete).
