# Discovery — 2026-05-21_1554_tap-exercise-name-to-progress

## Feature prompt
> From the live workout session, tapping an exercise's name should navigate to that exercise's history/progress page (the existing `/exercises/[id]/progress` route shipped in F5 — IA option A4 added the pencil headerRight to navigate to edit; this adds a tap-the-name affordance to navigate to progress).

## Scope summary
Add a tap affordance on the exercise name `<Text>` inside `<ExerciseBlock>`'s header row that navigates to `/(app)/exercises/{id}/progress`. The component is shared between live workout (`app/(app)/workout/[sessionId].tsx`) and history detail (`app/(app)/history/[id].tsx`). Prompt scopes the change to live workout, but the same wiring is trivially reusable in history detail by passing the same callback — Designer's call (see Unknowns).

## Affected files (verified)
- `src/components/exercise-block.tsx:98-120` — the header `<View>` that renders `exercise.name` inside a plain `<Text>`. Currently NOT inside any `<Pressable>`. Sibling `<View>` (right side, lines 121-157) holds the move/remove action buttons. This is the only file that needs editing to add the tap target.
- `app/(app)/workout/[sessionId].tsx:1,38,317-323` — already has `useRouter()` imported and a `router` instance bound at line 38. Mounts `<ExerciseBlock>` inside the `orderedExercises.map` (line 316). Must pass a new prop (e.g. `onPressName`) wired to `router.push(\`/(app)/exercises/${ex.id}/progress\`)`.
- `app/(app)/history/[id].tsx:240` — second `<ExerciseBlock>` callsite. Does NOT currently have `useRouter`; would need to add it iff Designer chooses to enable the tap target in history detail.
- `app/(app)/exercises/[id]/progress.tsx:1-60` — destination screen. Already in place from F5 + the IA-A4 run (2026-05-20_0302). Has `router.push(\`/(app)/exercises/${id}\`)` on the pencil headerRight (line 50). Round-trip workout → progress → edit → back works via `router.back()` (verified in `tests/e2e/exercise-progress-ia.spec.ts:118-130`).

## Relevant conventions (verified by reading code)
- **Optional-callback prop style** — `<ExerciseBlock>` already uses callback-presence as the gating mechanism: `onMoveUp?: () => void`, `onMoveDown?: () => void`, `onRemove?: () => void` (lines 16-17, 27). `showActions = !!onMoveUp || !!onMoveDown || !!onRemove` at line 96 toggles the whole right-side action cluster. Adding `onPressName?: () => void` matches this pattern; no extra boolean needed.
- **Route shape** — every existing nav to the progress screen is exactly `/(app)/exercises/${id}/progress` (verified in `app/(app)/exercises/index.tsx:64`). Use the same literal.
- **`accessibilityRole="button"` + `accessibilityLabel`** convention is universal in this codebase. Labels are sentence-case, action-first. Closest precedent for a "go to" label: `src/components/active-session-banner.tsx:21` `"Resume workout in progress"` and `src/components/routine-list-item.tsx:23` `\`Start workout: ${routine.name}\``. Suggested: `\`View progress for ${exercise.name}\``.
- **`<Pressable>` on text rows** — `src/components/exercise-list-item.tsx` (referenced from `exercises/index.tsx:62-65`) is the precedent for "tap a row with an exercise name → progress screen". No visual cue (no underline/chevron) — relies on the affordance being implicit. This matches the Strong/Hevy convention the rest of the app follows.
- **Header layout** — the name `<Text>` lives inside a `flex-1 pr-2` wrapper (`exercise-block.tsx:101-120`). The wrapper also renders the muscles/equipment subtitle line. Wrapping the wrapper in `<Pressable>` would include the subtitle in the tap target; wrapping only the name `<Text>` keeps the target tight. F11 volume-target strip is rendered as a sibling block (`exercise-block.tsx:160-165`), already outside the header row — no risk of overlap.

## Constraints
- **Data**: none. Purely client navigation; no DB read/write.
- **UI**: tap target must NOT swallow the existing right-side action buttons (move up/down, remove). The current layout is `flex-row` with `flex-1` on the left wrapper and the action cluster on the right — keeping the `<Pressable>` inside the left wrapper preserves the existing tap targets verbatim.
- **Platform**: web + native. `<Pressable>` from `react-native` works on both; `router.push` from `expo-router` is already used in both file siblings. No web-specific divergence needed.
- **Auth**: none beyond `(app)` segment, which is already gated.
- **Performance**: trivial. One extra `<Pressable>` per exercise block, no new queries, no extra renders.

## Existing precedents
- `app/(app)/exercises/index.tsx:62-65` — exact pattern: tap on a row containing an exercise name → `router.push(\`/(app)/exercises/${item.id}/progress\`)`. Use the same route literal and the same target screen.
- `src/components/exercise-block.tsx:16-17, 27, 96` — optional-callback prop convention with presence-based gating. Drop `onPressName?: () => void` next to `onRemove?: () => void`.
- `src/components/active-session-banner.tsx:21` / `src/components/routine-list-item.tsx:23` — `accessibilityLabel` precedent for navigation affordances ("Resume workout in progress", "Start workout: {name}"). Mirrors the proposed `"View progress for {exercise.name}"`.
- F5 + IA-A4 round-trip already shipped: `tests/e2e/exercise-progress-ia.spec.ts:71-150` verifies list → progress → pencil → edit → back. Adding a second entry-point (live workout → progress) doesn't change the destination or the back stack — `router.back()` from edit will pop to progress, and `router.back()` from progress will pop to live workout (same back-stack behavior as the existing list entry-point).

## Unknowns (require Designer judgment or human decision)
1. **History detail parity** — prompt says "from the live workout"; should the same tap target be enabled on `app/(app)/history/[id].tsx:240`? Argument for yes: shared component, obvious next inference, costs one line + a `useRouter()` import. Argument for prompt-strict: minimize surface area, ship live-only first. Recommend Designer chooses YES (consistency wins) but flag it explicitly. If Designer says NO, history detail simply omits `onPressName` and the tap is inert there.
2. **Visual treatment** — text-only (no chevron/underline) matches `<ExerciseListItem>` precedent and the Strong/Hevy convention. No design system constraint forces a cue. Recommend Designer pick text-only unless they want to introduce a subtle chevron icon on the right of the name `<Text>`. Implementer should NOT invent a new visual cue without Designer sign-off.
3. **Prop shape** — `onPressName?: () => void` callback (matches existing `onRemove`/`onMoveUp` style) vs `showProgressTap?: boolean`. Recommend the callback form; cleaner and matches conventions. Designer to confirm.
4. **`accessibilityLabel` copy** — recommend `\`View progress for ${exercise.name}\``. Designer to confirm or override.
5. **Tap-target boundary** — wrap only the name `<Text>` (lines 102-107) vs the whole left wrapper including the muscles subtitle (lines 101-120). Recommend the name `<Text>` only — tighter target, leaves the subtitle as inert metadata. Designer to confirm. (Wrapping the whole left wrapper also works and feels more generous; either is defensible.)
6. **Deleted exercises** — `exercise-block.tsx:104-106` appends `" (deleted)"` to the name when `exercise.deleted_at != null`. The progress route already handles deleted exercises (`useAllExercise` at `progress.tsx:37`), and the IA-A4 e2e tolerates soft-deleted ids. Tap should remain functional on deleted rows. Designer to confirm (no change required, but worth calling out so the Implementer doesn't gate the `<Pressable>` on `deleted_at`).

## Out-of-scope flags
- Adding a separate route or screen — destination already exists.
- Changing anything in `app/(app)/exercises/[id]/progress.tsx` — headerRight pencil + back-stack already shipped.
- Adding a "View progress" item to the more-set-types menu — feature is the name-tap only.
- Adding a visual cue (chevron, underline, color shift) — only if Designer explicitly opts in.
- Touching `<ExerciseListItem>` (`src/components/exercise-list-item.tsx`) — the list-tab entry-point is already wired.
- Adding analytics / event tracking — no telemetry layer in this codebase yet.
