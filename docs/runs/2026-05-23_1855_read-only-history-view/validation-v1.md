# Validation v1 — 2026-05-23_1855_read-only-history-view

Round: Design↔Validate round 1 of ≤3.
Reviewing: `design-v1.md`.

## Verification (12 Conductor checks)

| # | Item | Verdict |
|---|---|---|
| 1 | Mutation hooks declared but JSX-gated | VERIFIED. 6 hooks at `app/(app)/history/[id].tsx:49-55`; only fire on user action. When `isEditing=false`, no JSX path can dispatch. |
| 2 | `<ReadOnlySetRow>` shape avoids cache-invalidating hooks | VERIFIED. Props `row`, `unit` only; only at-risk piece is the pure `inputStringFromKg` utility (no hook). |
| 3 | Dynamic `headerRight` precedent | VERIFIED. `headerRight: () =>` function form used at `app/(app)/measurements/index.tsx:31`, `measurements/[id]/index.tsx:145`, `exercises/[id]/progress.tsx:53`. Re-evaluates per render. |
| 4 | `accessibilityLabel` collisions | NO COLLISION on `"Edit workout"` / `"Exit edit mode"`. Note: `accessibilityLabel="Done"` exists on verdict screen — different surface, safe. |
| 5 | `isEditing` state lost on navigation | VERIFIED. No `useFocusEffect`, no URL param, no AsyncStorage. State truly local; screen unmount resets. |
| 6 | In-progress redirect before render path | PARTIALLY INCORRECT. Redirect is inside a `useEffect` (`history/[id].tsx:70-74`) — fires AFTER first commit. Default `isEditing=false` means brief flash is read-only/non-interactive → user-visible impact minimal. **MIN-1**. |
| 7 | Time-edit pencil interplay | VERIFIED. `<SessionTimesEditor>` at lines 203-219 OUTSIDE proposed gate. Label `"Edit start and end times"` (at `session-times-editor.tsx:119`) is distinct from `"Edit workout"`. |
| 8 | `remove-exercise.spec.ts` and other existing specs | VERIFIED. All four existing specs hold: `remove-exercise.spec.ts:174-186` (trash count=0 history) passes both modes since history never passes `onRemove`; `crud.spec.ts:215-393` (time edit pencil) independent of body toggle; `soft-deleted-exercises-in-history.spec.ts` preserved by ReadOnlyExerciseBlock's "(deleted)" suffix render; `volume-target.spec.ts:579-601` preserved since ReadOnlyExerciseBlock doesn't mount `<VolumeTargetSlot>`. |
| 9 | Visual delta enumeration completeness | MOSTLY COMPLETE. Omission: `useLastWorkingSet(exercise.id)` per exercise (`exercise-block.tsx:100`) — cross-session fetch for placeholder text not needed in read-only. Read-only tree avoids N fetches when workout has N exercises. **MIN-2**. |
| 10 | Existence of `Add exercise` / `Delete workout` / session-name input | VERIFIED. Add Exercise at 289-298, Delete Workout at 301-306, session-name TextInput at 186-194. Gating non-disruptive elsewhere. |
| 11 | State preservation Edit→Done→Edit with unblurred typing | NEW FAILURE MODE. Pre-feature data-loss path required navigating away. Post-feature, tapping "Done" unmounts `<SetInput>` before `onBlur` fires → keystroke lost. **MAJ-2**. |
| 12 | Empty-exercise (zero sets) reachability | REACHABLE via `addedExerciseIds` after exiting Edit with no sets logged. Transient state but not dead code. OK. |

## Findings

### Blockers
None.

### Majors

- **MAJ-1 — Factually wrong accessibility label cited in design.** Design at lines 238 and 253 references `"Edit workout times"`. The actual label at `src/components/session-times-editor.tsx:119` is **`"Edit start and end times"`** (confirmed in `tests/e2e/crud.spec.ts:253, 349, 374`). Tester would build a wrong selector. **Fix**: replace `"Edit workout times"` with `"Edit start and end times"` in design.

- **MAJ-2 — Done-button-induces-data-loss is a new failure mode.** Pre-feature, the user could lose unblurred keystrokes only by navigating away (rare). Post-feature, tapping "Done" while a `<TextInput>` is focused unmounts `<SetInput>` before `onBlur` fires → keystroke lost. RN's `Pressable` does not consistently blur the focused input across iOS/Android/web. Design acknowledges the pre-existing variant (lines 254-255) but doesn't address the new variant. **Fix**: in the "Done" handler, call `Keyboard.dismiss()` (from `react-native`) BEFORE flipping `setIsEditing(false)`. One-line change.

### Minors

- **MIN-1 — In-progress redirect is post-render, not pre-render.** Design at line 198 overstates the guarantee. The redirect is in a `useEffect` (post first commit). Since default is read-only, no editable affordance is visible during the brief flash. **Fix**: soften the prose.

- **MIN-2 — `useLastWorkingSet` is a hidden read-only perf win that's not enumerated.** N cross-session fetches avoided when workout has N exercises. **Fix**: add to performance section.

- **MIN-3 — `<ExercisePicker>` modal stays mounted at all times.** Functionally fine (`visible={false}` blocks interaction). Gating the mount itself behind `isEditing` would be a tiny cleanup, not required.

- **MIN-4 — Loading and error variants of the screen render `Stack.Screen` without the Pencil.** Inconsistent with measurements precedent which uses the same header everywhere. **Fix**: lift the `Stack.Screen` config into a const and reuse across branches.

- **MIN-5 — `<SetRowMenu>` open + tap Done = lost RPE/notes draft.** Acknowledged at line 255 but worth a single sentence in the "what gets unmounted on Done" list.

- **MIN-6 — Pencil color uses `colorScheme === "dark" ? "#fff" : "#000"`.** Matches measurements/exercise-progress precedent. The Implementer also needs to import `useColorScheme` from `"react-native"`. Not flagged in the snippet.

## Decision

**no-go** — 0 blockers, 2 majors.

Both fixes are quick. Round 1 retread, not re-architecture.

### Recommendation

Invoke Designer for v2 with the following targeted fixes:
1. Replace `"Edit workout times"` with `"Edit start and end times"` in design.
2. Add `Keyboard.dismiss()` inside the "Done" Pressable's `onPress`, BEFORE `setIsEditing(false)`. Document the rationale.
3. Soften the in-progress redirect prose (MIN-1).
4. Optionally address MIN-2 + MIN-4 — clean-up.

Counts: blockers=0, majors=2, minors=6.

Round 1 of ≤3 — 2 D↔V rounds remaining.
