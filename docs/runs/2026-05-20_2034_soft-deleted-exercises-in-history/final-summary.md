# Final summary — 2026-05-20_2034_soft-deleted-exercises-in-history

## Outcome
- **Feature**: Soft-deleted exercises remain fully visible in past workout history. New parallel `useAllExercises()` / `useAllExercise(id)` hooks include soft-deleted rows; 3 history-side consumers swapped (`history/[id].tsx`, `workout/[sessionId].tsx`, `exercises/[id]/progress.tsx`). Picker + Exercises library stay on the filtered `useExercises()`. `<ExerciseBlock>` shows a `(deleted)` suffix when the exercise has `deleted_at != null`.
- **Pipeline result**: **shipped** (typecheck/lint clean, 74/74 unit, e2e 5/5 under `--repeat-each=5`).
- **Baseline commit**: `52d7a76`.

## Metrics

| Metric | Value |
|---|---|
| Feature works end-to-end? | yes (web; Playwright 5/5 stress test + adjacent green) |
| Human interventions | 0 |
| Total round-trips | 1 (1 I↔T respin, test-only fix) |
| Design ↔ Validate rounds | 1 (`go` single-pass) |
| Implement ↔ Review rounds | 1 (`pass` single-pass) |
| Implement ↔ Test rounds | 2 (v1 `fail` flake → v2 `pass`) |
| Implementer soft-callbacks | 0 |
| Wall-clock duration | ~94 min (20:34 → 22:08 BRT) |

## What shipped (7 production files + 1 e2e)

**New API helpers** (`src/api/exercises.ts`):
- `listAllExercises()` — omits `deleted_at IS NULL` filter.
- `getAnyExercise(id)` — omits filter.

**New hooks** (`src/hooks/use-exercises.ts`):
- `useAllExercises()` on `["exercises", "all"]`.
- `useAllExercise(id)` on `["exercises", "all", id]`.
- All 3 mutations (`useCreateExercise`, `useUpdateExercise`, `useSoftDeleteExercise`) prefix-invalidate `["exercises"]` (TanStack v5 default `exact: false` covers both filtered and `"all"` keys). `useUpdateExercise` additionally `setQueryData(KEYS.detail(id), row)` AND `setQueryData(KEYS.detailIncludingDeleted(id), row)` so progress header updates instantly on rename.

**Consumer swaps** (3 files):
- `app/(app)/history/[id].tsx` — `useExercises()` → `useAllExercises()`.
- `app/(app)/workout/[sessionId].tsx` — same swap (live workout: if a routine includes a soft-deleted exercise, the block now renders).
- `app/(app)/exercises/[id]/progress.tsx` — `useExercise(id)` → `useAllExercise(id)`. Defensive for stale-cache scenarios.

**Untouched** (intentional):
- `src/components/exercise-picker.tsx` — stays on `useExercises()`. Picker MUST exclude soft-deleted.
- `app/(app)/exercises/index.tsx` (library list) — stays on `useExercises()`.
- `app/(app)/exercises/[id]/index.tsx` (edit screen) — stays on `useExercise()` so soft-deleted exercises 404 (no in-app path navigates here for a soft-deleted exercise).

**UI marker** (`src/components/exercise-block.tsx`):
- Adds `(deleted)` suffix to the header text when `exercise.deleted_at != null`. Uses existing muscle-subtitle styling (`text-sm text-gray-500`). No new prop — reads from the already-passed `ExerciseRow`.

**E2E test** (`tests/e2e/soft-deleted-exercises-in-history.spec.ts`):
- Golden path: create exercise → log sets → soft-delete → re-open history → confirm block + suffix + totals consistency.
- MAJOR-1 regression guard: tap "Add exercise" on history detail → confirm picker EXCLUDES the soft-deleted exercise.
- Stable under `--repeat-each=5` (5/5 pass at ~56s/iteration).

## Decisions

1. **Pattern (a)**: separate `useAllExercises()` hook (not a `{ includeDeleted }` flag). Mirrors `use-sets.ts` two-hook split. Picker physically can't regress because it's untouched.
2. **Cache key** = `["exercises", "all"]` for the list, `["exercises", "all", id]` for the detail. TanStack v5 prefix matching means a single `invalidateQueries({ queryKey: ["exercises"] })` covers both.
3. **Single invalidation per mutation** (validator MIN-1 latitude). Comment near `KEYS` documents the prefix-matching behavior.
4. **`(deleted)` suffix** in the header — discoverable without being noisy. Matches typical audit-trail UX.
5. **Edit screen stays on `useExercise()`** — soft-deleted 404 is intentional; no in-app path reaches it.
6. **No unit test** (Validator MIN-4) — e2e proves the contract indirectly. No need to scaffold a Supabase mock for one test.

## Bugs caught by the pipeline
- **Validator MAJOR-1**: e2e initially missed the picker-exclusion regression guard. Implementer added the assertion before submitting for review.
- **Tester v1 fail**: new e2e was flaky (~40% under stress) due to persisted-cache refetch race on history re-mount. Implementer fixed with a 32s staleTime wait + explicit `waitForResponse` sync point — production code untouched. 13/13 under stress on re-test.

## Known-debt (non-gating)
- 4 Reviewer advisory minors: theoretical UUID-vs-`"all"` key collision (unreachable), `useAllExercise(undefined)` fallback (inherited pattern), dark-mode contrast (matches existing subtitle), high comment density.
- Adjacent finding from Discovery (out of scope for this run): `src/api/routine-exercises.ts:19` embedded join doesn't filter `deleted_at` on the embedded select — separate decision for a future pipeline run.
- e2e iteration time grew to ~56s due to the `staleTime` wait. Acceptable trade-off to avoid touching production. If a future refactor adds `refetchOnMount: 'always'` on the unfiltered list, the wait can be removed.

## Why we stopped
- Feature complete. All gates green under stress. Bug caught, isolated, surgical fix; pipeline acted as designed.

## Artifacts
- discovery.md, design-v1.md, validation-v1.md
- implementation.md, review-v1.md, test-report-v1.md
- implementation-v2.md (fix round), test-report-v2.md
- state.md, transcript.md, final-summary.md
- retro.md (post-run, owner)

## Notes for the owner
- **Working tree uncommitted.** Suggested split: `feat(history): show soft-deleted exercises with (deleted) suffix` + `docs(pipeline): archive soft-deleted-exercises-in-history run`.
- **No DB / RLS change.** Pure API + hook + consumer swap.
- **Backlog after this**: empty. All `docs/features.md` items complete.

## Archive
- To archive: `cp -r docs/runs/2026-05-20_2034_soft-deleted-exercises-in-history "$VAULT/AIground/multi-agent-pipeline/pipeline-runs/2026-05-20_2034_soft-deleted-exercises-in-history"` + vault README entry.
