# Design v1 — 2026-05-22_0152_end-of-session-verdict

## Goal (1 sentence)

Insert a one-shot, read-only "Workout summary" screen between `useFinishSession`'s success and the workout-tab root that shows `+N PRs · Y kg · Zh Wm`, the list of exercises that beat their prior lifetime best in the just-finished session, and a single "Done" button.

## Approach

After a Finish mutation resolves, replace the live-screen route with `/(app)/workout/verdict/<sessionId>` instead of `/(app)/workout`. The verdict screen is a pure read-only surface: it consumes the four queries already warm in cache from the live screen (`useSession`, `useSetsForSession`, `useLifetimeWeeklyVolume`, `useAllExercises`), then derives display data via two pure helpers in a new module `src/utils/session-verdict-math.ts` — one for per-exercise current-session volume, one for PR detection. PR detection follows Discovery's option (c): filter `WeeklyVolumeRow[]` to `session_id !== currentSessionId` before passing to the existing `computeLifetimeMaxPerExercise`, then compare each per-exercise current-session volume against that prior-only max with strict `>` and a `priorMax > 0` guard (mirrors `computePrExerciseIdsThisWeek`). The Done button calls `router.replace("/(app)/workout")`. No schema change, no new server query, no new RLS policies. The screen is idempotent against the persisted session, so a deep-link or app reload mid-verdict still renders correctly.

## Mudanças por arquivo

| File | Type | Change |
|---|---|---|
| `app/(app)/workout/verdict/[sessionId].tsx` | new | The verdict screen. Renders headline + PR list + Done button. Inherits `workout/_layout.tsx`'s `<Stack>`. Sets `<Stack.Screen options={{ title: "Workout summary", headerShown: true }} />`. |
| `src/utils/session-verdict-math.ts` | new | Two pure helpers: `computeCurrentSessionVolumeByExercise(sets)` and `computePrsForSession({ rows, currentSessionId, currentSessionVolumeByExercise })`. No React, no Supabase. |
| `tests/unit/session-verdict-math.test.ts` | new | Unit tests for both helpers. Mirrors `tests/unit/progress-page-math.test.ts` style — `mkRow` / `mkSet` fixtures, named tests by case. |
| `tests/e2e/end-of-session-verdict.spec.ts` | new | Two e2e cases: (a) finish session that beats a seeded prior session → verdict shows `+1 PRs`, PR row visible, Done returns to `/workout`; (b) finish session with no logged sets → verdict shows `0 PRs · 0 kg`, no PR list, encouraging copy. |
| `app/(app)/workout/[sessionId].tsx` | edited | At `finishAfterMutation` (line 225-233), change the post-`mutateAsync` `router.replace("/(app)/workout")` to `router.replace(\`/(app)/workout/verdict/${sessionId}\`)`. Single line in a helper used by all three Finish branches. No other edits. |
| `src/components/session-summary-row.tsx` | edited | Export the existing module-private `formatDuration` function. Single keyword addition (`export function formatDuration ...`). No behavior change. |
| `tests/e2e/crud.spec.ts` | edited | The `"workout: start ad-hoc, finish, see in history"` test (lines 162-202) currently asserts `page.waitForURL(/\/workout$/)` immediately after Finish. After this feature, Finish replaces to `/workout/verdict/<id>` first. Update: wait for the verdict URL, assert `"0 PRs"` headline, click "Done", then wait for `/workout$`. |
| `docs/features.md` | edited | Move the verdict-screen item from the pending `[ ]` list to `## Done`. Conductor responsibility post-merge; listed here so the Implementer doesn't touch it. |

**One-responsibility audit**: each new file has a single responsibility. The two helper functions in `session-verdict-math.ts` share a module because they are co-applied (current-session bucketing feeds PR detection); splitting them buys nothing. The `session-summary-row.tsx` edit is a keyword change; no responsibility shift.

## Page composition

`app/(app)/workout/verdict/[sessionId].tsx` render tree:

```
<View flex-1 bg-white dark:bg-black>
  <Stack.Screen options={{ title: "Workout summary", headerShown: true }} />

  {loadingGuard ? <LoadingState /> :
   errorGuard   ? <ErrorState  /> :
                  <Content     />}
</View>
```

### Content render tree (data ready)

```
<ScrollView contentContainerClassName="pb-24">
  {/* Headline block */}
  <View className="border-b border-gray-200 px-4 py-5 dark:border-gray-800">
    <Text className="text-xs uppercase tracking-wide text-gray-500">
      Workout summary
    </Text>
    <Text
      className="mt-1 text-3xl font-semibold tabular-nums text-black dark:text-white"
      accessibilityLabel={a11yHeadline}
    >
      {prCountLabel} · {formatVolume(totalVolumeKg, unit)} · {durationLabel}
    </Text>
  </View>

  {/* PR list OR empty copy */}
  {prs.length > 0 ? (
    <View className="pb-2">
      <Text className="mt-4 mb-2 px-4 text-sm font-medium uppercase text-gray-500">
        New PRs
      </Text>
      {prs.map((pr) => (
        <Pressable
          key={pr.exerciseId}
          accessibilityRole="button"
          accessibilityLabel={`${pr.exerciseName}, view progress`}
          onPress={() => router.push(`/(app)/exercises/${pr.exerciseId}/progress`)}
          className="border-b border-gray-100 px-4 py-3 active:bg-gray-50 dark:border-gray-900 dark:active:bg-gray-950"
        >
          <View className="flex-row items-center justify-between">
            <Text className="flex-1 text-base font-medium text-black dark:text-white">
              {pr.exerciseName}
            </Text>
            <View className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 dark:bg-emerald-900">
              <Text className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                PR
              </Text>
            </View>
          </View>
          <Text className="mt-1 text-sm tabular-nums text-emerald-700 dark:text-emerald-400">
            {`+${formatVolume(pr.overflowKg, unit)}`} (was {formatVolume(pr.priorMaxKg, unit)})
          </Text>
        </Pressable>
      ))}
    </View>
  ) : (
    <View className="px-4 py-8">
      <Text className="text-center text-base text-gray-500">
        Solid session — keep it consistent.
      </Text>
    </View>
  )}
</ScrollView>

{/* Bottom Done bar (sticky outside ScrollView) */}
<View className="border-t border-gray-200 px-4 py-4 dark:border-gray-800">
  <Button
    label="Done"
    variant="primary"
    onPress={() => router.replace("/(app)/workout")}
    accessibilityLabel="Done"
  />
</View>
```

### ASCII mockup — PR hit (2 PRs)

```
┌─────────────────────────────────────┐
│  ←  Workout summary                  │ ← native header (back chevron suppressed: no prior route, replace-arrival)
├─────────────────────────────────────┤
│                                      │
│  WORKOUT SUMMARY                     │ ← text-xs uppercase tracking-wide gray-500
│  +2 PRs · 5,240 kg · 1h 12m          │ ← text-3xl font-semibold tabular-nums
│                                      │
├─────────────────────────────────────┤
│                                      │
│  NEW PRS                             │ ← section header
│                                      │
│  Bench press                  [PR]   │ ← emerald pill
│  +210 kg (was 5,030 kg)              │ ← emerald sub-line, tabular-nums
│  ─────────────────────────────────   │
│  Incline curl                 [PR]   │
│  +60 kg (was 960 kg)                 │
│  ─────────────────────────────────   │
│                                      │
│  (ScrollView scrolls here if list    │
│   exceeds viewport — rare; ≤5 PRs    │
│   per session.)                      │
│                                      │
├─────────────────────────────────────┤
│  ┌───────────────────────────────┐  │
│  │           Done                │  │ ← bg-black dark:bg-white, full-width
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

### ASCII mockup — no PRs (common case)

```
┌─────────────────────────────────────┐
│  ←  Workout summary                  │
├─────────────────────────────────────┤
│                                      │
│  WORKOUT SUMMARY                     │
│  0 PRs · 3,400 kg · 48m              │ ← `0 PRs` (no plus sign for zero)
│                                      │
├─────────────────────────────────────┤
│                                      │
│                                      │
│    Solid session — keep it           │ ← text-center text-base text-gray-500
│    consistent.                       │
│                                      │
│                                      │
│                                      │
├─────────────────────────────────────┤
│  ┌───────────────────────────────┐  │
│  │           Done                │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

### Loading state

`useLifetimeWeeklyVolume` is invalidated by `useFinishSession.onSuccess`, so on first mount the lifetime read is refetching. The other three queries (`useSession`, `useSetsForSession`, `useAllExercises`) are warm. Strategy: render the headline eagerly if `session.data` + `setsQ.data` + `exercisesQ.data` are present (PR count shown as `—` or skeleton bar while lifetime is loading); render the PR list slot as a 3-line skeleton (mirrors `progress-hero.tsx:30-39`) until lifetime resolves; the Done bar is always visible.

Concretely:

```tsx
const isHeadlineReady =
  session.data && setsQ.data && session.data.ended_at != null;
const isPrListReady =
  lifetimeQ.data !== undefined && exercisesQ.data !== undefined;
```

- If `!isHeadlineReady` (extremely brief — `useSession` is cache-hit unless deep-link arrival): full-screen `<ActivityIndicator>`.
- If `isHeadlineReady && !isPrListReady`: headline renders with `+? PRs · Y kg · Zh Wm` skeleton (a gray bar where the PR count would be), PR list slot renders the 3-bar skeleton.
- If `isPrListReady`: render PR list (or empty copy).

### Error state

If `session.isError || (session.data == null && !session.isLoading)`: render the same inline error pattern as `app/(app)/workout/[sessionId].tsx:316-326` — a centered `text-red-500` with the error message, plus a `<Button label="Done" onPress={replace(/workout)} />` so the user isn't trapped.

### Header / back-button

`<Stack.Screen options={{ title: "Workout summary", headerShown: true }} />`. Inside the `workout/` segment, the screen is reached via `router.replace`, so iOS / web back navigation has no prior route to return to — the back chevron is naturally suppressed. Web browser back from `/workout/verdict/<id>` returns to whatever was before `/workout/<id>` (typically `/workout`), which is acceptable: the user lands on the workout tab, no stale live-screen render.

## Hooks + helpers

### `src/utils/session-verdict-math.ts` (NEW)

```ts
import type { WeeklyVolumeRow } from "~/api/stats";
import type { SetRow } from "~/db/types";
import { computeLifetimeMaxPerExercise } from "~/utils/progress-page-math";

/**
 * Per-exercise volume (kg) for the just-finished session, computed from the
 * session's set rows. Mirrors `sumLiveVolume` in `volume-target.ts`:
 *   - skip warmups
 *   - require `completed_at != null`
 *   - require `parseFloat(weight) > 0 && reps > 0`
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
 *   1. Filter `rows` to those with `row.session_id !== currentSessionId` (the
 *      lifetime read is refetched after Finish and includes the current
 *      session's rows; removing them gives the prior-only baseline).
 *   2. Run `computeLifetimeMaxPerExercise` on the filtered rows.
 *   3. For each exercise present in `currentSessionVolumeByExercise`, emit a
 *      `SessionPr` iff `currentKg > priorMaxKg && priorMaxKg > 0`.
 *
 * Edge cases:
 *   - Exercise with zero prior finished sessions → priorMaxKg is 0 → NOT a PR.
 *   - Exact tie (currentKg === priorMaxKg) → NOT a PR (strict `>`).
 *   - Multiple sessions in the same ISO week prior to this one → each prior
 *     session contributes its own per-session volume to the priorMax map; the
 *     max wins (existing helper behavior).
 *   - Warmup-only / weight-0 / reps-0 contributions are filtered upstream by
 *     `computeCurrentSessionVolumeByExercise` and inside
 *     `computeLifetimeMaxPerExercise`.
 *
 * Returns an array sorted by `overflowKg` DESC so the biggest PR appears
 * first. Deterministic tie-breaker: `exerciseId` ASC.
 */
export function computePrsForSession(opts: {
  rows: WeeklyVolumeRow[];
  currentSessionId: string;
  currentSessionVolumeByExercise: Map<string, number>;
}): SessionPr[];
```

### `src/components/session-summary-row.tsx` (EDITED)

```ts
// Before:
function formatDuration(startIso: string, endIso: string | null): string { ... }

// After (one keyword added):
export function formatDuration(startIso: string, endIso: string | null): string { ... }
```

No signature change. Existing callers inside `session-summary-row.tsx` (line 64) continue to use the local reference; new caller in `verdict/[sessionId].tsx` imports it.

### `app/(app)/workout/verdict/[sessionId].tsx` — composed state

Uses existing hooks; defines no new hook. Inline derivations via `useMemo`:

```ts
const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
const session = useSession(sessionId);
const setsQ = useSetsForSession(sessionId);
const lifetimeQ = useLifetimeWeeklyVolume();
const exercisesQ = useAllExercises();
const unit = useWeightUnit();

const totalVolumeKg = useMemo(
  () => sumLiveVolume(setsQ.data ?? []),
  [setsQ.data],
);
// NOTE: `sumLiveVolume` is module-private in volume-target.ts today. Either
// (a) export it (one keyword), or (b) inline the kernel in the verdict
// screen, or (c) reuse the new `computeCurrentSessionVolumeByExercise` and
// sum its values. Chosen: (c) — the per-exercise map is already needed for
// PR detection, and summing its values yields the same total without
// touching volume-target.ts. Concretely:
//   const totalVolumeKg = useMemo(() => {
//     let t = 0;
//     for (const v of currentByExercise.values()) t += v;
//     return t;
//   }, [currentByExercise]);

const currentByExercise = useMemo(
  () => computeCurrentSessionVolumeByExercise(setsQ.data ?? []),
  [setsQ.data],
);

const prs = useMemo(() => {
  if (!sessionId || !lifetimeQ.data || !exercisesQ.data) return [];
  const exMap = new Map(exercisesQ.data.map((e) => [e.id, e]));
  return computePrsForSession({
    rows: lifetimeQ.data,
    currentSessionId: sessionId,
    currentSessionVolumeByExercise: currentByExercise,
  }).map((pr) => ({
    ...pr,
    exerciseName: exMap.get(pr.exerciseId)?.name ?? "Unknown exercise",
  }));
}, [sessionId, lifetimeQ.data, exercisesQ.data, currentByExercise]);

const headlineParts = useMemo(() => {
  const prCount = prs.length;
  const prLabel = prCount > 0 ? `+${prCount} PRs` : `0 PRs`;
  const durationLabel = session.data?.ended_at
    ? formatDuration(session.data.started_at, session.data.ended_at)
    : "—";
  return { prLabel, durationLabel };
}, [prs.length, session.data]);
```

### Why a new helper instead of reusing `computePrExerciseIdsThisWeek`

`computePrExerciseIdsThisWeek` is week-scoped and runs the priorMax inside the same iteration that flags PR sessions (running max). For the verdict, the "current" volume is computed from `SetRow[]` (live-screen sets), not from `WeeklyVolumeRow[]`, because the lifetime read might not yet include the current session's rows by the time the verdict mounts. Reusing the existing helper would require either (a) waiting for the lifetime refetch (UX cost), or (b) injecting the current session manually into the rows (cross-cuts the helper's contract). A purpose-built helper is cleaner.

## Test plan

### Unit tests — `tests/unit/session-verdict-math.test.ts`

#### `computeCurrentSessionVolumeByExercise`

1. Empty `sets[]` → empty Map.
2. One working set, completed, weight `"100"`, reps `5` → `{ ex-1: 500 }`.
3. One warmup set, completed, `100x5` → empty Map (warmup excluded).
4. One unchecked set (`completed_at = null`), `100x5` → empty Map.
5. One working set with `weight = null` → empty Map.
6. One working set with `weight = "100"`, `reps = 0` → empty Map.
7. Two working sets same exercise → summed; different exercises → separate keys.
8. Mixed working + dropset same exercise → both included (dropset is not warmup).
9. Mixed warmup + working + unchecked working → only the checked working is counted.

#### `computePrsForSession`

10. Empty rows + empty current map → `[]`.
11. Current session has volume for ex-1 (500 kg), no prior sessions for any exercise → `[]` (priorMax guard).
12. Current session ex-1 = 500 kg, prior session "s0" for ex-1 = 400 kg → `[{ exerciseId: ex-1, currentKg: 500, priorMaxKg: 400, overflowKg: 100 }]`.
13. Strict-`>`: current ex-1 = 500, prior = 500 → `[]`.
14. Two priors: s0 = 400, s1 = 600; current = 700 → priorMax = 600, overflow = 100, single PR.
15. `currentSessionId` row leak: the rows array INCLUDES rows with `session_id === currentSessionId`; the helper MUST filter them out. Concretely: prior s0 = 400, current sCur = 800, the rows have s0 + sCur. Current map says sCur = 800. Result: PR with priorMax 400 (sCur rows ignored).
16. Multi-exercise: ex-1 PRs, ex-2 doesn't. Result has only ex-1.
17. Multi-exercise sort: ex-1 overflow = 100, ex-2 overflow = 250 → ex-2 listed first.
18. Tie-break: two PRs with equal overflow → sorted by `exerciseId` ASC.
19. Current map has an exercise not present in `rows` at all → that exercise's `priorMax = 0` → NOT a PR.
20. Rows contain only warmups (impossible at the API layer, defensive) → `computeLifetimeMaxPerExercise` filters them; no PRs.

### E2E tests — `tests/e2e/end-of-session-verdict.spec.ts`

#### Case A — finish with PR

1. Create confirmed user via admin API.
2. Pick a seed exercise (`exercises` table, first non-deleted row).
3. Seed a finished prior session 3 days ago with a single set: `100 kg × 5 = 500 kg`.
4. Sign in via UI, land on `/workout`.
5. Quick-start ad-hoc workout. Wait for `/workout/<id>`.
6. In the live screen, add the same exercise; log a working set at `100 kg × 6 = 600 kg`; check it.
   - Alternative implementation: seed the new live session's set via admin API to keep the e2e fast.
7. Tap Finish (`Finish workout` button via accessibilityLabel). Accept confirm dialog.
8. Wait for URL `/workout/verdict/<id>`.
9. Assert headline contains `+1 PRs`.
10. Assert PR row visible (exercise name + `PR` pill).
11. Assert overflow sub-line contains `+100 kg (was 500 kg)`.
12. Tap `Done`. Wait for URL `/workout$`. Assert workout tab root.

#### Case B — finish with no PR (empty-state path)

1. Create confirmed user.
2. Do NOT seed a prior session.
3. Sign in, quick-start ad-hoc, do not log any sets.
4. Tap Finish, accept confirm dialog.
5. Wait for `/workout/verdict/<id>`.
6. Assert headline contains `0 PRs` (no leading plus).
7. Assert empty-state copy `"Solid session — keep it consistent."` visible.
8. Assert PR pill NOT visible (no `PR` rounded-full badge in the DOM).
9. Tap `Done`. Wait for `/workout$`.

### crud.spec.ts update

Existing test (`tests/e2e/crud.spec.ts:162-202`): the post-Finish flow today waits for `/workout$` immediately after the Finish click. After this feature, that path goes through `/workout/verdict/<id>` first. Update:

```ts
// Before line 187 (after the Finish click):
//   await page.waitForURL(/\/workout$/, { timeout: 10_000 });

// After:
await page.waitForURL(/\/workout\/verdict\//, { timeout: 10_000 });
await expect(page.getByText(/0 PRs/).first()).toBeVisible({ timeout: 5_000 });
await page.getByText("Done", { exact: true }).last().click();
await page.waitForURL(/\/workout$/, { timeout: 10_000 });
// Then continue with the History tab assertion (unchanged).
```

Notes for the Implementer:
- The Finish click currently happens at line 185. The `0 PRs` assertion is the load-bearing one — without it, a race could resolve the next `waitForURL` before the verdict actually rendered.
- The dialog accept handler (`page.on("dialog", ...)`) is registered at line 184 — keep it; the verdict adds no new dialog.
- The two cross-week / edit-times tests (lines 204+) seed sessions directly into the DB and do NOT go through Finish, so they are unaffected.

### Type-check + lint

`pnpm tsc --noEmit` should pass. The new helper is fully typed; the verdict screen consumes typed hooks. No `any` is introduced.

## Riscos

### Data integrity

- **RLS**: no new tables, no new policies. All four queries the verdict consumes are gated by existing `auth.uid() = user_id` policies on `sessions`, `sets`, `exercises`. RLS posture unchanged.
- **Migrations**: none.
- **Idempotency**: the verdict performs zero mutations. Refreshing or revisiting the URL is safe.
- **Soft-deleted-session deep-link**: `useSession(id)` will 406 (`.is("deleted_at", null).single()`); the verdict renders the inline error fallback. Same posture as the live screen at `[sessionId].tsx:316-326`.

### UX regressions

- **`finishAfterMutation` is the single funnel for all three Finish branches** (`onFinish` zero-unchecked, `handleCheckAllAndFinish`, `handleDiscardUncheckedAndFinish`). Editing it once covers all three. Verified at `[sessionId].tsx:225-233, 249, 266, 304`.
- **Cancel-flow unaffected**: `onCancel` (`[sessionId].tsx:269-293`) calls `router.replace("/(app)/workout")` directly, not through `finishAfterMutation`. No change needed.
- **Back-button on the verdict**: arrives via `router.replace` → no prior route in the stack → iOS/Android native back has nothing to pop. On web, browser back goes one step back in history (typically `/workout`), which is fine.
- **`formatDuration` export**: only the keyword changes. Existing in-file callers are unaffected. No external caller of the module-private function exists today.
- **`session-summary-row.tsx` consumers** (History row, History detail): unchanged — the function is still locally referenced.
- **`crud.spec.ts` regression test**: if not updated, the post-Finish `/workout$` URL assertion will time out and the test will fail. Listed in the test plan above.

### Platform-specific

- **iOS**: `<Stack.Screen options={{ headerShown: true }} />` shows the native iOS nav bar; the back chevron is suppressed naturally because `router.replace` leaves no prior route. Confirmed pattern at `app/(app)/history/[id].tsx:179`.
- **Android**: same Stack behavior; native header renders; hardware back invokes the navigator's pop, which with no prior route exits to the tab root via expo-router's segment fallback. Acceptable.
- **Web**: native `<Stack>` maps to a div with no chrome by default; the route works as a real URL. Browser back from `/workout/verdict/<id>` returns to `/workout` (one step in browser history), which is acceptable. The Done button is the primary path.
- **NativeWind classes used**: all are vetted in the existing Progress page and history screens — `flex-1 bg-white dark:bg-black`, `text-3xl font-semibold`, `tabular-nums`, `border-t`, `bg-emerald-100 dark:bg-emerald-900`. No new color tokens.

### Performance

- **No new server round-trip at mount**: all four queries are warm-or-stale-but-cached. `useFinishSession.onSuccess` triggers a `["stats"]` invalidate which refetches `useLifetimeWeeklyVolume` — this refetch would have happened the next time the Progress page mounts; the verdict just consumes it earlier.
- **PR-detection cost**: same shape as `computePrExerciseIdsThisWeek` (already proven sub-100ms on the Progress page hero). Filter + reduce over the lifetime row set (~5-15k rows for a 3-year active user).
- **Render cost**: single ScrollView, typically 0-5 PR rows. No FlatList overhead.
- **Re-render churn**: `useMemo` on the three derived values keys on the underlying query data; React Query is the gatekeeper of identity. No infinite-render risk.
- **Cold deep-link** (rare — e.g., user reloads the page on the verdict URL): all four queries fetch from server. Worst case is ~1-2s on a poor connection; the screen renders the loading skeleton until the lifetime read completes. PR detection still correct because the option-(c) filter (`session_id !== currentSessionId`) works regardless of whether the current session's rows are present in the lifetime read.

## Alternativas descartadas

1. **Modal overlay on the live screen instead of a route.** Discarded because (a) every existing post-action surface in this app is a route, not a modal; (b) deep-link semantics break (no URL to share/reload); (c) the prompt says "screen"; (d) e2e tests assert against the Page DOM — a route is simpler. (Discovery Q2 already rejected this.)

2. **Persist a `prs` snapshot table** (`prs` table proposed in `docs/roadmap.md:124`, deferred). Discarded because the current read-time derivation is correct, fast, and adds no schema burden. The verdict's PR detection is consistent with the Progress page's `usePrsThisWeek` — both derive from the same `sets` rows. Persisting would introduce a write that could drift from the read-time semantic.

3. **Subtract the current session's volume from each exercise's lifetime max post-mutation** (Discovery Q3 option (a)). Discarded because to recover the prior-runner-up max, we'd need the 2nd-best session's volume, not just the post-mutation max minus this session — and the existing `computeLifetimeMaxPerExercise` returns only the max, not a sorted list. Option (c) (filter `session_id !== currentSessionId`) is cleaner.

4. **Snapshot the lifetime rows BEFORE the Finish mutation runs** (Discovery Q3 option (b)). Discarded because plumbing a snapshot from the live screen to the verdict screen through route params or a global store is brittle; the snapshot would also bypass React Query's cache semantics. Option (c) keeps the read-time derivation pure and cache-consistent.

5. **Reuse `<MaxNowToPrLine>` for PR rows.** Discarded — Discovery Q6 documented why it's structurally wrong: `gap = max - now`, and on a PR row `now > priorMax`, so `gap = 0` and the "To PR" reading is meaningless. A simpler row (`+overflowKg (was priorMax)`) is purpose-built for the verdict.

6. **Reuse `<SessionSummaryRow>` for the headline.** Discarded — that component is a list-row interaction (Pressable with `>` chevron) optimized for tap-to-detail. The verdict's headline is a hero-style block, not a row. Reusing would force layout contortions for a one-time surface.

7. **Single shared module for `formatDuration`** (move to `src/utils/format-time.ts`). Discarded for this run — moving + updating imports adds churn for a one-line beneficiary. The `export` keyword is the minimal diff. A future run that adds more duration consumers can extract.

8. **Show the verdict in History as a permanent surface.** Out of scope per the prompt — listed under Out of scope.

## Out of scope

- New `prs` snapshot table (deferred per `docs/roadmap.md:124`).
- Notifications / haptics / confetti on PR.
- Sharing the verdict (screenshot, URL share button).
- Re-deriving the verdict for sessions edited from History after the fact.
- Comparing this session against same-routine history (e.g., "vs your last Push Day").
- e1RM or single-rep-max PRs (the codebase has no such concept).
- Cancel-flow verdict (cancellation discards the session; no verdict).
- Showing the verdict inside the History detail screen as a permanent surface.
- Moving `formatDuration` to `src/utils/`.
- Updating `docs/features.md` from the Implementer's side — Conductor responsibility.
