# Final summary — 2026-06-01_1301_favorite-exercises-e1rm

## Outcome
- **Feature**: Phase 2b — favorite exercises. A star toggle on the exercise detail page (`progress.tsx`) marks an exercise as a favorite; favorited+plottable exercises are pinned INTO the Phase-2a "Estimated 1RM per exercise" chart in addition to the auto-selected most-performed top-5.
- **Pipeline result**: **shipped** (Tester PASS on the final round; migration `0020` applied to the live DB; all gates green).
- **Branch / final commit**: `main`, baseline `5a0b86e`. Favorites changes uncommitted at summary time — Conductor commits next; final batch push + deploy after.

## Metrics

| Metric | Value |
|---|---|
| Feature works end-to-end? | yes (Tester proved on the live DB: favoriting a non-top-5 exercise ("Lat Pulldown") makes it appear in the e1RM chart, count 5→6; unfavorite removes it; toggle persists POST 201; RLS arm green) |
| Human interventions during run | 0 (owner pre-authorized the batch + migration application) |
| Total round-trips | D↔V ×2, I↔R ×1, I↔T ×2 |
| Design ↔ Validate rounds | 2 (round 1 NO-GO: MAJ-1 union semantics took top-N of the non-favorite pool; round 2 GO with top-N-overall ∪ favorites) |
| Implement ↔ Review rounds | 1 (PASS first round) |
| Implement ↔ Test rounds | 2 (round 1 FAIL: test-only — the e2e returned via a hard `page.goto` reload racing persistence + a stale-cache rehydration; round 2 PASS after client-side nav + waitForResponse) |
| Implementer soft-callbacks | 0 |
| Wall-clock duration | ~01:55 (13:01 → ~14:56 BRT) |
| Token cost | n/a |

## What shipped (scope)
- **New** `supabase/migrations/0020_user_exercise_favorites.sql`: per-user join table `user_exercise_favorites(user_id, exercise_id, created_at)`, composite PK, FK CASCADE (both), RLS + 3 policies (SELECT/INSERT/DELETE, `auth.uid() = user_id`). **Applied to the live Supabase DB** by the Conductor (`0020|0020|0020`).
- **New** `src/api/exercise-favorites.ts` (plain INSERT swallow-23505 / DELETE / list) + `src/hooks/use-exercise-favorites.ts` (optimistic toggle, key `["exercise_favorites","me"]`).
- **Edited** `src/utils/e1rm-strength.ts`: `presentTopExerciseE1rm` gains `favoriteExerciseIds?: ReadonlySet<string>`; the `.slice(0, topN)` becomes **top-N-overall ∪ favorites** (deduped, dense ranks), capped at `E1RM_MAX_LINES=12` dropping lowest non-favorites first. **Invariant F**: empty/absent favorites → byte-for-byte the old output.
- **Edited** `src/components/e1rm-strength-section.tsx`: reads `useMyFavoriteExerciseIds()` (a `useMemo` dep so the chart re-renders on toggle); palette extended 8→12 (first 8 hexes byte-for-byte unchanged).
- **Edited** `app/(app)/exercises/[id]/progress.tsx`: star toggle in the header-right, OUTSIDE the `canEdit` gate (canonical exercises favoritable), unique a11y label `"Favorite/Unfavorite <Name>"` (no collision with the legend's `"Toggle <Name>"`); Pencil stays `canEdit`-gated.
- **Tests**: +22 unit (455→477) covering the union (favorite-in-top-N no-op, favorite-outside → +1, bodyweight-only excluded, cap boundaries, dense ranks, determinism, Invariant F deep-equal) + the API; an RLS arm in `tests/rls.test.ts` (A insert, B blocked); a new e2e (`favorite-exercises-e1rm.spec.ts`, 3 steps, deterministic).

## Key decisions
- **Combine rule = top-N-overall ∪ favorites, deduped** (the round-1 NO-GO fix — favoriting an already-top-N exercise is a no-op; outside adds exactly that line). Ordering top-N first then extras, dense ranks, so adding a favorite doesn't shift existing lines' colors.
- **Cap = 12 lines**, palette extended to 12, drop lowest non-favorites first (favorites guaranteed visible).
- **Plain INSERT/DELETE** (no 42P10 upsert trap — non-partial composite PK); idempotent INSERT swallows 23505.
- **FK CASCADE** for the favorite pointer (vs the notes-table RESTRICT) — a favorite is disposable, not authored content.
- A favorited bodyweight-only exercise can't plot (Invariant D) → excluded from the chart, but the favorite row persists.

## Gate results (Tester-observed, final round)
- typecheck 0 · lint 0 errors/1 pre-existing · unit 477/477 · web export builds.
- RLS arm green (A insert; B cannot SELECT/DELETE/spoof-INSERT).
- `favorite-exercises-e1rm.spec.ts` 4/4 across repeats (0 flake) after the round-2 nav fix.
- Regression: canonical-exercise-gating 5/5, exercise-progress-ia 4/4, e1rm-strength 3/3 (no header-rewrite regression).

## The two FAIL→fix cycles (both narrow)
- **D↔V round 1 NO-GO (MAJ-1):** the union took `nonFavorites.slice(0, topN)` (top-N of the non-favorite pool), which would promote a hidden line when favoriting an already-top-N exercise and contradicted the design's own test. Fixed to top-N-overall ∪ favorites.
- **I↔T round 1 FAIL (test-only):** the e2e returned to the chart via `page.goto` (hard reload) racing the optimistic write's persistence + a stale-cache rehydration. Fixed test-only: client-side Progress-tab nav + `waitForResponse` on the toggle write. Feature code unchanged.

## Out of scope (tracked / parked)
- Separate favorites screen; favoriting from other surfaces; favorites affecting the volume/muscle chart; reordering favorites; adding `["exercise_favorites"]` to the pull-to-refresh fan-out (Alt 11). Phase-2a deferred items (leverage factors, secondary-muscle, dose-metric) remain out.

## Artifacts
- [`state.md`](./state.md), [`discovery.md`](./discovery.md), [`design-v1.md`](./design-v1.md), [`design-v2.md`](./design-v2.md), [`validation-v1.md`](./validation-v1.md), [`validation-v2.md`](./validation-v2.md), [`implementation.md`](./implementation.md), [`review-v1.md`](./review-v1.md), [`test-report-v1.md`](./test-report-v1.md), [`test-report-v2.md`](./test-report-v2.md), [`transcript.md`](./transcript.md)
- `screenshots/favorite-line-in-chart.png`

## Bugs found post-merge (backfill within 7 days)
- (none yet)

## Notes
- Owner data gut-check (carried from the earlier batch) still pending on the bodyweight-volume + e1RM numbers.

## Archive
- Archived to vault: `$VAULT/AIground/multi-agent-pipeline/pipeline-runs/2026-06-01_1301_favorite-exercises-e1rm/` on 2026-06-01 ~14:57 BRT.
