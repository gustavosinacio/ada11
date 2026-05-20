# Design v1 — 2026-05-20_0302_exercise-progress-graph

## Goal (1 sentence)
Make tapping an exercise in the list land on the existing progress chart, with the edit form reachable from a pencil icon on the progress header — mirroring the measurements view→edit pattern — and fix the stale `["progress"]` cache after a workout finishes.

## Approach

The progress screen (`app/(app)/exercises/[id]/progress.tsx`) is already functional — two charts (Epley 1RM + total volume), unit-aware, with loading and empty states. The user's complaint is purely IA: "click an exercise" currently drops you into a form, not the chart.

We adopt **IA option A4** (Discovery's enumerated hybrid): list-row → progress; progress screen gets a `headerRight` pencil → edit. This mirrors the iOS Contacts/Photos pattern and, more importantly for consistency, the **measurements view→edit precedent we just shipped**. The edit form keeps its existing route, its delete affordance, its zod schema — only the entry point moves. The form's mid-page "View progress" CTA becomes obsolete and is removed (no longer the canonical path to the chart).

Two further small calls fit naturally inside this scope:

1. **New-exercise flow lands on edit, not progress** — A freshly created exercise has zero sessions; pushing it onto the chart would show only the empty state. `app/(app)/exercises/new.tsx` currently calls `router.back()` after create, which already returns to the list (correct). The list row then routes to the chart (correct: shows empty state on first tap, which is honest). We do **not** add a special-case "land on edit after create" — the empty state is clear and the pencil is one tap away. State this explicitly so the Validator doesn't flag it.

2. **Cache invalidation on session finish** — `useFinishSession` (`src/hooks/use-sessions.ts:53-64`) currently invalidates `["sessions"]` and `["stats"]`, but not `["progress"]`. After finishing a workout, the user navigates to an exercise they just trained, sees a stale chart, and either pulls-to-refresh (no such gesture wired) or waits for TanStack's focus refetch. Since finishing a session is the **only** moment that adds new data points to `listSetsForExercise` (it filters on `ended_at IS NOT NULL`), invalidating `["progress"]` here is the correct, complete fix. Scope cost: one line.

No new files. No new dependencies. No DB changes. No changes to `ProgressChart`, `listSetsForExercise`, or `useExerciseProgress`. We keep the two existing metrics (Epley 1RM, total volume) and the all-time x-axis range — Discovery flagged a "many points on narrow chart" concern at 2-year scale but that's a chart-density problem, not a "wire the screen" problem, and the prompt says "important info", not "limit the range".

## Decisions on Discovery unknowns

| # | Discovery question | Decision | Rationale |
|---|---|---|---|
| 1 | IA option (A1/A2/A3/A4) | **A4** | Matches the measurements view→edit precedent shipped recently. Tap = view, pencil = edit. Edit remains reachable so delete is not stranded. Strongest UX for the literal prompt without rebuilding the screen. |
| 2 | Which metrics count as "important info" | **Keep current two** (Epley 1RM per session, total volume per session) | Discovery confirmed both exist. Out-of-scope flags explicitly forbid adding metrics. "Important info" is already implemented; the prompt is about reaching it, not redesigning it. |
| 3 | X-axis range | **All-time, unchanged** | Existing behavior. Capping/range toggle is a chart-content change; the prompt is about navigation. Flag as a future polish, not this run. |
| 4 | Empty-state threshold | **Unchanged** — the existing 0-working-sets branch in `progress.tsx:96-102` is sufficient. With exactly 1 session, `ProgressChart` renders the big-number readout; that's a real data point and acceptable. | Reusing what's there. No code change required. |
| 5 | Cache invalidation after workout finish | **Include in this run.** Add `qc.invalidateQueries({ queryKey: ["progress"] })` to `useFinishSession.onSuccess`. | One-line fix. Without it, the new navigation pattern will look broken ("I just finished bench, why isn't the chart updated?"). Aligns with the run's theme: "make progress charts feel right." |
| 6 | Chart icon on the list-row itself (secondary affordance) | **No.** Row tap is the only affordance; chevron stays. | Discovery's own recommendation. Adding an icon to the row is clutter and redundant once the whole row already navigates to the chart. |
| 7 | New-exercise exception (land on edit instead of chart) | **No exception.** After `router.back()`, the user is on the list. Tapping the new exercise routes to progress, which renders the empty state with a clear CTA ("Complete a workout..."). Pencil → edit if they want to revise the form. | Strong-like apps do the special-case; ada11 does not need to. The empty state already exists and reads correctly. Adds zero code. |
| 8 | Header chrome on progress screen | `Stack.Screen` with `title = exercise.name ?? "Progress"` (already set, keep). Add `headerRight` = pencil icon (lucide `Pencil`), tappable area ≥40×40 via `px-3 py-1` padding, color from `useColorScheme()` per measurements precedent, `accessibilityLabel="Edit exercise"`, `accessibilityRole="button"`, navigates to `/(app)/exercises/${id}`. | Matches `exercises/index.tsx:19-29` (the canonical headerRight icon-button pattern in this app) and the measurements view→edit shipping convention. |
| 9 | Delete affordance after IA change | **Lives in the edit screen, unchanged** at `app/(app)/exercises/[id]/index.tsx:208-215`. Reachable via progress → pencil → edit (one tap deeper than today, but discoverable). | Soft-delete invariant preserved. No code change. |
| 10 | Stale-cache fix in this run vs deferred | **In this run** (see Decision #5 above). | Small enough to bundle; large enough that omitting it makes the IA change feel broken. |

## Mudanças por arquivo

| File | Type | Change |
|---|---|---|
| `app/(app)/exercises/index.tsx` | edited | Change row `onPress` destination from `/(app)/exercises/${item.id}` to `/(app)/exercises/${item.id}/progress`. **Single responsibility.** No other change. |
| `app/(app)/exercises/[id]/progress.tsx` | edited | Add `headerRight` pencil button to `Stack.Screen` (in both the loading branch and the main branch, to match the existing `title` duplication on lines 73 and 84-86). Button navigates to `/(app)/exercises/${id}`. Uses `useColorScheme()` for icon color, `lucide-react-native`'s `Pencil`, `accessibilityLabel="Edit exercise"`, `accessibilityRole="button"`, `px-3 py-1` padding. **Single responsibility.** |
| `app/(app)/exercises/[id]/index.tsx` | edited | Remove the mid-page "View progress" `<Link>` block (lines 185-194). It was the prior workaround entry to the chart; the new IA replaces it. **Single responsibility** (delete obsolete CTA). All other edit-screen behavior (zod schema, save, cancel, delete) untouched. |
| `src/hooks/use-sessions.ts` | edited | In `useFinishSession.onSuccess`, add `qc.invalidateQueries({ queryKey: ["progress"] })` after the existing `["stats"]` invalidation. **Single responsibility** (cache correctness on session finish). |

No new files. No deletions. No migrations. No package additions.

## Contratos de I/O

### Function signatures / types added or changed
**None.** Public signatures of `useExerciseProgress`, `listSetsForExercise`, `ProgressChart`, `useFinishSession`, `useExercise`, `useExercises` are unchanged.

The only behavior change with externally observable impact is `useFinishSession.onSuccess`:

```ts
// src/hooks/use-sessions.ts — useFinishSession
// BEFORE
onSuccess: (row) => {
  qc.setQueryData(KEYS.active, null);
  qc.invalidateQueries({ queryKey: KEYS.all });
  qc.setQueryData(KEYS.detail(row.id), row);
  qc.invalidateQueries({ queryKey: ["stats"] });
}

// AFTER
onSuccess: (row) => {
  qc.setQueryData(KEYS.active, null);
  qc.invalidateQueries({ queryKey: KEYS.all });
  qc.setQueryData(KEYS.detail(row.id), row);
  qc.invalidateQueries({ queryKey: ["stats"] });
  qc.invalidateQueries({ queryKey: ["progress"] });
}
```

Invalidation by the umbrella key `["progress"]` matches every `["progress", exerciseId]` entry (TanStack prefix match). No new cache namespace introduced.

### DB columns / queries
**None.** Soft-delete invariant preserved (`deleted_at IS NULL` filter unchanged in `listSetsForExercise`). RLS uniform (`auth.uid() = user_id`). No new queries.

### UI props / state
**None.** No prop additions to `ProgressChart`, `ExerciseListItem`, or any other component. The progress screen's `Stack.Screen options` object gains a `headerRight` function — local to the screen, not a new public contract.

The `headerRight` callback shape (matches `exercises/index.tsx:19-29`):

```tsx
headerRight: () => (
  <Pressable
    onPress={() => router.push(`/(app)/exercises/${id}`)}
    accessibilityLabel="Edit exercise"
    accessibilityRole="button"
    className="px-3 py-1"
  >
    <Pencil color={colorScheme === "dark" ? "#fff" : "#000"} size={22} />
  </Pressable>
)
```

`router` from `useRouter()`, `colorScheme` from `useColorScheme()`, `Pencil` from `lucide-react-native` (already in deps — used elsewhere in the app).

## UI spec

**Exercise list row** (`exercises/index.tsx`):
- Visual: unchanged. Chevron stays.
- Behavior: tap routes to `/(app)/exercises/${id}/progress` instead of `/(app)/exercises/${id}`.
- Accessibility: existing label on `ExerciseListItem` (`accessibilityRole="button"`) is sufficient; no semantic change needed for screen readers.

**Progress screen** (`exercises/[id]/progress.tsx`):
- Header: `title` = exercise name (already wired). New `headerRight` = `Pencil` icon, 22px, color follows color scheme. Tap area ≥40×40 via `px-3 py-1`.
- Both the loading branch (`Stack.Screen` on line 73) and the loaded branch (`Stack.Screen` on lines 84-86) must declare the same `headerRight` so the pencil doesn't pop in only after data arrives.
- Body: unchanged.

**Edit screen** (`exercises/[id]/index.tsx`):
- Visual: the mid-page "View progress" outlined button is removed. The form is tighter by one element. Save/Cancel/Delete keep their positions.
- Header: unchanged ("Edit exercise" title, no `headerRight`).
- Back gesture: returns to wherever the user came from (progress screen via pencil, or list directly if deep-linked).

**Dark mode**: All affected screens already use `bg-white dark:bg-black` and color-scheme-aware icon colors. The new `Pencil` follows the same `colorScheme === "dark" ? "#fff" : "#000"` convention.

## Riscos

- **Data integrity**:
  - No DB changes. RLS unchanged. Soft-delete invariant preserved.
  - The new `qc.invalidateQueries({ queryKey: ["progress"] })` on session finish invalidates **all** per-exercise caches, not only the ones touched in the session. This is intentional (we don't know which exercises were trained without re-querying) and cheap (TanStack refetches lazily on next observer). No correctness risk.
- **UX regressions**:
  - **The list row no longer goes to the edit form.** Any user with muscle memory ("tap exercise → edit") will be momentarily disoriented; the pencil affordance on the progress screen is the recovery path. Mitigation: pencil is in the canonical headerRight position; same shape as the existing `Plus` button on the exercises list, which users have seen. Low risk; expected behavior shift, not regression.
  - **One extra tap to delete an exercise** (list → progress → pencil → edit → Delete, vs list → edit → Delete before). Acceptable: delete is an infrequent destructive action; one extra tap is not a real friction point.
  - **Back-gesture chain depth +1**: from inside the edit form, `router.back()` now lands on the progress screen, not the list. The Save handler calls `router.back()` on success (`exercises/[id]/index.tsx:71`). After save, the user lands on the progress screen of the same exercise — actually a nice flow ("here's the chart for what you just edited"). Cancel button calls `router.back()` too — same target. Delete also calls `router.back()` — but the exercise no longer exists; the progress screen will then attempt to load a soft-deleted exercise. **This is a real bug surface.** See "Open questions for Validator" #1.
- **Platform-specific**:
  - `lucide-react-native`'s `Pencil` is universal (used elsewhere already). No iOS/Android/web divergence expected.
  - `headerRight` rendering in `expo-router` is consistent across all three platforms; same hook already runs in the exercises list header.
- **Performance**:
  - `useFinishSession` now triggers one extra prefix invalidation. Cost: O(cached progress entries), which is bounded by the number of distinct exercises the user has ever opened — typically <50. Negligible.
  - No new queries, no new renders, no new memoization.

## Alternativas descartadas

1. **A2 (smallest change) — keep list-row → edit, add a chart icon in edit's `headerRight`.** Discarded because it does not satisfy the literal prompt ("when clicking on an exercise, I want to see a progress graph"). The user would still tap an exercise and see a form. Minimal-scope is not a virtue when the requested UX is unsatisfied.
2. **A3 (restructure edit into detail+strip).** Discarded because it duplicates the full progress screen content into the edit screen, conflicts with the "DO NOT REBUILD" constraint in the brief, and has a larger blast radius than the prompt warrants. Also breaks the "form-as-form" mental model.
3. **A1 (list → progress; move edit behind a header icon).** Functionally identical to A4 in outcome (same icon, same screens). A4 is just A1 with the IA reasoning anchored explicitly to the measurements precedent. Calling it A4 keeps the lineage to a shipping pattern; otherwise this is the same fix.
4. **Add `Pencil` as a row-level action (long-press, swipe-action, or trailing icon) instead of as a header pencil.** Discarded: introduces a new interaction primitive not used elsewhere in the app, and the header pencil already serves the purpose with minimal code. YAGNI.
5. **Defer the cache invalidation to a separate run.** Discarded because shipping the IA without the cache fix produces an obviously-broken user perception ("just finished bench, chart didn't update"). The cost-to-fix is one line; the cost-to-defer is a regression report.
6. **Special-case the post-create flow (after creating an exercise, land on edit, not progress).** Discarded: the empty state on progress is informative ("No working sets recorded yet. Complete a workout with this exercise to see progress."), the pencil is one tap away, and the special-case adds code without solving a real complaint.

## Out of scope

- Adding new chart metrics (heaviest working set per session, total reps, working-set count, PR markers). Held per brief.
- X-axis range capping or a date-range toggle (Discovery unknown #3). Future polish.
- Per-muscle aggregate progress, cross-exercise comparison, 1RM goals. Out per brief.
- Extracting the inline `useMemo` series-builder in `progress.tsx:29-68` into a pure helper a la `entriesToWeightSeries`. Refactor with no behavior change; not required for this run.
- Replacing the screen's inline `.toFixed(1)` / `>=1000 ? /k : toFixed(0)` value formatters with `formatWeight` / `formatVolume` from `src/utils/units.ts` (minor inconsistency flagged in Discovery). Out: zero user-visible change.
- Adding a pull-to-refresh on the progress screen. The session-finish invalidation makes this unnecessary for the only case where it would matter.

## Open questions for Validator

1. **Delete-from-edit landing screen.** After `useSoftDeleteExercise` succeeds, `exercises/[id]/index.tsx:87` calls `router.back()`. Under A4, "back" from edit is the progress screen of the now-deleted exercise. The progress screen's `useExercise(id)` query will then either:
   - Return a cached row (until the next refetch) — chart renders against a now-orphaned exercise. Cosmetic only; data is unchanged.
   - Return `null` after the `["exercises"]` invalidation propagates — `exercise.data?.name` falls back to `"Progress"`, charts still render against the (still-existing) set rows.

   Both states are non-broken but visually awkward. Two possible fixes:
   - (a) In the delete handler, call `router.dismissAll()` then `router.replace("/(app)/exercises")` instead of `router.back()`. Forces a return to the list.
   - (b) Accept current behavior; the back-button-mash will get them out fast and the data is consistent.

   **My call**: (a) is correct and tiny — one handler change in `exercises/[id]/index.tsx`. But it's adjacent to the IA change, not the IA change itself. Validator: is it in scope or a separate ticket? **Default if Validator doesn't push back: include (a) as a fifth file change.**

2. **`Stack.Screen` `headerRight` duplication in the loading branch.** The progress screen declares `<Stack.Screen options={{ title: "Progress", headerShown: true }} />` inside the loading view (line 73) and a different one in the loaded view (lines 84-86). To avoid the pencil popping in only after data arrives, we duplicate the `headerRight` in both — slight DRY violation but matches the file's existing pattern. Validator: acceptable, or should we hoist `Stack.Screen` to a single point? Hoisting is a refactor beyond scope; default is duplicate.

3. **Loading-branch pencil target.** During the brief loading window, the pencil is tappable and would route to `/(app)/exercises/${id}` (edit). Edit screen has its own loading state. No bug, but worth a yes/no.

## Resposta a issues do Validator
Not applicable (this is v1).
