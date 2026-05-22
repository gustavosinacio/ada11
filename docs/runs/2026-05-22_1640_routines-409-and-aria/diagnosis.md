# Diagnosis — 2026-05-22_1640_routines-409-and-aria

## Hypothesis (stated before code investigation)

Bug 1 is the same shape as the F6 add-set double-tap we already fixed (`docs/runs/2026-05-22_1000_set-row-declutter/`): two Pressable taps land before the mutation's `isPending` flips, both call `mutateAsync`, both compute the same `MAX(position) + 1`, DB unique constraint rejects the second. UI debounce + (already-good) DB constraint.

Bug 2 is a RN-Web modal/focus interaction. The Edit button in `<RoutineListItem>` retains focus across the navigation from Workout tab to `/routines/{id}` because Expo Router web keeps prior screens with `display:none` (the focus owner stays in the DOM). When the picker modal opens on the destination screen, RN-Web's modal layout puts `aria-hidden="true"` on the backdrop — but the focus is still on a button in an `aria-hidden` subtree.

## Evidence

### Source-of-truth files (verified)

- `app/(app)/routines/[id]/index.tsx:262-274` — `<ExercisePicker visible={pickerOpen} onPick={async (ex) => { setPickerOpen(false); try { await addEx.mutateAsync({...}); } catch {...} }} />`. The `setPickerOpen(false)` is queued (React batches state updates); the `await` doesn't block subsequent taps because the Pressable in the child component is still rendered at tap time.
- `src/components/exercise-picker.tsx:93-105` — `<Pressable onPress={() => { if (already) return; onPick(item); }} disabled={already}>`. **The `disabled` only guards against re-picking an already-added exercise. There's no guard against in-flight mutation.**
- `src/api/routine-exercises.ts:18-46` — `addRoutineExercise` does `SELECT MAX(position) FROM routine_exercises WHERE routine_id=...` then `INSERT { position: max + 1 }`. Two concurrent calls both see the same `max` → both insert with the same `position` → DB unique index `routine_exercises_routine_position_uq` rejects the second.
- `src/db/schema.ts:100` — confirmed unique index on `(routine_id, position)`. The DB-side constraint is already correct; the UI just needs to not produce the race.
- `src/components/routine-list-item.tsx` — the Edit button is a `<Pressable>` with `accessibilityRole="button"`, `accessibilityLabel="Edit routine: {name}"`. RN-Web renders this as a `<button>` element which is focusable by default. After tap, focus stays on it until JS blurs it.

### Candidate locations affected by the same root cause

| File:Line | Token / pattern | Context | Severity |
|---|---|---|---|
| `src/components/exercise-picker.tsx:93-105` | `Pressable.onPress → onPick(item)` | No in-flight guard | major (409 spam) |
| `app/(app)/routines/[id]/index.tsx:262-274` | `onPick={async (ex) => { setPickerOpen(false); await addEx.mutateAsync(...) }}` | Modal close-then-await pattern. Even with picker-side guard, two RAPID taps before the close commits both fire. | major (root cause caller-side) |
| `src/components/exercise-picker.tsx` (modal mount) | RN-Web Modal applies `aria-hidden` to backdrop ancestors | If something outside the modal has focus, it ends up in an `aria-hidden` subtree | major (a11y warning) |

## Root cause

**Bug 1**: race condition. UI doesn't guard `onPick` against re-entry while the mutation is in flight. The pattern matches F6 add-set; the fix shape matches.

**Bug 2**: focus management on cross-screen navigation. Expo Router web keeps prior screens in the DOM, preserving focus. When a modal opens on the current screen, the picker's parent gets `aria-hidden` but the still-focused button on the prior screen is now inside an `aria-hidden` ancestor.

## Severity classification

- **Major (must fix this run)**:
  - `exercise-picker.tsx:97-105` — quick-tap race produces 1-4 `409`s and a console error toast.
  - aria-hidden warning — RN-Web accessibility warning visible in DevTools, real screen-reader users may experience the focus discontinuity.

## Symptom-only fix risk

Adding a UI guard on the picker IS the right level — the DB constraint is the data-integrity guard; the UI guard is the UX guard. Both layers needed for defense in depth. The aria-hidden fix needs to either (a) blur active element when the modal opens, or (b) `inert` ancestor instead of `aria-hidden`. RN-Web doesn't support `inert` directly; explicit blur on modal-open is the practical fix.
