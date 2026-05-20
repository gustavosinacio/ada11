# Final summary — 2026-05-19_2144_weekly-volume-stat

## Outcome
- **Feature**: Weekly volume strip on the History screen — Σ (weight × reps) across non-warmup sets, bucketed into the last 8 ISO weeks (Mon-Sun, device-local), rendered as 8 bars + a `formatVolume`-formatted "This week" header. Includes a cross-cutting `["stats"]` cache-invalidation contract added to 5 mutation hooks.
- **Pipeline result**: **shipped** (passes typecheck, lint, 33/33 unit tests, 4/4 e2e tests against the live Supabase backend; reviewer + tester both green; no regressions in adjacent features).
- **Branch / final commit**: `main` / working tree (uncommitted) on top of baseline `b51dd014d62e2d4d11cf3b1883284720c3e2d5e7`.

## Metrics

| Metric | Value |
|---|---|
| Feature works end-to-end? | yes (web, e2e via Playwright against real Supabase) |
| Human interventions during run | 0 (one re-invoke after the user dismissed the agents dialog; no contract decisions deferred to human) |
| Total round-trips (sum of all loops) | 2 (one Design↔Validate re-spin; Implement↔Review and Implement↔Test both single-pass) |
| Design ↔ Validate rounds | 2 (v1 `no-go` → v2 `go`) |
| Implement ↔ Review rounds | 1 (`pass` on first review) |
| Implement ↔ Test rounds | 1 (`pass` on first test) |
| Implementer soft-callbacks | 0 |
| Wall-clock duration | 00:55 (21:44 → 22:39 BRT) |
| Token cost (if known) | n/a (not metered in this session) |

## What shipped (file inventory)

Production code (4 new, 4 edited):
- NEW `src/utils/dates.ts` — `IsoWeek` type, `isoWeekStart`, `weekKeyOf`, `lastNIsoWeeks`; first import of `date-fns` v4 in the repo.
- NEW `src/api/stats.ts` — `listWeeklyVolumeRows({ sinceUtc })`. First range-bound (`.gte("completed_at", ...)`) read in the codebase, setting that convention.
- NEW `src/hooks/use-stats.ts` — `useWeeklyVolume()`. Cache key `["stats", "weekly-volume", sinceUtc.slice(0,10)]`, `staleTime: 60_000`.
- NEW `src/components/weekly-volume-strip.tsx` — 3-branch render (loading skeleton w/ wrapper · bare null · data + bars w/ wrapper); local `computeStripModel` helper.
- EDIT `src/utils/units.ts` — added `formatVolume(kg, unit)` with round-then-compare boundary (no decimals for whole numbers, k-shorthand at ≥ 1000).
- EDIT `src/hooks/use-sessions.ts` — `useFinishSession` + `useSoftDeleteSession` now invalidate `["stats"]`.
- EDIT `src/hooks/use-sets.ts` — `useLogSet` + `useUpdateSet` + `useDeleteSet` now invalidate `["stats"]`.
- EDIT `app/(app)/history/index.tsx` — strip mounted as `ListHeaderComponent`; `onRefresh` widened to `Promise.all([sessionsRefetch, weeklyRefetch])`; `isRefetching` OR-merged.

Test scaffolding (added by Tester):
- NEW `tests/unit/dates.test.ts`, `tests/unit/units.test.ts`, `tests/unit/weekly-volume-bucketing.test.ts` (28 new unit tests).
- NEW `tests/e2e/weekly-volume-strip.spec.ts` (4 e2e scenarios driven via Playwright against real Supabase).
- NEW `docs/runs/2026-05-19_2144_weekly-volume-stat/screenshots/{golden-strip,empty-state,warmup-only,post-refetch}.png`.

## Decisions taken (carried in the design)
1. **ISO week, Monday-Sunday** (Mon-start).
2. **Device-local timezone** for bucket boundaries (no `date-fns-tz`).
3. **8 weeks** visible (current + 7 prior).
4. **Loose "working sets"** = `set_type !== 'warmup'` (matches `app/(app)/exercises/[id]/progress.tsx:41` precedent; explicitly does NOT match the inconsistent single-session "Total" at `history/[id].tsx` — flagged for a follow-up run).
5. **Empty-state**: bare null if all 8 weeks zero / no data; flat 4 px stub for rest weeks; bare null short-circuit happens *before* any wrapper View.
6. **Visual**: bars (not tiles, not line chart) — NativeWind only, no SVG.
7. **Non-interactive in v1** (drilldown deferred).
8. **In-progress sessions excluded** (matches `src/api/progress.ts:14`).
9. **Cache invalidation contract**: any mutation that touches `sets` or `sessions` must invalidate `["stats"]`. Documented for future mutations.
10. **`date-fns` v4 adopted** (was already in `package.json` but unused).

## Why we stopped
- Feature complete and verified end-to-end. No escalation, no aborted state.

## Artifacts
- [`state.md`](./state.md)
- [`discovery.md`](./discovery.md)
- [`design-v1.md`](./design-v1.md)
- [`validation-v1.md`](./validation-v1.md) — `no-go`, 3 majors / 11 minors
- [`design-v2.md`](./design-v2.md)
- [`validation-v2.md`](./validation-v2.md) — `go`, 6 minors (non-gating, absorbed by Implementer)
- [`implementation.md`](./implementation.md)
- [`review-v1.md`](./review-v1.md) — `pass`, 0 / 0 / 3
- [`test-report-v1.md`](./test-report-v1.md) — `pass`, e2e via Playwright + 28 unit tests
- [`transcript.md`](./transcript.md)
- `screenshots/` — 4 PNGs (golden, empty, warmup-only, post-refetch)
- [`retro.md`](./retro.md) — to be filled in by owner

## Notes for the owner
- **Working tree uncommitted.** The pipeline does not commit by default per project safety norms. Review the diff (`git status`, `git diff`) and commit when ready — the suggested message could be `feat(history): weekly volume strip with 8-week bars`.
- **`["stats"]` invalidation is a load-bearing contract going forward.** Documented in `design-v2.md §Mudanças` and now lives in 5 `onSuccess` handlers. Any new mutation touching `sets` or `sessions` should add the same invalidation.
- **Follow-up runs queued (out of scope of this run):**
  - Fix the single-session "Total" at `app/(app)/history/[id].tsx:130-142` to also exclude warmups (so the strip's week-total matches the sum of per-session totals).
  - Add a `(user_id, completed_at)` index migration on `sets` once the dataset outgrows seq-scan-friendly size.
  - Pass `totalSets` / `totalVolumeKg` props to `SessionSummaryRow` (props exist; data path not wired).
  - Decide whether weeks should be tappable for drilldown (Designer marked non-interactive in v1).
- **Three documented deviations from design** (all in `implementation.md`): `weeks[0]!` non-null assertion (TS `noUncheckedIndexedAccess`), `as unknown as WeeklyVolumeRow[]` cast (mirrors `src/api/progress.ts:20-21`), `React.JSX.Element | null` return typing (modern `@types/react`). All justified, none introduce `any`.

## Bugs found post-merge (backfill within 7 days)
- (none yet — owner updates this section as bugs surface)

## Archive
- Archived to vault: `$VAULT/AIground/multi-agent-pipeline/pipeline-runs/2026-05-19_2144_weekly-volume-stat/` on 2026-05-19 22:39 BRT.
