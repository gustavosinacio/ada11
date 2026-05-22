# Final summary — 2026-05-22_0152_end-of-session-verdict

## Outcome

- **Feature**: End-of-session verdict screen. After Finish (and the existing unchecked-sets dialog, if any), user lands on a brief summary: `+N PRs · Y kg total volume · Zh Wm duration` + a list of exercises that PR'd. Done button returns to the workout tab root.
- **Pipeline result**: **shipped**.
- **Branch / final commit**: `main`. Working tree dirty — not yet committed.

## Metrics

| Metric | Value |
|---|---|
| Feature works end-to-end? | yes (179/179 unit, 2/2 feature e2e, 18/19 regression e2e — 1 pre-existing unrelated failure) |
| Human interventions during run | 1 (mid-run API 529 retry — non-blocking) |
| Total round-trips (sum of all loops) | 3 (D↔V 2, I↔R 1, I↔T 1) |
| Design ↔ Validate rounds | 2 (v1 `no-go` 0/2/5 → v2 `go` 0/0/5) |
| Implement ↔ Review rounds | 1 (`pass`) |
| Implement ↔ Test rounds | 1 (`pass`) |
| Implementer soft-callbacks | 0 |
| Wall-clock duration | ~50 min (01:52 → 02:42 BRT) |
| Token cost | n/a |

## What shipped

**8 files** (4 new, 4 edited):

**New:**
- `app/(app)/workout/verdict/[sessionId].tsx` — verdict screen.
- `src/utils/session-verdict-math.ts` — `computeCurrentSessionVolumeByExercise` + `computePrsForSession`.
- `tests/unit/session-verdict-math.test.ts` — 21 unit tests.
- `tests/e2e/end-of-session-verdict.spec.ts` — 2 e2e cases.

**Edited:**
- `app/(app)/workout/[sessionId].tsx` — `finishAfterMutation` route changed to `/(app)/workout/verdict/{sessionId}`. Cancel flow unchanged.
- `src/hooks/use-sets.ts` — `useBulkCheckAllInSession.onSuccess` becomes `async` and awaits `qc.refetchQueries(...)`. **Load-bearing MAJ-2 fix**.
- `src/utils/volume-target.ts` — `export` keyword added to `sumLiveVolume`.
- `tests/e2e/crud.spec.ts` — post-Finish flow patched.

## Decisions

1. **PR detection = option (c)**: filter rows by `session_id !== currentSessionId` before `computeLifetimeMaxPerExercise`. Strict `>`, `priorMax > 0` guard.
2. **Route**: `app/(app)/workout/verdict/[sessionId].tsx` nested under workout tab.
3. **Navigation**: `router.replace` on both legs.
4. **`formatDuration`**: import existing public helper.
5. **`sumLiveVolume`**: exported, reused (no duplicate predicate).
6. **Empty-state split**: `totalVolumeKg === 0` vs normal no-PR.
7. **Eager headline**: `+0 PRs` rendered immediately; skeleton on PR-list only.

## Bugs caught by the pipeline

- **v1 MAJ-1**: planned duplicate `formatDuration` export — caught at v2 review.
- **v1 MAJ-2**: real cache race in `useBulkCheckAllInSession.onSuccess`. The "Check all and finish" Finish branch would have rendered `0 kg` on the verdict because the verdict mounted before the sets cache refetched. Fixed by awaiting `refetchQueries`. E2E Case A `600 kg` assertion is the regression guard.

## Known debt (non-gating)

- 5 Reviewer minors (polish).
- Pre-existing baseline failure in `crud.spec.ts:131` (exercises-create-multi-select selector since `b51dd01`). Unrelated to verdict.

## Artifacts

- [`state.md`](./state.md), [`transcript.md`](./transcript.md)
- [`discovery.md`](./discovery.md)
- [`design-v1.md`](./design-v1.md), [`validation-v1.md`](./validation-v1.md) — no-go
- [`design-v2.md`](./design-v2.md), [`validation-v2.md`](./validation-v2.md) — **go**
- [`implementation.md`](./implementation.md), [`review-v1.md`](./review-v1.md), [`test-report-v1.md`](./test-report-v1.md)

## Archive

- Archived to vault.
