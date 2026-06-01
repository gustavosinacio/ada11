# Implementation — 2026-06-01_1301_favorite-exercises-e1rm

Based on: `design-v2.md` (final approved) and `validation-v2.md` (GO, round 2).

## Files changed

### Production
- `supabase/migrations/0020_user_exercise_favorites.sql` (new) — favorites join table `user_exercise_favorites(user_id, exercise_id, created_at)`, composite PK, FK CASCADE on both `user_id`→`auth.users` and `exercise_id`→`exercises`, RLS enabled + 3 policies (SELECT/INSERT/DELETE, all gated `auth.uid() = user_id`). DDL byte-for-byte design-v2 §"Migration DDL". **FILE ONLY — NOT applied to the live DB; the Conductor applies it.** Verified 0019 is the latest existing migration → 0020 is the next free number.
- `src/db/schema.ts` (edited) — added `primaryKey` to the `drizzle-orm/pg-core` import (was NOT imported; the prior `.primaryKey()` hits are the column-builder method); added the `userExerciseFavorites` pgTable after `exerciseNotes` (`:305+`) with the composite PK.
- `src/db/types.ts` (edited) — added `userExerciseFavorites` to the schema import; added `UserExerciseFavorite`/`NewUserExerciseFavorite` Drizzle types (after `ExerciseNote`) + the `UserExerciseFavoriteRow` PostgREST row type (after `ExerciseNoteRow`).
- `src/api/exercise-favorites.ts` (new) — `listMyFavoriteExerciseIds()` (auth-gate → `[]`; SELECT `exercise_id` WHERE `user_id=uid`; maps rows→ids), `addFavorite(id)` (plain INSERT; SWALLOWS SQLSTATE 23505 = already favorited; re-throws others), `removeFavorite(id)` (`.delete().eq(user_id).eq(exercise_id)`). No upsert, no 23505-retry-loop.
- `src/hooks/use-exercise-favorites.ts` (new) — `useMyFavoriteExerciseIds()` (query key `["exercise_favorites","me"]`) + `useToggleFavorite()` (optimistic `onMutate` add/remove via `setQueryData`, `onError` rollback to `ctx.prev`, `onSettled` invalidate). Mirrors the `useReorderRoutineExercises` optimistic shape adapted for a `string[]` cache.
- `src/utils/e1rm-strength.ts` (edited) — added exported `E1RM_MAX_LINES = 12` + module-level `EMPTY_SET`; added `favoriteExerciseIds?: ReadonlySet<string>` to `presentTopExerciseE1rm`; split the chained `.sort().slice()` into `const sorted = …sort(comparator)` then the **top-N-OVERALL ∪ favorites** union-then-cap selection (`autoTopOverall = sorted.slice(0,topN)`, `extraFavorites = sorted.filter(favSet.has && !autoIds.has)`, `selected = [...autoTopOverall, ...extraFavorites]`, cap at `E1RM_MAX_LINES` dropping lowest non-favorites first, degenerate favorites>12 branch). Comparator + LOCF + dense-rank `ranked.map` untouched. Invariant F: empty/absent favorites → literal `sorted.slice(0, topN)`.
- `src/components/e1rm-strength-section.tsx` (edited) — extended `E1RM_PALETTE` from 8→12 hexes (the 4 design-v2 hues: green-700 `#15803d`, slate-500 `#64748b`, rose-600 `#e11d48`, amber-800 `#92400e`; first 8 byte-for-byte unchanged) + updated the comment; imported `useMyFavoriteExerciseIds`; `const favoriteSet = useMemo(() => new Set(favoriteIds ?? []), [favoriteIds])`; added `favoriteSet` to the model `useMemo` deps; pass `favoriteExerciseIds: favoriteSet` to the presenter.
- `app/(app)/exercises/[id]/progress.tsx` (edited) — imported `Star` (alongside `ChevronLeft`/`Pencil`) + the two favorite hooks; added `favoriteIds`/`toggleFavorite`/`isFavorite` derivation; rewrote `headerRight` to ALWAYS render the star (a11y label `"Favorite <Name>"`/`"Unfavorite <Name>"`, optimistic `mutate`) with the Pencil (`"Edit exercise"`, gated on `canEdit`) rendered INSIDE the function. Star outside `canEdit` → works for canonical + owned exercises.

### Tests
- `tests/unit/e1rm-strength.test.ts` (edited) — appended a `favorites union` describe block (11 new cases): case 1 (outside→+1, appended last, top-5 ranks unchanged), **case 2 (inside top-N → SAME count, id once, byte-identical to no-fav — the MAJ-1 fix)**, case 3 (bodyweight-only favorite excluded), case 4 (no-set favorite excluded), case 5 (over-ceiling drops lowest non-favorite, all favorites kept), case 6 (dense ranks for 6-series + 12-series), case 7 (determinism over set insertion order), **case 8 (Invariant F — no-arg vs empty-Set deep-equal, == pre-change top-N output)**, case 9 (exactly 12 → no trim), case 10 (one over → single lowest non-favorite dropped), case 11 (favorites>12 → favorites themselves trimmed, zero auto survive). Added a `seedWeightedByDecreasingSessions` helper.
- `tests/unit/exercise-favorites-api.test.ts` (new) — mirrors `exercise-notes-api.test.ts` (`vi.mock("~/lib/supabase")` + `pendingChains` + leftover-chain guard), adapted to a thenable builder (favorites' list/add/remove await the builder directly — no `.maybeSingle()`/`.single()`). Covers auth-gate, list maps ids / null→[], addFavorite plain INSERT / swallows 23505 / re-throws non-23505, removeFavorite delete + re-throw. 11 tests.
- `tests/rls.test.ts` (edited) — appended a `user_exercise_favorites` arm after the `routine_exercise_sets` arm: A inserts `{user_id: A, exercise_id: aEx.id}` → succeeds; B SELECT → 0 rows; B DELETE → 0 rows; B spoof-INSERT `{user_id: A}` → rejected. No UPDATE arm (no mutable column). Updated the final `console.log`.
- `tests/e2e/favorite-exercises-e1rm.spec.ts` (new) — mirrors the `e1rm-strength.spec.ts` harness. Seeds 5 multi-session WEIGHTED top exercises + 1 single-session WEIGHTED outside-top-N TARGET (canonical); favorites the TARGET on its detail page → its chip appears in the chart; unfavorites → gone. Asserts the canonical gate split (star visible + `"Edit exercise"` absent). Settle-gate (section header visible) before every `toHaveCount(0)`.

## Deviations from design

1. **e2e seed names — 4 of the 6 design-v2 §D names DO NOT EXIST in the live canonical catalog; substituted live-verified equivalents.** This is exactly the carry-in MIN-4 / Validator residual-B path (live-verify each via `pickCanonicalExercise`, substitute a live-catalog WEIGHTED name on a miss). I probed the live catalog (the same query `pickCanonicalExercise` runs: `exercises WHERE user_id IS NULL AND deleted_at IS NULL`) BEFORE authoring:
   - design-v2 named → live status → action:
     - "Bench Press" → **OK** → kept
     - "Squat (Barbell)" → **OK** → kept
     - "Deadlift (Barbell)" → **MISSING** → **"Deadlift"** (barbell, present)
     - "Overhead Press (Barbell)" → **MISSING** → **"Overhead Press"** (barbell, present)
     - "Barbell Row" → **MISSING** → **"Row (Barbell)"** (barbell, present)
     - "Lat Pulldown (Cable)" → **MISSING** → **"Lat Pulldown"** (cable, present) — the TARGET
   - All 6 substitutes confirmed present in the live catalog at implement time. Each is seeded with `weight > 0`, so all plot under Invariant D (the union/assertion logic does not depend on WHICH weighted names are used — only that 5 fill the top-5 by distinct sessions and 1 sits outside). The spec still calls `pickCanonicalExercise` (throws on a miss → fails fast, not false-green), so future catalog drift surfaces loudly. This is the only material deviation.

2. **API unit-test builder shape (thenable vs `.maybeSingle()`/`.single()`).** `exercise-notes-api.test.ts` resolves via `.maybeSingle()`/`.single()` terminal mocks because notes reads use those. The favorites API awaits the query builder directly (`await supabase.from(...).select(...).eq(...)`, `.insert(...)`, `.delete().eq().eq()`), so the test builder is a thenable that resolves to `{ data, error }` on `await`. Same harness philosophy, adapted to the await-the-builder access pattern these calls use. Not a design change — a faithful mirror adapted to the API's actual call shape.

No deviation on the union algorithm, cap math, palette (the 4 hues are byte-for-byte design-v2 incl. the MIN-NEW-1 rose `#e11d48`, kept as-is — the suggested cooler-hue swap was explicitly optional/leave-as-is), header-right gate, migration DDL, RLS policies, or hook wiring.

## Soft callbacks made (during this implementation pass)
- None. The seed-name miss was resolvable against the live catalog (the authorized source-of-truth the design routed to the Implementer/Tester), so no escalation was needed. Soft-callbacks 2/2 remaining.

## Quality gates
- [x] `npm run typecheck` passed — `tsc --noEmit`, **0 errors** (run after the production edits, then again after the tests).
- [x] `npm run lint` passed — **0 errors, 1 warning** (the pre-existing `.expo/types/router.d.ts` auto-generated warning, baseline-unchanged across every prior run).
- [x] Relevant unit tests pass — `npm run test:unit` → **477/477** (29 files). Baseline 455; +22 net (`e1rm-strength.test.ts` 13→24 = +11 favorites-union cases; new `exercise-favorites-api.test.ts` = +11).
- [x] No new `any` — grep-clean across all 11 changed files (`: any`/`as any`/`<any>` = 0).
- [x] No new `// @ts-ignore` / `@ts-expect-error` / `eslint-disable` — grep-clean.
- [x] No stray `console.log` — grep-clean in source/app; the only `console.log` is the `[screenshot]` line in the e2e (matches `e1rm-strength.spec.ts:198` convention).

## Notes for Reviewer / Tester

- **Migration NOT applied.** `0020_user_exercise_favorites.sql` is written but NOT pushed to the live DB — the Conductor applies it. The RLS arm (`tests/rls.test.ts`) and the e2e (`favorite-exercises-e1rm.spec.ts`) require the table to exist, so they were AUTHORED but NOT RUN by me; the Tester runs them post-migration against the live DB.
- **e2e seed names are live-verified (Deviation 1).** Tester: the 6 seed names (`Bench Press`, `Squat (Barbell)`, `Deadlift`, `Overhead Press`, `Row (Barbell)`, `Lat Pulldown`) were all confirmed present in the live canonical catalog at implement time. If the catalog drifts, `pickCanonicalExercise` throws at seed setup (fails fast, not a misleading UI timeout).
- **MIN-NEW-2 (Validator) regression surface.** The `progress.tsx` header-right rewrite keeps the Pencil gated on `canEdit` with the exact a11y label `"Edit exercise"`, and the star uses the disjoint `"Favorite/Unfavorite <Name>"` label. Tester should re-run `canonical-exercise-gating.spec.ts` and `exercise-progress-ia.spec.ts` (both assert on `getByLabel("Edit exercise")` in that slot) to confirm no regression — `getByLabel("Edit exercise")` count is unchanged in every branch.
- **Invariant F is the key regression guarantee** — with no favorites, `presentTopExerciseE1rm` returns the literal `sorted.slice(0, topN)` (pinned byte-for-byte by unit case 8). The Phase-2a bodyweight-only NEGATIVE e2e still holds: no favorite can resurrect a non-eligible exercise (the eligibility gate is upstream of the union).
- **Palette first-8 byte-for-byte unchanged** — existing top-5 lines keep their exact colors (`colorForRank(0..4)`). The 4 appended hues only ever index when ≥9 lines plot.

## Round 2 (e2e nav-race fix) — 2026-06-01

**Scope: TEST-ONLY.** No production/source, migration, other test, or `docs/features.md` change. The feature was proven correct in `test-report-v1.md` (gates 477/477, RLS arm green, golden path reliable 3/3 via the real in-app path, union pins the non-top-N favorite live). The only defect was a test-harness one: the shipped spec returned to the chart via `gotoProgress(page)` = `page.goto("/progress")` — a HARD browser reload — which (a) raced the optimistic favorite's persistence INSERT and (b) intermittently rehydrated a STALE empty favorites list from the `PersistQueryClientProvider` AsyncStorage cache (30s `staleTime` + persist throttle) without refetching. A real user navigates client-side (tab tap), so the race never manifests for them.

**Change (only `tests/e2e/favorite-exercises-e1rm.spec.ts`):** applied the Tester's verified-3/3 recipe to BOTH post-toggle returns to the chart:
1. **Await the write before leaving the detail page.** Wrapped the favorite star click (step 4, `:243-256`) in `Promise.all([ page.waitForResponse(POST /rest/v1/user_exercise_favorites, status<300), favStar.click() ])`, and the unfavorite click (step 6, `:286-298`) in the same with `method() === "DELETE"`. Belt-and-suspenders so the optimistic write has landed server-side before navigation.
2. **Navigate client-side, not via `page.goto`.** Replaced the two POST-TOGGLE `gotoProgress(page)` calls with a Progress-tab TAP: `await page.getByText("Progress", { exact: true }).first().click(); await page.waitForURL(/\/progress$/);` (step 5 return `:265-266`; step 6 return `:303-304`). No hard reload → in-memory query cache (optimistic + `onSettled`-invalidated favorites) preserved → no rehydration race. Mirrors the established bottom-tab nav convention at `auth.spec.ts:303-304` (`getByText("Profile", { exact: true }).first().click()` + `waitForURL`). Confirmed the visible tab label is `"Progress"` (`app/(app)/_layout.tsx:239`).

**Left untouched (per the brief):** the INITIAL `gotoProgress(page)` on first landing (`:217`, before any toggle) and the two `page.goto(/exercises/${targetId}/progress)` deep-links TO the detail page (`:229`, `:280`) — those are not post-toggle returns and need no client-side nav. The settle-gate (section header visible) before every NOT-present `toHaveCount(0)` assertion was kept. The `gotoProgress` helper is still referenced (line 217), so no dead-symbol lint issue.

**Verification:**
- `npm run typecheck` — `tsc --noEmit`, **0 errors**.
- `npm run lint` — **0 errors, 1 warning** (pre-existing `.expo/types/router.d.ts`, baseline-unchanged).
- e2e: dev server pre-warmed (`npm run web` on :8081, HTTP 200, bundle warmed via `/sign-in` + `/progress` + a first browser pass); migration 0020 confirmed live (`user_exercise_favorites` head-select 200). `npx playwright test tests/e2e/favorite-exercises-e1rm.spec.ts`: **1 passed** warm-up, then `--repeat-each=3`: **3 passed** — **4/4 consecutive green, 0 flake**. Authoritative `test-results/.last-run.json` = `{"status":"passed","failedTests":[]}`.

**Deviations from the recipe:** none. Applied exactly.
