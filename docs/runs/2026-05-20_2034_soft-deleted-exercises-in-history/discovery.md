# Discovery — 2026-05-20_2034_soft-deleted-exercises-in-history

## Feature prompt

> "Soft-deleted exercises should remain fully visible in past workout history (sessions, sets, totals, weekly volume aggregates) — only the exercise picker and the Exercises library list should exclude them. Today the history detail filters via the same `useExercises()` query the picker uses (`app/(app)/history/[id].tsx:93,99-104`), so `ExerciseBlock`s for soft-deleted exercises silently disappear while the session header keeps counting their sets toward volume — visible inconsistency. Fix likely needs a separate 'include deleted' query/hook for history surfaces, leaving the picker on the current filtered call."

## Scope summary

Surfaces that show historical workout data must keep rendering exercises whose row was soft-deleted; surfaces that **pick or curate** an exercise library must keep hiding them. Today both kinds of surface share the same TanStack query (`useExercises` → `listExercises` filtered by `deleted_at IS NULL`), so the history detail silently drops sets that belong to a deleted exercise while still counting them in the session header total. The split needs to happen at the API/hook layer, with the picker and library staying on the existing filtered call.

## Affected files (verified)

### The bug surface

- `app/(app)/history/[id].tsx:41` — `const exercisesQ = useExercises();` — same hook the picker uses.
- `app/(app)/history/[id].tsx:72-98` — `orderedExercises` builds a `Map<id, ExerciseRow>` from `exercisesQ.data` (line 73) and only pushes blocks where `exMap.get(s.exercise_id)` returns a row (lines 79-83). Soft-deleted exercises silently disappear from the block list.
- `app/(app)/history/[id].tsx:100-122` — `setsByExercise` and `totals` reduce over the **full** `setsQ.data` (lines 102, 113). Both `totalSets` and `totalVolumeKg` therefore include sets for the missing-from-`exMap` exercise. **This is the visible inconsistency**: block list shows N exercises, header reads `Total: M sets · X kg volume` where M > sum of visible blocks.
- `app/(app)/history/[id].tsx:215-220` — Where the totals are rendered (`Total: {totals.totalSets} ...`).

### The hook + API behind it

- `src/hooks/use-exercises.ts:12-30` — TanStack keys: `KEYS.all = ["exercises"]`, `KEYS.detail = ["exercises", id]`. `useExercises()` (17-22) maps to `listExercises`; `useExercise(id)` (24-30) maps to `getExercise`. **Both filter `deleted_at IS NULL` server-side.**
- `src/api/exercises.ts:11-19` — `listExercises()` applies `.is("deleted_at", null)`.
- `src/api/exercises.ts:21-30` — `getExercise(id)` applies `.is("deleted_at", null).single()` → throws on soft-deleted ids (matters for `/exercises/[id]` edit and `/exercises/[id]/progress`).
- `src/api/exercises.ts:71-77` — `softDeleteExercise(id)` writes `deleted_at = now()`. **No hard delete path exists.** FK from `sets.exercise_id` is `RESTRICT` (see `docs/data-model.md:60` and the schema dump), so historical sets are guaranteed to be referenceable.
- `src/hooks/use-exercises.ts:54-62` — `useSoftDeleteExercise` invalidates only `KEYS.all = ["exercises"]`. If we introduce a second key (option (a)/(b)), this mutation **must** invalidate both.

### Other consumers of `useExercises` / `useExercise` — categorized

Verified via `grep -rn "useExercises\|useExercise\b\|listExercises\|getExercise" src app tests`.

**Picker / library surfaces (should keep excluding deleted — current behavior is correct):**
- `src/components/exercise-picker.tsx:14,26` — `useExercises()` populates the Pick exercise modal. Used in three places: `app/(app)/history/[id].tsx:295` (add exercise into a finished session), `app/(app)/workout/[sessionId].tsx:334` (live session), `app/(app)/routines/[id]/index.tsx:262` (routine builder).
- `app/(app)/exercises/index.tsx:6,11` — Exercises library list (the FlatList at lines 58-69 is the "library").

**History / per-exercise progress surfaces (should INCLUDE deleted to match the fix):**
- `app/(app)/history/[id].tsx:19,41` — **the bug** (see above).
- `app/(app)/workout/[sessionId].tsx:19,39,85` — Live workout name lookup. If a user soft-deletes from `/exercises/[id]` while a session is open (rare, but possible), the same disappearing-block + miscounted-header issue applies. **Owner's prompt explicitly scopes the fix to history**, so this is flagged in Unknowns rather than included.
- `app/(app)/exercises/[id]/index.tsx:15,34` — Edit screen via `useExercise(id)`. If `id` is soft-deleted, the server query 404s (line 23-29 filters `.is("deleted_at", null).single()`). User can reach this from `progress.tsx`'s headerRight Pencil button (line 47).
- `app/(app)/exercises/[id]/progress.tsx:15,34` — Per-exercise progress chart. `useExercise(id)` fails for soft-deleted ids → header title falls back to literal "Progress" (line 43) but the chart itself (driven by `useExerciseProgress(id)` → `src/api/progress.ts:listSetsForExercise`) still loads historical sets. **Mixed state**: data renders, name doesn't. Worth flagging.

**Indirect / non-name-using surfaces — verified NOT affected:**
- `src/components/weekly-volume-strip.tsx:38-65` — Pure volume sum, no exercise-name lookup. **Unaffected by this bug regardless of fix.**
- `app/(app)/history/week/[isoWeek].tsx:80-102` — Lists sessions + reduces `useWeeklyVolume` rows for the headline. Sessions don't materialize exercise names; weekly-volume rows don't either (only `weight`, `reps`, `set_type`, `completed_at`). **Unaffected.**
- `src/components/session-summary-row.tsx:38-76` — Shows date/duration/optional totals as props — never reads exercise rows. **Unaffected.**
- `app/(app)/history/index.tsx:11-62` — Sessions list. No per-session exercise breakdown. **Unaffected.**

### Adjacent finding — out-of-scope but flagged

- `src/api/routine-exercises.ts:14-25` — `listRoutineExercises` joins `*, exercise:exercises(*)` **without** `.is("deleted_at", null)` on the embedded select. PostgREST embedded selects don't inherit parent filters, so a routine row pointing at a soft-deleted exercise still renders the exercise name in the routine builder. This is **outside the prompt's scope** (history vs picker/library) and is the routine surface's own decision; flagging in Unknowns.

### Tests

- `tests/e2e/crud.spec.ts:131-202` — Exercise create + workout-from-routine flows. **No soft-delete-exercise coverage.**
- `tests/e2e/crud.spec.ts:309-312` — Asserts seeded exercises with `.is("deleted_at", null)` filter. Doesn't exercise the bug.
- `tests/e2e/remove-exercise.spec.ts` — Despite the name, this is "remove exercise **from a live session**", not "soft-delete from the library". Unrelated.
- `tests/unit/weekly-volume-bucketing.test.ts` — Pure bucketing kernel; no soft-delete scenarios. Wouldn't catch this bug because the strip is genuinely unaffected.
- `tests/rls.test.ts:` — RLS only; no soft-delete-visibility cases.
- **No existing test reproduces** "log sets, soft-delete exercise, open history detail, expect block still visible".

## Relevant conventions (verified by reading code)

- **Soft delete is a project invariant** (`docs/data-model.md:93-100`, `docs/decisions.md:163`). `deleted_at` lives on every table. `sets.exercise_id` uses FK `ON DELETE RESTRICT`, which is the architectural promise that history is durable against library deletes. The current `useExercises` filter is the only thing breaking that promise on the read path.
- **Cache key shape** (mirrors `use-sessions`, `use-routines`, `use-measurements`): `["<resource>"]` for list, `["<resource>", id]` for detail. Adding a "include deleted" variant should follow the same flat shape — most natural is `["exercises", "all"]` or `["exercises", { includeDeleted: true }]`. (`src/hooks/use-exercises.ts:12-15`, `src/hooks/use-sessions.ts:16-18`.)
- **Mutation invalidation pattern**: every mutation in `use-exercises.ts` invalidates `KEYS.all`. Any new variant key must be invalidated by `useCreateExercise`, `useUpdateExercise`, and `useSoftDeleteExercise` (`src/hooks/use-exercises.ts:32-62`).
- **Hook-per-surface is normal here** — `use-sets.ts` already exposes both `useSetsForSession(id)` (`["sets", "session", id]`) and `useLastWorkingSet(exerciseId)` (cross-session). A second exercises hook fits the existing style.
- **Server filtering, not client** — every list helper in `src/api/*` applies `.is("deleted_at", null)` server-side rather than fetching all rows and filtering. The pattern for option (a)/(b) is therefore "second server-side query that does NOT filter `deleted_at`", not "fetch everything once, filter twice in JS".
- **Picker matches by id, not by name** — `excludeIds` passes IDs (e.g. `app/(app)/history/[id].tsx:298`), and search-by-text only matches against `data` from `useExercises()`. So as long as the picker keeps calling `useExercises()` (filtered), soft-deleted exercises stay invisible there even if we add a second hook elsewhere.
- **Display fallback for missing exercise rows already exists implicitly** — the current `for (const s of setsQ.data) { ... if (ex) { out.push(ex); } }` loop silently drops anything `exMap` doesn't have. Once the fix lands, that drop won't happen for soft-deleted exercises, but the same code is the right home for a `(deleted)` UI marker if Designer wants one.

## Constraints

- **Data**: `exercises` has RLS scoped by `auth.uid() = user_id`. A second list query that omits the `deleted_at` filter still only returns the caller's rows. No new RLS migration needed.
- **Data**: `sets.exercise_id` FK is `RESTRICT` (`docs/data-model.md:60,96`). Soft-deleted exercise rows can't disappear from the DB while any historical set references them, so the new "include deleted" query is guaranteed to find what history needs.
- **UI**: NativeWind classes; existing patterns in `exercise-block.tsx` (header line 89-103) and `exercise-list-item.tsx` for how names + muscle subtitles render. If Designer wants a "(deleted)" visual marker, the natural seam is the `Text` at `src/components/exercise-block.tsx:89-91`.
- **Platform**: Pure React Native screens — no iOS/Android/web divergence.
- **Auth**: Both queries run under the user's Supabase session; RLS handles isolation.
- **Performance**: `useExercises()` returns the full library (low cardinality — owner has ~30 seeded + custom). A second query returning library + tombstones is the same order of magnitude. Both can be background-refetched together; no pagination concerns.
- **Cache contract**: A new `["exercises", "all"]` key (or similar) requires every mutation in `use-exercises.ts` to invalidate both keys. Forgetting this is the most likely regression mode — staled deleted exercises would linger in history blocks after un-soft-delete (future) or after rename.

## Existing precedents

- **Two-hook split for different read shapes** — `src/hooks/use-sets.ts` exposes both `useSetsForSession(sessionId)` (chronological per-session) and `useLastWorkingSet(exerciseId)` (cross-session most-recent). Different queries, different keys, different invalidation surfaces. This is the closest precedent for option (a) — discrete hook for the history use case.
- **Server-side filter toggle** — none in this codebase. The pattern is always "different function in `src/api/*.ts` per filter shape", not "function with a boolean param". This makes option (a) a stronger fit than option (b) stylistically.
- **Run `2026-05-20_0042_exercise-block-undefined-muscles`** (`docs/runs/2026-05-20_0042_exercise-block-undefined-muscles/`) — same component (`ExerciseBlock`), same screen (`history/[id].tsx`), but the bug was a `null` muscles default after migration `0004`. Worth reading the diagnosis for context on how `exerciseRow` flows through to the block, but the fix lives at a different layer than this one.
- **Run `2026-05-20_1937_edit-workout-times`** (`docs/runs/2026-05-20_1937_edit-workout-times/discovery.md`) — most recent feature on the same history surface; documents the existing cache invalidation contract (`useFinishSession` invalidates `["sessions"]`, `["stats"]`, `["progress"]`) we should mirror when adding a new variant of `useExercises`. The pattern there was to follow the existing trio of invalidations.

## Unknowns (require Designer judgment or human decision)

1. **API shape — pick (a), (b), or (c).** All three correctly fix the visible inconsistency:
   - **(a) New hook + new API function** — `useAllExercises()` → `listAllExercises()` that omits `.is("deleted_at", null)`. Picker/library keep `useExercises()`. Strongest fit with existing convention ("one function per filter shape"). Cost: a second query is in-flight on history detail in parallel with the picker's call on the same screen. Cache duplication is a few KB.
   - **(b) Parameter on the existing hook** — `useExercises({ includeDeleted: true })`. More compact API but breaks the existing key shape (`KEYS.all = ["exercises"]`) — needs `["exercises", { includeDeleted }]`, which then requires every mutation to invalidate the new shape too. Default-falsy is easy to get wrong; mis-defaulting silently re-introduces the bug elsewhere.
   - **(c) Client-side split** — fetch all once, filter at consumer. Smaller wire, but every picker/library consumer now has to remember to filter. High regression risk; rejected by codebase convention.
   - **Recommendation for Designer**: (a). Reason: matches `use-sets` two-hook precedent; impossible to accidentally pass the "deleted" data into the picker; cache invalidation is explicit per key.
2. **Visual treatment for the deleted exercise inside history** — show name unchanged, or grey it out / append "(deleted)" / show a small badge? Owner's prompt says "fully visible"; doesn't specify a marker. Likely yes-to-marker for self-explanatory history (else a user editing a deleted exercise's sets won't understand why the picker can't re-add it), but Designer call.
3. **Edit affordances inside history for a soft-deleted exercise** — `ExerciseBlock` currently lets you add/edit/delete sets. Should we disable "add new set" for a deleted exercise (since the exercise isn't in the picker anyway, the user can't get there fresh — but they CAN inside an old session)? Or keep all set CRUD enabled (status quo, except the block re-appears)? Designer call.
4. **`/exercises/[id]` (edit) reachability** — if a user taps a deleted exercise's name from history, today the edit screen 404s because `getExercise` filters `deleted_at`. Should we:
   - Block the navigation entirely from history?
   - Let `useExercise(id)` use the new "include deleted" path so the edit screen loads, then show it as read-only or with a "restore" affordance?
   - Leave as-is (history just doesn't link the name; only `progress.tsx` does via the Pencil button)?
   Owner's prompt only requires history visibility, so the safest scope is "don't link the name". Designer to confirm.
5. **`/exercises/[id]/progress` for a soft-deleted id** — chart loads (`progressQ` queries sets directly), but header title falls back to "Progress" because `useExercise(id)` 404s. Likely should resolve to the name even when deleted, since the screen is reachable from history. Same fix surface as (4).
6. **Live workout screen** — `app/(app)/workout/[sessionId].tsx:39` also uses `useExercises()`. If user soft-deletes during a live session, same disappear-bug. Owner's prompt explicitly scopes to history surfaces; should we extend to live workout? Likely yes (any session you're editing should keep its exercises), but flagging because it widens the change. Risk: low — same hook swap.
7. **Cache invalidation contract for the new key** — Designer must specify, but the minimum is: `useCreateExercise`, `useUpdateExercise`, `useSoftDeleteExercise` all invalidate **both** `["exercises"]` and the new key. (`src/hooks/use-exercises.ts:32-62`.) The risk if missed: history shows a stale name after rename, or a stale entry after un-delete.
8. **Adjacent leak in routines** — `src/api/routine-exercises.ts:19` joins `*, exercise:exercises(*)` without filtering deleted exercises on the embedded select. Routine builder currently shows soft-deleted exercises by name (likely OK — the routine entry is the user's curated template), but the picker on the same screen excludes them, so re-adding after delete shows weird state. Out of scope here; flag for a separate run.
9. **Test approach** — owner's playbook prefers e2e for user-visible flows + a unit test for the kernel. Suggested coverage:
   - **E2E**: log sets for Exercise X in a finished session → from Exercises tab, soft-delete X → open the session in History → assert X's block renders and `totals.totalSets` equals the visible sum.
   - **Unit**: not strictly needed if the fix is "swap hook"; could add a snapshot test for the new `listAllExercises()` API or extract the `orderedExercises` reducer.
   Designer to confirm.

## Out-of-scope flags

- Exposing soft-deleted exercises in the exercise picker (anti-feature explicitly called out in the prompt).
- Showing soft-deleted exercises in the Exercises library list (anti-feature, same).
- Restoring (un-deleting) exercises — separate feature; the data model supports it (`UPDATE exercises SET deleted_at = NULL`) but no UI exists today.
- Fixing the **routine builder** display of soft-deleted exercises via the `routine_exercises` embedded join (separate surface, separate design question — flag it but don't fix here).
- Extending the include-deleted hook to the live workout screen unless Designer chooses to. Owner's prompt says "past workout history"; live workout is a judgment call.
- Showing a tombstone in `WeeklyVolumeStrip` / week drill-down — those don't render exercise names at all, so the bug doesn't manifest there and no UI change is needed.
- Migration changes — none required. The schema already supports everything.
