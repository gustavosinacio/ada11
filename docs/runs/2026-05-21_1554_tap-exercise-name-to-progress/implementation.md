# Implementation — 2026-05-21_1554_tap-exercise-name-to-progress

Based on: `design-v1.md` (final approved) and `validation-v1.md` (`go`, 1 major + 3 minors).

## Files changed
- `src/components/exercise-block.tsx` (edited) — added optional `onPressName?: () => void` prop; when provided, wraps only the name `<Text>` in a `<Pressable>` with `accessibilityRole="button"`, `accessibilityLabel="View progress for {name}"`, and `className="active:opacity-70"` (per MAJ-1). When omitted, renders bare `<Text>` exactly as before (defensive default). Subtitle, action cluster, volume-target slot, set rows, and add-set buttons untouched.
- `app/(app)/workout/[sessionId].tsx` (edited) — passes `onPressName={() => router.push(\`/(app)/exercises/${ex.id}/progress\`)}` to the `<ExerciseBlock>` in `orderedExercises.map`. `router` already bound at line 38; no new import.
- `app/(app)/history/[id].tsx` (edited) — same wiring as live workout. `router` already bound at line 36; no new import (MIN-1: stale hedge ignored, prop wired straight in).
- `tests/e2e/exercise-progress-ia.spec.ts` (edited) — added new test case `"name tap in live workout block routes to /exercises/{id}/progress and back"`. Flow: sign in -> Quick start -> add Bench Press -> tap label `View progress for Bench Press` -> assert URL `/exercises/<uuid>/progress` -> `page.goBack()` -> assert return to original `/workout/<sessionId>` URL.

## Deviations from design
- **None substantive.** Folded the validator's MAJ-1 (`active:opacity-70` on the Pressable) and MIN-1 (no `useRouter` hedge to act on — already bound) directly. MIN-2 (deleted-suffix excluded from accessibilityLabel) and MIN-3 (`selectable={false}`) explicitly noted as FYI by validator; not applied — kept design's accessibilityLabel verbatim, no `selectable` attribute introduced.
- The design suggested the Implementer "may factor the inner `<Text>` into a local variable to avoid duplication." I kept the duplicated `<Text>` literal because (a) only 4 lines of duplication, (b) extracting would add a variable hoisted above the JSX with no functional gain, (c) the two render paths read clearer side-by-side.

## Soft callbacks made (during this implementation pass)
- None.

## Quality gates
- [x] `npm run typecheck` passed (clean, 0 errors).
- [x] `npm run lint` passed (0 errors; 1 warning in auto-generated `router.d.ts` — pre-existing, unrelated to this run).
- [x] Relevant unit tests pass — `npm run test:unit` -> 8 files, 87 tests, all green.
- [x] No new `any`.
- [x] No new `// @ts-ignore`.
- [x] No stray `console.log` (verified by grep on touched files).

## Notes for Reviewer / Tester
- **Reviewer**: the `<Pressable>` wrapper sits on a tight target (the name `<Text>` only) inside the existing `<View className="flex-1 pr-2">`. The `active:opacity-70` class is the validator's MAJ-1 fix — verify the press feedback (iOS opacity dim + RN-Web opacity dim) matches `weekly-volume-strip.tsx:131` precedent. The subtitle `<Text>` stays outside the `<Pressable>` (non-interactive), and the right-side action cluster (`exercise-block.tsx:121-157`) is untouched.
- **Reviewer**: `router` was already bound in both callsite files (`workout/[sessionId].tsx:38` and `history/[id].tsx:36`) — no new `useRouter()` calls, no new imports. Validator MIN-1 confirmed this.
- **Reviewer**: the `<Pressable>` wrapper is gated by `onPressName ?` — any existing or future caller that does NOT pass the prop preserves current behavior (bare `<Text>`). Defensive default, no breaking change for any other potential render of `<ExerciseBlock>`.
- **Tester**: new e2e arm in `tests/e2e/exercise-progress-ia.spec.ts` covers the live-workout block-name tap. The accessibility label `"View progress for Bench Press"` is the test selector — must match `` `View progress for ${exercise.name}` `` in `exercise-block.tsx`. If this label is ever renamed, the spec must be updated together.
- **Tester**: history-detail block-name tap is NOT covered by a new spec (the design's flow is identical to live workout, modulo source screen). If history coverage is desired, add a sister test starting from `/(app)/history` — but the unit code path is shared and small enough that one arm is the cost-effective probe.
- **Tester**: dark mode unchanged; no new tokens introduced. The `<Pressable>` has no background — inherits parent. `active:opacity-70` applies in both light and dark.
- **Tester**: the `(deleted)` suffix inside the name `<Text>` remains inside the `<Pressable>` — tap still works for soft-deleted exercises in history (per design Decision #6).
