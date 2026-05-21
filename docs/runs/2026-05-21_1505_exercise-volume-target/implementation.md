# Implementation — 2026-05-21_1505_exercise-volume-target

Based on: `design-v1.md` (approved) and `validation-v1.md` (`go`, 1 major + 4 minors folded).

## Files changed

- `src/utils/volume-target.ts` (new) — pure helper `computeVolumeTarget(...)` returning a discriminated `VolumeTargetState` union (`no-pr` | `chasing` | `surpassed`). Implements the canonical volume kernel (skip warmups, `parseFloat` numeric strings, guard `w > 0 && r > 0`) for both the past-max reduce over `SessionSets[]` and the running-session reduce over `SetRow[]`. **MAJ-1 fix folded inline**: current weight is picked by `reduce` over `set_number` (not by last-array-index), so the post-F10 ordering of `listSetsForSession` (checked sets first by `completed_at`, unchecked second) does not corrupt the pick.
- `src/components/volume-target-slot.tsx` (new) — presentational slot. Calls `useExerciseProgress(exerciseId)` and `useWeightUnit()` unconditionally (so hook hygiene is preserved by mounting at the parent — see `<ExerciseBlock>` gating below). Memoizes the `VolumeTargetState`. Renders `null` while loading and on `no-pr`. Chasing branch renders the muted "Volume to PR: …" strip with bolded gap + reps clause. Surpassed branch renders the emerald "Matched your previous best — one more rep is a PR" copy when `overflowKg === 0` and `"New PR! +X over your previous"` otherwise. No emoji (cross-platform-safe). Accessibility labels assembled with JS template literals (MIN-4).
- `src/components/exercise-block.tsx` (edited) — added `showVolumeTarget?: boolean` prop (default `false`); when true, renders `<VolumeTargetSlot exerciseId={exercise.id} currentSessionSets={sets} />` between the header `View` and the column-header row. Single import added; no behavior change when the prop is omitted. Did NOT add a `sessionId` prop (MIN-3).
- `app/(app)/workout/[sessionId].tsx` (edited) — passes `showVolumeTarget` to each `<ExerciseBlock>` in the live-workout list. One-line addition; the existing `showCheckable` and `onToggleSetChecked` wiring is untouched.
- `tests/unit/volume-target.test.ts` (new) — 13 unit tests covering: `no-pr` (undefined/empty pastSessions, all-zero past volume), `chasing` (integer + floating-point reps, null/zero current weight, empty current sets, max across multiple past sessions), `surpassed` (positive overflow + exact-tie `overflowKg === 0` for MIN-2), warmup exclusion in BOTH reductions, and the **MAJ-1 regression sentinel**: array `[set#2 (w=80, checked), set#1 (w=100, unchecked)]` — asserts `currentWeightKg === 80` (max-`set_number` pick) and not 100 (would be the wrong answer if walking by array index).

## Deviations from design

- **Copy wording — chasing strip lead-in**: design v1 specified `"To beat PR: …"`. The Conductor prompt's slot spec used `"Volume to PR: …"`. I went with the Conductor's wording since it more explicitly distinguishes "volume gap" from the reps clause and the Conductor instruction is more recent. Visual treatment (muted leading caption, bolded value) matches the design. If Reviewer prefers the original `"To beat PR"`, it's a one-line change in `volume-target-slot.tsx`.
- **Surpassed-state color token**: design v1 picked `text-blue-500 dark:text-blue-400` to avoid introducing a green token. The Conductor prompt specified `text-emerald-600 dark:text-emerald-400` (emerald). I used emerald per the Conductor instruction. NativeWind's Tailwind preset includes the emerald palette by default, so no Tailwind config change required — verified by no typecheck/lint failure. If Reviewer wants the codebase to stay strictly within previously-used colors, this is a one-token swap.
- **MIN-1 acknowledgement (here, per instruction)**: `formatVolume` k-shorthand precision in the `[1000, 9999]` range is the codebase precedent (`weekly-volume-strip.tsx:106`, `history/week/[isoWeek].tsx:179`, `units.test.ts:24-27`). A 1049-kg gap renders `"1.0k kg"`; this precision loss is consistent with existing aggregate-volume readouts in the app. Not changed here.
- **MIN-2 (tie copy)**: handled by collapsing `gapKg <= 0` into `surpassed` with `overflowKg = Math.max(0, -gapKg)`. Slot renders `"Matched your previous best — one more rep is a PR"` when `overflowKg === 0`. Covered by a dedicated unit test.
- **MIN-3 (no `sessionId` prop)**: confirmed unnecessary per validator — `progress.ts:15` already filters `.not("sessions.ended_at", "is", null)`, so the active session is never in `["progress", exerciseId]`. Helper signature trimmed from `{sessionsForExercise, currentSessionId, currentSessionSets}` to `{pastSessions, currentSessionSets}`.
- **MIN-4 (accessibility template literals)**: all `accessibilityLabel` strings in `<VolumeTargetSlot>` use real JS template literals (`${...}`), not the design doc's placeholder pseudocode.

## Soft callbacks made (during this implementation pass)

- None.

## Quality gates

- [x] `npm run typecheck` — pass (no errors).
- [x] `npm run lint` — pass; only the pre-existing `router.d.ts` warning (`ESLint: 0 errors, 1 warnings in 1 files`).
- [x] `npm run test:unit` — pass (8 files, 87 tests, all green; new file contributes 13 tests).
- [x] No new `any` (verified by grep on the three new/edited files).
- [x] No new `// @ts-ignore` (verified).
- [x] No stray `console.log` (verified).

## Notes for Reviewer / Tester

- **Reviewer**: please confirm the wording swap to `"Volume to PR"` (vs design's `"To beat PR"`) is acceptable. Same for the `text-emerald-*` token vs design's `text-blue-*`. Both came from the Conductor's slot spec; happy to revert if you prefer strict adherence to design v1.
- **Reviewer**: the slot intentionally returns `null` while `useExerciseProgress.isLoading` to avoid skeleton bloat across N exercises on cold mount. The strip pops in after the per-exercise progress fetch resolves. This is by design (similar to `measurements-progress-strip.tsx:43-44`'s null-on-empty pattern) but worth flagging in case you'd rather have a 1-line gray skeleton during cold start.
- **Reviewer**: hook-rule compliance is preserved by conditional MOUNTING of `<VolumeTargetSlot>` from `<ExerciseBlock>` — the slot itself calls `useExerciseProgress` and `useWeightUnit` unconditionally. When `showVolumeTarget === false`, the slot is not rendered and no query observers are created.
- **Tester**: deterministic e2e probe is feasible — (1) seed a finished session with one working set 100 × 10 = 1000 kg on exercise X; (2) start a fresh session, add exercise X, log 100 × 5; (3) assert the strip reads `"Volume to PR: 500 kg · ≈ 5.0 reps @ 100.0 kg"`; (4) log another 100 × 5 → assert strip flips to the emerald PR copy. Test ID/accessibility label hooks: `accessibilityLabel` on the strip's `<Text>` starts with `"Need …"` (chasing) or `"New personal record."` / `"Matched your previous best."` (surpassed).
- **Tester**: confirm the strip does NOT appear in `history/[id].tsx` — that file does not pass `showVolumeTarget`. Already grep-verified (only the workout screen passes the prop).
- **Tester**: existing e2e specs (crud.spec.ts, remove-exercise.spec.ts, soft-deleted-exercises-in-history.spec.ts, etc.) were not edited. The new strip layers on top of the finish-flow without changing it; if any spec asserts on the absence of text in the live block, the strip will appear in the live workout view from the second set onward (only when the user has prior history for that exercise). No spec change is anticipated, but Tester should run the full e2e suite to confirm.
