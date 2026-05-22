# Discovery — 2026-05-22_1000_set-row-declutter

## Feature prompt

> Set row declutter — move RPE + notes behind a per-row menu. Today the set row crams everything inline (previous, weight, reps, RPE, check). RPE isn't used for every exercise or every set; the inline input is noise most of the time. Same for notes.
>
> Spec:
> - Add a small icon button on the set row, immediately to the right of the check button. Tapping it opens a per-row menu (bottom sheet or expandable inline panel — Designer call).
> - The menu contains: RPE selector + Notes field.
> - **RPE is a selector, not an input**, with the standard Strong-style values: `10, 9.5, 9, 8.5, 8, 7.5, 7, 6.5, 6, 5.5, 5` (Designer can refine the range — these are the common ones).
> - Notes input is moved from the row into the menu.
> - Default visual state of the row: weight + reps + previous + check only. Cleaner default.
> - The menu icon should show a subtle indicator when there's data behind it (RPE or note set), so the user knows there's something to expand.

## Scope summary

Restructure `<SetInput>` (the per-set row component used in both the live workout screen and the history detail screen) so the inline RPE numeric input and the existing notes-toggle/notes-input are replaced by a single "more" icon that opens a per-row menu containing an RPE selector + notes field. No DB / API / hook changes are required — `useUpdateSet` already accepts partial `{rpe?, notes?}` patches, and the `rpe` column is already `numeric(3,1)` storing string-formatted values like `"9.5"`.

## Affected files (verified)

- `src/components/set-input.tsx:1-208` — **the file to change**. Current row owns inline `<TextInput keyboardType="decimal-pad">` for RPE (`:161-172`), a `MessageSquare` toggle for notes (`:174-181`) plus a conditional `<TextInput>` for notes content (`:193-205`), and a `Trash2` delete icon (`:183-190`). It owns local React state for `rpe`, `notes`, `notesOpen`. `commit` writes all four fields (`reps`, `weight`, `rpe`, `notes`) on blur or submit.
- `src/components/exercise-block.tsx:207-223` — column-header row for the set list. Includes a `w-14` "RPE" column label (`:219`) and two `w-7` trailing spacers (`:220-221`) that mirror the notes + trash icons in the row. Both need to shrink/move to match the new row layout.
- `src/components/exercise-block.tsx:225-240` — where `<SetInput>` is mounted. Props flowing through are `row`, `unit`, `previousSet`, `showCheckable`, `onToggleChecked`, `onCommit`, `onDelete`. No new props are required at this layer if the menu lives inside `<SetInput>`.
- `app/(app)/workout/[sessionId].tsx:379-385` — `onUpdateSet` handler. Calls `updateSet.mutateAsync({ id, patch })` with the patch shape from `<SetInput>.onCommit`. Already forwards `rpe` + `notes` fields. No change required here.
- `app/(app)/history/[id].tsx:239-277` — history detail mounts the **same** `<ExerciseBlock>` and `<SetInput>` (read-write — `updateSet`, `logSet`, `deleteSet` are all wired). Today RPE/notes are editable here too. The new menu therefore must work on history detail by default.
- `src/db/types.ts:120,123` — `SetRow.rpe: string | null`, `SetRow.notes: string | null`. Both nullable. No change required.
- `src/db/schema.ts:145` — `rpe: numeric("rpe", { precision: 3, scale: 1 })`. No `CHECK` constraint on RPE range — accepts any value the column can store (i.e. `−99.9` to `99.9`). App-level validation is the only gate.
- `src/api/sets.ts:15-20,77-94` — `UpdateSetInput = { reps?, weight?, rpe?, notes? }` plus `updateSet(id, patch)` which `.update()` with **all four fields each call** (line 82-88): `reps: patch.reps ?? null, weight: patch.weight ?? null, rpe: patch.rpe ?? null, notes: patch.notes ?? null`. **The current implementation overwrites every field on every call** — if you pass `{rpe: "9"}` only, `reps`, `weight`, `notes` get nulled. This is a latent footgun for the new design.
- `src/hooks/use-sets.ts:53-63` — `useUpdateSet` thin wrapper around `updateSet`. Same semantics as above.
- `src/components/choose-action-modal.tsx:1-108` — existing modal primitive. Centered card with vertical button stack on `bg-black/40` backdrop. Not a bottom-sheet shape, and the API takes a fixed `buttons: ChooseActionButton[]` list — no room for arbitrary form content like an RPE picker + notes input. **Not reusable as-is for this menu.**
- `src/components/plate-calculator.tsx:69-153` — existing **bottom-sheet-shaped** modal: `<Modal animationType="slide" transparent>` + `<View className="flex-1 justify-end bg-black/50">` + inner card with `rounded-t-2xl bg-white px-6 pb-10 pt-6`. **Closest precedent for a bottom-sheet pattern in this repo.** Hand-rolled, no library.
- `src/components/exercise-picker.tsx` — second hand-rolled `<Modal>` (full-screen list picker). Not a bottom sheet.
- `tests/e2e/*.spec.ts` — searched: **zero specs touch the inline RPE input or the notes toggle/input on the set row.** The only `notes` reference is in `crud.spec.ts:99` (a session-level notes comment, unrelated). The only `rpe` references in the repo live in `src/components/set-input.tsx`, `src/components/exercise-block.tsx`, `src/api/sets.ts`, `src/db/schema.ts`, and `src/db/types.ts`. No test-update fan-out for this run.

## Relevant conventions (verified by reading code)

- **Icon library**: `lucide-react-native` everywhere (verified across 20+ component imports). Candidate icons available (all in lucide): `MoreHorizontal`, `MoreVertical`, `Settings2`, `Sliders`, `ChevronDown`, `Sliders2`, `SlidersHorizontal`. Currently in use elsewhere: `ChevronDown/Up/Right`, `Trash2`, `Plus`, `Pencil`, `Search`, `X`, `MessageSquare`, `CheckSquare`, `Square`, `Calculator`, `Ruler`.
- **Indicator-when-data-present precedent**: `set-input.tsx:180` — the existing notes toggle already does this: `color={notes.trim() ? "#3b82f6" : "#9ca3af"}`. Blue-500 when populated, gray-400 when empty. This is the in-codebase pattern to reuse.
- **PR / "data present" badge precedent**: `weekly-volume-strip.tsx:182,188` and `volume-target-slot.tsx:127` use `emerald-500/600/400` for "PR / surpassed". `exercises-this-week-list.tsx:112-113` uses `bg-emerald-100 dark:bg-emerald-900 + text-emerald-700` as a chip. These are stronger semantic colors than the blue tint and probably **not** the right fit for "this row has data behind the menu" — blue (matches the existing notes-icon tint) is more consistent.
- **Tap target**: 44×44 minimum per iPhone HIG. Established in this codebase at `set-input.tsx:119` for the check button (`h-11 w-11`). Other small icons on the row (notes-toggle, trash) use `rounded p-1` only — `set-input.tsx:178,187`. Those are below 44pt and are pre-existing tap-target debts (visible in iphone-shakedown.md). The new menu trigger should be `h-11 w-11` to comply.
- **Bottom-sheet pattern (hand-rolled)**: `plate-calculator.tsx:70-72` — `<Modal animationType="slide" transparent>` + `<View className="flex-1 justify-end bg-black/50">` + inner card `rounded-t-2xl bg-white px-6 pb-10 pt-6 dark:bg-gray-900`. No `@gorhom/bottom-sheet` or any sheet library installed (`grep -r "@gorhom\|bottom-sheet" package.json src` returns nothing).
- **Modal close affordance**: `plate-calculator.tsx:77-79` — top-right `<Pressable onPress={onClose} accessibilityLabel="Close">` with `X` icon. `choose-action-modal.tsx:62-65` — backdrop tap dismisses. Both patterns acceptable.
- **Color tokens**: app uses NativeWind/Tailwind classes (`gray-100/200/500/800/900`, `blue-50/500/950`, `emerald-100/400/500/600/700/900`, `red-50/200/500/600/900/950`). Dark-mode pairs always provided.
- **Form persistence**: every field in the row commits on `onBlur` and `onSubmitEditing` (`set-input.tsx:139,140,153,154,166,167,198,199`). The new menu should follow the same pattern — but with the partial-patch footgun in `updateSet` (see Constraints below), we cannot simply call the existing `onCommit` from inside the menu unless every menu interaction recommits **all four fields** (reps, weight, rpe, notes) using the latest local state.
- **RPE display today**: `parseFloat0(rpe)?.toFixed(1) ?? null` — always one decimal (`9.0`, `9.5`, `10.0`). The Strong-style values in the prompt (`10, 9.5, 9, 8.5, …, 5`) align with this format.
- **Run / artifact naming**: timestamps in BRT, slug = 2-4 kebab words. Already applied to this run's folder.
- **Documentation style for designs**: refer to `docs/runs/2026-05-21_1308_set-check-button/design-v1.md` (most recent set-row touching design). Uses "Mudanças por arquivo", "Contratos de I/O", "UI spec" sections in Portuguese-ish headers — that's the precedent template for this codebase's designs.

## Constraints

- **Data**: no schema change required. `sets.rpe numeric(3,1)` already nullable, no value-range CHECK constraint. `sets.notes text` already nullable, no length limit. Writing a single RPE field uses `updateSet` which **clobbers reps/weight/notes** on each call (`src/api/sets.ts:82-88`) — the row component compensates today by recommitting all four fields at once from its local state. The new menu must preserve this invariant or `updateSet` itself must be changed to a true partial update. **The cleanest fix: change `updateSet` to spread-only the provided keys and pass the patch through unchanged** — but that's a behavior change and Designer should call it.
- **UI**:
  - NativeWind/Tailwind classes for styling.
  - The current set row column budget (live session, `showCheckable=true`) is:
    `[check 44] [badge 28] [# 24] [weight flex-1] [reps flex-1] [rpe 56] [notes 28] [trash 28] + gaps gap-2 ≈ 14`. On iPhone-X-class widths (375pt content) that leaves the two flex-1 inputs roughly `(375 − 44 − 28 − 24 − 56 − 28 − 28 − 32 − 32) / 2 ≈ 51pt each` — already cramped. On iPhone-SE 320pt it's `≈ 28pt each` — visibly squeezed (this is the noise the prompt complains about). Removing the RPE (`w-14`) and notes (`w-7`) inline columns frees `≈ 84pt` minus the width of one new menu trigger (`w-11` = 44pt). Net gain on every row: `≈ 40pt`, redistributed into the two flex-1 weight/reps inputs.
  - The "previous" field referenced in the prompt is **not a column on the row today** — `previousSet` is consumed only as placeholder text inside the weight/reps/rpe inputs (`set-input.tsx:70-78`). There's no separate "previous" column to keep. **Spec wording "weight + reps + previous + check" should be read as "weight + reps (with previous-set as placeholder) + check"** — Designer should confirm whether to add a visible previous column or keep the current placeholder pattern.
  - Header row in `<ExerciseBlock>:207-223` mirrors the row and needs to drop the `"RPE"` label and the two trailing spacers, and probably add a single spacer for the menu trigger.
  - Both live workout (`showCheckable=true`) and history detail (`showCheckable=false`) render the same `<SetInput>`. The menu trigger should appear in both, with the icon to the right of the check button (live) or right of the set-number column (history). Spec says "immediately to the right of the check button" — for history-detail where there is no check button, the trigger should sit at the equivalent left-of-row position.
- **Platform**: Expo Router universal app (iOS / Android / web). The React Native `<Modal>` primitive works on all three via React Native Web (confirmed by `choose-action-modal.tsx` and `plate-calculator.tsx` already shipping). No `@gorhom/bottom-sheet` available — sheet must be hand-rolled per the plate-calculator pattern.
- **Auth**: nothing changes. `updateSet` already runs under RLS-scoped Supabase JS client.
- **Performance**: each menu close that triggers a commit issues one `updateSet` PostgREST round-trip. Same cost as today. No batching needed.
- **Accessibility**: every interactive element in the row currently has `accessibilityLabel` + `accessibilityRole="button"` (`set-input.tsx:115-119, 175-178, 184-187`). E2E specs use `page.getByLabel(...)` heavily — any new icon button must have a stable label. The existing label `"Toggle set notes"` (line 176) goes away with the notes-inline-toggle and isn't asserted in any e2e (verified).

## Existing precedents

- **`docs/runs/2026-05-21_1308_set-check-button/design-v1.md`** — the most recent feature touching this exact row. Established (a) the `h-11 w-11` tap target for row icons, (b) the `showCheckable` prop pattern to opt history detail out of live-only affordances, (c) the column-header spacer-gating in `<ExerciseBlock>`, (d) the cross-platform `<Modal>`-based dialog approach. Strongly recommended read for the Designer — the new feature should follow the same shape.
- **Hand-rolled bottom sheet**: `src/components/plate-calculator.tsx:69-153` — exact template for the per-row menu if Designer picks bottom-sheet over inline-expand.
- **Icon-colored-when-data-present**: `src/components/set-input.tsx:180` — blue-500 when `notes.trim()`, gray-400 otherwise. This is the existing "indicator" pattern. The new "menu has data" badge should follow it (color tint, or add a tiny dot — both fine; tint is precedent-aligned).
- **Inline-expand precedent on the same row**: `src/components/set-input.tsx:193-205` — the notes input today appears as an inline expansion below the row when `notesOpen`. Designer could keep this exact pattern and just put the RPE selector + notes input inside it, rather than introducing a bottom sheet. Trade-off: inline expansion scrolls with the list and doesn't dim the rest of the screen; bottom sheet is more modal but adds a new component.
- **Type-badge as small visual marker**: `src/components/set-input.tsx:128-132` — `h-7 w-7 items-center justify-center rounded-full` with single-character text. Reusable pattern for an "indicator dot" on the new menu trigger.
- **`previousSet` placeholder cascade**: `src/components/exercise-block.tsx:98-118` — computes "the prior in-session set with weight+reps, else last cross-session working set". Already drives the `rpe` placeholder via `previousSet?.rpe`. If the menu shows RPE, the placeholder "9.5" hint from the previous set should still be visible inside the menu.

## Unknowns (require Designer judgment or human decision)

1. **Menu form factor**: bottom sheet vs inline expandable panel. Prompt explicitly leaves this to Designer. Trade-off:
   - **Inline expand** (existing notes-panel pattern at `set-input.tsx:193-205`): smaller new surface, keeps everything in one component, scrolls with the row, doesn't dim the rest. But the RPE selector with 11 values would need horizontal scrolling on narrow iPhones inside an inline panel.
   - **Bottom sheet** (plate-calculator pattern at `plate-calculator.tsx:69-153`): more room for the RPE chip grid, modal feel ("focus on this one set"), dismisses cleanly. Adds a new component. Closes when the user taps anywhere else.
   - Conductor leans bottom-sheet for the chip grid layout. Designer call.
2. **Icon choice** for the menu trigger. Candidates in `lucide-react-native`: `MoreHorizontal` (the conductor's lean), `MoreVertical`, `Settings2`, `Sliders` / `SlidersHorizontal`, `ChevronDown`. The codebase already uses `ChevronDown` for the exercise-block "more set types" expand (`exercise-block.tsx:260`), so reusing it here risks visual confusion. **Conductor lean: `MoreHorizontal`.** Designer to confirm.
3. **Indicator style**: tint the icon (precedent at `set-input.tsx:180`, blue-500 when data present) vs add a small dot/badge next to it (no in-row precedent; closest is the rounded type-badge at `:128-132`). **Conductor lean: tint** — minimal-surface, matches existing notes-icon behavior, no new visual primitive. Designer to confirm whether tint alone is "subtle enough" per spec wording.
4. **Clear/none option in the RPE selector**: prompt lists `10, 9.5, 9, ..., 5`. To unset RPE after setting it, the menu needs a "—" / "Clear" chip. **Conductor lean: include it** (otherwise the only way to clear is to delete the set or fight the schema). Designer call.
5. **Lower bound of the RPE range**: prompt lists down to `5`. Strong's actual UI starts at RPE 6 (sub-6 is warmup-territory). The spec explicitly says "Designer can refine the range — these are the common ones". **Conductor lean: ship the spec'd 11 values (`5 → 10` in 0.5 increments).** Designer call — could narrow to `6 → 10` (9 values).
6. **`updateSet` partial-patch behavior**: as flagged in Constraints, `src/api/sets.ts:82-88` clobbers all four fields on every call. Today the row sidesteps this by always committing all four from local state. The new menu introduces a more-natural "edit RPE only" interaction. **Options for Designer:**
   - (a) Change `updateSet` to spread only the provided keys (`...patch`) — cleanest, smallest API change, future-proofs the API but is technically a behavior change for callers who passed `{rpe: undefined}` expecting it to null out (no such caller exists today — verified).
   - (b) Keep the API; the new menu always passes the full `{reps, weight, rpe, notes}` patch (joining current row state with new menu state). Works but forces the menu component to know about reps/weight too.
   - (c) Add a new `updateSetMeta(id, { rpe?, notes? })` helper that only writes those two fields. Most surgical but adds API surface.
   - **Conductor lean: (a)** — the right fix for a clobber footgun. Designer call.
7. **Accessibility label for the menu trigger**: `"More set options"`, `"Open set details"`, `"RPE and notes"`, etc. **Conductor lean: `"Open set details"`** — short, says what's behind it without leaking implementation. Designer call.
8. **Read-only RPE/notes in history detail?**: spec doesn't say. History detail (`app/(app)/history/[id].tsx:239-277`) is currently fully editable for sets (RPE, notes, reps, weight, delete, add). Behavior parity says: the menu should be editable on history detail too. **Conductor lean: editable everywhere `<SetInput>` is rendered, no opt-out.** Designer call.
9. **Should the menu also house Delete?**: today the trash icon sits to the right of the notes icon on the row. Moving it inside the menu would clean the row further. Spec doesn't ask for this — but if the menu exists, it's a natural home. **Conductor lean: out of scope for v1, keep trash on the row.** Designer call — could be a follow-up.
10. **Where the menu's "save" semantics live**: today notes commits on blur + close. The bottom-sheet pattern would naturally commit on dismiss. The chip-selector RPE could commit on tap (immediate) or commit on dismiss (batched with notes). **Conductor lean: chip tap commits RPE immediately; notes commits on blur or dismiss.** Designer call.
11. **Header-row layout under `<ExerciseBlock>:207-223`**: with RPE/notes columns gone, what does the header show? Today: `[spacer-check] [spacer-badge] [#] [Weight (kg)] [Reps] [RPE] [spacer-notes] [spacer-trash]`. After: probably `[spacer-check] [spacer-badge] [#] [Weight (kg)] [Reps] [spacer-menu] [spacer-trash]`. **Conductor lean: drop "RPE" label, keep two trailing spacers (one for menu trigger, one for trash). Verify alignment manually.** Designer call.
12. **`previousSet?.rpe` placeholder inside the new RPE selector**: should the chip for the previous-set RPE be highlighted as a hint (e.g. dotted outline) before the user picks? **Conductor lean: yes — it's the existing pattern (placeholders show prior values).** Designer call.
13. **Cache buster bump?**: no schema change, no DB type widening, no new column. The persisted TanStack Query cache stores `SetRow` shape unchanged. **Conductor lean: no bump needed.** Designer to confirm.

## Out-of-scope flags

- **No new tests are forced by the existing e2e suite** — no spec asserts the inline RPE input or notes toggle (verified by grep). Designer / Tester can choose to **add** a new spec covering the menu (recommended, but not mandated by regression coverage).
- **Trash button placement and behavior**: unchanged.
- **Check button placement and behavior**: unchanged (precedent at `set-input.tsx:111-127`).
- **Exercise-block-level "more" menu** (`exercise-block.tsx:254-296`): that's a separate "+ Warm-up / + Drop set" picker. Not touched by this run.
- **Schema / migrations**: no DB change. Stay out of `supabase/migrations/`.
- **Importer / scripts**: only `scripts/create-user.ts` exists; doesn't touch RPE. No work here.
- **History detail screen layout changes** beyond the row component itself. The screen mounts `<ExerciseBlock>` unchanged.
- **Active session banner / rest timer / volume target slot**: unrelated; do not touch.
- **Cache buster `src/lib/query-client.ts`**: skip unless Designer identifies a serialization-shape change (none expected).
- **`useUpdateSet` mutation invalidation set**: stays as-is (invalidates `["sets", sessionId]` and `["stats"]`). Adequate for menu-driven updates.
