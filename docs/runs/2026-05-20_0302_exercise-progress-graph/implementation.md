# Implementation — 2026-05-20_0302_exercise-progress-graph

Based on: `design-v1.md` (final approved) and `validation-v1.md` (matching `go`, MAJ-1 folded in by Conductor brief).

## Files changed

- `app/(app)/exercises/index.tsx` (edited) — Row `onPress` destination changed from `/(app)/exercises/${item.id}` (edit) to `/(app)/exercises/${item.id}/progress` (chart). Single-line change at line 64.
- `app/(app)/exercises/[id]/progress.tsx` (edited) — Added `Pencil` import (lucide), `useRouter`, `Pressable`, `useColorScheme`. Extracted `screenHeader` JSX const at component top with `headerRight` pencil that navigates to `/(app)/exercises/${id}` (edit). Mounted `{screenHeader}` in both the loading branch and the loaded branch (replacing both prior `<Stack.Screen>` calls). Pencil `size={20}`, color via `useColorScheme()`, `accessibilityLabel="Edit exercise"`, `accessibilityRole="button"`, `className="px-3 py-1"` — byte-for-byte matches `measurements/[id]/index.tsx:143-160` precedent except icon, label, and onPress target.
- `app/(app)/exercises/[id]/index.tsx` (edited) — Removed mid-page "View progress" `<Link>` block (formerly L185-194). In `onDelete`, swapped `router.back()` for `router.replace("/(app)/exercises")` (MAJ-1 fold-in: prevents landing on the soft-deleted exercise's progress screen, matches `measurements/[id]/edit.tsx:115`). Dropped now-unused `Link` and `Pressable` imports.
- `src/hooks/use-sessions.ts` (edited) — `useFinishSession.onSuccess` now invalidates the umbrella `["progress"]` key (prefix-matches all `["progress", exerciseId]` entries via TanStack semantics) in addition to the existing `["sessions"]` and `["stats"]` invalidations.

No new files. No deletions. No package changes. No DB changes.

## Deviations from design

- **None.** All five file changes in the Conductor brief (design's 4 + MAJ-1 fold-in) were executed exactly as written. The brief flagged a potential 5th file (`tests/e2e/crud.spec.ts`) as conditional ("if applicable"); inspection confirmed there is no existing test that taps an exercise row and expects to land on the edit form — the only relevant exercises e2e (`exercises: create custom exercise`) verifies the new-exercise flow lands back on the list, which is unaffected. No test change needed; this is not a deviation, the brief explicitly conditioned this.
- One incidental hygiene fix: removed the now-unused `Link` and `Pressable` imports from `app/(app)/exercises/[id]/index.tsx` after deleting the "View progress" block, to keep lint clean (lint flagged `Pressable` as unused; `Link` would have followed). Not a behavioral change; cleanup tied to the deletion.

## Soft callbacks made (during this implementation pass)

- None.

## Quality gates

- [x] `npm run typecheck` passed (clean, no output)
- [x] `npm run lint` passed — only the pre-existing `router.d.ts` warning remains (matches the brief's "pre-existing warning acceptable" carve-out)
- [x] `npm run test:unit` — all 51 tests across 6 files pass
- [x] No new `any` — grep on the four modified files returns nothing
- [x] No new `// @ts-ignore` — grep on the four modified files returns nothing
- [x] No stray `console.log` — the only `console.*` calls in touched files are the pre-existing `console.warn` in catch-blocks of `[id]/index.tsx`

e2e run was not executed: per the brief's "if dev server runs cleanly" conditional, and given that no existing e2e spec exercises the exercise-row-tap-to-edit path that this run changes, the Tester agent can decide whether to spin up the dev server and run the suite.

## Notes for Reviewer / Tester

- **Cache invalidation correctness**: After finishing a session, `["progress"]` is now invalidated as an umbrella key. TanStack matches any query whose key starts with `["progress", ...]` (prefix-match semantics). This covers every `useExerciseProgress(exerciseId)` entry in the cache. No correctness concern with overinvalidation — refetches are lazy (observer-bound), and the count of distinct cached progress entries is bounded by exercises the user has opened (typically <50).
- **Post-delete navigation glitch (MAJ-1 fix)**: Tester should verify the exercise delete path. Steps: open exercise list → tap row (lands on progress chart) → tap pencil (lands on edit) → tap "Delete exercise" → confirm. Expected: lands back on the exercise list, the deleted exercise is gone, no flash of the broken progress screen. The fix is `router.replace("/(app)/exercises")` in `[id]/index.tsx` `onDelete`.
- **Header re-renders cleanly across loading/loaded branches**: the `screenHeader` const is referenced from both branches, so the pencil renders immediately on the loading branch without a pop-in when data arrives. Visual continuity matches the measurements view-edit precedent.
- **Save flow now returns to progress, not list**: after saving an edit, `router.back()` lands on the progress chart of the just-edited exercise. Validator MIN-4 flagged this as worth a smoke test: the title in the header should reflect the new name on return — confirmed via `setQueryData(KEYS.detail(row.id), row)` in `use-exercises.ts:49` updating the `useExercise(id)` cache used by the progress screen's header.
- **Edit screen reachability via deep link unchanged**: anyone with `/(app)/exercises/${id}` URL still lands on the edit form. The IA change is only on the list-row tap.

## Status

`done`
