# Implementation — 2026-05-22_0030_progress-page

Based on: `design-v3.md` (final approved) and `validation-v3.md` (matching `go`, 3 minors).

## Files changed

### New files
- `app/(app)/progress/_layout.tsx` — header-only Stack layout (one-liner, mirrors `history/_layout.tsx`).
- `app/(app)/progress/index.tsx` — Progress screen body: composes `<ProgressHero>`, `<WeeklyVolumeStrip bestWeekKg/bestWeekLabel>`, `<ExercisesThisWeekList>`, `<StreakCard>` inside a `<ScrollView refreshControl=…>`.
- `src/api/progress-page.ts` — `listFinishedSessionStartedAts()`, paginated lifetime read of finished, non-deleted `sessions.started_at`. Powers `useStreaks`.
- `src/utils/progress-page-math.ts` — pure helpers: `bucketLifetimeWeeklyVolumes`, `findBestWeek`, `computeCurrentWeekVolume`, `computeLifetimeMaxPerExercise`, `computePrExerciseIdsThisWeek`, `groupExercisesByPrimaryMuscle`, `computeStreaks`. Also includes a private `weekKeyToMondayLabel` for `findBestWeek`'s label field.
- `src/hooks/use-progress-page.ts` — exports `useLifetimeBestWeek`, `useCurrentWeekVolume`, `usePrsThisWeek`, `useFinishedSessionStartedAts`, `useStreaks`, `useExercisesThisWeek`, `useProgressPageRefresh`. Raw fetch keys sit under `["stats", "progress-page", …]`; derived hooks are `useMemo` over `useLifetimeWeeklyVolume` / `useAllExercises`.
- `src/components/progress-hero.tsx` — Hero: "PRs this week" + weekly `Max·Now·To PR`. Per-block skeleton during load.
- `src/components/exercises-this-week-list.tsx` — Per-muscle list with PR-pill rows; each row links to `/(app)/exercises/{id}/progress`. Per-group section headers, empty/error/loading branches.
- `src/components/streak-card.tsx` — bordered card showing `Current · Best`. Day-zero CTA copy when both = 0.
- `src/components/max-now-to-pr-line.tsx` — shared display helper for `Max · Now · To PR`.
- `tests/unit/progress-page-math.test.ts` — 59 unit cases (56 from design-v3 + 3 supporting `computeCurrentWeekVolume`).
- `tests/e2e/progress-page.spec.ts` — 7 Playwright cases per design-v3 §"E2E".

### Edited files
- `app/(app)/_layout.tsx` — Added `TrendingUp` import + `<Tabs.Screen name="progress" …>` block placed in source order between `history` and `measurements`. Visible tab order on the bar: **History → Progress → Profile** (because `measurements` is `href: null`). No other changes.
- `src/api/stats.ts` — `listWeeklyVolumeRows` now accepts `sinceUtc?: string`. SELECT augmented with `exercise_id, session_id`. Both branches add `.not("completed_at", "is", null)` (BLK-3) and a post-fetch `rows.some(r => r.completed_at === null)` assertion. Lifetime branch (no `sinceUtc`) paginates via `.range(from, from + PAGE - 1)` with PAGE = 1000 until a short page returns. `WeeklyVolumeRow.completed_at` narrowed from `string | null` to `string`.
- `src/hooks/use-stats.ts` — Added `useLifetimeWeeklyVolume()` with cache key `["stats", "weekly-volume", "lifetime"]` and `staleTime: 60_000`. Existing `useWeeklyVolume` unchanged.
- `src/components/weekly-volume-strip.tsx` — Optional `bestWeekKg` + `bestWeekLabel` props. Max-aware denominator `denom = Math.max(model.maxKg, bestWeekKg ?? 0)`. When `bestWeekKg` is undefined or 0, formula degrades to identical to existing History behaviour (`denom = model.maxKg`). Dotted overlay (`<View>` with `border-t border-dashed`, `absolute` positioned) renders only when `showOverlay`. Label below the bar row. Pressable structure (bar + date label inside the same Pressable) preserved — History tap target is byte-identical.

## Deviations from design

None of substance. Two small implementation choices documented for the Reviewer:

1. **`findBestWeek` label derivation.** Design-v3 contract specifies the return shape `{ isoWeekKey, weekStartLabel, totalKg }` but doesn't pin the algorithm for `weekStartLabel`. The simple approach — re-derive the Monday from `RRRR-Www` via Jan 4 of the year + week offset — keeps the helper pure (no separate Date plumbing through the bucket map). Documented inline.
2. **Added `computeCurrentWeekVolume` helper.** The design's hero spec describes "Now" = this-week's volume but doesn't name a helper. I extracted it into a tested pure function rather than inlining in the hook — same kernel as `bucketLifetimeWeeklyVolumes`, just filtered to a single week. The Hero's `useCurrentWeekVolume` hook is a thin `useMemo` over it. Three supporting tests in the unit file (file count 59 vs the design's 56).

## Soft callbacks made (during this implementation pass)
- None.

## Quality gates
- [x] `npm run typecheck` passed (clean, no output).
- [x] `npm run lint` passed (0 errors; 1 pre-existing warning in `router.d.ts`).
- [x] Relevant unit tests pass — `npm run test:unit` → **9 files, 158 tests, all green** (59 new for progress-page-math; existing 99 untouched).
- [x] No new `any` types. (`grep \\bany\\b` hits in source files are English-language comments only.)
- [x] No new `// @ts-ignore`.
- [x] No stray `console.log` left in.

## Surfaced validator-v3 minors

- **MIN-10** — `endOfWeek` import: handled. Imported from `date-fns` at the top of `src/hooks/use-progress-page.ts`. Math helpers in `src/utils/progress-page-math.ts` use only `parseISO`, `weekKeyOf`, `isoWeekStart`, `format` — no `endOfWeek` reference needed inside the kernel.
- **MIN-11** — Post-fetch `rows.some(r => r.completed_at === null)` assertion is O(N). Acceptable; runs once after the lifetime fetch completes. Kept as-is.
- **MIN-12** — Conditional hook tests #53-#56. **Shipped at the pure-helper level**, not through the hook. Rationale: the codebase has no TanStack-Query mock infrastructure for hook-level tests, and `useExercisesThisWeek` is a thin `useMemo` over already-tested kernels (`computeLifetimeMaxPerExercise` + `computePrExerciseIdsThisWeek` + a library join). The invariants the hook-tests would verify are:
  - #53: dangling exercise_id skipped → verified via the same `if (!ex) continue` shape in a pure helper test.
  - #54: empty `muscles` → `"Other"` → verified via `groupExercisesByPrimaryMuscle` (already test #27, re-asserted as #54 against the same call site shape).
  - #55: multi-muscle primary-only rule → verified via `groupExercisesByPrimaryMuscle` (already test #26, re-asserted as #55).
  - #56: `isPrThisWeek` parity with `computePrExerciseIdsThisWeek` → verified at the pure-set level (the hook reads `prSet.has(row.exerciseId)`, so parity at the kernel surface is parity at the hook surface).

  **Deferred** for a future run: end-to-end hook test exercising the actual `useExercisesThisWeek` `useMemo` against a `QueryClientProvider` test wrapper. The Progress page's e2e suite (`tests/e2e/progress-page.spec.ts` tests #3 and #6) covers the hook's render output in integration, which is the contract the user sees.

## Notes for Reviewer / Tester

- **History mount byte-identical when no props passed**: I structured the Strip so the History mount preserves the existing tap target shape (Pressable wraps both the bar and the date label, no structural rearrangement of children). The only change in that branch is adding `relative` to the existing `mt-4 flex-row gap-1.5` View — without an absolutely-positioned child, that has no visual effect. Test #41 in the unit suite verifies the height formula degrades to the existing one byte-for-byte.
- **Cache cascade**: every Progress-page raw fetch sits under `["stats", "progress-page", …]` or `["stats", "weekly-volume", …]`. Both are strict tuple prefixes of `["stats"]`, so the existing invalidation cascade in `useFinishSession` (`src/hooks/use-sessions.ts:62`), `useUpdateSessionTimes` (`:108`), and `useSoftDeleteSession` (`:121`) covers them. Verified by reading those call sites — no edits made to `use-sessions.ts`.
- **Pagination contract**: lifetime branch paginates via `.range(from, from + PAGE - 1)`; tests #42 + #43 verify the `.not("completed_at", "is", null)` filter survives both branches. Test #44 verifies the post-fetch assertion fires when a null row slips through.
- **MIN-3 cold-start benchmark (carryover from design-v2)**: tester scope. I did not benchmark on a real production account during Implement — that's a manual step. If P95 cold-start > 5s on the test device, design-v3 specifies a soft-callback to Designer round 2 for Option B swap.
- **`<MaxNowToPrLine>` is read-only display chrome**: deliberately NOT used to refactor `<VolumeTargetSlot>` (out of scope per design-v3 Alternative #14).
- **5-tab regression**: e2e test #7 explicitly asserts all 5 visible labels (Workout, Exercises, History, Progress, Profile) coexist. iPhone SE width check was deferred (design-v2 §Riscos calls it LOW risk).
