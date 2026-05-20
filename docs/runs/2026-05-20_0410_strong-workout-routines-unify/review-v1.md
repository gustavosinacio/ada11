# Review v1 — 2026-05-20_0410_strong-workout-routines-unify

## Decision: pass

## Counts: 0 blockers / 0 majors / 2 minors

## Quality gates
- `npm run typecheck` — clean.
- `npm run lint` — 0 errors, 1 pre-existing `router.d.ts` warning.
- `npm run test:unit` — 51/51.

## Findings

### MIN-1 — Undocumented background class on `_layout.tsx` View wrapper
- File: `app/(app)/_layout.tsx:15`
- Design v3 snippet had `<View className="flex-1">`; implementation ships `<View className="flex-1 bg-white dark:bg-black">`. Purely additive (prevents flash) but undeclared in §Deviations.

### MIN-2 — Quick start button has no visual cue when blocked
- File: `app/(app)/workout/index.tsx:97`
- When `hasActive`, routine cards dim to opacity-60 but the Quick start button stays visually unchanged. Tapping still navigates to live session (correct), but the affordance/visual contract is asymmetric. Either dim the button too or accept the asymmetry.

## Spec-by-spec verification (all pass)

| Check | Result |
|---|---|
| `<Tabs.Screen name="routines" options={{ href: null }} />` | OK at `_layout.tsx:25-28` |
| `ActiveSessionBanner` mounted globally, returns `null` when no active | OK |
| Quick start button + routines list + headerRight `+` icon | OK |
| Early-return on `active.isLoading` | OK at `workout/index.tsx:28-34` |
| `startAdHocWorkout` active-session guard | OK at `:38-42` |
| `startFromRoutine` active-session guard | OK at `:51-55` |
| Routine cards `opacity-60` + redirected tap via `disabled` prop | OK |
| `Pencil` icon in `routine-list-item` | OK |
| `onEditPress` with `e.stopPropagation?.()` | OK at `routine-list-item.tsx:36-39` |
| `routines/index.tsx` is 2-line named `RoutinesRedirect` | OK |
| `_layout.tsx`: `ListChecks` dropped, `Clock` NOT added | OK |
| `_layout.tsx`: titles + icons preserved | OK |
| `crud.spec.ts:170, 175` copy update | OK |
| `exercise-progress-ia.spec.ts:182` copy update | OK |
| `measurements.spec.ts:320-330` rename + negative assertion | OK |
| `crud.spec.ts:81-129` rewrite drives from Workout home | OK |
| No new `any` / `@ts-ignore` / `console.log` | OK |
| Cache namespace isolation | OK |
| No service-role / RLS / EXPO_PUBLIC leakage | OK |

## Decision rationale
- 0 blockers, 0 majors, 2 minors (both polish/documentation).
- Three-layer active-session protection correctly closes MAJ-NEW-1.
- `_layout.tsx` respects MAJ-NEW-2 modulo undocumented bg class (MIN-1).
- All test rewrites match design prescriptions.
