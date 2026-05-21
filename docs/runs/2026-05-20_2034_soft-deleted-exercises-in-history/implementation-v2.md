# Implementation v2 — 2026-05-20_2034_soft-deleted-exercises-in-history

Test-only fix round. Production code untouched per Tester's report (`test-report-v1.md`, decision `fail` with the explicit guard: "What Implementer must NOT do: change `staleTime`, change the invalidation contract in `use-exercises.ts`, or change the `(deleted)` rendering logic").

Based on: `design-v1.md` (final approved, validated `go`, reviewed `pass`) and `test-report-v1.md` (flake diagnosis: persisted-cache refetch race on history detail re-mount).

## Files changed

- `tests/e2e/soft-deleted-exercises-in-history.spec.ts` (edited, lines 213-282) — race-busting strategy for step 5's `(deleted)` suffix assertion.

No other files touched. No production source modified.

## What the fix does

The original spec's step 5 reopened `/history/<sessionId>` immediately after the soft-delete and asserted the `(deleted)` suffix with a 5s visibility timeout. Tester proved (HIGH confidence, network trace evidence) that the unfiltered list query (`useAllExercises()`, `?select=*&order=name.asc`) does NOT refetch on history re-mount in ~40% of runs:

- The history-detail observer of `useAllExercises()` is unmounted at the moment of soft-delete (we're on `/exercises/[id]` then).
- `invalidateQueries(['exercises'])` therefore only marks the query stale without triggering an immediate fetch.
- On next history mount, `PersistQueryClientProvider` rehydrates the pre-delete shape. If `dataUpdatedAt + staleTime (30s)` is still in the future, TanStack treats the data as fresh and skips the refetch — the suffix never appears within the 5s window.

The test now waits out `staleTime` (30s + 2s safety margin) between the soft-delete navigation settling and the history reopen. After that wait, the rehydrated query is past staleTime, mount triggers an unconditional refetch, and the suffix renders. The test also arms a `page.waitForResponse(...)` for the unfiltered LIST query to act as a deterministic sync point, with a 15s fallback timeout on the assertion itself for safety.

Tradeoff: golden-path runtime grows from ~20s to ~55s. That's the price of not touching production code (per Tester's hard constraint).

## Deviations from design

None — design is unchanged; the only modification is to the e2e harness.

## Soft callbacks made (during this implementation pass)

None.

## Quality gates

- [x] `npm run typecheck` passed — `tsc --noEmit`, 0 diagnostics.
- [x] `npm run lint` passed — 0 errors, 1 pre-existing warning in `router.d.ts` (untouched, also on `main`).
- [x] No new `any`, no new `// @ts-ignore`, no `console.log` added.
- [x] **Repeat-test gate**: `npm run test:e2e -- tests/e2e/soft-deleted-exercises-in-history.spec.ts --repeat-each=5` → 5/5 passed (4.7m wall). Confirmed stability with `--repeat-each=8` → 8/8 passed (7.4m wall). Cumulative 13/13 under stress.

Evidence (final 5-rep run):
```
Running 5 tests using 1 worker
  ✓  1 ... (58.3s)
  ✓  2 ... (53.1s)
  ✓  3 ... (57.5s)
  ✓  4 ... (57.0s)
  ✓  5 ... (56.1s)
  5 passed (4.7m)
```

Evidence (8-rep stress run, no flakes):
```
Running 8 tests using 1 worker
  ✓  1-8 ... (53.5s–58.2s each)
  8 passed (7.4m)
```

## Failure path I tried and discarded

First attempt: wipe the persisted-cache localStorage key (`ada11-query-cache`) before reopening history, forcing a cold mount and unconditional refetch. Result on `--repeat-each=5`: **1/5 passed, 4/5 failed at the block-name visibility assertion**.

Trace investigation showed the unfiltered list refetch *did* fire after the wipe, but the cold-cache render path doesn't surface the block until the network round-trip completes, and the 10s-then-15s timeout I had on the block-name assertion still raced the resolution. Adding more time to that timeout wasn't a robust fix — Supabase response time under repeated stress varied too much.

The staleTime-wait approach is slower per iteration but has no race surface: TanStack's behavior under `dataUpdatedAt + staleTime < now()` is deterministic.

## Notes for Tester

- The new wall-clock budget for this spec is ~55s per iteration (was ~20s). Adjust CI expectations accordingly.
- The `STALE_TIME_MS = 30_000` constant in the spec mirrors `staleTime` in `src/lib/query-client.ts:8`. If production ever bumps that value, this constant must be updated in lockstep — leave a comment when the production value changes.
- If a future refactor introduces an explicit refetch path on history-detail mount (e.g. `useQuery({ refetchOnMount: 'always' })` for the unfiltered list), this `waitForTimeout` becomes unnecessary and can be removed — the spec would then revert to the original ~20s runtime.
