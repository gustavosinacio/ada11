# Design v1 — 2026-05-24_2020_auto-fill-placeholder-on-check

## Goal (1 sentence)
When the user taps the check button on a **working** set whose `weight` and/or `reps` is empty-or-zero, auto-commit the same `{weight, reps}` that the row's placeholder already displays (sourced from the existing `previousByRowId` cascade), so the saved row matches what the user is staring at without having to retype anything.

## Approach

Insert a single pre-check side-effect into the screen-level `onToggleSetChecked` handler at `app/(app)/workout/[sessionId].tsx:492-520`. The handler already (a) has the toggled set in scope via `setsByExercise`, (b) gates on `set_type === "working"` for the rest-timer, and (c) owns `useUpdateSet`. We extend it with:

1. A pure helper `computeAutoFillPayload({set, previous})` that returns the partial `{weight?, reps?}` patch (or `null`) per a per-field empty-or-zero predicate.
2. A new optional arg on `onToggleSetChecked` that carries `previousSet` from `<ExerciseBlock>`'s existing `previousByRowId` Map — surfaced via the callback signature rather than lifting the Map (small blast radius; the Map's `useMemo` keys stay co-located with the placeholder consumer).
3. A reorder of side-effects: compute payload → `await updateSet(...)` if needed → start rest-timer → `await checkSet(...)`. The rest-timer moves AFTER the autofill write so a failed update doesn't spuriously start the timer.

Picked this over (alt B) "lift `previousByRowId` to the screen" because the Map's two dependencies (`sets` already in screen scope, `lastFromHistory` which is a per-exercise `useQuery` call) would force the screen to call `useLastWorkingSet` per exercise — a hooks-in-a-loop hazard. Surfacing one `previousSet` row through the callback keeps the data path one-directional and adds zero new hooks.

The auto-fill predicate is **per-field**: weight and reps each check independently. If only one field is empty/zero, only that field gets backfilled — matches the placeholder UX where each input has its own placeholder. If `previousSet` is `null` (no in-session prior, no cross-session history), the handler silently falls through to plain `checkSet` (existing behavior — row gets checked with `null` values; F10 excludes it from volume).

## Mudanças por arquivo

| File | Type | Change |
|---|---|---|
| `src/utils/auto-fill-set.ts` | new | Pure helper `computeAutoFillPayload({set, previous})`. Single responsibility: given the toggled `SetRow` and its `previousSet`, return `{weight?: string; reps?: number} | null` per the empty-or-zero predicate. No side-effects, no React, no imports from `~/api/*`. |
| `src/components/exercise-block.tsx` | edited | Single change: extend the `onToggleSetChecked` prop signature to pass the row's `previousSet` (from the existing `previousByRowId` Map) as a second arg to the parent. Line 240 `(nextChecked) => onToggleSetChecked(s.id, nextChecked)` becomes `(nextChecked) => onToggleSetChecked(s.id, nextChecked, previousByRowId.get(s.id) ?? null)`. Prop type updated. No other behavioral change. |
| `app/(app)/workout/[sessionId].tsx` | edited | Single change: extend the `onToggleSetChecked={async (id, nextChecked) => {...}}` handler at lines 492-520 to also accept `previousSet`, then run the auto-fill: compute payload, await `updateSet.mutateAsync({id, patch})` if non-null, then start rest-timer, then `await checkSetM.mutateAsync(id)`. Uncheck path untouched. Catch block wraps both writes — on `updateSet` failure, bail before `checkSet` (the timer hasn't started yet under the new order, so no rollback needed). |
| `tests/unit/auto-fill-set.test.ts` | new | Pure-helper unit tests. Cases: both empty + previous full, only weight empty, only reps empty, weight="0", reps=0, both filled (no-op), previous=null (no-op), previous has weight=null (skip that field), warmup set_type (no-op), dropset set_type (no-op). |
| `tests/e2e/auto-fill-placeholder-on-check.spec.ts` | new | E2E spec mirroring `rest-timer-auto-start.spec.ts` shape. Cases: working-set with both inputs empty + prior session at 100×8 → check → row commits 100×8; only weight empty; only reps empty; weight="0" literal; reps="0" literal; no previous (no-op); warmup-set-type (no auto-fill); dropset-set-type (no auto-fill); uncheck does not auto-fill on re-check uncheck cycle; bulk-check-all does not auto-fill. |

## Contratos de I/O

### New helper

```ts
// src/utils/auto-fill-set.ts
import type { SetRow } from "~/db/types";

export type AutoFillPayload = {
  /** Canonical kg-string. Omitted when the current weight is non-empty/non-zero OR previous.weight is unusable. */
  weight?: string;
  /** Integer reps. Omitted when current reps is non-empty/non-zero OR previous.reps is unusable. */
  reps?: number;
};

/**
 * Returns the partial patch needed to auto-fill a set's empty/zero weight/reps
 * from its placeholder source. Returns `null` when no auto-fill is needed
 * (nothing to fill, or no usable previous, or non-working set_type).
 *
 * Predicate per field:
 *   weight needs fill iff set.weight == null || parseFloat(set.weight) === 0
 *   reps   needs fill iff set.reps   == null || set.reps   === 0
 * Source usability per field:
 *   weight from previous iff previous.weight != null && parseFloat(previous.weight) > 0
 *   reps   from previous iff previous.reps   != null && previous.reps   > 0
 *
 * Only working sets (set_type === "working") auto-fill; warmup/dropset return null.
 */
export function computeAutoFillPayload(args: {
  set: SetRow;
  previous: SetRow | null;
}): AutoFillPayload | null;
```

Return shape contract:
- `null` whenever the patch would be empty (no fields to write).
- Never returns `{ weight: null }` or `{ reps: null }` — the helper only proposes positive writes, never explicit clears.
- `weight` is always returned as the canonical kg-string from `previous.weight` (verbatim, no transformation; `previous.weight` is already in canonical form per `numeric(7,2)` storage).

### Updated component contract

```ts
// src/components/exercise-block.tsx — prop type change
type ExerciseBlockProps = {
  // ...existing props unchanged...
  onToggleSetChecked?: (
    id: string,
    nextChecked: boolean,
    previousSet: SetRow | null,
  ) => void | Promise<void>;
};
```

`<SetInput>` itself is unchanged — the `previousSet` it already receives via prop is the same row that `<ExerciseBlock>` will now pass through on toggle.

### Screen handler shape (post-change)

```ts
onToggleSetChecked={async (id, nextChecked, previousSet) => {
  const toggled = (setsByExercise.get(ex.id) ?? []).find((s) => s.id === id);
  const isWorking = toggled?.set_type === "working";

  // Uncheck: untouched path.
  if (!nextChecked) {
    try { await uncheckSetM.mutateAsync(id); }
    catch (err) { console.warn("Toggle set check failed", err); }
    return;
  }

  // Check: auto-fill (working only) before mutations.
  try {
    if (toggled && isWorking) {
      const patch = computeAutoFillPayload({ set: toggled, previous: previousSet });
      if (patch) await updateSet.mutateAsync({ id, patch });
    }

    // Rest-timer fires AFTER autofill succeeds, BEFORE checkSet (still
    // optimistic vs. the check write — preserves the no-visible-delay UX).
    if (isWorking) {
      const rest = restByExercise.get(ex.id);
      if (rest && rest > 0) restTimer.start(rest);
    }

    await checkSetM.mutateAsync(id);
  } catch (err) {
    console.warn("Toggle set check failed", err);
  }
}}
```

### DB columns / queries

No change. Reuses existing `updateSet({id, patch: {weight?, reps?}})` (partial-spread payload pinned by `tests/unit/api-sets.updateSet.test.ts:49-122`) and `checkSet(id)`. No schema change, no migration, no RLS change — the existing `auth.uid() = user_id` policy already covers both calls.

### UI props / state

- `<SetInput>` local `weight` / `reps` strings auto-resync after `updateSet` invalidates `["sets", sessionId]` — the existing `useEffect([row.reps, row.weight, unit])` at `set-input.tsx:90-93` is the cache-driven update path. No new prop drilling needed.
- Visual diff after auto-fill: the input flips from gray placeholder text ("100", "8") to crisp black value text ("100", "8") plus the green-tint row background from `completed_at != null`. No new color, no new icon, no new accessibility label.

### Predicate spec (exact)

```ts
// Per-field predicates
const weightNeedsFill =
  set.weight == null || Number.parseFloat(set.weight) === 0;
const repsNeedsFill =
  set.reps == null || set.reps === 0;

// Per-field source usability (previous must have a positive number to copy)
const previousHasWeight =
  previous?.weight != null && Number.parseFloat(previous.weight) > 0;
const previousHasReps =
  previous?.reps != null && previous.reps > 0;

// Final patch
const patch: AutoFillPayload = {};
if (weightNeedsFill && previousHasWeight) patch.weight = previous!.weight!;
if (repsNeedsFill && previousHasReps) patch.reps = previous!.reps!;
return Object.keys(patch).length > 0 ? patch : null;
```

Gate: helper returns `null` early when `set.set_type !== "working"`.

### Order-of-side-effects (post-change, check direction only)

```
tap check button
  └─ onToggleChecked(true) [SetInput]
     └─ onToggleSetChecked(id, true, previousSet) [ExerciseBlock]
        └─ screen handler:
           1. find toggled set via setsByExercise.get(ex.id)
           2. if working: compute patch via computeAutoFillPayload
           3. if patch: await updateSet.mutateAsync({id, patch})
              ├─ on success: ["sets",sessionId] + ["stats"] invalidated
              │              → <SetInput> useEffect resyncs local strings
              └─ on failure: catch block; checkSet NOT issued; rest-timer NOT started
           4. if working AND rest > 0: restTimer.start(rest)  [optimistic]
           5. await checkSetM.mutateAsync(id)
              └─ ["sets",sessionId] invalidated → green-tint flip
```

## Riscos

### Data integrity (RLS / migrations)

- **Zero schema change.** `updateSet` + `checkSet` are existing mutations under the same `auth.uid() = user_id` RLS policy. No new attack surface.
- **Partial-spread invariant** on `updateSet` (BLK-1 from `2026-05-22_1000_set-row-declutter` v3) is the keystone — passing `{weight, reps}` only must NOT clobber `rpe`, `notes`, or `completed_at`. Pinned by `tests/unit/api-sets.updateSet.test.ts:49-122`. Auto-fill is just another caller of the same shape, no new payload variant.
- **Write ordering under F10** ("checked = committed"): `updateSet` lands BEFORE `checkSet`, so there is no window where a checked set has `null` weight. The previous order (check first, no update) is now superseded by (update first, check after) in the auto-fill case. F10 stats kernels (`sumLiveVolume`) read post-cache-invalidation and see the row in its final shape.

### UX regressions

- **Rest-timer auto-start reorder.** Today the timer fires synchronously BEFORE `checkSet`. After this change, the timer still fires synchronously BEFORE `checkSet` but now ALSO AFTER `await updateSet` resolves. Net delay added to the timer's overlay flip: only on the auto-fill path, only the duration of one PostgREST round-trip (typically <100ms on Wi-Fi, <300ms on cellular). On the non-auto-fill path (both fields already filled), the order is byte-identical to today's. **Tester to pin** with the existing `rest-timer-auto-start.spec.ts` suite (must still pass) plus a new spec asserting timer-fires-after-update in the auto-fill case.
- **User mid-typing race**: user types `5` into reps, taps check without blurring → the row's `reps` is still `null` from the cache, but the local state in `<SetInput>` is `"5"`. The handler reads from `setsByExercise` (cache), so the predicate sees `null` and auto-fills from `previousSet`. The local "5" gets overwritten when the `useEffect` resyncs to the new `row.reps`. **This is a data-loss-of-uncommitted-input bug.** Mitigation in scope: the `onToggleChecked` press is on a different `Pressable` from the inputs, so on iOS/Android the tap blurs the input naturally (RN blur-on-tap-other behavior). On web, tapping a non-input element does NOT blur a focused input by default — but the input's `onBlur` IS the existing `commit` path, so the user's "5" would not have committed there either (they would lose it on plain check today too). **This is a pre-existing bug, NOT a new regression.** Out of scope for this run; flag in Out of scope.
- **`previousByRowId` includes warmup-as-previous in the in-session fallback** (no `set_type` filter on the in-session walk at `exercise-block.tsx:112-117`). A working set might auto-fill from a warmup. Discovery flagged this. Decision: stay consistent with the placeholder (the placeholder already shows the warmup's values, so auto-filling matches what the user sees). Mitigation if it becomes confusing: future run can filter `set_type === "working"` on the in-session walk — same change improves the placeholder too.
- **Bulk "Check all and finish"**: routes through `useBulkCheckAllInSession` (single bulk UPDATE), not through `onToggleSetChecked`. Auto-fill will NOT fire for bulk-check. This is the correct behavior per spec ("only the check action triggers it" — bulk-check is a different intent). E2E pin required.
- **History detail / read-only block**: `<ReadOnlyExerciseBlock>` does not pass `showCheckable` and does not mount `onToggleSetChecked`. Auto-fill cannot leak. Verified in `src/components/read-only-exercise-block.tsx:19`.

### Platform-specific

- Pure data-layer + React state change. No platform-specific code. Web, iOS, Android share the same `useState`-cache-invalidation roundtrip.
- **Web-specific local-state race** with the mid-typing case (above) is pre-existing.

### Performance

- One extra PostgREST round-trip per auto-fill-triggered check (2 round-trips instead of 1). On the happy path ("user mimics previous session" — exactly the high-frequency flow per the spec), this is the common case. On local Supabase: <100ms. On real Wi-Fi: <300ms. On poor cellular: 500ms-1s.
- Mitigation candidate (out of scope): a single combined `UPDATE sets SET weight=?, reps=?, completed_at=now() WHERE id=?` helper would halve round-trips. New API surface; deferred to a future run if real-device measurement justifies it.
- No additional cache invalidations beyond what each mutation already triggers. TanStack dedupes simultaneous invalidations of `["sets", sessionId]` so the visible refetch is single.

## Alternativas descartadas

1. **(alt B from Conductor guidance #6) Lift `previousByRowId` to the screen** — descartada porque the Map's `useMemo` depends on `lastFromHistory` (a per-exercise `useQuery`), so lifting it would require the screen to call `useLastWorkingSet` per exercise. That breaks the rules-of-hooks unless we refactor to a `useLastWorkingSetForAllExercises({ids: ex[]})` aggregate hook — a much larger refactor that smears `<ExerciseBlock>`'s data ownership. Surfacing one `previousSet` row through the callback is a 1-line component change with the same semantic.

2. **(alt C) Push auto-fill into `<SetInput>`** — descartada porque `<SetInput>` does not own `updateSet`. Wiring would require either a new `onAutoFill` prop chained through `<ExerciseBlock>`, or smashing the auto-fill values into the existing `onCommit` and re-routing through `onToggleChecked`. Both add coupling; neither earns its keep.

3. **Single combined `checkSetWithValues({id, weight?, reps?})` mutation** — descartada para v1 porque it adds new API surface (`src/api/sets.ts`) and a new hook (`useCheckSetWithValues`). The 2-round-trip cost is measurable but not blocking. If real-device measurement shows a visible regression, do it as a follow-up.

4. **Optimistic local-state update** (synchronously call `setWeight("100")` / `setReps("8")` from the handler) — descartada porque it would require a new callback prop from screen → `<SetInput>` exposing the setters, OR a render-cycle ref. The existing `useEffect([row.reps, row.weight, unit])` already handles the cache-driven resync; the green-tint flip from the rest-timer overlay and `completed_at` write provides immediate visual feedback. Speed of input-text catch-up is a "nice to have", not a regression.

5. **Auto-fill on uncheck → re-check cycle (preserve last-known auto-filled values)** — descartada porque the spec is explicit: "Unchecking does not auto-fill (only the check action triggers it)." The uncheck path stays byte-identical to today.

6. **Add `Keyboard.dismiss()` / explicit input commit on check tap** — relevant to the mid-typing race (described under Riscos). Descartada para este run porque the race is pre-existing (today's check button doesn't blur inputs either). A future run can add `commit-on-check` and the auto-fill predicate would naturally see the fresh values. Documenting in Out of scope.

## Out of scope

- **Combined `checkSetWithValues` mutation.** Deferred; the 2-round-trip cost is the v1 perf trade.
- **Schema / migrations.** No DB change.
- **Warmup and dropset auto-fill.** Spec exclusion. Helper short-circuits `null` on non-working `set_type`.
- **History detail / `<ReadOnlyExerciseBlock>`.** No toggle handler exists there; no leak possible.
- **Cross-exercise placeholder source.** `previousByRowId` is per-exercise via `useLastWorkingSet(exercise.id)`. Inherited verbatim.
- **`Keyboard.dismiss()` / commit-on-check for the mid-typing race.** Pre-existing; deferred to a focused run.
- **Filtering `previousByRowId`'s in-session walk by `set_type === "working"`.** Discovery Unknowns #8. Staying consistent with the placeholder for v1.
- **Per-row UI affordance to opt out of auto-fill** (tap-and-hold, long-press, etc.). Not in spec.
- **Per-exercise / per-user preference toggle for auto-fill.** Not in spec.
- **Optimistic local `<SetInput>` string update.** Defensive default; the `useEffect` resync is sufficient.
- **Cache buster bump.** No `SetRow` serialization change.
- **Set-add / set-delete behaviors.** Unchanged.

## Confidence and risk

- **Confidence: HIGH** that the helper + callback-signature path is the right architecture. The existing `previousByRowId` Map is the single source of truth for the visible placeholder, and re-using it verbatim (rather than recomputing) is what the spec literally asks for. The handler insertion point is the same one the rest-timer feature used; the precedent is gold-standard.
- **Confidence: MEDIUM** on the mid-typing race UX call. The race is pre-existing, but auto-fill makes it more visible because the system now actively writes a different value than what the user typed. If real users complain, the fix is `Keyboard.dismiss()` + a render-cycle delay before reading the cache — small follow-up.
- **Risk: LOW** for data integrity. No schema change, no RLS change, partial-spread `updateSet` invariant pinned by unit tests, write order eliminates the F10 "checked-but-null" window.
- **Risk: LOW-MEDIUM** for UX regression on rest-timer auto-start. The reorder shifts the timer fire by one round-trip on the auto-fill path. Tester to pin both the existing rest-timer spec AND a new auto-fill-with-timer spec to prove no regression.
- **Risk: LOW** for platform divergence. Pure data layer + React state. Same code path on web/iOS/Android.
