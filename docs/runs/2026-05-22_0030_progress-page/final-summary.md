# Final summary — 2026-05-22_0030_progress-page

## Outcome

- **Feature**: New Progress tab + page. Top-level surface for momentum visibility. Hero (`PRs this week` + weekly volume `Max · Now · To PR`) / Bars (extended weekly-volume strip with lifetime-best overlay) / List (exercises trained this week, grouped by `muscles[0]`, each with per-exercise `Max · Now · To PR`) / Streak card (`current · best`). All comparisons anchored to **lifetime best**, not previous-period.
- **Pipeline result**: **shipped**.
- **Branch / final commit**: `main`. Working tree dirty — not yet committed.

## Metrics

| Metric | Value |
|---|---|
| Feature works end-to-end? | yes (158/158 unit, 23/23 e2e, iPhone 375 manual smoke clean, cold-start 2.96s) |
| Human interventions during run | 1 (mid-run "add a few things to features list, start them after" — non-blocking, queued for follow-up runs) |
| Total round-trips (sum of all loops) | 4 (D↔V 3, I↔R 1, I↔T 1) |
| Design ↔ Validate rounds | 3 (v1 `no-go` 2 blockers + 3 majors → v2 `no-go` 1 blocker + 1 major → v3 `go` 0 blockers + 3 minors) |
| Implement ↔ Review rounds | 1 (`pass`) |
| Implement ↔ Test rounds | 1 (`pass`) |
| Implementer soft-callbacks | 0 |
| Wall-clock duration | ~80 min (00:30 → 01:50 BRT) |
| Token cost (if known) | n/a |

## What shipped

**14 files** (10 new, 4 edited):

**New:**
- `app/(app)/progress/_layout.tsx`
- `app/(app)/progress/index.tsx`
- `src/api/progress-page.ts` — `listFinishedSessionStartedAts`
- `src/utils/progress-page-math.ts` — pure helpers (`bucketLifetimeWeeklyVolumes`, `findBestWeek`, `computeCurrentWeekVolume`, `computeLifetimeMaxPerExercise`, `computePrExerciseIdsThisWeek`, `groupExercisesByPrimaryMuscle`, `computeStreaks`)
- `src/hooks/use-progress-page.ts` — `useLifetimeWeeklyVolume`, `useFinishedSessionStartedAts`, `useExercisesThisWeek`, `usePrsThisWeek`, `useStreaks`, `useLifetimeBestWeek`
- `src/components/progress-hero.tsx`
- `src/components/exercises-this-week-list.tsx`
- `src/components/streak-card.tsx`
- `src/components/max-now-to-pr-line.tsx` — shared display component
- `tests/unit/progress-page-math.test.ts` — 59 unit tests
- `tests/e2e/progress-page.spec.ts` — 7 e2e cases

**Edited:**
- `app/(app)/_layout.tsx` — 5th tab `progress` with `TrendingUp` icon between `history` and `measurements` (visible order: History → Progress → Profile because `measurements` is `href:null`).
- `src/api/stats.ts` — extended `listWeeklyVolumeRows` to support unbounded reads via `.range()` pagination; both branches now filter `.not("completed_at", "is", null)`; `WeeklyVolumeRow` augmented with `exercise_id` + `session_id`; `completed_at` narrowed to `string`; post-fetch defensive assertion.
- `src/hooks/use-stats.ts` — new `useLifetimeWeeklyVolume` under `["stats", "weekly-volume", "lifetime"]` key (with `staleTime: 60_000`).
- `src/components/weekly-volume-strip.tsx` — new optional props `bestWeekKg` + `bestWeekLabel`. Rescaled height formula: `denom = Math.max(model.maxKg, bestWeekKg ?? 0)`. Renders dotted overlay line at the best-week y-position. Byte-identical to previous behaviour when called with no props (preserves History mount).

## Decisions made during the run

1. **(Option A) Paginated `.range()` reads** for the lifetime weekly aggregate (not a new Postgres aggregate function).
2. **`muscles[0]` grouping** with `"Other"` fallback for empty arrays.
3. **PR semantics**: per-exercise dedupe per week; first-ever session is NOT a PR (`priorMax > 0` guard).
4. **Chart**: dotted lifetime-best overlay line + label, with bar heights rescaled against `max(8wk-max, bestWeek)`.
5. **Streak soft-fallback**: empty current week + last week qualified → keep showing trailing count (Tuesday morning doesn't show 0).
6. **Tab icon**: `TrendingUp`.
7. **Cache prefix discipline**: every Progress-page query under `["stats", "progress-page", …]` so the existing `["stats"]` invalidation cascade catches them all (no edits to `useFinishSession` / `useUpdateSessionTimes` / `useSoftDeleteSession`).
8. **`useExercisesThisWeek` derives client-side** from `useLifetimeWeeklyVolume` + `useAllExercises`. `listSetsThisWeek` + `ThisWeekSetRow` were specced in v2 but **dropped in v3** — saves a round-trip; fewer moving parts.

## Bugs caught by the pipeline

- **v1 BLK-1**: Cache key collision (designer claimed `["progress-page", …]` was caught by `["progress"]` cascade — false). Fixed in v2 via namespace under `["stats", …]`.
- **v1 BLK-2**: Chart y-axis denominator (8-week max as denominator → overlay line renders above the plot when lifetime best exceeds the visible window). Fixed in v2 with max-aware denominator.
- **v1 MAJ-1/2/3**: Dead-pointer pseudocode citation, unverified embedded-resource filter syntax, missing single-prior-session PR test. All fixed in v2.
- **v2 BLK-3**: Lifetime branch dropped `.gte("completed_at", sinceUtc)` filter without compensating `.not("completed_at", "is", null)`. Rows with `completed_at = null` (unchecked sets in finished sessions — `finishSession` only stamps `ended_at`) would have caused `parseISO(null)` → `Invalid Date` → `format()` `RangeError` in render. **Hard crash on the Progress page for any user with any unchecked set in any finished session.** Caught at design v2 review; fixed in v3.
- **v2 MAJ-4**: `useExercisesThisWeek` data source was "Implementer call" — pinned to client-side derivation in v3.

## Known debt (non-gating)

- 3 Reviewer minors: split imports in `use-progress-page.ts`, undeclared `prIds: Set<string>` field exposed by `usePrsThisWeek`, verbose self-doubting comment block in `findBestWeek`. All cosmetic.
- Cold-start latency benchmark sample size = 1 (~2.96s on a populated user with light history). Heavy-history (3-year, 15k+ rows) worst case not measured locally. Documented MIN-3 fallback trigger: if cold-start > 5s in production, swap to a Postgres aggregate function (Option B).
- Hook-level tests (#53-#56 from design plan) shipped at the pure-helper level instead — TanStack mock infrastructure not in repo. End-to-end hook coverage is provided by the 7-case e2e suite.

## Why we stopped

Feature complete. All gates green.

## Artifacts

- [`state.md`](./state.md)
- [`discovery.md`](./discovery.md)
- [`design-v1.md`](./design-v1.md), [`validation-v1.md`](./validation-v1.md) — no-go
- [`design-v2.md`](./design-v2.md), [`validation-v2.md`](./validation-v2.md) — no-go
- [`design-v3.md`](./design-v3.md), [`validation-v3.md`](./validation-v3.md) — **go**
- [`implementation.md`](./implementation.md)
- [`review-v1.md`](./review-v1.md) — pass
- [`test-report-v1.md`](./test-report-v1.md) — pass
- [`transcript.md`](./transcript.md)
- `screenshots/iphone375-progress.png`

## Notes for the owner

- **Working tree uncommitted.** Suggested commits:
  - `feat(progress): new Progress tab + page (Max · Now · To PR · streak)` — covers the 10 new files + the 4 edited.
  - `docs(pipeline): archive progress-page run` — the run dir.
- **Manual visual check recommended**: open the deployed site, sign in, tap the new Progress tab. Verify hero numbers match your perception, per-exercise list groups by what you'd expect, streak is plausible.
- **`docs/features.md`** — close the open "New Progress tab + page" item once committed.

## Archive

- Pending Conductor archive command.
