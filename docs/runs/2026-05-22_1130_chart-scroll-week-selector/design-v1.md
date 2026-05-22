# Design v1 — 2026-05-22_1130_chart-scroll-week-selector

## Goal (1 sentence)

Make the shared `<WeeklyVolumeStrip>` horizontally scrollable across the user's entire ISO-week history, add a tappable header that opens a hand-rolled month/year picker to jump the strip to any past week, and keep the lifetime-best dotted overlay anchored at the lifetime max regardless of scroll.

## Approach

Consolidate around the lifetime dataset. Both consumers (`history/index.tsx`, `progress/index.tsx`) and the drill-down screen (`history/week/[isoWeek].tsx`) move off the 8-week `useWeeklyVolume` hook onto `useLifetimeWeeklyVolume`, which lets us delete `useWeeklyVolume` + the `sinceUtc` branch of `listWeeklyVolumeRows` and remove the now-dead "outside the 8-week window" guard on the drill-down screen. Bars switch from `flex-1` columns inside an 8-cell row to fixed-pixel columns (40pt + 6pt gap) inside a native `<ScrollView horizontal>`, with `contentOffset.x` pinned to the rightmost edge on mount so the user lands on the current week with ~7 weeks of context to its left, matching today's visible window. The lifetime-best dotted overlay lives INSIDE the scroller and spans the full content width at the lifetime-max Y — bars scale against `Math.max(model.maxKg, bestWeekKg ?? 0)` (lifetime max), so the line is always anchored at the same Y across every bar and "you're behind your best" stays visually true while scrolling. A new `<WeekSelector>` renders a tappable header pill showing the currently-visible week range (e.g. "Apr 27 – Jun 21, 2026") computed from the scroll offset; tapping opens a `<Modal>` with a hand-rolled month-and-year grid that mirrors the `<SetRowMenu>` bottom-sheet pattern (no new dependency). Choosing a month+year scrolls the strip imperatively (`scrollTo({ x, animated: true })`) so the first week of that month sits in the leftmost visible slot, no URL change, no navigation. Bar taps still navigate to `/(app)/history/week/<YYYY-MM-DD>` as before. Plain `<ScrollView horizontal>` is fine for the 5-year worst case (~260 bars × 46pt = ~12k pt of content, ~260 `<Pressable>` nodes) — virtualization with `FlashList` is reserved as a follow-up if a heavy user surfaces real lag.

## Mudanças por arquivo

| File | Type | Change |
|---|---|---|
| `src/components/weekly-volume-strip.tsx` | edited | Replace fixed 8-bar layout with horizontal `<ScrollView>` of fixed-width bars driven by `useLifetimeWeeklyVolume()`. Add `WeekSelector` header. Switch bar denominator to lifetime max. Move overlay inside the scroller, spanning full content width. Add scroll-to-end on mount via `contentOffset`. Add `scrollToWeekKey()` imperative ref handle used by the selector. Add year markers at January-W1 transitions. |
| `src/components/week-selector.tsx` | new | Tappable header pill + `<Modal>` with hand-rolled month/year picker. Props: `visibleRangeLabel: string`, `availableYears: number[]`, `onJumpTo(year, month): void`. No new deps. |
| `src/hooks/use-stats.ts` | edited | Delete `useWeeklyVolume` export (8-week hook). Keep `useLifetimeWeeklyVolume` (unchanged). |
| `src/api/stats.ts` | edited | Drop the `sinceUtc` branch of `listWeeklyVolumeRows`. The lifetime branch becomes the only path; signature simplifies to `listWeeklyVolumeRows(): Promise<WeeklyVolumeRow[]>`. |
| `app/(app)/history/index.tsx` | edited | Replace `useWeeklyVolume()` import with `useLifetimeWeeklyVolume()` for the pull-to-refresh `refetchWeekly` reference. The strip itself sources data internally — no prop change. |
| `app/(app)/progress/index.tsx` | edited | No data-fetch changes (already uses lifetime via `useLifetimeBestWeek`). Just verify that `bestWeekKg`/`bestWeekLabel` props still flow correctly to the new scrollable strip. |
| `app/(app)/history/week/[isoWeek].tsx` | edited | Replace `useWeeklyVolume()` with `useLifetimeWeeklyVolume()`. Delete `isInWindow` guard + BRANCH 2 (`!isInWindow`) outside-range copy at `:74-78,128-138`. Headline volume reduction at `:91-102` works unchanged against lifetime rows (same filter-by-`targetKey` shape). |
| `src/utils/dates.ts` | edited | Add `isoWeekContaining(d: Date): IsoWeek` (Monday/Sunday/key/label of the week containing `d`) — used by the selector to translate "first of month" → ISO-week. Reuses existing `WEEK_OPTS` + `startOfWeek`/`endOfWeek`/`format`. No new deps. |
| `tests/e2e/weekly-volume-strip.spec.ts` | edited | Locator updates: bar pressable lookup unchanged (still `View week of M/d`); add 1 case for scroll-to-end-on-mount (current week visible at right edge); add 1 case for week-selector flow (open modal, pick month/year, assert the chosen week is now visible). |
| `tests/e2e/week-drill-down.spec.ts` | edited | Repurpose the "out-of-window" case (`:319-361`): now that lifetime data covers any past week, the test deep-links to a 12-weeks-ago Monday and asserts the headline renders the correct volume + sessions list (no more "outside the visible range" copy). The "invalid date" and "back navigation" cases stay as-is. |
| `tests/e2e/chart-scroll-week-selector.spec.ts` | new | New file: seeds a user with ≥16 weeks of activity, asserts (a) scroll-to-end default on mount, (b) older bars are reachable via horizontal scroll, (c) selector header shows the visible range, (d) jumping via the selector scrolls to the chosen week, (e) lifetime-best overlay's Y stays put while scrolling. |
| `tests/unit/dates.test.ts` | edited | Add cases for `isoWeekContaining` (regular Monday, mid-week, ISO-week-1-of-year crossing). |
| `tests/unit/weekly-volume-bucketing.test.ts` | edited | Drop the "exactly 8 buckets" assertion in favour of "all weeks between `firstSetMonday` and `currentMonday`". Update tests that hardcoded `WEEKS_WINDOW = 8`. Existing volume-kernel cases stay. |

## Page composition

### Default mount (current week visible at the right edge)

```
┌─────────────────────────────────────────────────────────┐
│ THIS WEEK                                               │
│ 2,500 kg                                                │
│                                                         │
│ ┌────────────────────────────────────────[ ⌄ Apr 27 ─ Jun 21, 2026 ]┐
│ │ ░ ░ ░ ▒▒ ▒▒▒ ▒▒ ▓▓ ████  ← scroll → most-recent week│
│ │ ╴ ╴ ╴ ╴╴╴ ╴╴╴ ╴ ╴ ╴ ╴ ╴ ╴ ╴ ╴ ╴ ╴ ╴ ╴ ╴ ╴ ╴ best  │
│ │ 4/27  5/4  5/11 5/18 5/25 6/1 6/8 6/15 6/21       │
│ └────────────────────────────────────────────────────┘
│ Best week: 26,210 kg (5/13)                            │
└─────────────────────────────────────────────────────────┘
                                       ▲
                       contentOffset.x = (contentWidth - viewportWidth)
```

Right edge = current week (blue bar), 8 weeks of context to its left. The dotted line is the lifetime-best Y — stays at the same Y across the full content width.

### Scrolled back (~6 months earlier)

```
┌─────────────────────────────────────────────────────────┐
│ THIS WEEK                                               │
│ 2,500 kg                                                │
│                                                         │
│ ┌──────────────────────────────────[ ⌄ Nov 4 ─ Dec 30, 2025 ]──┐
│ │ ░ ████ ████ ░ ▒▒ ▒▒▒ ▒▒ ▒▒  ← all gray (past) bars   │
│ │ ╴ ╴ ╴ ╴╴╴ ╴╴╴ ╴ ╴ ╴ ╴ ╴ ╴ ╴ ╴ ╴ ╴ ╴ ╴ ╴ ╴ ╴ ╴ best │
│ │ │2026          11/4 11/11 11/18 11/25 12/2 12/9     │
│ └──────────────────────────────────────────────────────┘
│ Best week: 26,210 kg (5/13)                            │
└─────────────────────────────────────────────────────────┘
        ▲                            ▲
year-marker line (Jan 1 boundary)    selector pill now shows
appears between 2025 + 2026 bars     "Nov 4 – Dec 30, 2025"
```

### Selector modal (tapping the header pill)

```
┌─────────────────────────────────────────────────────────┐
│                          [ X ]                          │
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
```

Year row: chips for every year in `[firstSessionYear … currentYear]`. Month row: 12 chips fixed. Confirm with `[Jump]` (or auto-confirm on month tap — implementer call, mirroring `<SetRowMenu>` chip-tap semantics). Modal pattern matches `<SetRowMenu>` bottom-sheet (`set-row-menu.tsx:110-225`).

## Contratos de I/O

### Function signatures / types added or changed

```ts
// src/api/stats.ts — simplified to a single read mode.
export async function listWeeklyVolumeRows(): Promise<WeeklyVolumeRow[]>;
// (removed: `opts: { sinceUtc?: string }` parameter)

// src/hooks/use-stats.ts — `useWeeklyVolume` removed entirely.
// `useLifetimeWeeklyVolume` unchanged.
export function useLifetimeWeeklyVolume(): UseQueryResult<
  WeeklyVolumeRow[],
  Error
>;

// src/utils/dates.ts — new helper.
/**
 * Returns the ISO week containing `d`. Equivalent to building a single-entry
 * `lastNIsoWeeks(1, d)` result. Used by the week-selector to translate a
 * (year, month) pick into the bucket key it should scroll to.
 */
export function isoWeekContaining(d: Date): IsoWeek;

// src/components/weekly-volume-strip.tsx — internal shape changes only.
// Public props identical to today:
type Props = {
  bestWeekKg?: number;
  bestWeekLabel?: string;
};

// New internal model — buckets are now dynamic-length, not fixed 8.
type StripModel = {
  buckets: Bucket[];          // length = N (lifetime weeks), oldest→newest
  maxKg: number;              // lifetime max across ALL buckets
  currentWeekKg: number;      // last bucket's totalKg
  firstSessionMonday: Date;   // earliest Monday in `buckets` — used by selector
};

// src/components/week-selector.tsx — new component.
type WeekSelectorProps = {
  /** Visible-range label, e.g. "Apr 27 – Jun 21, 2026". */
  visibleRangeLabel: string;
  /** Years to render in the year row, ascending. */
  availableYears: number[];
  /** Earliest (year, monthIndex0) the user has data for; older picks are dimmed. */
  firstAvailable: { year: number; month: number };
  /** Latest (year, monthIndex0) the user has data for (clamps future picks). */
  lastAvailable: { year: number; month: number };
  /** Called when the user confirms a (year, month) pick. */
  onJumpTo: (year: number, month: number) => void;
};
```

### DB columns / queries

No DB changes. Lifetime read continues to use the existing `listWeeklyVolumeRows` lifetime path, which already applies:

- `.is("deleted_at", null)`
- `.not("completed_at", "is", null)`
- `.not("sessions.ended_at", "is", null)`
- `.neq("set_type", "warmup")`
- `.range(from, from + 999)` paginated
- `.order("completed_at", { ascending: true })`

RLS unchanged — `auth.uid() = user_id` on `sets` and `sessions` per `supabase/migrations/0001_rls_and_seed.sql`. No new policies needed.

### UI props / state

- `<WeeklyVolumeStrip>` public props unchanged — still `bestWeekKg?` + `bestWeekLabel?`. History keeps passing nothing (no overlay); Progress keeps passing both.
- New internal state inside `<WeeklyVolumeStrip>`:
  - `scrollRef: useRef<ScrollView>(null)` for imperative `scrollTo`.
  - `selectorOpen: useState<boolean>(false)` for the modal.
  - `visibleStartKey, visibleEndKey: useState<string>` updated in an `onScroll` throttled handler that maps `contentOffset.x` → first/last visible bucket index → bucket keys. Drives the selector pill label.
- New per-bar layout constants:
  - `BAR_WIDTH = 40`
  - `BAR_GAP = 6`
  - `COLUMN_WIDTH = BAR_WIDTH + BAR_GAP` — used both for `style={{ width: BAR_WIDTH }}` on each `<Pressable>` and for content-width math (`columnWidth × bucketCount - BAR_GAP`) needed to compute `contentOffset.x` for the rightmost-edge mount.
- Year-marker rendering: when the previous bucket's Monday's year differs from the current bucket's Monday's year, render a faint vertical stripe (`border-l border-gray-200 dark:border-gray-800`) at the column's left edge AND a tiny `<Text>` above the column ("2026") at the same x-offset. Implementation: detect the year change inside `buckets.map((b, idx) => ...)` by comparing `b.start.getFullYear()` against `buckets[idx - 1]?.start.getFullYear()`.
- Tap-to-drill-down URL unchanged: `router.push("/(app)/history/week/" + format(b.start, "yyyy-MM-dd"))`.
- Accessibility label: include the year for past-year bars (`View week of 5/12/2025`) but keep `View week of 5/12` for current-year bars. Resolves Discovery Unknown #11 + #12 (cross-year M/d ambiguity in DOM/tests).

## Riscos

- **Data integrity**:
  - No schema / migration changes. RLS untouched.
  - `listWeeklyVolumeRows` lifetime branch already proven against the `completed_at = null` defence (BLK-3 from `2026-05-22_0030_progress-page`); we keep both server filter + runtime assert.
  - **Risk**: deleting the `sinceUtc` branch removes a code path that's never called after this run, but the e2e test suite still references it implicitly via `useWeeklyVolume()` mocks. Mitigation: the test plan below explicitly drops every test that asserts on the 8-week window (e.g. "out-of-window" copy).
  - **Risk**: heavy user (5+ years, ≥10k sets) makes one extra paginated lifetime fetch on History first-visit (previously 1 single-shot 8-week query). Mitigation: shared `["stats", "weekly-volume", "lifetime"]` cache key — if the user has already visited Progress this session, the History strip hits cache. `staleTime: 60_000` matches the existing window hook. Conservative ceiling: 32 paginated round-trips for a 5-year heavy user.

- **UX regressions**:
  - Bar widths change from `flex-1` (~39pt on 390pt iPhone) to fixed 40pt. Visually nearly identical at default zoom; tested via Playwright screenshot diff in the existing e2e suite.
  - History pull-to-refresh: the existing `await Promise.all([refetch(), refetchWeekly()])` keeps working — we swap `refetchWeekly` to come from `useLifetimeWeeklyVolume()`. The user-facing refresh behaviour is unchanged (slightly larger payload, still single round-trip from the user's perspective).
  - Tap-to-drill-down preserved verbatim (URL contract + accessibility label format for current year).
  - "Outside visible range" empty-state on `history/week/[isoWeek].tsx` disappears. Acceptable per Discovery #2 — under lifetime data the guard is always false. Users who deep-linked to old weeks previously saw a dead-end; now they land on real data.
  - **Risk**: cross-year accessibility-label format change ("View week of 5/12/2025" vs "View week of 5/12"). Existing tests assert against `View week of 5/12` only — they target current-year cases, so they survive. Flagging for the Validator.

- **Platform-specific**:
  - **iOS / Android**: nested horizontal `<ScrollView>` inside the History page's vertical `<FlatList>` works via dominant-axis gesture resolution. Existing precedent: `<SetRowMenu>` horizontal RPE strip inside a bottom-sheet modal works fine on both platforms.
  - **Web**: `<ScrollView horizontal>` on `react-native-web` becomes `<div style="overflow-x: auto">`. Mouse-wheel-without-shift scrolls the page vertically by default — users need shift+wheel or trackpad two-finger swipe to pan horizontally. Flagged as web-only UX note; we do not add a CSS hack. The `<WeekSelector>` is the primary jump mechanism so wheel UX is a secondary path.
  - **Web `<Modal>`**: works via RN `<Modal transparent>` — three existing call sites confirm cross-platform.
  - **Web year-marker text**: `<Text>` absolutely positioned over the column edge needs `position: absolute` on web — `style={{ position: "absolute", left: COLUMN_WIDTH * idx, top: -14 }}` works uniformly via NativeWind passthrough.
  - **iOS scroll bounce**: `<ScrollView>` defaults to bouncing on iOS. Acceptable; matches the rest of the app.

- **Performance**:
  - Worst case (5-year user, ~260 bars): ~260 `<Pressable>` + `<View>` + `<Text>` nodes mounted simultaneously. Empirical RN benchmarks place this at <20ms initial mount on iPhone 12+. No virtualization needed for v1.
  - Bucketing: `bucketLifetimeWeeklyVolumes(rows)` already memoized in `useLifetimeBestWeek`. The strip will memoize its `computeStripModel(rows)` against `q.data` reference. Recomputation happens only on cache invalidation (post-finish-session), not on scroll.
  - Scroll handler: `onScroll` throttled to 16ms (single `setVisibleRange` `useState` set per frame). Mapping `contentOffset.x → bucket index` is O(1) using fixed `COLUMN_WIDTH`. No layout thrash.
  - Overlay re-render on scroll: overlay's Y is computed from `bestWeekKg / lifetimeMax × PLOT_HEIGHT` — independent of scroll position — so it does NOT re-render on scroll. Only the selector pill label re-renders, and only when the visible bucket index changes (typically once every several frames during a swipe).
  - Year-marker rendering: O(N) one-time during render; no additional cost on scroll.

## Alternativas descartadas

1. **`<FlatList horizontal>` with `getItemLayout` for virtualization** — descartada porque the 5-year worst case (~260 bars) fits comfortably in `<ScrollView>` and `FlatList`'s windowing adds complexity (mount/unmount logic, ref-based scroll-to-end, less control over the overlay positioning). Reserved as a follow-up if a 10+ year user surfaces real lag.

2. **`@react-native-community/datetimepicker` for the week selector** — descartada porque it's a new dependency, its web fallback is `<input type="date">` (not a custom popup, so UX diverges between native + web), and the codebase has zero existing date-picker call sites — adopting one for a single screen is overkill. Hand-rolling a month/year grid in a `<Modal>` (mirrors `<SetRowMenu>`) covers the use case with zero new deps and zero platform divergence.

3. **Inline quick-jump buttons (`[1m] [3m] [6m] [1y] [all]`) instead of a modal selector** — descartada porque users with ≥1y of history want to jump to specific months (e.g. "what was I doing last September?"), not just relative offsets. Quick-jump buttons are great for coarse-grained "scroll back N months" affordances but don't satisfy the prompt's "week selector" intent. Could be added later as a complement to the modal selector.

4. **Lifetime overlay positioned OUTSIDE the scroller (HUD-style, fixed-screen position)** — descartada porque the prompt frames the overlay as "the lifetime max" — putting it inside the scroller (full-content-width line) creates the mental model that EVERY week's bar can be visually compared to the same horizontal ceiling. A HUD-style fixed overlay floats above the visible viewport and feels disconnected from the bars beneath when scrolling. The math is identical; positioning is the only difference. Inside-scroller wins on metaphor.

5. **Keep `useWeeklyVolume` (8-week hook) for the drill-down screen only** — descartada porque the drill-down's `isInWindow` guard exists ONLY because the cache was 8-week-bound. Switching the drill-down to lifetime data makes the guard incorrect (every historical week IS in cache) and removes a dead branch. Net code savings: ~25 lines + one TanStack cache key + one e2e test case. Keeping the hook just for one screen preserves the dead code with no upside.

6. **Server-side weekly-volume aggregate (Postgres RPC returning one row per ISO week)** — descartada porque it's a separate design (Postgres function, RLS implications, migration) and the current client-side bucketing kernel is already <50ms for the 5-year heavy user. The prompt scopes scrolling + selector, not server-side optimization. Deferred to a future run if payload size becomes a real problem.

## Out of scope

- Bodyweight / measurements chart scrolling (different chart primitive; per Discovery #16 / `2026-05-20_0334` #8).
- PR markers / session annotations on bars (visual complexity orthogonal to scroll + selector; deferred).
- Pinch-to-zoom on the chart (pan only per prompt).
- Sticky year/month label as a header that morphs while scrolling (sweet but adds layout complexity; the year-marker stripes + selector pill cover the year-disambiguation need).
- Mini-map / overview-detail dual-axis layout.
- Scroll-position persistence across navigations (Discovery #9 — reset to "now" on remount; persistence is surprising).
- Replacing `<View>`-based bars with `<Svg>` (`react-native-svg` already installed but tap-target simplicity wins; no gradient need).
- Server-side weekly-volume aggregate / Postgres RPC (Alternative #6).
- `FlashList` virtualization (Alternative #1 — kept as v2 if needed).
- Quick-jump relative buttons (Alternative #3 — could complement modal later).
- Updating `docs/features.md` for the new strip behaviour (Conductor post-merge job).

## Resposta a issues do Validator

N/A — this is design-v1.
