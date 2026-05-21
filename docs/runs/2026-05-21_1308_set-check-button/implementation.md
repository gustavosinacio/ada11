# Implementation — 2026-05-21_1308_set-check-button

Based on: `design-v2.md` (binding) and `validation-v2.md` (matching `go`, 1 major + 4 minors).

## Files changed

### Migration
- `supabase/migrations/0007_set_completed_at_nullable.sql` (new) — `ALTER TABLE public.sets ALTER COLUMN completed_at DROP NOT NULL;`. Header comment documents the new semantics (null = unchecked draft, non-null = checked/persisted), no backfill, no RLS impact.

### Drizzle / types
- `src/db/schema.ts` (edited) — dropped `.notNull()` on `completedAt` (was line 149, now annotated with comment block).
- `src/db/types.ts` (edited) — widened `SetRow.completed_at` from `string` to `string | null`.

### API helpers
- `src/api/sets.ts` (edited):
  - `listSetsForSession` — added `nullsFirst: false` and secondary `.order("set_number", { ascending: true })` per MAJ-3 / design.
  - `logSet` — inserts `completed_at: null` instead of `now()`. New sets are unchecked drafts.
  - Added `checkSet(id)`, `uncheckSet(id)`, `bulkCheckAllInSession(sessionId)`, `bulkSoftDeleteUncheckedInSession(sessionId)`. The bulk-soft-delete reads unchecked ids first, then runs two updates (rows themselves, then cascade to unchecked dropset children only) sharing a single `nowIso` timestamp.

- `src/api/progress.ts` (edited) — `listSetsForExercise` gains secondary `.order("set_number", { ascending: true })` to break intra-session timestamp ties from `bulkCheckAllInSession`.

### Hooks
- `src/hooks/use-sets.ts` (edited) — added `useCheckSet`, `useUncheckSet`, `useBulkCheckAllInSession`, `useBulkSoftDeleteUncheckedInSession`. All four invalidate only `["sets", sessionId]`; finish-flow covers `["stats"]` + `["progress"]` (verified `use-sessions.ts:62-63`).

### Cross-platform modal (new)
- `src/components/choose-action-modal.tsx` (new) — N-option dialog using React Native `<Modal transparent animationType="fade">`. Each button is a `<Pressable>` with `accessibilityLabel = label` (e2e selector). All buttons `min-h-11` (MIN-2). Backdrop tap dismisses via `onClose`. Variants: `primary` (filled black/white), `destructive` (red), `default` (outlined).

### Live workout screen
- `app/(app)/workout/[sessionId].tsx` (edited):
  - Imports `useCheckSet`, `useUncheckSet`, `useBulkCheckAllInSession`, `useBulkSoftDeleteUncheckedInSession`, and `ChooseActionModal`.
  - Computes `uncheckedCount` from `setsQ.data`.
  - `onFinish`: if `uncheckedCount === 0`, falls through to today's `confirmDelete` (zero behavior change for the 3 unedited e2e specs). Otherwise opens the new 3-option modal.
  - Handlers `handleCheckAllAndFinish` and `handleDiscardUncheckedAndFinish` run the matching mutation then `finishAfterMutation()`; on bulk failure they early-return without finishing (matches design Decisions 8/9).
  - Each `<ExerciseBlock>` now receives `showCheckable` and `onToggleSetChecked` that dispatches `checkSetM`/`uncheckSetM` based on `nextChecked`.
  - Modal mounted at the screen root (per Designer's note in the file plan: "Implementer's call" between root layout vs. screen-local — chose screen-local for simplicity since the modal is only invoked here).

### Shared components
- `src/components/exercise-block.tsx` (edited) — adds `showCheckable?: boolean` (default `false`) and `onToggleSetChecked?: (setId, nextChecked) => void` props. When `showCheckable`, the header row prepends an additive `w-11` spacer (MIN-3: kept the existing `w-7` badge spacer, did not replace it). History detail passes neither prop → visual parity preserved.

- `src/components/set-input.tsx` (edited) — adds `showCheckable?: boolean` (default `false`) and `onToggleChecked?` props. When `showCheckable`, prepends a `h-11 w-11` `<Pressable>` with `Square` (unchecked, `#9ca3af`) or `CheckSquare` (checked, `#3b82f6`). `accessibilityLabel`: `"Mark set as completed"` when unchecked / `"Unmark set as completed"` when checked. Row gets `bg-blue-50 dark:bg-blue-950/30` tint when checked.

### Cache buster
- `src/lib/query-client.ts` (edited) — bumped `queryCacheBuster` from `"schema-2026-05-19-muscles"` to `"schema-2026-05-21-set-check"`.

### e2e tests
- `tests/e2e/soft-deleted-exercises-in-history.spec.ts` (edited) — after logging the 2 working sets, tap `page.getByLabel("Mark set as completed").first().click()` twice. Per validator MIN-4, used `.first()` twice (auto-relocates after each tap), not `.nth(0)` / `.nth(1)`. With both sets checked, `uncheckedCount === 0` at Finish → falls back to `window.confirm` → existing `page.once("dialog", ...)` listener works unchanged.
- **NOT edited** per validator MAJ-1: `tests/e2e/crud.spec.ts`, `tests/e2e/remove-exercise.spec.ts`, `tests/e2e/exercise-progress-ia.spec.ts`. All three reach Finish with zero non-deleted sets → `uncheckedCount === 0` → existing path.

## Deviations from design

- **Modal host location**: Design §Mudanças por arquivo says "Mount `<ChooseActionModalHost />` once at the root layout (`app/_layout.tsx`)". The file plan in the implementer prompt §11 says: "Designer chose root; you can put it in the workout screen for simplicity. Implementer's call." Picked screen-local (`workout/[sessionId].tsx`). Rationale: the modal is only invoked from the live workout screen; mounting it at the root would have required introducing the singleton-resolver pattern (`useSyncExternalStore`, module-scope `openResolver`) for zero immediate benefit. Direct prop-driven `visible` is simpler and matches `ExercisePicker` / `PlateCalculator` precedents already used on this same screen. The component itself stays parameterized so a future caller can also mount it.
- **`ChooseActionModal` API**: Design sketched a `chooseAction(opts): Promise<string>` function-style API. Because of the deviation above, the component is direct props-based (`visible`, `buttons[]`, `onClose`) — each button carries its own `onPress`. Same accessibility-label-as-selector contract, same button-order-as-rendered semantics, same `min-h-11` tap target. No e2e-observable surface difference.

## Soft callbacks made (during this implementation pass)

None.

## Quality gates

- [x] `npm run typecheck` passed (clean, no output).
- [x] `npm run lint` passed (only pre-existing `router.d.ts` warning).
- [x] `npm run test:unit` — 7 files, 74 tests, all passing.
- [x] No new `any` types.
- [x] No new `// @ts-ignore`.
- [x] No stray `console.log`. Existing `console.warn` for error paths is consistent with surrounding code.

## Migration application status

- `npm run db:push` applied `0007_set_completed_at_nullable.sql` to the linked remote Supabase project successfully.
- `npx supabase migration list` confirms Local 0007 = Remote 0007.

## Notes for Reviewer / Tester

- **Reviewer**: the bulk-soft-delete is two-step (read ids → update by id, then cascade by `parent_set_id`). Step 3 (cascade) is filtered with `.is("completed_at", null)` so checked dropset children survive — the orphan is documented in design §Riscos and matches the pre-existing per-row `useDeleteSet` behavior. RLS is enforced row-by-row; `uncheckedIds` are read under RLS so the subsequent `.in("id", uncheckedIds)` can't be spoofed.
- **Reviewer**: cache buster bump forces a one-time refetch for all users; expected and intentional.
- **Tester** smoke list (covers validator MIN-1 race):
  - Tap "+ Working set" twice rapidly → should yield set_numbers 1 and 2, not collide.
  - Tap check then uncheck rapidly → final row should be unchecked.
  - "Check all and finish" with 5+ unchecked sets → progress chart (and history detail) renders the bulk-checked sets in `set_number` order, no reshuffle.
  - "Finish without saving unchecked" with mix of checked + unchecked → finished session contains only checked rows; weekly volume includes them.
  - Resume flow: log 2 sets unchecked → reload tab → unchecked drafts still visible, still unchecked.
  - History detail (`/history/<id>`): no check icon, no `bg-blue-50` tint, header column spacing unchanged from before.
  - Three e2e specs that hit `confirmDelete` path (`crud`, `remove-exercise`, `exercise-progress-ia`) should still pass with zero edits.

## Status

`done`
