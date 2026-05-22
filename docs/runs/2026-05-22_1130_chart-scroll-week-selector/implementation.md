# Implementation — 2026-05-22_1130_chart-scroll-week-selector

Based on: `design-v2.md` (approved) and `validation-v2.md` (matching `go`, 6 implementer-facing minors).

## Files changed

- `src/utils/dates.ts` (edited) — added `isoWeekContaining(d)` and `isoWeeksBetween(startMonday, endMondayInclusive)` helpers (oldest→newest, returns `[]` when end<start). Both pure; reuse existing `WEEK_OPTS`, `startOfWeek`, `endOfWeek`, `addDays` (new import).
- `src/api/stats.ts` (edited) — added defensive default `opts: {...} = {}` so no-arg calls don't crash. Both branches (`sinceUtc` + lifetime) preserved. **MIN-A fix.**
- `src/hooks/use-stats.ts` (edited) — deleted `useWeeklyVolume` + `WEEKS_WINDOW` + `sinceUtc` derivation. `useLifetimeWeeklyVolume` is now the only consumer hook. **MIN-B fix** (the design said "delete `WEEK_OPTS`" but the actual constant was `WEEKS_WINDOW`; deleted the correct thing).
- `src/utils/weekly-volume-strip-math.ts` (new) — pure-module home for `computeStripModel(data, now?)`. Splits the kernel out of the component so unit tests don't drag in `expo-router`. Returns `null` on empty data; dynamic buckets `isoWeeksBetween(firstSessionMonday, currentMonday)`; `maxKg` is lifetime max.
- `src/components/weekly-volume-strip.tsx` (rewritten) — consumes `useLifetimeWeeklyVolume()`. Bars now live inside a horizontal `<ScrollView>` with fixed-width columns (`BAR_WIDTH=40`, `BAR_GAP=6`, `COLUMN_WIDTH=46`). `contentOffset.x` pins the right edge on mount. Lifetime-best overlay sits INSIDE the scroller, spanning the full content width at lifetime-max Y. `onScroll` updates `<VisibleRangePill>` via `pillRef.current?.setRange()` — no `setState` on the parent during scroll. Scroll-frame dedupe via `lastLabelRef` (**Scrutiny-2 fix**). Week-rollover `useEffect` re-pins to right edge when `buckets.length` grows AND `isPinnedRightRef.current === true` (**MIN-5 fix**). Accessibility label includes the year for non-current-year bars.
- `src/components/week-selector.tsx` (new) — `<VisibleRangePill>` (`forwardRef` + `useImperativeHandle` exposing `{ setRange }`, **Scrutiny-1 canonical pattern**; takes `initialLabel: string` prop per **MIN-D fix**). `<WeekSelectorModal>` (bottom-sheet via `<Modal animationType="slide" transparent>` + `flex-1 justify-end bg-black/50` backdrop + `rounded-t-2xl bg-white px-6 pb-10 pt-6 dark:bg-gray-900` card; year row + 12-month row of chips; pre-first-session months dimmed with `opacity-40 pointer-events-none`; no `[X]` header; dismiss via backdrop or `[Jump]`). `<WeekSelectorHeader>` composes the two and owns the open/close state.
- `app/(app)/history/index.tsx` (edited) — swapped `useWeeklyVolume` → `useLifetimeWeeklyVolume` for the pull-to-refresh `refetchWeekly` reference.
- `app/(app)/history/week/[isoWeek].tsx` (edited) — swapped `useWeeklyVolume` → `useLifetimeWeeklyVolume`. Deleted the `isInWindow` guard at `:74-78` and BRANCH 2 outside-range copy at `:128-138`. Renumbered remaining BRANCH 3/4/5 → BRANCH 2/3/4. Comment about `lastNIsoWeeks` reference also updated.
- `tests/unit/dates.test.ts` (edited) — added 4 cases for `isoWeekContaining` (Monday/Wed/year-boundary) and 6 cases for `isoWeeksBetween` (single-week, 3-week span, 5-week span with monotonic check, year-boundary, end<start empty return, non-Monday normalisation).
- `tests/unit/weekly-volume-bucketing.test.ts` (rewritten) — drops the "exactly 8 buckets" assertion in favour of dynamic-bucket assertions. Empty data returns `null`. Lifetime-spanning buckets include rows older than 8 weeks. Volume kernel + height-formula assertions preserved. Imports `computeStripModel` from the new pure-math module.
- `tests/e2e/week-drill-down.spec.ts` (edited) — repurposed the "out-of-window" case (`:319-361`): now deep-links to a 12-weeks-ago Monday and asserts the per-week screen renders normally (no outside-window copy, "No sessions this week." appears for the unseeded historical week).
- `tests/e2e/chart-scroll-week-selector.spec.ts` (new) — 3 cases: (1) default-mount + pill rendered + current-week bar visible; (2) tap pill → modal opens → Jump confirms → modal dismisses; (3) backdrop tap dismisses modal.

## Deviations from design

- **`computeStripModel` location.** Design implied the kernel lived in `src/components/weekly-volume-strip.tsx`. I moved it to `src/utils/weekly-volume-strip-math.ts` because the unit test couldn't import from the component without dragging in `expo-router` (transitively pulled via `useRouter`). The component re-imports it; behaviour and signature unchanged. This matches the convention in `src/utils/progress-page-math.ts` (pure kernel for `<Progress>` page).
- **MIN-C (tighten e2e bar-count assertion).** The validation flagged this as "optional / defer if cheap." Left the existing `weekly-volume-strip.spec.ts:197` assertion (`labelTexts.length >= 8`) untouched — under lifetime data with ≥16 weeks, this still holds; the assertion is loose but not load-bearing. New e2e file (`chart-scroll-week-selector.spec.ts`) covers the scrolling-specific behaviour.
- **Selector flow simplification in e2e test #2.** The "confirm a (year, month) pick scrolls the strip" assertion is implicit (we just confirm the modal closes cleanly). Asserting actual scroll-x changes on Expo Router web is brittle without bespoke DOM inspection of the ScrollView's internal transform — defer that depth to manual QA / a dedicated visual test.

## Soft callbacks made (during this implementation pass)

None.

## Quality gates

- [x] `npm run typecheck` passed — clean (no output)
- [x] `npm run lint` passed — 0 errors, 1 pre-existing warning in `router.d.ts` (not introduced by this run)
- [x] Relevant unit tests pass — `npm run test:unit` reports 208/208 passing (was 201 before this run; +7 net new tests from the bucketing rewrite and dates additions)
- [x] No new `any`
- [x] No new `// @ts-ignore`
- [x] No stray `console.log`

## Validator's 6 implementer-facing minors — status

- **MIN-A** (`opts` default in `listWeeklyVolumeRows`): fixed (`= {}` default).
- **MIN-B** (precise delete target): fixed (`WEEKS_WINDOW` + `sinceUtc` derivation removed from `use-stats.ts`).
- **MIN-C** (tighten e2e bar-count): documented in Deviations; left loose.
- **MIN-D** (`<VisibleRangePill>` `initialLabel` prop): fixed (component takes `initialLabel: string`; strip computes the rightmost-window label at mount and passes it in via `<WeekSelectorHeader initialLabel={...}>`).
- **Scrutiny-1** (canonical `useImperativeHandle` pattern): applied — `forwardRef<VisibleRangePillHandle, Props>` + `useImperativeHandle(ref, () => ({ setRange }), [])`. Handle shape narrow (only `setRange`).
- **Scrutiny-2** (dedupe `setRange` on consecutive same-label frames): fixed via `lastLabelRef: useRef<string>("")` short-circuit in `onScroll`.

## Notes for Reviewer / Tester

- **`computeStripModel` location**: lives in `src/utils/weekly-volume-strip-math.ts`, not in the component. Mirrors `src/utils/progress-page-math.ts`. Reviewer please confirm the location is acceptable; design implied component-local but tests forced the split.
- **Lifetime data on History**: the History page now fetches the lifetime weekly-volume dataset (was 8-week). For a heavy user this is bounded ≤32 paginated round-trips, cached for 60s, and shares the cache key (`["stats","weekly-volume","lifetime"]`) with the Progress page — net cache size DECREASED.
- **`useWeeklyVolume` is gone**: the 8-week hook export has been removed. The `sinceUtc` branch of `listWeeklyVolumeRows` is kept for test #43 at `tests/unit/progress-page-math.test.ts:807-813`.
- **History drill-down outside-window copy is gone**: deep-link to any historical Monday now renders normally (no special "outside the visible range" message).
- **Accessibility label change**: bars in non-current years get `"View week of M/d/yyyy"` instead of `"View week of M/d"` — disambiguates 5/12/2025 vs 5/12/2026 under multi-year scrolling. Existing e2e tests only target current-year cases, so they still pass.
- **Performance**: scoped-state pattern keeps `onScroll` from re-rendering the bar array. Pill is the only node that re-renders per scroll frame. Dedupe guard skips no-op `setRange` calls.
- **Known cosmetic debt**: History's `refetchWeekly` ref is now redundant because TanStack dedupes the lifetime query (the Sessions refetch already fans out). Left as-is per design MIN-3.
- **Cold-start fallback**: per design MIN-4, if real users surface lag on heavy first-load, the deferred path is to add a `weekly_volumes_view` Postgres aggregate. Out of scope here.
- **Tester e2e seeding caveat**: the new `chart-scroll-week-selector.spec.ts` seeds 16 weeks of data — be aware of the linear seed cost (≈16 finished sessions per run).

## I↔T r2 (round 2 of 2) — test-only fixes

Tester report `test-report-v1.md` decision was `fail` with 2 deterministic failures in `tests/e2e/week-drill-down.spec.ts`. Both were test-side adaptations required by in-scope behaviour changes (`<VisibleRangePill>` text + dynamic-bucket model). Production code untouched in this round.

### Fixes applied

- **`tests/e2e/week-drill-down.spec.ts:234-241` (Fix 1, regex collision with pill).** The body header at `app/(app)/history/week/[isoWeek].tsx:145` renders `"MMM d – MMM d"` (no year). The new `<VisibleRangePill>` text always carries a year suffix (`"MMM d – MMM d, yyyy"` for single-year windows or `"MMM d, yyyy – MMM d, yyyy"` for cross-year). On Expo Router web the prior History route stays mounted with `display:none`, so the page-level regex resolved 2 matches in strict mode. Anchored the regex with `^...$` to require an exact full-text Text-node match — the year-bearing pill text no longer satisfies it.

- **`tests/e2e/week-drill-down.spec.ts:260-279` (Fix 2, empty-week seed extension).** Old assumption: fixed 8-week strip → seeding only the current week left 7 zero-volume rest bars (offsets 1..7). New model: `computeStripModel` calls `isoWeeksBetween(firstSessionMonday, currentMonday)` so a current-only seed produces exactly 1 bar. Extended the seed loop to offsets `[0, 5]` so the bucket model spans 6 weeks (offsets 5,4,3,2,1,0) and the 3-weeks-ago rest bar — which the test taps — exists with zero volume.

### Files touched (r2)

- `tests/e2e/week-drill-down.spec.ts` (edited) — Fix 1 + Fix 2 above. No other call sites moved.

### Quality gates (r2)

- [x] `npm run typecheck` — clean (no output, exit 0).
- [x] `npm run lint` — 0 errors, 1 pre-existing warning (`router.d.ts`).
- [x] `npm run test:unit` — 208/208 passing.
- [x] No new `any`, no `@ts-ignore`, no `console.log`.
- E2E not re-run in this round per the Conductor's hand-off (Tester re-runs).

### Deviations from the Tester's fix sketch

None. Both fixes follow the Tester's recommendations literally:

- Fix 1 used the anchored-regex variant (Tester also suggested year-anchoring the pill detection; anchoring `^...$` is equally specific and lighter — body header always lacks a comma).
- Fix 2 used `[0, 5]` offsets (Tester suggested "≥6 weeks back so model produces ≥7 buckets"; `5` is the minimum that keeps the 3-weeks-ago bar inside the bucket range, which is all the test needs).
