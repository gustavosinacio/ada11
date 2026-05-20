# Validation v1 — 2026-05-20_0302_exercise-progress-graph

Reviewing: `design-v1.md`

## Verification of Designer's claims

| Claim | Verified? | Evidence |
|---|---|---|
| Row `onPress` currently routes to `/(app)/exercises/${item.id}` (edit screen) | yes | `app/(app)/exercises/index.tsx:64`: `router.push(\`/(app)/exercises/${item.id}\`)` |
| Progress screen already exists at `exercises/[id]/progress.tsx` with two ProgressChart blocks and empty state | yes | `app/(app)/exercises/[id]/progress.tsx:105-119` (e1RM + volume charts); empty state at lines 96-102 |
| `Stack.Screen` is declared twice (loading at L73, loaded at L84-86) | yes | exact lines confirmed |
| Mid-page "View progress" CTA lives at `exercises/[id]/index.tsx:185-194` | yes | `<Link href={\`/exercises/${id}/progress\`} asChild>` |
| Measurements view→edit precedent uses headerRight Pencil at `measurements/[id]/index.tsx:148-157` | yes | Exact match. Function form, `accessibilityLabel`, `accessibilityRole="button"`, `className="px-3 py-1"`, `<Pencil ... size={20} />`. **Precedent uses size=20, not 22** — see MIN-1 |
| `useExerciseProgress` cache key shape is `["progress", exerciseId]` | yes | `src/hooks/use-progress.ts:7`. Umbrella `["progress"]` invalidation will match via TanStack prefix |
| `useFinishSession.onSuccess` currently invalidates `["sessions"]` and `["stats"]` but not `["progress"]` | yes | `src/hooks/use-sessions.ts:53-64` |
| Finishing a session is the only moment that creates new progress data points | yes | `src/api/progress.ts:15` filters `sessions.ended_at IS NOT NULL`. `useLogSet`/`useUpdateSet`/`useDeleteSet` operate on the in-progress session whose `ended_at` is null, so they cannot contribute to a chart point until finish |
| `Pencil` icon is universal across iOS/Android/web | yes | Used in `measurements/[id]/index.tsx:3` on all platforms |
| Post-delete back-navigation lands on the deleted exercise's progress screen | yes (real bug) | `getExercise` at `src/api/exercises.ts:21-30` uses `.is("deleted_at", null).single()` — after delete this **throws** (PGRST116 no rows), pushing `useExercise` into `isError`. `progress.tsx:70` only branches on `isLoading`, not `isError`; render falls through with `exercise.data?.name` undefined. Worse than Designer described — silently-broken header + name strip |
| `/progress` route has no other callers that would break when the mid-page CTA is removed | yes | Grep confirms only `exercises/[id]/index.tsx:185` (the CTA being removed) and the self-reference in `progress.tsx:5` |
| Measurements view's screen-header extraction pattern | yes — but Designer **diverges from it** | `measurements/[id]/index.tsx:143-160` extracts `screenHeader` to a const and re-uses across loading/error/loaded branches. Designer proposes **duplicating** `headerRight` in both branches of `progress.tsx` instead (Open Q #2). Cleaner precedent exists; Designer chose not to follow it |

## Issues found

### Blockers
None.

### Majors

- **[MAJ-1]** `app/(app)/exercises/[id]/index.tsx:77-91` (delete handler) — Designer's Open Q #1 flags this correctly but punts to Validator. **It is in-scope and should ship in this run.** Under A4, after delete the user lands on the progress screen of a now-soft-deleted exercise. `getExercise` at `src/api/exercises.ts:27` uses `.single()` with `deleted_at IS NULL`, so the refetched query throws PGRST116; `progress.tsx:70` does not branch on `isError`; the screen renders with an empty name, fallback title "Progress", and orphaned charts (set rows are still in DB). This is a user-visible glitch directly *caused* by the IA change in this run — not pre-existing. Suggested fix: in `onDelete` replace `router.back()` with `router.replace("/(app)/exercises")`. Matches the shipping measurements precedent at `app/(app)/measurements/[id]/edit.tsx:115`. Add this as a **fifth file change** to the design.

### Minors

- **[MIN-1]** Design §UI spec — Pencil `size={22}` vs measurements precedent `size={20}` at `measurements/[id]/index.tsx:155`. Pick one for cross-screen consistency. Suggested fix: use `size={20}` to match.

- **[MIN-2]** Design §"Open questions" #2 — Designer asks whether to duplicate `<Stack.Screen>` across loading/loaded branches or hoist. The measurements view at `app/(app)/measurements/[id]/index.tsx:143-160` already established the cleaner pattern: extract a `screenHeader` JSX const and re-use it. Suggested fix: extract `screenHeader` once in `progress.tsx`.

- **[MIN-3]** Design §"Open questions" #3 — pencil tappable during loading-window of progress screen. Verified: tapping routes to `/(app)/exercises/${id}` (edit screen), edit screen has its own loading state, no race. Safe to ship as-is.

- **[MIN-4]** Design §Riscos "Back-gesture chain depth +1" — after **save** the user lands on the progress screen of the just-edited exercise. Reasonable, but worth a Tester smoke step to confirm `useExercise` invalidation on update via `setQueryData(KEYS.detail(row.id), row)` in `use-exercises.ts:49` reflects the new name in the progress header.

- **[MIN-5]** Design §Out of scope — replacing inline `.toFixed(1)` / `>=1000 ? /k : toFixed(0)` with `formatWeight`/`formatVolume` is held. Acceptable known debt.

## Decision

**go**

Reasoning:
- 0 blockers, 1 major, 5 minors → `go` per the rule.
- **MAJ-1 must be folded into the Implementer's task list as a fifth file change.** Not lingering debt — it's a direct consequence of the IA change. The fix is a 1-line `router.replace` swap with an exact shipping precedent.
- MIN-1, MIN-2 are inexpensive consistency fixes against the very precedent Designer chose to mirror — fold into Implementer brief.
