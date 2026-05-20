# Validation v2 — 2026-05-20_0410_strong-workout-routines-unify

Reviewing: `design-v2.md`

## Issues raised in previous validation

| ID | Severity | Addressed? | Note |
|---|---|---|---|
| BLK-1 | blocker | **yes** | `Mudanças por arquivo` row for `_layout.tsx` + snippet commit to `<Tabs.Screen name="routines" options={{ href: null }} />`. API verified at `expo-router/build/layouts/TabsClient.d.ts:52-54`. |
| MAJ-1 | major | **yes** | Decision row 10 + Mudanças rows for `crud.spec.ts:170,175` AND `exercise-progress-ia.spec.ts:182`. |
| MAJ-2 | major | **yes** | Mudanças row for `measurements.spec.ts` — rename, drop positive, add negative assertion. |
| MAJ-3 | major | **partial** | Settled `active.data` guard added + opacity-60 cards. But dropped `active.isLoading` early-return. See MAJ-NEW-1. |
| MIN-1..10 | minor | yes | All folded into design v2. |

## v2-new claims

| Claim | Verified? | Evidence |
|---|---|---|
| `href: null` is correct Expo Router v6 API | yes | `node_modules/expo-router/build/layouts/TabsClient.d.ts:52-54` |
| `useActiveSession()` returns `SessionRow \| null` | yes | `src/api/sessions.ts:26-36` + `src/hooks/use-sessions.ts:35-40` |
| NativeWind `opacity-60` valid on Pressable | yes | Precedent in 5+ existing components |
| `<ChevronRight>` import path | yes | Used in 4 existing components |
| `Redirect` from `expo-router` | yes | `app/index.tsx:6` |
| Playwright `not.toBeVisible()` | yes | Active use at `crud.spec.ts:125,198` |
| `_layout.tsx` snippet preserves declared tabs | **no** | Snippet renames Measurements title to "Body", swaps Exercises icon `Wrench → Library`, swaps History icon `History → Clock`. Not declared in Mudanças, contradicts decision row 6. See MAJ-NEW-2. |

## Issues found

### Blockers
None.

### Majors

- **[MAJ-NEW-1]** `app/(app)/workout/index.tsx` (active-session guard race window). Current `workout/index.tsx:53-58` has `if (active.isLoading) return <ActivityIndicator/>;`. The v2 snippet drops this branch and only checks `routines.isLoading`. The start-handler guard `if (active.data) router.push(...)` only triggers on settled value; while `active.data === undefined`, the guard misses, `startSession.mutateAsync({})` runs, and a second `sessions` row is inserted. **Fix**: either (a) early-return on `active.isLoading`, (b) `disabled={active.isLoading}` on Quick start + dim cards while loading, or (c) extend the handler guard to `if (active.data || active.isLoading) return;`.

- **[MAJ-NEW-2]** `app/(app)/_layout.tsx` snippet introduces undeclared changes:
  1. `title: "Body"` for Measurements (current = "Measurements"; decision row 6 = "Measurements"). Breaks `measurements.spec.ts:75, 329`.
  2. Exercises icon `Wrench → Library`, History icon `History → Clock`. Not declared, not justified.
  **Fix**: revert snippet to current titles and icons. Only intentional `_layout.tsx` change is the `href: null` + drop `ListChecks` import + wrap in `<View>` for the banner.

### Minors

- **[MIN-NEW-1]** Anonymous default export in `routines/index.tsx` may trigger `import/no-anonymous-default-export`. Name it `RoutinesRedirect`.
- **[MIN-NEW-2]** `Pencil` import must be added to `routine-list-item.tsx`: `import { ChevronRight, Pencil } from "lucide-react-native"`.
- **[MIN-NEW-3]** Workout home `headerRight` snippet uses `colorScheme`; Implementer must add `import { useColorScheme } from "react-native"` + `const colorScheme = useColorScheme()`. Precedent: `routines/index.tsx:3,10`.
- **[MIN-NEW-4]** Banner safe-area on iOS — accepted as v1 deferred (MIN-8). Pinned again.

## Decision

**no-go**

Reasoning:
- 0 blockers, 2 majors → `no-go`.
- Both fixes are tight (≤ 10 lines). Round 2 of 3; one round remains before escalation.

Designer must address in v3:
1. **MAJ-NEW-1**: re-introduce `active.isLoading` gating.
2. **MAJ-NEW-2**: revert `_layout.tsx` snippet to current titles ("Measurements") and current icons (`Wrench`, `History`). Only intentional changes: `href: null` on routines, drop `ListChecks`, wrap in `<View>` for banner.
3. Fold 4 minors as polish.

## Counts
- Blockers: 0
- Majors: 2
- Minors: 4
