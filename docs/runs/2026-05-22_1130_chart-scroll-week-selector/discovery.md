# Discovery — 2026-05-22_1130_chart-scroll-week-selector

## Feature prompt

> Weekly chart horizontal scrolling + week selector. Today the weekly-volume strips (History mini + Progress full) show a fixed 8-week window.
>
> - Both strips become horizontally scrollable to navigate through the user's full ISO-week history.
> - Add a week selector (likely a "jump to date" affordance — tappable header showing the current window, opens a date picker). Designer call on exact UI.
> - Lifetime-best overlay on the Progress chart stays anchored to the lifetime max (doesn't change as you scroll). The "you're behind your lifetime best" visual signal must stay correct under scrolling.
> - ISO-week boundary semantics unchanged (Monday-Sunday, BRT).

Today (BRT): 2026-05-22.

## Scope summary

Convert the existing single component `<WeeklyVolumeStrip>` (currently a fixed 8-bar row rendered identically on the History tab list-header and on the Progress page) into a horizontally scrollable bar chart that pans the user's entire ISO-week history, and add a header-mounted "jump to week" affordance. The lifetime-best dotted overlay (Progress page only — History does not pass `bestWeekKg`) must remain anchored at the lifetime max while bars scroll. No DB / RLS / schema changes. The work touches one shared component, two screens that consume it, the strip's data hook, and at least one new helper for week-by-week pagination math. All ISO-week semantics (Monday-Sunday, device-local time via `weekStartsOn: 1`) stay locked per `src/utils/dates.ts:14-15,29` and run `2026-05-19_2144_weekly-volume-stat` decision #1.

## Affected files (verified)

### Will change

- `src/components/weekly-volume-strip.tsx:1-194` — entire component. Today it pulls `useWeeklyVolume()` (8-week window) internally, computes a fixed `WEEKS_WINDOW = 8` bar model (`:27,39-65`), and renders a flat `flex-row` of 8 `<Pressable>` columns with an absolute-positioned overlay sibling (`:141-185`). For scrolling, the data source must change (lifetime vs window — see "Unknowns" #1), the bar count becomes dynamic, the overlay positioning needs new layout, and a horizontal scroller wraps the bar row. The headline ("This week: …") and the best-week footer label (`:187-191`) sit OUTSIDE the scroller and need to stay sticky.
- `app/(app)/history/index.tsx:48` — passes `<WeeklyVolumeStrip />` with no `bestWeekKg` (History never shows the overlay today). Either stays identical (if no overlay on History) or starts passing the lifetime-best (Designer call — Unknown #4). May also need to start owning the week-selector state if Designer routes the selector through the parent (Unknown #6).
- `app/(app)/progress/index.tsx:49-52` — passes `<WeeklyVolumeStrip bestWeekKg={…} bestWeekLabel={…} />`. Today `bestWeek` comes from `useLifetimeBestWeek()` (which reuses `useLifetimeWeeklyVolume()` — `src/hooks/use-progress-page.ts:33-44`). The Progress page already has the lifetime dataset in cache; no new fetch needed for the Progress consumer.
- `src/hooks/use-stats.ts:16-48` — currently exports `useWeeklyVolume` (8-week, sinceUtc-bound) AND `useLifetimeWeeklyVolume` (paginated lifetime, no upper bound). The scrollable strip needs the lifetime dataset. Two paths (Designer call, Unknown #2): (a) the strip switches to `useLifetimeWeeklyVolume()` on BOTH consumers — History pays a one-time cost of paginating all sets; the cost is bounded by ~260 sets-per-week × 5 years ≈ 65k rows / 1000 page size = ≤65 round-trips (worst case for a heavy 5-yr user; typical user ≪ 65). (b) Add a third hook (e.g. `useWindowedWeeklyVolume({ startKey, endKey })`) that pages on demand. (a) is simpler and reuses cache already populated on the Progress page; (b) is more efficient but adds query-key invalidation surface area.
- `src/utils/dates.ts:54-68` — `lastNIsoWeeks(n, now)` is the only producer of `IsoWeek[]`. The scrollable strip needs (i) a helper to compute all ISO weeks between two anchor weeks (e.g. `isoWeeksBetween(start, end)`), AND/OR (ii) a helper that maps any `Date` → the `IsoWeek` containing it (so "jump to 2025-09-14" lands on the right bucket). Neither exists today. Designer will likely add a small helper here; the existing `isoWeekStart`/`weekKeyOf` already provide the primitives.

### New files expected

- *(Optional)* `src/components/week-selector.tsx` (new) — the "jump to week" affordance. Could be: a tappable header pill that opens a `<Modal>` with a date picker / quick-jump buttons / month grid (Unknown #6). The repo has zero existing date-picker dependencies (verified — see "Constraints / Date picker").
- *(Optional)* `src/utils/iso-weeks.ts` or extension to `src/utils/dates.ts` — `isoWeeksBetween(startMonday: Date, endMonday: Date): IsoWeek[]` and `isoWeekContaining(d: Date): IsoWeek`. Both small pure helpers. Implementer placement call.
- Tests:
  - `tests/unit/dates.test.ts` — extend with cases for the new range / contains helpers if added.
  - `tests/unit/weekly-volume-bucketing.test.ts` — extend coverage for the dynamic-bucket case (no longer fixed 8).
  - `tests/e2e/weekly-volume-strip.spec.ts` — extend to cover scroll + jump-to-week. Likely new file `tests/e2e/chart-scroll-week-selector.spec.ts` for new behaviour; the existing 4 cases should remain valid with cosmetic locator updates.

### Read-only references / precedents

- `src/components/weekly-volume-strip.tsx:27` — `WEEKS_WINDOW = 8` constant; `PLOT_HEIGHT = 96`, `MIN_BAR_HEIGHT = 4`. Bars are `flex-1` inside a `gap-1.5` row inside `px-4` padding (`:141`), so each bar widths is ~(screenWidth − 32 − 7×6) / 8 ≈ 39pt on a 390pt iPhone. Under scrolling, bar width becomes a fixed pixel value (not `flex-1`) so the total content width = `barCount × (barWidth + gap)`.
- `src/components/weekly-volume-strip.tsx:160-173` — each column is a `<Pressable accessibilityRole="button" accessibilityLabel="View week of …" onPress={() => router.push("/(app)/history/week/<segment>")}` `className="flex-1 active:opacity-70"`. The `segment` is `format(b.start, "yyyy-MM-dd")`. Tap-to-drill-down must survive scrolling — confirmed structurally compatible (RN `<ScrollView>` does not absorb child taps).
- `src/components/weekly-volume-strip.tsx:122-127,176-184` — lifetime-best overlay math. Today: `overlayY = PLOT_HEIGHT - round((bestWeekKg / denom) × PLOT_HEIGHT)` where `denom = max(model.maxKg, bestWeekKg)`. Rendered as a single absolutely-positioned `<View>` over the bar row. With scrolling, two design questions: (i) which axis the overlay lives on (sticky-Y inside the scroller, OR outside the scroller positioned over the visible viewport), and (ii) what denominator scales bar heights (visible-window max vs lifetime max — Unknown #3).
- `src/components/set-row-menu.tsx:145-149` — **only existing horizontal `<ScrollView>` precedent in the codebase**. `<ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2 pb-1">`. No `snapToInterval`, no `pagingEnabled`, no `decelerationRate` tweak — plain scroll with `gap-2`. RPE chips, single screen-width worth of content.
- `src/components/progress-chart.tsx:1-138` — existing SVG line chart (`react-native-svg`). Not directly reusable for bar scrolling (it computes a single full-viewport polyline), but proves `react-native-svg` is already a dependency (`package.json:57`) for any team that wants to switch from `<View>` bars to `<Rect>` (advantage: gradient fills, exact pixel control; disadvantage: more complex tap handling — would need `<Pressable>` overlays per bar).
- `src/api/stats.ts:1-96` — `listWeeklyVolumeRows({ sinceUtc?: string })`. Both branches present today: sinceUtc-bound (single-shot) and lifetime (paginated). The lifetime branch was added in run `2026-05-22_0030_progress-page` (BLK-3) and already handles null-`completed_at` filtering and ≥1000-row pagination via `.range(from, from + PAGE - 1)`. Documented in `docs/runs/2026-05-22_0030_progress-page/design-v3.md:256-307`. Reusable as-is for the scrollable strip.
- `src/hooks/use-stats.ts:39-48` — `useLifetimeWeeklyVolume()` cache key is `["stats", "weekly-volume", "lifetime"]`, `staleTime: 60_000`. Invalidations from `["stats"]` already cascade (run progress-page BLK-1). Reusing this hook for the strip means History page picks up the cascade automatically.
- `src/hooks/use-progress-page.ts:33-44` — `useLifetimeBestWeek()` memoizes `findBestWeek(bucketLifetimeWeeklyVolumes(rows))`. Cheap. Re-computing on every render of the scrolling strip is fine.
- `src/utils/progress-page-math.ts:30-117` — `bucketLifetimeWeeklyVolumes`, `findBestWeek`, `weekKeyToMondayLabel`. The first two are reusable kernels for the scrolling strip; `weekKeyToMondayLabel` is internal but its forward-derivation logic (Jan-4-of-ISO-week-year → Monday + (week-1)×7 days) is the inverse helper if any reverse lookup from a key is needed.
- `app/(app)/history/week/[isoWeek].tsx:74-78` — `useWeeklyVolume()` cache check (the 8-week window). With the strip moving to lifetime data, the per-week detail screen's "outside the cached 8-week window" branch (`:128-138`) becomes obsolete (the cache will always contain the user's lifetime). Either widen `isInWindow` to "any historical week" or remove the check entirely. **Important** — the detail screen still reads `useWeeklyVolume()` (line 56), so it'd need to switch to `useLifetimeWeeklyVolume()` too, OR keep both (`useWeeklyVolume` for current-window perf + `useLifetimeWeeklyVolume` for out-of-window lookups). Designer should confirm scope. Verified: when both consumers use lifetime, the 8-week cache key (`["stats", "weekly-volume", sinceUtc.slice(0,10)]`) becomes orphaned — clean it up or it becomes dead code.
- `tests/e2e/weekly-volume-strip.spec.ts:151-349` — 4 cases (golden / empty / warmup-only / refetch). All four use `page.getByText("This week", { exact: true })` and `page.getByText("2,500 kg", { exact: true })`. These remain stable since the headline + label sit OUTSIDE the scroller. New tests needed for: (a) scroll-into-view of older bars, (b) jump-to-week, (c) lifetime-best overlay correctness with off-screen best week.
- `tests/e2e/week-drill-down.spec.ts:159-438` — 5 cases (golden / empty / out-of-window / invalid / back). The "out-of-window" test (`:319-361`) deep-links to a week 12 weeks ago and asserts "outside the visible range" copy. With lifetime data, this test must EITHER be repurposed (e.g. "deep-link to a week before the user's first session") OR removed.
- `tests/e2e/progress-page.spec.ts:146-403` — 7 cases. None explicitly assert bar count or pan; the "populated" case (`:194-249`) only checks the presence of "This week", "Streak", "PRs this week" labels. Likely survives unchanged.
- `src/components/choose-action-modal.tsx:1-108` — existing cross-platform `<Modal>` precedent (iOS/Android/web). Pattern: backdrop `<Pressable>` + inner card `<Pressable>` blocking backdrop dismiss + `<Modal animationType="fade" transparent>`. Reusable scaffolding for the week-selector modal if Designer picks a modal-based selector.
- `src/components/plate-calculator.tsx:1-200` — second `<Modal>` precedent (`animationType="slide"`). Shows numeric input + scrollable list of plate sets.
- `src/components/exercise-picker.tsx:1-100` — third `<Modal>` precedent (search + filtered list). Sets the pattern for any "open a panel from a header" affordance.

## Relevant conventions (verified by reading code)

- **Single `<WeeklyVolumeStrip>` component, two consumers.** Confirmed: only one component file (`src/components/weekly-volume-strip.tsx`). Both History (`app/(app)/history/index.tsx:48`) and Progress (`app/(app)/progress/index.tsx:49-52`) import the same component. The prompt's framing of "History mini vs Progress full" is misleading — there is no "mini" variant. The same component renders at the same dimensions (PLOT_HEIGHT = 96, total height ≈ 150pt incl. headline + labels) in both places. The only behavioural difference is whether `bestWeekKg` / `bestWeekLabel` props are passed (Progress only). If the Designer wants different scroll affordances on History vs Progress, that's a new prop (e.g. `compactScroll?: boolean`) — but the current shared-component reality means "make both scrollable" is one diff, not two.
- **ISO-week semantics: device-local Monday-Sunday, `weekStartsOn: 1`.** Locked across the codebase (`src/utils/dates.ts:29`, every consumer of `lastNIsoWeeks`/`isoWeekStart`/`weekKeyOf`). The 23:30 BRT Sunday note (`:13-15`) means UTC-conversion would shift sets across week boundaries. Do not switch helpers to UTC variants. The prompt explicitly preserves this ("ISO-week boundary semantics unchanged").
- **Volume kernel.** Identical across the codebase: `const w = row.weight ? parseFloat(row.weight) : 0; const r = row.reps ?? 0; if (Number.isFinite(w) && w > 0 && r > 0) total += w * r;`. Verified at `weekly-volume-strip.tsx:46-50`, `progress-page-math.ts:36-40`, `history/[id].tsx:130-142`, `exercises/[id]/progress.tsx:73-82`. New helpers must reuse this kernel verbatim.
- **TanStack Query cache keys under `["stats"]`.** `useWeeklyVolume` uses `["stats", "weekly-volume", <date>]`, `useLifetimeWeeklyVolume` uses `["stats", "weekly-volume", "lifetime"]`. Existing invalidation cascades from `useFinishSession` / `useUpdateSessionTimes` / `useSoftDeleteSession` already invalidate `["stats"]` (per `progress-page` run BLK-1). Any new key MUST sit under the same prefix to inherit invalidation.
- **`staleTime: 60_000` for stats queries.** Both stats hooks use 60s stale time. Match this for any new query / refetch policy.
- **Tap-to-drill-down URL contract.** `router.push("/(app)/history/week/" + format(start, "yyyy-MM-dd"))`. The receiving screen uses `parseISO(isoWeek)` (`history/week/[isoWeek].tsx:63`). The same `YYYY-MM-DD` (Monday) segment is established. Any scroll behaviour must keep `format(b.start, "yyyy-MM-dd")` as the segment.
- **Accessibility label format.** `accessibilityLabel="View week of ${b.label}"` where `b.label` is `format(monday, "M/d")` (e.g. "5/12"). Tests assert against this exact label (`weekly-volume-strip.spec.ts:194-197`, `week-drill-down.spec.ts:206-208`). Across many years, two Mondays can share an `M/d` label (e.g. 5/12/2025 and 5/12/2026 both label "5/12") — under scrolling, this becomes ambiguous. Designer should consider including the year for older weeks (Unknown #11).
- **`<Pressable className="… active:opacity-70">`** is the established "tappable bar" feedback (`weekly-volume-strip.tsx:163`, set as the only precedent — confirmed by repo grep). Reuse.
- **No date-picker dependency.** Confirmed via `package.json:20-79` and grep across `src/` + `app/`: zero results for `datetimepicker`, `DateTimePicker`, `date-picker`, `DatePicker`. The closest existing date-input is `session-times-editor.tsx:140-191` — plain `<TextInput placeholder="YYYY-MM-DD" keyboardType="numeric" maxLength={10}>` with a soft mask (no native picker). Any week-selector that surfaces a calendar UI introduces either (a) a new dep (`@react-native-community/datetimepicker` is the canonical Expo-managed option, but is web-incomplete — falls back to native input on web), or (b) a hand-rolled grid (zero deps, more code).
- **Modal pattern.** RN `<Modal>` works on iOS, Android, web (verified via three call sites: `choose-action-modal.tsx`, `plate-calculator.tsx`, `exercise-picker.tsx`). Use `animationType="fade"|"slide"`, `transparent`, `onRequestClose`. Backdrop = outer `<Pressable className="flex-1 items-center justify-center bg-black/40 px-6">`; card = inner `<Pressable>` blocking backdrop dismiss.
- **Universal codebase.** Web + iOS + Android from one tree (`docs/architecture.md:80-81`). `<ScrollView horizontal>` works on all three. `FlatList horizontal` works on all three. Both are RN primitives — no platform forks needed.

## Constraints

- **Data**:
  - No schema changes. Tables touched (read-only): `sets`, `sessions` (already RLS-scoped to `auth.uid() = user_id`).
  - The lifetime read path (`listWeeklyVolumeRows({})`) already paginates and filters `.is("deleted_at", null) AND .not("completed_at", "is", null) AND .not("sessions.ended_at", "is", null) AND .neq("set_type", "warmup")`. Reusable as-is. See `src/api/stats.ts:73-96`.
  - For a heavy user (worst-case 5-year user training 4×/week × 30 sets = 120 sets/week = ~31,200 lifetime sets), the lifetime read is ≤32 paginated round-trips (PAGE=1000). On gym wifi that's a few seconds; with TanStack 60s stale-time it's a one-time cost per session, then cached. The Progress page already pays this cost.
  - **Cache key consolidation** — if the strip switches to lifetime data, History (currently using `useWeeklyVolume`) shares the same cache key as Progress. Net cache size DECREASES (one keyed dataset instead of two). The `useWeeklyVolume` 8-week hook can be removed entirely IF the per-week drill-down screen also moves to lifetime data, OR kept narrowly for the drill-down screen's tighter window (Unknown #5).

- **UI**:
  - NativeWind tokens locked across the codebase: `bg-white dark:bg-black`, `text-black dark:text-white`, `text-gray-500` muted, `border-gray-200 dark:border-gray-800` dividers, `px-4 py-5` strip padding, `text-xs uppercase tracking-wide text-gray-500` section headers, `bg-blue-500 dark:bg-blue-400` current-week bar, `bg-gray-300 dark:bg-gray-700` past-week bar, `bg-gray-200 dark:bg-gray-800` empty bar, `border-emerald-500 dark:border-emerald-400` lifetime-best overlay color. The scrolling redesign should reuse these tokens — Designer should not introduce a new palette.
  - PLOT_HEIGHT = 96pt is the established bar plot area. The total component height (incl. headline + labels) is ~150pt. The Progress page already adds a "best week" footer label (`weekly-volume-strip.tsx:187-191`), so total is ~170pt with overlay. Under scrolling, this height stays the same — only width changes.
  - Touch target: iOS HIG 44×44pt. Today's bars are ~39pt wide × variable height (4-96pt). The current implementation uses whole-column tap (column ≈ 39×120pt), which scrolls together with the bar. **Keep the whole-column-pressable convention.** Bar widths under scroll can be tuned independently of viewport (fixed pixel width, e.g. 40pt + 6pt gap).
  - The "jump to week" affordance must be reachable without scrolling. Options (Designer call, Unknown #6): tappable header showing the current visible range, fixed pin/button above the chart, or a small "jump to date" link below.

- **Platform**:
  - Universal (iOS / Android / web). All three support `<ScrollView horizontal>` and `<FlatList horizontal>`. `react-native-gesture-handler` and `react-native-reanimated` are already installed (`package.json:53-54,57`) — available if Designer wants snap-to-bar with momentum control, but **NOT required** for basic horizontal pan.
  - **Web scrolling**: on `react-native-web`, `<ScrollView horizontal>` renders as a `<div style="overflow-x: auto">`. Mouse-wheel-without-shift on a horizontal scroller scrolls vertically by default on most browsers — users who want to pan with mouse-wheel need either shift+scroll or a click-and-drag. Trackpad two-finger horizontal swipe works. No code change needed; flag as web UX note.
  - **iPhone scroll inside FlatList**: the History strip is the `ListHeaderComponent` of a vertical `FlatList` (`history/index.tsx:48`). Nesting a horizontal `<ScrollView>` inside a vertical `FlatList`'s header is supported by RN; the gesture handler resolves direction by dominant axis. No special handling needed.
  - **Date-picker library**: zero installed. Adding `@react-native-community/datetimepicker` is Expo-supported (`expo install @react-native-community/datetimepicker`), but its web fallback is `<input type="date">` (not a custom popup) — UX divergence between native and web. Alternative: hand-rolled month grid or quick-jump buttons (no new dep). See Unknown #6.

- **Auth**:
  - All reads go through Supabase JS client with the user's JWT. RLS scopes via `auth.uid() = user_id` (`supabase/migrations/0001_rls_and_seed.sql` — uniform across tables, per `docs/architecture.md:75`). No new auth context work.

- **Performance**:
  - Lifetime fetch already paid for Progress page users; History switching to the same hook reuses cache.
  - Rendering N bars: 5-year user ≈ 260 bars × ~40pt each = 10,400pt of content width. Plain `<ScrollView horizontal>` keeps all `<Pressable>` columns mounted — that's 260 React nodes, each with a `<Pressable>` + `<View>` + `<Text>`. On modern devices this is fine (≤1ms per row), but for users with 10+ years of history (~520+ weeks) `FlatList horizontal` with `getItemLayout` (constant bar width) saves memory by windowing. **Recommendation for Designer to discuss**: `<ScrollView horizontal>` (simpler, fine up to ~500 bars) vs `<FlatList horizontal>` (windowed, future-proof). Both work today.
  - Bucketing math (`bucketLifetimeWeeklyVolumes`) is O(setsCount). For 32k sets, that's ~32k Map ops on each query data change — negligible. Already memoized via `useMemo([q.data])` in `useLifetimeBestWeek`. New memoization needed at the strip level if heights become viewport-relative (need to recompute denom on scroll).
  - Default scroll position on mount: rightmost (most-recent week). On RN, both `<ScrollView ref.scrollToEnd({ animated: false })>` and `contentOffset={{ x: contentWidth - viewportWidth, y: 0 }}` work. The `contentOffset` prop avoids a flash-then-scroll on first paint; `scrollToEnd` runs after layout. **`contentOffset` recommended** but requires knowing total content width up front — easy here since `barWidth × bucketCount + (bucketCount - 1) × gap` is deterministic.

- **Routing / URL design**:
  - Tap-to-drill-down URL = `/(app)/history/week/<YYYY-MM-DD>` where `YYYY-MM-DD` = Monday of that ISO week. Established and tested (`week-drill-down.spec.ts`). Must be preserved.
  - The "jump to week" target — does it deep-link or just scroll? Two readings (Unknown #7): (a) scroll the strip to the selected week (no URL change); (b) navigate to `/(app)/history/week/<YYYY-MM-DD>`. Recommend (a) — pure scroll, doesn't navigate. (b) duplicates the existing tap-to-drill-down.

## Existing precedents

- **Lifetime-best overlay** (`weekly-volume-strip.tsx:122-127,176-184`) — already implemented. The overlay's `top` is computed against `PLOT_HEIGHT - (bestWeekKg / denom) × PLOT_HEIGHT`. Under scrolling, the math is the same but the overlay's parent positioning changes (must stay anchored to the visible viewport, not pan with the bars — or pan with bars but stay at the correct Y). Designer needs to pick: (a) absolute overlay OUTSIDE the scroller, sitting above whatever bars are visible — single line spans the entire visible viewport; (b) absolute overlay INSIDE the scroller, sitting above the entire content width — the line extends across all bars and pans with them. Either interpretation is consistent with "stays anchored to the lifetime max"; both are correct. (b) is what the prompt likely means ("you're chasing your lifetime best" — the line is THE TARGET, scrolling past it means "weeks below the line"). Recommend (b).
- **Horizontal scroll** — `set-row-menu.tsx:145-149` is the only existing horizontal `<ScrollView>` in the codebase. Plain RPE chips, no snap. Reusable pattern.
- **Modal launched from a header tap** — `plate-calculator.tsx` (visible bool + Modal) plus `choose-action-modal.tsx` (backdrop + card). Reusable pattern for the week-selector.
- **Lifetime dataset + memoized derivations** — `src/hooks/use-progress-page.ts:33-87` does this for `bestWeek`, `currentWeek`, `prsThisWeek`. Same pattern for the scrollable strip: lifetime query → memo to bucket → memo to derive denom/overlay.
- **Per-week URL segment** — `format(monday, "yyyy-MM-dd")`. Locked by `week-drill-down.spec.ts:200-213`.
- **Run 2026-05-22_0030_progress-page** — the run that introduced `bestWeekKg` overlay, `useLifetimeWeeklyVolume`, and `useLifetimeBestWeek`. design-v3 §"BLK-2" (lines 619-625) documents the overlay math. design-v3 §"BLK-3" (lines 9-79) documents the null-completed_at server filter required on lifetime reads. This run extends the same data source from "one anchor point (best week)" to "every week".
- **Run 2026-05-20_0334_volume-strip-drill-down** — established the `Pressable` per column, the `router.push("/history/week/<YYYY-MM-DD>")` URL contract, the "outside the 8-week window" guard rail. Discovery `.../discovery.md:104-138` documents the 8-bar touch-target constraint. The scrolling redesign supersedes the "8-week window" constraint that drove that guard rail.
- **Run 2026-05-19_2144_weekly-volume-stat** — original strip. Final-summary line 46 said "Non-interactive in v1 (drilldown deferred)". Then `2026-05-20_0334` added interactivity. Then `2026-05-22_0030` added the overlay. This run is the natural third increment.

## Unknowns (require Designer judgment or human decision)

1. **Data source for the strip — lifetime vs windowed-on-demand.** The Progress page already loads `useLifetimeWeeklyVolume()`; switching the strip to lifetime is a one-line hook swap and consolidates cache keys. History page (which today loads only the 8-week hook) would start paying the lifetime cost — bounded ≤32 paginated round-trips for a heavy user, typical user ≪32. Alternative: keep `useWeeklyVolume()` for the visible window and lazily expand with a new "load older" hook. Designer should pick.
   - Recommendation: **lifetime for both consumers** (simpler, cache reuse, validated by Progress page already doing it). Flagged as `assumption`.

2. **`useWeeklyVolume()` (the 8-week hook) — keep or remove?** It's used by both the strip (current code) and `app/(app)/history/week/[isoWeek].tsx:56` (the drill-down screen). If the strip moves off it, only the drill-down screen still needs it. The drill-down's `isInWindow` guard at `week/[isoWeek].tsx:74-78` exists specifically because the cache was 8-week-bound; under lifetime data that guard becomes incorrect (every historical week IS in the cache). Designer should decide: (a) drill-down also moves to lifetime → delete `useWeeklyVolume` entirely; (b) drill-down stays on 8-week → keep `useWeeklyVolume` for narrower screens.
   - Recommendation: **(a) move drill-down to lifetime, delete `useWeeklyVolume`**. Aligns cache, removes the outdated `isInWindow` branch, and unblocks deep-linking to arbitrarily old weeks.

3. **Bar-height denominator under scrolling — visible-window max vs lifetime max.** Today: `denom = max(model.maxKg, bestWeekKg ?? 0)`. With dynamic bars, "model.maxKg" can mean (a) max over ALL bars (lifetime), (b) max over the currently-visible viewport. Option (a) keeps bars proportional across the entire scroll — the lifetime-best dotted line is always near the top (consistent). Option (b) rescales as you scroll — the user sees more detail in low-volume periods but the overlay line jumps. Designer call.
   - Recommendation: **lifetime max**. Matches the overlay's invariant (always anchored at lifetime max) and keeps height comparisons honest across the scroll. Trade-off: low-volume historical weeks render as visually tiny stubs. Mitigation: `MIN_BAR_HEIGHT` already enforces a 4pt floor.

4. **Lifetime-best overlay on History strip — show or hide?** Today: Progress passes `bestWeekKg`; History does not (`history/index.tsx:48` — bare `<WeeklyVolumeStrip />`). The "you're chasing your lifetime best" affordance is a Progress-page narrative. History is more a list-prefix glance.
   - Recommendation: **keep current behaviour** (History no overlay; Progress overlay). Different narratives. Flagged as `assumption`.

5. **Where the overlay line lives in the scroller layout.** Two interpretations of "stays anchored to the lifetime max":
   - (a) Overlay sits OUTSIDE the horizontal scroller, fixed at the lifetime-max Y position over the visible viewport. Always at the same screen position regardless of scroll.
   - (b) Overlay sits INSIDE the scroller, spanning the full content width at the lifetime-max Y. Scrolls horizontally with the bars; the line "follows" you as visual context.
   - Both render the line at the same Y across all weeks (the prompt's invariant). Visually: (a) feels like a HUD; (b) feels like a "ghost record" line over the bars.
   - Recommendation: **(b) inside the scroller, full-width line**. Mirrors the "you're scrolling through your history, your best is always overhead" mental model. The math is identical.

6. **Week selector UI primitive.** Concrete options:
   - **(I) Tappable header showing the current visible range** (e.g. "Apr 27 – Jun 21, 2026") that opens a `<Modal>` with input options. Most discoverable; consistent with the existing chart headline.
   - **(II) Quick-jump buttons inline** (e.g. `[1m] [3m] [6m] [1y] [all]`). No modal; lowest dep cost; coarse-grained.
   - **(III) Horizontal month-grid above the bars.** Like a mini-timeline. Highest dev cost; richest UX.
   - **(IV) Tappable bar in the strip itself opens a "go to week" pill** — but tap is already taken by drill-down.
   - **(V) Date picker via `@react-native-community/datetimepicker`** (new dep). Native picker on iOS / Android, `<input type="date">` on web. UX divergence between platforms but no custom UI code.
   - Existing codebase primitives: `<Modal>` (3 call sites), no date picker, no calendar grid. Hand-rolled month grid or quick-jump buttons is achievable in this run without adding deps; full calendar picker would benefit from a dep.
   - Recommendation: **(I) tappable header + Modal with (II) quick-jump buttons inside, plus a manual "YYYY-MM-DD" text input as escape hatch** (reuses the `session-times-editor.tsx:140-150` masked-text-input precedent). Avoids new dep; covers fast (quick-jump) + precise (text input) + future-friendly (Modal can be enriched later).

7. **What "jump to week" does — pure scroll or navigate to detail.** Two readings:
   - (a) Scroll the strip so the chosen week is in view (no URL change). Subsequent tap on the bar drills down.
   - (b) Directly navigate to `/(app)/history/week/<YYYY-MM-DD>` (skip the bar).
   - Recommendation: **(a) pure scroll**. The selector's job is "find the week"; the user still confirms with a tap. (b) collapses the selector and the detail screen into one action, which is fine but loses the visual context of where the week sits in the chart.

8. **Default scroll position on mount.** Rightmost (most-recent week). Standard "tail-anchor" pattern for time-series charts. The prompt is silent but this is industry standard.
   - Recommendation: **rightmost on mount**, via `contentOffset={{ x: maxOffset, y: 0 }}` to avoid flash-then-scroll.

9. **Scroll position persistence.** When the user scrolls back to 2024-11, exits the History tab, comes back — should the strip return to that scroll position or reset to "now"?
   - Recommendation: **reset to "now" on remount**. The strip's primary glance is "where am I this week"; persistent scroll position would surprise users. If the user wants to revisit a specific past week, that's the drill-down screen's job. Flagged as `assumption`.

10. **Width vs gap of each bar.** Today: each bar is `flex-1` inside `gap-1.5`. Under scrolling, the bar must have a fixed pixel width (otherwise `flex-1` divides by `Infinity` content width). Concrete options:
   - 40pt bar + 6pt gap = 46pt per column → ~12 bars per iPhone 390pt viewport (close to today's 8).
   - 32pt bar + 4pt gap = 36pt per column → ~15 bars per viewport (more dense).
   - 24pt bar + 4pt gap = 28pt per column → ~18 bars per viewport (densest).
   - Recommendation: **40pt + 6pt gap** to keep parity with today's per-bar visual weight on 390pt iPhones. Designer can tune.

11. **Label collision over many years.** Today's bar label is `format(monday, "M/d")` (e.g. "5/12") — two Mondays in different years share the same label. Under multi-year scrolling, this becomes ambiguous. Options:
   - Keep "M/d", let the URL + drill-down disambiguate.
   - Show "M/d" for current year, "M/d/yy" or "MMM 'yy" for older years.
   - Show a "year marker" stripe at year boundaries (faint vertical line).
   - Recommendation: **add a sparse year marker at January-W1 transitions** (subtle, doesn't crowd labels). Designer call.

12. **Accessibility label uniqueness.** Same root cause as #11. Today: `"View week of 5/12"` is ambiguous across years. e2e tests use `getByRole("button", { name: "View week of M/d" })` — if duplicates exist in the DOM, tests fail. Designer should consider including year in `accessibilityLabel` for non-current years (e.g. "View week of 5/12/2024"). Doesn't have to match the visible label.

13. **History page mini-strip touch usability.** The prompt frames the History strip as "small" (~60px tall). Verified: that's incorrect — the History strip is the SAME 96pt-plot / ~150pt-total-height component as Progress. Discovery's read: this concern collapses. Both strips are equally scrollable. Flagging for the Conductor.

14. **Component file split — one component or two?** The strip is shared today. If scroll behaviour, selector UI, and overlay differ between History and Progress, Designer may want to split into a base `<BaseScrollableVolumeStrip>` + thin wrappers. Recommend keeping one component with props (e.g. `bestWeekKg?`, `selectorMode?: "always" | "never"`, etc.); split only if prop matrix balloons.

## Out-of-scope flags

- **Removing the 8-week `useWeeklyVolume` hook entirely.** Strongly suggested but coupled with the drill-down screen migration (Unknown #2). If Designer keeps the drill-down on the 8-week hook, the hook stays. Either way, gating decision belongs in design, not discovery.
- **Bodyweight / measurements chart scrolling.** Per `2026-05-20_0334` Discovery #8, the measurements strip is a different chart primitive. Out of scope here.
- **Per-day breakdown inside a bar.** Stays a future feature; the drill-down screen already shows per-session detail.
- **PR markers / annotations on bars.** Tempting but adds visual complexity orthogonal to "scroll + jump-to-week". Defer.
- **Pinch-to-zoom on the chart.** Out of scope. Pan only.
- **Mini-map / overview-and-detail pattern** (small overview below the bars). Out of scope; the prompt asks for selector, not multi-axis.
- **Streak indicators inside the strip.** `<StreakCard>` already covers this on Progress.
- **Lazy server-side pagination for the strip's lifetime fetch.** The existing client-side `.range()` pagination in `listWeeklyVolumeRows` already handles >1000 rows correctly.
- **Server-side weekly-volume aggregate query** (return one row per week instead of all sets). Would massively reduce payload on heavy users but is a different design — add a Postgres function / view. Defer to a follow-up.
- **Replacing `<View>`-based bars with `<Svg>`** (`react-native-svg` is already installed). Out of scope unless Designer wants gradient fills. Keep `<View>` for tap-target simplicity.
- **Sticky labels at the top (week number / year marker as user scrolls)**. Sweet but adds complexity. Defer.
- **Updating `docs/features.md` to reflect the new strip behaviour**. Conductor's job post-merge.
- **Fixing the long-standing single-session warmup-inclusion inconsistency** at `history/[id].tsx:130-142`. Out of scope, still queued (run `2026-05-19_2144` final-summary #4).
- **Refactoring `findBestWeek`'s reverse-key helper** (`progress-page-math.ts:106-117` `weekKeyToMondayLabel`) into the new helpers. Keep as-is unless cleanup is trivial.
