# Review v1 — 2026-06-01_1301_favorite-exercises-e1rm

Reviewing: the implementation diff against `design-v2.md` (approved) and `validation-v2.md` (GO + 2 minors). Implement↔Review round 1 of 2. **Static review only** — migration 0020 is FILE-only (Conductor applies before the Tester); RLS arm + e2e were authored but not run by the Implementer (require the live table). I re-ran the three offline gates myself.

## Diff scope
- Baseline: `5a0b86e` (= `state.md:25`; HEAD == baseline, changes are in the working tree + untracked).
- Files changed: 12 (5 new, 7 edited).
  - New: `supabase/migrations/0020_user_exercise_favorites.sql`, `src/api/exercise-favorites.ts`, `src/hooks/use-exercise-favorites.ts`, `tests/unit/exercise-favorites-api.test.ts`, `tests/e2e/favorite-exercises-e1rm.spec.ts`.
  - Edited: `src/db/schema.ts`, `src/db/types.ts`, `src/utils/e1rm-strength.ts`, `src/components/e1rm-strength-section.tsx`, `app/(app)/exercises/[id]/progress.tsx`, `tests/unit/e1rm-strength.test.ts`, `tests/rls.test.ts`.
- Production source: +195 / −31 across the 5 edited prod files (per `git diff --stat`).

## Item-by-item confirmation (the 8 review priorities)

### 1. The union algorithm (`src/utils/e1rm-strength.ts:157-212`) — MATCHES design-v2, all four sub-checks hold
Re-traced against the REAL diff, not the design:
- `const sorted = Array.from(byExercise.values()).sort(comparator)` (`:157-165`) — the comparator (sessions DESC → lastActiveMs DESC → name ASC → id ASC) is byte-for-byte the pre-change `:138-148` comparator; only the chained `.slice` was split out. No comparator mutation.
- `autoTopOverall = sorted.slice(0, topN)` (`:173`) — the literal pre-change selection. `autoIds = new Set(autoTopOverall.map(a => a.id))` (`:174`).
- `extraFavorites = sorted.filter(a => favSet.has(a.id) && !autoIds.has(a.id))` (`:184-186`) — excludes autoIds → dedup-by-construction.
- `selected = [...autoTopOverall, ...extraFavorites]` (`:191`), cap at `E1RM_MAX_LINES = 12` (`:197`) dropping `autoTopOverall`'s tail first (`keptAuto = autoTopOverall.slice(0, max(0, 12 - extraFavorites.length))`, `:198-201`), degenerate `extraFavorites.length > 12` → `extraFavorites.slice(0, 12)` (`:207-209`).
- **(a) favoriting a top-N exercise = no-op:** a favorite in `autoIds` is filtered out of `extraFavorites` → `selected` unchanged. Confirmed structurally + by unit case 2 (`e1rm-strength.test.ts:535-558`, asserts `withFav.series` deep-equals `noFav.series`).
- **(b) ranks 0-based dense:** `const ranked = selected` (`:212`) feeds the unchanged `ranked.map((agg, rank) => …)` (`:215`) → `rank` = array index. Unit case 6 (`:648-675`) asserts `[0..5]` and `[0..11]`.
- **(c) Invariant F:** `favSet = favoriteExerciseIds ?? EMPTY_SET` (`:168`); empty → `extraFavorites = []` → `selected = [...sorted.slice(0,topN), ...[]] = sorted.slice(0,topN)`, cap branch never fires (`5 ≤ 12`). Unit case 8 (`:700-718`) asserts no-arg == empty-Set deep-equal AND == the pre-change top-5 (ids `ex-00..ex-04`, ranks `[0..4]`, length 5).
- **(d) cap never drops a favorite while a non-favorite survives:** `keptAuto` trims only `autoTopOverall` (all non-favorite-or-already-shown auto picks); all `extraFavorites` are concatenated whole. Favorites trimmed only in the degenerate >12-favorites branch. Unit cases 5/10 (`:622-645`, `:742-763`) assert the lowest non-favorite (`ex-04`) drops while all 8 favorites stay; case 11 (`:765-830`) asserts the degenerate path.
- Cap-boundary arithmetic verified: case 9 (`:720-740`) — exactly 12 (`5+7`), strict `>` keeps it whole, no trim. Matches Validator §2's adversarial boundary check.

### 2. Invariant D preserved (eligibility gate upstream of the union) — CONFIRMED
The eligibility gate `if (!(w > 0 && r > 0)) continue` (`e1rm-strength.ts:128`) runs while building `byExercise`, BEFORE `sorted`/`autoTopOverall`/`extraFavorites`. A bodyweight-only/no-set favorite never enters `byExercise` → never in `sorted` → never in `extraFavorites`. No favorites branch bypasses it. Unit case 3 (`:560-595`, bodyweight-only favorite excluded) and case 4 (`:597-620`, no-row favorite excluded) pin it. The favorite ROW still persists in the DB (the toggle inserts unconditionally) — chart line gated by Invariant D, as intended.

### 3. Migration 0020 + RLS (`supabase/migrations/0020_user_exercise_favorites.sql`) — CORRECT, mirrors 0010 shape
- Composite PK `primary key (user_id, exercise_id)` (`:23`); FK CASCADE on both `user_id → auth.users(id)` (`:20`) and `exercise_id → public.exercises(id)` (`:21`).
- `alter table … enable row level security` (`:29`).
- 3 policies, each `drop policy if exists` + `create policy`: SELECT `using (auth.uid() = user_id)` (`:32-33`), INSERT `with check (auth.uid() = user_id)` (`:36-37`), DELETE `using (auth.uid() = user_id)` (`:40-41`). No UPDATE — correct (no mutable column). Mirrors `0010_exercise_notes.sql:53-67`'s RLS shape (notes has the extra UPDATE policy because it has a mutable `body`).
- 0020 is the next free number — confirmed `ls supabase/migrations/` shows 0019 as the prior latest.
- Drizzle `schema.ts:305-326`: `userExerciseFavorites` pgTable with `primaryKey({ columns: [t.userId, t.exerciseId] })`; `primaryKey` added to the `drizzle-orm/pg-core` import (`schema.ts:10`, was not previously imported — `.primaryKey()` column-builder hits are distinct). Columns/FK/onDelete match the SQL. `types.ts` adds `UserExerciseFavorite`/`NewUserExerciseFavorite` + `UserExerciseFavoriteRow`.

### 4. API (`src/api/exercise-favorites.ts`) — CORRECT
- `listMyFavoriteExerciseIds` (`:14-27`): auth-gate → `[]` (`:17`); SELECT `exercise_id` WHERE `user_id=uid`; maps rows→ids; null `data` → `[]`. Mirrors `exercise-notes.ts:14-16` auth-gate.
- `addFavorite` (`:40-50`): auth-gate → throw "Not authenticated"; plain `.insert({user_id, exercise_id})`; `if (error && (error as SupabaseLikeError).code !== "23505") throw error` (`:49`) — swallows the PK-dup SQLSTATE, re-throws everything else. **Error-code check is correct** (`"23505"` is the PostgreSQL unique-violation SQLSTATE). Matches the `measurements.ts:133-137` SQLSTATE-discriminator precedent.
- `removeFavorite` (`:55-66`): auth-gate; `.delete().eq("user_id", uid).eq("exercise_id", exerciseId)`; re-throws on error.
- No `any`. The two casts (`data as Pick<UserExerciseFavoriteRow, "exercise_id">[] | null`, `error as SupabaseLikeError`) are typed narrowings matching the notes precedent (`exercise-notes.ts:26,29-31`), not looseness.

### 5. Hook + section wiring — CORRECT
- `use-exercise-favorites.ts`: `useMyFavoriteExerciseIds` query key `["exercise_favorites","me"]` (`:9`); `useToggleFavorite` optimistic `onMutate` (cancelQueries → snapshot `prev` → `setQueryData` add/remove) (`:43-52`), `onError` rollback to `ctx.prev` (`:53-55`), `onSettled` invalidate (`:56`). Add uses `Array.from(new Set([...old, id]))` (dedup), remove uses `.filter`. Sound.
- `e1rm-strength-section.tsx`: `const favoriteSet = useMemo(() => new Set(favoriteIds ?? []), [favoriteIds])` (`:54-57`) is a dep of the model memo (`:65`, deps `[rows, exercises, favoriteSet]`). On toggle, `setQueryData` produces a NEW array → `favoriteIds` identity changes → `favoriteSet` recomputes → model recomputes → chart re-renders. The react-query `data` identity (TanStack structural sharing) keeps `favoriteIds` stable when the cache is unchanged → no infinite render.
- **Palette extended 8→12** (`:31-44`): first 8 hexes (`#ef4444 … #84cc16`) byte-for-byte unchanged; appended `#15803d`/`#64748b`/`#e11d48`/`#92400e` (the design-v2 hues, incl. the MIN-NEW-1 rose `#e11d48` kept per the Validator's "leave-as-is acceptable"). `colorForRank(i) = PALETTE[i % len]` with len 12 ≥ `E1RM_MAX_LINES` → no wrap within the ceiling. Existing top-5 colors preserved.

### 6. MIN-NEW-2 regression surface (`app/(app)/exercises/[id]/progress.tsx:122-165`) — CONFIRMED no regression
- The Pencil stays gated on `canEdit` (`:151-163`) and keeps `accessibilityLabel="Edit exercise"` (`:154`) → `canonical-exercise-gating.spec.ts:178,187` and `exercise-progress-ia.spec.ts:119,127,146,223` (all assert `getByLabel("Edit exercise")` count in that slot) are unaffected: count unchanged in every branch.
- The star ALWAYS renders (`:124-150`), with a UNIQUE a11y label `"Favorite <Name>"` / `"Unfavorite <Name>"` (`:132-136`), disjoint from the legend chip's `"Toggle <Name>"` (`e1rm-strength-section.tsx`).
- All identifiers in scope at the `headerRight` closure: `id`/`backHref` (`:55`), `router` (`:59`), `colorScheme` (`:60`), `exercise.data?.name` (`:64`), `toggleFavorite`/`isFavorite` (`:73-74`), `canEdit` (`:95-97`). `screenHeader` is a plain `const` (`:98`) rebuilt each render → the optimistic star flip applies.

### 7. Unit + RLS test quality
- `e1rm-strength.test.ts`: the `favorites union` describe block (`:510-830`) has all 11 design-v2 §A cases. **Case 2** (`:535-558`) asserts SAME count + id-once + `withFav.series` deep-equals `noFav.series` — the right assertion for the MAJ-1 fix (favorite-inside is a no-op). **Case 8** (`:700-718`) is the Invariant F deep-equal (no-arg == empty-Set == pre-change top-5). Cap-boundary cases 9/10/11 assert the at-ceiling/one-over/degenerate paths with the right kept/dropped ids. Determinism case 7 (`:677-697`) uses two set insertion orders → identical series. `seedWeightedByDecreasingSessions` helper added (`:479-508`).
- `exercise-favorites-api.test.ts` (11 tests): auth-gate (no DB call / "Not authenticated"), list maps ids / null→[], `addFavorite` plain INSERT / **swallows 23505** (`:167-175`) / re-throws non-23505 (`:177-188`), `removeFavorite` delete + eq-eq / re-throws. Leftover-chain guard present (`:74-80`). Thenable builder (Deviation 2) is a faithful adaptation to the await-the-builder call shape.
- `tests/rls.test.ts:406-444` favorites arm: A inserts its own pair (succeeds), B SELECT → 0 rows, B DELETE → 0 rows, B spoof-INSERT `{user_id: A}` → rejected. No UPDATE arm (correct). console.log updated (`:446-448`). Cleanup via `deleteUser` cascade in the outer `finally`.
- `favorite-exercises-e1rm.spec.ts`: settle-gate (section header visible) leads every `toHaveCount(0)` (steps 2/5/6, `:220-226`, `:249-255`, `:274-280`); canonical gate split asserts star visible + `"Edit exercise"` count-0 (`:234-238`); favorite/unfavorite optimistic loop. Seed names are the live-verified substitutes (Deviation 1); `pickCanonicalExercise` (`canonical-exercise.ts:50-54`) throws on a miss → fail-fast, not false-green.

### 8. Gates — re-run by the Reviewer (not trusted from implementation.md)
- `npm run typecheck` → **0 errors** (`tsc --noEmit`). Matches.
- `npm run lint` → **0 errors, 1 warning** (the pre-existing `.expo/types/router.d.ts` auto-generated warning, baseline-unchanged). Matches.
- `npm run test:unit` → **477 passed (29 files)**. `e1rm-strength.test.ts` = 24 tests; `exercise-favorites-api.test.ts` = 11 tests. Matches the claimed 477/477.
- No new `any` / `as any` / `<any>` / `@ts-ignore` / `@ts-expect-error` / `eslint-disable` — grep-clean across all 11 changed code files.
- No `SERVICE_ROLE` / `service_role` in `src/` or `app/` — grep-clean (only in the e2e spec, test-only, never bundled).
- No stray `console.log` in production source — grep-clean (the e2e's `[screenshot]` log matches the `e1rm-strength.spec.ts` convention; the RLS arm's `console.log` is the pre-existing pass-summary line, updated).

## Verification of implementation.md claims
| Claim | Verified? | Notes |
|---|---|---|
| Migration 0020 = composite PK + FK CASCADE both + RLS + 3 policies; 0019 is latest | yes | `0020…sql:19-41`; `ls migrations/` → 0019 prior latest |
| `primaryKey` added to drizzle import; table after `exerciseNotes` | yes | `schema.ts:10,305-326` |
| API: list auth-gate→[], add swallows 23505, remove plain delete, no upsert/loop | yes | `exercise-favorites.ts:14-66` |
| Hook: optimistic onMutate/onError/onSettled, key `["exercise_favorites","me"]` | yes | `use-exercise-favorites.ts:9,43-57` |
| `e1rm-strength.ts`: `E1RM_MAX_LINES=12` + `EMPTY_SET`; split sort/slice; union-then-cap; comparator/LOCF/dense-rank untouched; Invariant F = literal slice | yes | `e1rm-strength.ts:60-71,157-212` |
| Palette 8→12, first 8 byte-for-byte unchanged | yes | `e1rm-strength-section.tsx:31-44` |
| `progress.tsx` headerRight rewrite: star always shown, Pencil `canEdit`+"Edit exercise" | yes | `progress.tsx:122-165` |
| Unit: 11 favorites cases incl. case 2 (no-op) + case 8 (Invariant F); +22 net | yes | `e1rm-strength.test.ts:510-830`; 455→477 |
| RLS arm well-formed; no UPDATE | yes | `rls.test.ts:406-444` |
| e2e seed-name deviation (4 of 6 substituted, live-verified) | yes | `favorite-exercises-e1rm.spec.ts:158-169`; matches Deviation 1 |
| Gates: typecheck 0, lint 0/1, unit 477/477 | yes | re-run; identical |
| No new any / ts-ignore / eslint-disable / stray console.log | yes | grep-clean |

## Deviations from design (2 declared) — both acceptable
1. **e2e seed names (4 of 6 substituted).** design-v2 §D named "Deadlift (Barbell)", "Overhead Press (Barbell)", "Barbell Row", "Lat Pulldown (Cable)"; the Implementer live-probed the catalog and substituted "Deadlift", "Overhead Press", "Row (Barbell)", "Lat Pulldown" (`spec:158-169`). This is exactly the path the design + Validator routed downstream (live-verify via `pickCanonicalExercise`, substitute on a miss, fail-fast). The union/assertion logic does not depend on WHICH weighted names are used — only that 5 fill the top-5 and 1 sits outside. The names' actual presence in the LIVE catalog is a DB-state property the **Tester** confirms post-migration (a stale name → `pickCanonicalExercise` throws, not a false-green). Acceptable.
2. **API unit-test builder (thenable vs `.maybeSingle()`/`.single()`).** Faithful mirror of `exercise-notes-api.test.ts` adapted to the favorites API's await-the-builder call shape (these calls don't use a terminal `.single()`). Not a design change. Acceptable.

Both Validator non-blocking notes addressed: MIN-NEW-1 (rose hue) kept as-is (Validator said leave-as-is acceptable); MIN-NEW-2 (regression-surface callout) is honored — the Implementer's notes + this review name `canonical-exercise-gating.spec.ts` + `exercise-progress-ia.spec.ts` as the re-run surface.

## Issues

### Blockers
None.

### Majors
None.

### Minors
- **[MIN-1]** `app/(app)/exercises/[id]/progress.tsx:126-127` — the star's `onPress` calls `toggleFavorite.mutate({ exerciseId: id, … })` with `id` unguarded, while `isFavorite` (`:74`) guards with `!!id`. If the route param were ever empty/undefined at render (it shouldn't be — the screen is unreachable without an `id`), the mutation would fire with an empty `exerciseId`. Pre-existing-pattern-adjacent and effectively unreachable (the whole screen depends on `id`), so LOW. Fix (optional): early-return or disable the Pressable when `!id`, OR gate the `onPress` with `if (!id) return;`. Cosmetic robustness only — not a go-blocker.

## Security checklist
- [x] RLS: the only new query surface (`listMyFavoriteExerciseIds` SELECT, `addFavorite` INSERT, `removeFavorite` DELETE) lands on `user_exercise_favorites`, which has RLS enabled + 3 policies all gated `auth.uid() = user_id` (migration 0020). The new table HAS a policy defined in the diff. The cross-user RLS arm (`rls.test.ts:406-444`) pins B-cannot-read/delete/spoof. Canonical exercises favoritable is safe: the favorites row always carries `user_id = the favoriting user`, so the `auth.uid() = user_id` check holds regardless of the exercise's owner.
- [x] No `SUPABASE_SERVICE_ROLE_KEY` / service-role token in client-bundled code — grep-clean in `src/`+`app/`; `SERVICE_ROLE` appears only in `favorite-exercises-e1rm.spec.ts` (Playwright admin seed, test-only).
- [x] No raw SQL / `rpc`; all access via parameterized PostgREST builders (`.insert`/`.select`/`.delete().eq()`). No string concat of user input.
- [x] `EXPO_PUBLIC_*`: no new public env vars introduced. The e2e reads `EXPO_PUBLIC_SUPABASE_URL` + `EXPO_PUBLIC_SUPABASE_ANON_KEY` (both public by design); the secret `SUPABASE_SERVICE_ROLE_KEY` is non-prefixed and test-only.

## Style / convention checklist
- [x] No new `any` — grep-clean. The two casts in `exercise-favorites.ts` are typed narrowings matching the notes precedent.
- [x] No new `// @ts-ignore` / `@ts-expect-error` / `eslint-disable` — grep-clean.
- [x] Comments narrate *why* — the union pseudo-code comments explain the dedup-by-construction invariant + the MAJ-1-fix rationale; the migration header explains the 0010 divergences; the `favoriteSet` memo comment explains the re-render gating. No what-narration.
- [x] Imports follow project style — `~/`-rooted within source (`~/hooks/use-exercise-favorites`, `~/api/exercise-favorites`, `~/db/types`), package imports first.
- [x] New files in conventional folders — API in `src/api/`, hook in `src/hooks/`, migration in `supabase/migrations/`, unit test in `tests/unit/`, e2e in `tests/e2e/`. No new component file (inline header star — design Alt 14).

## Decision

**pass**

Reasoning:
- 0 blockers, 0 majors, 1 minor (an effectively-unreachable robustness nit). By the rule (0 blockers and ≤1 major → pass), this is a clean pass.
- The MAJ-1-fixed union algorithm (`top-N OVERALL ∪ favorites`) is implemented byte-for-byte to design-v2: favoriting a top-N exercise is a verified no-op (unit case 2 deep-equal), Invariant F is the literal `sorted.slice(0, topN)` (unit case 8), the cap drops non-favorites first (cases 5/10), and ranks are 0-based dense. Invariant D survives (eligibility gate upstream). Migration 0020 + RLS mirror the 0010 shape with the justified 3-policy/composite-PK/CASCADE divergences. API/hook/section wiring is sound and grep-clean. All three offline gates re-run green and match the claims.

## Non-blocking notes for the Tester
1. **Apply migration 0020 FIRST** — `user_exercise_favorites` does not exist on the live DB yet; the RLS arm + the new e2e both require it.
2. **RLS arm** (`tests/rls.test.ts`) — run after migration; expect the favorites arm (A inserts, B blocked on read/delete/spoof) green.
3. **New e2e** (`tests/e2e/favorite-exercises-e1rm.spec.ts`) — the 6 seed names are the live-verified substitutes (`Bench Press`, `Squat (Barbell)`, `Deadlift`, `Overhead Press`, `Row (Barbell)`, target `Lat Pulldown`). `pickCanonicalExercise` throws at seed time on a stale name (fail-fast). The legend chip label is `Toggle <exercise.name>`, where `<name>` is the EXACT catalog name resolved by `pickCanonicalExercise` (exact-equality match) — so `getByLabel("Toggle Lat Pulldown")` is only correct if the live catalog name is exactly `"Lat Pulldown"` (not `"Lat Pulldown (Cable)"`). If `pickCanonicalExercise` resolves `Lat Pulldown` but the chip never appears, suspect a name-mismatch between the resolved row's `name` and `TARGET_NAME`.
4. **MIN-NEW-2 regression surface** — re-run `canonical-exercise-gating.spec.ts` + `exercise-progress-ia.spec.ts` (both assert `getByLabel("Edit exercise")` in the header-right slot the diff rewrites). Statically verified unchanged in every branch; confirm at runtime.
5. **Also re-run `e1rm-strength.spec.ts`** (Phase-2a) — Invariant F is the regression guarantee for the no-favorites path; the bodyweight-only NEGATIVE case must still produce `series.length === 0`.
6. The star's filled/outline state is the `Star` `fill` prop (SVG `#f59e0b` vs `transparent`), not a class — assert via the label flip (`Favorite` ↔ `Unfavorite`) + screenshot, not an opacity class.
