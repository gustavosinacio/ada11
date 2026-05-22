# Design v2 — 2026-05-22_0152_end-of-session-verdict

> Tight delta over v1. Section tags: `[v1-carryover]` (unchanged from v1), `[changed-v2]` (modified to address validator feedback), `[new-v2]` (new in v2). The v1 design remains the canonical reference for unchanged details.

## Goal (1 sentence) `[v1-carryover]`

Insert a one-shot, read-only "Workout summary" screen between `useFinishSession`'s success and the workout-tab root that shows `+N PRs · Y kg · Zh Wm`, the list of exercises that beat their prior lifetime best in the just-finished session, and a single "Done" button.

## Approach `[changed-v2]`

After a Finish mutation resolves, replace the live-screen route with `/(app)/workout/verdict/<sessionId>` instead of `/(app)/workout`. The verdict screen is a pure read-only surface: it consumes the four queries already warm in cache from the live screen (`useSession`, `useSetsForSession`, `useLifetimeWeeklyVolume`, `useAllExercises`), then derives display data via two pure helpers in a new module `src/utils/session-verdict-math.ts`. PR detection follows Discovery's option (c): filter `WeeklyVolumeRow[]` to `session_id !== currentSessionId` before passing to the existing `computeLifetimeMaxPerExercise`, then compare each per-exercise current-session volume against that prior-only max with strict `>` and a `priorMax > 0` guard.

**Two correctness fixes in v2** (from validation-v1):

1. The bulk-check-all Finish branch had a sets-cache race: `useBulkCheckAllInSession.onSuccess` only invalidated, never awaited the refetch. By the time the verdict mounted, `setsQ.data` could still hold the pre-bulk-check rows (most sets `completed_at = null`) → volume + PR under-count. Fix: switch the `onSuccess` to `await qc.refetchQueries(...)`. Callers of `mutateAsync` get fresh-cache semantics for free.
2. `formatDuration` was being re-exported from `session-summary-row.tsx` despite an identical public export already living at `src/utils/format-session-times.ts:23`. Fix: do not touch `session-summary-row.tsx`; import the existing public helper directly in the verdict screen.

The Done button calls `router.replace("/(app)/workout")`. No schema change, no new server query, no new RLS policies. The screen is idempotent against the persisted session, so a deep-link or app reload mid-verdict still renders correctly.

## Mudanças por arquivo `[changed-v2]`

| File | Type | Change |
|---|---|---|
| `app/(app)/workout/verdict/[sessionId].tsx` | new | `[v1-carryover]` — The verdict screen. Renders headline + PR list + Done button. Inherits `workout/_layout.tsx`'s `<Stack>`. Sets `<Stack.Screen options={{ title: "Workout summary", headerShown: true }} />`. Imports `formatDuration` from `~/utils/format-session-times`. |
| `src/utils/session-verdict-math.ts` | new | `[changed-v2]` — Two pure helpers: `computeCurrentSessionVolumeByExercise(sets)` and `computePrsForSession({ rows, currentSessionId, currentSessionVolumeByExercise })`. Reuses `sumLiveVolume` from `volume-target.ts` for per-(exercise_id) volume reduction (MIN-1). No React, no Supabase. |
| `src/utils/volume-target.ts` | edited | `[new-v2]` — Add `export` to the existing module-private `sumLiveVolume` at lines 78-90. One keyword. No behavior change, no signature change. |
| `src/hooks/use-sets.ts` | edited | `[new-v2]` — Change `useBulkCheckAllInSession.onSuccess` body at lines 119-121 from a fire-and-forget `qc.invalidateQueries({ queryKey: KEYS.forSession(sessionId) })` to `await qc.refetchQueries({ queryKey: KEYS.forSession(sessionId) })`. Make the callback `async`. Addresses MAJ-2 — the bulk-check-all Finish branch now resolves `mutateAsync` only after sets cache is fresh. |
| `tests/unit/session-verdict-math.test.ts` | new | `[v1-carryover]` — Unit tests for both helpers. Mirrors `tests/unit/progress-page-math.test.ts` style — `mkRow` / `mkSet` fixtures, named tests by case. |
| `tests/e2e/end-of-session-verdict.spec.ts` | new | `[changed-v2]` — Two e2e cases: (A) finish session that beats a seeded prior session → verdict shows `+1 PRs`, PR row visible, Done returns to `/workout`; (B) finish session with no logged sets → verdict shows `0 PRs · 0 kg`, no PR list, zero-volume empty-state copy. Each case registers `page.on("dialog", d => d.accept())` BEFORE the Finish click (MIN-2). |
| `app/(app)/workout/[sessionId].tsx` | edited | `[v1-carryover]` — At `finishAfterMutation` (lines 225-233), change the post-`mutateAsync` `router.replace("/(app)/workout")` to `router.replace(\`/(app)/workout/verdict/${sessionId}\`)`. Single line in a helper used by all three Finish branches. No other edits. |
| `tests/e2e/crud.spec.ts` | edited | `[v1-carryover]` — The `"workout: start ad-hoc, finish, see in history"` test (lines 162-202) currently asserts `page.waitForURL(/\/workout$/)` immediately after Finish. After this feature, Finish replaces to `/workout/verdict/<id>` first. Update: wait for the verdict URL, assert `"0 PRs"` headline, click "Done", then wait for `/workout$`. |
| `docs/features.md` | edited | `[v1-carryover]` — Move the verdict-screen item from the pending `[ ]` list to `## Done`. Conductor responsibility post-merge; listed here so the Implementer doesn't touch it. |

**Removed from v1's file map**: `src/components/session-summary-row.tsx` (the v1 `formatDuration` re-export is dropped — MAJ-1).

**One-responsibility audit** `[changed-v2]`: each new/edited file still has a single responsibility. The `volume-target.ts` edit is a keyword change (`export`) on an existing helper — no responsibility shift. The `use-sets.ts` edit narrows the concurrency contract of a single mutation hook — one responsibility (correctness of `mutateAsync` post-condition for the bulk-check-all path); no other mutation hooks are touched.

## Contratos de I/O `[changed-v2]`

### `src/utils/session-verdict-math.ts` (NEW) — `[changed-v2]`

```ts
import type { WeeklyVolumeRow } from "~/api/stats";
import type { SetRow } from "~/db/types";
import { computeLifetimeMaxPerExercise } from "~/utils/progress-page-math";
import { sumLiveVolume } from "~/utils/volume-target"; // [changed-v2] — reused

/**
 * Per-exercise volume (kg) for the just-finished session, computed from the
 * session's set rows. Groups `sets` by `exercise_id`, then reduces each group
 * via the shared `sumLiveVolume` kernel (warmup skip, completed_at != null,
 * weight > 0, reps > 0). Single source of truth for the live-volume predicate.
 *
 * Returns Map<exercise_id, totalKg>. Exercises with zero qualifying sets are
 * NOT present in the map (downstream `priorMax > 0` guard makes the absence
 * harmless — they cannot PR).
 */
export function computeCurrentSessionVolumeByExercise(
  sets: SetRow[],
): Map<string, number>;

export type SessionPr = {
  exerciseId: string;
  currentKg: number;
  priorMaxKg: number;
  overflowKg: number; // currentKg - priorMaxKg, strictly > 0 by construction
};

/**
 * Returns one entry per exercise that hit a strict lifetime-volume PR in the
 * just-finished session.
 *
 * Algorithm:
 *   1. Filter `rows` to those with `row.session_id !== currentSessionId`.
 *   2. Run `computeLifetimeMaxPerExercise` on the filtered rows.
 *   3. For each exercise present in `currentSessionVolumeByExercise`, emit a
 *      `SessionPr` iff `currentKg > priorMaxKg && priorMaxKg > 0`.
 *
 * Sorted by `overflowKg` DESC; tie-break `exerciseId` ASC.
 */
export function computePrsForSession(opts: {
  rows: WeeklyVolumeRow[];
  currentSessionId: string;
  currentSessionVolumeByExercise: Map<string, number>;
}): SessionPr[];
```

Reference implementation sketch for `computeCurrentSessionVolumeByExercise` (MIN-1 — reuses `sumLiveVolume`):

```ts
export function computeCurrentSessionVolumeByExercise(
  sets: SetRow[],
): Map<string, number> {
  const byEx = new Map<string, SetRow[]>();
  for (const s of sets) {
    const bucket = byEx.get(s.exercise_id);
    if (bucket) bucket.push(s);
    else byEx.set(s.exercise_id, [s]);
  }
  const out = new Map<string, number>();
  for (const [exerciseId, group] of byEx) {
    const total = sumLiveVolume(group);
    if (total > 0) out.set(exerciseId, total);
  }
  return out;
}
```

### `src/utils/volume-target.ts` — `[new-v2]`

```ts
// Before (line 78):
function sumLiveVolume(sets: SetRow[]): number { ... }

// After (one keyword added):
export function sumLiveVolume(sets: SetRow[]): number { ... }
```

No signature change. Existing in-file callers continue to use the local reference. The new caller in `session-verdict-math.ts` imports it.

### `src/hooks/use-sets.ts` — `[new-v2]`

```ts
// Before (lines 115-123):
export function useBulkCheckAllInSession(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => bulkCheckAllInSession(sessionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.forSession(sessionId) });
    },
  });
}

// After:
export function useBulkCheckAllInSession(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => bulkCheckAllInSession(sessionId),
    onSuccess: async () => {
      await qc.refetchQueries({ queryKey: KEYS.forSession(sessionId) });
    },
  });
}
```

Contract change: `useBulkCheckAllInSession().mutateAsync()` now resolves only AFTER the sets cache for `sessionId` has been refetched (server round-trip + cache write). Callers using `mutateAsync` see fresh `setsQ.data` on the next render.

Caller audit (existing — no caller changes needed):
- `app/(app)/workout/[sessionId].tsx:257-267` — `handleCheckAllAndFinish`: `await bulkCheckAll.mutateAsync()` then `await finishAfterMutation()`. With the new contract, by the time `finishAfterMutation` runs, sets are fresh; by the time the verdict mounts, `setsQ.data` reflects the post-bulk-check state. Fixes MAJ-2 transparently.
- No other consumers of `useBulkCheckAllInSession` exist in the codebase.

### `app/(app)/workout/verdict/[sessionId].tsx` — `[changed-v2]`

Imports updated to drop the deleted v1 re-export and use the existing public helper:

```ts
import { formatDuration } from "~/utils/format-session-times"; // [changed-v2]
import {
  computeCurrentSessionVolumeByExercise,
  computePrsForSession,
} from "~/utils/session-verdict-math";
import { sumLiveVolume } from "~/utils/volume-target"; // [new-v2] — for totalVolumeKg
```

Total volume reduction uses the now-exported `sumLiveVolume` directly (cleaner than summing the by-exercise map):

```ts
const totalVolumeKg = useMemo(
  () => sumLiveVolume(setsQ.data ?? []),
  [setsQ.data],
);
```

`session.data.ended_at` is guaranteed non-null at verdict mount because `useFinishSession.onSuccess` writes `ended_at` server-side and the verdict is routed-to only after `mutateAsync` resolves. The `formatDuration` null-end fallback (`"—"` vs the old private copy's `"in progress"`) is therefore unreachable in this path. Stated explicitly so future refactors don't reintroduce a private copy.

All other inline derivations (`currentByExercise`, `prs`, `headlineParts`) are unchanged from v1.

## Page composition `[v1-carryover, with one copy delta]`

Render tree, ASCII mockups, loading state, error state, and header/back-button discussion are unchanged from v1 — see `design-v1.md`.

**Copy delta `[changed-v2]` (MIN-4)**: Empty-state copy is now split by whether the user logged any sets:

- `totalVolumeKg > 0` AND `prs.length === 0` (logged sets but no PR): `"Solid session — keep it consistent."`
- `totalVolumeKg === 0` AND `prs.length === 0` (no sets logged at all): `"No sets logged — your next session counts."`

The two strings differ only by the lead clause. Visual treatment identical (`text-center text-base text-gray-500`, same padding). The headline still reads `0 PRs · 0 kg · Zh Wm` for the zero-volume case.

```tsx
const emptyCopy =
  totalVolumeKg === 0
    ? "No sets logged — your next session counts."
    : "Solid session — keep it consistent.";
```

## Loading state `[changed-v2]`

V1's loading rule rendered the headline with `+? PRs` as a skeleton bar until the lifetime read resolved. Validator flagged that as reading "broken" on fast networks (MIN-3).

**New rule**: render the headline eagerly with `+0 PRs` as soon as `session.data + setsQ.data + exercisesQ.data` are present; show the PR-list slot's 3-bar skeleton until `lifetimeQ.data` resolves; on resolve, the headline updates atomically to the true PR count (typically within ~200ms post-Finish since `useFinishSession.onSuccess` already triggered the refetch).

Concretely:

```ts
const isHeadlineReady =
  session.data && setsQ.data && exercisesQ.data && session.data.ended_at != null;
const isPrListReady = lifetimeQ.data !== undefined;

// Headline always shows `prs.length` once isHeadlineReady; prs is [] until
// lifetimeQ.data resolves (the useMemo short-circuits). That's `+0 PRs`
// eagerly, then `+N PRs` when lifetime arrives.
```

Tradeoff: for ~200ms after Finish, the headline is briefly wrong (shows `0 PRs` when there is in fact a PR). Acceptable per MIN-3 — reads as a coherent screen instead of a half-skeleton-half-real one. The PR-list skeleton communicates that work is still in flight; users learn to wait for it.

Cold deep-link case (page reload on verdict URL, all four queries cold): full-screen `<ActivityIndicator>` is shown until `isHeadlineReady` flips true, then the eager-`+0 PRs` behavior kicks in. Same path as v1.

## Test plan `[changed-v2]`

V1 unit + e2e cases preserved. Additions:

### Unit additions — `tests/unit/session-verdict-math.test.ts` `[changed-v2]`

Cases 1-20 from v1 unchanged. Add:

21. **`sumLiveVolume` reuse**: feed the same `SetRow[]` to `computeCurrentSessionVolumeByExercise` and verify the per-(exercise_id) sum equals what `sumLiveVolume` returns when restricted to that exercise's rows. Confirms MIN-1 reduction is faithful.

### Unit additions — `tests/unit/use-bulk-check-all-in-session.test.ts` (NEW) `[new-v2]`

Lightweight hook-level test for the MAJ-2 fix. Uses `@testing-library/react` `renderHook` + a mocked `QueryClient`.

22. **`mutateAsync` resolves AFTER cache refetch completes**: stub `bulkCheckAllInSession` to resolve immediately; spy on `qc.refetchQueries`; assert that the promise returned by `mutateAsync()` resolves only after the spy's resolution. Concretely: `refetchQueries` is mocked to a deferred promise; `mutateAsync` does not resolve until the deferred resolves.
23. **Cache key passed matches `KEYS.forSession(sessionId)`**: spy on `refetchQueries` and assert the queryKey arg.

If a hook-level test feels heavy for two lines, an integration-style assertion inside the e2e Case A serves as the load-bearing check (see Case A step 9 below). The unit test is a defense-in-depth nicety.

### E2E additions — `tests/e2e/end-of-session-verdict.spec.ts` `[changed-v2]`

#### Case A — finish with PR (bulk-check-all path, exercises MAJ-2) `[changed-v2]`

1. Create confirmed user via admin API.
2. Pick a seed exercise (first non-deleted `exercises` row).
3. Seed a finished prior session 3 days ago with a single set: `100 kg × 5 = 500 kg`.
4. Register `page.on("dialog", d => d.accept())` BEFORE any Finish click (MIN-2, mirrors `crud.spec.ts:184`).
5. Sign in via UI, land on `/workout`.
6. Quick-start ad-hoc workout. Wait for `/workout/<id>`.
7. In the live screen, add the same exercise; log a working set at `100 kg × 6 = 600 kg` but **DO NOT check it** (leaves the bulk-check-all path live).
8. Tap Finish (`Finish workout` button via accessibilityLabel). The app should detect unchecked sets, prompt the "Check all and finish?" choice, take the "Check all and finish" branch (`handleCheckAllAndFinish`), accept the confirm dialog.
9. Wait for URL `/workout/verdict/<id>`.
10. Assert headline contains `+1 PRs` AND `600 kg` (NOT `0 kg`). The `600 kg` assertion is the load-bearing check for MAJ-2 — pre-fix, the verdict would render `0 kg` because the set was still `completed_at = null` in the sets cache.
11. Assert PR row visible with `+100 kg (was 500 kg)` sub-line.
12. Tap `Done`. Wait for URL `/workout$`. Assert workout tab root.

#### Case B — finish with no sets (zero-volume empty-state, MIN-4) `[changed-v2]`

1. Create confirmed user.
2. Do NOT seed a prior session.
3. Register `page.on("dialog", d => d.accept())` BEFORE any Finish click (MIN-2).
4. Sign in, quick-start ad-hoc, do not log any sets.
5. Tap Finish, accept confirm dialog.
6. Wait for `/workout/verdict/<id>`.
7. Assert headline contains `0 PRs` (no leading plus) AND `0 kg`.
8. Assert empty-state copy `"No sets logged — your next session counts."` visible (NOT the non-zero-volume "Solid session" copy).
9. Assert no `PR` pill in the DOM.
10. Tap `Done`. Wait for `/workout$`.

#### (Optional) Case C — finish with sets but no PR `[new-v2]`

Adds coverage for the `totalVolumeKg > 0 && prs.length === 0` empty-state branch (MIN-4 split). Seed a prior session that exceeds the current session's volume, log a small current-session set, Finish. Assert headline shows `0 PRs · <small_kg>`, and empty-state copy reads `"Solid session — keep it consistent."` (the non-zero-volume copy). Mark optional; the unit tests cover the copy-selection logic.

### `crud.spec.ts` update `[v1-carryover]`

Unchanged from v1. Dialog handler at line 184 is preserved; the post-Finish flow now goes through `/workout/verdict/<id>` first, then `/workout$` after Done click. See v1 design for exact patch.

### Type-check + lint `[v1-carryover]`

`pnpm tsc --noEmit` passes. No `any` introduced.

## Riscos `[changed-v2]`

### Data integrity `[v1-carryover]`

- **RLS**: no new tables, no new policies. Unchanged.
- **Migrations**: none.
- **Idempotency**: verdict performs zero mutations.
- **Soft-deleted-session deep-link**: same inline error fallback as v1.

### UX regressions `[changed-v2]`

- **`finishAfterMutation` single funnel**: unchanged from v1.
- **Cancel-flow**: unaffected (bypasses funnel).
- **`crud.spec.ts` regression**: v1 plan still applies.
- **`useBulkCheckAllInSession` contract change `[new-v2]`**: the mutation hook now waits for the refetch before `mutateAsync` resolves. This adds one server round-trip (sets `select` for the session) to the latency of `handleCheckAllAndFinish`. The fire-and-forget invalidation would have triggered the same fetch anyway — the change is from "background refetch" to "awaited refetch". Net latency increase: typically 50-200ms. The user is already waiting on `finishAfterMutation` (which itself awaits `finishSession.mutateAsync` → another round-trip), so the verdict-mount delay is dominated by the Finish call, not the awaited refetch. Acceptable.
  - **No live-screen UX regression**: the live screen's render between `bulkCheckAll.mutateAsync()` resolving and `finishAfterMutation()` starting was a no-op (the live screen unmounts right after via the route replace). The added await window does not surface to the user.
  - **`useUncheckSet`, `useCheckSet`, `useUpsertSet`, `useBulkSoftDeleteUncheckedInSession`** still use fire-and-forget invalidation (unchanged). The fix is scoped to the one branch that feeds the verdict.
- **`formatDuration` import `[changed-v2]`**: nothing else changes around `session-summary-row.tsx`. The verdict imports the existing public helper; the History row keeps its local private copy. No external caller of the private copy exists, so no risk to History.

### Platform-specific `[v1-carryover]`

- iOS, Android, web behaviors unchanged from v1.
- The awaited refetch uses React Query's standard fetch path — no platform divergence.

### Performance `[changed-v2]`

- **No new server round-trip at verdict mount**: unchanged.
- **One added awaited round-trip in the bulk-check-all branch**: ~50-200ms, hidden behind the Finish spinner. See UX regressions above.
- **PR-detection cost**: unchanged. Filter + reduce over ~5-15k lifetime rows.
- **Render cost**: unchanged.
- **Re-render churn**: unchanged.
- **Cold deep-link**: unchanged.

## Alternativas descartadas `[changed-v2]`

V1 alternatives 1-8 stand. Two additions surfaced by MAJ-2 / MAJ-1:

9. **Gate verdict render on `!setsQ.isFetching`** (alternative to the `use-sets.ts` await refetch). Discarded because `isFetching` flips false transiently between an invalidation and the next refetch starting, exposing a render window with stale data. The awaited refetch in the mutation `onSuccess` is the correct fix — it makes the cache-fresh post-condition part of the mutation's contract, where it belongs.
10. **Move `formatDuration` to a single shared module by removing the duplicate from `session-summary-row.tsx`**. Tempting cleanup, but out of scope for this feature run — touching `session-summary-row.tsx` for a non-feature-driven dedupe expands blast radius (History row, History detail). A future cleanup PR can remove the duplicate; the verdict only needs to NOT add a third copy.

## Out of scope `[v1-carryover]`

Unchanged from v1. Notably still out of scope:

- New `prs` snapshot table.
- Notifications / haptics / confetti on PR.
- Sharing the verdict.
- Re-deriving the verdict for sessions edited from History.
- e1RM or single-rep-max PRs.
- Cancel-flow verdict.
- Showing the verdict inside the History detail screen.
- Removing the duplicate `formatDuration` from `session-summary-row.tsx` (alt 10 above).

## Resposta a issues do Validator `[new-v2]`

### MAJ-1 — `formatDuration` duplication

**Addressed.** V1 planned to add `export` to the module-private `formatDuration` at `src/components/session-summary-row.tsx`. V2 drops that edit entirely. The verdict screen imports the existing public helper at `src/utils/format-session-times.ts:23`. `session-summary-row.tsx` is no longer in the file-change map.

Justification for ignoring the null-end divergence: `formatDuration` from `format-session-times.ts` returns `"—"` for `endIso == null`, while the in-place private copy returned `"in progress"`. In the verdict path, `session.data.ended_at` is guaranteed non-null because (a) `useFinishSession.onSuccess` stamps `ended_at` server-side via the Finish mutation; (b) the route replace runs only after `finishAfterMutation` awaits that mutation. The fallback branch is unreachable. Stated in `Contratos de I/O` to anchor the assumption.

### MAJ-2 — Sets cache race in bulk-check-all Finish

**Addressed.** `src/hooks/use-sets.ts:115-123` patched: `useBulkCheckAllInSession.onSuccess` becomes `async` and `await`s `qc.refetchQueries({ queryKey: KEYS.forSession(sessionId) })`. The mutation's `mutateAsync` Promise now resolves only after the sets cache is fresh.

Caller verification:
- `handleCheckAllAndFinish` at `app/(app)/workout/[sessionId].tsx:257-267` calls `await bulkCheckAll.mutateAsync()` then `await finishAfterMutation()`. With the contract change, by the time `finishAfterMutation` enters, the sets cache has been refetched; by the time the verdict mounts, `setsQ.data` reflects the bulk-checked state. No caller change required.
- No other consumers of `useBulkCheckAllInSession` exist (grep-verified by Validator at MAJ-2).

E2E Case A step 10 asserts `600 kg` in the headline (the bulk-checked working set's volume). Pre-fix this would have rendered `0 kg`. Load-bearing regression check.

### MIN-1 — Kernel duplication

**Addressed.** `sumLiveVolume` at `src/utils/volume-target.ts:78-90` gets an `export` keyword. `computeCurrentSessionVolumeByExercise` groups sets by `exercise_id` and reduces each group via the imported `sumLiveVolume`. Removes the duplicated predicate (warmup skip + `completed_at != null` + `weight > 0` + `reps > 0`) from the new module. Unit test case 21 confirms the reduction is faithful.

### MIN-2 — E2E dialog handler

**Addressed.** Both Case A (step 4) and Case B (step 3) of the e2e plan now explicitly register `page.on("dialog", d => d.accept())` BEFORE the Finish click, mirroring `crud.spec.ts:184`. Stated as a numbered step so the Implementer cannot drift.

### MIN-3 — Headline skeleton reading as broken

**Addressed.** Loading state revised: render `+0 PRs` eagerly as soon as `session.data + setsQ.data + exercisesQ.data` are present; only the PR-list slot shows a skeleton until `lifetimeQ.data` resolves. The headline updates atomically when the lifetime read returns. Briefly wrong (~200ms post-Finish) but reads as a coherent screen, not a half-broken one. Documented in the Loading state section.

### MIN-4 — Zero-volume empty-state copy

**Addressed.** Two empty-state strings, selected by `totalVolumeKg === 0`:

- Zero volume: `"No sets logged — your next session counts."`
- Non-zero volume, no PR: `"Solid session — keep it consistent."`

Same visual treatment; only the lead clause differs. Implementation sketch in the Page composition copy-delta section. E2E Case B asserts the zero-volume string.

### MIN-5 — Cold deep-link race

**Acknowledged, no change needed.** Validator flagged this as benign. The loading-state revision (MIN-3) covers the deep-link cold case via the eager-`+0 PRs` rule once `isHeadlineReady` flips true.
