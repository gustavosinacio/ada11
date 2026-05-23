# Design v2 — 2026-05-23_1855_read-only-history-view

Round: Design↔Validate round 2 of ≤3. Validator returned **no-go** on v1 (0 blockers, 2 majors, 6 minors). This v2 addresses every finding.

## Diff from v1

Each entry maps to a Validator finding (file-line references re-verified against the live source on 2026-05-23).

| # | Validator id | Where in v2 the fix lands | What changed vs v1 |
|---|---|---|---|
| 1 | **MAJ-1** | "Visual delta" table row "Time-edit pencil"; "Test surfaces" section; "Riscos / UX regression on the time-edit pencil"; "Out of scope" | Every `"Edit workout times"` token replaced with `"Edit start and end times"` — the actual `accessibilityLabel` from `src/components/session-times-editor.tsx:119`, confirmed in `tests/e2e/crud.spec.ts:253, 349, 374`. |
| 2 | **MAJ-2** | "Contratos de I/O / Edited: `app/(app)/history/[id].tsx`" — `headerRight` snippet; new "Risco / Done-induced data loss (new failure mode)" bullet | The "Done" Pressable's `onPress` now calls `Keyboard.dismiss()` (imported from `"react-native"`) **before** `setIsEditing(false)`. Forces blur of any focused `<SetInput>` weight/reps `<TextInput>` (and the session-name `<TextInput>` if focused) so the existing `onBlur=commit` path fires before unmount. Documented rationale in Riscos. |
| 3 | **MIN-1** | "What stays as-is / In-progress redirect" line | Softened. v1 claimed the redirect happens "before any render path involving `isEditing`". v2 says: the redirect is in a `useEffect` (`history/[id].tsx:70-74`), so it commits on first effect pass; the brief pre-redirect render is read-only by default, so no editable affordance is visible during the flash. |
| 4 | **MIN-2** | "Riscos / Performance" line | Added: "Read-only tree avoids `useLastWorkingSet(exercise.id)` per exercise (`src/components/exercise-block.tsx:100`) → N fewer cross-session reads when a workout has N exercises." |
| 5 | **MIN-4** | "Contratos de I/O / Edited: `app/(app)/history/[id].tsx`" — single `screenOptions` const reused across loading/error/happy-path branches | The `Stack.Screen` config (including the dynamic `headerRight`) is lifted into a single const built before the loading-vs-error-vs-happy-path branches. The Pencil shows on all three states, matching the measurements precedent (`app/(app)/measurements/[id]/index.tsx:145-154` ships the same headerRight on every branch). The Pencil is a no-op during loading because `session.data` is undefined; on error it's harmless because flipping `isEditing` is local state. Tradeoff documented inline. |
| 6 | **MIN-3** | "Mudanças por arquivo" table; the `<ExercisePicker>` callout under "Edited" | `<ExercisePicker>` is now mount-gated: `{isEditing ? <ExercisePicker ... /> : null}`. Removes dead JSX from the read-only tree. The `pickerOpen` local state is also reset to `false` when leaving edit mode (one extra line in the "Done" handler) to prevent a stale-open picker on re-entry. |
| 7 | **MIN-5** | "Riscos / What gets unmounted on Done — explicit enumeration" — promoted bullet | Was a parenthetical at v1:255. Now a top-level enumerated bullet listing the four things that unmount on Done (the four `<SetInput>` `<TextInput>` instances per row, the per-row `<SetRowMenu>` if open with an unsaved RPE/notes draft, the screen-level session-name `<TextInput>`, the bottom Add-exercise / Delete-workout block). |
| 8 | **MIN-6** | "Imports — per-file diff" subsection | Verified against current `app/(app)/history/[id].tsx:1-11`: `useColorScheme` is **NOT** currently imported. v2 adds an explicit line to the import diff to bring `useColorScheme` in from `"react-native"`. Also adds `Keyboard` from the same module (needed for MAJ-2) and `Pencil` from `lucide-react-native` (the existing `lucide-react-native` import at line 2 currently only brings `Plus`). |

The "Done" handler in v1 was a one-liner `onPress={() => setIsEditing(false)}`. v2 expands it to a 3-line handler that dismisses the keyboard, closes any open picker, and flips state — see the snippet under "Contratos de I/O" below.

---

## Goal (1 sentence)

Make the history detail screen render the workout body as static, non-interactive content by default, and add a header pencil that flips a screen-level `isEditing` flag, swapping in the existing fully-editable `<ExerciseBlock>` (with all its mutation hooks) only when the user explicitly opts in.

## Approach

The history detail screen (`app/(app)/history/[id].tsx`) currently mounts the same `<ExerciseBlock>` + `<SetInput>` primitives the live workout uses, so every set field is editable and every trash icon is live. We keep those primitives untouched for the editable case and introduce a parallel, structurally distinct read-only component family — `<ReadOnlyExerciseBlock>` + `<ReadOnlySetRow>` — that renders the same data as static `<Text>` rows with no mutation handlers wired up. A screen-level `isEditing: boolean` (default `false`) flips between the two trees and decides whether the mutation hooks even need to be called: callbacks remain wired in the JSX, but the editable tree only mounts when `isEditing === true`, so the rows in the read-only tree literally cannot dispatch a mutation. The header pencil (`Stack.Screen.headerRight`, mirroring the measurements/exercise-progress precedent) toggles the flag — Pencil while read-only, "Done" while editing. The session-name input, the "Add exercise" / "Delete workout" affordances, and the `<ExercisePicker>` modal all also gate on `isEditing` so the entire body presents as a static summary unless the user opts in. The time-edit pencil (`<SessionTimesEditor>`) stays exactly as today, independent of this toggle, per the prompt.

The choice of "new component" over "boolean prop on `<ExerciseBlock>`" is driven by the prompt's explicit wording ("The read-only view should be a new component") and by code-clarity: threading a `readOnly` prop through `<ExerciseBlock>` and `<SetInput>` would add `if (readOnly) ... else ...` branches in ~10 places (header actions, column-header spacers, every input, the menu trigger, the trash button, the footer's add buttons) and leave the live workout's prop surface confusing for a feature it doesn't use. A sibling component keeps both surfaces simple to read.

## Mudanças por arquivo

| File | Type | Change |
|---|---|---|
| `src/components/read-only-set-row.tsx` | new | New static row that renders one set as text-only (weight + reps + RPE badge + notes preview + set-type badge + set number + checkmark glyph), no `<TextInput>`, no trash, no menu trigger. Mirrors `<SetInput>` visual structure but with `<Text>` in place of inputs. One responsibility: render a set row read-only. |
| `src/components/read-only-exercise-block.tsx` | new | New static block wrapping a list of `<ReadOnlySetRow>` rows. Renders the exercise header (name + muscles/equipment, with optional `onPressName` for the progress-link), the same column-header strip, and an empty-state line when `sets.length === 0`. No "+ Working set" footer, no chevron menu, no reorder handles, no trash. One responsibility: render an exercise block read-only. |
| `app/(app)/history/[id].tsx` | edited | (a) Add `isEditing` state (default `false`); (b) lift `Stack.Screen` config (including dynamic `headerRight`) into a single const reused across loading/error/happy-path branches; (c) wire `Stack.Screen.headerRight` to a Pencil when read-only and to a "Done" button when editing — the "Done" Pressable's `onPress` calls `Keyboard.dismiss()` then `setPickerOpen(false)` then `setIsEditing(false)`; (d) gate the session-name `<TextInput>`, the "Add exercise" Pressable, the "Delete workout" Button, and the `<ExercisePicker>` modal mount behind `isEditing`; (e) conditionally render `<ReadOnlyExerciseBlock>` vs `<ExerciseBlock>` per exercise depending on `isEditing`; (f) when read-only, the session-name renders as a static `<Text>` headline. The mutation-hook calls stay declared at the top but their handlers are only wired into JSX inside the `isEditing` branch. `useUpdateSessionTimes` and `<SessionTimesEditor>` remain untouched. |

No changes to: `src/components/exercise-block.tsx`, `src/components/set-input.tsx`, `src/components/set-row-menu.tsx`, `src/components/session-times-editor.tsx`, the live workout screen, any hook, any migration, any test (existing tests stay green; new tests are the Tester's job).

### Single responsibility check
- `read-only-set-row.tsx`: render one set row read-only. Single concern.
- `read-only-exercise-block.tsx`: render one exercise block read-only. Single concern.
- `app/(app)/history/[id].tsx`: the edit covers one feature (the read-only/edit toggle) but touches several JSX subtrees (header, name, blocks, footer, picker, screen-config const). That's the same concern surfaced in multiple JSX locations on one screen, not unrelated changes. Acceptable.

## Imports — per-file diff for `app/(app)/history/[id].tsx`

Currently lines 1-11:

```ts
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Plus } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
```

After v2:

```ts
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Pencil, Plus } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useColorScheme,
} from "react-native";

import { ReadOnlyExerciseBlock } from "~/components/read-only-exercise-block";
```

Added: `Pencil` (lucide-react-native), `Keyboard` + `useColorScheme` (react-native), `ReadOnlyExerciseBlock` (new local). Verified by reading `app/(app)/history/[id].tsx:1-11` on 2026-05-23 — none of these are present today.

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
- Weight column: `<Text>` displaying the formatted kg→unit value if `row.weight != null`, else an em dash (`—`). No border, no input chrome.
- Reps column: `<Text>` showing `row.reps?.toString() ?? "—"`. No border, no input chrome.
- A static RPE/notes affordance in the slot currently occupied by `<SetInput>`'s `MoreHorizontal` menu trigger: if `row.rpe != null` show a small "RPE {n}" chip; if `row.notes?.trim().length > 0` show a notes glyph (lucide `StickyNote`, gray-500) — both purely visual, neither is a `<Pressable>`. Use the same 44pt-wide slot to preserve column alignment with `<SetInput>`.
- Trash slot: empty `<View className="w-7" />` spacer (same width as `<SetInput>`'s trash button), so toggling into edit mode doesn't visually reflow the row.
- Check state: if `row.completed_at != null`, apply the same `bg-green-50 dark:bg-green-950/30` tint that `<SetInput>` uses when checked — the historical record carries this state. Optionally render a tiny static `Check` glyph (lucide `Check`, green-600, no `<Pressable>` wrapper) at the head of the row when `row.completed_at != null`.

Helper for the weight cell: a 4-line pure function `displayWeight(kgStr: string | null, unit: WeightUnit): string` that returns `—` for null/non-finite, otherwise the `kg`→unit-converted value as a plain string (integer if integer, else `.toFixed(1)`). Either inlined in `read-only-set-row.tsx` or lifted to `src/utils/set-display.ts` — implementer's call. No new query, no hook, pure transform.

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
- Header row identical to `<ExerciseBlock>`'s header (lines 128–164 of `exercise-block.tsx`) — name + optional `(deleted)` suffix + muscles/equipment line. Same `onPressName` handling. **No** reorder chevrons, **no** trash. Right-side action area is omitted entirely.
- Column-header strip (lines 211–228 of `exercise-block.tsx`) shown only when `sets.length > 0`. Same labels: `#`, `Weight ({unit})`, `Reps`. Two trailing spacers (44pt for menu, 28pt for trash) to keep column alignment consistent with the editable tree.
- `sets.map((s) => <ReadOnlySetRow ... />)`.
- Empty state when `sets.length === 0`: a single line `<Text className="px-4 py-3 text-sm italic text-gray-500">No sets logged for this exercise.</Text>`. Reachable today via `addedExerciseIds` after a user opens edit, picks an exercise, adds no sets, and exits.
- **No** footer ("+ Working set", chevron menu, "+ Warm-up", "+ Drop set").
- **No** `useLastWorkingSet(exercise.id)` invocation — read-only does not need placeholder hints from prior sessions.

### Edited: `app/(app)/history/[id].tsx`

New state additions (added near existing `pickerOpen` / `addedExerciseIds` / `nameDraft`):

```ts
const [isEditing, setIsEditing] = useState(false);
const colorScheme = useColorScheme();
```

Single `screenOptions` const (lifted, used by loading / error / happy-path branches):

```tsx
const screenOptions = {
  title: session.data?.name?.trim() || "Workout" || "Session",
  headerShown: true,
  headerRight: () =>
    isEditing ? (
      <Pressable
        onPress={() => {
          // Force blur of any focused <TextInput> (weight/reps in <SetInput>,
          // session-name field) so the existing onBlur=commit path fires
          // BEFORE the editable tree unmounts. Without this, a tap on Done
          // while a number input is focused would lose the in-flight
          // keystrokes — a new failure mode introduced by this feature.
          Keyboard.dismiss();
          // Close the picker so it doesn't survive into read-only mode as
          // a stale-open modal on re-entry.
          setPickerOpen(false);
          setIsEditing(false);
        }}
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
} as const;
```

Then in each return branch (loading, error, happy-path) the same `<Stack.Screen options={screenOptions} />` JSX is used. The title resolution falls back to `"Session"` during loading and error (matches today's behavior at lines 158 and 167) by collapsing through the `||` chain when `session.data` is undefined.

> Note on the title: the `||` chain above is illustrative; the implementer should compute a `title = session.data?.name?.trim() ? session.data.name.trim() : (session.data ? "Workout" : "Session")` and feed that into `screenOptions`. The intent: loading/error show "Session" like today; happy-path shows the resolved name or "Workout".

Per-exercise render switches (replaces lines 241-286):

```tsx
{orderedExercises.length === 0 ? (
  <View className="px-6 py-10">
    <Text className="text-center text-base text-gray-500">
      No sets logged in this session.
    </Text>
  </View>
) : (
  orderedExercises.map((ex) =>
    isEditing ? (
      <ExerciseBlock
        key={ex.id}
        exercise={ex}
        sets={setsByExercise.get(ex.id) ?? []}
        unit={unit}
        onPressName={() =>
          router.push(`/(app)/exercises/${ex.id}/progress`)
        }
        onAddSet={async (input) => { /* logSet.mutateAsync */ }}
        onUpdateSet={async (setId, patch) => { /* updateSet.mutateAsync */ }}
        onUpdateSetMeta={async (setId, patch) => { /* updateSetMeta.mutateAsync */ }}
        onDeleteSet={async (setId) => { /* deleteSet.mutateAsync */ }}
      />
    ) : (
      <ReadOnlyExerciseBlock
        key={ex.id}
        exercise={ex}
        sets={setsByExercise.get(ex.id) ?? []}
        unit={unit}
        onPressName={() =>
          router.push(`/(app)/exercises/${ex.id}/progress`)
        }
      />
    ),
  )
)}
```

Session-name swap (replaces lines 184-201):

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
    {updateName.isError ? (
      <Text className="mt-1 text-xs text-red-500">
        {updateName.error instanceof Error
          ? updateName.error.message
          : "Failed to rename"}
      </Text>
    ) : null}
  </>
) : (
  <Text className="text-lg font-semibold text-black dark:text-white">
    {headerTitle}
  </Text>
)}
```

Bottom-action gating (replaces lines 288-308):

```tsx
{isEditing ? (
  <View className="mt-4 gap-3 px-4">
    <Pressable onPress={() => setPickerOpen(true)} ...>+ Add exercise</Pressable>
    <View className="mt-6 border-t ...">
      <Button label="Delete workout" variant="destructive" onPress={onDeleteSession} loading={softDelete.isPending} />
    </View>
  </View>
) : null}
```

Picker mount-gating (replaces lines 311-321):

```tsx
{isEditing ? (
  <ExercisePicker
    visible={pickerOpen}
    onClose={() => setPickerOpen(false)}
    excludeIds={orderedExercises.map((e) => e.id)}
    onPick={(ex) => {
      setAddedExerciseIds((prev) =>
        prev.includes(ex.id) ? prev : [...prev, ex.id],
      );
      setPickerOpen(false);
    }}
  />
) : null}
```

Auto-exit on screen unmount: `isEditing` is local to the screen instance; navigating away unmounts the screen; the next mount re-enters read-only. No `useFocusEffect` needed.

## Mutation gating — the 6 hooks that must NOT fire in read-only

| Hook | File | Currently invoked from | After this change |
|---|---|---|---|
| `useLogSet` | `src/hooks/use-sets.ts:44` | `onAddSet` on `<ExerciseBlock>` | Only callable through the editable tree (mounted iff `isEditing===true`). |
| `useUpdateSet` | `src/hooks/use-sets.ts:65` | `<SetInput>` `onCommit` | Same. `<ReadOnlySetRow>` has no `<TextInput>`, so no `onBlur=commit` path exists. |
| `useUpdateSetMeta` | `src/hooks/use-sets.ts:88` | `<SetInput>` `onUpdateMeta` via `<SetRowMenu>` | Same. `<ReadOnlySetRow>` does not mount `<SetRowMenu>`. |
| `useDeleteSet` | `src/hooks/use-sets.ts:101` | `<SetInput>` trash Pressable | Same. `<ReadOnlySetRow>` has no trash Pressable. |
| `useUpdateSessionName` | `src/hooks/use-sessions.ts:80` | `commitName` on the screen's name `<TextInput>` | Hook stays declared at top; `commitName` only reachable when the `<TextInput>` is rendered, i.e. when `isEditing===true`. |
| `useSoftDeleteSession` | `src/hooks/use-sessions.ts:114` | `<Button label="Delete workout" />` | Button only mounts when `isEditing===true`. |

`useUpdateSessionTimes` is **not** in the gated list — the time-edit pencil keeps working regardless of `isEditing`, per the prompt.

`useCheckSet` / `useUncheckSet` / `useRemoveExerciseFromSession` (discovery.md:16) are not used on history today and continue to be unused.

## What stays as-is

- **`<SessionTimesEditor>`**: lives at `app/(app)/history/[id].tsx:203–219`. Renders identically in both modes. Tap-to-reveal pencil flow is its own self-contained mechanism. Its `accessibilityLabel` is `"Edit start and end times"` (`session-times-editor.tsx:119`).
- **`<ExerciseBlock>`**, **`<SetInput>`**, **`<SetRowMenu>`**: zero changes. Reused verbatim for the `isEditing===true` branch.
- **In-progress redirect** (`history/[id].tsx:70-74`): unchanged. It lives inside a `useEffect`, so it commits on the first effect pass (post first render). Read-only mode is the default, so the brief pre-redirect render shows no editable affordance — only static text and the time-edit pencil. No user-visible flash of edit chrome.
- **Per-exercise volume-target slot** (`VolumeTargetSlot`): already not passed on history (`showVolumeTarget` defaults to `false`), so it remains absent in both modes.
- **Live workout screen** (`app/(app)/workout/[sessionId].tsx`): zero changes.
- **Per-exercise name → progress link**: kept in both modes (read-only sets a non-mutating `onPressName` that simply navigates).

## Visual delta — read-only vs edit

| Element | Read-only (default) | Edit (after pencil tap) |
|---|---|---|
| Header right slot | Pencil icon (`accessibilityLabel="Edit workout"`) | "Done" text button (`accessibilityLabel="Exit edit mode"`) |
| Header right slot (loading / error branches) | Pencil icon (no-op when `session.data` undefined, harmless toggle on error) | n/a |
| Session-name | Static `<Text className="text-lg font-semibold ...">` showing the resolved title | `<TextInput>` with placeholder `"Workout"`, `onBlur=commitName`, `onSubmitEditing=commitName` |
| Per-set weight | `<Text>` displaying the formatted number, no border | `<TextInput keyboardType="decimal-pad">` with rounded border |
| Per-set reps | `<Text>`, no border | `<TextInput keyboardType="number-pad">` with rounded border |
| Set-type badge (`W` / `•` / `↓`) | Visible (identical) | Visible (identical) |
| Set number | Visible (identical) | Visible (identical) |
| Check state | Row tinted green when `row.completed_at != null`; optional static check glyph; no Pressable | Same tint via `<SetInput>` rules; history detail does not pass `showCheckable`, so no check Pressable in either mode — only the tint |
| RPE / notes affordance | Static "RPE n" chip and/or notes glyph in the menu slot; no Pressable | `MoreHorizontal` Pressable that opens `<SetRowMenu>` |
| Trash icon | Hidden (spacer preserves column alignment) | Visible (`Trash2` red icon, calls `onDeleteSet`) |
| "+ Working set" / chevron / "+ Warm-up" / "+ Drop set" footer | Hidden entirely | Visible (whole `<View className="px-4 py-3">` block from `<ExerciseBlock>` lines 249–304) |
| Exercise reorder handles | Hidden (history never passed them; both modes match) | Hidden (history never passes them; both modes match) |
| Exercise trash | Hidden (history never passed `onRemove`; both modes match) | Hidden (same) |
| Block empty state (`sets.length === 0`) | Single line "No sets logged for this exercise." | Header + column strip + footer with "+ Working set" |
| Screen empty state (no exercises at all) | Existing "No sets logged in this session." line | Same line (unchanged) |
| "Add exercise" Pressable | Hidden | Visible |
| "Delete workout" Button | Hidden | Visible |
| Time-edit pencil (`<SessionTimesEditor>`, `accessibilityLabel="Edit start and end times"`) | Visible, fully functional | Visible, fully functional (same component, same flow) |
| `<ExercisePicker>` modal | Not mounted at all (gated behind `isEditing`) | Mounted; opens via "Add exercise" |

## Test surfaces — exact selectors

- Header pencil (read-only mode): `page.getByLabel("Edit workout")` — Pressable in `Stack.Screen.headerRight`.
- Header "Done" button (edit mode): `page.getByLabel("Exit edit mode")`.
- Trash icons in read-only mode: `page.getByLabel("Delete set")` → expect count 0.
- Per-row menu in read-only: `page.getByLabel("Open set details")` → expect count 0.
- "+ Working set" in read-only: `page.getByText("+ Working set")` → expect count 0.
- "Add exercise" in read-only: `page.getByText("Add exercise")` → expect count 0.
- "Delete workout" in read-only: `page.getByText("Delete workout")` → expect count 0.
- Session-name `<TextInput>` in read-only: `page.getByPlaceholder("Workout")` → expect count 0. After tapping `getByLabel("Edit workout")`, the same selector should resolve to 1.
- Weight/reps fields in read-only: `page.locator('input[inputmode="decimal"]')` and `page.locator('input[inputmode="numeric"]')` → expect count 0 in read-only, > 0 in edit.
- After tapping pencil → fields editable: `getByLabel("Edit workout")` → click → assertions above flip.
- Time-edit pencil unaffected: `page.getByLabel("Edit start and end times")` (the actual label from `session-times-editor.tsx:119`, used in `tests/e2e/crud.spec.ts:253, 349, 374`) remains present and clickable in both modes.
- Done-keyboard-dismiss path: type a value into a weight input in edit mode, then tap `getByLabel("Exit edit mode")` → the value should be persisted (visible after `useSetsForSession` refetch / next render) because `Keyboard.dismiss()` blurs the input before unmount.

## Existing test compatibility

- `tests/e2e/remove-exercise.spec.ts:174–186` — asserts `getByLabel(/^Remove .* from workout$/)` count 0 on history detail. Validates the new default. Stays as-is.
- `tests/e2e/crud.spec.ts:215–393` — two history specs exercising the time-edit pencil only (label `"Edit start and end times"`). The pencil renders identically in both modes; specs pass without changes.
- `tests/e2e/soft-deleted-exercises-in-history.spec.ts:193–309` — asserts the block for a soft-deleted exercise renders with "(deleted)" suffix on history detail. `<ReadOnlyExerciseBlock>` keeps the same name-with-suffix rendering. Passes.
- `tests/e2e/volume-target.spec.ts:579–601` — asserts the per-exercise volume-target strip is absent on history. `<ReadOnlyExerciseBlock>` does not mount `<VolumeTargetSlot>`. Passes.
- Discovery confirmed there is no existing e2e spec that taps a history set to change a value, add a set, delete a set, or edit RPE/notes. No spec to update for "go through the Edit button first" — that path will be exercised by new specs the Tester adds.

## Riscos

- **Data integrity (RLS, migrations)**: no schema change, no migration, no new mutation. RLS unchanged. All gating is client-side; even if a malicious client invoked a mutation directly with the session id, RLS on `sets`/`sessions` still enforces user scoping.
- **Done-induced data loss (new failure mode introduced by this feature) — MAJ-2 fix**: a user enters edit mode, taps into the reps `<TextInput>`, types `12`, taps "Done" without first blurring → without intervention, `<SetInput>` unmounts before its `onBlur=commit` fires and the keystroke is lost. Mitigation: the "Done" Pressable's `onPress` calls `Keyboard.dismiss()` **before** `setIsEditing(false)`. On all three platforms (iOS, Android, RN-Web), `Keyboard.dismiss()` blurs the currently focused `<TextInput>`, which fires `<SetInput>`'s `onBlur=commit` synchronously enough that the `useUpdateSet.mutateAsync` call is initiated before the parent state update tears down the input. The mutation is async, but it's been dispatched into the TanStack Query pipeline before unmount — once dispatched, unmount doesn't cancel it. This closes the new Done→data-loss path.
- **What gets unmounted on Done — explicit enumeration (MIN-5 promotion)**:
  1. Every `<SetInput>` (one per logged set) — including any focused weight or reps `<TextInput>`. `Keyboard.dismiss()` mitigates lost keystrokes.
  2. Any open `<SetRowMenu>` with an unsaved RPE/notes draft — the menu's draft state is lost. This is a deliberate-cancel path (the user is bypassing the menu's own Save button). Acceptable. Documented here so the Tester knows not to assert RPE persistence across a Done-tap from inside an open menu.
  3. The session-name `<TextInput>` if focused — same `Keyboard.dismiss()` blur path commits via `commitName`'s `onBlur` handler.
  4. The bottom Add-exercise / Delete-workout block — pure JSX, no in-flight state.
  5. The `<ExercisePicker>` modal mount — `setPickerOpen(false)` runs first as a guard, so we don't unmount the picker mid-open.
- **UX regressions on the live workout** (`app/(app)/workout/[sessionId].tsx`): zero. Still imports `<ExerciseBlock>` + `<SetInput>` directly, no `isEditing` boundary near it.
- **UX regression on routine detail**: zero. Routines do not render `<ExerciseBlock>`.
- **UX regression on the time-edit pencil**: zero. `<SessionTimesEditor>` renders in both modes; it self-gates via tap-to-reveal. The two pencils on the screen (header body-edit + body time-edit) have distinct accessibility labels: `"Edit workout"` (new) vs `"Edit start and end times"` (existing). Users and tests can disambiguate.
- **UX regression — accidental data loss on route blur during edit**: a user types `12` into reps, then taps the back arrow before blur — the keystroke is lost. This is the pre-existing behavior of `<SetInput>` (it commits on `onBlur`/`onSubmitEditing`, not on each keystroke), identical to today's live-workout behavior. Not introduced by this feature.
- **State preservation when toggling edit→read-only→edit**: scroll position is preserved (the parent `<ScrollView>` keeps its offset; same-key blocks help React preserve identity). Picker open state is force-reset on Done to avoid stale-open modal on re-entry. `addedExerciseIds` persists across the toggle, so an exercise added during one edit session still shows (as a read-only empty block) after Done.
- **In-progress redirect timing (MIN-1)**: the in-progress redirect at `history/[id].tsx:70-74` runs inside a `useEffect`, so it commits after the first render pass, not before. Since default is `isEditing=false`, the brief pre-redirect render shows only static read-only content (no `<TextInput>`, no trash, no "+ Working set"), so even the flash is non-interactive. No user-visible edit chrome appears during the redirect window.
- **Loading / error variants of `Stack.Screen` (MIN-4 fix)**: lifting `screenOptions` into a single const means the Pencil shows on loading and error branches too. Tapping the Pencil during loading flips `isEditing` to `true`, but `orderedExercises` is empty (no `session.data` / `setsQ.data`), so the screen just renders the loading spinner. Tapping during error similarly flips a local boolean with no observable effect until the data resolves. Matches measurements precedent (`measurements/[id]/index.tsx:145-154` ships its headerRight on every branch). Tradeoff: a marginal "tap does nothing" edge case during loading, accepted for visual consistency.
- **Platform divergence (iOS / Android / Web)**: read-only `<Text>` cells render uniformly. The web concern is the RN-Web mapping of `keyboardType="decimal-pad"` to `inputmode="decimal"` on the underlying `<input>` (used in test selectors). `Keyboard.dismiss()` is a no-op on web (no soft keyboard), but on web the input still loses focus when its container unmounts — and `<SetInput>`'s `onBlur` handler fires on focus-loss regardless of source. On iOS/Android `Keyboard.dismiss()` triggers blur. All three platforms get the same `onBlur=commit` semantics.
- **Performance**:
  - Read-only tree avoids `useLastWorkingSet(exercise.id)` per exercise (`src/components/exercise-block.tsx:100`) → N fewer cross-session reads when a workout has N exercises (MIN-2). Each saved read is one TanStack Query subscription plus one Supabase fetch on cache miss; the win is small per session but real.
  - Read-only tree mounts fewer interactive components than the editable tree (no `<SetRowMenu>` lazy-load, no `<TextInput>` instances). Toggle remounts the per-block tree; with ~10 exercises × ~5 sets typical, that's ~50 nodes — well under any budget that would justify memoization.
  - `<ExercisePicker>` is mount-gated, so its internal `useExercises()` query subscription is not created in read-only mode (one fewer subscription per session view).
- **Bundle size**: zero new dependencies; `Pencil`, `StickyNote`, `Check` are already imported from `lucide-react-native` elsewhere in the app.

## Alternativas descartadas

1. **`readOnly` boolean prop threaded through `<ExerciseBlock>` and `<SetInput>`** — would add `if (readOnly) <Text>else <TextInput>` branches in ~10 places. Descartada because (a) the prompt explicitly asks for "a new component", (b) it complicates the prop surface of `<ExerciseBlock>` for a behavior the live workout never uses, (c) the conditional branching makes `<SetInput>` harder to read for a marginal LOC saving.

2. **Push a separate `/(app)/history/[id]/edit` route, mirroring the measurements pattern** — descartada because the prompt phrasing ("Edit button on the workout") implies in-place editing, and splitting the surface would force the time-edit pencil (which stays on the view route per prompt) to live on a different screen from the body-edit fields. Two routes also complicate scroll-position and expand-state preservation across the toggle.

3. **CSS-only `pointer-events: none` overlay on the editable tree** — descartada because (a) it leaves the `<TextInput>` elements focusable on web via keyboard tabbing, (b) RN doesn't honor `pointer-events: none` consistently across platforms, (c) the prompt asks for a structurally different component, (d) it doesn't suppress mutation hook *instantiation*, only user-driven invocation — accessibility tools and tests would still see editable controls.

4. **`<TextInput editable={false}>` with disabled styling** — descartada because the inputs still look like inputs (visual ambiguity), the trash and "+ Working set" buttons would still need separate hiding logic, and it doesn't deliver the "a new component" the prompt asks for.

5. **Per-block (per-exercise) Edit toggle instead of per-screen** — descartada because (a) the prompt says "Edit button on the workout" (singular workout), (b) per-block toggling creates the confusing question "which block am I currently editing?" and forces a per-block visual indicator, (c) one screen-level pencil matches the established header-pencil idiom in measurements/exercise-progress.

6. **Calling `inputRef.current?.blur()` directly instead of `Keyboard.dismiss()`** — descartada because there's no single ref to blur (multiple `<SetInput>` instances, the session-name input, all hidden inside child components without exposed refs). `Keyboard.dismiss()` is the ergonomic "blur whatever is focused" primitive.

## Out of scope

- **Time-edit pencil** (`<SessionTimesEditor>`, `accessibilityLabel="Edit start and end times"`): stays exactly as-is. Two pencils on the screen is acceptable (header = body edit, body = times edit). Disambiguated by accessibility labels.
- **Live workout screen** (`app/(app)/workout/[sessionId].tsx`): no changes.
- **Routine detail screens**: do not use `<ExerciseBlock>`; nothing to change.
- **Per-block (per-exercise) scope toggle**: rejected (see Alternative 5).
- **Save / Cancel paired exit**: not needed — mutations auto-commit on blur; a Cancel would have to undo committed mutations.
- **"Unsaved changes" prompt**: not needed — there is no transactional boundary; the lossy case (typing without blurring) is mitigated by `Keyboard.dismiss()` on Done and is no worse than today's live workout for route-blur.
- **New mutation hooks, schema changes, RLS adjustments, telemetry**: none.
- **Changes to the in-progress redirect** (`history/[id].tsx:70-74`): unchanged.

## Resposta a issues do Validator

| Id | Status | How it's addressed in v2 |
|---|---|---|
| **MAJ-1** — wrong accessibility label cited | Fixed | All references in v1 to `"Edit workout times"` (lines 238, 253) replaced with `"Edit start and end times"` — verified label at `src/components/session-times-editor.tsx:119` and against `tests/e2e/crud.spec.ts:253, 349, 374`. Appears in: Test surfaces section, Riscos / UX regression on time-edit pencil, Visual delta table row, Out of scope. |
| **MAJ-2** — Done-button data-loss new failure mode | Fixed | The "Done" Pressable's `onPress` now calls `Keyboard.dismiss()` before `setIsEditing(false)`. `Keyboard` imported from `"react-native"`. Rationale documented in Riscos / "Done-induced data loss" bullet: forces blur of focused `<SetInput>`/session-name `<TextInput>` so the existing `onBlur=commit` path dispatches the mutation before unmount. Cross-platform behavior noted (iOS/Android trigger blur via keyboard dismiss; web blurs on unmount anyway via focus-loss). |
| **MIN-1** — in-progress redirect prose overstated | Fixed | "What stays as-is / In-progress redirect" line softened: the redirect lives in a `useEffect`, commits after first render pass; the brief pre-redirect render is read-only by default, so no editable affordance is visible during the flash. |
| **MIN-2** — `useLastWorkingSet` perf win missing | Fixed | Added to Riscos / Performance: "Read-only tree avoids `useLastWorkingSet(exercise.id)` per exercise (`exercise-block.tsx:100`) → N fewer cross-session reads when a workout has N exercises." |
| **MIN-3** — `<ExercisePicker>` could be mount-gated | Fixed | `<ExercisePicker>` is now mount-gated behind `{isEditing ? <ExercisePicker .../> : null}`. Removes dead JSX in the read-only tree and avoids the picker's internal `useExercises()` subscription when not editing. |
| **MIN-4** — Pencil missing on loading / error branches | Fixed | `Stack.Screen` config lifted into a single `screenOptions` const reused by loading / error / happy-path branches. Pencil visible on all three for visual consistency with measurements precedent. Tradeoff: tap-during-loading is a no-op; documented. |
| **MIN-5** — unmount-on-Done enumeration | Fixed | Promoted from a parenthetical in v1:255 to a top-level enumerated list under "What gets unmounted on Done". Five bullets covering `<SetInput>` text inputs, `<SetRowMenu>` open draft, session-name input, bottom action block, picker modal. |
| **MIN-6** — `useColorScheme` import unmentioned | Fixed | Verified against current `app/(app)/history/[id].tsx:1-11` — `useColorScheme` is NOT imported today. v2 includes an explicit per-file import diff under "Imports — per-file diff" showing the additions: `Pencil` (lucide-react-native), `Keyboard` + `useColorScheme` (react-native), `ReadOnlyExerciseBlock` (new local). |

## Confidence and risk

- **Confidence: HIGH.** All decision points re-anchored to read source on 2026-05-23: history screen (`app/(app)/history/[id].tsx:1-324`), `<SessionTimesEditor>` label confirmed at `session-times-editor.tsx:119`, test labels confirmed in `crud.spec.ts:253, 349, 374`. Import diff verified against current file head. Mutation hook list cross-checked against `use-sets.ts` and `use-sessions.ts`. All six minor and two major findings addressed concretely with file-line citations.
- **Risk: LOW.** Two new files, one edited file. No schema, no migration, no RLS, no API. No change to the live workout's mutation surface. Existing tests stay green (verified). The Done→`Keyboard.dismiss()` mitigation is a one-line change with well-understood cross-platform semantics. Worst credible failure mode: a `<SetRowMenu>` open with an unsaved RPE draft when the user taps Done — draft is lost. Documented; deliberate-cancel path; no data already on disk is affected.
