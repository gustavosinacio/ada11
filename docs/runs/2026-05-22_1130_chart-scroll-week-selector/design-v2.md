# Design v2 — 2026-05-22_1130_chart-scroll-week-selector

> Delta over v1. Sections tagged `[v1-carryover]` (unchanged from v1, see design-v1.md for full text), `[changed-v2]` (replaces v1 content), or `[new-v2]`. Round 2 of 3.

## Goal (1 sentence) `[v1-carryover]`

Make the shared `<WeeklyVolumeStrip>` horizontally scrollable across the user's entire ISO-week history, add a tappable header that opens a hand-rolled month/year picker to jump the strip to any past week, and keep the lifetime-best dotted overlay anchored at the lifetime max regardless of scroll.

## Approach `[changed-v2]`

Consolidate around the lifetime dataset. Both consumers (`history/index.tsx`, `progress/index.tsx`) and the drill-down screen (`history/week/[isoWeek].tsx`) move off the 8-week `useWeeklyVolume` hook onto `useLifetimeWeeklyVolume`. **We delete the `useWeeklyVolume` export but keep `listWeeklyVolumeRows`'s `opts?: { sinceUtc?: string }` signature intact** (no-arg call goes through the lifetime branch). The `sinceUtc` branch becomes dead-but-harmless code, preserving test #43 at `tests/unit/progress-page-math.test.ts:807-813` which calls `listWeeklyVolumeRows({ sinceUtc: "2026-04-01T00:00:00Z" })` and asserts the server filter. Bars switch from `flex-1` columns inside an 8-cell row to fixed-pixel columns (40pt + 6pt gap) inside a native `<ScrollView horizontal>`, with `contentOffset.x` pinned to the rightmost edge on mount so the user lands on the current week with ~7 weeks of context to its left. The lifetime-best dotted overlay lives INSIDE the scroller and spans the full content width at the lifetime-max Y — bars scale against `Math.max(model.maxKg, bestWeekKg ?? 0)` (lifetime max), so the line is always at the same Y across every bar. A new `<WeekSelector>` renders a tappable header pill showing the currently-visible week range and opens a bottom-sheet `<Modal>` with a hand-rolled month-and-year grid that mirrors `<SetRowMenu>`'s slide-from-bottom pattern (no [X] header — dismiss via backdrop tap). To avoid 60fps × 260-bar reconciliation, the visible-range state lives **inside the `<VisibleRangePill>` child component** (the selector header itself) via a `useImperativeHandle` ref the strip parent calls from its `onScroll`; only the pill re-renders during a flick, not the bar array.

## Mudanças por arquivo `[changed-v2]`

| File | Type | Change |
|---|---|---|
| `src/components/weekly-volume-strip.tsx` | edited | Replace fixed 8-bar layout with horizontal `<ScrollView>` of fixed-width bars driven by `useLifetimeWeeklyVolume()`. Render `<WeekSelector>` header (which owns the `<VisibleRangePill>` child that holds visible-range state). Switch bar denominator to lifetime max. Move overlay inside the scroller, spanning full content width. Add scroll-to-end on mount via `contentOffset`. Add `scrollToWeekKey()` imperative ref handle used by the selector. Add year markers at January-W1 transitions. Add `useEffect` re-pinning to right edge when `buckets.length` grows AND the user was within `COLUMN_WIDTH * 1.5` of the right edge. `computeStripModel` returns `null` when `data.length === 0`. |
| `src/components/week-selector.tsx` | new | Tappable header pill + bottom-sheet `<Modal>` (slide-from-bottom, backdrop dismiss) with hand-rolled month/year picker. Exposes a `<VisibleRangePill>` subcomponent with `useImperativeHandle` ref so the strip's `onScroll` can mutate its label without re-rendering the strip parent. |
| `src/hooks/use-stats.ts` | edited | Delete `useWeeklyVolume` export (8-week hook) and its `WEEK_OPTS`/sinceUtc derivation. Keep `useLifetimeWeeklyVolume` (unchanged). |
| `src/api/stats.ts` | edited | **No signature change.** `listWeeklyVolumeRows(opts?: { sinceUtc?: string })` stays. Both branches stay (lifetime + sinceUtc). The strip and all hooks now call the no-arg form. |
| `app/(app)/history/index.tsx` | edited | Replace `useWeeklyVolume()` import with `useLifetimeWeeklyVolume()` for the pull-to-refresh `refetchWeekly` reference. The strip itself sources data internally — no prop change. |
| `app/(app)/progress/index.tsx` | edited | No data-fetch changes (already uses lifetime via `useLifetimeBestWeek`). Verify `bestWeekKg`/`bestWeekLabel` props still flow correctly. |
| `app/(app)/history/week/[isoWeek].tsx` | edited | Replace `useWeeklyVolume()` with `useLifetimeWeeklyVolume()`. Delete `isInWindow` guard + BRANCH 2 (`!isInWindow`) outside-range copy at `:74-78,128-138`. Headline volume reduction at `:91-102` works unchanged against lifetime rows. |
| `src/utils/dates.ts` | edited | Add `isoWeekContaining(d: Date): IsoWeek` AND `isoWeeksBetween(startMonday: Date, endMondayInclusive: Date): IsoWeek[]`. Both pure helpers, reuse `WEEK_OPTS`, `startOfWeek`, `endOfWeek`, `format`, `addDays`. No new deps. |
| `tests/e2e/weekly-volume-strip.spec.ts` | edited | Locator updates: bar pressable lookup unchanged (still `View week of M/d`); add 1 case for scroll-to-end-on-mount; add 1 case for week-selector flow. |
| `tests/e2e/week-drill-down.spec.ts` | edited | Repurpose the "out-of-window" case (`:319-361`): deep-link to a 12-weeks-ago Monday and assert headline renders correct volume + sessions list. |
| `tests/e2e/chart-scroll-week-selector.spec.ts` | new | Seeds a user with ≥16 weeks of activity. Asserts (a) scroll-to-end default on mount, (b) older bars are reachable via horizontal scroll, (c) selector header shows the visible range, (d) jumping via selector scrolls to chosen week, (e) lifetime-best overlay's Y stays put while scrolling, (f) jumping to a zero-session month scrolls to gray-stub bars (no special copy). |
| `tests/unit/dates.test.ts` | edited | Add cases for `isoWeekContaining` (regular Monday, mid-week, ISO-week-1-of-year crossing) AND `isoWeeksBetween` (single-week, 5-week range, year-boundary range). |
| `tests/unit/weekly-volume-bucketing.test.ts` | edited | Drop "exactly 8 buckets" assertion in favour of "all weeks between `firstSetMonday` and `currentMonday`". Add "5 weeks of data → 5 contiguous buckets oldest→newest". Update tests that hardcoded `WEEKS_WINDOW = 8`. Existing volume-kernel cases stay. **Keep test #43 of `tests/unit/progress-page-math.test.ts:807-813` untouched** — the `sinceUtc` branch survives. |

## Page composition

### Default mount / Scrolled back `[v1-carryover]`

See design-v1.md §"Page composition" — first two ASCII sketches unchanged.

### Selector modal `[changed-v2]` — bottom-sheet shape, no [X] header

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  (page content visible above, dimmed by black/50)       │
│                                                         │
│                                                         │
├─────────────────────────────────────────────────────────┤  ← slides up
│  Jump to month                                          │
│                                                         │
│  YEAR     [ 2023 ] [ 2024 ] [ 2025 ] [ 2026 ←sel ]      │
│                                                         │
│  MONTH    [ Jan ] [ Feb ] [ Mar ] [ Apr ]               │
│           [ May ←sel ] [ Jun ] [ Jul ] [ Aug ]          │
│           [ Sep ] [ Oct ] [ Nov ] [ Dec ]               │
│                                                         │
│  Months before your first session are dimmed.           │
│                                                         │
│                                          [ Jump ]       │
└─────────────────────────────────────────────────────────┘
                          ▲
        Bottom-docked card. No [X] in header.
        Dismiss = tap backdrop (above the card) or [Jump].
```

Layout exactly mirrors `<SetRowMenu>` at `src/components/set-row-menu.tsx:110-225`:

- Outer wrapper: `<Modal visible animationType="slide" transparent onRequestClose={onClose}>`.
- Backdrop: `<Pressable onPress={onClose} className="flex-1 justify-end bg-black/50">`.
- Inner blocker: `<Pressable onPress={() => {}} accessibilityRole="none">` (prevents backdrop dismiss when tapping the card).
- Card: `<View className="rounded-t-2xl bg-white px-6 pb-10 pt-6 dark:bg-gray-900">`.
- Header row: `<Text className="text-lg font-semibold text-black dark:text-white">Jump to month</Text>` — **no `[X]` button**. Dismiss via backdrop tap.

Year row + month row: NativeWind chips mirroring the RPE chip pattern at `set-row-menu.tsx:171-202` (`min-w-[44px] rounded-full px-3 py-2` for 44pt iOS touch target; selected state = `bg-emerald-500 text-white`; default = `border border-gray-300 dark:border-gray-700`). Pre-first-session chips dimmed via `opacity-40` + `pointer-events-none`.

## Contratos de I/O `[changed-v2]`

### Function signatures / types

```ts
// src/api/stats.ts — UNCHANGED (signature preserved to keep test #43 passing).
export async function listWeeklyVolumeRows(
  opts?: { sinceUtc?: string }
): Promise<WeeklyVolumeRow[]>;
// IMPORTANT — Implementer note:
// - The `sinceUtc` branch must STAY. It's exercised by
//   tests/unit/progress-page-math.test.ts:807-813 (test #43).
// - All production callers move to the no-arg form (lifetime branch).
// - Treat the sinceUtc branch as "kept for test compatibility / future windowed reads".

// src/hooks/use-stats.ts — `useWeeklyVolume` REMOVED entirely.
// `useLifetimeWeeklyVolume` unchanged.
export function useLifetimeWeeklyVolume(): UseQueryResult<
  WeeklyVolumeRow[],
  Error
>;

// src/utils/dates.ts — TWO new helpers.

/**
 * Returns the ISO week (Monday/Sunday/key/label) containing `d`.
 * Used by the week-selector to translate (year, month) → bucket key.
 */
export function isoWeekContaining(d: Date): IsoWeek;

/**
 * Returns contiguous ISO weeks from `startMonday` (inclusive) to
 * `endMondayInclusive` (inclusive), oldest → newest. Both inputs MUST be
 * the Monday of their ISO week (call `startOfWeek(d, WEEK_OPTS)` if unsure).
 * Returns `[]` when `endMondayInclusive < startMonday`.
 *
 * Example:
 *   isoWeeksBetween(Date(2026-05-04), Date(2026-05-18)).length === 3
 *   // [{Mon=5/4,...}, {Mon=5/11,...}, {Mon=5/18,...}]
 */
export function isoWeeksBetween(
  startMonday: Date,
  endMondayInclusive: Date
): IsoWeek[];

// src/components/weekly-volume-strip.tsx — internal types.
// Public props identical to today:
type Props = {
  bestWeekKg?: number;
  bestWeekLabel?: string;
};

// New internal model — buckets dynamic-length, OR null on empty data.
type StripModel = {
  buckets: Bucket[];          // length = N (lifetime weeks), oldest→newest
  maxKg: number;              // lifetime max across ALL buckets
  currentWeekKg: number;      // last bucket's totalKg
  firstSessionMonday: Date;   // earliest Monday in `buckets`
};

/**
 * Returns `null` on empty data (preserves today's empty-state branch which
 * just shows the zero-state row without bars).
 */
function computeStripModel(rows: WeeklyVolumeRow[]): StripModel | null;

// src/components/week-selector.tsx — new component.
type WeekSelectorProps = {
  /** Years to render in the year row, ascending. */
  availableYears: number[];
  /** Earliest (year, monthIndex0) the user has data for; older picks dimmed. */
  firstAvailable: { year: number; month: number };
  /** Latest (year, monthIndex0) the user has data for. */
  lastAvailable: { year: number; month: number };
  /** Called when the user confirms a (year, month) pick. */
  onJumpTo: (year: number, month: number) => void;
  /** Imperative ref to the inner <VisibleRangePill> — used by the strip's onScroll. */
  pillRef: React.Ref<VisibleRangePillHandle>;
};

// Imperative handle for scoped label updates (avoids parent re-render on scroll).
type VisibleRangePillHandle = {
  setRange: (label: string) => void;
};
```

### DB columns / queries `[v1-carryover]`

No DB changes. See design-v1.md §"DB columns / queries".

### UI props / state `[changed-v2]`

- `<WeeklyVolumeStrip>` public props unchanged — still `bestWeekKg?` + `bestWeekLabel?`.
- **New internal state inside `<WeeklyVolumeStrip>`** (parent):
  - `scrollRef: useRef<ScrollView>(null)` for imperative `scrollTo` + `scrollToEnd`.
  - `selectorOpen: useState<boolean>(false)` for the modal.
  - `pillRef: useRef<VisibleRangePillHandle>(null)` — passed into `<WeekSelector pillRef={pillRef}>`.
  - **No `visibleStartKey/visibleEndKey` state at this level.** The `onScroll` handler computes the label string from `contentOffset.x` and calls `pillRef.current?.setRange(label)` — does NOT call any `setState` on the parent. This bypasses reconciliation of the 260-bar array on every scroll frame.
  - `isPinnedRightRef: useRef<boolean>(true)` — updated in `onScroll` (sets `true` when the right edge is within `COLUMN_WIDTH * 1.5` pixels); used by the rollover effect.
- **New scoped state inside `<VisibleRangePill>`** (child):
  - `label: useState<string>(initialLabel)` — the ONLY state that re-renders on scroll. `useImperativeHandle(ref, () => ({ setRange: (s) => setLabel(s) }))` exposes the setter to the parent.
- **Week rollover effect** (in strip parent):
  ```ts
  const prevCount = useRef(buckets.length);
  useEffect(() => {
    if (buckets.length > prevCount.current && isPinnedRightRef.current) {
      scrollRef.current?.scrollToEnd({ animated: false });
    }
    prevCount.current = buckets.length;
  }, [buckets.length]);
  ```
  Fires when a new week's bucket appears (e.g. user crossed Monday midnight with the app open). Only re-pins if the user was already at the right edge — preserves manual scroll position otherwise.
- **Layout constants** (unchanged from v1):
  - `BAR_WIDTH = 40`, `BAR_GAP = 6`, `COLUMN_WIDTH = 46`.
- **Visible-range label format**:
  - Single year: `"MMM d – MMM d, yyyy"` (e.g. `"Apr 27 – Jun 21, 2026"`).
  - Cross-year: `"MMM d, yyyy – MMM d, yyyy"` (e.g. `"Dec 29, 2025 – Jan 11, 2026"`).
  - Implementation: compare `visibleStart.getFullYear() === visibleEnd.getFullYear()`.
- Year markers, tap-to-drill-down URL, accessibility labels — unchanged from v1.

## Riscos `[changed-v2]`

- **Data integrity** `[v1-carryover]`: No schema/RLS/migration changes. `listWeeklyVolumeRows` lifetime branch already proven against null-`completed_at` defence. **NEW**: the `sinceUtc` branch is preserved (dead-but-harmless in production, still exercised by test #43). Cost: ~20 lines of unused code.

- **UX regressions** `[v1-carryover]`: Bar widths change `flex-1` (~39pt) → fixed 40pt — visually identical. Pull-to-refresh, tap-to-drill-down preserved. "Outside visible range" empty-state on the drill-down disappears (acceptable per Discovery #2). Cross-year accessibility-label change ("View week of 5/12/2025") survives existing tests (they target current-year cases only).

- **Platform-specific** `[v1-carryover]`: iOS/Android nested horizontal ScrollView inside vertical FlatList header — works via dominant-axis gesture resolution. Web mouse-wheel-without-shift scrolls vertically by default; selector is the primary jump mechanism. **NEW**: bottom-sheet modal uses `animationType="slide"` on web — RN `<Modal>` slides the inner card up via translateY in `react-native-web`. Confirmed cross-platform via `<SetRowMenu>` precedent (three production call sites).

- **Performance** `[changed-v2]`:
  - **Scoped-state scroll updates**: with `<VisibleRangePill>` holding the label state and the strip parent unaware of scroll position, `onScroll` triggers a single small re-render (just the `<Text>` inside the pill), not a 260-`<Pressable>` reconciliation. Even if `onScroll` fires at 60fps, only ~1 node per frame walks React's diffing. Empirical RN benchmarks: <0.5ms per frame on iPhone 12+.
  - Bucketing `bucketLifetimeWeeklyVolumes(rows)` memoized in `useLifetimeBestWeek` — strip memoizes `computeStripModel(rows)` against `q.data` reference.
  - Overlay Y stays constant during scroll — does NOT re-render.
  - **NEW**: cold-start trigger >5s for the lifetime fetch falls back to **Option B Postgres aggregate** (inherited from `2026-05-22_0030_progress-page` design-v3 §"BLK-3" follow-up). If a heavy user surfaces real lag on History first-visit, the deferred work is: add a `weekly_volumes_view` materialized view aggregating sets by (user_id, iso_week) and have `useLifetimeWeeklyVolume` read from it instead of paginating raw sets. Defer; instrument first.

## Alternativas descartadas `[v1-carryover]`

See design-v1.md §"Alternativas descartadas" — 6 alternatives unchanged.

## Out of scope `[v1-carryover]`

See design-v1.md §"Out of scope" — unchanged.

## Resposta a issues do Validator `[new-v2]`

- **[BLK-1]** — `tests/unit/progress-page-math.test.ts:807-813` (test #43) calls `listWeeklyVolumeRows({ sinceUtc: ... })`. **Fixed via option (a)**: `src/api/stats.ts` keeps the full signature `listWeeklyVolumeRows(opts?: { sinceUtc?: string }): Promise<WeeklyVolumeRow[]>` and both internal branches (lifetime + sinceUtc). All production callers switch to the no-arg form; the sinceUtc branch survives as test-only / future-windowed-reads code. Documented explicitly in §Contratos with an Implementer-facing comment ("Treat the sinceUtc branch as kept for test compatibility / future windowed reads — do NOT delete"). Test #43 (and adjacent #42/#44/#45) untouched.

- **[MAJ-1]** — `isoWeeksBetween` helper added to `src/utils/dates.ts`. Signature: `isoWeeksBetween(startMonday: Date, endMondayInclusive: Date): IsoWeek[]` returning contiguous oldest→newest array. `computeStripModel` now returns `null` when `data.length === 0` (preserves today's empty-state, which renders the zero-state row without bars). Unit test added to `tests/unit/dates.test.ts` ("isoWeeksBetween — single-week, 5-week range, year-boundary range") AND to `tests/unit/weekly-volume-bucketing.test.ts` ("5 weeks of data → 5 contiguous buckets oldest→newest").

- **[MAJ-2]** — Mockup redrawn to match the cited `<SetRowMenu>` bottom-sheet pattern. Citation stays at `src/components/set-row-menu.tsx:110-225`. Implementation contract spelled out in §"Selector modal":
  - `<Modal visible animationType="slide" transparent onRequestClose={onClose}>`
  - Outer backdrop: `<Pressable onPress={onClose} className="flex-1 justify-end bg-black/50">`
  - Inner blocker: `<Pressable onPress={() => {}} accessibilityRole="none">`
  - Card: `<View className="rounded-t-2xl bg-white px-6 pb-10 pt-6 dark:bg-gray-900">`
  - **No top-row `[X]` button.** Dismiss via backdrop tap or `[Jump]` confirmation.

- **[MAJ-3]** — Scoped state. Visible-range state moved into a child `<VisibleRangePill>` component owned by `<WeekSelector>`. Strip parent holds `pillRef: useRef<VisibleRangePillHandle>(null)` and calls `pillRef.current?.setRange(label)` from `onScroll`. The parent never `setState`s on scroll, so the 260-bar `<Pressable>` array does not reconcile during a flick. `useImperativeHandle` exposes only `setRange(label: string)`. Documented in §"UI props / state" with the exact handle shape.

- **[MIN-2]** — Cross-year visible-range label spec: `"MMM d, yyyy – MMM d, yyyy"` when `visibleStart.getFullYear() !== visibleEnd.getFullYear()`; `"MMM d – MMM d, yyyy"` otherwise. Spelled out in §"UI props / state".

- **[MIN-4]** — Cold-start trigger added to §Riscos > Performance: ">5s lifetime fetch falls back to Option B Postgres aggregate (materialized weekly_volumes view), inherited from the `2026-05-22_0030_progress-page` follow-up. Defer; instrument first."

- **[MIN-5]** — Week-rollover `useEffect` added. Listens on `buckets.length`; if length increased AND `isPinnedRightRef.current === true` (user was within `COLUMN_WIDTH * 1.5` of the right edge), calls `scrollRef.current?.scrollToEnd({ animated: false })`. Code snippet in §"UI props / state".

- **[MIN-6]** — Zero-session month behaviour confirmed in §"Mudanças por arquivo" test row (`tests/e2e/chart-scroll-week-selector.spec.ts` case (f)) and here: jumping to a zero-session month scrolls to gray-stub bars (using `MIN_BAR_HEIGHT = 4pt` floor) with no special empty-state copy.

- **[MIN-1]** — Subsumed by MAJ-1 fix (`computeStripModel` returns `null` on `data.length === 0`).

- **[MIN-3]** — Accepted as known cosmetic debt (History's `refetchWeekly` becomes redundant after the swap because TanStack dedupes the lifetime query — leave as-is; no behavioural impact).

- **[MIN-7]** — Accepted as known debt. `weekKeyToMondayLabel` vs `isoWeekContaining` partial overlap is real; cleanup deferred to a future utils-consolidation run.
