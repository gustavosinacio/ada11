# Design v1 — 2026-05-21_1554_tap-exercise-name-to-progress

## Goal (1 sentence)
Make the exercise name in `<ExerciseBlock>`'s header a tap target that navigates to the existing `/(app)/exercises/{id}/progress` route, wired from both the live workout screen and the history detail screen.

## Approach
Add a single optional callback prop `onPressName?: () => void` to `<ExerciseBlock>` (matching the existing `onMoveUp` / `onMoveDown` / `onRemove` precedent at `src/components/exercise-block.tsx:16-17,27`). When present, wrap only the name `<Text>` (lines 102-107) in a `<Pressable>`; when absent, render the plain `<Text>` as today — defensive default so any future caller that omits the prop preserves current behavior verbatim. Wire the new prop at both callsites (`app/(app)/workout/[sessionId].tsx:316` and `app/(app)/history/[id].tsx:240`) to `router.push(\`/(app)/exercises/${ex.id}/progress\`)`, matching the route literal used elsewhere (`app/(app)/exercises/index.tsx:64`). No visual cue (no chevron, no underline) — the affordance is implicit, matching the existing `<ExerciseListItem>` precedent and the Strong/Hevy convention the rest of the app follows. Single shared component edit + two callsite lines (live) + three callsite lines (history) — no DB, no API, no new route.

## Decisions on unknowns (from discovery)
1. **History detail parity**: YES. Same `<ExerciseBlock>` component is mounted at `app/(app)/history/[id].tsx:240` and `history/[id].tsx` already imports `useRouter` (`history/[id].tsx:1`). Consistent mental model: tap any exercise name in any context where it appears → see its progress. Cost: 1 extra line at the history callsite. Reject: prompt-strict live-only — minor surface area savings not worth the UX inconsistency.
2. **Visual treatment**: text-only. No chevron, no underline, no color shift. Matches `src/components/exercise-list-item.tsx` precedent (referenced from `exercises/index.tsx:62-65`). Prompt wording ("tapping an exercise's name") implies the name itself is the affordance — adding decoration would invent UI the user didn't ask for. The `<Pressable>` provides standard mobile press feedback (opacity dim on iOS, ripple on Android) which is enough discoverability.
3. **Prop shape**: callback `onPressName?: () => void`. Matches `onMoveUp` / `onMoveDown` / `onRemove` style at `exercise-block.tsx:16-17,27`. Presence-based gating (no extra boolean), keeps callers in control of route resolution (the component does not import `expo-router`, preserving its current independence from navigation).
4. **`accessibilityLabel`**: `` `View progress for ${exercise.name}` ``. Sentence-case, action-first, mirrors `routine-list-item.tsx:23` (`` `Start workout: ${routine.name}` ``) and `active-session-banner.tsx:21` ("Resume workout in progress").
5. **Tap-target boundary**: wrap ONLY the name `<Text>` (lines 102-107). The muscles/equipment subtitle (`<Text>` at lines 108-119) stays inert metadata — non-interactive. Tighter target avoids accidental taps on what reads as descriptive text. The right-side action cluster (move up/down, remove) is a sibling `<View>` (lines 121-157) — unaffected by the wrapper change.
6. **Deleted exercises**: tap remains functional. No gating on `exercise.deleted_at`. The progress route already accepts soft-deleted ids via `useAllExercise(id)` (`app/(app)/exercises/[id]/progress.tsx:37`, per F9). The `" (deleted)"` suffix inside the name `<Text>` (`exercise-block.tsx:104-106`) remains inside the `<Pressable>` — tapping anywhere on the line, suffix included, opens progress.

## Mudanças por arquivo
| File | Type | Change |
|---|---|---|
| `src/components/exercise-block.tsx` | edited | Add `onPressName?: () => void` to `Props` (next to `onRemove?`). When `onPressName` is defined, wrap the name `<Text>` (currently lines 102-107) in a `<Pressable onPress={onPressName}>` with `accessibilityRole="button"` and `accessibilityLabel={\`View progress for ${exercise.name}\`}`; when undefined, render the plain `<Text>` exactly as today. No other markup or styling changes. |
| `app/(app)/workout/[sessionId].tsx` | edited | Pass `onPressName={() => router.push(\`/(app)/exercises/${ex.id}/progress\`)}` to the `<ExerciseBlock>` mounted in `orderedExercises.map` (`sessionId.tsx:316-323`). `router` already exists at `sessionId.tsx:38`. No new imports. |
| `app/(app)/history/[id].tsx` | edited | Pass `onPressName={() => router.push(\`/(app)/exercises/${ex.id}/progress\`)}` to the `<ExerciseBlock>` mounted in `orderedExercises.map` (`history/[id].tsx:239-240`). `useRouter` is already imported (`history/[id].tsx:1`) but a `const router = useRouter();` may need to be added at the top of the component if not already present — Implementer to check and add iff missing (cost: 1 line). |

## Contratos de I/O

### Component prop (added)
```ts
// src/components/exercise-block.tsx — added to Props
type Props = {
  // ...existing fields unchanged
  /** When provided, the exercise name `<Text>` is wrapped in a `<Pressable>`
   *  that invokes this callback on press. When omitted, the name renders as
   *  plain text (current behavior). Callers own the navigation target. */
  onPressName?: () => void;
};
```

### Pressable shape (new wrapper around the name `<Text>`)
```tsx
// Replaces the bare <Text> currently at exercise-block.tsx:102-107.
// When onPressName is undefined, the <Text> renders unwrapped (no <Pressable>).
{onPressName ? (
  <Pressable
    onPress={onPressName}
    accessibilityRole="button"
    accessibilityLabel={`View progress for ${exercise.name}`}
  >
    <Text className="text-lg font-semibold text-black dark:text-white">
      {exercise.name}
      {exercise.deleted_at != null ? (
        <Text className="text-base font-normal text-gray-500"> (deleted)</Text>
      ) : null}
    </Text>
  </Pressable>
) : (
  <Text className="text-lg font-semibold text-black dark:text-white">
    {exercise.name}
    {exercise.deleted_at != null ? (
      <Text className="text-base font-normal text-gray-500"> (deleted)</Text>
    ) : null}
  </Text>
)}
```
(Implementer may factor the inner `<Text>` into a local variable to avoid duplication — same render output either way.)

### Callsite wiring (workout + history)
```ts
// app/(app)/workout/[sessionId].tsx — added prop on the existing <ExerciseBlock>
onPressName={() => router.push(`/(app)/exercises/${ex.id}/progress`)}

// app/(app)/history/[id].tsx — same pattern; route literal must match exactly
onPressName={() => router.push(`/(app)/exercises/${ex.id}/progress`)}
```

### DB / API
- None. Purely client navigation. No table, query, or RLS change.

## UI spec
- **Tap target**: the name `<Text>` only. Width = natural text width (no `flex-1` on the `<Pressable>`); the `flex-1 pr-2` wrapper at `exercise-block.tsx:101` is unchanged so the right-side action cluster keeps its layout.
- **Visual treatment**: identical to current. No chevron, no underline, no color shift, no spacing change. `<Pressable>` default press feedback applies (iOS opacity dim, Android ripple).
- **Subtitle**: the muscles/equipment `<Text>` (`exercise-block.tsx:108-119`) stays outside the `<Pressable>` — non-interactive, reads as metadata.
- **Action cluster** (move up/down, remove): sibling `<View>` at `exercise-block.tsx:121-157` — untouched, tap targets preserved verbatim.
- **Deleted-exercise suffix**: `" (deleted)"` inside the name `<Text>` (`exercise-block.tsx:104-106`) renders inside the `<Pressable>` — tap still works.
- **Dark mode**: existing `dark:text-white` / `dark:bg-black` tokens preserved; no new tokens introduced. `<Pressable>` has no background — inherits parent.
- **Accessibility**: `accessibilityRole="button"` + `accessibilityLabel={\`View progress for ${exercise.name}\`}`. VoiceOver/TalkBack announces "View progress for Bench Press, button".

## Riscos
- **Data integrity**: none. No DB read/write, no migration, no RLS. Navigation only.
- **UX regressions**:
  - Risk: accidental tap on the name while the user means to edit a set or hit a move-chevron. Mitigation: tap target is the name `<Text>` only — far from the chevrons (right edge) and from the set rows (below the header). Pressing the name has been inert until now, so users currently don't tap it intentionally — low collision risk.
  - Risk: callers that mount `<ExerciseBlock>` without `onPressName` lose nothing (defensive default renders bare `<Text>`). Verified callers: `workout/[sessionId].tsx:316`, `history/[id].tsx:240` — both updated. No other callers (verified by grep contract: prop is new, can't be referenced elsewhere yet).
- **Platform-specific**:
  - iOS / Android: `<Pressable>` from `react-native` is native — no divergence.
  - Web: `<Pressable>` from `react-native-web` renders as a focusable `<div role="button">`. Cursor will become `pointer` on hover (default RN-Web behavior). Tap/click both navigate. No web-specific code path needed.
- **Performance**: one extra `<Pressable>` per exercise block on each render. No new query, no new memo, no extra re-renders. Negligible cost.
- **Back-stack**: `router.push` (not `replace`) — `router.back()` from progress pops back to the live workout or history detail respectively. Existing back-stack from the list-tab entry-point (`exercises/index.tsx:64` → progress → back) is unaffected. The IA-A4 e2e (`tests/e2e/exercise-progress-ia.spec.ts:71-150`) covers the list → progress → edit → back loop, which is unchanged by this run.
- **Mid-session navigation away from a dirty input**: tapping the name while a `<SetInput>` has focus will navigate away. `<SetInput>` commits onBlur (current behavior, unchanged). The blur fires before `router.push` resolves — same as tapping the back button or any other `<Pressable>` in the header. No regression vs the existing move-up/down/remove chevrons.

## Alternativas descartadas
1. **Add a "View progress" item to the more-set-types menu (`exercise-block.tsx:223-254`)** — descartada porque the prompt explicitly says "tapping an exercise's name", not "tapping a menu item". Menu placement is also farther from where the user is reading and breaks the Strong/Hevy convention the codebase otherwise follows.
2. **Add a chevron icon to the right of the name `<Text>`** — descartada porque no existing `<ExerciseListItem>` / `<RoutineListItem>` / `<ExerciseBlock>` row uses a chevron affordance; introducing one here creates a one-off visual that doesn't match the rest of the app. The discovery doc also flags it as out-of-scope unless Designer explicitly opts in (we don't).
3. **Wrap the whole left `flex-1 pr-2` wrapper (name + subtitle, `exercise-block.tsx:101-120`) in `<Pressable>`** — descartada porque it makes the muscles/equipment subtitle tappable, which reads as inert metadata. A generous target sounds friendly but blurs the affordance — user can't tell from looking what's tappable. Tighter target on the name `<Text>` only is more honest.
4. **New boolean prop `showProgressTap?: boolean` + internal `useRouter()`** — descartada porque it forces `<ExerciseBlock>` to import `expo-router` (currently route-agnostic, a property worth preserving) and hard-codes the route literal inside the component. Callback form keeps the component as a dumb renderer and matches the existing `onRemove` / `onMoveUp` convention.
5. **`router.replace` instead of `router.push`** — descartada porque it breaks `router.back()`: from the progress screen, back would skip past the workout/history screen. Push is the right semantic for a drill-in.

## Out of scope
- Visual chevron / arrow / underline indicator on the name (text-only treatment, Decision #2).
- "View progress" menu item in the more-set-types popover.
- New route, new screen, or any change to `app/(app)/exercises/[id]/progress.tsx` (shipped in F5 + IA-A4).
- Touching `<ExerciseListItem>` (`src/components/exercise-list-item.tsx`) — list-tab entry-point already wired.
- Analytics / event tracking — no telemetry layer in this codebase yet.
- Any DB / migration / RLS change.
- Behavioral change to how `<SetInput>` blurs / commits when navigation fires (commits onBlur today — unchanged).

## Open questions for Validator
- Confirm `<Pressable>` press feedback (iOS opacity dim, Android ripple) on a `<Text>`-only target reads as "tappable" in this codebase — vs the codebase using zero affordance (relying purely on user mental model) for `<ExerciseListItem>`. Either is consistent; calling it out for the record.
- Confirm `history/[id].tsx` does not already destructure `router` somewhere I missed — if it does, the Implementer note in the table is moot.
- Confirm no test in `tests/e2e/exercise-progress-ia.spec.ts` would mis-fire on the new tap target (the spec navigates from `exercises/index.tsx` not from a workout block — should be isolated, but Validator should verify the selectors used don't accidentally match a workout-screen tap target if the spec ever runs against a session in progress).
