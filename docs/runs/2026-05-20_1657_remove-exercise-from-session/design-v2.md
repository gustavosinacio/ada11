# Design v2 — 2026-05-20_1657_remove-exercise-from-session

## Goal (1 sentence)
Add a per-exercise remove affordance to the live session screen that bulk-soft-deletes that exercise's logged sets and suppresses the exercise from the session's exercise list for the rest of the session.

## Approach
"Removing an exercise from a session" has no dedicated table — the relationship is implicit via `sets.session_id + sets.exercise_id` and `routine_exercises` (template). We split the action into two effects: (1) **DB**: bulk-soft-delete every non-deleted `sets` row matching `(session_id, exercise_id)` via a single PostgREST update with `.eq + .eq + .is`; (2) **Client**: a new component-local `removedExerciseIds: Set<string>` state inside `app/(app)/workout/[sessionId].tsx`, layered into the `orderedExercises` computation, to hide routine-sourced exercises that had zero sets (the DB has nothing to mark for them). The affordance is a red `Trash2` button added to `<ExerciseBlock>`'s header **rightmost** in the existing reorder cluster (mirrors `routine-exercise-row.tsx`), gated by a new optional `onRemove?` prop — the history detail screen does NOT pass it. Confirmation reuses `confirmDelete()`; copy varies by set count. Cache invalidation mirrors `useDeleteSet` (`["sets", sessionId]` + `["stats"]`).

v2 narrows the data-layer surface (drop `.select("id")`, return `void` — matches `softDeleteSet`), closes the `logSet` race at the UI layer (`removeDisabled` prop + early-return guard), and tightens the `orderedExercises` filter (explicit `filtered` variable used by both override and trailing-append branches; `removedExerciseIds` added to dep array).

The client-only suppression is a known trade-off (decision (a)): a routine-sourced exercise with zero sets reappears after a screen reload. Accepted for v1; mirrors the lifecycle of the existing `adHocExerciseIds` / `exerciseOrderOverride` session-local state.

## Decisions on unknowns (from discovery.md)

| # | Unknown | Decision | Rationale |
|---|---|---|---|
| 1 | Affordance location | (a) `Trash2` in `<ExerciseBlock>` header, **rightmost** in the existing chevron cluster | Direct parallel to `routine-exercise-row.tsx:80-107`. No new pattern (kebab/swipe) introduced. |
| 2 | Confirmation copy + gating | Confirm **always shown**, copy varies by set count. Verb: `Remove`. | Always-confirm matches `confirmDelete` precedent. "Remove" scopes the action to the session. |
| 3 | Hard vs soft delete | Soft (`deleted_at = now()`) | Universal convention. |
| 4 | Routine-sourced zero-set exercise | (i) Client-only `removedExerciseIds` Set in `[sessionId].tsx` | No schema change; mirrors `adHocExerciseIds`/`exerciseOrderOverride` lifecycle. Reload re-exposes — accepted trade-off. |
| 5 | History detail parity | Out of scope. New `onRemove?` prop is **optional**; history screen does not pass it. | Conductor scoped to "current session in progress". |
| 6 | Picker re-exposure after removal | Automatic — `orderedExercises` excludes removed IDs, so `excludeIds={orderedExercises.map(e=>e.id)}` already drops them. | No extra code beyond the suppression filter. |
| 7 | Rest timer side-effect | None — `useRestTimer` is decoupled from exercises. | Verified in discovery. |
| 8 | Empty-state after removing last exercise | Keep existing copy at `[sessionId].tsx:204-209`. | Discovery recommends this; "Finish workout" stays clickable. |
| 9 | Optimistic UI | Non-optimistic; rely on cache invalidation after mutation success | Matches `useDeleteSet`/`useLogSet` precedent. |
| 10 | Cache invalidation | Invalidate `["sets", sessionId]` and `["stats"]`. | Mirrors `useDeleteSet`. |
| 11 | Concurrent edit cross-device | Out of scope. | No realtime in the codebase. |
| 12 | e2e coverage | Tester adds an assertion to `tests/e2e/crud.spec.ts` (or sibling spec). | Out of Designer scope. |
| 13 | Undo banner | Out of scope. | No undo precedent. |

## Mudanças por arquivo

| File | Type | Change |
|---|---|---|
| `src/api/sets.ts` | edited | Add `bulkSoftDeleteSetsForExerciseInSession({ sessionId, exerciseId })` that runs one PostgREST `UPDATE … SET deleted_at = now() WHERE session_id = $1 AND exercise_id = $2 AND deleted_at IS NULL`. Returns `void`. No `.select()`. Mirrors `softDeleteSet` precedent (lines 119-125). |
| `src/hooks/use-sets.ts` | edited | Add `useRemoveExerciseFromSession(sessionId)` mutation hook wrapping the new API call. Invalidates `["sets", sessionId]` and `["stats"]` on success. Returns `void`. |
| `src/components/exercise-block.tsx` | edited | Two prop additions: (1) `onRemove?: () => void` — when provided, render a red `Trash2` button rightmost in the existing reorder cluster; (2) `removeDisabled?: boolean` — when `true`, the trash `Pressable` is `disabled` (visually still rendered, tap is no-op). No other behavior change. Rename internal `showReorder` → `showActions`. |
| `app/(app)/workout/[sessionId].tsx` | edited | (a) Add `useState<Set<string>>` `removedExerciseIds`; (b) replace `out` filter in `orderedExercises` `useMemo` with explicit `filtered = out.filter(...)` consumed by both override and trailing-append branches; add `removedExerciseIds` to the dep array; (c) wire each `<ExerciseBlock>`'s `onRemove` + `removeDisabled` to a new `handleRemoveExercise(ex, setCount)` callback. Handler has `if (!sessionId \|\| logSet.isPending) return;` guard at the top. |
| `app/(app)/history/[id].tsx` | unchanged | Does NOT pass `onRemove` or `removeDisabled` to `<ExerciseBlock>` — affordance stays hidden in history detail. Listed only to document the deliberate omission. |

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
 * matches the authed user.
 */
export async function bulkSoftDeleteSetsForExerciseInSession(
  input: BulkSoftDeleteSetsInput,
): Promise<void> {
  const { error } = await supabase
    .from("sets")
    .update({ deleted_at: new Date().toISOString() })
    .eq("session_id", input.sessionId)
    .eq("exercise_id", input.exerciseId)
    .is("deleted_at", null);
  if (error) throw error;
}
```

Notes (v2):
- `.select("id")` removed (Validator M1, option (a)). Return type is `void`. Caller doesn't read the affected count — `setCount` is read from cached `setsByExercise` at handler time. Matches `softDeleteSet` precedent verbatim.
- No `user_id` filter — RLS handles authorization at the row level on `UPDATE`.
- `deleted_at IS NULL` filter guarantees idempotency: calling twice does not bump `deleted_at` on already-removed rows.

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

- Input type: `string` (exerciseId). Matches `useDeleteSet(id: string)` ergonomics.
- No optimistic update.
- Returns mutation result `{ mutateAsync, isPending, isError, error, … }` for the caller to await.

### Component props — `src/components/exercise-block.tsx`

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
  onRemove?: () => void;        // NEW — when provided, shows the trash button in the header.
  removeDisabled?: boolean;     // NEW — when true, the trash Pressable is disabled (no-op on tap).
};
```

Render rule: the trash button renders only when `onRemove != null`. Its position is **rightmost** in the header action cluster, after both chevrons. When `showActions` is otherwise false (history detail today) the action cluster does not render at all.

### Screen wiring — `app/(app)/workout/[sessionId].tsx`

New state:
```ts
const [removedExerciseIds, setRemovedExerciseIds] = useState<Set<string>>(
  () => new Set(),
);
```

`orderedExercises` `useMemo` rewrite. The new filter runs **after** the union build (routine + sets + ad-hoc) and **before** the override pass, and downstream code uses the renamed `filtered` (not `out`):

```ts
const orderedExercises: ExerciseRow[] = useMemo(() => {
  const exMap = new Map((exercisesQ.data ?? []).map((e) => [e.id, e]));
  const out: ExerciseRow[] = [];
  const seen = new Set<string>();

  // 1) Routine exercises in position order
  for (const re of routineExercisesQ.data ?? []) {
    const ex = exMap.get(re.exercise_id);
    if (ex && !seen.has(ex.id)) { out.push(ex); seen.add(ex.id); }
  }
  // 2) Sets-with-rows in first-occurrence order
  for (const s of setsQ.data ?? []) {
    if (!seen.has(s.exercise_id)) {
      const ex = exMap.get(s.exercise_id);
      if (ex) { out.push(ex); seen.add(ex.id); }
    }
  }
  // 3) Ad-hoc additions
  for (const id of adHocExerciseIds) {
    if (!seen.has(id)) {
      const ex = exMap.get(id);
      if (ex) { out.push(ex); seen.add(ex.id); }
    }
  }

  // NEW (v2): client-side removals, session-local, not persisted.
  const filtered = out.filter((e) => !removedExerciseIds.has(e.id));

  if (exerciseOrderOverride) {
    const overrideSet = new Set(exerciseOrderOverride);
    const byId = new Map(filtered.map((e) => [e.id, e]));   // <— filtered, not out
    const reordered: ExerciseRow[] = [];
    for (const id of exerciseOrderOverride) {
      const ex = byId.get(id);
      if (ex) reordered.push(ex);
    }
    for (const ex of filtered) {                            // <— filtered, not out
      if (!overrideSet.has(ex.id)) reordered.push(ex);
    }
    return reordered;
  }

  return filtered;                                          // <— filtered, not out
}, [
  exercisesQ.data,
  routineExercisesQ.data,
  setsQ.data,
  adHocExerciseIds,
  exerciseOrderOverride,
  removedExerciseIds,                                       // <— NEW (v2)
]);
```

Notes (v2):
- Validator m1 — chose option (b): introduce `filtered` once, switch all three downstream references (`byId` build, trailing-append loop, trailing return). `out` survives only as the union-build accumulator.
- Validator m7 — `removedExerciseIds` is now explicitly the 6th and final entry in the dep array.

New mutation + handler:
```ts
const removeExerciseFromSession = useRemoveExerciseFromSession(sessionId ?? "");

const handleRemoveExercise = async (ex: ExerciseRow, setCount: number) => {
  // v2 guards (Validator m6 + M2):
  if (!sessionId) return;
  if (logSet.isPending) return;

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
```tsx
onRemove={() =>
  handleRemoveExercise(ex, (setsByExercise.get(ex.id) ?? []).length)
}
removeDisabled={logSet.isPending}
```

Notes (v2):
- Validator M2 — two-layer race mitigation:
  - **UI**: `removeDisabled={logSet.isPending}` disables the trash `Pressable` whenever any `logSet` is in flight (the mutation is screen-scoped, one instance shared across all blocks). User can't initiate the destructive flow while a write is pending.
  - **Handler**: `if (logSet.isPending) return;` short-circuits if the in-flight state began between render and tap (cross-platform/race-free belt-and-suspenders).
- Validator m6 — `if (!sessionId) return;` mirrors `onFinish` precedent at line 155 of the current file.

### DB columns / queries

- Reads: none added.
- Writes: one `UPDATE public.sets SET deleted_at = now() WHERE session_id = $1 AND exercise_id = $2 AND deleted_at IS NULL`.
- Columns touched: `sets.deleted_at` only.
- RLS: existing policy `auth.uid() = user_id` on `sets` covers all rows.
- No migration. No new column. No new index needed.

## UI spec

### Affordance position

Header cluster order, left to right:
```
[ ChevronUp ] [ ChevronDown ] [ Trash2 (red) ]
```
- Trash2 sits rightmost — same order as `routine-exercise-row.tsx:80-107`.
- Icon size `18` (matches set-input trash and routine-row trash; Validator m4 — chevrons stay at `20`, mismatch accepted as direct precedent match), color `#ef4444`.
- ClassName `"rounded p-2"` matching chevron padding so tap target stays ≥ 32×32.
- Accessibility: `accessibilityRole="button"`, `accessibilityLabel={`Remove ${exercise.name} from workout`}`.
- When `removeDisabled` is `true`, set `disabled` on the `Pressable` and apply `opacity-40` (matches chevron disabled state on lines 109/119 of current `<ExerciseBlock>`).

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
        disabled={!!removeDisabled}
        accessibilityLabel={`Remove ${exercise.name} from workout`}
        accessibilityRole="button"
        className={`rounded p-2 ${removeDisabled ? "opacity-40" : ""}`}
      >
        <Trash2 color="#ef4444" size={18} />
      </Pressable>
    )}
  </View>
)}
```

(Replace the existing `showReorder` gate. Internal rename: `showReorder` → `showActions`.)

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

Rendered examples:
- 0 sets: "Remove Bench Press?" / "This exercise will be removed from this workout."
- 1 set: "Remove Bench Press?" / "1 logged set for this exercise will be removed from this workout. This can't be undone."
- 3 sets: "Remove Bench Press?" / "3 logged sets for this exercise will be removed from this workout. This can't be undone."

`setCount` is read from cached `setsByExercise`. Validator m2 acknowledged: copy can be off-by-one for ≤ ~ms if a `logSet` invalidation hasn't flushed. Accepted as cosmetic — destructive action still soft-deletes whatever `(session_id, exercise_id)` rows are non-deleted at the moment the bulk update runs, and the M2 in-flight guard ensures no `logSet` is pending when the prompt opens.

### Visual states / dark mode

- Trash icon color `#ef4444` is identical across light/dark.
- No new tailwind tokens.
- Header row's `bg-white dark:bg-black` and `border-gray-200 dark:border-gray-800` stay as-is.
- Disabled trash uses `opacity-40` (matches existing chevron disabled state).

### Empty state after last exercise removed

Existing block at `[sessionId].tsx:204-209` ("No exercises in this session yet. Add one to start logging.") is retained.

### Header-cluster footprint (Validator m5)

Three buttons × `p-2` (8px) padding × 24px (chevrons) or 18px (trash) icon ≈ 3 × ~32px ≈ **~96px** total. Validator's measured ~98px stands; v1's "~144px" estimate was wrong. Still fits at 320pt; conclusion holds.

## Riscos

### Data integrity
- **RLS**: bulk update inherits row-level auth check; no cross-user risk. Verified (`docs/data-model.md:108-115`).
- **Dropset FK chain**: `sets.parent_set_id` ON DELETE SET NULL is irrelevant — soft-delete does not touch the FK. Both parent and child match the bulk filter and disappear from `listSetsForSession` together.
- **Idempotency**: `.is("deleted_at", null)` predicate guarantees re-running does not bump `deleted_at`.
- **Race with `useLogSet`** (mitigated in v2): UI disables the Remove pressable while `logSet.isPending`; handler guards with an early return. Combined, the race is closed for taps initiated under React render guarantees. A theoretical narrow window remains only if the in-flight transition happens *between* the handler's `if (logSet.isPending) return` check and `confirmDelete()` opening — but `confirmDelete` is synchronous-render-ish and the user can't tap "Remove" in that infinitesimal slice. Treated as eliminated.
- **No DB row for zero-set routine exercise suppression**: by design (decision (a)). Reload re-exposes the exercise. Documented trade-off.

### UX regressions
- **`<ExerciseBlock>` shared with history detail**: history detail does NOT pass `onRemove` or `removeDisabled`; its rendering is byte-identical to today. Verified by tracing `app/(app)/history/[id].tsx:244-278`.
- **Header layout**: three icons × ~32px ≈ ~96px cluster still leaves ample room for the exercise name at 320pt and matches `routine-exercise-row.tsx`.
- **Accidental tap**: trash is destructive but always confirmed. No undo, but the confirm provides the safety net.
- **Reorder + remove edge**: removing the last exercise in a reordered list leaves `exerciseOrderOverride` carrying the dead id. The override loop only resurrects ids that survive `byId.get(id)`, which is built from the filtered list — so the dead id is silently dropped. Behavior is correct; no cleanup needed.
- **Disabled trash visual**: trash button shows `opacity-40` while `logSet.isPending`. This is brief (one network round-trip) and matches the existing chevron disabled visual — no new pattern.

### Platform-specific
- **iOS**: `Alert.alert` with `style: "destructive"` paints "Remove" red.
- **Android**: `Alert.alert` renders both actions in default style; functional.
- **Web**: `window.confirm` shows title + message; confirm label parameter ignored on web (existing `confirmDelete` limitation).

### Performance
- Single PostgREST round-trip regardless of set count. Trivial.
- Cache invalidation triggers one `listSetsForSession` refetch.
- `removedExerciseIds` adds one `Set.has` check per exercise per render. O(n), n ≤ ~30. Negligible.

## Alternativas descartadas

1. **Schema migration: `session_exercise_exclusions` tombstone table** — persistent suppression of zero-set exercises. Discarded because the schema change introduces RLS policy work, a new api/hooks/cache key, and a migration round, all to fix an edge case (routine-sourced + zero sets + reload).
2. **Tombstone-set hack (insert + soft-delete a placeholder set as marker)** — abuses `sets` semantics. Discarded per Conductor and `docs/decisions.md`.
3. **Kebab menu in header (`MoreVertical` opening a sheet)** — lowest accidental-tap risk but introduces a new UI pattern not present anywhere in the codebase today. Trash-in-cluster pattern is already proven by `routine-exercise-row.tsx`; consistency wins.
4. **Swipe-to-delete on the block** — new gesture pattern + custom gesture handler. No swipe in the repo today.
5. **Sequential per-row soft-delete loop (mirroring `reorderRoutineExercises`)** — N round-trips, worse latency, no benefit over the bulk-filter form.
6. **Optimistic UI** — would require manual cache patching. Discarded to match `useDeleteSet`/`useLogSet` precedent.
7. **Confirm only when sets exist (skip confirm for zero-set removal)** — saves one tap but introduces inconsistency. Always-confirm preserves the mental model.
8. **Race detection via `.select("id")` + count comparison** (v1 path) — discarded in favor of UI-layer prevention (`removeDisabled` + handler guard). Simpler API surface; race is closed at the source rather than detected after the fact. The two-layer UI mitigation is functionally complete without the data-layer signal.
9. **`await logSet.mutateAsync` inside the handler before bulk delete** — alternative race fix. Discarded because (a) `logSet` is a screen-scoped mutation reference, not per-tap, so `mutateAsync` would not represent "the in-flight call" without extra plumbing; (b) the UI-disable approach is cheaper and gives the user immediate feedback (trash dimmed) rather than a hidden serialization.

## Out of scope

- Reordering exercises mid-session (already exists via chevrons).
- Bulk-remove multiple exercises at once.
- Undo / restore (no undo precedent).
- Removing exercises from a **finished** session (history detail). `<ExerciseBlock>` exposes the optional prop but the history screen does not wire it.
- Persistent suppression of routine-sourced zero-set exercises across reloads.
- Realtime cross-device session sync.
- Adding a "Cancel this workout" prompt when the user removes the last exercise.
- Removing the exercise from the underlying `routines` template.
- e2e test authoring (Tester's responsibility).

## Resposta a issues do Validator

| Validator ref | Resolution | Where in v2 |
|---|---|---|
| **M1** — `.select("id")` is dead code | **Adopted option (a)**: dropped `.select("id")` entirely; API returns `void`. Matches `softDeleteSet` precedent at `src/api/sets.ts:119-125`. | §Contratos → `bulkSoftDeleteSetsForExerciseInSession` signature; §Mudanças → `src/api/sets.ts` row. |
| **M2** — `logSet` race reachable by fast user | **Two-layer UI mitigation**: (1) new `removeDisabled?: boolean` prop on `<ExerciseBlock>`, wired to `logSet.isPending` from `[sessionId].tsx`; (2) `if (!sessionId \|\| logSet.isPending) return;` early-return at the top of `handleRemoveExercise`. Trash visually dims via `opacity-40` while a log is pending. | §Mudanças → `exercise-block.tsx` + `[sessionId].tsx` rows; §Contratos → handler block; §UI spec → render gate with `disabled={!!removeDisabled}`. |
| **m1** — `out` → `filtered` rename ambiguity | **Chose option (b)**: introduce `const filtered = out.filter(...)` once; all three downstream references (`byId` build, trailing-append loop, trailing return) switched to `filtered`. `out` survives only as the union-build accumulator. Full rewrite of the `useMemo` shown verbatim. | §Contratos → `orderedExercises` `useMemo` block. |
| **m6** — `!sessionId` guard missing | Added `if (!sessionId) return;` as the first line of `handleRemoveExercise`. Mirrors `onFinish` precedent at line 155 of current file. | §Contratos → handler block. |
| **m7** — `removedExerciseIds` missing from dep array | Added as the 6th and final entry in the `orderedExercises` `useMemo` dep array. | §Contratos → `useMemo` dep array (commented `// <— NEW (v2)`). |
| **m2** — `setCount` staleness window | Accepted-and-documented. Bulk update is filter-based (`session_id + exercise_id + deleted_at IS NULL`), so off-by-one in the **copy** does not affect the **action** — whatever rows are non-deleted at the bulk-update moment are removed. M2 guard ensures no `logSet` is in flight when the prompt opens. | §UI spec → Confirmation copy paragraph. |
| **m3** — `data?.length ?? 0` defensive nullish | Moot — `.select()` is gone (M1 (a)). | §Contratos → new API signature returns `void`. |
| **m4** — Trash size 18 vs chevron size 20 | Accepted: matches `routine-exercise-row.tsx` precedent verbatim. Documented explicitly. | §UI spec → "Icon size `18`" line. |
| **m5** — Header math wrong (~144px vs ~98px) | Corrected to "~96px (3 × ~32px)". Validator's ~98px figure is consistent. Conclusion (fits at 320pt) unchanged. | §UI spec → "Header-cluster footprint" subsection. |
