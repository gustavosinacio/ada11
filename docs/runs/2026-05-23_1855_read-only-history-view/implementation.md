# Implementation — 2026-05-23_1855_read-only-history-view

Based on: `design-v2.md` (final approved) and `validation-v2.md` (matching `go`, with NEW-MIN-1 hand-off).

## Files changed

### New
- `src/components/read-only-set-row.tsx` (new) — static counterpart of `<SetInput>`. Same column widths and tint behavior; no `<TextInput>`, no per-row trash, no "Open set details" Pressable. Consumes `presentReadOnlySetRow` from `~/utils/set-display`.
- `src/components/read-only-exercise-block.tsx` (new) — static counterpart of `<ExerciseBlock>`. Same header layout (name + `(deleted)` suffix preserved, muscles/equipment line) and same column-header strip widths. Drops reorder/trash/`VolumeTargetSlot`/`useLastWorkingSet` and the entire add-set footer. Renders italic "No sets logged for this exercise." when `sets.length === 0`.
- `src/utils/set-display.ts` (new) — pure presentation helpers (`displayWeight`, `displayReps`, `presentReadOnlySetRow`, `presentReadOnlyExerciseBlock`, `READ_ONLY_BLOCK_EMPTY_TEXT`). Lifted out so the two new components have a unit-testable contract under vitest (which is configured for `.test.ts` only — no JSX renderer in this repo).
- `tests/unit/read-only-history-display.test.ts` (new) — 23 contract tests covering: kg/lbs rendering of the weight cell, em-dash on null/non-finite, reps cell formatting, set-type badge label, RPE/notes visibility flags (hidden when null/blank), check-tint flag from `completed_at`, exercise header subline shapes, `(deleted)` suffix flag, empty-block italic copy pinned to `READ_ONLY_BLOCK_EMPTY_TEXT`.
- `tests/e2e/read-only-history.spec.ts` (new) — 5 Playwright specs:
  1. Default render: zero `<TextInput>` (`input[inputmode="decimal"|"numeric"]` count = 0), zero `Delete set` / `Open set details`, no `+ Working set` / `Add exercise` / `Delete workout`, no `Workout` placeholder, Pencil count = 1, "Edit start and end times" count = 1.
  2. Tap Pencil → header swaps to "Done" (`Exit edit mode` count = 1, `Edit workout` count = 0), all editable affordances appear (counts match the 2 seeded sets), time-edit pencil still present.
  3. Tap "Done" → revert to read-only + Pencil; affordances gone again.
  4. MAJ-2 regression guard: enter Edit, fill reps `<TextInput>` with "12" without manually blurring, tap "Done", re-enter Edit, assert `toHaveValue("12")` — proves `Keyboard.dismiss()` blurs the focused input so `<SetInput>`'s `onBlur=commit` dispatches the `useUpdateSet.mutateAsync` before unmount.
  5. Per-screen scope: enabling Edit unlocks both seeded blocks at once (input counts = 2 for both weight and reps).

### Edited
- `app/(app)/history/[id].tsx` (edited) — per design-v2 §"Mudanças por arquivo" + NEW-MIN-1 correction. Specifically:
  - Imports diff: `Pencil` from `lucide-react-native`; `Keyboard` + `useColorScheme` from `react-native`; `ReadOnlyExerciseBlock` from `~/components/read-only-exercise-block`.
  - Added `const [isEditing, setIsEditing] = useState(false)` + `const colorScheme = useColorScheme()`.
  - Lifted `Stack.Screen` config into a single `const screenOptions = {...} as const` reused by the loading, error, and happy-path branches.
  - Header right slot: dynamic `headerRight: () => …` rendering a `Pencil` (`accessibilityLabel="Edit workout"`) in read-only and a "Done" `<Text>` (`accessibilityLabel="Exit edit mode"`) in edit. The "Done" `onPress` runs `Keyboard.dismiss()` → `setPickerOpen(false)` → `setIsEditing(false)`, in that order.
  - Session-name `<TextInput>` block now mount-gated by `{isEditing ? … : <Text>{headerTitle}</Text>}`.
  - Per-exercise mapping now switches between `<ExerciseBlock>` (edit) and `<ReadOnlyExerciseBlock>` (read-only). All four mutation handlers (`onAddSet`/`onUpdateSet`/`onUpdateSetMeta`/`onDeleteSet`) only mount inside the `<ExerciseBlock>` branch.
  - Bottom action block ("+ Add exercise" + "Delete workout") is wrapped in `{isEditing ? … : null}`.
  - `<ExercisePicker>` modal is mount-gated by `{isEditing ? <ExercisePicker .../> : null}` (MIN-3 fix).
  - `<SessionTimesEditor>` left untouched — renders identically in both modes. Its tap-to-reveal pencil (`accessibilityLabel="Edit start and end times"`) is independent of the new toggle.

## Deviations from design

- **NEW-MIN-1 title chain (validator hand-off, applied).** Design-v2:147 illustrated the title with `session.data?.name?.trim() || "Workout" || "Session"`. That short-circuit always lands on the name or `"Workout"` and never reaches `"Session"`. Implemented as the explicit ternary recommended by the validator and by design-v2:185 itself:
  ```ts
  const headerTitle = session.data?.name?.trim()
    ? session.data.name.trim()
    : session.data
      ? "Workout"
      : "Session";
  ```
  This preserves the pre-refactor labels at `history/[id].tsx:158, 167` (loading/error show `"Session"`; happy-path shows the resolved name or `"Workout"`).
- **Pure-helper module split (`src/utils/set-display.ts`).** The design's contract for `<ReadOnlySetRow>` mentioned `displayWeight` as either inline or in a util module — "implementer's call". Chose the util module **plus** exposed two thin presentation helpers (`presentReadOnlySetRow`, `presentReadOnlyExerciseBlock`) so the unit tests can verify the per-cell contract deterministically without a React renderer (vitest config restricts to `.test.ts`). The components now consume these helpers directly, so the unit-tested contract is also the runtime contract — no parallel logic to drift.
- **Empty-block copy pinned via `READ_ONLY_BLOCK_EMPTY_TEXT`.** Exported constant lets the unit test assert against the same string the JSX renders. Functionally identical to the design's literal string at design-v2:130.

No other deviations from design.

## Soft callbacks made (during this implementation pass)

- None.

## Quality gates

- [x] `npm run typecheck` passed (no errors).
- [x] `npm run lint` passed (0 errors, only the pre-existing 1 warning in the generated `router.d.ts` — unchanged from baseline).
- [x] Relevant unit tests pass — `npm run test:unit` → `18 test files, 307 tests passed`; new `read-only-history-display.test.ts` contributes 23 of them.
- [x] e2e syntax-check — `npx playwright test tests/e2e/read-only-history.spec.ts --list` discovered all 5 specs cleanly (`errors: []`, `skipped: 5`). Standalone `tsc --noEmit` on the spec file: no errors.
- [x] No new `any` types in touched files.
- [x] No new `// @ts-ignore`.
- [x] No stray `console.log` (`grep -nE 'console\.log|: any|// @ts-ignore'` across all touched files returns no matches).

## Notes for Reviewer / Tester

- **Six mutation hooks structurally gated.** `useLogSet`/`useUpdateSet`/`useUpdateSetMeta`/`useDeleteSet`/`useUpdateSessionName`/`useSoftDeleteSession` are still declared at the top of the screen (TanStack mounts subscriptions on the hook call, so the cache key participation is identical to before). What changed is which JSX mounts the handlers: in read-only mode the only paths that could invoke any of them — set-row inputs, trash icons, the "+ Working set" footer, the session-name `<TextInput>`, the Delete-workout button — are not rendered. `useUpdateSessionTimes` remains independent: the time-edit pencil flow is the same in both modes.
- **`useLastWorkingSet` win (MIN-2).** `<ReadOnlyExerciseBlock>` does NOT call `useLastWorkingSet(exercise.id)`. For a session with N exercises this is N fewer cross-session subscriptions while in read-only mode (which is the new default).
- **Pencil on loading / error branches (MIN-4 tradeoff).** The single `screenOptions` const means the Pencil is visible during loading and error states too. Tapping it during loading flips `isEditing=true`; with `session.data` still undefined the screen renders the spinner. Documented as a deliberate consistency tradeoff matching the measurements precedent (`measurements/[id]/index.tsx:140-156`).
- **`<ExercisePicker>` mount-gated (MIN-3).** Its internal `useExercises()` subscription is not created until the user opts into Edit mode. The picker mount also unmounts cleanly because the "Done" handler calls `setPickerOpen(false)` before `setIsEditing(false)`.
- **Reviewer please double-check the `<SessionTimesEditor>` block is unchanged** — its accessibility label is still `"Edit start and end times"` (verified by reading `src/components/session-times-editor.tsx:119`); the e2e spec asserts count = 1 in both modes.
- **Tester: `tests/e2e/remove-exercise.spec.ts:174–186`, `tests/e2e/soft-deleted-exercises-in-history.spec.ts:193–309`, `tests/e2e/volume-target.spec.ts:579–601`, `tests/e2e/crud.spec.ts:215–393`** should all continue to pass because:
  - The first three only assert non-presence of editable affordances on history detail (which is now even more non-present in read-only mode), or assert presence of static text/blocks (preserved by `<ReadOnlyExerciseBlock>`).
  - The fourth uses the time-edit pencil only (label `"Edit start and end times"`), which is independent of the new toggle.
  - None of them tap Pencil/Done on the new body toggle.
- **Per-row RPE display.** The read-only row shows the persisted `row.rpe` string verbatim inside a small blue chip if present (otherwise the chip is omitted). The notes glyph (`StickyNote`) appears if `row.notes?.trim().length > 0`. Both are static — no Pressable wrapper around either, matching the design contract.
- **Edited values across the Edit→Done→Edit cycle** are preserved by the pre-existing `onBlur=commit` path in `<SetInput>` (`set-input.tsx:140, 153`); MAJ-2's `Keyboard.dismiss()` makes the Done-tap-during-focus case work too. The new e2e spec (4) is the regression guard for this.
