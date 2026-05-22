# Design v1 — 2026-05-22_1000_set-row-declutter

## Goal (1 sentence)

Move the per-set RPE input and notes input off the live set row and behind a single `MoreHorizontal` trigger that opens a hand-rolled bottom-sheet menu, leaving the row visually clean (set-number badge · set type · weight · reps · check · menu) while preserving full editability on both the live workout and history detail screens.

## Approach

The row crowding is the main complaint, so we strip RPE (an inline `<TextInput>`) and notes (a `MessageSquare` toggle + an inline expand panel) from `<SetInput>` entirely and replace both with a single `MoreHorizontal` icon trigger sitting in the same `h-11 w-11` tap slot as the check button — established precedent from `2026-05-21_1308_set-check-button`. Tapping the trigger opens a new `<SetRowMenu>` bottom-sheet that mirrors the hand-rolled pattern at `src/components/plate-calculator.tsx:69-153` (`<Modal animationType="slide" transparent>` with bottom-anchored `rounded-t-2xl` card). The menu hosts the RPE chip-strip selector (clear + `5 → 10` in 0.5 increments) and a multi-line notes `<TextInput>`. RPE commits on chip tap (immediate, single field); notes commits on dismiss (matches today's blur semantics, avoids mid-typing chatter). The indicator on the row tints `MoreHorizontal` blue (`#3b82f6` / `text-blue-400` dark) when `rpe != null || notes?.trim()`, mirroring the existing `set-input.tsx:180` notes-icon tint pattern.

The Conductor's call (c) is taken on the API: instead of changing `updateSet`'s clobber semantics or having the menu re-commit `{reps, weight, rpe, notes}` from row state, we add a surgical `updateSetMeta(id, {rpe?, notes?})` that uses a **spread-only** Supabase `.update(...)` containing solely the provided keys. This isolates the menu interaction from the row's weight/reps state, keeps `updateSet` semantics untouched (zero regression risk to the existing flow), and is naturally paired with a dedicated `useUpdateSetMeta(sessionId)` hook that invalidates `["sets", sessionId]` and `["stats"]` exactly like `useUpdateSet`. The `<ExerciseBlock>` column-header row is updated in lockstep to drop the `RPE` label and the spare notes/trash spacers, replacing them with a single `w-11` spacer for the menu trigger.

The same `<SetInput>` is mounted on both the live workout (`showCheckable=true`) and history detail (`showCheckable=false`) screens — the menu trigger appears in both, with no read-only opt-out. Trash stays on the row (out of scope for v1 per Discovery #9).

## Decisions on unknowns (Discovery → this design)

| # | Unknown | Decision | Rationale |
|---|---|---|---|
| 1 | Menu form factor | **Bottom sheet** via hand-rolled `<Modal animationType="slide" transparent>` mirroring `plate-calculator.tsx` | Chip strip + multi-line notes need room; modal feel matches "focus on this one set"; no library to add. |
| 2 | Trigger icon | **`MoreHorizontal`** | Conductor lean, no codebase collision (`ChevronDown` already means "expand more set types" on the same screen). |
| 3 | Indicator style | **Tint the icon** `text-blue-500` (light) / `text-blue-400` (dark) when `rpe != null \|\| notes?.trim()`. Gray (`#9ca3af`) otherwise. | Matches existing notes-icon precedent at `set-input.tsx:180`. No new visual primitive. |
| 4 | RPE clear option | **Include `"—"` chip** in the strip, leftmost | Otherwise the user can't unset RPE without deleting the whole set. |
| 5 | RPE range | **Ship the prompted 11 values**: `5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10` | Conductor lean. Strong-style. Persisted as one-decimal strings (e.g. `"9.0"`) to match `parseFloat0(rpe)?.toFixed(1)` rendering. |
| 6 | `updateSet` partial-patch | **Option (c)** — new `updateSetMeta(id, {rpe?, notes?})` API | Most surgical. Keeps `updateSet`'s semantics for the existing weight/reps/rpe/notes commit path (zero regression risk). Menu doesn't need to know about reps/weight. |
| 7 | Trigger a11y label | **`"Open set details"`** | Conductor lean. Generic, doesn't leak that there are exactly two fields. |
| 8 | Editable in history detail? | **Yes — fully editable, same component, no opt-out** | Conductor lean. Behavior parity with today's history detail (RPE/notes were editable there). |
| 9 | Delete inside the menu? | **No — trash stays on the row** | Out of scope per spec. Could be a follow-up. |
| 10 | RPE save semantics | **Chip tap commits immediately (single-field `updateSetMeta({rpe: ...})`); notes commits on sheet dismiss (`updateSetMeta({notes: ...})`)** | Chip taps feel instant. Notes deferred to dismiss avoids per-keystroke writes. Both share `useUpdateSetMeta`. |
| 11 | Header row layout | Drop the `"RPE"` label (`w-14`) and one of the two trailing `w-7` spacers. Net: `[opt-check 44] [badge 28] [#] [Weight flex-1] [Reps flex-1] [menu 44] [trash 28]`. | Mirrors the new row exactly. Verified pixel budget below. |
| 12 | Previous-RPE chip hint | **Yes** — outline the chip matching `previousSet?.rpe` (e.g. dashed border, gray text) when no RPE is set on the current row, to mirror placeholder behavior of weight/reps | Existing placeholder pattern; cheap to render. |
| 13 | Cache buster bump | **No** | `SetRow` shape unchanged; persisted query cache structurally identical. Confirmed in Discovery. |

## Mudanças por arquivo

| File | Type | Change |
|---|---|---|
| `src/api/sets.ts` | edited | Add `UpdateSetMetaInput = { rpe?: string \| null; notes?: string \| null }` and `updateSetMeta(id, patch): Promise<SetRow>`. Implementation uses Supabase `.update(payload)` where `payload` is built **only** from keys present in `patch` (no clobber). One PostgREST round-trip. Single responsibility: write RPE and/or notes only. No change to `updateSet`. |
| `src/hooks/use-sets.ts` | edited | Add `useUpdateSetMeta(sessionId: string)` mutation wrapping `updateSetMeta`. `onSuccess` invalidates `["sets", sessionId]` and `["stats"]` (same surface as `useUpdateSet`). Single responsibility: expose the new API as a hook. |
| `src/components/set-row-menu.tsx` | new | New `<SetRowMenu>` bottom-sheet component. Owns local draft state for RPE chip + notes text. Receives `row`, `previousSet`, `visible`, `onClose`, and a single `onSubmit(patch: { rpe?: string \| null; notes?: string \| null })` callback. Closes on backdrop tap or X-button. See contract below. |
| `src/components/set-input.tsx` | edited | (a) Remove the inline RPE `<View className="w-14"><TextInput …/></View>` block. (b) Remove the `MessageSquare` notes-toggle `<Pressable>`. (c) Remove the conditional `notesOpen` `<TextInput>` panel. (d) Remove `rpe`, `notes`, `notesOpen` local state and their `useEffect` syncs (still keep `reps`, `weight`). (e) Drop `rpe` and `notes` from `commit()` payload — `onCommit({ reps, weight })`. (f) Add a new `<Pressable accessibilityLabel="Open set details" className="h-11 w-11 …">` rendering `<MoreHorizontal>` with the data-present blue tint. (g) Render `<SetRowMenu visible={menuOpen} … onSubmit={…} />` inside the row, calling the new `useUpdateSetMeta` mutation. **Note**: the `useUpdateSetMeta` hook does not belong inside `<SetInput>` — it belongs at the `<ExerciseBlock>` mount site (see below). Single responsibility per `<Pressable>`. |
| `src/components/exercise-block.tsx` | edited | (a) Header row (`:207-223`): drop the `<Text className="w-14 …">RPE</Text>` label and one of the two `<View className="w-7" />` trailing spacers; replace with a single `<View className="w-11" />` spacer for the menu trigger, keep one `w-7` for the trash. (b) Add an `onUpdateSetMeta?: (id: string, patch: { rpe?: string \| null; notes?: string \| null }) => void` prop. (c) Pass it to each `<SetInput>` as `onUpdateMeta`. (d) Update `onUpdateSet` callsite — `<SetInput>.onCommit` no longer carries `rpe`/`notes`, so the prop type narrows to `{ reps: number \| null; weight: string \| null }`. (e) Update `Props.onUpdateSet` signature to match. |
| `app/(app)/workout/[sessionId].tsx` | edited | (a) Add `const updateMeta = useUpdateSetMeta(sessionId);`. (b) Narrow `onUpdateSet` signature to `{ reps, weight }` only. (c) Add `onUpdateSetMeta={(id, patch) => updateMeta.mutateAsync({ id, patch })}` to each `<ExerciseBlock>`. Single responsibility per handler. |
| `app/(app)/history/[id].tsx` | edited | Same two additions as the workout screen: import `useUpdateSetMeta`, add the handler to `<ExerciseBlock>`. History detail must keep RPE/notes editable. |
| `src/components/set-input.tsx` (`<SetInput>` props update) | edited (counts under set-input.tsx above) | Add `onUpdateMeta: (patch: { rpe?: string \| null; notes?: string \| null }) => void` prop. Drops the legacy `onCommit` `rpe`/`notes` fields. |
| `tests/e2e/set-row-menu.spec.ts` | new | New Playwright e2e covering: open menu → tap RPE chip → close → reopen → confirm value persisted; type notes → close → reopen → confirm value persisted; clear RPE via "—" chip → confirm row no longer shows blue indicator. See test plan. |
| `tests/e2e/crud.spec.ts` | edited | If any assertion targets the old inline RPE input or `Toggle set notes` label, switch to the menu flow. (Discovery verified no current spec asserts these — likely no edit. Tester to confirm.) |

(Single-responsibility note: `set-input.tsx` carries three logical edits — remove RPE input, remove notes UI, add menu trigger — all serving the **same** goal: collapse the row to weight/reps/check + menu. Splitting would be artificial.)

## Page composition

### Live workout row (showCheckable=true)

**Before**:
```
┌────────────────────────────────────────────────────────────────────────────┐
│ [☐]  [•]  1   [ weight ]  [ reps  ]  [RPE]  [✉︎]  [🗑]                       │
└────────────────────────────────────────────────────────────────────────────┘
   44  28   24    flex-1      flex-1   56    28    28
```

**After (no data in menu)**:
```
┌────────────────────────────────────────────────────────────────────────────┐
│ [☐]  [•]  1   [   weight   ]  [   reps    ]  [⋯ gray]  [🗑]                  │
└────────────────────────────────────────────────────────────────────────────┘
   44  28   24      flex-1          flex-1        44       28
```

**After (RPE or notes set — indicator on)**:
```
┌────────────────────────────────────────────────────────────────────────────┐
│ [☐]  [•]  1   [   weight   ]  [   reps    ]  [⋯ blue]  [🗑]                  │
└────────────────────────────────────────────────────────────────────────────┘
```

### History detail row (showCheckable=false)

```
┌──────────────────────────────────────────────────────────────────┐
│ [•]  1   [   weight   ]  [   reps    ]  [⋯]  [🗑]                  │
└──────────────────────────────────────────────────────────────────┘
   28  24      flex-1          flex-1     44   28
```

### Column-header in `<ExerciseBlock>` (live)

**Before**: `[w-11 spacer] [w-7 spacer] # · Weight (kg) · Reps · RPE(w-14) · [w-7 spacer] [w-7 spacer]`

**After**: `[w-11 spacer] [w-7 spacer] # · Weight (kg) · Reps · [w-11 spacer for menu] [w-7 spacer for trash]`

### `<SetRowMenu>` bottom sheet

```
══════════════════════════════════════════════════════════════════════
  (rest of screen dimmed via bg-black/50)
══════════════════════════════════════════════════════════════════════
┌──────────────────────────────────────────────────────────────────┐ │
│  Set 3 · Bench Press                                       [X]   │ │
│                                                                  │ │
│  RPE                                                             │ │
│  ┌─┬───┬───┬───┬───┬───┬───┬───┬───┬───┬───┬───┐                  │ │
│  │—│ 5 │5.5│ 6 │6.5│ 7 │7.5│ 8 │8.5│ 9 │9.5│10 │  ← horizontal    │ │
│  └─┴───┴───┴───┴───┴───┴───┴───┴───┴───┴───┴───┘    scroll       │ │
│                                                                  │ │
│  ●  selected chip: bg-emerald-500 text-white                     │ │
│  ○  unselected:    border border-gray-300 text-gray-700          │ │
│  ◌  previous-set hint (only on the row matching                  │ │
│     previousSet.rpe when current rpe is empty):                  │ │
│     border-dashed border-gray-400 text-gray-500                  │ │
│                                                                  │ │
│  Notes                                                           │ │
│  ┌──────────────────────────────────────────────────────────┐    │ │
│  │ Notes for this set                                       │    │ │
│  │                                                          │    │ │
│  │                                                          │    │ │
│  │                                                          │    │ │
│  └──────────────────────────────────────────────────────────┘    │ │
│    (multi-line, 4 lines tall, ~96pt min-height)                  │ │
│                                                                  │ │
└──────────────────────────────────────────────────────────────────┘
   rounded-t-2xl bg-white dark:bg-gray-900 · px-6 pt-6 pb-10
```

Title: `"Set {row.set_number} · {exercise name}"` — exercise name is passed in from `<ExerciseBlock>` as a new prop on `<SetInput>` (`exerciseName: string`).

## Contratos de I/O

### `src/api/sets.ts`

```ts
export type UpdateSetMetaInput = {
  rpe?: string | null;
  notes?: string | null;
};

export async function updateSetMeta(
  id: string,
  patch: UpdateSetMetaInput,
): Promise<SetRow> {
  // Build the Supabase payload from *only* the keys present in patch. This
  // is the deliberate contrast with updateSet, which clobbers all four fields.
  const payload: { rpe?: string | null; notes?: string | null } = {};
  if (Object.prototype.hasOwnProperty.call(patch, "rpe")) payload.rpe = patch.rpe ?? null;
  if (Object.prototype.hasOwnProperty.call(patch, "notes")) payload.notes = patch.notes ?? null;

  const { data, error } = await supabase
    .from("sets")
    .update(payload)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as SetRow;
}
```

Notes:
- `Object.prototype.hasOwnProperty.call(...)` chosen over `key in patch` to defeat any prototype-shaped surprises; over `patch.rpe !== undefined` because we want to distinguish "key absent" from "key explicitly null" (the latter is the clear-RPE intent).
- `select().single()` returns the freshly updated row so the mutation can write it into the React Query cache without a refetch round-trip if Validator pushes for optimistic UX. (We don't ship optimistic in v1; we use plain `invalidateQueries`.)
- RLS: unchanged. The `sets` table policy gates on `auth.uid() = user_id`. No new columns, no new constraint, no schema change.

### `src/hooks/use-sets.ts`

```ts
export function useUpdateSetMeta(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateSetMetaInput }) =>
      updateSetMeta(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sets", sessionId] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}
```

Why also invalidate `["stats"]`: even though stats queries gate on `sessions.ended_at IS NOT NULL`, RPE on a historical (finished) session's set could become an input to a future stat. Matches `useUpdateSet`. Validator should confirm this is harmless and not surprising — same surface area as today.

### `src/components/set-row-menu.tsx`

```ts
type Props = {
  visible: boolean;
  onClose: () => void;
  setNumber: number;
  exerciseName: string;
  /** Current persisted value (one-decimal string like "9.0", or null). */
  initialRpe: string | null;
  /** Current persisted value, or null. */
  initialNotes: string | null;
  /** Previous-set RPE shown as a placeholder hint on the chip strip. */
  previousRpe: string | null;
  /**
   * Called whenever a field commits. RPE commits on chip tap; notes commits
   * on dismiss (close). Patch contains only the field(s) changed since the
   * sheet opened, never both unless both changed.
   */
  onSubmit: (patch: { rpe?: string | null; notes?: string | null }) => void;
};

export const RPE_CHIPS = [
  null, // "—" clear
  "5.0",
  "5.5",
  "6.0",
  "6.5",
  "7.0",
  "7.5",
  "8.0",
  "8.5",
  "9.0",
  "9.5",
  "10.0",
] as const;
```

### `src/components/set-input.tsx` — new props

```ts
type Props = {
  row: SetRow;
  unit: WeightUnit;
  previousSet?: SetRow | null;
  showCheckable?: boolean;
  onToggleChecked?: (nextChecked: boolean) => void;
  /** Now narrower: rpe/notes have moved out. */
  onCommit: (patch: { reps: number | null; weight: string | null }) => void;
  /** Called when the menu commits a metadata change. */
  onUpdateMeta: (patch: { rpe?: string | null; notes?: string | null }) => void;
  /** Used as the sheet title. */
  exerciseName: string;
  onDelete: () => void;
};
```

### `src/components/exercise-block.tsx` — prop additions

```ts
// onUpdateSet narrows: rpe/notes moved out
onUpdateSet: (
  id: string,
  patch: { reps: number | null; weight: string | null },
) => void;

// New prop
onUpdateSetMeta: (
  id: string,
  patch: { rpe?: string | null; notes?: string | null },
) => void;
```

### DB columns / queries

- **No DDL change.** `sets.rpe numeric(3,1)` and `sets.notes text` unchanged; both already nullable.
- **No new index.** All writes hit a single row by PK.
- **No RLS change.** Existing policies on `public.sets` already cover the partial-update path because RLS gates on `auth.uid() = user_id` regardless of which columns the UPDATE payload mentions.

## Test plan

### Unit (Vitest, `tests/unit/...`)

1. **`tests/unit/api-sets.updateSetMeta.test.ts`** (new) — mock the `supabase` module:
   - Asserts payload includes only the keys present in `patch`. Calling `updateSetMeta(id, { rpe: "9.0" })` issues `.update({ rpe: "9.0" })` exactly. Calling `updateSetMeta(id, { notes: "hard" })` issues `.update({ notes: "hard" })`. Calling `updateSetMeta(id, { rpe: null, notes: null })` issues `.update({ rpe: null, notes: null })` (explicit clears). Calling `updateSetMeta(id, {})` issues `.update({})` (or short-circuits — Designer-permissive: Validator may push for a no-op).
   - Asserts the mock's `.eq("id", id).select().single()` chain is invoked.
2. **`tests/unit/use-sets.useUpdateSetMeta.test.ts`** (new) — uses `@tanstack/react-query` test harness:
   - On successful mutation, both `["sets", sessionId]` and `["stats"]` query keys are invalidated.

### Component (RNTL / web-first via Playwright)

3. **Component test for `<SetRowMenu>`** (`tests/unit/set-row-menu.test.tsx` or e2e — Designer leaves the harness choice to Tester):
   - Initial render with `initialRpe="9.0"` highlights the `9` chip; clear chip (`"—"`) is rendered but not selected.
   - Tap the `8.5` chip → `onSubmit({ rpe: "8.5" })` fires immediately.
   - Tap the `"—"` chip → `onSubmit({ rpe: null })`.
   - Type into notes → no `onSubmit` until close. On `onClose`, fires `onSubmit({ notes: <typed text> })` (only if notes changed). If RPE *also* changed via chip and the user typed notes, two separate `onSubmit` calls (chip-time + close-time) — not one merged.
   - Backdrop tap fires `onClose` (with the implicit notes commit if dirty).
   - Previous-set hint: when `initialRpe == null` and `previousRpe = "9.0"`, the `9` chip renders with the dashed-border hint style and is not "selected".

### E2E (Playwright, `tests/e2e/set-row-menu.spec.ts` — new)

4. **Golden path — RPE persistence**:
   - Sign in, start a workout, add a working set, fill weight + reps + check it.
   - Tap the new `MoreHorizontal` icon — assert sheet visible.
   - Tap the `9` chip — assert the chip is now selected.
   - Tap backdrop to dismiss — assert sheet hidden.
   - Confirm the `MoreHorizontal` icon on the row is blue-tinted.
   - Reload the page — assert the row indicator still blue, and reopening the menu still shows `9` selected.

5. **Golden path — Notes persistence**:
   - Open menu on the same row, type "Felt heavy" into notes, dismiss.
   - Assert indicator still blue (RPE + notes both set).
   - Reload, reopen menu, assert notes textarea contains "Felt heavy".

6. **Clear RPE**:
   - Open menu, tap `"—"` chip, dismiss.
   - Assert indicator is still blue (because notes are still set).
   - Clear notes (empty out the textarea), dismiss.
   - Assert indicator is now gray.

7. **History detail editability**:
   - Open a finished session in history detail, tap menu on a set with RPE present, change to a different chip, dismiss.
   - Reload, reopen, assert the new value persisted.

### Regression (run existing suite)

8. **No e2e currently asserts the old inline RPE `<TextInput>` or `Toggle set notes` label** (verified by Discovery). The existing test suite (`crud.spec.ts`, `remove-exercise.spec.ts`, `soft-deleted-exercises-in-history.spec.ts`, `exercise-progress-ia.spec.ts`) should continue to pass unchanged. Tester to confirm.

## Riscos

### Data integrity (RLS, migrations)
- **No migration**, no schema change, no RLS policy change. `sets.rpe` and `sets.notes` columns unchanged; existing UPDATE RLS policies pre-approve the new partial UPDATE because they gate on `auth.uid() = user_id` row-wise, not on the column set.
- **Footgun in `updateSet` still exists**: this run did not change `updateSet`'s clobber semantics (Conductor lean (c), not (a)). Any future caller that uses `updateSet({ rpe: "9.0" })` expecting "RPE only" will still null `reps`, `weight`, `notes`. We mitigate with: (i) a short JSDoc warning on `updateSet`, (ii) `updateSetMeta` being the documented preferred path for partial RPE/notes writes. **Validator should call this out if it wants the clobber fixed in this run; Designer's recommendation: leave it for a follow-up to minimize blast radius.**
- **Partial-update concurrency**: if the user is mid-typing weight/reps and another device updates RPE via `updateSetMeta`, the `["sets", sessionId]` query will invalidate and refetch — the row's local `weight`/`reps` state in `<SetInput>` will be overridden by the next render. This is the same race that exists today for any field; not a regression.

### UX regressions
- **Shared component**: `<SetInput>` is the only set-row component, used in both live workout (`workout/[sessionId].tsx`) and history detail (`history/[id].tsx`). Both must keep RPE + notes editable via the menu — verified in design above by routing `useUpdateSetMeta` in both screens.
- **Existing e2e specs** (`crud.spec.ts:99`) use a session-level "notes" field, not the per-set notes input. Discovery confirmed zero specs touch the inline RPE input or `Toggle set notes` label. Confidence: HIGH that the removal does not cascade.
- **First-time user discoverability**: the new `MoreHorizontal` icon is small and gray by default. A user who never had RPE set on a row may not realize the menu exists. The accessibility label `"Open set details"` is queryable via screen readers; the icon is precedent-aligned (Strong-style) and the tap target is `h-11 w-11`. We accept this; spec calls for "subtle".
- **Sheet dismissal on text input field**: React Native `<Modal>` keyboard handling on iOS — the multi-line `<TextInput>` may sit under the keyboard. Use `keyboardShouldPersistTaps="handled"` on the parent `<ScrollView>` (if introduced) and `KeyboardAvoidingView` to lift the card. Plate-calculator gets away without this because its only field is short and at the top of the card. Notes is multi-line and at the bottom — bigger risk. **Designer specifies KeyboardAvoidingView with `behavior={Platform.OS === "ios" ? "padding" : undefined}` wrapping the inner card.**
- **Tap target inflation for trash + menu**: today's trash icon is `rounded p-1` (~`h-7 w-7`) — under 44pt. We're adding a new `h-11 w-11` menu trigger next to it. Trash stays at p-1 to avoid scope creep; Validator may flag the size mismatch but it's pre-existing tap-target debt called out in `docs/iphone-shakedown.md`. Out of scope.

### Platform-specific (iOS / Android / web)
- React Native `<Modal animationType="slide" transparent>` works cross-platform via React Native Web — verified at `plate-calculator.tsx`. No divergence expected.
- The chip strip uses horizontal scroll (`<ScrollView horizontal showsHorizontalScrollIndicator={false}>` ). On web, this maps to overflow-x: auto. Verify: chip widths are content-sized, not fixed, to avoid mobile/web layout drift.
- `MoreHorizontal` is a lucide icon, already used elsewhere in lucide-react-native — same import, same component on all three platforms.

### Performance
- **One extra PostgREST round-trip per RPE chip tap.** Today RPE was inline and committed on blur (one round-trip per row when leaving the input). Chip taps are at most 1-2 per set in normal usage. Within budget.
- **One extra round-trip per menu dismiss with dirty notes**. Same order of magnitude as today's notes-blur commit.
- **No extra rendering pressure on the row** — the sheet is rendered conditionally (`visible={menuOpen}` — React Native `<Modal>` does not render children when `visible=false`). No always-on cost.
- **Cache invalidation surface unchanged**: `["sets", sessionId]` + `["stats"]` — same as `useUpdateSet`.

## Alternativas descartadas

1. **Inline expandable panel (the existing notes panel, extended)** — descartada porque the 11-chip RPE strip plus a multi-line notes field plus a clear option won't fit comfortably inside the existing inline panel on a 320pt iPhone-SE width without horizontal-scrolling the chip strip *inside* an already small space; bottom-sheet is more legible and matches the "focus on this one set" intent of moving the controls behind a tap.

2. **Option (a) — fix `updateSet` to spread-only** — descartada porque (i) it's a behavior change for an API that has many callers (every weight/reps commit on the row), each of which today passes the full 4-field patch from local state; (ii) Validator load for `updateSet` semantics widens beyond this feature's scope; (iii) the new `updateSetMeta` is just as surgical, costs one extra exported symbol, and **leaves the door open** to migrate to (a) in a future run with its own test sweep.

3. **Option (b) — menu re-commits all four fields from local row state** — descartada porque it forces the menu component to read live `weight`/`reps` state from `<SetInput>`, which would either require lifting state up to `<SetInput>` (one big refactor) or passing both fields plus their setters into `<SetRowMenu>` (leaky and over-coupled). The menu would also race the row's blur commit — two writers, same fields.

4. **`@gorhom/bottom-sheet` library** — descartada porque no sheet library is currently installed; `plate-calculator.tsx` proves the hand-rolled `<Modal>` pattern is good enough for this scope; adding a library is more dependency surface than we need for one extra sheet.

5. **Put delete inside the menu too** — descartada porque the spec explicitly does not ask for it and the Conductor flagged it out of scope; deleting via a separate row icon also matches Strong's UI and provides a 1-tap destructive affordance. Could be a follow-up run if friction emerges.

6. **Different RPE range (`6 → 10` instead of `5 → 10`)** — descartada porque the prompt explicitly lists `5` as the bottom and the Conductor confirmed shipping the spec range. We can narrow later if user feedback shows sub-6 chips are unused.

## Out of scope

- Fix `updateSet`'s clobber footgun. Tracked above; recommend a follow-up run.
- Move the trash icon into the menu (Discovery #9).
- Add a "previous set" visible column to the row. The prompt's "previous" wording refers to placeholders, not a new column (Discovery clarification). Today's placeholder cascade already works.
- Tap-target inflation on the trash icon (pre-existing debt in `docs/iphone-shakedown.md`).
- Inline rest-timer affordances, plate-calculator integration, or any other row-level feature.
- Schema / migrations: zero. Stay out of `supabase/migrations/`.
- Importer / `scripts/`: zero touch.
- Cache buster bump in `src/lib/query-client.ts`: not needed; `SetRow` shape unchanged.
- Active session banner, weekly-volume-strip, volume-target-slot: not touched.
