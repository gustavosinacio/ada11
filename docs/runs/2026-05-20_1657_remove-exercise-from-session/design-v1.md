# Design v1 — 2026-05-20_1657_remove-exercise-from-session

## Goal (1 sentence)
Add a per-exercise remove affordance to the live session screen that bulk-soft-deletes that exercise's logged sets and suppresses the exercise from the session's exercise list for the rest of the session.

## Approach
"Removing an exercise from a session" has no dedicated table — the relationship is implicit via `sets.session_id + sets.exercise_id` and `routine_exercises` (template). We therefore split the action into two effects: (1) **DB**: bulk-soft-delete every non-deleted `sets` row matching `(session_id, exercise_id)` via a single PostgREST update with `.eq + .eq + .is`; (2) **Client**: a new component-local `removedExerciseIds: Set<string>` state inside `app/(app)/workout/[sessionId].tsx`, layered into the `orderedExercises` computation, to hide routine-sourced exercises that had zero sets (the DB has nothing to mark for them). The affordance is a red `Trash2` button added to `<ExerciseBlock>`'s header **rightmost** in the existing reorder cluster (matches `routine-exercise-row.tsx`), gated by a new optional `onRemove?` prop — the history detail screen does NOT pass it, scoping the affordance to the live session only. Confirmation reuses `confirmDelete()`; copy varies by set count so users do not get a destructive prompt when nothing is being lost. Cache invalidation mirrors `useDeleteSet` (`["sets", sessionId]` + `["stats"]`).

The client-only suppression is a known trade-off (decision (a) from Conductor's prompt): a routine-sourced exercise with zero sets reappears after a screen reload. We accept this for v1 to avoid a schema migration; it mirrors the lifecycle of the existing `adHocExerciseIds` / `exerciseOrderOverride` session-local state.

## Decisions on unknowns (from discovery.md)

| # | Unknown | Decision | Rationale |
|---|---|---|---|
| 1 | Affordance location | (a) `Trash2` in `<ExerciseBlock>` header, **rightmost** in the existing chevron cluster | Direct parallel to `routine-exercise-row.tsx:80-107`. No new pattern (kebab/swipe) introduced. |
| 2 | Confirmation copy + gating | Confirm **always shown**, copy varies by set count. Verb: `Remove`. See UI spec below. | Always-confirm matches `confirmDelete` precedent (every other destructive flow confirms). "Remove" scopes the action to the session (not "delete the exercise globally"). |
| 3 | Hard vs soft delete | Soft (`deleted_at = now()`) | Universal convention; non-negotiable per Conductor. |
| 4 | Routine-sourced zero-set exercise | (i) Client-only `removedExerciseIds` Set in `[sessionId].tsx` | No schema change; mirrors `adHocExerciseIds`/`exerciseOrderOverride` lifecycle. Trade-off accepted: reload re-exposes the exercise. |
| 5 | History detail parity | Out of scope. New `onRemove?` prop is **optional**; history screen does not pass it. | Conductor scoped to "current session in progress". |
| 6 | Picker re-exposure after removal | Automatic — `orderedExercises` excludes removed IDs, so `excludeIds={orderedExercises.map(e=>e.id)}` already drops them. | No code change needed beyond the suppression filter. |
| 7 | Rest timer side-effect | None — `useRestTimer` is decoupled from exercises. | Verified in discovery. |
| 8 | Empty-state after removing last exercise | Keep existing copy at `[sessionId].tsx:204-209` ("No exercises in this session yet. Add one to start logging.") | Discovery explicitly recommends this; "Finish workout" stays clickable on the header. |
| 9 | Optimistic UI | Non-optimistic; rely on cache invalidation after mutation success | Matches `useDeleteSet`/`useLogSet` precedent. Single PostgREST call covers N rows — round-trip cost is acceptable. |
| 10 | Cache invalidation | Invalidate `["sets", sessionId]` and `["stats"]`. | Mirrors `useDeleteSet`. `["stats"]` is no-op for in-progress sessions but cheap and consistent. |
| 11 | Concurrent edit cross-device | Out of scope. | No realtime in the codebase. |
| 12 | e2e coverage | Tester adds an assertion to `tests/e2e/crud.spec.ts` (or sibling spec) covering: add-ad-hoc-exercise → log a set → remove exercise → assert block gone + picker re-exposes it. | Out of Designer scope; flagged for Tester. |
| 13 | Undo banner | Out of scope. | No undo precedent in repo. |

## Mudanças por arquivo

| File | Type | Change |
|---|---|---|
| `src/api/sets.ts` | edited | Add `bulkSoftDeleteSetsForExerciseInSession({ sessionId, exerciseId })` that runs one PostgREST `UPDATE … SET deleted_at = now() WHERE session_id = $1 AND exercise_id = $2 AND deleted_at IS NULL`. Returns the count of affected rows. |
| `src/hooks/use-sets.ts` | edited | Add `useRemoveExerciseFromSession(sessionId)` mutation hook wrapping the new API call. Invalidate `["sets", sessionId]` and `["stats"]` on success. |
| `src/components/exercise-block.tsx` | edited | Add optional `onRemove?: () => void` prop. When provided, render a red `Trash2` button rightmost in the existing reorder cluster in the header. No other behavior change. |
| `app/(app)/workout/[sessionId].tsx` | edited | Add component-local `removedExerciseIds: Set<string>` state. Filter it out of `orderedExercises` (one extra check after the union build). Wire each `<ExerciseBlock>`'s `onRemove` to a new `handleRemoveExercise(ex, setCount)` callback that: (1) calls `confirmDelete` with copy varying by `setCount`; (2) if `setCount > 0`, calls the new mutation; (3) on success (or immediately for zero-set), adds the exercise id to `removedExerciseIds`. |
| `app/(app)/history/[id].tsx` | unchanged | Does NOT pass `onRemove` to `<ExerciseBlock>` — affordance stays hidden in history detail. Listed here only to document the deliberate omission. |

No new files. No schema migration. No new TanStack Query key.

## Contratos de I/O

### API — `src/api/sets.ts`

```ts
export type BulkSoftDeleteSetsInput = {
  sessionId: string;
  exerciseId: string;
};

/**
 * Soft-deletes every non-deleted set in this (session, exercise) pair.
 * One PostgREST round-trip. RLS allows because every row's user_id
 * matches the authed user. Returns the number of rows updated.
 */
export async function bulkSoftDeleteSetsForExerciseInSession(
  input: BulkSoftDeleteSetsInput,
): Promise<number> {
  const { data, error } = await supabase
    .from("sets")
    .update({ deleted_at: new Date().toISOString() })
    .eq("session_id", input.sessionId)
    .eq("exercise_id", input.exerciseId)
    .is("deleted_at", null)
    .select("id");
  if (error) throw error;
  return data?.length ?? 0;
}
```

Notes:
- `.select("id")` is required to have PostgREST return affected rows so we can count them. Without `.select`, `data` is `null` and we lose visibility.
- No `user_id` filter — RLS handles authorization at the row level on `UPDATE`.
- `deleted_at IS NULL` filter is important: idempotency. Calling twice does not bump `deleted_at` on already-removed rows.

### Hook — `src/hooks/use-sets.ts`

```ts
export function useRemoveExerciseFromSession(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (exerciseId: string) =>
      bulkSoftDeleteSetsForExerciseInSession({
        sessionId,
        exerciseId,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.forSession(sessionId) });
      qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}
```

- Input type: `string` (exerciseId). Matches the simplicity of `useDeleteSet(id: string)`.
- No optimistic update.
- Returns mutation result `{ mutateAsync, isPending, isError, error, … }` for the caller to await.

### Component prop — `src/components/exercise-block.tsx`

```ts
type Props = {
  exercise: ExerciseRow;
  sets: SetRow[];
  unit: WeightUnit;
  isFirst?: boolean;
  isLast?: boolean;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onAddSet: (input: { set_type: SetType; parent_set_id?: string | null }) => void;
  onUpdateSet: (
    id: string,
    patch: { reps: number | null; weight: string | null; rpe: string | null; notes: string | null },
  ) => void;
  onDeleteSet: (id: string) => void;
  onRemove?: () => void; // NEW — when provided, shows the trash button in the header.
};
```

Render rule: the trash button renders only when `onRemove != null`. Its position is **rightmost** in the header action cluster, after both chevrons. When `showReorder` is false (history detail today) and `onRemove` is also undefined, the action cluster does not render at all (matches current behavior).

### Screen wiring — `app/(app)/workout/[sessionId].tsx`

New state:
```ts
const [removedExerciseIds, setRemovedExerciseIds] = useState<Set<string>>(
  () => new Set(),
);
```

New filter (inserted just before the `exerciseOrderOverride` block in `orderedExercises`):
```ts
// Filter client-side removals (session-local, not persisted).
const filtered = out.filter((e) => !removedExerciseIds.has(e.id));
// then continue with the existing reorder-override pass against `filtered`
```

(Implementer note: rename `out` → `filtered` from this point onward in the existing computation; or wrap the existing return statement. Implementer chooses.)

New handler:
```ts
const removeExerciseFromSession = useRemoveExerciseFromSession(sessionId ?? "");

const handleRemoveExercise = async (ex: ExerciseRow, setCount: number) => {
  const ok = await confirmDelete({
    title: `Remove ${ex.name}?`,
    message:
      setCount > 0
        ? `${setCount} logged set${setCount === 1 ? "" : "s"} for this exercise will be removed from this workout. This can't be undone.`
        : `This exercise will be removed from this workout.`,
    confirmLabel: "Remove",
    cancelLabel: "Cancel",
  });
  if (!ok) return;
  try {
    if (setCount > 0) {
      await removeExerciseFromSession.mutateAsync(ex.id);
    }
    setRemovedExerciseIds((prev) => {
      const next = new Set(prev);
      next.add(ex.id);
      return next;
    });
  } catch (err) {
    console.warn("Remove exercise failed", err);
  }
};
```

Per-block wiring (added to the existing `<ExerciseBlock>` render):
```ts
onRemove={() =>
  handleRemoveExercise(ex, (setsByExercise.get(ex.id) ?? []).length)
}
```

### DB columns / queries

- Reads: none added.
- Writes: one `UPDATE public.sets SET deleted_at = now() WHERE session_id = $1 AND exercise_id = $2 AND deleted_at IS NULL`.
- Columns touched: `sets.deleted_at` only.
- RLS: existing policy `auth.uid() = user_id` on `sets` covers all rows. Bulk update under RLS runs row-by-row in Postgres; no special handling.
- No migration. No new column. No new index needed (existing index on `(session_id, exercise_id)` from the per-exercise listing already serves the predicate; if absent, the `session_id` index alone is sufficient for typical session sizes ≤ ~50 sets).

## UI spec

### Affordance position

Header cluster order, left to right:
```
[ ChevronUp ] [ ChevronDown ] [ Trash2 (red) ]
```
- Trash2 sits rightmost — exact same order as `routine-exercise-row.tsx:80-107`.
- Icon size `18` (matches set-input trash and routine-row trash), color `#ef4444`.
- Wrapping `Pressable`: function form (`({ pressed }) => …` not required here since no pressed-state styling; standard `<Pressable>` is fine — codebase convention is to use the function form **only when pressed feedback is needed**; the existing routine-row trash uses the static form, so we match it).
- ClassName `"rounded p-2"` matching the chevrons' padding so tap target stays ≥ 32×32.
- Accessibility: `accessibilityRole="button"`, `accessibilityLabel={`Remove ${exercise.name} from workout`}`.

Render gate inside `<ExerciseBlock>`:
```tsx
const showActions = !!onMoveUp || !!onMoveDown || !!onRemove;

{showActions && (
  <View className="flex-row items-center">
    {(onMoveUp || onMoveDown) && (
      <>
        <Pressable onPress={onMoveUp} disabled={!onMoveUp || isFirst} … >
          <ChevronUp color="#6b7280" size={20} />
        </Pressable>
        <Pressable onPress={onMoveDown} disabled={!onMoveDown || isLast} … >
          <ChevronDown color="#6b7280" size={20} />
        </Pressable>
      </>
    )}
    {onRemove && (
      <Pressable
        onPress={onRemove}
        accessibilityLabel={`Remove ${exercise.name} from workout`}
        accessibilityRole="button"
        className="rounded p-2"
      >
        <Trash2 color="#ef4444" size={18} />
      </Pressable>
    )}
  </View>
)}
```

(Replace the existing `showReorder` gate. Internal naming: rename `showReorder` → `showActions`.)

### Confirmation copy (pseudo-code)

```ts
const setCount = (setsByExercise.get(ex.id) ?? []).length;
await confirmDelete({
  title: `Remove ${ex.name}?`,
  message:
    setCount > 0
      ? `${setCount} logged set${setCount === 1 ? "" : "s"} for this exercise will be removed from this workout. This can't be undone.`
      : `This exercise will be removed from this workout.`,
  confirmLabel: "Remove",
  cancelLabel: "Cancel",
});
```

Examples rendered:
- 0 sets: "Remove Bench Press?" / "This exercise will be removed from this workout." / [Cancel] [Remove]
- 1 set: "Remove Bench Press?" / "1 logged set for this exercise will be removed from this workout. This can't be undone." / [Cancel] [Remove]
- 3 sets: "Remove Bench Press?" / "3 logged sets for this exercise will be removed from this workout. This can't be undone." / [Cancel] [Remove]

The web branch (`window.confirm`) renders title + "\n\n" + message — already handled by `confirmDelete`. On native, `Alert.alert` shows them as title and message; the `style: "destructive"` on the confirm action paints "Remove" red.

### Visual states / dark mode

- Trash icon color `#ef4444` is identical across light/dark (matches existing precedent in `set-input.tsx`, `routine-exercise-row.tsx`).
- No new tailwind tokens needed.
- The header row's `bg-white dark:bg-black` and `border-gray-200 dark:border-gray-800` stay as-is.

### Empty state after last exercise removed

No new copy. Existing block at `[sessionId].tsx:204-209` renders "No exercises in this session yet. Add one to start logging." This is acceptable — the user can either re-add via the picker or finish the (now empty) workout via the header button.

## Riscos

### Data integrity
- **RLS**: bulk update inherits row-level auth check; no risk of cross-user deletion. Verified in discovery (`docs/data-model.md:108-115`).
- **Dropset FK chain**: `sets.parent_set_id` ON DELETE SET NULL is irrelevant — soft-delete does not touch the FK. Parent + child are soft-deleted in the same statement because both match the filter. Reads (`listSetsForSession`) filter out soft-deleted rows entirely, so the chain remains consistent post-removal.
- **Idempotency**: the `.is("deleted_at", null)` predicate guarantees re-running the mutation does not modify already-soft-deleted rows.
- **Race with `useLogSet`**: if the user taps "Remove" while a `logSet` is in flight for the same exercise, the new set may insert *after* the bulk update completes, leaving an orphan visible set. Probability: low (would need ~ms-precision race). Mitigation: rely on the post-mutation cache invalidation to refetch; the orphan is recoverable via the per-set trash. Not adding a lock for v1.
- **No DB row for zero-set routine exercise suppression**: by design (decision (a)). Reload re-exposes the exercise. Documented trade-off.

### UX regressions
- **`<ExerciseBlock>` is shared with history detail**: history detail does NOT pass `onRemove`, so its rendering is byte-identical to today. Verified by tracing `app/(app)/history/[id].tsx:244-278` (no `onRemove` in its prop spread).
- **Header layout**: adding a third icon to the cluster could crowd narrow phones. The cluster total width with three `p-2` buttons (~144px) still leaves ~50% of a 360dp viewport for the exercise name. Acceptable; matches `routine-exercise-row.tsx` which already runs this cluster on every routine-edit row.
- **Accidental tap**: the trash icon is destructive but always confirmed. No undo, but the confirm provides the safety net.
- **Reorder + remove edge**: if the user removes the last exercise in a reordered list, `exerciseOrderOverride` retains the dead id. The override is applied after the union build and only matches by membership in `byId`, so the dead id is silently dropped. Behavior is correct; no cleanup needed (verified against existing `[sessionId].tsx:107-122`).

### Platform-specific
- **iOS**: `Alert.alert` with `style: "destructive"` paints "Remove" red — desired.
- **Android**: `Alert.alert` renders both actions in default style (no destructive variant); button order is OS-default. Functional.
- **Web**: `window.confirm` shows title + message, OK/Cancel. The confirm label parameter is ignored on web (`confirmDelete` already documents this limitation). Acceptable; no copy regression because the message text is self-explanatory.

### Performance
- Single PostgREST round-trip regardless of set count. Typical exercise: 1-6 sets. Worst observed: ~20. Trivial.
- Cache invalidation triggers one `listSetsForSession` refetch — same as a single-set delete today.
- Adding `removedExerciseIds` to the `orderedExercises` `useMemo` dep array adds one `Set.has` check per exercise per render. O(n) where n ≤ ~30. Negligible.

## Alternativas descartadas

1. **Schema migration: `session_exercise_exclusions` tombstone table** — persistent suppression of zero-set exercises. Discarded because the schema change introduces RLS policy work, a new api/hooks/cache key, and a migration round, all to fix an edge case (routine-sourced + zero sets + reload). Conductor's prompt explicitly recommends decision (a) for v1. Can be revisited if user-reported pain materializes.
2. **Tombstone-set hack (insert + soft-delete a placeholder set as marker)** — abuses `sets` semantics. Discarded per Conductor and the "one obvious way" ethos in `docs/decisions.md`.
3. **Kebab menu in header (`MoreVertical` opening a sheet)** — lowest accidental-tap risk, scales to future actions, but introduces a new UI pattern not present anywhere in the codebase today (grep confirms in discovery). The trash-in-cluster pattern is already proven by `routine-exercise-row.tsx`; consistency wins.
4. **Swipe-to-delete on the block** — new gesture pattern + a new dependency or custom gesture handler. No swipe in the repo today. Discarded as scope creep.
5. **Sequential per-row soft-delete loop (mirroring `reorderRoutineExercises`)** — N round-trips, worse latency, no benefit over the bulk-filter form. Discarded.
6. **Optimistic UI** — would require manual cache patching to remove the sets from `["sets", sessionId]` before the server confirms. Discarded to match `useDeleteSet`/`useLogSet` precedent and keep error recovery simple (failure = surface error, no rollback needed).
7. **Confirm only when sets exist (skip confirm for zero-set removal)** — saves one tap in the most common case but introduces an inconsistency: same destructive verb, different commit semantics. Discarded; always-confirm preserves the mental model.

## Out of scope

- Reordering exercises mid-session (already exists via chevrons).
- Bulk-remove multiple exercises at once.
- Undo / restore (no undo precedent in repo).
- Removing exercises from a **finished** session (history detail). `<ExerciseBlock>` exposes the optional prop but the history screen does not wire it.
- Persistent suppression of routine-sourced zero-set exercises across reloads (decision (a) accepts this trade-off).
- Realtime cross-device session sync.
- Adding a "Cancel this workout" prompt when the user removes the last exercise (separate UX call).
- Removing the exercise from the underlying `routines` template (out of session scope — routine editor handles that).
- e2e test authoring (Tester's responsibility).

## Open questions for Validator

1. **Bulk-update RLS behavior**: confirm Supabase/PostgREST `UPDATE … .eq().eq().is()` runs the RLS check per affected row (it does, per Postgres RLS semantics, but cross-check `docs/data-model.md` and any project-specific notes). If RLS were to short-circuit on the first filter, the `user_id` predicate is missing — but RLS adds the implicit `user_id = auth.uid()` check itself.
2. **`.select("id")` row return contract**: confirm `.select("id")` after an `.update()` in Supabase JS returns the affected rows (used for the count). The codebase already uses `.select().single()` after single-row updates so the pattern is supported; the array form is standard PostgREST.
3. **`removedExerciseIds` placement in the `useMemo`**: the filter must run **after** all three union sources (routine, sets, ad-hoc) are merged but **before** the `exerciseOrderOverride` reorder pass, otherwise a removed id could survive via the override. The contract above documents this — Validator should sanity-check the ordering.
4. **Header cluster crowding**: three icons (chevron-up, chevron-down, trash) in the header. Validator should confirm against `routine-exercise-row.tsx` rendering on a narrow viewport that this layout does not visibly break.
5. **Concurrent `logSet` race**: documented as low-probability under Riscos. Validator should decide if v1 must mitigate (e.g., disable "Remove" while `logSet.isPending`) or defer.
