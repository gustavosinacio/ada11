# Implementation — 2026-05-20_2034_soft-deleted-exercises-in-history

Based on: `design-v1.md` (approved) and `validation-v1.md` (`go`, 0/1/4).

## Files changed

- `src/api/exercises.ts` (edited) — added sibling helpers `listAllExercises()` and `getAnyExercise(id)` that omit the `.is("deleted_at", null)` filter. Existing `listExercises` / `getExercise` untouched. (+28 lines)
- `src/hooks/use-exercises.ts` (rewrite) — added `KEYS.allIncludingDeleted = ["exercises", "all"]` and `KEYS.detailIncludingDeleted(id) = ["exercises", "all", id]`, plus new `useAllExercises()` / `useAllExercise(id)` hooks. Documented prefix-matching invalidation contract in a comment block on `KEYS`. `useUpdateExercise` now `setQueryData`s BOTH detail keys after mutate (mirrors validator Q3 ruling). All three mutations keep a single `invalidateQueries({ queryKey: KEYS.all })`, which prefix-invalidates BOTH list keys and every detail variant (MIN-1 dual-call avoided in favor of single prefix call + comment). (+32 lines)
- `app/(app)/history/[id].tsx` (edited) — swapped `useExercises` → `useAllExercises`; left a comment noting that the page-level `ExercisePicker` still uses the filtered hook so soft-deleted exercises stay un-addable.
- `app/(app)/workout/[sessionId].tsx` (edited) — same swap; comment notes both reasons (routine-exercises embedded-join leak + mid-session soft-delete safety).
- `app/(app)/exercises/[id]/progress.tsx` (edited) — `useExercise(id)` → `useAllExercise(id)` so the chart header title resolves for soft-deleted ids.
- `src/components/exercise-block.tsx` (edited) — appended a `(deleted)` suffix to the header `<Text>` when `exercise.deleted_at != null`. Sub-`<Text>` with classes `text-base font-normal text-gray-500`. No new prop; reads `exercise.deleted_at` straight off the existing `ExerciseRow` prop. (+3 lines)
- `tests/e2e/soft-deleted-exercises-in-history.spec.ts` (new) — Playwright spec that: creates user → creates custom exercise X via the Exercises UI (chip-based muscle picker) → quick-starts workout → adds X via picker → logs 2 working sets → finishes → opens history detail (asserts block + Total 2 sets + NO suffix yet) → navigates to Exercises tab → opens X → Pencil to edit → taps Delete exercise → confirms → re-opens same history detail (asserts block STILL renders + `(deleted)` suffix visible + Total 2 sets unchanged) → taps Add exercise → asserts picker empty-state ("No exercises match…") for the soft-deleted exercise filter (MAJOR-1 fix). Test passed twice with `--repeat-each=2`.

## Deviations from design

- **MIN-1 ruling — dual-invalidation calls.** Design wrote both `qc.invalidateQueries({ queryKey: KEYS.all })` AND `qc.invalidateQueries({ queryKey: KEYS.allIncludingDeleted })` per mutation. Validator explicitly granted implementer latitude: "Designer's 'invalidate both' is harmless redundancy. Implementer's choice: drop one call OR keep for grep-ability." Implemented as **single call** + a documented comment on `KEYS` explaining the prefix-match. Reason: avoids a second refetch per mutation, removes a class of "did you remember to add the second invalidate" bugs in future mutations.
- **MIN-4 ruling — drop the unit test.** Design proposed `tests/unit/list-all-exercises.test.ts`. Validator: "Drop. E2E sufficient." Not added.
- **Q1 / Q2 / Q3 rulings applied.** Q1 (only suffix dimmed, not muscle subtitle) — followed. Q2 (drop unit test) — followed. Q3 (keep `setQueryData` on deleted-detail key in `useUpdateExercise`) — followed (`KEYS.detailIncludingDeleted(row.id)` is written alongside `KEYS.detail(row.id)`).
- **E2E hardening (not a design deviation; implementer judgment).** After the create-exercise step the e2e waits for the row to appear in the picker via `expect(getByText(exName)).toBeVisible({ timeout: 15_000 })` BEFORE clicking it. Without this gate, the test flaked once because the picker rendered before the `["exercises"]` invalidation refetch completed. Pure flake-resilience, no behavior change.
- **Picker-exclusion assertion shape.** MAJOR-1 asked: "assert deleted exercise is absent from picker list." Implemented as: filter picker by the exact name, then assert the empty-state copy ("No exercises match. Add one from the Exercises tab.") is visible. Stronger than a screen-wide `toHaveCount(0)` against the exercise name, because (a) the history detail behind the modal renders the deleted-exercise name in its block, and (b) the empty-state proves the filter was applied — not just that the locator missed.

## Soft callbacks made (during this implementation pass)

- None.

## Quality gates

- [x] `npm run typecheck` passed — `tsc --noEmit` clean, no diagnostics.
- [x] `npm run lint` passed — 0 errors, 1 pre-existing warning in `router.d.ts` (untouched by this run).
- [x] Relevant unit tests pass — **74/74** in 851 ms (`npm run test:unit`).
- [x] No new `any`.
- [x] No new `// @ts-ignore`.
- [x] No stray `console.log` (existing `console.warn` in error handlers untouched).

## E2E results

- **New spec** (`tests/e2e/soft-deleted-exercises-in-history.spec.ts`) — **passed twice** under `--repeat-each=2` (run durations: 25.9s, 30.8s, 29.4s, 35.2s across separate invocations).
- **Adjacent sweep** (`tests/e2e/crud.spec.ts tests/e2e/measurements.spec.ts tests/e2e/probe-strong-unify.spec.ts tests/e2e/remove-exercise.spec.ts`):
  - `crud.spec.ts:131` ("exercises: create custom exercise") — **pre-existing failure**, unrelated to this run. The test calls `getByPlaceholder("e.g. Chest")` on the muscles input, but `src/components/muscle-group-picker.tsx` was refactored to a chip-based picker in commit `b51dd01` ("feat: exercises track muscles as required multi-select array") — the most recent commit on main, before this run started. My changes don't touch the muscle picker, the create flow, or this test. Verified via `git diff --stat HEAD -- src/ app/ tests/`.
  - `probe-strong-unify.spec.ts:162`, `probe-strong-unify.spec.ts:188`, `remove-exercise.spec.ts:92`, `remove-exercise.spec.ts:189` — **infrastructure failure mid-run**: `net::ERR_CONNECTION_REFUSED at http://localhost:8081`. The user-managed Expo web dev server crashed partway through the long sweep. Not a code issue; needs a re-run after `npm run web` is restarted. The 14 tests that ran before the crash all passed.

## Notes for Reviewer / Tester

- **Reviewer**: please confirm the prefix-invalidation argument under TanStack Query v5 semantics — `invalidateQueries({ queryKey: ["exercises"] })` defaults to `exact: false` and invalidates every query whose key starts with `["exercises"]`, including `["exercises"]`, `["exercises", id]`, `["exercises", "all"]`, and `["exercises", "all", id]`. The comment block on `KEYS` in `src/hooks/use-exercises.ts` documents this assumption.
- **Reviewer**: please verify the picker + Exercises library list (`src/components/exercise-picker.tsx:14,26` and `app/(app)/exercises/index.tsx:6,11`) were NOT changed — they MUST stay on `useExercises()` so soft-deleted exercises remain un-addable / un-listed. Verified via `git diff --stat`: those files are not in the touched set.
- **Reviewer**: the `(deleted)` suffix renders as `text-base font-normal text-gray-500`. Validator MIN-3 flagged dark-mode AA contrast as borderline but accepted the inherited choice.
- **Tester**: re-run the adjacent sweep after the dev server is restarted. Expected: `crud.spec.ts:131` continues to fail for the documented pre-existing reason; all other sweep tests pass.
- **Tester**: the new e2e ran twice clean (`--repeat-each=2`); flake-resilience already added (see Deviations).
