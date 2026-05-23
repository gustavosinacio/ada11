# Review v1 — 2026-05-23_1855_read-only-history-view

Reviewing: the diff for the read-only history toggle against `design-v2.md` (final approved) + `validation-v2.md` (NEW-MIN-1 hand-off).

Round: Implement↔Review round 1 of 2.

## Diff scope

- Diff command: `git diff 3ab2cfed12a9d2af64de18b6cf8e13d24877cf44 -- '*.ts' '*.tsx'`
- Files changed (.ts/.tsx):
  - Tracked-modified: `app/(app)/history/[id].tsx` (+180 / −95).
  - Untracked-new: `src/components/read-only-set-row.tsx`, `src/components/read-only-exercise-block.tsx`, `src/utils/set-display.ts`, `tests/unit/read-only-history-display.test.ts`, `tests/e2e/read-only-history.spec.ts`. All five exist on disk; `git status` confirms.
- Total: 1 edited + 5 new = 6 files of code (matches the Implementer's report).

## Verification of implementation.md claims

| Claim | Verified? | Notes |
|---|---|---|
| NEW-MIN-1 explicit ternary applied | yes | `history/[id].tsx:168-172` — `session.data?.name?.trim() ? session.data.name.trim() : session.data ? "Workout" : "Session"`. Loading/error → `"Session"` (preserves the pre-refactor labels at the lines this design replaces); happy-path-no-name → `"Workout"`. Buggy `\|\| "Workout" \|\| "Session"` chain is not present. |
| MAJ-2 mitigation: `Keyboard.dismiss()` before `setIsEditing(false)` | yes | `history/[id].tsx:186-199` — order is `Keyboard.dismiss()` → `setPickerOpen(false)` → `setIsEditing(false)`. Matches design-v2:158-162 exactly. `Keyboard` imported at line 6. |
| e2e MAJ-2 regression guard | yes | `tests/e2e/read-only-history.spec.ts:309-358` (spec 4) — enters Edit, `repsInputs.first().fill("12")` (focus stays on the input), taps `getByLabel("Exit edit mode")` without manual blur, re-enters Edit, asserts `toHaveValue("12")`. Exactly the contract the design demands. |
| 6 mutation hooks structurally gated | yes | Spot-checked: (a) `useUpdateSet` → only wired into `onUpdateSet` of `<ExerciseBlock>` at `history/[id].tsx:333-339`, which lives inside the `isEditing` branch (line 311); (b) `useLogSet` → only wired at `:320-332`, same branch; (c) `useDeleteSet` → `:347-353`, same branch; (d) `useUpdateSessionName` → only reachable through `commitName`, called from the name `<TextInput>` at `:249-257`, gated by `isEditing` at `:246`; (e) `useSoftDeleteSession` → `onPress={onDeleteSession}` on the Button at `:382-388`, inside the `{isEditing ? ... : null}` block at `:369`; (f) `useUpdateSetMeta` → `:340-346`, same branch. All six hooks remain declared at the top (subscriptions stable) but their JSX callsites are mount-gated. |
| Header swap dynamic Pencil ↔ Done | yes | `history/[id].tsx:183-215`. Pencil `accessibilityLabel="Edit workout"` (line 209); Done `accessibilityLabel="Exit edit mode"` (line 200). Labels match the design's test selectors. |
| `<SessionTimesEditor>` rendered in both modes | yes | `history/[id].tsx:272-288` — outside the `isEditing` branch (it's after the name-swap `<> ... </>` closes at :270 and before `</View>` at :301). Mounts unconditionally, fully functional in both modes. The e2e spec asserts `getByLabel("Edit start and end times")` count = 1 in both states (spec 1:184, spec 2:240). |
| `<ExercisePicker>` mount-gated | yes | `history/[id].tsx:394-406` — `{isEditing ? <ExercisePicker .../> : null}`. Not a `visible={false}` workaround. |
| `<ReadOnlyExerciseBlock>` correctness | yes | Imports (`read-only-exercise-block.tsx:1-5`) do NOT include `useLastWorkingSet` or `VolumeTargetSlot`. `(deleted)` suffix preserved at lines 47-49 with the same `" (deleted)"` leading-space copy used in `exercise-block.tsx:140`. No add-set footer, no chevrons, no `onRemove`. |
| `<ReadOnlySetRow>` correctness | yes | No `<TextInput>` (only `<Text>` and `<View>`). No mutation handlers. RPE chip is `<Text>`, notes glyph is `<StickyNote>`, check glyph is `<Check>` — all inside non-pressable `<View>` containers (lines 71-89). |
| Pure-helper module split is clean | yes | `set-display.ts` exports `displayWeight`, `displayReps`, `presentReadOnlySetRow`, `presentReadOnlyExerciseBlock`, `READ_ONLY_BLOCK_EMPTY_TEXT`. Both new components consume `present*` exclusively; no duplicated formatting logic. Pure transforms, unit-testable. |
| `screenOptions` const reused across loading/error/happy | yes | Defined at `history/[id].tsx:180-216`; consumed at `:221` (loading), `:230` (error), `:242` (happy-path). Single source of truth for header config. |
| No silent regressions to existing files | yes | `git diff --name-only` shows zero changes to `src/components/exercise-block.tsx`, `src/components/set-input.tsx`, `src/components/session-times-editor.tsx`, `app/(app)/workout/[sessionId].tsx`. |
| Quality gates (independently re-run) | yes | `npm run typecheck` → no errors. `npm run lint` → 0 errors, 1 warning in `router.d.ts` (pre-existing baseline, unrelated). `npm run test:unit` → 18 files / 307 tests pass (including the new `read-only-history-display.test.ts` with 23 tests). |

## Issues

### Blockers
None.

### Majors
None.

### Minors
None.

## Notes on items the Conductor asked to verify

- **NEW-MIN-1 ternary** — applied at `history/[id].tsx:168-172`. Loading/error → `"Session"`; happy-path-no-name → `"Workout"`; happy-path-with-name → the name. The buggy `\|\| "Session"` short-circuit from design-v2:147 is NOT in the code.
- **MAJ-2 order** — `Keyboard.dismiss()` runs FIRST (line 194), then `setPickerOpen(false)` (line 197), then `setIsEditing(false)` (line 198). React batches the two `set*` updates so the picker unmounts in the same commit; `Keyboard.dismiss()` fires synchronously and triggers any focused `<TextInput>`'s blur, which routes through `<SetInput>`'s `onBlur=commit` before the editable tree unmounts. The e2e spec (4) is a genuine regression guard — it types into a focused `<TextInput>` and never manually blurs it before tapping Done.
- **Time-edit pencil independence** — `<SessionTimesEditor>` is mounted outside the `isEditing` ternary at lines 272-288. Tested at spec 1 line 184 (read-only) and spec 2 line 240 (edit mode).
- **`<ReadOnlyExerciseBlock>` no `useLastWorkingSet` / no `<VolumeTargetSlot>`** — verified by reading the imports of `read-only-exercise-block.tsx:1-5` (only `Pressable`, `Text`, `View`, `ReadOnlySetRow`, types, `presentReadOnlyExerciseBlock`). The MIN-2 performance win is real.
- **Column alignment** — Read-only column header spacers (`read-only-exercise-block.tsx:82-91`) match the editable column header spacers (`exercise-block.tsx:217-227`): leading `w-7`, then `w-6 #`, `flex-1 Weight`, `flex-1 Reps`, `w-11` (menu), `w-7` (trash). Read-only row slots match by width (`read-only-set-row.tsx:43-89`). Toggling Edit↔Done does not reflow the table.
- **Documented deviation (pure-helper split)** — accepted. The design explicitly left the helper location to the implementer; the choice to lift to `src/utils/set-display.ts` is justified by the vitest configuration (only `.test.ts`, no JSX renderer). The two components delegate to `present*` helpers, so the unit-tested contract is the runtime contract — no parallel logic to drift.

## Security checklist

- [x] RLS — no new `.from('table')` callsites in this diff. The read-only components only read in-memory props passed from the screen. The screen's query surface (`useSession`, `useSetsForSession`, `useAllExercises`) is unchanged from baseline. No new tables, no new migration.
- [x] No `SUPABASE_SERVICE_ROLE_KEY` in shipped code under `app/` or `src/`. The service-role reference in `tests/e2e/read-only-history.spec.ts` follows the existing test-scaffolding pattern (matches `tests/e2e/crud.spec.ts` and friends) and lives under `tests/`, never bundled.
- [x] No raw SQL `rpc` calls introduced. No string concatenation of user input.
- [x] `EXPO_PUBLIC_*` env vars unchanged. No new public env reads in shipped code.

## Style / convention checklist

- [x] No new `any`. `grep -nE ': any'` across all six touched files returns nothing.
- [x] No new `// @ts-ignore`. Same grep.
- [x] Comments narrate *why*, not *what*. Spot-checks:
  - `history/[id].tsx:64-66` — explains why `isEditing` is local state (auto-reset on unmount).
  - `history/[id].tsx:187-193` — explains the cross-platform rationale for `Keyboard.dismiss()` before unmount.
  - `set-display.ts:14-17` — explains why the helpers live in a separate module (vitest .test.ts-only configuration).
  - No "this assigns the value" / "this calls the function" what-narrating comments.
- [x] Imports follow project style. `~/components/...`, `~/db/types`, `~/utils/...` aliases used; package imports first; relative paths within `src/` consistent with the existing `<ExerciseBlock>` import style.
- [x] New files placed in conventional folders. `src/components/read-only-*.tsx` matches the sibling `<ExerciseBlock>` / `<SetInput>` location. `src/utils/set-display.ts` matches `src/utils/units.ts` location. Test files in `tests/unit/` and `tests/e2e/`.

## Decision

**pass**

Reasoning:
- 0 blockers, 0 majors, 0 minors.
- All 12 Conductor verification items confirmed against source.
- All design-v2 contracts implemented faithfully; the single documented deviation (pure-helper module split) was explicitly allowed by the design and improves test coverage.
- NEW-MIN-1 from `validation-v2.md` was correctly applied — the buggy `\|\| "Workout" \|\| "Session"` chain is not in the code.
- Quality gates independently re-run and clean (typecheck, lint, unit tests all green; 23 new unit tests included in the 307-pass run).
- Security checklist clean (no RLS surface change, no service-role token in shipped code, no `EXPO_PUBLIC_*` secret leak).
- Style checklist clean (no `any`, no `@ts-ignore`, comments narrate why).

Recommendation: **invoke Tester**.
