# Final summary — 2026-05-23_1855_read-only-history-view

## Outcome
- **Feature**: Read-only history view. The history detail screen at `app/(app)/history/[id].tsx` now renders a non-interactive view by default — no inputs, no trash icons, no add-set/add-exercise/delete-workout/session-name affordances. A header Pencil (`Edit workout`) unlocks the full editable surface; tapping Done (`Exit edit mode`) returns to read-only. Time-edit pencil (`Edit start and end times`) remains independent and works in both modes.
- **Pipeline result**: **shipped**
- **Branch / baseline**: `main` / `3ab2cfed12a9d2af64de18b6cf8e13d24877cf44`
- **Files**: 1 edited + 3 new source + 2 new tests (6 total).

## Metrics

| Metric | Value |
|---|---|
| Feature works end-to-end? | yes (5 new e2e + regression sweep green; 3 screenshots pinned) |
| Human interventions during run | 0 |
| Total round-trips (sum of all loops) | 4 (2 D↔V + 1 I↔R + 1 I↔T) |
| Design ↔ Validate rounds | 2 (round 2 → go) |
| Implement ↔ Review rounds | 1 (pass first try) |
| Implement ↔ Test rounds | 1 (pass first try) |
| Implementer soft-callbacks | 0 |
| Wall-clock duration | ~56 min (18:55 → 19:51 BRT) |
| Token cost | n/a |

## Decisions of record (the 8 Discovery unknowns)

1. **Read-only definition**: static `<Text>` cells for weight/reps/RPE/notes (NOT disabled inputs). Trash icons, "+ Working set" footer, "Open set details" menu trigger, "Add exercise", "Delete workout", session-name input all structurally hidden. Check icon visible but non-interactive.
2. **New-component approach**: two new components (`<ReadOnlySetRow>` + `<ReadOnlyExerciseBlock>`) honoring the prompt's "new component" ask. Plus a pure-helper module (`src/utils/set-display.ts`) so unit tests assert the per-cell contract deterministically.
3. **Edit affordance**: header Pencil swaps to "Done" in `headerRight`. Tap-to-reveal in-place toggle. No navigation to a separate route.
4. **Exit affordance**: tap Done; auto-revert to read-only on next mount (route blur).
5. **In-progress vs ended**: read-only applies only to ended sessions (in-progress redirects to live via `useEffect`).
6. **Time-edit pencil**: untouched. Independent affordance in both modes.
7. **Scope**: per-screen. Edit unlocks all blocks at once.
8. **A11y labels**: `Edit workout` (Pencil), `Exit edit mode` (Done). Time-edit pencil keeps existing `Edit start and end times`.

## Validator catches (the load-bearing wins)

### Round 1 (no-go)
- **MAJ-1**: design v1 cited a non-existent a11y label (`"Edit workout times"`); actual label is `"Edit start and end times"`. Would have produced wrong Tester selectors. Fixed in v2.
- **MAJ-2**: tapping "Done" while a `<TextInput>` is focused would unmount `<SetInput>` before its `onBlur` commit fires → unblurred keystrokes lost. NEW failure mode introduced by this feature. Fixed in v2 with `Keyboard.dismiss()` called BEFORE `setIsEditing(false)` (also between: `setPickerOpen(false)`). E2E spec (4) is the regression guard — types into reps `<TextInput>` without manual blur, taps Done, re-enters Edit, asserts `toHaveValue("12")`.
- **6 minors** folded in: redirect prose softened, `useLastWorkingSet` perf-win enumerated, picker mount-gating (not just `visible={false}`), `Stack.Screen` lifted into single `screenOptions` const reused across loading/error/happy, draft-loss enumeration promoted, explicit `useColorScheme` import diff.

### Round 2 (go)
- **NEW-MIN-1**: misleading title-chain snippet `session.data?.name?.trim() || "Workout" || "Session"` (always evaluates to name-or-"Workout"; `"Session"` is dead code). Design self-corrected in next paragraph; Implementer applied the explicit ternary preserving `"Session"` on loading/error.

## Files touched

### Edited (source)
- `app/(app)/history/[id].tsx` — added `isEditing` state, dynamic `headerRight` (Pencil ↔ Done), single `screenOptions` const reused across loading/error/happy branches, structural mutation gating (6 hooks declared but JSX-mounted only when editing), `<ExercisePicker>` mount-gated, Done handler runs `Keyboard.dismiss()` → `setPickerOpen(false)` → `setIsEditing(false)`.

### New (source)
- `src/components/read-only-set-row.tsx` — static `<Text>` cells, check icon non-interactive.
- `src/components/read-only-exercise-block.tsx` — header replica with `(deleted)` suffix preserved, italic empty-state for zero-set blocks, NO `useLastWorkingSet`, NO `<VolumeTargetSlot>`.
- `src/utils/set-display.ts` — pure helpers (`presentWeight`, `presentReps`, `presentRpe`, `presentNotes`, `presentCheck`) consumed by the two new components AND tested in isolation.

### New (tests)
- `tests/unit/read-only-history-display.test.ts` — 23 unit cases (kg/lbs/null/zero/deleted/empty-block).
- `tests/e2e/read-only-history.spec.ts` — 5 Playwright scenarios.

### New (artifacts)
- `docs/runs/2026-05-23_1855_read-only-history-view/` — full run folder.
- `screenshots/read-only-desktop.png`, `edit-mode-desktop.png`, `read-only-320pt.png`.

**Diff size**: +180/-95 lines on `history/[id].tsx`; +~470 lines on new source; +~700 lines on new tests.

## Quality gates at end of run
- Typecheck: clean (Reviewer + Tester both re-ran).
- Lint: 0 errors, 1 pre-existing warning in `router.d.ts` (unrelated).
- Unit tests: 307/307 pass (+23 new vs prior baseline 284).
- E2E new: 5/5 pass.
- E2E regression sweep: green on time-edit pencil + volume-target-on-history.
- Visual: 3 screenshots pinned (read-only desktop, edit-mode desktop, read-only iPhone SE 320pt).

## Pre-existing flakes flagged by Tester (NOT caused by this run)
- 4 specs fail on baseline pre-feature: `remove-exercise.spec.ts:92,189`, `soft-deleted-exercises-in-history.spec.ts:87`, `crud.spec.ts:131`. Root cause: post-Finish lands on `/workout/verdict/<id>` since commit `4871d33` (end-of-session verdict), but those specs still wait for `/\/workout$/`. Same flakes F3 also surfaced. One-line regex fix would unblock — separate stabilisation pass.

## Why we stopped
Not escalated — pipeline completed cleanly. Budgets at end: D↔V 1/3, I↔R 1/2, I↔T 1/2, soft-callbacks 2/2.

## Artifacts
- [`state.md`](./state.md)
- [`discovery.md`](./discovery.md)
- [`design-v1.md`](./design-v1.md) → superseded
- [`validation-v1.md`](./validation-v1.md) → no-go (0 / 2 majors / 6 minors)
- [`design-v2.md`](./design-v2.md) ← shipped
- [`validation-v2.md`](./validation-v2.md) → go (0 / 0 / 1 minor — NEW-MIN-1 title-chain ternary)
- [`implementation.md`](./implementation.md)
- [`review-v1.md`](./review-v1.md) → pass (0/0/0)
- [`test-report-v1.md`](./test-report-v1.md) → pass
- [`transcript.md`](./transcript.md)
- `screenshots/` — 3 visual evidence

## Bugs found post-merge (backfill within 7 days)
- (none yet)

## Archive
- Archived to vault: `$VAULT/AIground/multi-agent-pipeline/pipeline-runs/2026-05-23_1855_read-only-history-view/` on 2026-05-23.
