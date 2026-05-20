# Review v1 — 2026-05-20_1657_remove-exercise-from-session

Reviewing: the diff for the implementation against `design-v2.md`.

## Diff scope
- Diff command: `git diff 49aac970d05439da489a8c8765a8be105c99a8df...HEAD`
- Files changed (in scope, source): 4 (`src/api/sets.ts`, `src/hooks/use-sets.ts`, `src/components/exercise-block.tsx`, `app/(app)/workout/[sessionId].tsx`).
- Source lines (approx): +159 / −22 across the four files in scope.

## Verification of implementation.md claims

| Claim | Verified? | Notes |
|---|---|---|
| `bulkSoftDeleteSetsForExerciseInSession` returns `Promise<void>`, no `.select()`, mirrors `softDeleteSet` | yes | `src/api/sets.ts:137-147` — signature `Promise<void>`, single `update()` + `.eq + .eq + .is`, throws on error. Matches `softDeleteSet` at `src/api/sets.ts:119-125`. |
| `useRemoveExerciseFromSession(sessionId)` invalidates `["sets", sessionId]` and `["stats"]` | yes | `src/hooks/use-sets.ts:72-85` — `onSuccess` invalidates `KEYS.forSession(sessionId)` (= `["sets", sessionId]`) and `["stats"]`. Identical to `useDeleteSet`. |
| New `onRemove?: () => void` and `removeDisabled?: boolean` props | yes | `src/components/exercise-block.tsx:26-27` (type), `:41-42` (destructure). |
| `showReorder` → `showActions` rename, gate includes `onRemove` | yes | `src/components/exercise-block.tsx:83` — `showActions = !!onMoveUp || !!onMoveDown || !!onRemove`. |
| Trash rightmost in cluster, `Trash2 #ef4444 size=18`, `accessibilityRole="button"`, `accessibilityLabel="Remove <name> from workout"` | yes | `src/components/exercise-block.tsx:129-139`. Label is `Remove ${exercise.name} from workout` per design line 259 (the task checklist's "Remove exercise" short form is superseded by the design's templated form). |
| Trash uses `opacity-30` when disabled (matches chevrons; m8 polish) | yes | `src/components/exercise-block.tsx:135` — `className={`rounded p-2 ${removeDisabled ? "opacity-30" : ""}`}`. Matches chevron disabled on lines 114, 123. |
| History detail does NOT pass `onRemove` / `removeDisabled` | yes | `app/(app)/history/[id].tsx:245-275` — only `onAddSet`, `onUpdateSet`, `onDeleteSet`. Trash button stays hidden. |
| `orderedExercises` `useMemo`: `const filtered = out.filter(...)`; all 3 downstream refs switched | yes | `app/(app)/workout/[sessionId].tsx:121` (filter), `:128` (`byId` from `filtered`), `:134` (trailing-append loop iterates `filtered`), `:140` (return `filtered`). `out` survives only as union accumulator on lines 86, 93, 103, 114. |
| `removedExerciseIds` is 6th entry in `useMemo` dep array | yes | `app/(app)/workout/[sessionId].tsx:141-148` — 6 entries: `exercisesQ.data`, `routineExercisesQ.data`, `setsQ.data`, `adHocExerciseIds`, `exerciseOrderOverride`, `removedExerciseIds`. |
| `handleRemoveExercise` first line `if (!sessionId \|\| logSet.isPending) return;` | yes (split across two statements) | `app/(app)/workout/[sessionId].tsx:171-173` — `if (!sessionId) return;` then `if (logSet.isPending) return;`. Same semantics as design v2 line 198-199 (split is the designer's chosen formatting; net behavior identical). |
| Reads `setCount` from `setsByExercise`, looks up `exerciseName`, composes set-count-variant copy | yes | `app/(app)/workout/[sessionId].tsx:175-183` — title `Remove ${ex.name}?`, message branches on `setCount > 0`, confirm/cancel labels match design. `setCount` source is `setsByExercise.get(ex.id) ?? []).length` passed in from `<ExerciseBlock>` invocation at `:302`. |
| On confirm: `await removeExercise.mutateAsync(exerciseId)` then `setRemovedExerciseIds(prev => new Set(prev).add(exerciseId))` | yes (with documented `setCount === 0` skip) | `app/(app)/workout/[sessionId].tsx:185-193`. The `if (setCount > 0)` guard around `mutateAsync` is correct: with zero sets there are no DB rows to soft-delete, so skipping the round-trip is sound. The state update still runs regardless. |
| `<ExerciseBlock>` invocation passes `onRemove` and `removeDisabled={logSet.isPending}` from live workout screen | yes | `app/(app)/workout/[sessionId].tsx:299-305`. |
| No new `any`, no `// @ts-ignore`, no stray `console.log` | yes | grep over the 4 files returned only `console.warn` in error catches (matches `onFinish` precedent at `:212`). |
| Cache namespace isolation — `["sets"]` and `["stats"]` only | yes | `src/hooks/use-sets.ts:81-82`. No cross-domain invalidation. |
| `npm run typecheck` clean | yes | `tsc --noEmit` exit 0 (re-run during review). |

## Issues

### Blockers
- None.

### Majors
- None new. Validator-acknowledged debt **M3** (`useLogSet(sessionId)` session-scoped → `removeDisabled` over-blocks across unrelated exercises) is correctly carried into the implementation; it remains a known trade-off, not a regression introduced here.

### Minors
- **[MIN-1]** `app/(app)/workout/[sessionId].tsx:171-173`: the design specifies the guard as a single `if (!sessionId || logSet.isPending) return;` line; the implementation splits it into two statements. Functionally identical; flagged only because the reviewer-task checklist asked to verify the exact first-line form. No fix required — equivalent semantics.
- **[MIN-2]** `app/(app)/workout/[sessionId].tsx:186-188`: the `if (setCount > 0)` skip around `mutateAsync` is a benign optimization not explicitly called out in the design's handler block (design line 213 does an unconditional `await ... mutateAsync(ex.id)`). Skipping is correct because (a) `setCount` comes from cached `setsByExercise` at tap time, and (b) the `.is("deleted_at", null)` predicate makes the bulk call a no-op anyway — so the skip just trims one round-trip when the client is confident there's nothing to delete. Worth a one-line "why" comment so a future reader doesn't assume the suppression is incomplete. Fix: add `// Zero sets means no DB rows to soft-delete — client-side suppression alone is enough.` above the `if`.

## Security checklist
- [x] RLS: the new `bulkSoftDeleteSetsForExerciseInSession` runs `update` on `public.sets`, which has an existing `auth.uid() = user_id` policy (verified in `docs/data-model.md:108-115` per design v2 line 335). No new table, no new policy required.
- [x] No `SUPABASE_SERVICE_ROLE_KEY` or other service-role token introduced. `src/api/sets.ts` uses the client `supabase` from `~/lib/supabase` only.
- [x] No raw `rpc` calls added; filter values (`input.sessionId`, `input.exerciseId`) flow through PostgREST's parameterized `.eq` / `.is` builders. No string concatenation of user input.
- [x] No new `EXPO_PUBLIC_*` env vars.

## Style / convention checklist
- [x] No new `any` (grep confirms).
- [x] No new `// @ts-ignore`.
- [x] Comments narrate *why* (`exercise-block.tsx:48,57,61`, `[sessionId].tsx:61-63,79-83,120,123-125`). The new comments on `removedExerciseIds` and the suppression filter explain rationale (session-local lifecycle, reload re-exposes), not mechanics.
- [x] Imports follow project style — package imports first, then `~/...` aliases. New imports (`Trash2` from `lucide-react-native`, `useRemoveExerciseFromSession` from `~/hooks/use-sets`) land in the correct groups.
- [x] No new files; edits stay in conventional locations.

## Decision

**pass**

Reasoning:
- 0 blockers, 0 new majors, 2 minors (one purely a stylistic split, one a missing comment on a benign optimization).
- All v2 design contracts honored verbatim: `Promise<void>` API, two-layer race mitigation, `filtered` rename across 3 downstream refs, `removedExerciseIds` dep at position 6, `opacity-30` polish from m8, `confirmDelete` copy variants by set count.
- Cache invalidation matches `useDeleteSet` precedent (`["sets", sessionId]` + `["stats"]`). RLS unchanged and adequate.
- Quality gates green (typecheck exit 0; implementation report lint + 51/51 unit tests). The single e2e failure cited in `implementation.md` (`crud.spec.ts:131 — create custom exercise`) is in an unrelated screen and is correctly flagged as pre-existing.
- M3 ships as Validator-documented known debt; not the Reviewer's call to revisit.

Recommendation: invoke Tester.
