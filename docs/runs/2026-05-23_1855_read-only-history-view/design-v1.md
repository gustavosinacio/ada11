# Design v1 — 2026-05-23_1855_read-only-history-view

## Goal (1 sentence)
Make the history detail screen render the workout body as static, non-interactive content by default, and add a header pencil that flips a screen-level `isEditing` flag, swapping in the existing fully-editable `<ExerciseBlock>` (with all its mutation hooks) only when the user explicitly opts in.

## Approach
The history detail screen (`app/(app)/history/[id].tsx`) currently mounts the same `<ExerciseBlock>` + `<SetInput>` primitives the live workout uses, so every set field is editable and every trash icon is live. We keep those primitives untouched for the editable case and introduce a parallel, structurally distinct read-only component family — `<ReadOnlyExerciseBlock>` + `<ReadOnlySetRow>` — that renders the same data as static `<Text>` rows with no mutation handlers wired up. A screen-level `isEditing: boolean` (default `false`) flips between the two trees and decides whether the mutation hooks even need to be called: callbacks remain wired in the JSX, but the editable tree only mounts when `isEditing === true`, so the rows in the read-only tree literally cannot dispatch a mutation. The header pencil (`Stack.Screen.headerRight`, mirroring the measurements/exercise-progress precedent) toggles the flag — Pencil while read-only, "Done" while editing. The session-name input, the "Add exercise" / "Delete workout" affordances, and the per-exercise name → progress link all also gate on `isEditing` so the entire body presents as a static summary unless the user opts in. The time-edit pencil (`<SessionTimesEditor>`) stays exactly as today, independent of this toggle, per the prompt.

The choice of "new component" over "boolean prop on `<ExerciseBlock>`" is driven by the prompt's explicit wording ("The read-only view should be a new component") and by code-clarity: threading a `readOnly` prop through `<ExerciseBlock>` and `<SetInput>` would add `if (readOnly) ... else ...` branches in ~10 places (header actions, column-header spacers, every input, the menu trigger, the trash button, the footer's add buttons) and leave the live workout's prop surface confusing for a feature it doesn't use. A sibling component keeps both surfaces simple to read.

## Mudanças por arquivo

| File | Type | Change |
|---|---|---|
| `src/components/read-only-set-row.tsx` | new | New static row that renders one set as text-only (weight + reps + RPE badge + notes preview + set-type badge + set number + checkmark state), no `<TextInput>`, no trash, no menu trigger. Mirrors `<SetInput>` visual structure but with `<Text>` in place of inputs. |
| `src/components/read-only-exercise-block.tsx` | new | New static block wrapping a list of `<ReadOnlySetRow>` rows. Renders the exercise header (name + muscles/equipment, with optional `onPressName` for the progress-link), the same column-header strip, and an empty-state line when `sets.length === 0`. No "+ Working set" footer, no chevron menu, no reorder handles, no trash. |
| `app/(app)/history/[id].tsx` | edited | Add `isEditing` state (default `false`). Wire `Stack.Screen.headerRight` to a Pencil when read-only and to a "Done" button when editing. Gate the session-name `<TextInput>`, the "Add exercise" Pressable, and the "Delete workout" Button behind `isEditing`. Conditionally render `<ReadOnlyExerciseBlock>` vs `<ExerciseBlock>` per exercise depending on `isEditing`. The session-name renders as a static `<Text>` headline when read-only. The mutation-hook calls (`useLogSet`, `useUpdateSet`, `useUpdateSetMeta`, `useDeleteSet`, `useUpdateSessionName`, `useSoftDeleteSession`) stay declared at the top but their handlers are only wired into JSX inside the `isEditing` branch. `useUpdateSessionTimes` and `<SessionTimesEditor>` remain untouched. |

No changes to: `src/components/exercise-block.tsx`, `src/components/set-input.tsx`, `src/components/set-row-menu.tsx`, `src/components/session-times-editor.tsx`, the live workout screen, any hook, any migration, any test (existing tests stay green; new tests are the Tester's job).

## Contratos de I/O

### New: `<ReadOnlySetRow>` props

```ts
type ReadOnlySetRowProps = {
  row: SetRow;
  unit: WeightUnit;
};
```

Render contract:
- Same visual row structure as `<SetInput>`: `flex-row items-center gap-2 px-4 py-2`, `border-b border-gray-100 dark:border-gray-900`.
- Leading set-type badge (`TYPE_BADGE[row.set_type]`) — kept identical to `<SetInput>` so visual continuity is preserved when the user flips into edit mode.
- Set-number column (`row.set_number`) — identical.
- Weight column: `<Text>` displaying `inputStringFromKg(row.weight, unit)` if `row.weight != null`, else an em dash (`—`). No border, no input chrome.
- Reps column: `<Text>` showing `row.reps?.toString() ?? "—"`. No border, no input chrome.
- A static RPE/notes affordance in the slot currently occupied by `<SetInput>`'s `MoreHorizontal` menu trigger: if `row.rpe != null` show a small "RPE {n}" chip; if `row.notes?.trim().length > 0` show a notes icon (lucide `StickyNote`, gray-500) — both purely visual, neither is a `<Pressable>`. Use the same 44pt-wide slot to preserve column alignment with `<SetInput>`.
- Trash slot: empty `<View className="w-7" />` spacer (same width as `<SetInput>`'s trash button), so toggling into edit mode doesn't visually reflow the row.
- Check state: if `row.completed_at != null`, apply the same `bg-green-50 dark:bg-green-950/30` tint that `<SetInput>` uses when checked — the historical record carries this state. No actual check icon (history detail does not pass `showCheckable` in the live tree either, so this stays consistent). If we want a visual reminder a set was marked done, render a tiny check glyph (lucide `Check`, green-600, no `<Pressable>` wrapper) at the head of the row in place of the 44pt check-button slot — only when `row.completed_at != null`. Otherwise, no leading element.

Helper `inputStringFromKg` is currently private to `set-input.tsx`. To avoid duplication, lift it to a small utility module:

```ts
// src/utils/set-display.ts (new file, optional — see Alternatives)
export function displayWeight(kgStr: string | null, unit: WeightUnit): string {
  if (!kgStr) return "—";
  const kg = parseFloat(kgStr);
  if (!Number.isFinite(kg)) return "—";
  const v = unit === "kg" ? kg : kgToLbs(kg);
  return Number.isInteger(v) ? v.toString() : v.toFixed(1);
}
```

If the implementer prefers to keep the helper module count low, inlining the same logic in `read-only-set-row.tsx` is acceptable — the function is 4 lines.

### New: `<ReadOnlyExerciseBlock>` props

```ts
type ReadOnlyExerciseBlockProps = {
  exercise: ExerciseRow;
  sets: SetRow[];
  unit: WeightUnit;
  /** When provided, the exercise name is wrapped in a `<Pressable>` (same
   *  behavior as `<ExerciseBlock>.onPressName`). Optional. */
  onPressName?: () => void;
};
```

Render contract:
- Outer wrapper className identical to `<ExerciseBlock>`: `border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-black`.
- Header row identical to `<ExerciseBlock>`'s header (lines 128–164 of `exercise-block.tsx`) — name + optional `(deleted)` suffix + muscles/equipment line. Same `onPressName` handling. **No** reorder chevrons, **no** trash. Right-side action area is omitted entirely (no spacer needed; the header layout collapses cleanly).
- Column-header strip (lines 211–228 of `exercise-block.tsx`) shown only when `sets.length > 0`. Same labels: `#`, `Weight ({unit})`, `Reps`. Two trailing spacers (44pt for menu, 28pt for trash) to keep column alignment consistent with the editable tree.
- `sets.map((s) => <ReadOnlySetRow ... />)`.
- Empty state when `sets.length === 0`: a single line `<Text className="px-4 py-3 text-sm italic text-gray-500">No sets logged for this exercise.</Text>`. This case is reachable today via `addedExerciseIds` (a user opens edit mode, picks an exercise, adds no sets, exits, re-opens later → that exercise is in `orderedExercises` with zero sets). In the read-only baseline (before this run), the same case would be a zero-row `<ExerciseBlock>` with an open "+ Working set" footer. In v1, after this feature, that exercise shows as the static empty-state line above. Acceptable — re-entering Edit mode brings the editable block back and lets the user add or remove it.
- **No** footer ("+ Working set", chevron menu, "+ Warm-up", "+ Drop set").

### Edited: `app/(app)/history/[id].tsx`

New state:
```ts
const [isEditing, setIsEditing] = useState(false);
```

New header configuration (replaces lines 181 and 158/167 simplification):
```ts
<Stack.Screen
  options={{
    title: headerTitle,
    headerShown: true,
    headerRight: () =>
      isEditing ? (
        <Pressable
          onPress={() => setIsEditing(false)}
          accessibilityLabel="Exit edit mode"
          accessibilityRole="button"
          className="px-3 py-1"
        >
          <Text className="text-base font-medium text-blue-500">Done</Text>
        </Pressable>
      ) : (
        <Pressable
          onPress={() => setIsEditing(true)}
          accessibilityLabel="Edit workout"
          accessibilityRole="button"
          className="px-3 py-1"
        >
          <Pencil color={colorScheme === "dark" ? "#fff" : "#000"} size={20} />
        </Pressable>
      ),
  }}
/>
```

`Pencil` from `lucide-react-native`, `useColorScheme` from `react-native`. Both already imported elsewhere in the codebase using the same shape.

Per-exercise render switches:
```tsx
isEditing ? (
  <ExerciseBlock
    key={ex.id}
    exercise={ex}
    sets={setsByExercise.get(ex.id) ?? []}
    unit={unit}
    onPressName={() => router.push(`/(app)/exercises/${ex.id}/progress`)}
    onAddSet={...}
    onUpdateSet={...}
    onUpdateSetMeta={...}
    onDeleteSet={...}
  />
) : (
  <ReadOnlyExerciseBlock
    key={ex.id}
    exercise={ex}
    sets={setsByExercise.get(ex.id) ?? []}
    unit={unit}
    onPressName={() => router.push(`/(app)/exercises/${ex.id}/progress`)}
  />
)
```

Session-name swap (replaces lines 184–201):
```tsx
{isEditing ? (
  <>
    <Text className="mb-1 text-xs uppercase text-gray-500">Name</Text>
    <TextInput
      value={nameDraft}
      onChangeText={setNameDraft}
      onBlur={commitName}
      onSubmitEditing={commitName}
      placeholder="Workout"
      placeholderTextColor="#9ca3af"
      className="rounded-md border border-gray-300 px-3 py-2 text-lg font-semibold text-black dark:border-gray-700 dark:text-white"
    />
    {updateName.isError ? <Text ...>...</Text> : null}
  </>
) : (
  <Text className="text-lg font-semibold text-black dark:text-white">
    {headerTitle}
  </Text>
)}
```

Bottom-action gating (lines 288–308):
```tsx
{isEditing ? (
  <View className="mt-4 gap-3 px-4">
    <Pressable onPress={() => setPickerOpen(true)} ...>Add exercise</Pressable>
    <View className="mt-6 border-t ..."><Button label="Delete workout" ... /></View>
  </View>
) : null}
```

`<ExercisePicker>` modal stays mounted (it controls visibility via `visible={pickerOpen}`); when read-only, `pickerOpen` simply never flips to true because the trigger is hidden.

Auto-exit on session change: not required for v1. `isEditing` is local to the screen instance; navigating away unmounts the screen; the next mount re-enters read-only. This satisfies the Conductor's auto-exit-on-blur requirement without explicit `useFocusEffect` handling, because expo-router unmounts unconditionally on stack pop in this surface (history detail is pushed from `/history/index.tsx` and from `/history/week/[isoWeek].tsx`, both pop on back).

## Mutation gating — the 6 hooks that must NOT fire in read-only

| Hook | File | Currently invoked from | After this change |
|---|---|---|---|
| `useLogSet` | `src/hooks/use-sets.ts:44` | `onAddSet` on `<ExerciseBlock>` | Only callable through the editable tree (mounted iff `isEditing===true`). |
| `useUpdateSet` | `src/hooks/use-sets.ts:65` | `<SetInput>` `onCommit` | Same. `<ReadOnlySetRow>` has no `<TextInput>`, so no `onBlur=commit` path exists. |
| `useUpdateSetMeta` | `src/hooks/use-sets.ts:88` | `<SetInput>` `onUpdateMeta` via `<SetRowMenu>` | Same. `<ReadOnlySetRow>` does not mount `<SetRowMenu>`. |
| `useDeleteSet` | `src/hooks/use-sets.ts:101` | `<SetInput>` trash Pressable | Same. `<ReadOnlySetRow>` has no trash Pressable. |
| `useUpdateSessionName` | `src/hooks/use-sessions.ts:80` | `commitName` on the screen's name `<TextInput>` | Hook stays declared at the top; its callsite (`commitName`) is only reachable when the name `<TextInput>` is rendered, i.e. when `isEditing===true`. |
| `useSoftDeleteSession` | `src/hooks/use-sessions.ts:114` | `<Button label="Delete workout" />` | Button only mounts when `isEditing===true`. |

`useUpdateSessionTimes` is **not** in the gated list — the time-edit pencil keeps working regardless of `isEditing`, per the prompt.

`useCheckSet` / `useUncheckSet` / `useRemoveExerciseFromSession` (discovery.md:16) are not used on history today and continue to be unused after this change.

## What stays as-is

- **`<SessionTimesEditor>`**: lives at `app/(app)/history/[id].tsx:203–219`. Renders identically in both modes. Tap-to-reveal pencil flow is its own self-contained mechanism.
- **`<ExerciseBlock>`**, **`<SetInput>`**, **`<SetRowMenu>`**: zero changes. Reused verbatim for the `isEditing===true` branch.
- **In-progress redirect** (`history/[id].tsx:70–74`): unchanged. Read-only mode applies only to ended sessions because that redirect bounces in-progress sessions to `/workout/[id]` before any render path involving `isEditing`.
- **Per-exercise volume-target slot** (`VolumeTargetSlot`): already not passed on history (`showVolumeTarget` defaults to `false`), so it remains absent in both modes.
- **Live workout screen** (`app/(app)/workout/[sessionId].tsx`): zero changes. Continues to import and use `<ExerciseBlock>` unconditionally.
- **Per-exercise name → progress link**: kept in both modes (read-only sets a non-mutating `onPressName` that simply navigates). It is not a "mutation"; tapping it is a useful affordance even in read-only.

## Visual delta — read-only vs edit

| Element | Read-only (default) | Edit (after pencil tap) |
|---|---|---|
| Header right slot | Pencil icon (`accessibilityLabel="Edit workout"`) | "Done" text button (`accessibilityLabel="Exit edit mode"`) |
| Session-name | Static `<Text className="text-lg font-semibold ...">` showing the resolved title | `<TextInput>` with placeholder, `onBlur=commitName` |
| Per-set weight | `<Text>` displaying the formatted number, no border | `<TextInput keyboardType="decimal-pad">` with rounded border |
| Per-set reps | `<Text>`, no border | `<TextInput keyboardType="number-pad">` with rounded border |
| Set-type badge (`W` / `•` / `↓`) | Visible (identical) | Visible (identical) |
| Set number | Visible (identical) | Visible (identical) |
| Check state | Row tinted green when `row.completed_at != null`; small static check glyph in leading slot; no Pressable | Same tint via `<SetInput>` rules; **note**: history detail does not pass `showCheckable`, so editable mode here also has no check Pressable — only the tint persists. The new read-only mode adds a static check glyph that the editable mode does not show today; this is intentional so the read-only mode communicates "this set was marked done" without depending on row-tint alone |
| RPE / notes affordance | Static "RPE n" chip and/or notes glyph in the menu slot; no Pressable | `MoreHorizontal` Pressable that opens `<SetRowMenu>` |
| Trash icon | Hidden (spacer preserves column alignment) | Visible (`Trash2` red icon, calls `onDeleteSet`) |
| "+ Working set" / chevron / "+ Warm-up" / "+ Drop set" footer | Hidden entirely | Visible (whole `<View className="px-4 py-3">` block from `<ExerciseBlock>` lines 249–304) |
| Exercise reorder handles | Hidden (history never passed them; both modes match) | Hidden (history never passes them; both modes match) |
| Exercise trash | Hidden (history never passed `onRemove`; both modes match) | Hidden (same) |
| Block empty state (`sets.length === 0`) | Single line "No sets logged for this exercise." | Header + column strip + footer with "+ Working set" |
| Screen empty state (no exercises at all) | Existing "No sets logged in this session." line (lines 234–239) | Same line (kept unchanged) |
| "Add exercise" Pressable | Hidden | Visible |
| "Delete workout" Button | Hidden | Visible |
| Time-edit pencil (`<SessionTimesEditor>`) | Visible, fully functional | Visible, fully functional (same component, same flow) |
| `<ExercisePicker>` modal | Cannot be opened (trigger hidden) | Opens via "Add exercise" |

## Test surfaces — exact selectors

- Header pencil (read-only mode): `page.getByLabel("Edit workout")` — Pressable in `Stack.Screen.headerRight`.
- Header "Done" button (edit mode): `page.getByLabel("Exit edit mode")`.
- Trash icons in read-only mode: `page.getByLabel("Delete set")` → expect count 0.
- Per-row menu in read-only: `page.getByLabel("Open set details")` → expect count 0.
- "+ Working set" in read-only: `page.getByText("+ Working set")` → expect count 0.
- "Add exercise" in read-only: `page.getByText("Add exercise")` → expect count 0 (the bottom Pressable is gated).
- "Delete workout" in read-only: `page.getByText("Delete workout")` → expect count 0 (the Button is gated).
- Session-name `<TextInput>` in read-only: there should be no input whose value is the session name. Recommended assertion: `page.getByPlaceholder("Workout")` → expect count 0. After tapping `getByLabel("Edit workout")`, the same selector should resolve to 1.
- Weight/reps fields in read-only: assert that the weight/reps cells render as `<Text>` not `<TextInput>`. Practical Playwright selector: `page.locator('input[inputmode="decimal"]')` and `page.locator('input[inputmode="numeric"]')` (RN Web maps `keyboardType` to `inputmode` on the underlying `<input>`) — expect count 0 in read-only, > 0 in edit.
- After tapping pencil → fields editable: `getByLabel("Edit workout")` → click → assertions above flip.
- Time-edit pencil unaffected: `page.getByLabel("Edit workout times")` (existing label from `<SessionTimesEditor>`) remains present and clickable in both modes.

## Existing test compatibility

- `tests/e2e/remove-exercise.spec.ts:174–186` — asserts `getByLabel(/^Remove .* from workout$/)` count 0 on history detail. **Validates the new default.** Stays as-is. Read-only mode also has no Remove-exercise affordance (it was never wired); edit mode also doesn't add one (the history screen doesn't pass `onRemove` even when editing, by design).
- `tests/e2e/crud.spec.ts:215–393` — two history specs exercising the time-edit pencil only. The time-edit pencil renders identically in both modes; specs should pass without changes.
- `tests/e2e/soft-deleted-exercises-in-history.spec.ts:193–309` — asserts the block for a soft-deleted exercise renders with "(deleted)" suffix on history detail. `<ReadOnlyExerciseBlock>` keeps the same name-with-suffix rendering, so the spec passes. Confirm in implementation.
- `tests/e2e/volume-target.spec.ts:579–601` — asserts the per-exercise volume-target strip is absent on history. `<ReadOnlyExerciseBlock>` does not mount `<VolumeTargetSlot>`. Passes.
- Discovery confirmed there is **no** existing e2e spec that taps a history set to change a value, add a set, delete a set, or edit RPE/notes. No spec to update for "go through the Edit button first" — that path will be exercised by the new specs the Tester adds.

## Riscos

- **Data integrity**: no schema change, no migration, no new mutation. The risk is the inverse — a user types into an editable field and the route blurs before `onBlur=commit` fires. This was already a risk pre-feature (`<SetInput>` already commits on blur, not on each keystroke). Mitigation: `commit` runs on `onBlur` AND `onSubmitEditing`, so a soft-keyboard dismiss commits before a back-press. Edge case unchanged. **RLS unchanged** (no new query).
- **UX regressions on the live workout**: zero. `app/(app)/workout/[sessionId].tsx` still imports `<ExerciseBlock>` and `<SetInput>` directly, no `isEditing` boundary near it.
- **UX regression on routine detail**: zero. Routines do not render `<ExerciseBlock>` (they use their own routine-exercise UI).
- **UX regression on the time-edit pencil**: zero. `<SessionTimesEditor>` renders in both modes; it self-gates via tap-to-reveal. The two pencils on the screen (header body-edit + body time-edit) have distinct accessibility labels ("Edit workout" vs "Edit workout times"), so users can disambiguate.
- **UX regression — accidental data loss when route blurs**: a user enters edit mode, taps into the reps input, types `12`, taps back without blurring → the `<SetInput>` `useEffect` resets local state from props on next mount, and the keystroke is lost. This is **the existing behavior** of `<SetInput>` on live workout too. Not introduced by this feature.
- **State preservation when toggling**: open `<SetRowMenu>` while editing → tap "Done" while menu is open → `<SetInput>` unmounts (replaced by `<ReadOnlySetRow>`) → menu unmounts. Acceptable: the menu's submit-on-confirm flow doesn't depend on being mounted after submit. If the user has unsubmitted RPE changes, they're lost — but the menu uses an explicit "Save" button, so this requires the user to ignore the menu's footer and tap "Done" instead, a deliberate cancel.
- **Scroll position preservation when toggling**: the `<ScrollView>` is the parent of both trees; toggling `isEditing` rerenders children but the `<ScrollView>` keeps its scroll offset. Same-key blocks (`key={ex.id}`) help React preserve identity. Acceptable.
- **Platform divergence**: read-only `<Text>` cells render uniformly on iOS, Android, and web. The web concern is the RN-Web mapping of `keyboardType="decimal-pad"` to `inputmode="decimal"` on the underlying `<input>` — this is used in the test selectors above; verified pattern on existing inputs.
- **Performance**: the read-only tree mounts fewer interactive components than the editable tree (no `<SetRowMenu>` lazy-load, no `<TextInput>` instances). The toggle remounts the per-block tree; with ~10 exercises × ~5 sets typical, that's ~50 nodes — well under the budget that would justify memoization.
- **Bundle size**: zero new dependencies; `<Pencil>` and `<StickyNote>` are already imported from `lucide-react-native` elsewhere in the app.

## Alternativas descartadas

1. **`readOnly` boolean prop threaded through `<ExerciseBlock>` and `<SetInput>`** — would add `if (readOnly) <Text>else <TextInput>` branches in ~10 places (header actions, column-header spacers, each input, the menu trigger, the trash button, the footer's add buttons). Descartada because (a) prompt explicitly asks for "a new component", (b) it complicates the prop surface of `<ExerciseBlock>` for a behavior the live workout never uses, and (c) the conditional branching makes `<SetInput>` harder to read for a marginal LOC saving (~80 lines avoided in the new files, vs ~30 lines of `readOnly` checks added in the existing files plus the cognitive cost of every future reader having to follow the branches).

2. **Push a separate `/(app)/history/[id]/edit` route, mirroring the measurements pattern** — descartada because the prompt phrasing ("Edit button on the workout") implies in-place editing, and splitting the surface would force the time-edit pencil (which stays on the view route per prompt) to live on a different screen from the body-edit fields. Two routes also complicate scroll-position and expand-state preservation across the toggle.

3. **CSS-only `pointer-events: none` overlay on the editable tree** — descartada because (a) it leaves the `<TextInput>` elements focusable on web via keyboard tabbing, (b) RN doesn't honor `pointer-events: none` consistently across platforms, (c) the prompt asks for a structurally different component, not a visually-identical-but-non-interactive one, (d) it doesn't suppress mutation hook *instantiation*, only user-driven invocation — accessibility tools and tests would still see editable controls.

4. **`<TextInput editable={false}>` with disabled styling** — descartada because the inputs still look like inputs (visual ambiguity), the trash and "+ Working set" buttons would still need separate hiding logic, and it doesn't deliver the "a new component" the prompt asks for. Cheapest but worst-quality option.

5. **Per-block (per-exercise) Edit toggle instead of per-screen** — descartada because (a) the prompt says "Edit button on the workout" (singular workout), (b) per-block toggling creates the confusing question "which block am I currently editing?" and forces a per-block visual indicator, (c) one screen-level pencil matches the established header-pencil idiom in measurements/exercise-progress.

## Out of scope

- **Time-edit pencil** (`<SessionTimesEditor>`): stays exactly as-is. Two pencils on the screen is acceptable (header = body edit, body = times edit). Disambiguated by accessibility labels.
- **Live workout screen** (`app/(app)/workout/[sessionId].tsx`): no changes. Editability is correct there by design.
- **Routine detail screens**: do not use `<ExerciseBlock>`; nothing to change.
- **Per-block (per-exercise) scope toggle**: rejected (see Alternative 5).
- **Save / Cancel paired exit**: not needed — mutations auto-commit on blur today; a Cancel would have to undo committed mutations (complex, not implied by the prompt). Exit is "Done" (no-op state flip) or route blur.
- **"Unsaved changes" prompt**: not needed — there is no transactional boundary; the lossy case (typing without blurring) is identical to today's behavior on the live workout screen.
- **New mutation hooks, schema changes, RLS adjustments, telemetry**: none.
- **Changes to the in-progress redirect** (`history/[id].tsx:70–74`): unchanged.

## Confidence and risk

- **Confidence: HIGH.** All decision points anchored to read source: history screen (lines 36–324), `<ExerciseBlock>` (lines 1–307), `<SetInput>` (lines 1–202), measurements precedent (lines 134–157). Mutation hook list cross-checked against `use-sets.ts` and `use-sessions.ts`. Existing e2e specs verified to validate the new default (remove-exercise:174-186) or to be orthogonal (crud.spec time-edit; soft-deleted exercises; volume-target).
- **Risk: LOW.** Two new files, one edited file. No schema, no migration, no RLS, no API. No change to the live workout's mutation surface. Existing tests stay green (verified by reading them). The single "behavior change" is the new default — and it has explicit user opt-in. Worst credible failure mode: a user opens an old workout to fix a typo, taps the pencil, doesn't realize they have to tap "Done" to exit — they navigate away and the next visit returns to read-only. Cosmetic friction, no data loss.
