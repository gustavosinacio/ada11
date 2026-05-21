# Test report v2 — 2026-05-21_1308_set-check-button

Narrow re-test of the v2 implementation. v1 already verified the feature itself
works (golden, edges, regressions, cross-feature) via probes; v1 only failed on
the e2e spec's substring-match bug. This round confirms the spec fix.

## Scope

Per the Conductor's directive:

1. Re-run the formerly-failing spec under `--repeat-each=5`.
2. Re-run quality gates (`typecheck`, `lint`, `test:unit`).
3. Confirm production code untouched since v1.

No new probes. No re-sweep of adjacent specs — v1 already covered them and v2
only edited the test file.

## Production code untouched in this round

`docs/runs/2026-05-21_1308_set-check-button/` shows `implementation-v2.md` as
the only `.md` newer than `test-report-v1.md`. The implementation report
explicitly states "No production code touched." Cross-checked by:

```
$ ls -lt docs/runs/2026-05-21_1308_set-check-button/
# implementation-v2.md is the only file added after test-report-v1.md.
```

The full feature diff still includes the same production files v1 reviewed
(app/(app)/workout/[sessionId].tsx, src/api/sets.ts, src/components/set-input.tsx,
src/hooks/use-sets.ts, src/api/progress.ts, src/components/exercise-block.tsx,
src/db/schema.ts, src/db/types.ts, src/lib/query-client.ts) — these are the v1
landing, not v2 work.

Test file changed in v2: `tests/e2e/soft-deleted-exercises-in-history.spec.ts`
(23 lines added — the `{ exact: true }` qualifier on both `getByLabel` calls
plus two `expect(...).toHaveCount(N)` deterministic gates between/around the
clicks; rationale comment rewritten to document both invariants).

## Quality gates

- **`npm run typecheck`** → clean (only `tsc --noEmit` echo, no diagnostics).
- **`npm run lint`** → 0 errors, 1 pre-existing warning (`router.d.ts`,
  expo-router generated — same as v1).
- **`npm run test:unit`** → 7 files / 74 tests passing in 884ms.

All three gates **pass**.

## E2E spec under repeat-each=5

Command:

```
npm run test:e2e -- tests/e2e/soft-deleted-exercises-in-history.spec.ts --repeat-each=5
```

Result: **5/5 pass, 0 flakes, 4.4m total.**

```
✓  1 tests/e2e/soft-deleted-exercises-in-history.spec.ts:87:7 (52.2s)
✓  2 tests/e2e/soft-deleted-exercises-in-history.spec.ts:87:7 (52.1s)
✓  3 tests/e2e/soft-deleted-exercises-in-history.spec.ts:87:7 (51.6s)
✓  4 tests/e2e/soft-deleted-exercises-in-history.spec.ts:87:7 (53.9s)
✓  5 tests/e2e/soft-deleted-exercises-in-history.spec.ts:87:7 (53.2s)
5 passed (4.4m)
```

Run-to-run variance is ~2.3s (51.6 → 53.9s) — well within the deliberate
`staleTime + safety` wait already documented inline. No timeout warnings, no
retry attempts, no flake signatures.

## Implementer's deviation review

The Implementer added two `expect(markChecks).toHaveCount(N)` gates beyond
the Conductor's "minimum patch" directive. Justified: the minimum patch was
necessary but not sufficient — substring fix alone still races React's async
label-flip re-render between the two adjacent `.click()` calls. The
deterministic count gates eliminate that race without touching production
code, and they cost ~50ms in the happy path. 5/5 runs prove the spec is now
stable under repeated execution.

## Decision

**pass**

- 5/5 spec passes under `--repeat-each=5`, 0 flakes.
- All three quality gates green (typecheck, lint, unit).
- Production code not touched in v2 (only the e2e spec was edited).
- v1 already confirmed the feature implementation itself is correct.

## Recommendation

**finalize.** Conductor can close the run.
