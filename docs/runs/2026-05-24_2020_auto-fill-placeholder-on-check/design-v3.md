# Design v3 — 2026-05-24_2020_auto-fill-placeholder-on-check

Round: Design↔Validate round **3 of 3 (LAST)**. Responds to `validation-v2.md`.

## Diff from v2

Every change vs. `design-v2.md` enumerated. Each addresses a v2 finding.

1. **BLK-1 closed — predicate now reads typed-but-uncommitted strings DIRECTLY from `<SetInput>`'s local state, via an extended `onToggleChecked` callback signature (option b1).**
   - `<SetInput>.onToggleChecked` was `(nextChecked: boolean) => void`. It becomes:
     ```ts
     onToggleChecked?: (
       nextChecked: boolean,
       currentInput: { weight: string; reps: string },
     ) => void;
     ```
   - `<SetInput>` already owns `[weight, setWeight]` and `[reps, setReps]` local strings (the typed-but-unblurred values). When the user taps the check button, the existing handler `() => onToggleChecked?.(!isChecked)` is widened to `() => onToggleChecked?.(!isChecked, { weight, reps })`.
   - `<ExerciseBlock>.onToggleSetChecked` was `(setId, nextChecked) => void`. It becomes:
     ```ts
     onToggleSetChecked?: (
       setId: string,
       nextChecked: boolean,
       options: {
         previousSet: SetRow | null;
         currentInput: { weight: string; reps: string };
       },
     ) => void | Promise<void>;
     ```
   - The screen handler reads `currentInput.weight` / `currentInput.reps` directly. No cache read, no `setQueryData`, no `Keyboard.dismiss()` blur dance, no async race window.
   - Picked **(b1)** over **(b2) "push predicate into `<SetInput>`"** because (b1) keeps the side-effect (mutation dispatch) co-located with the screen-level handler that already owns `useUpdateSet`. Side-effects do NOT distribute across N `<SetInput>` instances; only the callback signature widens.

2. **MAJ-1 (v2) closed — drop the `<ExerciseBlock>` sync-cache-patch shim entirely.** No more `qc.setQueryData(["sets", sessionId], …)` from `<ExerciseBlock>`. The manual-commit path (existing `onCommit → onUpdateSet → updateSet.mutateAsync`) is byte-identical to today's behavior. Removes the "every blur invalidates twice" UX regression.

3. **MAJ-2 (v2) closed — no more "clear-unrelated-fields on partial commit" hazard.** Since the shim is dropped, the user typing into weight only and tapping check no longer triggers a sync `{reps: null}` cache patch. Today's deferred-clear semantics are preserved.

4. **BLK-2 (v2) closed — `sessionId` prop removed entirely from `<ExerciseBlock>`.** Was required in v2 to source the `setQueryData` key. Without the shim, the prop has no purpose. The history-edit caller at `app/(app)/history/[id].tsx:310-352` continues to mount `<ExerciseBlock>` byte-identically.

5. **`Keyboard.dismiss()` dropped from the auto-fill path.** The buffered value flows directly through the callback. The auto-fill predicate never reads stale cache; there is nothing to flush. **Kept as a separate, optional UX polish call** at the very start of the check direction — the user tapping the check button reasonably expects the soft keyboard to dismiss. Documented in the handler with a one-line rationale ("UX polish, not a correctness requirement"). This is consistent with how the bulk "Check all and finish" affordance feels when invoked from a focused row today. If the Reviewer or Tester objects, it can be removed in implementation with no design impact.

6. **Auto-fill kg value sourced from `previous.weight` (canonical kg-string), NOT from `currentPlaceholder.weight`.** The callback's 4th-arg-equivalent (`currentPlaceholder`) is not passed at all. Reason: `currentPlaceholder` would carry the lbs-converted display string in lbs mode (e.g. `"220.5"`), and using it would force the helper to round-trip through `lbsToKg` — pointless lossy conversion when `previous.weight` is already the canonical kg-string we want to write. Conductor's brief listed `currentPlaceholder` as a 4th arg for completeness; this design omits it because nothing in the auto-fill payload computation needs it.

7. **`computeAutoFillPayload` helper signature now takes string-keyed `currentInput` (not a `SetRow`).** Matches the Conductor's spec from "Helper signature" section:
   ```ts
   export function computeAutoFillPayload(args: {
     currentInput: { weight: string; reps: string };
     previous: { weight: string | null; reps: number | null } | null | undefined;
   }): { weight?: string; reps?: number } | null;
   ```
   - The predicate operates on the STRING the user has in the field RIGHT NOW (typed-but-not-blurred wins over the cached row's `null`).
   - `previous` is widened to a structural shape `{weight: string | null; reps: number | null}` instead of `SetRow` so the helper unit tests don't need to construct full SetRow stubs.

8. **Unit test cases updated** — the table now takes `currentInput` (strings) instead of a `SetRow` for the toggled-set. The new pure-string semantics are reflected in cases 1-8 from the Conductor brief, plus retained edge cases from v2 (warmup gate is removed from the helper signature — see #9 below).

9. **Warmup/dropset gate moves OUT of the helper, INTO the screen handler.** The Conductor's helper signature has no `set_type` parameter, so the gate lives at the call site (where `toggled?.set_type` is already in scope). Helper becomes pure-string and `set_type`-agnostic.

10. **E2E plan revised to match the Conductor's exact 10-case list** (E1-E10), with the lbs case at E9 (was E12 in v2) and the rest-timer regression as E10.

## Goal (1 sentence)

When the user taps the check button on a **working** set whose weight and/or reps input is empty-or-zero, auto-commit the same `{weight, reps}` that the row's placeholder already displays (sourced from the existing `previousByRowId` cascade), reading the live typed string from `<SetInput>`'s local state so any value the user just typed but didn't blur is honored, not overwritten.

## Approach

Insert a single pre-check side-effect into the screen-level `onToggleSetChecked` handler at `app/(app)/workout/[sessionId].tsx:492-520`, gated on `nextChecked === true && set_type === "working"`. The handler receives — via an extended callback signature — both (a) the placeholder source (`previousSet`, populated from `<ExerciseBlock>`'s existing `previousByRowId` Map), and (b) the user's current typed strings (`currentInput`, populated from `<SetInput>`'s `[weight, setWeight]` / `[reps, setReps]` local state).

Because the typed strings flow through the callback synchronously (just like the `nextChecked` boolean already does), there is no cache read, no blur dance, no microtask race. The handler computes the partial patch via the pure helper `computeAutoFillPayload({currentInput, previous})`, awaits `updateSet` if the patch is non-null, then proceeds to the existing rest-timer + `checkSet` sequence.

Three structural changes:

1. **`<SetInput>.onToggleChecked` signature widens** to pass `{weight, reps}` strings from local state.
2. **`<ExerciseBlock>.onToggleSetChecked` signature widens** to pass both `previousSet` (from `previousByRowId`) and `currentInput` (forwarded from `<SetInput>`).
3. **Screen handler reads `currentInput` and `previousSet` directly from the callback args.** Calls the pure helper, awaits `updateSet` if needed, then existing rest-timer + `checkSet`.

No `setQueryData` shim. No `sessionId` prop on `<ExerciseBlock>`. The manual-commit path (onBlur → commit → onUpdateSet → mutate) stays byte-identical to today.

## Mudanças por arquivo

| File | Type | Change |
|---|---|---|
| `src/utils/auto-fill-set.ts` | new | Pure helper `computeAutoFillPayload({currentInput, previous})`. Single responsibility: given the user's typed strings and the placeholder-source row, return `{weight?: string; reps?: number} \| null`. No side-effects, no React, no imports outside `~/db/types`. `set_type` gating lives in the caller (no `set` arg). |
| `src/components/set-input.tsx` | edited | Single change: widen `onToggleChecked` prop signature to `(nextChecked: boolean, currentInput: {weight: string; reps: string}) => void`, and forward `{weight, reps}` from local state on tap. The `Pressable.onPress` at line 115 changes from `() => onToggleChecked?.(!isChecked)` to `() => onToggleChecked?.(!isChecked, { weight, reps })`. Zero other changes. |
| `src/components/exercise-block.tsx` | edited | Single change: widen `onToggleSetChecked` prop signature to `(setId, nextChecked, options: {previousSet: SetRow \| null; currentInput: {weight: string; reps: string}}) => void \| Promise<void>`. At the `<SetInput>` mount site, the existing `onToggleChecked` thunk is replaced with `(nextChecked, currentInput) => onToggleSetChecked(s.id, nextChecked, { previousSet: previousByRowId.get(s.id) ?? null, currentInput })`. Zero other changes. |
| `app/(app)/workout/[sessionId].tsx` | edited | Single change: extend the `onToggleSetChecked={async (id, nextChecked, {previousSet, currentInput}) => {...}}` handler to (1) gate auto-fill on `nextChecked && set_type === "working"`, (2) compute payload via `computeAutoFillPayload`, (3) await `updateSet.mutateAsync` if patch non-null, (4) preserve existing rest-timer optimistic start + `checkSet` sequence in that order. Optional `Keyboard.dismiss()` polish at top of check branch (UX-only, not load-bearing — documented inline). Uncheck path byte-identical to today. |
| `tests/unit/auto-fill-set.test.ts` | new | Pure-helper unit tests, 8 cases per Conductor brief + retained edge cases. Listed under Contratos. |
| `tests/e2e/auto-fill-placeholder-on-check.spec.ts` | new | E2E spec, 10 cases (E1-E10) per Conductor brief. Listed under Contratos. |

**One responsibility per file**: each file change has a single concrete purpose. `set-input.tsx` widens one prop; `exercise-block.tsx` widens one prop and forwards; the screen handler adds one side-effect to one branch; the helper is one pure function.

## Contratos de I/O

### New helper

```ts
// src/utils/auto-fill-set.ts

export type AutoFillPayload = {
  /** Canonical kg-string copied verbatim from `previous.weight`. Omitted when
   *  the user's typed weight is non-empty/non-zero OR previous.weight is
   *  unusable (null or parses to 0). */
  weight?: string;
  /** Integer reps copied from `previous.reps`. Omitted when the user's typed
   *  reps is non-empty/non-zero OR previous.reps is unusable (null or 0). */
  reps?: number;
};

/**
 * Returns the partial patch needed to auto-fill an empty/zero set from its
 * placeholder source. Returns `null` when no auto-fill is needed (no fields
 * empty, or no usable previous on the empty fields).
 *
 * The caller is responsible for gating on `set_type === "working"`. This
 * helper does not look at set_type.
 *
 * Predicate per field on `currentInput`:
 *   weightInputEmpty = currentInput.weight === "" || parseFloat(currentInput.weight) === 0
 *   repsInputEmpty   = currentInput.reps   === "" || Number(currentInput.reps)   === 0
 *
 * Source usability per field on `previous`:
 *   previousHasWeight = previous?.weight != null && parseFloat(previous.weight) > 0
 *   previousHasReps   = previous?.reps   != null && previous.reps   > 0
 *
 * - If `weightInputEmpty && previousHasWeight`, patch.weight = previous.weight (canonical kg-string).
 * - If `repsInputEmpty && previousHasReps`,    patch.reps   = previous.reps.
 * - Return null if patch ends up empty.
 *
 * `previous` accepts `null | undefined` (treated identically).
 */
export function computeAutoFillPayload(args: {
  currentInput: { weight: string; reps: string };
  previous: { weight: string | null; reps: number | null } | null | undefined;
}): AutoFillPayload | null;
```

Return shape contract:
- Returns `null` whenever the patch would be empty.
- Never returns `{ weight: null }` or `{ reps: null }` — only positive writes.
- `weight` is always the canonical kg-string from `previous.weight` verbatim. No unit conversion. (Discovery #12 verified `previous.weight` is `string | null` in canonical kg form per `numeric(7,2)` storage.)

### Updated component contracts

```ts
// src/components/set-input.tsx — prop signature change

type Props = {
  // ...existing props unchanged...
  /** Forwarded toggle handler. `currentInput` is the live local-state value
   *  of the row's weight/reps text inputs — the typed-but-not-blurred string
   *  the user has on screen RIGHT NOW. The toggle target row's `weight`/`reps`
   *  in the cache may differ if the user has typed without blurring. */
  onToggleChecked?: (
    nextChecked: boolean,
    currentInput: { weight: string; reps: string },
  ) => void;
};
```

```ts
// src/components/exercise-block.tsx — prop signature change

type Props = {
  // ...existing props unchanged. NO sessionId prop (dropped per v2 BLK-2). ...
  onToggleSetChecked?: (
    setId: string,
    nextChecked: boolean,
    options: {
      previousSet: SetRow | null;
      currentInput: { weight: string; reps: string };
    },
  ) => void | Promise<void>;
};
```

The history-edit caller at `app/(app)/history/[id].tsx:310-352` does not pass `onToggleSetChecked` (no `showCheckable`), so this signature change is invisible to it. Confirmed by re-reading the file: no required-prop addition.

### Updated screen handler shape

```ts
// app/(app)/workout/[sessionId].tsx

import { Keyboard } from "react-native";
import { computeAutoFillPayload } from "~/utils/auto-fill-set";
// ...

onToggleSetChecked={async (id, nextChecked, { previousSet, currentInput }) => {
  // Uncheck: byte-identical to today.
  if (!nextChecked) {
    try { await uncheckSetM.mutateAsync(id); }
    catch (err) { console.warn("Toggle set check failed", err); }
    return;
  }

  // UX polish (not a correctness requirement under v3's design — the typed
  // values already flow through `currentInput`). Dismisses the soft keyboard
  // when the user taps the check button, matching common iOS gym-app idiom.
  Keyboard.dismiss();

  try {
    const toggled = (setsByExercise.get(ex.id) ?? []).find((s) => s.id === id);
    const isWorking = toggled?.set_type === "working";

    if (isWorking) {
      const patch = computeAutoFillPayload({
        currentInput,
        previous: previousSet,
      });
      if (patch) {
        await updateSet.mutateAsync({ id, patch });
      }
    }

    // Existing optimistic rest-timer start, preserved post-autofill (so a
    // failed updateSet doesn't spuriously start the timer — failure path
    // bails to the catch below before reaching here).
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

### Order of side effects (auto-fill case, check direction)

```
tap check button on <SetInput>
  └─ Pressable.onPress: onToggleChecked(!isChecked, { weight, reps })       [SYNC]
     └─ <ExerciseBlock> forwards: onToggleSetChecked(s.id, true, {
          previousSet: previousByRowId.get(s.id) ?? null,
          currentInput: { weight, reps },
        })                                                                   [SYNC]
        └─ screen handler:
           1. nextChecked === true branch.
           2. Keyboard.dismiss() — UX polish; not load-bearing.               [SYNC]
           3. toggled = setsByExercise.get(ex.id).find(s => s.id === id).
           4. if isWorking: patch = computeAutoFillPayload({currentInput, previous: previousSet}).
              └─ predicate operates on STRINGS the user has on screen, not on cached row values.
           5. if patch: await updateSet.mutateAsync({id, patch}).            [ASYNC]
              ├─ onSuccess: invalidates ["sets", sessionId] + ["stats"].
              │              <SetInput> useEffect resyncs local strings to row's new weight/reps.
              └─ onError: throws → catch block; checkSet NOT issued; rest-timer NOT started.
           6. if isWorking && rest > 0: restTimer.start(rest).               [SYNC, optimistic]
           7. await checkSetM.mutateAsync(id).                               [ASYNC]
              └─ onSuccess: invalidates ["sets", sessionId] → green-tint flip via completed_at.
```

Uncheck direction: steps 2-7 are skipped entirely. Only `uncheckSetM.mutateAsync(id)` runs, byte-identical to today.

### DB columns / queries

No change. Reuses existing `updateSet({id, patch: {weight?, reps?}})` (partial-spread pinned by `tests/unit/api-sets.updateSet.test.ts:49-122`) and `checkSet(id)`. No schema change, no migration, no RLS change.

### UI props / state

- `<SetInput>` local `weight`/`reps` strings auto-resync after `updateSet` invalidates `["sets", sessionId]` — the existing `useEffect([row.reps, row.weight, unit])` at `set-input.tsx:90-93` is the cache-driven update path. No new prop drilling.
- Visual diff after auto-fill: input flips from gray placeholder text to crisp value text, plus the green-tint row background from `completed_at != null`. No new color, icon, accessibility label, or tap target.

### Unit test cases (tests/unit/auto-fill-set.test.ts)

8 cases per Conductor brief, plus retained edge cases. Helper has no `set_type` parameter, so warmup/dropset gating tests move to the screen-handler E2E (E5/E6).

| # | `currentInput` | `previous` | Expected return |
|---|---|---|---|
| 1 | `{weight: "", reps: ""}` | `{weight: "120.00", reps: 8}` | `{weight: "120.00", reps: 8}` |
| 2 | `{weight: "0", reps: ""}` | `{weight: "120.00", reps: 8}` | `{weight: "120.00", reps: 8}` (zero treated as empty) |
| 3 | `{weight: "100", reps: ""}` | `{weight: "120.00", reps: 8}` | `{reps: 8}` (typed weight survives, only reps filled) |
| 4 | `{weight: "", reps: "8"}` | `{weight: "120.00", reps: 10}` | `{weight: "120.00"}` (typed reps survives, only weight filled) |
| 5 | `{weight: "", reps: ""}` | `null` | `null` (no source) |
| 6 | `{weight: "", reps: ""}` | `{weight: "0", reps: 8}` | `{reps: 8}` (zero-weight source unusable) |
| 7 | `{weight: "", reps: ""}` | `{weight: "120.00", reps: 0}` | `{weight: "120.00"}` (zero-reps source unusable) |
| 8 | `{weight: "0", reps: "0"}` | `{weight: "0", reps: 0}` | `null` (both sources unusable, even though both inputs are empty-equivalent) |
| 9 (edge) | `{weight: "", reps: ""}` | `undefined` | `null` (undefined and null treated identically) |
| 10 (edge) | `{weight: "100.00", reps: "8"}` | `{weight: "120.00", reps: 10}` | `null` (no fields need fill) |
| 11 (edge) | `{weight: "0.00", reps: ""}` | `{weight: "120.00", reps: 8}` | `{weight: "120.00", reps: 8}` (parseFloat("0.00") === 0 → empty) |
| 12 (edge) | `{weight: "", reps: ""}` | `{weight: "0.00", reps: 8}` | `{reps: 8}` (parseFloat("0.00") === 0 → unusable) |

### E2E test cases (tests/e2e/auto-fill-placeholder-on-check.spec.ts)

10 cases per Conductor brief. Mirror `rest-timer-auto-start.spec.ts` setup: `seedRoutineWithTwoExercises`, `signInAndLand`, `gotoLiveSession`. Selectors: `getByLabel("Mark set as completed")` / `getByLabel("Unmark set as completed")`.

| # | Setup | Action | Assertion |
|---|---|---|---|
| E1 | prior session 120 kg × 8, fresh empty working set | tap check | row's `weight="120.00"`, `reps=8`. Visible inputs render `"120"` and `"8"`. |
| E2 | prior session 120 kg × 8, user types `"100"` into weight (no blur) | tap check | row's `weight="100.00"` (typed survives). Reps may or may not auto-fill depending on whether reps was empty — case fixes reps as empty, so `reps=8` filled. |
| E3 | prior session 120 kg × 8, user types `"5"` into reps (no blur), weight empty | tap check | row's `weight="120.00"`, `reps=5`. Typed reps survives; empty weight auto-filled. |
| E4 | no prior session (first-ever for exercise), both inputs empty | tap check | row checked, `weight=null`, `reps=null`. F10 excludes from volume. |
| E5 | prior session 120 kg × 8, **warmup** set, both empty | tap check | row checked, `weight=null`, `reps=null` (warmup gate in screen handler). |
| E6 | prior session 120 kg × 8, **dropset**, both empty | tap check | row checked, `weight=null`, `reps=null` (dropset gate in screen handler). |
| E7 | prior session 120 kg × 8, working set auto-filled previously, now uncheck → check again | uncheck, then re-check | re-check: row's `weight` and `reps` already filled from the prior auto-fill → predicate returns null → no spurious second auto-fill, no new mutation issued. (Network log: only one `checkSet` call after the re-check, no `updateSet`.) |
| E8 | prior session 120 kg × 8, multiple unchecked empty working sets | tap "Check all and finish" | bulk-check does NOT auto-fill (path bypasses `onToggleSetChecked`). All sets end with `weight=null`, `reps=null`, `completed_at` set. |
| E9 | profile in **lbs mode**, prior session canonical 120 kg × 8 (logged in kg earlier or via lbs round-trip), fresh empty working set in lbs mode | tap check | row's `weight="120.00"` (canonical kg). Visible weight input renders the lbs-converted string per `inputStringFromKg(kgToLbs(120), "lbs")` — pin to whatever the function produces (expected `"264.6"` from `kgToLbs(120) ≈ 264.554` → `toFixed(1)`). Invariant under test: lbs user sees lbs-converted value AND canonical kg is what's persisted. |
| E10 | rest-timer e2e regression: prior session 120 kg × 8, working set with both inputs already filled (90 kg × 6), routine rest target 60s | tap check | rest-timer fires on existing optimistic schedule. No extra await (predicate returns null). `rest-timer-auto-start.spec.ts` suite continues to pass byte-identically. |

E9 lbs string pin: `kgToLbs(120) = 120 × 2.20462 = 264.5544`; `Number.isInteger(264.5544) === false`, so `inputStringFromKg` returns `(264.5544).toFixed(1) === "264.6"`. The e2e will assert exactly `"264.6"`. If the actual conversion constant in `~/utils/units` differs, the Tester pins to reality on first run — the invariant (lbs-display, kg-persist) is what matters.

## Riscos

### Data integrity (RLS / migrations)

- **Zero schema change.** `updateSet` + `checkSet` are existing mutations under the same `auth.uid() = user_id` RLS policy. No new attack surface.
- **Partial-spread invariant** on `updateSet` (pinned by `tests/unit/api-sets.updateSet.test.ts:49-122`) — passing `{weight, reps}` only must NOT clobber `rpe`, `notes`, or `completed_at`. Auto-fill is just another caller of the existing shape, no new payload variant.
- **Write ordering under F10** ("checked = committed"): `updateSet` lands BEFORE `checkSet`, so there is no window where a checked set has `null` weight. F10 stats kernels (`sumLiveVolume`) read post-cache-invalidation and see the row in its final shape.
- **No optimistic cache patching.** v2's `setQueryData` shim is removed. The manual-commit path (blur → commit → mutate → invalidate) is byte-identical to today's behavior, so the BLK-2/MAJ-1/MAJ-2 invalidation collisions from v2 cannot recur.

### UX regressions

- **Mid-typing race CLOSED architecturally.** The typed string is read directly from `<SetInput>`'s local state via the callback, not from the cache. No blur is required; no `Keyboard.dismiss()` synchronization is needed. E2E E2 and E3 pin this directly.
- **Typed value NEVER lost to auto-fill.** Per the helper predicate, `currentInput.weight === "100"` is non-empty/non-zero → `weightInputEmpty === false` → patch omits weight → `updateSet` doesn't touch weight → after `checkSet`, the row's `weight` is still `null` until the user blurs OR the rest-timer-driven re-render fires the `useEffect`. **Subtle subtlety:** because we don't blur, the cache's `row.weight` remains `null` after auto-fill of reps only; the user's typed `"100"` lives in `<SetInput>`'s local state until they blur. The eventual blur commits via the existing `onBlur={commit}` path → `updateSet({weight: "100.00", reps: undefined})` → cache updates → row has `{weight: "100.00", reps: 8}` (auto-filled reps + post-blur weight). F10 sees the final row correctly. **The only window where the row appears as `weight=null && reps=8 && completed_at != null` is between check-tap and the user's eventual blur**, which is the same window the user was already in before this feature. Net: no regression, and the typed value is preserved.
   - Optional `Keyboard.dismiss()` polish at top of check branch could trigger blur on iOS/Android, closing this window faster — but as v2's BLK-1 traced, `Keyboard.dismiss()` is async on native and doesn't synchronize a same-tick commit. v3 does NOT depend on it.
- **Rest-timer auto-start reorder.** Today the timer fires synchronously BEFORE `checkSet`. After this change, the timer still fires synchronously BEFORE `checkSet` but now ALSO AFTER `await updateSet` resolves IF auto-fill ran. Net delay added to the timer's overlay flip: only on the auto-fill path, ~one PostgREST round-trip (<300ms typically). On the non-auto-fill path (both fields already filled OR no previous), the order is byte-identical to today. E10 pins this.
- **`previousByRowId` includes warmup-as-previous in the in-session fallback** (no `set_type` filter on the in-session walk at `exercise-block.tsx:112-117`). A working set could auto-fill from a warmup. Decision: stay consistent with the placeholder (already today's behavior — the placeholder shows the warmup's values). Future-run cleanup if confusing.
- **Bulk "Check all and finish"**: routes through `useBulkCheckAllInSession`, not through `onToggleSetChecked`. Auto-fill will NOT fire for bulk-check. Correct per spec; E8 pins it.
- **History detail / read-only block**: `<ReadOnlyExerciseBlock>` does not mount `onToggleSetChecked`. The history-edit caller at `app/(app)/history/[id].tsx:310-352` mounts `<ExerciseBlock>` WITHOUT `showCheckable` and WITHOUT `onToggleSetChecked` — so the prop signature widening doesn't affect it. Confirmed by re-reading.
- **`<SetInput>.onToggleChecked` signature change.** Single production caller is `<ExerciseBlock>` (confirmed by grep). Test consumers, if any, may need updating — see Open question #1 under "Open questions in Riscos" below.

### Platform-specific

- Pure JS callback flow. No native module calls in the auto-fill path. iOS / Android / RN-Web share the same code path.
- `Keyboard.dismiss()` is the only RN-native call, kept ONLY as optional UX polish (not load-bearing). Web: no-op on the keyboard side; the user's tap on the Pressable already changes focus per RN-Web's default behavior. The auto-fill predicate does not depend on the resulting blur.

### Performance

- One extra PostgREST round-trip per auto-fill-triggered check (2 round-trips instead of 1). On the happy path (the high-frequency "user mimics previous session" flow per spec), this is the common case. Local Supabase: <100ms. Real Wi-Fi: <300ms.
- `["stats"]` invalidation from `useUpdateSet` is over-broad (MIN-5 from v1 validation). Acknowledged as future optimization; stats kernels refetch but read no stale data. Not a correctness issue.
- Callback args grow from `(setId, nextChecked)` to `(setId, nextChecked, options)` — one extra object allocation per tap. Negligible.

### Open questions for the Validator (raised inline)

1. **Are there any test files importing `<SetInput>` or `<ExerciseBlock>` and asserting on the OLD callback shapes?** Quick grep should confirm. If yes, those tests need a one-line signature update. Risk: LOW; this is a pure type-widening change with no runtime divergence on existing call sites. **Acceptance for Validator: accept the type-widening as not requiring a separate test-update line item — Implementer will update any callers found during implementation.**

2. **Is the optional `Keyboard.dismiss()` worth keeping?** v3 keeps it as UX polish, documented as non-load-bearing. If the Validator or Reviewer judges it as added complexity for no benefit (the auto-fill works without it), it can be dropped. **Designer recommendation: keep it.** Familiar gym-app idiom; user taps a non-input control, soft keyboard goes away; consistent with the bulk "Check all and finish" UX.

3. **Should the helper accept `SetRow | null | undefined` for `previous` instead of the structural `{weight: string | null; reps: number | null}` shape?** Conductor's brief specified the structural shape, so v3 follows it. Benefit: unit tests don't need `SetRow` stubs. Cost: callers passing a full `SetRow` rely on structural typing (TypeScript accepts it transparently). **Designer recommendation: stay with the structural shape per Conductor brief.**

## Alternativas descartadas

1. **(b2) Push the predicate INTO `<SetInput>`.** `<SetInput>` has both `previousSet` and local state — it could compute the auto-fill payload internally and either (i) dispatch its own `updateSet` mutation (decentralized — `useUpdateSet` would move into `<SetInput>`), or (ii) call `onCommit({weight: previous.weight, reps: previous.reps})` synchronously BEFORE `onToggleChecked` to leverage the existing commit path. **Descartada porque** it distributes the side-effect (mutation dispatch) across N `<SetInput>` instances and couples each instance to `useUpdateSet`. The chosen (b1) path keeps side-effects centralized in the screen handler — only the callback signature widens. v3's "single responsibility per file" balances better.

2. **(v2 path: `Keyboard.dismiss()` + sync `setQueryData` shim)** — descartada per Validator BLK-1: same-tick post-blur cache read is architecturally impossible (closure capture + async native blur). v3's callback-args-pass path is race-free on every platform.

3. **(v1 alt B) Lift `previousByRowId` to the screen** — descartada (pinned in v1 and v2): the Map's `useMemo` depends on `lastFromHistory` (a per-exercise `useQuery`); lifting forces hooks-in-a-loop. Surfacing one `previousSet` through the callback is a 1-line component change with the same semantic.

4. **Single combined `checkSetWithValues({id, weight?, reps?})` mutation** — descartada for v3: adds new API surface (`src/api/sets.ts`) and a new hook. The 2-round-trip cost is measurable but not blocking. Deferred to a follow-up if real-device measurement justifies it.

5. **Pass a 4th-arg `currentPlaceholder` through the callback** (the lbs-converted display string from `<SetInput>`) — descartada because `previous.weight` is already the canonical kg-string we want to write. Going through the display string would require lossy lbs→kg round-trip. Conductor's brief listed `currentPlaceholder` as a 4th arg "for completeness"; v3 omits it because nothing needs it.

6. **Sync `setWeight(previous)` / `setReps(previous)` from inside `<SetInput>` after the toggle** (optimistic local state) — descartada because the existing `useEffect([row.reps, row.weight, unit])` already handles cache-driven resync after `updateSet` invalidates. Adding an imperative setter ref earns no extra UX.

7. **Auto-fill on uncheck → re-check cycle** — descartada per spec: "Unchecking does not auto-fill (only the check action triggers it)." Uncheck path is byte-identical to today.

## Out of scope

- **Combined `checkSetWithValues` mutation.** Deferred.
- **Schema / migrations.** No DB change.
- **Warmup and dropset auto-fill.** Spec exclusion. Screen handler gates on `set_type === "working"`.
- **History detail / `<ReadOnlyExerciseBlock>` and history-edit `<ExerciseBlock>`.** Neither passes `onToggleSetChecked`; auto-fill cannot leak.
- **Cross-exercise placeholder source.** `previousByRowId` is per-exercise via `useLastWorkingSet(exercise.id)`. Inherited verbatim.
- **Filtering `previousByRowId`'s in-session walk by `set_type === "working"`** (Discovery Unknowns #8). Future optimization; current design stays consistent with the visible placeholder.
- **Per-row UI affordance to opt out of auto-fill** (tap-and-hold, long-press, etc.). Not in spec.
- **Per-exercise / per-user preference toggle for auto-fill.** Not in spec.
- **`useUpdateSet`'s `["stats"]` invalidation narrowing.** MIN-5 from v1 validation; future optimization.
- **Cache buster bump.** No `SetRow` serialization change.
- **Set-add / set-delete behaviors.** Unchanged.
- **`Keyboard.dismiss()` as a load-bearing primitive.** v3 keeps it only as optional UX polish; the auto-fill correctness does not depend on it.
- **Bulk-commit-on-check (force `commit()` on the focused input before auto-fill).** Not needed: the typed value flows through the callback, so we don't need a blur to land.

## Resposta a issues do Validator (v2)

- **BLK-1 (same-tick post-blur cache read is architecturally impossible)**: closed. v3 reads `currentInput` strings directly from `<SetInput>`'s local state via the extended `onToggleChecked` callback signature. No cache read for the predicate, no blur dance, no microtask race. The `setsByExercise` lookup in the screen handler is still used — but only to find `set_type` (for the working-set gate), NOT to read the typed values. E2/E3 pin the typed-value-survives invariant. Per Conductor's hard constraint #1 (option b1).

- **BLK-2 (required `sessionId` prop breaks history-edit caller)**: closed. `sessionId` prop is REMOVED entirely from `<ExerciseBlock>` (was added in v2 only to source the `setQueryData` key — now unneeded since the shim is dropped). The history-edit caller at `app/(app)/history/[id].tsx:310-352` continues to mount `<ExerciseBlock>` byte-identically. Per Conductor's hard constraint #3.

- **MAJ-1 (v2 shim collides with `useUpdateSet`'s onSuccess invalidation)**: closed. The sync `setQueryData` shim is dropped entirely. The manual-commit path (blur → commit → mutate → invalidate) is byte-identical to today. Per Conductor's hard constraint #2.

- **MAJ-2 (v2 shim clears unrelated fields synchronously on partial commit)**: closed. Same fix as MAJ-1 — no shim means no sync clear of unrelated fields. Today's deferred-clear semantics preserved.

- **MIN-1 / MIN-2 / MIN-3 / MIN-4 / MIN-5**: all carried over from v1 validation. E9 lbs case in the E2E plan. `previousSet?: SetRow | null` typing preserved. Previous-zero cases 6/7/8 in the unit test plan. Lift-to-screen rejection rationale pinned. `["stats"]` over-invalidation flagged as future optimization.

- **MIN-5 (v2: uncheck → re-check regression assertion)**: addressed in E7. After auto-fill fires on first check, the row has weight + reps committed. Uncheck does not clear them (uncheck = flip `completed_at` only, per `checkSet`/`uncheckSet` semantics). Re-check sees the row already filled → predicate returns null → no spurious second auto-fill.

- **MIN-2 (v2: file-edit collapses if BLK-1 fix is taken — no shim)**: confirmed. v3 has no shim; the file-edit count drops accordingly. `exercise-block.tsx` change is the single prop-signature widening + the thunk update.

## Confidence and risk

- **Confidence: HIGH** that the callback-args path closes BLK-1 architecturally. Synchronous JS function arguments flow on the same call stack — there is no async window between `<SetInput>.onPress` reading local state and the screen handler receiving those strings. Verified by reading the existing `onToggleChecked?.(!isChecked)` pattern at `set-input.tsx:115`; widening the arg signature is a one-line change.
- **Confidence: HIGH** that BLK-2 closes by removing the `sessionId` prop entirely. Re-read the history-edit caller; no `showCheckable` / `onToggleSetChecked`; no other field references `sessionId` on `<ExerciseBlock>`.
- **Confidence: HIGH** that the helper's predicate matches the Conductor's exact spec. Tested by inspection of the 8 brief cases plus retained edge cases.
- **Confidence: MEDIUM** on E9's exact lbs string (`"264.6"`). `kgToLbs(120) = 264.5544` per the 2.20462 conversion constant; `(264.5544).toFixed(1) === "264.6"`. The Tester pins to reality on first run if the conversion constant differs.
- **Risk: LOW** for data integrity. No schema/RLS change. Partial-spread `updateSet` invariant intact. No optimistic cache shim. Write order eliminates the F10 "checked-but-null" window on auto-fill.
- **Risk: LOW** for UX regression. Manual-commit path byte-identical to today. Rest-timer reorder shifts by ~one round-trip only on the auto-fill path. Mid-typing race architecturally closed by reading from local state.
- **Risk: LOW** for platform divergence. Pure JS callback flow. `Keyboard.dismiss()` is optional polish only.
- **Risk: LOW** for test churn. Existing `rest-timer-auto-start.spec.ts` seeds positive values → predicate returns null → no extra await → timer fires identically. Existing `api-sets.updateSet.test.ts` is the contract pin; auto-fill is just another caller. E2E selectors stay `getByLabel("Mark set as completed")`.
