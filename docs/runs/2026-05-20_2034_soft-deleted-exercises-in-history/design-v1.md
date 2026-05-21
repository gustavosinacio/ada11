# Design v1 — 2026-05-20_2034_soft-deleted-exercises-in-history

## Goal (1 sentence)

History and per-exercise progress surfaces keep rendering exercises whose row has been soft-deleted (so block lists and header totals stay consistent), while the exercise picker and the Exercises library list continue to hide them.

## Approach

Add a second TanStack hook — `useAllExercises()` backed by a new `listAllExercises()` API helper — that returns the user's full exercise library **including** soft-deleted rows. Keep `useExercises()` / `listExercises()` exactly as they are; pickers and the library list continue to call them. Swap the three "historical view" consumers (`history/[id].tsx`, `workout/[sessionId].tsx`, `exercises/[id]/progress.tsx`) to the new hook. Wire every exercise mutation (`useCreateExercise`, `useUpdateExercise`, `useSoftDeleteExercise`) to invalidate both `["exercises"]` and `["exercises", "all"]` so renames and (future) restores propagate to both surfaces. Add a subtle `(deleted)` suffix to the `ExerciseBlock` header when `exercise.deleted_at != null`, so users editing a finished session understand why the same exercise no longer appears in the picker.

This matches the existing two-hook precedent in `src/hooks/use-sets.ts` (per-session reader + cross-session reader, different keys), keeps the picker physically incapable of leaking soft-deleted rows (no `includeDeleted` flag to mis-default), and requires zero schema, RLS, or migration work — `exercises` RLS is already scoped by `auth.uid() = user_id`, and `sets.exercise_id` is FK `RESTRICT` (`docs/data-model.md:60,96`), so soft-deleted exercise rows are guaranteed to still exist whenever a historical set references them.

## Decisions on unknowns

| # | Unknown (from Discovery)                                           | Decision                                                                                                                                                            |
|---|---------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 1 | API shape — (a) new hook, (b) param on existing, (c) client filter | **(a) `useAllExercises()` + `listAllExercises()`**. Matches `use-sets.ts` two-hook precedent; picker can't accidentally receive deleted rows; invalidation explicit. |
| 2 | Visual treatment in history                                         | **Subtle `(deleted)` suffix** in the `ExerciseBlock` header title, dim-grey color. No icon, no banner.                                                              |
| 3 | Edit affordances inside history for a deleted exercise              | **Keep all set CRUD enabled** (status quo). User can still edit/log against an existing exercise inside an old session; only the picker hides it.                   |
| 4 | `/exercises/[id]` (edit) reachability for soft-deleted id           | **Leave on `useExercise()`** — keeps the current 404 behavior. The screen has no link from history; only reachable via the Pencil from `progress.tsx`. Out of scope here.        |
| 5 | `/exercises/[id]/progress` for soft-deleted id                      | **Swap to `useAllExercise(id)`** (a sibling detail hook on the new key) so the chart header title resolves to the exercise name instead of falling back to "Progress". |
| 6 | Live workout screen                                                 | **Include in this run** — swap `useExercises()` for `useAllExercises()` in `app/(app)/workout/[sessionId].tsx`. Soft-delete during a live session is rare but the disappearing-block bug is the same; cheap fix. |
| 7 | Cache invalidation contract                                         | All three mutations invalidate **both** `["exercises"]` and `["exercises", "all"]`. Spec'd below.                                                                  |
| 8 | Adjacent routine-builder leak (`routine-exercises.ts:19`)           | **Out of scope.** Separate surface, separate decision.                                                                                                              |
| 9 | Test approach                                                        | **E2E** (Playwright) for the headline flow + **unit** for `listAllExercises()` behavior contract. Spec'd in Contratos.                                              |

## Mudanças por arquivo

| File | Type | Change |
|---|---|---|
| `src/api/exercises.ts` | edited | Add `listAllExercises(): Promise<ExerciseRow[]>` (no `.is("deleted_at", null)` filter) and `getAnyExercise(id): Promise<ExerciseRow>` (same, but for the detail screen used by progress). Existing `listExercises` / `getExercise` untouched. |
| `src/hooks/use-exercises.ts` | edited | Add `KEYS.allIncludingDeleted = ["exercises", "all"] as const` and `KEYS.detailIncludingDeleted = (id) => ["exercises", "all", id]`. Add `useAllExercises()` and `useAllExercise(id)`. Update `useCreateExercise.onSuccess`, `useUpdateExercise.onSuccess`, and `useSoftDeleteExercise.onSuccess` to invalidate **both** root keys. |
| `app/(app)/history/[id].tsx` | edited | Line 19/41: import + call `useAllExercises()` instead of `useExercises()`. No other logic change — the `exMap.get(s.exercise_id)` lookup at line 79 now resolves for soft-deleted exercise IDs, so blocks render and totals match. |
| `app/(app)/workout/[sessionId].tsx` | edited | Line 19/39: import + call `useAllExercises()` instead of `useExercises()`. Same one-line swap; the reducer at lines 84-148 already does the right thing once `exMap` includes tombstones. |
| `app/(app)/exercises/[id]/progress.tsx` | edited | Line 15/34: import + call `useAllExercise(id)` instead of `useExercise(id)`. Header title at line 43 then resolves for soft-deleted ids. |
| `src/components/exercise-block.tsx` | edited | Header `Text` at lines 89-91: append `" (deleted)"` and dim color when `exercise.deleted_at != null`. Single conditional, no new props. |
| `tests/e2e/soft-deleted-exercises-in-history.spec.ts` | new | E2E: log sets for Exercise X in a finished session → soft-delete X from Exercises library → open the session in History → assert X's block renders, header reads `(deleted)`, `totals.totalSets` equals visible sum. Also covers `/exercises/[id]/progress` for the deleted id (title renders the name, not "Progress"). |
| `tests/unit/list-all-exercises.test.ts` | new | Unit: stub Supabase client, assert `listAllExercises()` does NOT add `.is("deleted_at", null)` and orders by `name` ascending. Mirror of `tests/unit/list-exercises.test.ts` style if one exists; otherwise minimal mock against `supabase.from(...).select(...).order(...)`. |

**One responsibility per file.** Each entry above does exactly one thing: API gains a sibling helper; hook file gains a sibling hook and updates the three invalidations (single related-edit cluster); each screen swaps one hook call; `exercise-block.tsx` gains one display branch; two new tests.

## Contratos de I/O

### New API helpers (`src/api/exercises.ts`)

```ts
export async function listAllExercises(): Promise<ExerciseRow[]> {
  const { data, error } = await supabase
    .from("exercises")
    .select("*")
    // intentionally NO .is("deleted_at", null) — includes soft-deleted rows
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ExerciseRow[];
}

export async function getAnyExercise(id: string): Promise<ExerciseRow> {
  const { data, error } = await supabase
    .from("exercises")
    .select("*")
    .eq("id", id)
    // intentionally NO .is("deleted_at", null)
    .single();
  if (error) throw error;
  return data as ExerciseRow;
}
```

RLS is still enforced server-side via the existing `auth.uid() = user_id` policy on `exercises`; the new helpers cannot leak another user's rows. They also cannot leak deleted rows to the picker because the picker never calls them.

### New hooks (`src/hooks/use-exercises.ts`)

```ts
const KEYS = {
  all: ["exercises"] as const,
  detail: (id: string) => ["exercises", id] as const,
  allIncludingDeleted: ["exercises", "all"] as const,
  detailIncludingDeleted: (id: string) => ["exercises", "all", id] as const,
};

export function useAllExercises() {
  return useQuery({
    queryKey: KEYS.allIncludingDeleted,
    queryFn: listAllExercises,
  });
}

export function useAllExercise(id: string | undefined) {
  return useQuery({
    queryKey: id ? KEYS.detailIncludingDeleted(id) : KEYS.allIncludingDeleted,
    queryFn: () => getAnyExercise(id as string),
    enabled: Boolean(id),
  });
}
```

### Invalidation contract (every exercise mutation)

`useCreateExercise.onSuccess` (currently line 36-38), `useUpdateExercise.onSuccess` (currently line 47-50), and `useSoftDeleteExercise.onSuccess` (currently line 58-60) must invalidate **both** root keys. The hand-merged shape:

```ts
onSuccess: (row /* or void */) => {
  qc.invalidateQueries({ queryKey: KEYS.all });
  qc.invalidateQueries({ queryKey: KEYS.allIncludingDeleted });
  // useUpdateExercise also keeps its setQueryData for the filtered detail:
  // qc.setQueryData(KEYS.detail(row.id), row);
  // and additionally for the unfiltered detail:
  // qc.setQueryData(KEYS.detailIncludingDeleted(row.id), row);
},
```

Implementer note: `useUpdateExercise` already does `qc.setQueryData(KEYS.detail(row.id), row)` on line 49; mirror that with `qc.setQueryData(KEYS.detailIncludingDeleted(row.id), row)` so the progress screen header updates instantly after a rename.

### UI prop changes

**None.** `ExerciseBlock` already receives `exercise: ExerciseRow`; `ExerciseRow` already includes `deleted_at: string | null` from `src/db/types.ts`. No new prop, no consumer signature change. The `(deleted)` rendering reads straight off `exercise.deleted_at`.

### DB columns / queries

No schema change. No RLS change. The new queries hit the existing `exercises` table:

- Columns read: `*` (same as today).
- Filter difference vs `listExercises`: omits `.is("deleted_at", null)`.
- Sort: `name ASC` (same as today).
- RLS: existing `exercises_select_own` policy filters by `auth.uid() = user_id` — unaffected.

## UI spec — the `(deleted)` suffix

Edit at `src/components/exercise-block.tsx:89-91`. Today:

```tsx
<Text className="text-lg font-semibold text-black dark:text-white">
  {exercise.name}
</Text>
```

After:

```tsx
<Text className="text-lg font-semibold text-black dark:text-white">
  {exercise.name}
  {exercise.deleted_at != null ? (
    <Text className="text-base font-normal text-gray-500"> (deleted)</Text>
  ) : null}
</Text>
```

Visual sample (history detail block header, dark mode):

```
Bench Press (deleted)
chest, triceps · barbell
```

`(deleted)` is `text-base font-normal text-gray-500` — one step smaller than the name, regular weight, gray-500 in both light and dark mode (matches the existing muscle subtitle color one line down). No icon, no banner, no row-level dimming. Cheapest possible audit-trail marker that's still discoverable.

The same `ExerciseBlock` renders on the live workout screen, the history detail, and the routine builder (if added) — soft-deleted exercises only realistically appear in the first two after this fix, so the suffix doubles as the explanation for why the picker can no longer surface that exercise.

## Riscos

- **Data integrity**: None. No schema migration, no RLS change. The new queries return strictly the same caller's rows as `listExercises` (`auth.uid() = user_id` policy unchanged), only the `deleted_at` filter is removed. `sets.exercise_id` FK `RESTRICT` guarantees the deleted exercise row still exists wherever history references it.

- **UX regressions**:
  - **Picker leak (highest-priority regression risk)** — if any consumer accidentally calls `useAllExercises()` while populating the picker, soft-deleted exercises become re-addable. Mitigation: `ExercisePicker` (`src/components/exercise-picker.tsx:14,26`) keeps `useExercises()`; no edit to that file in this run; Reviewer must confirm.
  - **Stale rename in history** — if a mutation forgets to invalidate `["exercises", "all"]`, history shows the old name after rename. Mitigation: explicit invalidation contract in this design; Reviewer checks all three mutations.
  - **Confusing `(deleted)` suffix during edit** — user edits a set on a deleted exercise and wonders why. Acceptable: the suffix is the explanation. Set CRUD intentionally stays enabled.
  - **Edit-screen 404 from progress chart Pencil** — `progress.tsx` still navigates to `/exercises/[id]` (`progress.tsx:47`), which 404s for soft-deleted ids. Same as today. Designer chose not to fix in this scope (decision 4). Worst case: user taps Pencil on a deleted exercise's progress, sees the error state. Not a regression vs current behavior.

- **Platform-specific**: None. Pure React Native + TanStack Query. No iOS/Android/web divergence in the new code path.

- **Performance**:
  - One additional `select * from exercises` query per history-detail open / live workout open / progress-screen open, in parallel with the existing `useExercises()` call (which is still triggered by `ExercisePicker` on the history and live-workout screens). Library cardinality is low (~30 seeded + custom), so wire and cache cost is negligible.
  - Cache: two near-duplicate datasets in TanStack memory, ~few KB each. Acceptable.
  - Two `invalidateQueries` calls per mutation instead of one. Both refetch in parallel; ~one extra round-trip, only on mutation. Negligible.

## Alternativas descartadas

1. **(b) Parameterize `useExercises({ includeDeleted: true })`** — single hook, boolean opt-in. Descartada porque: (i) breaks the existing flat key shape (`["exercises"]` → `["exercises", { includeDeleted }]`), forcing every existing mutation to re-key its invalidations; (ii) the default-falsy boolean is the exact regression mode that caused this bug originally (shared hook, default filter wins) — keeping that pattern just relocates the trap; (iii) no other helper in `src/api/*` uses a filter-boolean param, all use sibling functions per filter shape.

2. **(c) Fetch all once, filter at consumer** — single query, JS-side filter at the picker. Descartada porque: every picker/library consumer must remember to filter; one missed `.filter()` and soft-deleted exercises reappear in the picker. High regression risk, anti-codebase-convention (the project's pattern is server-side filters, not client-side).

3. **Server-side cleanup via a DB view (`exercises_with_deleted` vs `exercises_active`)** — split visibility at the table level. Descartada porque: a DB-layer abstraction for a one-screen UI bug is over-engineering; the cost is a migration, a view, two new RLS policies, and indefinite Supabase schema-cache invalidation pain. The hook split achieves the same isolation with zero migration cost.

4. **Surface "Show deleted" as a user-facing toggle in the Exercises library** — owner-controlled visibility. Descartada porque: not requested by the prompt; the prompt explicitly says soft-deleted exercises stay out of the Exercises library. Could revisit if owner wants a "Restore" flow later.

## Out of scope

- Exposing soft-deleted exercises in the exercise picker or the Exercises library list (anti-feature, explicitly excluded by the prompt).
- Restoring (un-deleting) exercises — separate feature; data model supports it but no UI.
- Fixing `src/api/routine-exercises.ts:19` embedded `exercise:exercises(*)` join (routine builder leak — Discovery item 8). Separate surface, separate run.
- Routing `/exercises/[id]` (edit) for soft-deleted ids — keeps current 404 behavior (Discovery item 4).
- Adding "Show deleted" toggle to the Exercises library — speculative.
- Schema / migration / RLS changes — none needed.
- `WeeklyVolumeStrip` and `app/(app)/history/week/[isoWeek].tsx` — Discovery verified they don't read exercise names, so the bug doesn't manifest there.

## Open questions for Validator

1. Should the `(deleted)` suffix also dim the muscle subtitle below the name, or only the suffix itself? Current spec: only the suffix. Easy to change in one className edit if Validator prefers full-row dimming.
2. The unit test (`tests/unit/list-all-exercises.test.ts`) requires a Supabase mock pattern — does one already exist in `tests/unit/` for sibling API helpers? If not, Validator may downgrade to "E2E only" to avoid adding scaffolding for one test. Implementer can flip if needed; the design accepts either.
3. Should `useUpdateExercise` *also* `setQueryData` the deleted-detail key when it knows the row is currently soft-deleted? Spec'd yes (mirror of existing line 49 behavior). If Validator considers it gold-plating, it can drop to `invalidateQueries` only.
