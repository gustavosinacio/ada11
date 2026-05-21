# Validation v1 — 2026-05-21_1554_tap-exercise-name-to-progress

## Summary
Small, single-component change. Design accurate except for one cited precedent — claim that `<ExerciseListItem>` omits a visual cue is wrong (it has both `active:bg-*` AND a chevron). The "no visual cue" decision leaves web/native without press feedback. One-token fix.

## Claim verification

| Claim | File:line | Verdict |
|---|---|---|
| Name `<Text>` bare | `exercise-block.tsx:102-107` | TRUE |
| Optional-callback Props precedent | `exercise-block.tsx:16-17, 27` | TRUE |
| Action cluster unaffected | `exercise-block.tsx:121-157` | TRUE |
| Volume-target strip is sibling, no overlap | `exercise-block.tsx:160-165` | TRUE |
| Live workout callsite + `router` bound | `workout/[sessionId].tsx:38, 316` | TRUE |
| History detail callsite | `history/[id].tsx:240` | TRUE |
| "useRouter may need to be added in history" | `history/[id].tsx:36` | FALSE — already bound at line 36 |
| Route literal matches existing | `exercises/index.tsx:64` | TRUE |
| Soft-deleted resolves via `useAllExercise` | `use-exercises.ts:49` | TRUE |
| `<ExerciseListItem>` has no visual cue | `exercise-list-item.tsx:23, 31` | FALSE — has `active:bg-gray-50 dark:active:bg-gray-950` + chevron |

## Issues

### Major

**MAJ-1** — Visual cue claim contradicts cited precedent; leaves web/native without press feedback.
Every navigation-affordance precedent in this codebase has BOTH `active:bg-*` (or `active:opacity-*`) AND a trailing chevron. Without `active:opacity-70` or `cursor-pointer`, the name won't look interactive:
- **Web**: `react-native-web`'s `<Pressable>` does NOT add `cursor: pointer` for inline text-sized targets without an active style.
- **iOS / Android**: vanilla `<Pressable>` does NOT auto-dim on press (that's `<TouchableOpacity>`).

**Fix**: add `active:opacity-70` to the `<Pressable>` wrapping the name. Precedent: `weekly-volume-strip.tsx:131`. One-token edit. Keep no chevron (would crowd the action cluster).

### Minors

- **MIN-1** Stale Implementer note: design hedges "`useRouter` may need to be added in history detail." It's already at `history/[id].tsx:36`. Drop the hedge.
- **MIN-2** `accessibilityLabel` excludes the `(deleted)` suffix that the visible text shows for soft-deleted exercises. Acceptable; cleaner read-out.
- **MIN-3** Optional: `selectable={false}` on the inner `<Text>` if drag-to-select on web interferes. Codebase doesn't currently use `select-none` anywhere; defer unless observed.

## Decision

**go** — 0 blockers, 1 major (one-token fix), 3 minors.

Implementer should fold:
1. **MAJ-1**: `active:opacity-70` on the Pressable.
2. **MIN-1**: drop the stale `useRouter` hedge from the docs/notes.

MIN-2 and MIN-3 are FYI.

Round 1 of 3. No re-design needed.
