# Implementation — 2026-05-20_0410_strong-workout-routines-unify

Based on: `design-v3.md` (final approved) and `validation-v3.md` (matching `go`, 2 polish minors absorbed).

## Files changed

- `src/components/active-session-banner.tsx` (new) — Sticky banner mounted globally that reads `useActiveSession()` and renders only when a session row is returned; taps push to `/(app)/workout/${id}`. Dark-mode tokens via NativeWind + `useColorScheme()` for chevron contrast.
- `app/(app)/_layout.tsx` (edited) — Three surgical changes per design-v3 §UI spec: (1) dropped the `ListChecks` import (was the routines tab icon); (2) replaced the `<Tabs.Screen name="routines">` `title`/`tabBarIcon` options with `options={{ href: null }}` to hide the tab while keeping the directory route resolvable under Expo Router v6; (3) wrapped `<Tabs>` in a `<View className="flex-1 bg-white dark:bg-black">` and mounted `<ActiveSessionBanner />` as a sibling above the `<Tabs>`. All other tab titles ("Workout", "Exercises", "History", "Measurements", "Profile") and icons (`Dumbbell`, `Wrench`, `History`, `Ruler`, `User`) preserved verbatim per MAJ-NEW-2. Per MIN-NEW-5, `Clock` was NOT added to the imports.
- `app/(app)/workout/index.tsx` (rewritten) — Unified hub. Drops the modal picker (`pickerOpen` state, `<Modal>` block) and the `useEffect` auto-redirect on `active.data`. Adds `useColorScheme()` + `RoutineRow` type import. Keeps the existing `active.isLoading` early-return as the MAJ-NEW-1 race-window gate. Both start handlers now short-circuit to `router.push(\`/(app)/workout/${active.data.id}\`)` when a session is live. Render: `Stack.Screen` `headerRight` = `+` (`accessibilityLabel="New routine"`, `accessibilityRole="button"`, `useColorScheme()` for icon color) that pushes `/(app)/routines/new`. Body renders empty-state (Quick start + Create routine secondary) when zero routines, or a FlatList of `RoutineListItem` with `onPress` = `startFromRoutine`, `onEditPress` = `router.push("/routines/[id]")`, `disabled={hasActive}`. ListHeaderComponent = full-width "Quick start workout" Button + "Your routines" section header.
- `src/components/routine-list-item.tsx` (edited) — Extended `lucide-react-native` import to `{ ChevronRight, Pencil }`. Added optional `onEditPress?: () => void` and `disabled?: boolean` props. When `disabled`, outer Pressable becomes no-op and row renders at `opacity-60`. When `onEditPress` is set, renders a right-aligned Pencil + "Edit" Pressable (`accessibilityLabel="Edit routine: ${name}"`, `hitSlop={8}`) that calls `e.stopPropagation?.()` before delegating. Backwards compatible — if `onEditPress` unset, the passive `ChevronRight` glyph renders as before.
- `app/(app)/routines/index.tsx` (rewritten) — Reduced to a two-line named redirect: `export default function RoutinesRedirect() { return <Redirect href="/(app)/workout" />; }`. Absorbs web bookmarks of `/routines`. All previous imports dropped per MIN-NEW-1.
- `tests/e2e/crud.spec.ts` (edited) — Lines 81-129 rewrote the routines flow to drive from the Workout home: click `getByText("Workout").first()` → assert `/\/workout$/` → click "Create routine" empty-state button → fill + save → assert URL back to `/\/workout$/` and the new routine visible → click the `Edit routine: ${name}` pill → assert `/\/routines\/[uuid]/` → delete → assert URL back to `/\/workout$/` and the routine gone. Lines 170 + 175 renamed `"Start ad-hoc workout"` → `"Quick start workout"`.
- `tests/e2e/exercise-progress-ia.spec.ts` (edited) — Line 182 renamed `"Start ad-hoc workout"` → `"Quick start workout"`.
- `tests/e2e/measurements.spec.ts` (edited) — Lines 320-330: renamed the test from `"regression: 6 tabs render, Profile shows weight + length unit toggles"` to `"regression: 5 tabs render, no Routines tab, Profile shows weight + length unit toggles"`; removed the positive "Routines" assertion; added a negative `expect(page.getByText("Routines", { exact: true })).not.toBeVisible()`.

## Deviations from design

- **Active-session banner: `chevronColor` adapted via `useColorScheme()`.** The design v3 snippet at line 322 hard-codes `<ChevronRight color="#fff" size={16} />`. In dark mode the banner background flips to `bg-gray-100` (light), so a `#fff` chevron on a light background is invisible. Implemented with `chevronColor = colorScheme === "dark" ? "#000" : "#fff"` to match the contrast of the surrounding `text-white dark:text-black` labels in the same snippet. No design intent change; purely a contrast fidelity fix.
- **`workout/index.tsx`: preserved the pre-existing `console.warn("Start failed", err)` try/catch around `start.mutateAsync(...)`.** Design v3 snippet (lines 234-245) omits error handling. The prior file (`workout/index.tsx:31-38, 40-51`) had a `try/catch` with `console.warn`. Preserved both the pattern and the `console.warn` (not a new `console.log`) to maintain pre-existing failure observability.
- **Active-session-banner safe-area on iOS.** Pinned in design-v3 §Riscos > Banner safe-area as v1 deferred (MIN-NEW-4); shipped at the above-Tabs position per validator-accepted decision. No change to design.

## Soft callbacks made (during this implementation pass)

None.

## Quality gates

- [x] `npm run typecheck` passed — clean (no errors).
- [x] `npm run lint` passed — `0 errors, 1 warning` (pre-existing `router.d.ts` warning only).
- [x] Relevant unit tests pass — `npm run test:unit` → **51/51 in 6 files**.
- [x] No new `any` — verified by grep on changed files.
- [x] No new `// @ts-ignore` — verified by grep on changed files.
- [x] No stray `console.log` — verified by grep on changed files. One preserved `console.warn` from the prior `workout/index.tsx` is intentional and pre-existing.

## Notes for Reviewer / Tester

- **`_layout.tsx` imports:** alphabetically lists `Dumbbell, History, Ruler, User, Wrench` from `lucide-react-native` (no `ListChecks`, no `Clock`) and `View` from `react-native`. The `<ActiveSessionBanner>` is imported via the `~/components/active-session-banner` path alias to match other component imports in the repo (not a relative `../../src/...` import as the design snippet sketched).
- **Active-session guard layering — three layers as designed:**
  - File `app/(app)/workout/index.tsx:27-33` — `active.isLoading` ActivityIndicator early-return (MAJ-NEW-1 gate).
  - File `app/(app)/workout/index.tsx:38-41, 51-54` — both start handlers check `active.data` at call-time and `router.push` to the live screen instead of mutating.
  - File `app/(app)/workout/index.tsx:123` — `disabled={hasActive}` row prop dims the routine card and disables its outer onPress.
- **`RoutineListItem` backwards compatibility:** the new `onEditPress` + `disabled` props are optional. The only caller is the new Workout home; no other callsites need updating. If a future caller leaves `onEditPress` unset, the row still renders the original `ChevronRight` glyph and remains tap-to-onPress.
- **Routes after change:** `/routines` redirects to `/workout`; `/routines/new` and `/routines/[id]` are reached via `router.push` from the Workout home (header `+` and Edit pill respectively); `router.back()` on save/delete returns to `/workout`. Verified at `app/(app)/routines/new.tsx:38` (router.back) and the delete path in `app/(app)/routines/[id]/index.tsx`. Tester: please confirm Android hardware back-button behavior on these screens lands on `/workout`.
- **No DB / API change.** `src/api/sessions.ts` is untouched. Server-side unique partial index on `sessions(user_id) WHERE ended_at IS NULL` is tracked as known debt (design-v3 §Out of scope); client guards only in this run.
- **E2E test count unchanged:** the rewritten routines test still counts as one, and the renamed measurements regression test still counts as one.
- **Tester E2E preconditions:** the new `crud.spec.ts` routines flow waits for `/workout$` after sign-in and asserts the empty-state "Create routine" button is visible on the Workout home. The new user starts with zero routines, so the empty-state path is the correct entry. After save, the flow asserts URL is back at `/workout$` and the row is visible — same assertion the design specified.

Status: **done**. Recommendation to Conductor: invoke **Reviewer**.
