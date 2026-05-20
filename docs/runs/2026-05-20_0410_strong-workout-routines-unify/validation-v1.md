# Validation v1 — 2026-05-20_0410_strong-workout-routines-unify

Reviewing: `design-v1.md`

## Verification of Designer's claims

| Claim | Verified? | Evidence |
|---|---|---|
| `app/(app)/_layout.tsx` declares 6 tabs incl. `routines` with `ListChecks` icon | yes | `app/(app)/_layout.tsx:11-58`. |
| `workout/index.tsx:25-29` auto-redirects to active session | yes | verbatim `useEffect`. |
| `workout/index.tsx:88-139` is the modal picker block to be removed | yes | confirmed; `pickerOpen` state at L22 also needs removing. |
| `startSession({ routine_id })` API exists | yes | `src/api/sessions.ts:38-60` accepts `routine_id?: string \| null`. |
| `useActiveSession()` queries `sessions` where `ended_at IS NULL` | yes | `src/api/sessions.ts:26-36` + `src/hooks/use-sessions.ts:35-40`. |
| `useStartSession()` sets active cache on success | yes | `src/hooks/use-sessions.ts:42-51`. |
| `useRoutines()` already called unconditionally on Workout home | yes | `workout/index.tsx:20`. |
| `<Redirect href="..." />` is the correct Expo Router API | yes | precedent at `app/index.tsx:6`. |
| Empty state copy "No routines yet. Create one from the Routines tab." at `workout/index.tsx:111` becomes stale | yes | verbatim. |
| `tests/e2e/crud.spec.ts:81-129` drives via the literal "Routines" tab | yes | line 89 click + line 90 `waitForURL`. |
| `tests/e2e/crud.spec.ts:170` asserts "Start ad-hoc workout" literal | yes | **and line 175 repeats it** — design misses 175. |
| **Removing `<Tabs.Screen name="routines" />` is enough to hide the tab** | **no** | Expo Router v6 (`expo-router ~6.0.23`) auto-detects directory routes under a `Tabs` parent. Removing the `Tabs.Screen` declaration does NOT delete the tab — at best it re-appears with default options. To hide a tab while keeping route resolvable, use `options={{ href: null }}`. See **BLK-1**. |
| The two tests referencing "Start ad-hoc workout" are only at `crud.spec.ts:170` | **no** | `tests/e2e/exercise-progress-ia.spec.ts:182` also clicks the literal. See **MAJ-1**. |
| Tab count `6 → 5` is just a layout consequence | **no** | `tests/e2e/measurements.spec.ts:320-330` declares `"regression: 6 tabs render, Profile shows weight + length unit toggles"` and asserts "Routines" visible at line 326. See **MAJ-2**. |

## Issues found

### Blockers

- **[BLK-1]** `app/(app)/_layout.tsx` — Removing `<Tabs.Screen name="routines" />` does **not** hide the tab in Expo Router v6. File-based routing auto-mounts `app/(app)/routines/` as a tab unless explicitly hidden. **Fix**: use `<Tabs.Screen name="routines" options={{ href: null }} />`. The `ListChecks` icon import can still be dropped. Designer flagged this as Open Q #1 but did not commit; v2 must commit.

### Majors

- **[MAJ-1]** `tests/e2e/exercise-progress-ia.spec.ts:182` — Second file asserts `"Start ad-hoc workout"` literal. When copy changes to "Quick start workout", this test breaks. Design only mentions `crud.spec.ts:170` (and misses `:175`). **Fix**: extend test-rewrite plan to cover `crud.spec.ts:170, 175` + `exercise-progress-ia.spec.ts:182`.

- **[MAJ-2]** `tests/e2e/measurements.spec.ts:320-330` — A regression test explicitly asserts 6 tabs render including "Routines" (line 326). Removing the tab breaks this assertion and the test name lies. Design doesn't mention this test. **Fix**: rename to `"regression: 5 tabs render, no Routines tab, ..."`, remove the Routines assertion, add a negative assertion that "Routines" is NOT visible.

- **[MAJ-3]** `app/(app)/workout/index.tsx` (active-session interaction) — **Pre-existing latent bug exposed by removing the auto-redirect.** Today the home auto-redirects (lines 25-29) so the user cannot trigger `startSession` while a session is active. After the design lands, the home shows quick-start + routine cards. Tapping any of them calls `startSession.mutateAsync(...)`, which inserts a new `sessions` row with no server-side guard (`src/api/sessions.ts:38-60` — no DB unique-partial-index on `(user_id) where ended_at IS NULL`). Result: orphaned in-progress session. **Fix**: client-side guard — if `active.data` exists, `startAdHoc`/`startFromRoutine` route to `/(app)/workout/${active.data.id}` instead of inserting a new row. Surface a toast "You have a workout in progress."

### Minors

- **[MIN-1]** `routines/_layout.tsx` is dead-weight under the fixed Option 1 (with `href: null`). Acceptable; confirm in v2 that it stays unchanged.
- **[MIN-2]** Empty-state copy mentions "tap +" but renders a labelled "Create routine" button. Pick one signal.
- **[MIN-3]** Routine ordering not addressed — preserve `created_at DESC` from `src/api/routines.ts:14`.
- **[MIN-4]** Zero-exercise routine: design should explicitly state "starts a session; live screen empty state handles the case".
- **[MIN-5]** Open Q #3 (nested Pressable bubbling): commit to `e.stopPropagation?.()` in the edit-pill onPress.
- **[MIN-6]** `routines/new.tsx:38` `router.back()` returns cleanly to `/workout` — no change, just pin in v2 route map.
- **[MIN-7]** Banner copy uses U+203A `›` glyph; repo idiom is `<ChevronRight>` icon from `lucide-react-native`. Use the icon.
- **[MIN-8]** Banner placement on iOS: commit to (a) above Tabs (current design — accept the "between status bar and per-tab header" visual). Document as v1-acceptable; follow-up if visual review flags it.
- **[MIN-9]** `routines/index.tsx` after `<Redirect>` — drop unused imports (ESLint will warn otherwise). Single-line file: `import { Redirect } from "expo-router"; export default function () { return <Redirect href="/(app)/workout" />; }`.
- **[MIN-10]** Mid-session tap on routine card is confusing ("tapped Push Day, opens Pull Day"). Dim cards with `opacity-60` when `active.data` exists; preserves Strong's "blocked tap → resume" behavior.

## Decision

**no-go**

Reasoning:
- 1 blocker + 3 majors. Fix paths are concrete and contained — single-round v2 should land.

Designer must address in v2:
1. **BLK-1**: commit to `<Tabs.Screen name="routines" options={{ href: null }} />`.
2. **MAJ-1**: include `crud.spec.ts:170, 175` AND `exercise-progress-ia.spec.ts:182` in the test rewrite.
3. **MAJ-2**: rewrite `measurements.spec.ts:320-330` (rename + negative assertion).
4. **MAJ-3**: client-side guard — `useActiveSession().data` exists → redirect to live session; dim routine cards (MIN-10).
5. Fold all 10 minors as polish or pin them as decisions.
