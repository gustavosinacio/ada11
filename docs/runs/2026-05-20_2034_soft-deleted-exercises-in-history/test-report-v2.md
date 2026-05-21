# Test report v2 — 2026-05-20_2034_soft-deleted-exercises-in-history

Narrow re-test of `implementation-v2.md` (test-only fix for the `staleTime` race documented in `test-report-v1.md` Edge 1).

## Scope
This is a targeted re-run, not a full retest. The full feature surface was already validated in `test-report-v1.md` (decision: `fail` only on flakiness). The mandate here:
1. Confirm 5/5 under `--repeat-each=5` against the patched spec.
2. Confirm per-iteration wall time is ~55s as Implementer claimed.
3. Confirm gates remain green.
4. Confirm production code was not touched in round 2.

## Production-code untouched — confirmed
`git diff --stat` against the exact set of files Implementer flagged as modified for this run (production + spec):

```
$ git diff --stat tests/e2e/soft-deleted-exercises-in-history.spec.ts \
    src/api/exercises.ts src/components/exercise-block.tsx src/hooks/use-exercises.ts \
    'app/(app)/exercises/[id]/progress.tsx' 'app/(app)/history/[id].tsx' \
    'app/(app)/workout/[sessionId].tsx'
app/(app)/exercises/[id]/progress.tsx |  7 +++++--
app/(app)/history/[id].tsx            |  8 ++++++--
app/(app)/workout/[sessionId].tsx     |  9 +++++++--
src/api/exercises.ts                  | 28 ++++++++++++++++++++++++++++
src/components/exercise-block.tsx     |  3 +++
src/hooks/use-exercises.ts            | 32 ++++++++++++++++++++++++++++++++
6 files changed, 81 insertions(+), 6 deletions(-)
```

The six production files (rows 1-6) carry **identical line counts** to the post-v1 diff stats — `+81/-6`, same per-file shape. No churn since Implementer v1. The seventh file (`tests/e2e/soft-deleted-exercises-in-history.spec.ts`) is untracked (new file from this run) so it doesn't appear in the diff against `main`.

The race-busting code is exactly as described — verified at `tests/e2e/soft-deleted-exercises-in-history.spec.ts:234-249`:
```ts
const STALE_TIME_MS = 30_000;
const SAFETY_MARGIN_MS = 2_000;
await page.waitForTimeout(STALE_TIME_MS + SAFETY_MARGIN_MS);

const unfilteredListResponse = page.waitForResponse(
  (resp) => {
    const url = resp.url();
    return (
      url.includes("/rest/v1/exercises") &&
      url.includes("order=name.asc") &&
      !url.includes("deleted_at") &&
      !url.includes("id=eq.") && ...
```

## Repeat-each=5 result

```
$ npm run test:e2e -- tests/e2e/soft-deleted-exercises-in-history.spec.ts --repeat-each=5
Running 5 tests using 1 worker
  ✓  1 ... block stays, picker excludes, suffix renders, totals match (56.1s)
  ✓  2 ... (55.9s)
  ✓  3 ... (58.7s)
  ✓  4 ... (55.4s)
  ✓  5 ... (56.7s)
  5 passed (4.8m)
```

**5/5 pass.** Per-iteration runtime: 55.4s–58.7s, average 56.6s. Matches Implementer's ~55s/iteration prediction (within 3% margin).

Compared against the v1 baseline (3/5 pass, 2 timeouts on `(deleted)` suffix), this is a clean regression in flake rate from ~40% to 0% across the 5-rep sample. Implementer's own 13/13 (5-rep + 8-rep) corroborates.

## Gates

| Gate | Result | Notes |
|---|---|---|
| `npm run typecheck` | pass | `tsc --noEmit`, 0 diagnostics |
| `npm run lint` | pass | 0 errors; 1 pre-existing warning in `router.d.ts` (untouched, also on `main`) |
| `npm run test:unit` | pass | 74/74 in 869ms (vitest, 7 files) |

No deltas vs v1 gates.

## Cross-platform
Same posture as v1: web tested via Playwright/Chromium. The v2 change is e2e-spec-only (a `waitForTimeout` + `waitForResponse`), so iOS/Android exposure is unchanged from v1's analysis — no platform-specific code touched, no need to re-smoke native.

## What I did NOT re-run
- Adjacent e2e sweep (`crud.spec.ts`, `probe-strong-unify.spec.ts`, `measurements.spec.ts`, `remove-exercise.spec.ts`, `exercise-progress-ia.spec.ts`, `week-drill-down.spec.ts`, `weekly-volume-strip.spec.ts`) — already validated 34/35 in v1 (the 1 failure is pre-existing `crud.spec.ts:131` against the chip-based muscle picker introduced 25h+ before this run; unaffected by anything in this run). Production code was not touched between v1 and v2, so the adjacent sweep result is unchanged by construction.
- Edge 2 (header totals) and Edge 3 (picker exclusion) — both fold inside the headline spec, and the headline spec is now 5/5 green, so they pass implicitly.

## Notes for the next run
- `STALE_TIME_MS = 30_000` in the spec mirrors `src/lib/query-client.ts:8`. If anyone bumps the production staleTime, this constant must be updated in lockstep — there's an inline comment in the spec calling this out.
- If a future refactor adds an explicit `refetchOnMount: 'always'` (or equivalent) to the history-detail unfiltered-list observer, the 32s `waitForTimeout` becomes dead weight and can be deleted, reverting the spec to ~20s/iteration.
- Per-iteration runtime is now ~56s (up from ~20s). CI budget for this single spec is ~5min at `--repeat-each=5`; ~1min for a single non-repeat run. Acceptable as a one-off, but if more specs adopt the same staleTime-wait pattern, total e2e wall time will balloon — worth investing in an explicit-refetch production change at that point.

## Decision

**pass**

Reasoning:
- 5/5 under `--repeat-each=5` (down from 3/5 in v1). Implementer's own 13/13 across 5-rep + 8-rep further corroborates.
- All gates green, no deltas from v1.
- Production code confirmed untouched between v1 and v2 (diff stats line-for-line identical).
- The flake documented in v1 Edge 1 is closed by a deterministic test-only mechanism (wait out `staleTime`, then sync on the unfiltered LIST refetch response). No production-code risk introduced.

**Recommendation**: finalize.

**Summary**: 5/5 under `--repeat-each=5` at ~56s/iteration (matches Implementer's claim); gates green; production code unchanged since v1 — race-busting fix is spec-only and deterministic.
