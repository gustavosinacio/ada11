# Review v1 — 2026-05-22_0152_end-of-session-verdict

Reviewing: the diff for the implementation against `design-v2.md` (final approved) and validator notes from `validation-v2.md`.

## Diff scope

- Baseline commit (from `state.md`): `5267443505a471dd984e5fe4f43adba6be1bcb77`
- Diff command: `git diff 5267443...HEAD` (working tree on top of baseline; no commits made yet — feature staged for review)
- Files changed: 8 (4 new code/test, 4 edited)
  - **New**: `app/(app)/workout/verdict/[sessionId].tsx`, `src/utils/session-verdict-math.ts`, `tests/unit/session-verdict-math.test.ts`, `tests/e2e/end-of-session-verdict.spec.ts`
  - **Edited**: `app/(app)/workout/[sessionId].tsx` (line 229), `src/utils/volume-target.ts` (line 78 `export` keyword), `src/hooks/use-sets.ts` (lines 119-128 — async/await refetch), `tests/e2e/crud.spec.ts` (lines 188-196 — verdict-aware Finish flow)
- `src/components/session-summary-row.tsx` **NOT** in the modified set — confirms MAJ-1 v2 resolution honored.

## Verification of implementation.md claims

| Claim | Verified? | Notes |
|---|---|---|
| `useBulkCheckAllInSession.onSuccess` is `async` and `await`s `qc.refetchQueries({ queryKey: KEYS.forSession(sessionId) })` (MAJ-2) | yes | `src/hooks/use-sets.ts:119-128`. Exact shape from design-v2:144 reproduced verbatim. Comment narrates *why* (race condition + verdict dependency), not *what*. |
| `formatDuration` imported from `~/utils/format-session-times`, not from `session-summary-row` (MAJ-1) | yes | `app/(app)/workout/verdict/[sessionId].tsx:17`. `session-summary-row.tsx` is untouched in `git status`. |
| `sumLiveVolume` exported from `volume-target.ts` (MIN-1); reused by verdict + helper | yes | `src/utils/volume-target.ts:78` is `export function sumLiveVolume(...)`. Imported at `session-verdict-math.ts:21` and `verdict/[sessionId].tsx:23`. No name collision with existing `VolumeTargetState` / `ComputeVolumeTargetInput` / `computeVolumeTarget` exports. |
| `computePrsForSession` filters `session_id !== currentSessionId` BEFORE `computeLifetimeMaxPerExercise`, strict `>` + `priorMax > 0` guard | yes | `src/utils/session-verdict-math.ts:91-108`. Algorithm matches design-v2:74-77 step-for-step. Sort by `overflowKg DESC, exerciseId ASC` at line 111-114. |
| `finishAfterMutation` `router.replace`s to `/(app)/workout/verdict/${sessionId}` | yes | `app/(app)/workout/[sessionId].tsx:229`. Cancel flow at `:284` still `router.replace("/(app)/workout")` directly — unchanged, bypasses verdict. All three Finish branches (`:249`, `:266`, `:304`) funnel through `finishAfterMutation`. |
| Done button on verdict calls `router.replace("/(app)/workout")` | yes | `app/(app)/workout/verdict/[sessionId].tsx:212`. Also wired in the error-fallback path at `:103`. |
| Empty-state split by `totalVolumeKg === 0` (MIN-4) | yes | `app/(app)/workout/verdict/[sessionId].tsx:134-137`. Two strings: `"No sets logged — your next session counts."` (zero-volume) and `"Solid session — keep it consistent."` (non-zero, no PR). Identical visual treatment. |
| PR row tap → `/(app)/exercises/{id}/progress` | yes | `app/(app)/workout/verdict/[sessionId].tsx:177-179`. `Pressable` with `accessibilityRole="button"`. |
| `crud.spec.ts` updated to wait for verdict, assert `0 PRs`, click Done, then assert `/workout$` | yes | `tests/e2e/crud.spec.ts:188-199`. Dialog handler at `:184` preserved (registered BEFORE Finish click). The `0 PRs` assertion is the load-bearing check noted in design-v2:393. |
| Unit tests: 21 cases (20 from v1 + #21 sumLiveVolume reuse) | yes | `tests/unit/session-verdict-math.test.ts` — confirmed `(#1)` through `(#21)` present, organized into 3 `describe` blocks; counts and names match design-v2:223-227. |
| E2E: 2 cases (PR-hit via bulk-check-all + no-sets) | yes | `tests/e2e/end-of-session-verdict.spec.ts:189-278` (Case A) and `:280-338` (Case B). Each registers `page.on("dialog", ...)` BEFORE Finish (MIN-2 honored — `:222` and `:292`). |
| `npm run typecheck` clean | yes | Ran `npm run typecheck` once — exit 0, no output. |
| Loading state: eager `+0 PRs` headline + PR-list skeleton (MIN-3) | yes | `app/(app)/workout/verdict/[sessionId].tsx:62-73` short-circuits `prs` to `[]` until `lifetimeQ.data` resolves; `isPrListReady` (`:86`) gates the skeleton (`:160-166`). Headline renders immediately once `session+sets+exercises` are present (`:79-83`). |
| Post-Implementer edit on `[sessionId].tsx` did not regress `finishAfterMutation` | yes | Re-read `:225-233`. `await finish.mutateAsync(sessionId)` → `router.replace(\`/(app)/workout/verdict/${sessionId}\`)`. The `setRemovedExerciseIds` block and reorder logic earlier in the file are independent of the verdict route change. |
| Soft-deleted-session deep-link error fallback (Implementer note) | yes | `app/(app)/workout/verdict/[sessionId].tsx:89-109`. Centered red error message + Done button replacing back to `/(app)/workout`. Pattern mirrors `[sessionId].tsx:316-326` per design v1 risk section. |

All implementer claims verified.

## Issues

### Blockers

None.

### Majors

None.

### Minors

- **[MIN-1]** `app/(app)/workout/verdict/[sessionId].tsx:193`: PR sub-line copy reads `PR! +100 kg (was 500 kg)`, while design-v1 mockup at line 122 and design-v2 e2e plan at line 252 both pin `+X kg (was Y kg)` (no `PR!` lead). The Implementer surfaced this as an intentional micro-deviation for continuity with `volume-target-slot.tsx:117`'s "New PR! +X over your previous" copy. The emerald `PR` pill on the same row already signals the achievement, so `PR!` is mild reinforcement, not factually wrong, and the e2e Case A assertions look for `+100 kg` and `(was 500 kg)` as separate substrings (not load-bearing for the test). Fix: either accept as-is (low risk — Implementer flagged + Reviewer agrees the deviation is reasonable) or drop the `PR! ` prefix to match the design literally. Decision deferred to the user; recommending accept.

- **[MIN-2]** `tests/e2e/end-of-session-verdict.spec.ts:222`: `page.on("dialog", (d) => void d.accept())` is registered in Case A but `handleCheckAllAndFinish` (which is the branch Case A exercises) does NOT call `confirmDelete` — there is no `window.confirm` in the bulk-check-all → Finish path. The handler is harmless but cosmetically unnecessary. Keeping it follows MIN-2 v2 defensively (pre-registration is the safer default if any of the three Finish branches ever grows a confirm). Fix: leave as-is.

- **[MIN-3]** `tests/e2e/end-of-session-verdict.spec.ts:181`: `purgeQueryCache` invocations rely on `window.localStorage.removeItem("ada11-query-cache")`. If the persisted query cache key ever changes, all e2e specs that seed via admin then expect cold TanStack reads will silently stop purging. Not a regression introduced by this run (mirrors `volume-target.spec.ts`). Fix: no immediate action — tracked as a cross-spec hygiene concern.

- **[MIN-4]** `app/(app)/workout/verdict/[sessionId].tsx:123-124`: `session.data!` non-null assertions used twice. The guard at `:111-119` covers the `!session.data` case via the early-return, so the assertions are sound, but `as` or TS narrowing via a local const would avoid the `!` and read cleaner. Fix: optional — replace with `const sessionRow = session.data;` after the guard, then reference `sessionRow.started_at` / `sessionRow.ended_at`. Style only, not a correctness issue. No new `any`, no new `@ts-ignore` introduced.

- **[MIN-5]** `tests/unit/session-verdict-math.test.ts:28`: module-scoped `let setCounter = 0` mutated by `mkSet` introduces order-dependency among tests within the file (test #2 calls `mkSet` once, test #3 starts from counter=2, etc.). Tests don't assert against `setCounter`'s value, so the order-dependency is invisible today, but a `beforeEach(() => { setCounter = 0; })` would harden against future tests that do. Fix: optional. Pattern mirrors `progress-page-math.test.ts` per the test-file header comment — consistent with existing style.

## Security checklist

- [x] **RLS**: No new tables, no new policies. All four queries the verdict reads (`useSession`, `useSetsForSession`, `useAllExercises`, `useLifetimeWeeklyVolume`) hit existing tables (`sessions`, `sets`, `exercises`) gated by `auth.uid() = user_id` policies. Posture unchanged.
- [x] **Service-role token**: No `SUPABASE_SERVICE_ROLE_KEY` in any client-bundled code under `app/` or `src/`. Only references are in `tests/e2e/end-of-session-verdict.spec.ts:31` and `tests/e2e/crud.spec.ts:27` — test-only, admin client, gated by `dotenv.config({ path: ".env.local" })`. Same pattern as existing e2e specs.
- [x] **Raw SQL via `rpc`**: None introduced. The verdict screen issues no Supabase calls of its own — pure read from React Query cache.
- [x] **`EXPO_PUBLIC_*` env vars**: No new ones; existing `EXPO_PUBLIC_SUPABASE_URL` + `EXPO_PUBLIC_SUPABASE_ANON_KEY` (used in tests) are intended-public.

## Style / convention checklist

- [x] **No new `any`**: Verified by grep on the four new/edited files. The non-null `session.data!` assertions at verdict `:123-124` are TS narrowing artifacts (see MIN-4), not `any`.
- [x] **No new `// @ts-ignore`**: Verified by grep on the four new/edited files.
- [x] **Comments narrate *why*, not *what***: 
  - `use-sets.ts:120-127` comment explains *why* the await-refetch is needed (verdict cache-fresh post-condition) — exemplary.
  - `session-verdict-math.ts` JSDoc explains *why* prior-only baseline matters and edge-case semantics.
  - `volume-target.ts:74-77` (existing) and `sumLiveVolume` callers all narrate the live-vs-past asymmetry intent. The single `export` keyword change doesn't add comments.
  - `verdict/[sessionId].tsx` inline comments are sparse but narrate *why* (e.g., `:76-78` explains the `useSession` cache-seed assumption from `useFinishSession.onSuccess`).
- [x] **Imports follow project style**: Package imports first, then `~/...` aliases (verdict screen `:1-23`, helper `:18-21`, tests `:14-22`). Consistent with rest of `src/`.
- [x] **New files in conventional folders**: 
  - `app/(app)/workout/verdict/[sessionId].tsx` — co-located under the workout segment, inherits `workout/_layout.tsx`'s `<Stack>`. ✓
  - `src/utils/session-verdict-math.ts` — alongside `progress-page-math.ts`, `volume-target.ts`, `format-session-times.ts`. ✓
  - `tests/unit/session-verdict-math.test.ts` — alongside other unit tests. ✓
  - `tests/e2e/end-of-session-verdict.spec.ts` — alongside other e2e specs. ✓

## Adherence to design (design-v2 final)

| Design item | Implementation | Status |
|---|---|---|
| MAJ-1 (`formatDuration` import from `~/utils/format-session-times`) | `verdict/[sessionId].tsx:17` | ✓ |
| MAJ-2 (`useBulkCheckAllInSession` await refetch) | `use-sets.ts:119-128` | ✓ exact |
| MIN-1 (`sumLiveVolume` export + helper reuse) | `volume-target.ts:78` + `session-verdict-math.ts:43-44` | ✓ |
| MIN-2 (e2e dialog handler pre-Finish) | `:222`, `:292` | ✓ |
| MIN-3 (eager `+0 PRs` headline) | `verdict:62-73` + `:86` + `:160-166` | ✓ |
| MIN-4 (empty-state copy split) | `verdict:134-137` | ✓ |
| PR-detection algorithm (option c, strict >, priorMax > 0) | `session-verdict-math.ts:91-108` | ✓ |
| Sort: overflowKg DESC, exerciseId ASC | `session-verdict-math.ts:111-114` | ✓ |
| Loading-state ActivityIndicator (cold deep-link) | `verdict:111-119` | ✓ |
| Error state inline pattern + Done button | `verdict:89-109` | ✓ |
| `<Stack.Screen options={{ title: "Workout summary", headerShown: true }} />` | `verdict:92-93`, `:114-115`, `:141-143` | ✓ (set in all three render paths) |
| Test counts (21 unit, 2 e2e + crud patch) | `session-verdict-math.test.ts` has 21 it() blocks; `end-of-session-verdict.spec.ts` has 2 tests | ✓ |
| PR row sub-line copy `+X kg (was Y kg)` | `verdict:193` reads `PR! +X kg (was Y kg)` | Δ — MIN-1 above; Implementer surfaced, accepted as continuity polish |

One acknowledged micro-deviation (PR row copy lead — `PR! ` prefix). Implementer surfaced it explicitly in `implementation.md` § "Deviations from design". Non-load-bearing for e2e; non-correctness. Acceptable.

## Decision

**pass**

Reasoning:
- 0 blockers, 0 majors, 5 minors (style/optional/cross-spec hygiene).
- Both validator-flagged majors from v1 (MAJ-1 `formatDuration` dup, MAJ-2 sets-cache race) verified fixed at the exact lines pinned in design-v2.
- The MAJ-2 e2e regression guard (Case A step asserting `600 kg` in the headline) is in place and load-bearing. Pre-fix this would render `0 kg`.
- Cancel flow remains unaffected — verdict only reachable via Finish path.
- Type-check clean. Security posture unchanged (no new RLS surface, no service-role leak, no raw SQL).
- All 5 minors are either intentional Implementer judgment calls (MIN-1 copy, MIN-2 defensive dialog), inherited cross-spec hygiene (MIN-3), or style-only (MIN-4, MIN-5). None block.

Recommendation: invoke Tester.
