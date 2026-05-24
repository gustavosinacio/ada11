# Discovery — 2026-05-23_2357_progress-graph-current-week

## Feature prompt

Progress graph should start on the current week. The graph on the history page is rendering at the start of the history (oldest weeks) when it should show the latest entries by default.

(Conductor brief flagged two candidate surfaces — the weekly volume strip used by History + Progress, and the per-exercise progress chart at `app/(app)/exercises/[id]/progress.tsx`. The brief also asked whether this is a regression of the prior `2026-05-22_1130_chart-scroll-week-selector` run that claimed "default position pinned to right edge".)

Also tracked verbatim as a backlog item in `docs/features.md:11`:

> `[ ] progress graph should start on the current week. It seems to be starting on the start of the history.`

## Scope summary

The complaint is about the **`<WeeklyVolumeStrip>` mounted on the History tab (and identically on the Progress tab)**. The strip is a horizontally-scrollable bar chart that spans the user's full ISO-week history. Its initial scroll position is set via the `contentOffset` prop on a native `<ScrollView>`. The math is wrong: it anchors at `x = contentWidth` (one full viewport past the right edge), not `x = contentWidth − viewportWidth`. On any viewport narrower than the total content (i.e. an iPhone with more than ~7-8 weeks of history) the iOS native `<ScrollView>` does **not** reliably present a current-week-on-the-right initial frame from this value, and there is no `onContentSizeChange` / post-layout `scrollToEnd` fallback to repin. The per-exercise progress chart (`<ProgressChart>` on `app/(app)/exercises/[id]/progress.tsx`) is a fixed-width SVG with no scroll, so it is NOT the subject of the prompt.

This is a regression of the `2026-05-22_1130_chart-scroll-week-selector` run's "default pinned to right edge" guarantee. The buggy line was introduced by that run (commit `454249f`); the strip has had no edits since (verified via `git log -- src/components/weekly-volume-strip.tsx` — last touch is `454249f`).

## Affected files (verified)

- `src/components/weekly-volume-strip.tsx:230-267` — the strip component. The right-anchor math + `contentOffset` wiring lives here.
  - `:36` — `COLUMN_WIDTH = BAR_WIDTH + BAR_GAP` = 46pt per column.
  - `:230-232` — `contentWidth = buckets * 40 + (buckets - 1) * 6` (= `46n - 6`).
  - `:234-238` — comment claims `contentOffset` is "the canonical no-flash way to land at a non-zero offset"; line `:238` reads `const rightAnchorX = Math.max(0, contentWidth);` — **missing the viewport subtraction**.
  - `:267` — `<ScrollView … contentOffset={{ x: rightAnchorX, y: 0 }} … />`.
  - `:88` — `viewportWidthRef = useRef<number>(0)` captures the viewport width…
  - `:197-199` — `onLayout` writes to `viewportWidthRef` but never triggers a scroll.
  - `:159-165` — rollover `useEffect` calls `scrollToEnd` ONLY when `bucketsLength` grew while pinned right; it does NOT fire on initial mount (because `prevCountRef.current = bucketsLength` is seeded on first render, so the delta check `bucketsLength > prevCountRef.current` is false on subsequent renders too unless the count grew).
- `app/(app)/history/index.tsx:48` — call site #1: `ListHeaderComponent={<WeeklyVolumeStrip />}` inside a `<FlatList>`.
- `app/(app)/progress/index.tsx:65-68` — call site #2: `<WeeklyVolumeStrip bestWeekKg={…} bestWeekLabel={…} />` inside a `<ScrollView>`. **Both surfaces share the same component and therefore the same bug.** The prompt only mentions "history page" but a fix to the component fixes both.
- `app/(app)/history/week/[isoWeek].tsx:46-` — drill-down screen. Uses `useLifetimeWeeklyVolume` for week lookup but does NOT mount the strip. Out of scope.

## Out-of-scope file (verified)

- `app/(app)/exercises/[id]/progress.tsx:14, 141-156` — uses `<ProgressChart>` (an SVG line chart, `src/components/progress-chart.tsx:1-137`). Width is `Math.min(screenWidth - 48, 500)`. Fixed-width, no scroll, no scrollable wrapper. The chart fits the screen and shows ALL sessions left-to-right with oldest on the left. It does NOT exhibit "starts on oldest week" in the same way the prompt describes (which is about an initial scroll position landing wrong) — it always shows the full series. If the user later wants the per-exercise chart to default to "last N sessions" or to be horizontally scrollable, that is a SEPARATE feature; do not bundle it into this run unless the human confirms.

## How `<WeeklyVolumeStrip>` mounts (verified by reading code)

1. Hook `useLifetimeWeeklyVolume()` (src/components/weekly-volume-strip.tsx:82) returns lifetime weekly rows.
2. `computeStripModel(data)` (`:93-96`) buckets them into one bar per ISO week from `firstSessionMonday` → current Monday inclusive.
3. `contentWidth` (`:230-232`) is computed in JSX from `model.buckets.length`.
4. `rightAnchorX = Math.max(0, contentWidth)` (`:238`).
5. `<ScrollView horizontal contentOffset={{ x: rightAnchorX, y: 0 }} …>` (`:263-271`) — declarative initial position, no `onContentSizeChange` handler.
6. The bars render inside a fixed-width `<View style={{ width: contentWidth, … }}>` (`:272-275`).

There is **no other initial-scroll path**. `scrollToEnd` only fires from the rollover effect at `:160-165`, gated on `bucketsLength > prevCountRef.current` AND `isPinnedRightRef.current === true`. On first paint, `prevCountRef.current` is initialized to `bucketsLength` (`:159`), so the effect runs once with the comparison `bucketsLength > bucketsLength` → false → no scroll. The effect is **not** an initial-mount safety net.

## Why this only surfaced on the iPhone (HIGH confidence, supported by evidence)

- The Playwright e2e at `tests/e2e/chart-scroll-week-selector.spec.ts:148-201` "default mount: pinned to right edge, current-week visible, pill rendered" seeds 16 weeks and asserts the current-week bar is `toBeVisible()` (line 193). On RN Web in Chromium at the Playwright default viewport (~1280pt), `contentWidth ≈ 730pt` fits inside the viewport entirely (no horizontal overflow). Therefore the test passes regardless of `contentOffset` — there is no scroll to "miss". The pinned screenshot at `docs/runs/2026-05-22_1130_chart-scroll-week-selector/screenshots/scroll-default-mount.png` confirms: all 16 bars visible side-by-side, no scrollbar, no overflow.
- On RN Web with a narrower viewport, the underlying `<div style="overflow-x: scroll">` would clamp `scrollLeft` to `[0, scrollWidth - clientWidth]`. Setting `scrollLeft = 730` when `scrollWidth = 730` and `clientWidth = ~358` clamps to `scrollLeft = 372` — which IS the right edge. RN Web "accidentally" does the right thing via clamp.
- On iOS native, RN's `ScrollView.contentOffset` translates to `UIScrollView.contentOffset`. When set declaratively before content has laid out, the offset can be applied with `contentSize = 0`, which clamps to 0 (leftmost). This is a known RN gotcha — the canonical fix is `onContentSizeChange={(w) => ref.current?.scrollTo({ x: w, animated: false })}` or `scrollToEnd` inside `onLayout`.
- `react-native@0.81.5` + `react-native-web@~0.21.0` (`package.json:52, 59`).

Confidence label per the code reading: **HIGH** that this line is the bug. **MEDIUM** on the precise root cause (declarative-contentOffset-before-layout vs. simply-wrong-math-but-coincidentally-handled-by-web-clamp) — both lead to the same fix.

Risk per change: **LOW**. The fix is local to one component; no data model, no schema, no API. Worst case is a one-frame flash at mount.

## Relevant conventions (verified by reading code)

- **Horizontal-scroll right-anchor pattern**: the repo has exactly one of these (this very component). No other native `<ScrollView horizontal>` exists in `src/components/` that uses `contentOffset` or `scrollToEnd`. So there is no in-repo precedent to copy — the fix has to define the precedent.
- **Imperative scrolls from refs**: `weekly-volume-strip.tsx:141-153` (`handleJumpTo`) uses `scrollRef.current?.scrollTo({ x, y, animated })`. Same pattern would work for an initial pin.
- **`useImperativeHandle` for ref-owned state**: the strip already uses this pattern via `<VisibleRangePill>` (`src/components/week-selector.tsx`) to keep scroll updates from re-rendering the parent. Any fix should preserve that — do NOT introduce a `setState` driven from `onContentSizeChange` that would re-render the 260-bar grid every frame.
- **Run-tagged feature precedent**: `docs/features.md:29` lists the chart-scroll feature as **shipped** with the right-pin claim. That claim is now demonstrably untrue on the user's reported surface (iPhone). Fix is a continuation of that feature, not a new affordance.
- **Test seed convention**: `tests/e2e/chart-scroll-week-selector.spec.ts:81-90` uses `mondayNWeeksAgoUtc()`; `:155-169` seeds 16 weeks. A regression test that asserts "scroll position is right-pinned on a narrow viewport" would need to (a) override viewport via Playwright's `page.setViewportSize({ width: 390, height: 844 })` and (b) read `evaluate(() => el.scrollLeft + el.clientWidth >= el.scrollWidth - tolerance)`.

## Constraints

- **Data**: no schema changes. The lifetime-weekly bucketing kernel (`src/utils/weekly-volume-strip-math.ts` per design-v2 of the prior run) is unaffected. RLS unchanged.
- **UI**: must keep the existing visual contract (border-b chrome, "This week" header, `<VisibleRangePill>` row, dotted overlay anchored inside the scroller, per-bar tap-to-drill-down at `:299-315`). Do not move the overlay or the per-bar a11y label.
- **Platform**: the failure is iOS-native. The fix must work on both iOS and RN Web. RN Web already coincidentally works; ensure the fix does not introduce a backwards regression on RN Web (e.g. by triggering an unnecessary post-mount scroll that visibly jumps from offset 0 to offset N).
- **Auth**: none touched.
- **Performance**: the strip already has a "no re-render on scroll" invariant (run-2026-05-22_1130 MAJ-3 fix). The fix must NOT introduce parent `setState` per scroll event. An `onContentSizeChange` callback is fine because it fires once on layout, not per-frame.

## Existing precedents

- `weekly-volume-strip.tsx:141-153` — imperative `scrollRef.current?.scrollTo` from `handleJumpTo`. Same primitive can be reused inside an `onContentSizeChange` or `onLayout` callback for initial pinning.
- `tests/e2e/chart-scroll-week-selector.spec.ts:148-201` — existing "default mount" test. Augment with a narrow-viewport assertion (see Conventions).
- `docs/runs/2026-05-22_1130_chart-scroll-week-selector/design-v2.md` — original design doc; its "right-edge anchor" section is where the fix should be back-referenced. (Not re-read in full; surface evidence is enough.)

## Unknowns (require Designer judgment or human decision)

1. **Choice of fix primitive (LOW-stakes design call)**: three viable options, each compatible with the existing no-rerender invariant.
   - (a) Change line `:238` from `Math.max(0, contentWidth)` to `Math.max(0, contentWidth - viewportWidthRef.current)`. **Hidden gotcha**: `viewportWidthRef.current` is 0 on first render (set by `onLayout`, which fires after first paint). So this fix in isolation does nothing — the prop is read during the first render, when the ref is still 0. Will need an extra `forceUpdate`-after-`onLayout` or move to option (b)/(c).
   - (b) Add `onContentSizeChange={(w) => scrollRef.current?.scrollTo({ x: Math.max(0, w - viewportWidthRef.current), y: 0, animated: false })}`. Fires once after layout. Risk: a single-frame flash from offset 0 → final offset on slow devices.
   - (c) Use `onLayout` on the `<ScrollView>` AND keep `onContentSizeChange`; in both, scroll to `contentSize - layoutMeasurement.width`. Two callbacks, but covers the "layout-before-content" and "content-before-layout" orderings without `viewportWidthRef` plumbing.
   - **Recommended Designer call**: (c) is the most robust; (b) is the smallest diff. (a) alone is broken.
2. **Should the rollover effect at `:159-165` also serve as initial-mount safety net?** Resetting `prevCountRef = 0` on first render would make the existing `useEffect` fire `scrollToEnd` once on mount. This is a 1-line alternative to (b)/(c) — but it relies on `useEffect` order vs. mount paint, and on a narrow viewport the user would still see a flash from offset 0 → right edge.
3. **Scope: include the Progress tab call site explicitly?** YES — the fix lives in the shared component, so both surfaces fix in one diff. The state.md / final-summary should call out that the Progress tab inherits the fix, since the prompt only said "history page".
4. **Per-exercise progress chart** (`app/(app)/exercises/[id]/progress.tsx`): the prompt does not address it, and the chart's failure mode (full series squished into 342pt) is qualitatively different. Designer should **not** bundle a chart-redesign into this run; if the user later complains "I can't tell what changed in the last month" on the exercise chart, that's a follow-up feature (limit-to-last-N, or add horizontal scroll). Flag for the Conductor at run-close.
5. **Regression test viewport**: Playwright config doesn't currently pin a mobile viewport for these specs. Designer/Tester should decide whether to (i) add a per-test `page.setViewportSize({ width: 390, height: 844 })` in the new case, or (ii) add a fixture. Either is fine; (i) is the smallest scope.
6. **Was the prior run's Playwright pass actually meaningful?** The "default mount: pinned to right edge" assertion (`tests/e2e/chart-scroll-week-selector.spec.ts:188-193`) only checks `toBeVisible` on the current-week bar, which is satisfied trivially on a wide viewport regardless of scroll position. This is a coverage-gap fact, not a designer question — surfaced here so the Tester writes a stronger assertion this round.

## Out-of-scope flags

- Do NOT redesign `<ProgressChart>` (per-exercise SVG line chart). Confirmed not the subject of the prompt.
- Do NOT touch the `<WeekSelector>` modal or `<VisibleRangePill>`. Their behaviour is correct.
- Do NOT touch `useLifetimeWeeklyVolume` or `computeStripModel`. The data is fine; only the initial scroll position is wrong.
- Do NOT change the rollover-auto-scroll semantics (`weekly-volume-strip.tsx:159-165`). Repurposing it as an initial-mount fix is acceptable; deleting it is not.
- Do NOT add a "today" indicator or a `Now ↦` button; the prompt is about default position only.
- Do NOT migrate the strip to `react-native-gifted-charts`, `victory-native`, or any chart lib. Native `<ScrollView>` + Views is the established approach.
