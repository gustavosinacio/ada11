# Design v1 — 2026-05-20_0334_volume-strip-drill-down

## Goal (1 sentence)

Make each column of the History tab's `WeeklyVolumeStrip` tappable so the user lands on a per-week detail screen that shows a headline stat sheet (total volume + sessions count + avg per session) and a `SessionSummaryRow` list of every session in that ISO week, reusing existing data hooks with no new API.

## Approach

The strip already buckets the last 8 ISO weeks via `lastNIsoWeeks(8)` and renders them as bare `<View>` bars on top of a `<Text>` label row. The drill-down wraps each bar+label pair in a single per-column `<Pressable>` that calls `router.push("/(app)/history/week/<Monday-YYYY-MM-DD>")` — the URL segment is the local Monday date (per Discovery Unknown #2 recommendation) so it's human-readable and decodes with the already-re-exported `parseISO`. A new route `app/(app)/history/week/[isoWeek].tsx` mirrors the proven `measurements/[id]/index.tsx` view-screen shape: function-form `<Stack.Screen>` mounted in every render branch via a `screenHeader` const, sectioned-card body, dark-mode safe. Volume math for the headline is **the same kernel as the strip** — we recompute by filtering `useWeeklyVolume()`'s already-cached rows down to the target week's key, so the bar number on the previous screen and the headline on the detail screen come from the same denominator and can never disagree. The sessions list pulls from `useSessions()` (already cached, unpaginated, sorted DESC), filtered in `useMemo` by `weekKeyOf(parseISO(s.started_at)) === targetKey`, and renders with the existing `<SessionSummaryRow>`. In-progress sessions are kept in the list with the existing orange chip (matches `history/index.tsx` precedent); the headline volume already excludes them server-side via `useWeeklyVolume()`'s `.not("sessions.ended_at", "is", null)` filter, so the headline reads "completed work this week" while the list shows "all activity this week" — divergence is acceptable and self-labeled by the chip.

## Decisions on unknowns (from Discovery)

| # | Unknown | Decision | Rationale |
|---|---|---|---|
| 1 | View shape (A/B/C/hybrid) | **B+A hybrid** — stat sheet (volume, sessions count, avg) on top, `SessionSummaryRow` list below | Most natural reading of "more detailed view"; reuses every existing primitive; no new chart in v1 |
| 2 | Route segment shape | **Monday date `YYYY-MM-DD`** | Human-readable URL ("Week of May 12" derives directly); reuses `parseISO`; no new `parseWeekKey` helper |
| 3 | Touch target | **Whole-column `<Pressable>` (bar + label merged)** | Bar-only is ~39pt × 4-96pt, fails iOS HIG 44pt minimum on short-data weeks. Column is ~39pt × ~120pt — passes height-wise, fails width by 5pt but is the best we can do without changing the 8-bar grid |
| 4 | Empty-week tappability | **Always tappable** — zero-volume weeks land on a "No sessions this week" empty state | Consistent UX, no disabled state to explain; warmup-only sessions still appear in the list |
| 5 | In-progress sessions in the list | **Included with orange "In progress" chip** | Matches `history/index.tsx` precedent; chip already exists in `SessionSummaryRow`; headline volume already excludes them, list shows the full picture |
| 6 | Header title format | **`"Week of May 12"`** (Monday only, `format(monday, "MMM d")`) | Mirrors the strip's own short M/d label; reads naturally; range "May 12 – May 18" is more accurate but doubles header width on small phones |
| 7 | Data source for the list | **`useSessions()` + client-side `useMemo` filter by `weekKeyOf`** | Already cached, O(N) filter at single-user scale is trivial; no new endpoint needed. Headline volume re-derived from `useWeeklyVolume()` cache via same kernel as strip |
| 8 | Measurements strip tappable too | **Out of scope** | Separate run; prompt is scoped to the history strip |

## Mudanças por arquivo

| File | Type | Change |
|---|---|---|
| `src/components/weekly-volume-strip.tsx` | edited | Merge the separate bar row + label row into a single per-bucket column. Each column becomes a `<Pressable>` that calls `router.push("/(app)/history/week/" + format(monday, "yyyy-MM-dd"))`. Import `useRouter` from `expo-router`, import `format` from `date-fns`, recover the Monday date per bucket by carrying `start: Date` on the `Bucket` type (already produced by `lastNIsoWeeks`). Add `accessibilityRole="button"` and `accessibilityLabel="View week of {label}"` to each `<Pressable>`. No volume-math change. |
| `app/(app)/history/week/[isoWeek].tsx` | new | View screen. Reads `isoWeek` URL segment (Monday `YYYY-MM-DD`), parses to a Monday `Date` via `parseISO`, derives the target `weekKeyOf` key. Pulls `useSessions()` and `useWeeklyVolume()`. In `useMemo`: (a) sessions list = filter sessions whose `weekKeyOf(parseISO(started_at))` matches target, (b) headline volume = reduce the cached weekly-volume rows for the same target key with the existing kernel. Renders `<Stack.Screen options={{ title: "Week of {MMM d}", headerShown: true }} />`, headline stat-sheet section (3 rows), then `FlatList` of `<SessionSummaryRow>` or an empty state. Dark mode + 4 render branches (loading / error / empty / data) — all mount `screenHeader`. |
| `src/utils/dates.ts` | edited | One small addition: export a `weekKeyFromMonday(monday: Date): string` helper that wraps the existing `format(monday, "RRRR-'W'II")`. Pure convenience — the detail screen has a Monday `Date` (from `parseISO(URL segment)`) and needs the matching bucket key without going back through `weekKeyOf` (which does `isoWeekStart` redundantly). Optional; if Validator prefers we collapse this into calling `weekKeyOf(monday)` directly (idempotent — calling `isoWeekStart` on a Monday returns the same Monday), we can drop the helper. **Default: add the helper, single line, with a JSDoc.** |

No other files change. `app/(app)/history/_layout.tsx` is untouched (already a `<Stack>` with `headerShown: false`, auto-picks-up the new route). `session-summary-row.tsx` is untouched (reused verbatim). `use-sessions.ts` / `use-stats.ts` are untouched. `api/stats.ts` is untouched. No DB migration, no schema change.

## Contratos de I/O

### New route — `app/(app)/history/week/[isoWeek].tsx`

```ts
// URL segment shape
// /(app)/history/week/2026-05-12   ← Monday of the target ISO week, YYYY-MM-DD

export default function ViewWeekScreen(): React.JSX.Element;

// Internals
const { isoWeek } = useLocalSearchParams<{ isoWeek: string }>();
//   isoWeek is the YYYY-MM-DD string from the URL segment.

const monday: Date | null = useMemo(() => {
  if (!isoWeek) return null;
  try {
    const d = parseISO(isoWeek);
    if (Number.isNaN(d.getTime())) return null;
    return isoWeekStart(d); // defensive: round to local Monday even if URL is tampered
  } catch {
    return null;
  }
}, [isoWeek]);

const targetKey: string | null = monday ? weekKeyOf(monday) : null;
```

### Headline derivation (must equal strip number)

```ts
// `data` is `WeeklyVolumeRow[]` from useWeeklyVolume()
// Same kernel as src/components/weekly-volume-strip.tsx:42-46.
const headlineVolumeKg: number = useMemo(() => {
  if (!data || !targetKey) return 0;
  let vol = 0;
  for (const row of data) {
    if (weekKeyOf(parseISO(row.completed_at)) !== targetKey) continue;
    const w = row.weight ? parseFloat(row.weight) : 0;
    const r = row.reps ?? 0;
    if (Number.isFinite(w) && w > 0 && r > 0) vol += w * r;
  }
  return vol;
}, [data, targetKey]);
```

### Sessions list derivation

```ts
// `sessions` is `SessionRow[]` from useSessions() (DESC by started_at)
const sessionsThisWeek: SessionRow[] = useMemo(() => {
  if (!sessions || !targetKey) return [];
  return sessions.filter(
    (s) => weekKeyOf(parseISO(s.started_at)) === targetKey,
  );
}, [sessions, targetKey]);

const sessionsCount = sessionsThisWeek.filter((s) => s.ended_at != null).length;
const avgVolumePerSessionKg =
  sessionsCount > 0 ? headlineVolumeKg / sessionsCount : 0;
```

### Bucket type change in `weekly-volume-strip.tsx`

```ts
type Bucket = {
  key: string;
  label: string;
  totalKg: number;
  isCurrent: boolean;
  start: Date; // NEW — Monday of this week, used to build the route segment
};
```

`computeStripModel` already has access to each week's `start` via `lastNIsoWeeks(WEEKS_WINDOW)`; pass it through into the bucket. No math change.

### Per-column `<Pressable>` pseudo-shape

```tsx
const router = useRouter();
// ...
{model.buckets.map((b) => {
  const h = /* unchanged height math */;
  const cls = /* unchanged class selection */;
  return (
    <Pressable
      key={b.key}
      onPress={() =>
        router.push(`/(app)/history/week/${format(b.start, "yyyy-MM-dd")}`)
      }
      accessibilityRole="button"
      accessibilityLabel={`View week of ${b.label}`}
      className="flex-1 active:opacity-70"
    >
      <View
        style={{ height: h, marginTop: PLOT_HEIGHT - h }}
        className={cls}
      />
      <Text className="mt-1 text-center text-[10px] text-gray-500">
        {b.label}
      </Text>
    </Pressable>
  );
})}
```

Layout note: today the bars sit in a `flex-row items-end gap-1.5` h-24 container and the labels sit in a sibling `flex-row gap-1.5` row below. Merging both into per-column `<Pressable>`s requires changing the outer container so each pressable owns a column (bar at top, label below). The bar's bottom-alignment (`items-end`) is replaced by `marginTop: PLOT_HEIGHT - h` inside the bar so the bar still grows upward from a shared baseline. This keeps the visual identical and gives the pressable the full ~120pt column height as the hit area.

### `weekKeyFromMonday` helper (new in `src/utils/dates.ts`)

```ts
/**
 * Returns the ISO-week key ('YYYY-Www') for a Date that is already known to
 * be a local Monday 00:00. Skips the `isoWeekStart` round-trip that
 * `weekKeyOf` does — use this when the caller has already snapped to Monday.
 */
export function weekKeyFromMonday(monday: Date): string {
  return format(monday, "RRRR-'W'II");
}
```

### DB / RLS / network

- **No new tables**, no new columns, no migration.
- **No new Supabase query**. Reuses existing `useSessions` (already RLS-scoped by `user_id`) and `useWeeklyVolume` (already RLS-scoped, already cached on the previous screen, no refetch on navigate).
- **No new mutations**. Read-only screen.
- **Cache contract** (`["sessions"]`, `["stats", "weekly-volume", ...]`) unchanged.

## UI spec

### Header

- `<Stack.Screen options={{ title: "Week of {format(monday, 'MMM d')}", headerShown: true }} />`
- Title example: `"Week of May 12"`.
- No `headerRight` action in v1 (no edit affordance — sessions are edited from `history/[id].tsx`).
- Back chevron provided by Expo Router parent stack.

### Body — sectioned card mirroring `measurements/[id]/index.tsx`

```
ScrollView (px-6 py-6, bg-white dark:bg-black)
  Text (text-2xl font-semibold)   ← "Week of May 12 – May 18" body header (range, full date)
  Section "Volume"
    MetricRow "Total"            → formatVolume(headlineVolumeKg, unit)
    MetricRow "Sessions"          → "{n}" or "{n} (incl. {m} in progress)" when applicable
    MetricRow "Avg per session"   → formatVolume(avgVolumePerSessionKg, unit) — hidden when sessionsCount === 0
  Section header "Sessions"
    FlatList (or .map) of <SessionSummaryRow session={s} unit={unit}
                                              onPress={() => router.push("/(app)/history/" + s.id)} />
    — OR —
    Empty state: "No sessions this week."  (mirrors history/index.tsx:40-42 wording)
```

`MetricRow` and `Section` are local to the screen, identical in shape to the ones in `measurements/[id]/index.tsx:34-60`. Not extracted to a shared component in this run (precedent: that file kept them local too).

### Render branches (every branch mounts `screenHeader`)

```tsx
const screenHeader = <Stack.Screen options={{ title, headerShown: true }} />;

// 1. Invalid URL segment (monday === null)
if (!monday) {
  return <View bg + center>{screenHeader}<Text red>Invalid week</Text></View>;
}

// 2. Either underlying query loading
if (sessionsQuery.isLoading || weeklyVolumeQuery.isLoading) {
  return <View bg + center>{screenHeader}<ActivityIndicator /></View>;
}

// 3. Either underlying query errored
if (sessionsQuery.isError || weeklyVolumeQuery.isError) {
  return <View bg + center>{screenHeader}<Text red>{message}</Text></View>;
}

// 4. Data branch (may have zero sessions — handled inline with empty state inside the body)
return (
  <ScrollView bg>
    {screenHeader}
    <Body
      monday={monday}
      headlineVolumeKg={headlineVolumeKg}
      sessions={sessionsThisWeek}
      unit={unit}
    />
  </ScrollView>
);
```

### Accessibility

- Per-column pressable: `accessibilityRole="button"`, `accessibilityLabel="View week of {b.label}"` (e.g. `"View week of 5/12"`).
- Empty state text: plain `<Text>` — screen reader reads it as content; no extra role needed.
- Headline volume: no special label — `<Text>` content is self-describing.

### Dark mode tokens (reused across the codebase)

- Body: `bg-white dark:bg-black`
- Primary text: `text-black dark:text-white`
- Muted: `text-gray-500`
- Section header: `text-sm font-medium uppercase text-gray-500`
- Dividers (between sessions): inherited from `SessionSummaryRow`

## Riscos

### Data integrity

- **Headline must equal strip bar.** The strip uses `useWeeklyVolume()` rows (server-filtered to non-warmup, ended sessions) and reduces by `weekKeyOf` of `completed_at`. The detail screen does the **exact same** filter + reduce against the **exact same** cached rows. As long as both screens render with the same TanStack Query cache snapshot for `["stats", "weekly-volume", sinceUtc.slice(0,10)]`, the numbers match. Risk vector: if the user is on the boundary of a week and the cache key rolls (8-week window slides) while the user is on the detail screen, the strip's `currentWeekKg` could change while the detail screen still shows the old number. **Mitigation**: both screens read from the same cache key; cache rolls happen at week boundaries (Mon 00:00 local), not mid-navigation. Negligible risk.
- **Warmup inclusion mismatch.** `history/[id].tsx:130-142` (the per-session "Total" line) includes warmups due to a known bug (flagged in 2026-05-19 final-summary #4). The detail screen's headline excludes warmups (server-side). The detail screen's sessions list shows each session's name + duration but does **not** show per-session totals (because `SessionSummaryRow` only renders `totalSets`/`totalVolumeKg` when passed as props, and we are not passing them — see Performance below). So there is no warmup-inconsistency surface in this run. The single-session screen still has the bug, but it's the same bug already present in History; this run does not introduce a new divergence.
- **RLS**: every read goes through `useSessions` and `useWeeklyVolume`, both already RLS-scoped. No new query. No leak vector.

### UX regressions

- **Strip-only callers**: `WeeklyVolumeStrip` is only used at `app/(app)/history/index.tsx:48`. No other consumer. Making each column pressable does not affect other screens.
- **Bar visual shift**: switching bar row + label row → per-column stack means each bar is now rendered inside a `<View>` with `marginTop` instead of being bottom-aligned by `items-end`. Pixel-identical layout is the goal; visual diff risk is low but real. Mitigation: keep `PLOT_HEIGHT = 96`, keep bar widths driven by `flex-1`, keep gap at `gap-1.5` on the outer row.
- **Skeleton (loading) branch**: the strip's loading branch currently renders bars-skeleton + a separate label-skeleton block. Merging the columns might require adjusting the skeleton to also be per-column or to remain as-is. **Decision**: keep the skeleton untouched (it's already two rectangles of `h-24` and `h-3`); the per-column reorg only affects the data branch. No visual regression to skeleton.
- **Active state visual feedback**: `active:opacity-70` is a new pressable feedback style for bars/graph elements in this codebase. List rows use `active:bg-gray-50`. The opacity choice is consistent with iOS native feel for non-row tap targets. Risk: looks "different" from list rows. Acceptable — it's a different surface.
- **In-progress session in the per-week list**: ID surfaced via the orange chip; tap navigates to `history/[id]`. Same UX as `history/index.tsx`. No regression.

### Platform-specific

- **iOS / Android / web**: `<Pressable>` + `router.push` work identically across all three. The URL segment `YYYY-MM-DD` is a plain alphanumeric+dash string; web URL bar will show it cleanly.
- **Web back behavior**: Expo Router on web uses History API; back button returns to History list. Tested pattern (same as `history/[id]` → History list back nav).
- **iOS HIG 44pt**: column width on a 390pt-wide iPhone is `(390 - 32 - 7*6) / 8 ≈ 39pt`. Below the 44pt minimum. **Accepted trade-off**: the 8-bar grid is fixed by the strip's design; widening columns would reduce the bar count or change visual rhythm. The vertical extent of the touch target (~120pt) more than compensates. Flagged here so Validator sees it.

### Performance

- **Sessions filter cost**: `useSessions()` returns the full session history. Single-user data is bounded (<500 lifetime sessions at the high end for a multi-year user). `useMemo` filter is O(N), runs once per mount + once per `data` change. Negligible.
- **Weekly-volume reduce cost**: same data already on the previous screen, no refetch. Reduce is O(rows-in-8-weeks), capped at ~500 rows for a heavy user. Negligible.
- **No per-row `useSetsForSession`**: we deliberately do **not** call a per-session sets query for the list. `SessionSummaryRow` shows `name · date · duration` and the in-progress chip when `totalSets`/`totalVolumeKg` are omitted — that's the same shape as the History list. Avoids N+1.
- **FlatList for the per-week list**: most weeks have ≤7 sessions; a plain `.map` inside the `ScrollView` is acceptable. **Decision**: use `.map` (matches the simpler `measurements/[id]/index.tsx` body pattern). If a single week ever exceeds ~30 sessions, switch to `FlatList` in a follow-up.

## Alternativas descartadas

1. **Bar-only `<Pressable>` (no column merge).** Discarded — bar widths × short-data heights produce sub-44pt touch targets, failing iOS HIG. A 4×39pt bar is essentially untappable on a moving thumb.
2. **`<Modal>` for the per-week view (vs. push a new screen).** Discarded — every detail view in the app (`history/[id]`, `measurements/[id]`, `exercises/[id]/progress`) is a pushed Stack screen with back chevron. Modal would be inconsistent and would lose the URL contract (no `history/week/2026-05-12` deep link).
3. **URL segment `[isoWeek]` = `"2026-W20"` key.** Discarded — URL is uglier, requires a new `parseWeekKey` helper, and the helper would need to recover a Date from the ISO week-numbering year (`RRRR`) + week number (`II`), which `date-fns` doesn't parse out-of-the-box without a custom format string. Monday date is human-readable and parses with the existing `parseISO`.
4. **Per-day volume chart (shape C from Discovery).** Discarded for v1 — adds a chart component decision (reuse `ProgressChart` line chart vs. write a 7-bar component) that expands scope. The stat-sheet + list answers the prompt; a chart can land in a follow-up.
5. **Per-exercise breakdown ("top exercise by volume this week").** Discarded — Discovery flagged this as out-of-scope; requires O(weeks × exercises) reduction and a new shape on the cached weekly-volume rows. Defer.
6. **Embed the headline math behind a new helper `useWeekVolume(targetKey)`.** Discarded for v1 — keeps the call site simple. The reduce is 8 lines; extracting it now would be premature abstraction. If a second consumer appears, extract then.
7. **Pass `totalSets` + `totalVolumeKg` to `SessionSummaryRow` for the per-week list.** Discarded — requires a per-session sets query (N+1) or a new server aggregate. Same justification as 2026-05-19's run. Backfill is queued as a separate follow-up.

## Out of scope

- **Per-exercise volume breakdown within a week.** Queued for a follow-up.
- **PR detection / streak indicators / week-over-week deltas.** Not in the prompt.
- **Editing sessions from the drill-down.** Existing `history/[id].tsx` flow handles edit/delete; drill-down navigates to it.
- **Tappability for `MeasurementsProgressStrip`.** Separate run (Discovery Unknown #8).
- **Per-day chart inside the week-detail screen.** Could land as v1.2 if user wants it.
- **Backfilling `totalSets` / `totalVolumeKg` into `SessionSummaryRow`.** Still queued from 2026-05-19's final-summary #73.
- **Fixing `history/[id].tsx`'s warmup-inclusion bug in per-session totals.** Pre-existing issue, separate run.
- **Pagination of the per-week list.** Not needed at typical weekly volume (≤7 sessions).
- **Pressable for the bodyweight strip on Measurements.** Separate run.

## Open questions for Validator

1. **Is `weekKeyFromMonday` worth adding?** It's a one-liner that saves one redundant `isoWeekStart` call inside `weekKeyOf` when the caller has already snapped to Monday. Alternative: call `weekKeyOf(monday)` directly; `isoWeekStart` of a Monday is the same Monday, so it's idempotent. Both work. Recommend keeping the helper for readability; willing to drop if Validator prefers smaller surface.
2. **Body header — "Week of May 12" vs "May 12 – May 18".** The `<Stack.Screen>` title uses the short form for header-bar fit. The body `<Text className="text-2xl font-semibold">` could use the range form for more clarity inside the screen. Recommend range in body, short in header. Flag if Validator wants both unified.
3. **Should the per-week empty state ever render headline cards at all?** When `sessionsThisWeek.length === 0` AND `headlineVolumeKg === 0`, the stat sheet is all zeros. Two options: (a) render the zero stat sheet + "No sessions this week" line, or (b) skip the stat sheet entirely and just show the empty state. Recommend (a) for layout consistency — the user always sees the same skeleton on every week.
4. **`active:opacity-70` is new for tap feedback on non-row elements.** Acceptable, or should we leave bars without feedback (since the screen change is the feedback)?
