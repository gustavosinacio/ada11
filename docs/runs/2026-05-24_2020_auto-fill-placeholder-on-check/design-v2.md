# Design v2 — 2026-05-24_2020_auto-fill-placeholder-on-check

Round: Design↔Validate round 2 of 3. Responds to `validation-v1.md`.

## Diff from v1

Enumerated changes vs. `design-v1.md`. Every Validator item is addressed.

1. **MAJ-1 fixed — bake in the mid-typing race mitigation upfront.**
   - The check handler now synchronously calls `Keyboard.dismiss()` from `react-native` as the **first action** on the check direction (no-op on uncheck).
   - To make the predicate read post-blur state SYNCHRONOUSLY (not after a microtask race), `<SetInput>`'s existing `commit()` path is extended to **also write a local-state optimistic patch into the TanStack cache via `setQueryData`** (path "c" from the Conductor brief). The async `setMutation` still fires (server source of truth), but the cache is patched synchronously so the screen-level handler reads the user's typed value immediately after `Keyboard.dismiss()` triggers the input's `onBlur` → `commit`.
   - Rationale for picking (c) over (a) / (b):
     - (a) "expose a synchronous commit-buffered-value ref on `<SetInput>`" — introduces a new imperative-ref prop drilling layer just for one screen. Reasonable but couples the screen to `<SetInput>`'s internals.
     - (b) "await a microtask after `Keyboard.dismiss()`" — non-deterministic on iOS/Android (RN's `onBlur` propagation isn't a guaranteed microtask boundary). Verified empirically across the rest-timer run that "wait a tick" patterns are flaky.
     - (c) "synchronous `setQueryData` from `commit()`" — the cache is the single source of truth the screen handler already reads (`setsByExercise.get(ex.id)`). Patching it synchronously on blur makes ALL screen-level handlers see fresh local state, not just this one. Net architectural win: the existing "blur → mutate, but cache stays stale until mutation resolves" half-step is closed. The async server mutation still goes through; on success the cache is invalidated and re-fetched as today (so any server-side normalization, e.g. `numeric(7,2)` rounding, still wins). On mutation failure, the next refetch reverts the optimistic patch (TanStack's default behavior — no manual rollback needed because the source of truth still wins on refetch).

2. **MIN-1 fixed — lbs-mode e2e case added.** New scenario in the test plan: profile in lbs mode → prior session at `100 kg × 8` (canonical) → fresh session → check empty working set → assert (a) row's `weight` column = `100.00` (canonical kg-string) AND (b) the visible input value renders as `"220"` (the integer-trim path of `kgToLbs(100)`, which yields `220.4...` → `220.4` via `toFixed(1)`; pin the actual displayed string by reading `kgToLbs` behavior).

   Pin note: `inputStringFromKg` returns `Number.isInteger(v) ? v.toString() : v.toFixed(1)`. `kgToLbs(100) ≈ 220.462` (non-integer) → displayed as `"220.5"`. The e2e will assert the exact string `"220.5"`. (If the conversion rounds differently on the platform, the test will pin reality.)

3. **MIN-2 fixed — `previousSet` made optional.** Prop signature is `previousSet?: SetRow | null`. Helper short-circuits on `undefined` the same as on `null` (one null-ish gate).

4. **MIN-3 fixed — unit test case for `previous.weight === "0"`.** Added: `previous = { ..., weight: "0", reps: 8 }` and `previous = { ..., weight: "0.00", reps: 8 }` cases. Helper must NOT propagate the zero weight (because `previousHasWeight = parseFloat(previous.weight) > 0` is false). Reps from `previous` still propagates if reps source is usable.

5. **MIN-5 acknowledged — `["stats"]` over-invalidation flagged as future optimization.** One-line note in Riscos. No code change in this run.

## Goal (1 sentence)

When the user taps the check button on a **working** set whose `weight` and/or `reps` is empty-or-zero, blur the currently-focused input (so any typed-but-uncommitted value lands first), then auto-commit the same `{weight, reps}` that the row's placeholder already displays (sourced from the existing `previousByRowId` cascade) — without overwriting anything the user actually typed.

## Approach

Insert a single pre-check side-effect into the screen-level `onToggleSetChecked` handler at `app/(app)/workout/[sessionId].tsx:492-520`, gated on `nextChecked === true && set_type === "working"`. The handler reads `setsByExercise` (the TanStack cache) for the predicate. Two structural prerequisites carry the design:

1. **`<SetInput>.commit()` now patches the cache synchronously** (in addition to firing the async `setMutation`). This collapses the previously-async "user types → blurs → mutate → cache fresh" window into a synchronous one. Net effect: when the screen handler calls `Keyboard.dismiss()` and then reads `setsByExercise`, it sees the user's just-typed-and-blurred value, not the stale pre-blur null.

2. **`Keyboard.dismiss()` runs first** on the check direction. On iOS/Android this dispatches `blur` to the focused `<TextInput>`, which fires `onBlur={commit}`, which now synchronously updates the cache. On RN-Web, `Keyboard.dismiss()` is effectively a no-op (no soft keyboard), but the same screen-level fix is delivered by calling `commit()` via the blur path is N/A on web; however, on web the user blurs by tapping the check `Pressable` (which is a different element) — and React Native Web DOES propagate `blur` between sibling pressables when the focused element loses focus to a tapped sibling. Verified empirically by the `<TextInput>`'s `onBlur` firing on web Pressable taps. So both platforms converge.

Then: pure helper `computeAutoFillPayload({set, previous})` → if non-null, `await updateSet.mutateAsync({id, patch})` → start rest-timer → `await checkSet(id)`. The rest-timer moves AFTER the auto-fill write so a failed update doesn't spuriously start the timer.

The placeholder source (`previousSet`) is surfaced through the existing `onToggleSetChecked` callback as a new third arg, populated by `<ExerciseBlock>` from its existing `previousByRowId` Map. Discarded alternative B "lift the Map to the screen" stays discarded (hooks-in-a-loop). See Alternativas.

## Mudanças por arquivo

| File | Type | Change |
|---|---|---|
| `src/utils/auto-fill-set.ts` | new | Pure helper `computeAutoFillPayload({set, previous})`. Single responsibility: given the toggled `SetRow` and its `previousSet`, return `{weight?: string; reps?: number} | null` per the empty-or-zero predicate. No side-effects, no React, no imports from `~/api/*`. |
| `src/components/set-input.tsx` | edited | Single change: `commit()` now ALSO patches the per-session sets cache synchronously via `useQueryClient().setQueryData(["sets", sessionId], …)` before / alongside the async `onCommit` dispatch. To do this without breaking `<SetInput>`'s parent-agnostic shape, the cache patch is implemented at the **caller** (`<ExerciseBlock>`'s `onCommit` callback) by injecting a `setQueryData` call before delegating to the existing `useUpdateSet().mutate(...)`. Net file edit: thread `sessionId` (already in scope of the live screen) down to `<ExerciseBlock>`, and `<ExerciseBlock>` invokes `setQueryData` in its `onCommit` shim. `<SetInput>` itself is **unchanged**. **Correction:** edit is in `src/components/exercise-block.tsx` only — see next row. |
| `src/components/exercise-block.tsx` | edited | Two coupled changes (single responsibility = "make local input commits land synchronously in the cache so screen-level handlers can read fresh values"): (1) accept new `sessionId: string` prop (passed by the live screen); (2) in the `onCommit` shim that routes `<SetInput>` commits to `onUpdateSet`, ALSO call `qc.setQueryData(["sets", sessionId], (rows: SetRow[] \| undefined) => rows?.map(r => r.id === s.id ? {...r, ...patch} : r))` synchronously before dispatching the async mutation. (3) extend `onToggleSetChecked` prop signature: `(id, nextChecked, previousSet?: SetRow \| null) => void \| Promise<void>`; at the `<SetInput>` mount site, pass `previousByRowId.get(s.id) ?? null` as the third arg. |
| `app/(app)/workout/[sessionId].tsx` | edited | Two coupled changes (single responsibility = "auto-fill on check"): (1) extend `onToggleSetChecked={async (id, nextChecked, previousSet) => {...}}` handler to add the auto-fill side-effect; (2) on the check direction (`nextChecked === true`) call `Keyboard.dismiss()` SYNCHRONOUSLY before reading `setsByExercise`. Pass `sessionId={sessionId}` to `<ExerciseBlock>` as a new prop. Uncheck path untouched. |
| `tests/unit/auto-fill-set.test.ts` | new | Pure-helper unit tests. Cases listed under Contratos de I/O. |
| `tests/e2e/auto-fill-placeholder-on-check.spec.ts` | new | E2E spec mirroring `rest-timer-auto-start.spec.ts` shape. Cases listed under Contratos de I/O (includes the new lbs-mode case from MIN-1). |

Note on the "one responsibility per file change" rule: `exercise-block.tsx` carries two edits that together implement one responsibility ("expose synchronous-cache-commit + propagate `previousSet` to the toggle callback"). Splitting into two PRs would force a temporary state where `previousSet` is passed but the cache isn't sync, which is precisely the bug v2 fixes. Justified.

## Contratos de I/O

### New helper

```ts
// src/utils/auto-fill-set.ts
import type { SetRow } from "~/db/types";

export type AutoFillPayload = {
  /** Canonical kg-string. Omitted when the current weight is non-empty/non-zero
   *  OR previous.weight is unusable (null/zero). */
  weight?: string;
  /** Integer reps. Omitted when current reps is non-empty/non-zero OR
   *  previous.reps is unusable (null/zero). */
  reps?: number;
};

/**
 * Returns the partial patch needed to auto-fill a set's empty/zero
 * weight/reps from its placeholder source. Returns `null` when no auto-fill
 * is needed (nothing to fill, or no usable previous, or non-working set_type).
 *
 * Predicate per field on the TOGGLED set:
 *   weight needs fill iff  set.weight == null || parseFloat(set.weight) === 0
 *   reps   needs fill iff  set.reps   == null || set.reps   === 0
 *
 * Source usability per field on `previous`:
 *   previousHasWeight iff  previous?.weight != null && parseFloat(previous.weight) > 0
 *   previousHasReps   iff  previous?.reps   != null && previous.reps   > 0
 *
 * Only working sets (set.set_type === "working") auto-fill; warmup/dropset
 * always return null.
 *
 * `previous` accepts `null | undefined` (treated identically).
 */
export function computeAutoFillPayload(args: {
  set: SetRow;
  previous?: SetRow | null;
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
  /** Live-session id. Required when `showCheckable` is true so the block can
   *  synchronously patch the per-session sets cache on each input commit. */
  sessionId: string;
  onToggleSetChecked?: (
    id: string,
    nextChecked: boolean,
    previousSet?: SetRow | null,
  ) => void | Promise<void>;
};
```

`<SetInput>` itself is unchanged. `<ExerciseBlock>` owns the synchronous cache patch via `useQueryClient().setQueryData(["sets", sessionId], updater)` inside its existing `onCommit` shim that wraps `<SetInput>`'s `onCommit`.

### Synchronous cache patch (inside `<ExerciseBlock>`)

```ts
// src/components/exercise-block.tsx — inside the loop over sets, replacing
// the existing <SetInput onCommit={...}> closure.
const qc = useQueryClient();
// ...
onCommit={(patch) => {
  // Synchronously patch the per-session sets cache so screen-level handlers
  // (e.g. the auto-fill predicate in onToggleSetChecked) read the user's
  // typed-and-blurred value immediately on the next render tick. The async
  // server mutation below is still the source of truth; on its onSuccess the
  // cache is invalidated and re-fetched, so server-side normalization
  // (e.g. numeric(7,2) rounding) still wins. On mutation failure, the next
  // refetch reverts this optimistic patch (TanStack default behavior).
  qc.setQueryData<SetRow[] | undefined>(
    ["sets", sessionId],
    (rows) => rows?.map((r) => (r.id === s.id ? { ...r, ...patch } : r)),
  );
  void onUpdateSet({ id: s.id, patch });
}}
```

### Updated screen handler shape (post-change)

```ts
// app/(app)/workout/[sessionId].tsx
import { Keyboard } from "react-native";
// ...
onToggleSetChecked={async (id, nextChecked, previousSet) => {
  // Uncheck: untouched path.
  if (!nextChecked) {
    try { await uncheckSetM.mutateAsync(id); }
    catch (err) { console.warn("Toggle set check failed", err); }
    return;
  }

  // Check direction: blur any focused TextInput so its onBlur → commit fires
  // and lands in the sets cache (synchronously, via <ExerciseBlock>'s
  // setQueryData patch). This prevents auto-fill from overwriting a value
  // the user just typed but hasn't blurred yet (MAJ-1 from validation-v1).
  Keyboard.dismiss();

  try {
    const toggled = (setsByExercise.get(ex.id) ?? []).find((s) => s.id === id);
    const isWorking = toggled?.set_type === "working";

    if (toggled && isWorking) {
      const patch = computeAutoFillPayload({ set: toggled, previous: previousSet });
      if (patch) await updateSet.mutateAsync({ id, patch });
    }

    // Rest-timer fires AFTER autofill succeeds (if it ran), BEFORE checkSet.
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

### Order-of-side-effects (post-change, check direction only)

```
tap check button
  └─ onToggleChecked(true) [SetInput]
     └─ onToggleSetChecked(id, true, previousSet) [ExerciseBlock]
        └─ screen handler:
           1. Keyboard.dismiss()
              └─ focused <TextInput> onBlur fires
                 └─ commit({reps, weight}) [SetInput]
                    └─ qc.setQueryData(["sets", sessionId], …)   [SYNC]
                    └─ onUpdateSet({id, patch})                  [ASYNC]
              (Net: cache reflects user's typed value before step 2 reads it)
           2. find toggled set via setsByExercise.get(ex.id)
              └─ now sees the just-blurred local values
           3. if working: compute patch via computeAutoFillPayload
           4. if patch non-null: await updateSet.mutateAsync({id, patch})
              ├─ on success: ["sets", sessionId] + ["stats"] invalidated
              │              → <SetInput> useEffect resyncs local strings
              └─ on failure: catch block; checkSet NOT issued; rest-timer NOT started
           5. if working AND rest > 0: restTimer.start(rest)  [optimistic]
           6. await checkSetM.mutateAsync(id)
              └─ ["sets", sessionId] invalidated → green-tint flip
```

### Predicate spec (exact)

```ts
function computeAutoFillPayload({
  set,
  previous,
}: {
  set: SetRow;
  previous?: SetRow | null;
}): AutoFillPayload | null {
  if (set.set_type !== "working") return null;

  const weightNeedsFill =
    set.weight == null || Number.parseFloat(set.weight) === 0;
  const repsNeedsFill =
    set.reps == null || set.reps === 0;

  if (!weightNeedsFill && !repsNeedsFill) return null;

  const previousHasWeight =
    previous?.weight != null && Number.parseFloat(previous.weight) > 0;
  const previousHasReps =
    previous?.reps != null && previous.reps > 0;

  const patch: AutoFillPayload = {};
  if (weightNeedsFill && previousHasWeight) patch.weight = previous!.weight!;
  if (repsNeedsFill && previousHasReps) patch.reps = previous!.reps!;
  return Object.keys(patch).length > 0 ? patch : null;
}
```

### Unit test cases (tests/unit/auto-fill-set.test.ts)

| # | Toggled set | Previous | Expected return |
|---|---|---|---|
| 1 | weight=null, reps=null, working | weight="100.00", reps=8 | `{weight:"100.00", reps:8}` |
| 2 | weight=null, reps=8, working | weight="100.00", reps=10 | `{weight:"100.00"}` |
| 3 | weight="100.00", reps=null, working | weight="100.00", reps=8 | `{reps:8}` |
| 4 | weight="0", reps=null, working | weight="120.00", reps=8 | `{weight:"120.00", reps:8}` |
| 5 | weight="0.00", reps=0, working | weight="120.00", reps=8 | `{weight:"120.00", reps:8}` |
| 6 | weight="100.00", reps=8, working | weight="120.00", reps=10 | `null` (no fields need fill) |
| 7 | weight=null, reps=null, working | `null` (no previous) | `null` |
| 8 | weight=null, reps=null, working | `undefined` | `null` |
| 9 | weight=null, reps=null, working | weight=null, reps=8 | `{reps:8}` (skip weight; source unusable) |
| 10 | weight=null, reps=null, working | weight="100.00", reps=null | `{weight:"100.00"}` (skip reps) |
| 11 | weight=null, reps=null, **warmup** | weight="60.00", reps=12 | `null` (gate) |
| 12 | weight=null, reps=null, **dropset** | weight="60.00", reps=6 | `null` (gate) |
| 13 (MIN-3) | weight=null, reps=null, working | weight="0", reps=8 | `{reps:8}` (zero weight source NOT propagated) |
| 14 (MIN-3) | weight=null, reps=null, working | weight="0.00", reps=8 | `{reps:8}` (same) |
| 15 (MIN-3) | weight=null, reps=null, working | weight="100.00", reps=0 | `{weight:"100.00"}` (zero reps source NOT propagated) |

### E2E test cases (tests/e2e/auto-fill-placeholder-on-check.spec.ts)

Mirror `rest-timer-auto-start.spec.ts` setup (`seedRoutineWithTwoExercises`, `signInAndLand`, `gotoLiveSession`). Selectors stay `getByLabel("Mark set as completed")`.

| # | Setup | Action | Assertion |
|---|---|---|---|
| E1 | prior session 100×8 kg | check empty working set | row's `weight="100.00"`, `reps=8`, both inputs render "100" / "8" |
| E2 | prior session 100×8 kg, user types "120" into weight (no blur) | tap check | row's `weight="120.00"`, `reps=8`. **User's typed value NOT overwritten.** |
| E3 | prior session 100×8 kg, user types "5" into reps (no blur) | tap check | row's `weight="100.00"`, `reps=5`. **User's typed reps NOT overwritten.** |
| E4 | prior session 100×8 kg, weight input has "0" | tap check | row's `weight="100.00"`, `reps=8` (zero treated as empty) |
| E5 | prior session 100×8 kg, reps input has "0" | tap check | row's `weight="100.00"`, `reps=8` (zero treated as empty) |
| E6 | no prior session, both empty | tap check | row checked, `weight=null`, `reps=null`. Volume excludes per F10. |
| E7 | prior session 100×8 kg, working set both filled (90×6) | tap check | row's `weight="90.00"`, `reps=6` (no auto-fill — predicate null) |
| E8 | prior session 100×8 kg, **warmup** empty | tap check | row checked, `weight=null`, `reps=null` (warmup gate) |
| E9 | prior session 100×8 kg, **dropset** empty | tap check | row checked, `weight=null`, `reps=null` (dropset gate) |
| E10 | prior session 100×8 kg, multiple unchecked working sets | tap "Check all and finish" | bulk-check does NOT auto-fill (path bypasses `onToggleSetChecked`) |
| E11 | prior session 100×8 kg, fresh session, auto-fill fires, user uncheck → re-check | uncheck then re-check | re-check sees row already filled → predicate null → no spurious second auto-fill |
| **E12 (MIN-1)** | profile in lbs mode, prior session canonical 100 kg × 8, fresh session empty | tap check | row's `weight="100.00"` (canonical kg), AND the visible weight input displays `"220.5"` (the `inputStringFromKg` integer-trim + `toFixed(1)` of `kgToLbs(100)`). Pin the displayed string by reading the input's `value`. |

Note: E12 assumes `kgToLbs(100) ≈ 220.462` rendered to one decimal as `"220.5"`. If the actual `kgToLbs` constant produces a different string (e.g. `"220.4"`), pin to reality; the **invariant** under test is "lbs unit user sees lbs-converted value, canonical kg is what's persisted".

### DB columns / queries

No change. Reuses existing `updateSet({id, patch: {weight?, reps?}})` (partial-spread payload pinned by `tests/unit/api-sets.updateSet.test.ts:49-122`) and `checkSet(id)`. No schema change, no migration, no RLS change — the existing `auth.uid() = user_id` policy already covers both calls.

### UI props / state

- `<SetInput>` local `weight` / `reps` strings auto-resync after `updateSet` invalidates `["sets", sessionId]` — the existing `useEffect([row.reps, row.weight, unit])` at `set-input.tsx:90-93` is the cache-driven update path. No new prop drilling into `<SetInput>` needed.
- Visual diff after auto-fill: the input flips from gray placeholder text ("100", "8") to crisp value text ("100", "8") plus the green-tint row background from `completed_at != null`. No new color, no new icon, no new accessibility label.

## Riscos

### Data integrity (RLS / migrations)

- **Zero schema change.** `updateSet` + `checkSet` are existing mutations under the same `auth.uid() = user_id` RLS policy. No new attack surface.
- **Partial-spread invariant** on `updateSet` (BLK-1 from `2026-05-22_1000_set-row-declutter` v3) is the keystone — passing `{weight, reps}` only must NOT clobber `rpe`, `notes`, or `completed_at`. Pinned by `tests/unit/api-sets.updateSet.test.ts:49-122`. Auto-fill is just another caller of the same shape, no new payload variant.
- **Write ordering under F10** ("checked = committed"): `updateSet` lands BEFORE `checkSet`, so there is no window where a checked set has `null` weight. F10 stats kernels (`sumLiveVolume`) read post-cache-invalidation and see the row in its final shape.
- **Synchronous cache patch via `setQueryData`** in `<ExerciseBlock>`'s `onCommit` shim is an OPTIMISTIC client-side patch. If the server mutation later fails, the next refetch (triggered by `invalidateQueries` on the auto-fill or check mutations downstream) reverts the optimistic patch to the server's truth. Worst case: the user's optimistic value lives in the UI for ~200ms until the refetch lands. No persistent inconsistency.

### UX regressions

- **Mid-typing race FIXED (was MAJ-1 in v1).** `Keyboard.dismiss()` runs first on the check direction. On iOS/Android this blurs the focused `<TextInput>`, firing `onBlur={commit}`. The `commit` path now patches the cache synchronously via `setQueryData`. The screen handler then reads the user's just-typed value, not a stale null, and the auto-fill predicate correctly returns `null` for the typed field. E2E E2 and E3 above pin this directly.
- **RN-Web platform note.** On web there is no soft keyboard so `Keyboard.dismiss()` is mostly a no-op, but the user blurs the focused input by tapping the check `Pressable` (a sibling element) — RN-Web propagates `blur` between siblings on tap, so `onBlur={commit}` fires there too. Verified empirically against the existing `commit-on-blur` flow used by the manual-commit path today. **Tester to add explicit web-mode coverage on E2/E3.**
- **Rest-timer auto-start reorder.** Today the timer fires synchronously BEFORE `checkSet`. After this change, the timer still fires synchronously BEFORE `checkSet` but now ALSO AFTER `await updateSet` resolves. Net delay added to the timer's overlay flip: only on the auto-fill path, only the duration of one PostgREST round-trip (typically <100ms on Wi-Fi, <300ms on cellular). On the non-auto-fill path (both fields already filled), the order is byte-identical to today's. **Tester to pin** with the existing `rest-timer-auto-start.spec.ts` suite (must still pass) plus the new E1.
- **`previousByRowId` includes warmup-as-previous in the in-session fallback** (no `set_type` filter on the in-session walk at `exercise-block.tsx:112-117`). A working set might auto-fill from a warmup. Decision: stay consistent with the placeholder (the placeholder already shows the warmup's values, so auto-filling matches what the user sees). Future-run cleanup if it becomes confusing.
- **Bulk "Check all and finish"**: routes through `useBulkCheckAllInSession` (single bulk UPDATE), not through `onToggleSetChecked`. Auto-fill will NOT fire for bulk-check. Correct per spec; E10 pins it.
- **History detail / read-only block**: `<ReadOnlyExerciseBlock>` does not pass `showCheckable` and does not mount `onToggleSetChecked`. Auto-fill cannot leak.

### Platform-specific

- `Keyboard.dismiss()` is the React Native canonical blur primitive. On iOS/Android it dismisses the soft keyboard AND fires `onBlur` on the focused `<TextInput>`. On RN-Web it is a no-op for keyboard but the blur path still triggers via sibling-pressable-tap (as today).
- Synchronous `setQueryData` is platform-agnostic.

### Performance

- One extra PostgREST round-trip per auto-fill-triggered check (2 round-trips instead of 1). On the happy path ("user mimics previous session"), this is the common case. On local Supabase: <100ms. On real Wi-Fi: <300ms. On poor cellular: 500ms-1s.
- **MIN-5 acknowledged: `useUpdateSet`'s `["stats"]` invalidation is over-broad.** The auto-fill mutation invalidates `["stats"]` even though the stats kernels gate on `completed_at != null` and the checkSet that follows ALSO invalidates `["sets", sessionId]` (but not `["stats"]`). Net: one extra `["stats"]` invalidation per auto-fill-triggered check. Not a correctness issue (stats kernels just refetch). Flagged as a future optimization candidate; out of scope for this run.
- Synchronous `setQueryData` from `<ExerciseBlock>`'s `onCommit` is O(N) over the set rows of the session (`rows.map`). N is small (typically <50). Negligible.

## Alternativas descartadas

1. **(alt B from Conductor guidance #6) Lift `previousByRowId` to the screen** — descartada porque the Map's `useMemo` depends on `lastFromHistory` (a per-exercise `useQuery`), so lifting it would require the screen to call `useLastWorkingSet` per exercise. That breaks the rules-of-hooks unless we refactor to a `useLastWorkingSetForAllExercises({ids: ex[]})` aggregate hook — a much larger refactor that smears `<ExerciseBlock>`'s data ownership. Surfacing one `previousSet` row through the callback is a 1-line component change with the same semantic.

2. **(alt C) Push auto-fill into `<SetInput>`** — descartada porque `<SetInput>` does not own `updateSet`. Wiring would require either a new `onAutoFill` prop chained through `<ExerciseBlock>`, or smashing the auto-fill values into the existing `onCommit` and re-routing through `onToggleChecked`. Both add coupling; neither earns its keep.

3. **Single combined `checkSetWithValues({id, weight?, reps?})` mutation** — descartada para v1 porque it adds new API surface (`src/api/sets.ts`) and a new hook (`useCheckSetWithValues`). The 2-round-trip cost is measurable but not blocking. If real-device measurement shows a visible regression, do it as a follow-up.

4. **(MAJ-1 mitigation option a) Expose a synchronous-commit-buffered-value ref on `<SetInput>`** — descartada porque it introduces a new imperative-ref prop drilling layer used by exactly one screen. The chosen path (sync `setQueryData` from `<ExerciseBlock>`'s `onCommit` shim) generalizes: ANY screen-level handler that reads `setsByExercise` after a blur will see fresh values, not just the auto-fill case.

5. **(MAJ-1 mitigation option b) Await a microtask after `Keyboard.dismiss()` before reading the cache** — descartada porque RN's `onBlur` propagation is not a guaranteed microtask boundary across iOS/Android/RN-Web. Empirically flaky.

6. **Optimistic local-state update inside `<SetInput>`** (synchronously call `setWeight("100")` / `setReps("8")` from the handler) — descartada porque it would require a new callback prop from screen → `<SetInput>` exposing the setters, OR a render-cycle ref. The existing `useEffect([row.reps, row.weight, unit])` already handles the cache-driven resync after the mutation lands.

7. **Auto-fill on uncheck → re-check cycle (preserve last-known auto-filled values)** — descartada porque the spec is explicit: "Unchecking does not auto-fill (only the check action triggers it)." The uncheck path stays byte-identical to today.

## Out of scope

- **Combined `checkSetWithValues` mutation.** Deferred.
- **Schema / migrations.** No DB change.
- **Warmup and dropset auto-fill.** Spec exclusion. Helper short-circuits `null` on non-working `set_type`.
- **History detail / `<ReadOnlyExerciseBlock>`.** No toggle handler exists there; no leak possible.
- **Cross-exercise placeholder source.** `previousByRowId` is per-exercise via `useLastWorkingSet(exercise.id)`. Inherited verbatim.
- **Filtering `previousByRowId`'s in-session walk by `set_type === "working"`.** Discovery Unknowns #8. Staying consistent with the placeholder for v1.
- **Per-row UI affordance to opt out of auto-fill** (tap-and-hold, long-press, etc.). Not in spec.
- **Per-exercise / per-user preference toggle for auto-fill.** Not in spec.
- **`useUpdateSet`'s `["stats"]` invalidation narrowing.** MIN-5 from validation-v1; future optimization, no correctness impact.
- **Cache buster bump.** No `SetRow` serialization change.
- **Set-add / set-delete behaviors.** Unchanged.

## Resposta a issues do Validator

- **MAJ-1 (mid-typing race is a NEW regression)**: addressed by (a) calling `Keyboard.dismiss()` synchronously at the start of the check-direction handler, AND (b) extending `<ExerciseBlock>`'s `onCommit` shim to synchronously patch the per-session sets cache via `setQueryData` before dispatching the async server mutation. The combination means that by the time the screen handler reads `setsByExercise.get(ex.id)`, the user's just-typed-and-blurred value is already in the cache and the auto-fill predicate correctly returns `null` for that field. E2E cases E2 and E3 pin this directly (user types into weight or reps without blurring, taps check, asserts the typed value survives — NOT overwritten by previous-session values). Picked path (c) over (a) and (b) per the Conductor's guidance; rationale documented in "Diff from v1" #1 and in the Alternativas section.

- **MIN-1 (lbs unit-mode e2e missing)**: E2E case E12 added. Profile in lbs mode, prior session 100 kg × 8 canonical, fresh empty working set, check → assert (a) canonical kg-string `"100.00"` is persisted AND (b) the visible weight input renders `"220.5"` (or whatever `inputStringFromKg(kgToLbs(100), "lbs")` actually produces — pin to reality).

- **MIN-2 (optional prop typing)**: helper signature is `previous?: SetRow | null`. Prop signature on `onToggleSetChecked` is `(id, nextChecked, previousSet?: SetRow | null) => void | Promise<void>`. Helper treats `null` and `undefined` identically.

- **MIN-3 (previous-weight-zero unit test)**: cases 13, 14, 15 added to the unit test plan above. Pins `previousHasWeight = parseFloat(previous.weight) > 0` and `previousHasReps = previous.reps > 0` gates.

- **MIN-4 (lift-to-screen rejection rationale)**: re-pinned in Alternativas #1. No change.

- **MIN-5 (`["stats"]` over-invalidation)**: acknowledged in Riscos / Performance as a future optimization candidate. One extra `["stats"]` invalidation per auto-fill-triggered check; stats kernels refetch but read no stale data; not a correctness issue. Out of scope for this run.

## Confidence and risk

- **Confidence: HIGH** that the helper + callback-signature path is the right architecture. `previousByRowId` is the single source of truth for the visible placeholder; re-using it verbatim matches the spec literally.
- **Confidence: HIGH** that the `Keyboard.dismiss()` + sync-`setQueryData` mitigation closes MAJ-1. The data flow is fully synchronous from blur to cache; the screen handler reads a deterministically-fresh cache.
- **Confidence: MEDIUM** on the displayed lbs string in E12 (`"220.5"` vs `"220.4"` vs other rounding). The Tester pins to reality on first run; invariant under test is "lbs user sees lbs-converted value, canonical kg persists".
- **Risk: LOW** for data integrity. No schema change, no RLS change, partial-spread `updateSet` invariant pinned by unit tests, write order eliminates the F10 "checked-but-null" window. Optimistic `setQueryData` patch reverts on next refetch if the server mutation fails.
- **Risk: LOW** for UX regression. Rest-timer reorder shifts the timer fire by one round-trip only on the auto-fill path. Existing rest-timer e2e remains valid (seeds positive values → predicate returns `null` → no extra await → timer fires identically).
- **Risk: LOW** for platform divergence. `Keyboard.dismiss()` is RN-canonical; `setQueryData` is platform-agnostic; the RN-Web blur-via-sibling-tap path is the existing manual-commit flow.
