# Review v1 — 2026-05-20_2034_soft-deleted-exercises-in-history

Reviewing: the diff for the implementation against `design-v1.md` (approved) and `validation-v1.md` (`go`, 0/1/4).

## Diff scope

- Diff command: `git diff 52d7a76739d3e27ab07b1fccefc4f5397dd666d9...HEAD`
- Baseline commit: `52d7a76` (recorded in `state.md`).
- Files changed: **7** (6 edited + 1 new e2e). All within the scope declared in `implementation.md`.
- Lines (tracked code only): **+81 / −6** across the six TS/TSX files; e2e spec is +276 new.
- Out-of-scope changes detected: **none**. `src/components/exercise-picker.tsx`, `app/(app)/exercises/index.tsx`, and `app/(app)/exercises/[id]/index.tsx` (edit screen) are NOT in the diff — confirmed via `git diff --stat` and grep of `useExercise` / `useExercises` usage sites.

## Verification of implementation.md claims

| Claim | Verified? | Notes |
|---|---|---|
| `listAllExercises` omits `.is("deleted_at", null)` | yes | `src/api/exercises.ts:36-44` — only `.select("*").order("name")`; no `deleted_at` filter. RLS still scoped by `auth.uid() = user_id` via existing policy. |
| `getAnyExercise(id)` omits `.is("deleted_at", null)` | yes | `src/api/exercises.ts:49-58` — `.eq("id", id).single()` only. |
| `KEYS.allIncludingDeleted = ["exercises", "all"]` and `detailIncludingDeleted` exists | yes | `src/hooks/use-exercises.ts:23-24`. |
| `useAllExercises()` / `useAllExercise(id)` mirror `useExercises` / `useExercise` shape | yes | `src/hooks/use-exercises.ts:42-55`. Same `useQuery` shape, same `enabled: Boolean(id)` guard, same fallback queryKey when `id` is undefined. |
| All three mutations invalidate the cache (prefix on `["exercises"]`) | yes | `useCreateExercise` (`use-exercises.ts:61-65`), `useUpdateExercise` (`use-exercises.ts:73-80`), `useSoftDeleteExercise` (`use-exercises.ts:86-93`). TanStack Query v5 (`package.json: @tanstack/react-query ^5.62.0`) defaults `invalidateQueries` to `exact: false`, so `queryKey: ["exercises"]` matches every key whose first element is `"exercises"`. |
| `useUpdateExercise` `setQueryData`s BOTH detail keys | yes | `use-exercises.ts:78-79` — writes `KEYS.detail(row.id)` AND `KEYS.detailIncludingDeleted(row.id)`. Matches Validator Q3 ruling. |
| 3 consumer swaps (history detail, live workout, progress) | yes | `app/(app)/history/[id].tsx:19,45`; `app/(app)/workout/[sessionId].tsx:19,44`; `app/(app)/exercises/[id]/progress.tsx:15,37`. |
| Picker + library NOT touched | yes | `src/components/exercise-picker.tsx:14,26` and `app/(app)/exercises/index.tsx:6,11` still call `useExercises()` (filtered). Confirmed by grep + git diff. |
| Edit screen `exercises/[id]/index.tsx` stays on `useExercise()` (intentional 404) | yes | `app/(app)/exercises/[id]/index.tsx:15,34` still uses `useExercise(id)`. Validator decision 4 honored. |
| `(deleted)` suffix reads from `exercise.deleted_at`, uses muscle-subtitle gray-500 | yes | `src/components/exercise-block.tsx:91-93`. Nested `<Text>` inside parent `<Text>` is valid React Native; classes `text-base font-normal text-gray-500` match the muscle subtitle one line down. |
| E2E covers: log → soft-delete → block + suffix + totals + **picker exclusion** (MAJOR-1) | yes | `tests/e2e/soft-deleted-exercises-in-history.spec.ts` — steps 1-6 cover all four assertions. Picker exclusion is asserted via the empty-state copy `"No exercises match. Add one from the Exercises tab."` after typing the deleted exercise's exact name into the picker filter (line 264-266). Stronger than a screen-wide `toHaveCount(0)` because the history-detail block behind the modal also renders the name. |
| No new `any` | yes | grep across diff: no `: any` introduced. |
| No new `// @ts-ignore` | yes | grep across diff: no `@ts-ignore` introduced. |
| No new `console.log` | yes | grep: zero `console.log` added. |
| Cache namespace isolation | yes | All invalidations stay under `["exercises"]`. No cross-domain (`["sets"]`, `["sessions"]`, `["routines"]`) invalidation introduced. |
| Unit test dropped per MIN-4 ruling | yes | No `tests/unit/list-all-exercises.test.ts` in tree. |
| `npm run typecheck` | passed | Re-ran here once for sanity. `tsc --noEmit` exits clean. |

## Issues

### Blockers
- none.

### Majors
- none.

### Minors
- **[MIN-1]** `src/hooks/use-exercises.ts:22,24` — theoretical key collision: `KEYS.detail(id)` = `["exercises", id]` and `KEYS.allIncludingDeleted` = `["exercises", "all"]`. If a future code path passed the literal string `"all"` as an exercise id, the filtered detail key would collide with the include-deleted list key (different queryFn → cache write of array under a key the detail reader treats as a single row). UUIDs cannot equal `"all"` (hex + hyphens, 36 chars), and the only callers come from `useLocalSearchParams<{ id: string }>()` which is sourced from real DB ids, so this is **unreachable in practice**. Fix (optional, future-proofing): namespace include-deleted under a non-uuid-collision sentinel, e.g. `["exercises", "_all"]` or `["exercises-with-deleted"]`. **Severity: minor — not blocking.**
- **[MIN-2]** `src/hooks/use-exercises.ts:51` — `useAllExercise(undefined)` falls back to `queryKey: KEYS.allIncludingDeleted` (= `["exercises", "all"]`). When mounted alongside `useAllExercises()`, both share the same cache slot but with different queryFns. The `enabled: Boolean(id)` guard prevents the bad-typed queryFn from firing, so the list-reader's array data is what lives in cache and the disabled detail-reader returns that array typed as `ExerciseRow`. This pattern was **inherited verbatim from `useExercise`** (line 36), so it is not a new bug — it mirrors existing behavior and the consumer (`progress.tsx:37`) always passes a real id from `useLocalSearchParams`. Fix (optional): use a guaranteed-unique sentinel, e.g. `id ? KEYS.detailIncludingDeleted(id) : ["exercises", "all", "__noop"] as const`. **Severity: minor — pre-existing pattern, not regressed.**
- **[MIN-3]** `src/components/exercise-block.tsx:92` — `(deleted)` suffix uses `text-gray-500` on both light and dark backgrounds. Validator MIN-3 already flagged this as borderline AA in dark mode and accepted the inherited choice (the muscle subtitle one line down uses the same class). Carried forward unchanged. Fix (optional, future polish): `text-gray-500 dark:text-gray-400` for clearer dark-mode contrast. **Severity: minor — explicitly accepted by Validator, not a regression.**
- **[MIN-4]** `app/(app)/workout/[sessionId].tsx:37-43` and `app/(app)/history/[id].tsx:41-44` — both comments are slightly longer than the project's typical inline comment density, but each explains *why* (regression risk: picker leak; routine-exercises embedded-join leak) rather than *what*. Within style guideline. **Severity: minor — informational, not actionable.**

## Security checklist

- [x] **RLS.** Two new queries (`listAllExercises`, `getAnyExercise`) hit the existing `exercises` table, which already has policy `exercises_select_own (auth.uid() = user_id)` per `docs/data-model.md`. No new table introduced, no migration needed. RLS still enforces per-user isolation server-side; the `deleted_at` filter is purely a UX choice, not a security boundary.
- [x] **Service-role keys.** No `SUPABASE_SERVICE_ROLE_KEY` reference under `src/` or `app/`. The only mention is in `tests/e2e/soft-deleted-exercises-in-history.spec.ts:30`, which is a Playwright spec (server-side admin client for seeding/teardown) — not bundled to the client, matches the existing pattern in other e2e specs.
- [x] **Raw SQL / rpc.** No `rpc(...)` calls introduced; no string concatenation of user input into queries. All filters use the type-safe Supabase query builder.
- [x] **`EXPO_PUBLIC_*` env vars.** The e2e spec references `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` — both are intentionally public (anon key is meant to be bundled). No secret material leaks via public env.

## Style / convention checklist

- [x] No new `any`.
- [x] No new `// @ts-ignore`.
- [x] Comments narrate *why*, not *what*. Comment on `KEYS` (`use-exercises.ts:14-19`) explains the prefix-match invalidation contract — load-bearing. Comments in the 3 swap sites explain the regression-mitigation reasoning. Comments in `src/api/exercises.ts:32-35,46-48` explain why the filter is omitted. All justified.
- [x] Imports follow project style: `~/api/*`, `~/hooks/*`, `~/components/*` path aliases consistent with the rest of the repo.
- [x] New files placed in conventional folder: `tests/e2e/` for the Playwright spec (matches sibling specs).

## Architectural / regression checks

- [x] **Two-hook precedent.** Pattern matches `src/hooks/use-sets.ts` (per-session reader + cross-session reader, different keys). Designer's rationale held up.
- [x] **Single-invalidation deviation (MIN-1 in Validation).** Implementer chose the single-call shape (`invalidateQueries({ queryKey: KEYS.all })`) over the design's dual-call shape, with explicit Validator authorization ("Designer's 'invalidate both' is harmless redundancy. Implementer's choice"). TanStack Query v5 prefix-match semantics confirmed: `queryKey: ["exercises"]` with default `exact: false` invalidates every query whose key array starts with `["exercises"]`, including `["exercises"]`, `["exercises", uuid]`, `["exercises", "all"]`, `["exercises", "all", uuid]`. Documented in the `KEYS` comment block. **Acceptable.**
- [x] **`useUpdateExercise` instant-rename for include-deleted detail.** Q3 ruling honored — `setQueryData(KEYS.detailIncludingDeleted(row.id), row)` mirrors the existing `setQueryData(KEYS.detail(row.id), row)`. Renames propagate to the progress screen header without a refetch round-trip.
- [x] **Picker leak (highest-risk regression).** `ExercisePicker` (`src/components/exercise-picker.tsx:26`) still calls `useExercises()` (filtered) — soft-deleted exercises cannot leak into the Add-exercise flow. E2E asserts this directly (step 6). The Exercises tab library (`app/(app)/exercises/index.tsx:11`) also unchanged — deleted exercises still hidden from the library.
- [x] **Edit screen 404 for deleted ids.** `app/(app)/exercises/[id]/index.tsx:34` still calls `useExercise(id)` (filtered) — `getExercise` 404s on `deleted_at IS NOT NULL`, preserving the current behavior per Design decision 4.
- [x] **`sets.exercise_id` FK is `RESTRICT`.** Design's correctness argument holds: the deleted exercise row physically remains in the DB whenever a historical set references it, so `listAllExercises()` will always return the rows that history needs.
- [x] **No cross-domain side effects.** Cache invalidations stay under `["exercises"]`. `["sets"]`, `["sessions"]`, `["routines"]`, `["progress"]` namespaces are untouched.
- [x] **E2E flake-resilience addition.** `expect(...).toBeVisible({ timeout: 15_000 })` on the picker row before clicking it (line 143-145) gates against the picker rendering before the create-mutation refetch completes. Reasonable, no behavior change.

## Decision

**pass**

Reasoning:
- 0 blockers, 0 majors, 4 minors — all of which are either (a) theoretically-unreachable corner cases on inherited pre-existing patterns (MIN-1, MIN-2), (b) Validator-accepted carry-forward (MIN-3), or (c) informational (MIN-4). None block merge.
- All 16 design/validation claims in `implementation.md` verified line-by-line.
- All 10 reviewer checks satisfied.
- Security clean: RLS unchanged + still enforced, no service-role leakage, no `rpc` injection surface, no public env secrets.
- Style / convention clean: no `any`, no `@ts-ignore`, no `console.log`, comments narrate *why*.
- Picker leak (highest-priority regression risk) explicitly guarded by both code structure (picker file unchanged) AND e2e assertion (empty-state on filtered search for deleted name).
- Routed implementation deviations all have Validator-explicit authorization (MIN-1 dual-invalidate drop, MIN-4 unit-test drop, Q1/Q2/Q3 rulings).

Recommended next step: invoke Tester.
