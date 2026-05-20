# Discovery — 2026-05-20_0334_volume-strip-drill-down

## Feature prompt

> "history graph for the week needs a click functionality, where i'll see a more detailed view of my progress history"

Verbatim from `docs/features.md:6` (item #4 on the backlog). Today is 2026-05-20 (BRT).

## Scope summary

This is the v1.1 follow-up to the just-shipped weekly volume strip (`docs/runs/2026-05-19_2144_weekly-volume-stat/`), whose `final-summary.md:46-47` explicitly flagged "Non-interactive in v1 (drilldown deferred)". The work is to make the 8 bars of `WeeklyVolumeStrip` tappable and to add a new per-week detail screen under the History tab's inner `Stack`. No schema changes; no new mutations; one new route, one new component (or hook) for the screen, and minor pressable wiring in the strip. Data is already available client-side via `useSessions()` + `useWeeklyVolume()` — week filtering can be done with the same `weekKeyOf` / `isoWeekStart` helpers introduced in 2026-05-19's run.

## Affected files (verified)

### Will change

- `src/components/weekly-volume-strip.tsx:101-118` — currently each bar is a bare `<View>` with `style={{ height: h }}` inside a `flex-row items-end gap-1.5` row. Needs to become a `<Pressable>` (or wrap each bar/column in one) that calls `router.push(...)`. The component currently does not import `expo-router` and has no router awareness — that's the first import to add.
- `src/components/weekly-volume-strip.tsx:120-129` — the label row (M/d Monday labels) sits as a separate `<View>` below the bars. To enlarge the touch target to the entire column (recommended in Unknown #3), the bar `<View>` and its corresponding label `<Text>` need to either merge into a single per-bucket column `<Pressable>`, OR the strip needs two parallel rows of pressables that share an `onPress`. Either way, the current layout (separate bar row + separate label row) is the structural choice that needs revisiting.
- `src/components/weekly-volume-strip.tsx:62-71` — the model derived from `useWeeklyVolume()` currently exposes `{ key, label, totalKg, isCurrent }` per bucket. The drill-down handler needs the ISO-week key plus the start/end dates of the week to build the URL and headers. `key` (e.g. `"2026-W20"`) is enough for routing; `isoWeekStart`/`endOfWeek` for the chosen week need to be reconstructible (either store `start` on the bucket, or recompute via `parseISO`/`isoWeekStart` in the receiving screen). Decision deferred to Designer (see Unknown #2).
- `app/(app)/history/_layout.tsx:1-5` — the History tab is wrapped in a `<Stack screenOptions={{ headerShown: false }} />`. Adding a new route at `app/(app)/history/week/[isoWeek].tsx` will be auto-picked-up by Expo Router (file-system routing). The layout itself probably does **not** need changes — it already hosts dynamic routes (`[id].tsx`). But the per-screen `headerShown: true` override pattern used in `history/[id].tsx:195` must be reused on the new screen so the user gets the back chevron.

### New files expected (per `docs/architecture.md:83-133`)

- `app/(app)/history/week/[isoWeek].tsx` (new) — week-detail route. Reads `useLocalSearchParams<{ isoWeek: string }>()`; renders title + per-week stats and a list of sessions for that ISO week. Should host `<Stack.Screen options={{ title: ..., headerShown: true }} />` (matches `history/[id].tsx:195`, `measurements/[id]/index.tsx:144-159`, `exercises/[id]/progress.tsx:41-57`).
- *(Optional)* `src/hooks/use-sessions.ts` may grow a `useSessionsInWeek(isoWeek)` selector helper. Verified that the existing `useSessions()` returns **all** non-deleted sessions sorted DESC by `started_at` (`src/api/sessions.ts:4-12`). Client-side filtering by week is cheap at single-user data volumes (see "Performance" constraint below). A new server query is unnecessary in v1 (Unknown #7). If a helper is added, it lives next to `useSessions()` and uses `weekKeyOf(parseISO(s.started_at)) === isoWeek`.
- *(Optional)* `src/utils/dates.ts` may grow a `parseWeekKey(key: string): IsoWeek` helper that maps `"2026-W20"` → `{ start, end, key, label }` so the detail screen can render headers without re-deriving from a Monday string. Today `lastNIsoWeeks` is the only producer of `IsoWeek` objects (`src/utils/dates.ts:54-68`) and it always works forwards from `now`; there is no helper that hydrates an `IsoWeek` from a key alone. Designer should pick: pass `start.toISOString()` in the URL (route segment becomes a date) vs `key` (decoded with a new helper). See Unknown #2.

### Read-only references

- `src/utils/dates.ts:18-68` — `IsoWeek` type + `isoWeekStart`, `weekKeyOf`, `lastNIsoWeeks`, re-exported `parseISO`. All deliberately device-local timezone (`docs/runs/2026-05-19_2144_weekly-volume-stat/final-summary.md:40-43`, decision #2). The drilldown must use the same helpers — any new bucketing math is forbidden.
- `src/api/stats.ts:1-33` — `listWeeklyVolumeRows({ sinceUtc })` is range-bound; **the strip already pulled the per-set data for the 8-week window** (`weight`, `reps`, `completed_at`, `set_type`, plus `sessions!inner(started_at, ended_at)`). The drilldown could reuse this query rather than re-pulling from `useSessions()`. **But** the rows are sets, not sessions, and they're shaped for bucket math (no `session_id`, no `name`, no `notes`). For a sessions list, `useSessions()` is the right source.
- `src/hooks/use-sessions.ts:20-25` — `useSessions()` returns all `SessionRow[]` for the user, no pagination. Already cached.
- `src/hooks/use-stats.ts:16-27` — `useWeeklyVolume()` returns `WeeklyVolumeRow[]`. Cache key is `["stats", "weekly-volume", sinceUtc.slice(0,10)]`. Already populated when the user lands on History (the strip is the `ListHeaderComponent`).
- `src/db/types.ts:97-126` — `SessionRow` (started_at, ended_at, name, notes), `SetRow` (set_type, weight as string, reps).
- `app/(app)/measurements/[id]/index.tsx:1-191` — **closest UX precedent** for a "detail view" pattern: `Stack.Screen` header with title + headerRight, sectioned card body via a private `Section` component, `MetricRow` label/value pairs, gray-500 muted captions. Designer should mirror this if going with shape B (per-week stat sheet).
- `app/(app)/exercises/[id]/progress.tsx:1-153` — precedent for a detail screen that wraps `<ProgressChart>` + a header line of summary stats. Mirror this if going with shape C (per-day volume chart).
- `app/(app)/history/index.tsx:11-62` — current History list. Drilldown is **navigation off this screen**, not a modal — keep that consistent with `history/[id].tsx` and `measurements/[id]/index.tsx` (both screen-level pushes).
- `src/components/session-summary-row.tsx:1-77` — the row component already used in History. **Directly reusable** in shape A and B for the "sessions in this week" list. `totalSets` / `totalVolumeKg` props exist but are not currently passed by `history/index.tsx:46-55` (flagged in 2026-05-19 final-summary line 73 as a known follow-up; not blocking this run).
- `src/components/progress-chart.tsx:1-138` — SVG chart primitive, already used by `exercises/[id]/progress.tsx` and `measurements-progress-strip.tsx`. Available if shape C is chosen.
- `app/(app)/measurements/[id]/index.tsx:123-132` — `<Link href={...} asChild>` pattern + `accessibilityRole="button"`. Alternative to `router.push` — both are idiomatic in this codebase (see Bash grep of `router.push` and `<Link` across `app/`).
- `app/(app)/history/[id].tsx:130-142` — single-session totals math (counts **all** sets including warmups; this is the known inconsistency flagged in 2026-05-19's final-summary #4 and at `docs/runs/2026-05-19_2144_weekly-volume-stat/final-summary.md:74`). The drilldown's per-week "total volume" must match the strip — i.e. exclude warmups — not the single-session "Total" line.

## Relevant conventions (verified by reading code)

- **Data flow**: `Supabase JS client → src/api/*.ts → src/hooks/*.ts (TanStack Query) → screens/components`. The drilldown screen sits on top of existing hooks (`useSessions`, `useWeeklyVolume`); no new `api/*` file is required unless Designer chooses shape C with a different aggregate.
- **Soft-delete + ended-session filter**: every read filters `.is("deleted_at", null)` and most aggregations filter `.not("sessions.ended_at", "is", null)`. `useSessions()` returns non-deleted but **includes** in-progress (where `ended_at IS NULL`) — `src/api/sessions.ts:4-12`. The drilldown should mirror the strip's semantics (`docs/runs/2026-05-19_2144_weekly-volume-stat/final-summary.md:46`: "In-progress sessions excluded") — i.e. filter out in-progress sessions from the per-week list as well, **or** show them with the existing `In progress` chip from `session-summary-row.tsx:66-70`. See Unknown #5.
- **Dynamic routes**: every dynamic segment uses `[param]` syntax. `useLocalSearchParams<{ id: string }>()` is the typed read pattern (5 confirmed call sites across `app/`). For a multi-segment ISO week key (`2026-W20`), a single segment `[isoWeek]` accepts the literal string — no two-segment `[year]/[week]` needed (Expo Router treats `-` and `W` as URL-safe).
- **Inner Stack header convention**: `<Stack.Screen options={{ title, headerShown: true }} />` is set per-screen because the parent `<Stack screenOptions={{ headerShown: false }} />` hides chrome by default (`app/(app)/history/_layout.tsx:4`). Confirmed at `history/[id].tsx:195`, `measurements/[id]/index.tsx:144-159`, `exercises/[id]/progress.tsx:41-57`.
- **Navigation primitive**: both `router.push(\`/(app)/...\`)` and `<Link href={...} asChild>` are in use across the codebase (`router.push` is the dominant pattern — 12 call sites in `app/`; `<Link asChild>` appears once at `measurements/[id]/index.tsx:123-132`). Either is fine; `router.push` is simpler for the strip's tap handler.
- **`Pressable` styling**: pressable list rows use `active:bg-gray-50 dark:active:bg-gray-950` (`session-summary-row.tsx:49`); pressable bars/chips on touch elsewhere haven't been styled (none exist yet). For graph bars, the convention is unestablished — Designer should propose.
- **Volume math**: identical kernel everywhere — `const w = s.weight ? parseFloat(s.weight) : 0; const r = s.reps ?? 0; if (Number.isFinite(w) && w > 0 && r > 0) vol += w * r;`. Verified at `weekly-volume-strip.tsx:42-46` and `history/[id].tsx:130-142` (with the warmup-inclusion bug noted) and `exercises/[id]/progress.tsx:69-79`.
- **Date display**: `format(parseISO(iso), "EEE, MMM d, yyyy")` is the long-form precedent (`measurements/[id]/index.tsx:74`, `measurement-list-item.tsx:49`). `format(monday, "M/d")` is the short label used in the strip (`src/utils/dates.ts:64`). For a week-detail title, both are plausible: "Week of May 12" (custom) vs "May 12 – May 18" (range). See Unknown #6.
- **NativeWind tokens** carried over from prior runs: `bg-white dark:bg-black`, `text-black dark:text-white`, `text-gray-500` muted, `border-gray-200 dark:border-gray-800` dividers, `px-4/px-6 py-3/py-5` padding, `text-xs uppercase tracking-wide text-gray-500` section headers.
- **`["stats"]` invalidation contract** (carried over): not relevant to this run since the drilldown is read-only. The contract still applies to future writers but nothing in this feature mutates state.

## Constraints

- **Data**:
  - No schema changes. Tables read: `sessions` (via `useSessions`), `sets` indirectly via the existing `listWeeklyVolumeRows` query.
  - Filter precedents (soft-delete, ended-session, non-warmup) must be applied identically to the strip's math when computing the week's totals on the detail screen — otherwise the strip number and the detail-screen number disagree, which is a worse bug than the single-session "Total" inconsistency the prior run already flagged.
  - Week boundaries: device-local ISO week (Mon-Sun), `weekStartsOn: 1`. **Locked** by 2026-05-19's design (decision #1) and the helpers in `src/utils/dates.ts:29`.
- **UI**:
  - Reuse existing components: `SessionSummaryRow` for the list; `<Stack.Screen>` header chrome; `formatVolume` (newly added at `src/utils/units.ts` per 2026-05-19's run) for the per-week total display.
  - Touch target: the current bar is `flex-1` inside a `gap-1.5` row inside `px-4` padding. On a 390pt-wide iPhone, each bar is ~(390 − 32 − 7×6) / 8 ≈ 39pt wide. With variable bar heights (min 4pt, max 96pt), short-data weeks have a 4×39 = 156pt² target — below the iOS HIG 44×44pt recommendation. **Whole-column touch target is required** unless Designer accepts a HIG miss. See Unknown #3.
  - Pressable feedback on the bars: no precedent in the codebase. Designer should either propose a new style (e.g. `active:opacity-70`) or keep visual feedback minimal (Pressable hit feedback is invisible at this size).
- **Platform**:
  - Universal app (iOS / Android / web). Route works on all three via Expo Router. No web-only or native-only code expected.
  - Tap on touch (mobile) vs click (web) — both handled by `Pressable.onPress`. Verified at `routine-list-item.tsx`, `exercise-list-item.tsx`, etc.
- **Auth**:
  - All reads are RLS-scoped via the user's JWT. No new auth-context work.
- **Performance**:
  - `useSessions()` is unpaginated and already cached. Filtering N sessions down to a week's-worth in `useMemo` is O(N) — negligible at single-user scale (likely <500 lifetime sessions for years).
  - The detail screen does NOT need a new range-bound query against Supabase. The 8-week strip already has the data shape needed for per-week aggregation; the new screen can either (a) re-run client-side bucketing on `useWeeklyVolume()`'s cached rows for the totals, plus (b) filter `useSessions()` for the row list. No N+1.
  - `useSetsForSession(id)` exists but should NOT be called for every session in the week list — `SessionSummaryRow` already gracefully accepts missing `totalSets` / `totalVolumeKg` and shows fewer fields (`session-summary-row.tsx:59-65`). Designer must not introduce a per-row set query.
- **Routing / URL design**:
  - The ISO-week key `"2026-W20"` is URL-safe (alphanumeric + dash). Expo Router accepts it as a single dynamic segment. Confirmed by the existing UUID-based dynamic segments — UUIDs include `-` and work without encoding.
  - Alternative: `start.toISOString().slice(0, 10)` (e.g. `"2026-05-12"`) as the segment. Trade-off in Unknown #2.

## Existing precedents

- **Detail-screen UX from a list item**: `measurements/[id]/index.tsx:137-191` (view) + `measurements/[id]/edit.tsx` (edit). Same pattern: list-tap → router.push → `useLocalSearchParams` → `<Stack.Screen>` header + sectioned body. The drilldown should mirror this shape (not a modal, not an in-page expand).
- **Detail-screen with a chart**: `exercises/[id]/progress.tsx:30-152` — `<ProgressChart>` + "N sessions logged" header line. Closest match if Designer picks shape C (per-day volume chart).
- **Tab-internal navigation**: `history/_layout.tsx` already hosts `[id].tsx`. Adding a `week/[isoWeek].tsx` route under the same Stack is structurally identical to how `measurements/[id]/index.tsx` and `measurements/[id]/edit.tsx` coexist (`app/(app)/measurements/[id]/`). The folder-per-resource pattern (`history/week/`) is the established precedent — verified by `app/(app)/measurements/[id]/` and `app/(app)/exercises/[id]/`.
- **Per-week math**: 2026-05-19's `computeStripModel` helper at `weekly-volume-strip.tsx:34-60` already buckets rows by `weekKeyOf` and reduces volume per bucket. The same kernel works to compute a single week's total — just filter to `weekKeyOf(row.completed_at) === targetKey`.
- **Empty state for a list with no rows**: `history/index.tsx:38-42` ("No sessions yet. Finish your first workout and it will appear here.") and `measurements/index.tsx` (similar). Drilldown should have a matching empty state: "No sessions this week."
- **In-progress badge**: `session-summary-row.tsx:66-70` — orange chip. Will appear in the drilldown automatically if any in-progress session falls in the target week, since `SessionRow.ended_at` is still null.
- **Header titles for date-based screens**: no precedent. `measurements/[id]/index.tsx:106` uses `EEE, MMM d, yyyy` as a *body* header but the `Stack.Screen` title is simply `"Measurement"`. The drilldown can either go generic (`"Week"`) and put the date in the body, or include the date in the title (`"May 12 – May 18"`). Both are workable. See Unknown #6.
- **Tappable strip in the codebase**: zero. Neither `MeasurementsProgressStrip` nor `WeeklyVolumeStrip` is currently interactive. This run sets the precedent that strips can drill in; Designer should consider whether the bodyweight strip should pick up the same affordance (out-of-scope per the prompt, but flagged).

## Unknowns (require Designer judgment or human decision)

1. **Shape of "more detailed view"** — the prompt is open. Three viable readings (all consistent with the existing strip → screen UX of `measurements/`):
   - **A. Per-week sessions list.** Just the sessions that happened that week, rendered with the existing `SessionSummaryRow`. Lightest. Reuses existing components 1:1.
   - **B. Per-week stat sheet.** Title + headline volume + sub-stats (sessions count, avg per session, top exercise by volume) + the sessions list below. Richer, mirrors `measurements/[id]/index.tsx`. Requires deciding which sub-stats matter — "progress history" in the prompt hints that the user wants to see *change* (per-week is one snapshot; the "history" framing suggests comparison or trend).
   - **C. Per-week chart of daily volume.** Tap a week → 7-day chart, one bar per day. More chart-heavy, less data. Reuses `ProgressChart` or a new bar component. Useful for spotting which days the user trained.
   - **Hybrid B+A is the most "detailed view"** reading: headline stats + chart strip of daily volume + sessions list. Recommend B+A as the default; flag chart as optional in v1.

2. **Route shape — `week/[isoWeek]` vs `week/[year-Wnum]` vs `week/[YYYY-MM-DD]`.** The ISO key `"2026-W20"` is unique and stable. A YYYY-MM-DD Monday is also unique. Trade-offs:
   - Key (`2026-W20`): self-describing, parses cleanly with `parseWeekKey` (new helper) or `parseISO` with a `RRRR-'W'II` parser. Slightly esoteric in the URL.
   - Monday date (`2026-05-12`): readable URL ("Week of May 12"), parses with `parseISO` directly (already re-exported in `src/utils/dates.ts:71`). Conventional in fitness apps.
   - Recommend Monday date (`YYYY-MM-DD`). Cleaner URL, reuses existing `parseISO`, no new `parseWeekKey` helper needed. The bucket key stays internal; the URL stays human-readable.

3. **Touch target — bar only vs whole column.** Current bar widths ~39pt, heights 4-96pt. Bar-only fails iOS HIG 44×44 in lean-week / short-bar cases. Whole-column (bar + label) is ~39×~120pt — passes width-wise, well-above height-wise.
   - Recommend whole-column `<Pressable>` per bucket. Wrap bar + label inside a single column. The visual layout doesn't change.

4. **Empty week — tappable or not?** A week with `totalKg === 0` (rest week) currently shows the gray 4pt stub bar. Two options:
   - Disable tap for zero-volume weeks (use `disabled` on `<Pressable>` + no accessibility role). Avoids "useless" screens.
   - Always-tap, show "No sessions this week" empty state on the detail screen. Consistent UX, slightly worse signal-to-noise.
   - Recommend always-tap with the empty state. The user might have logged a session that has only warmups (which the strip excludes from volume but the detail screen could still show); blocking the tap discards information.

5. **In-progress session handling on the detail screen.** The strip excludes in-progress from its bar math (because `useWeeklyVolume`'s API filter is `.not("sessions.ended_at", "is", null)`, `src/api/stats.ts:27`). But the sessions list (via `useSessions()`) **includes** in-progress sessions. Two choices for the per-week list:
   - Show all sessions in the week including in-progress (current `history/index.tsx` behavior). The orange `In progress` chip already labels them.
   - Filter the per-week list to ended sessions only, to keep it consistent with the volume number above it.
   - Recommend showing all (matches current History list UX). The headline volume is "completed work in this week"; the list is "all activity in this week". Acceptable divergence if labeled.

6. **Header title.** Options:
   - `"Week of May 12"` (Monday only, short).
   - `"May 12 – May 18"` (range, more explicit).
   - `"Week 20"` (ISO ordinal — too jargony for a fitness app).
   - Recommend `"Week of May 12"` (Monday). Matches the strip's own short M/d label and reads naturally.

7. **Data source — reuse `useSessions()` vs new query.** `useSessions()` is already cached and returns the full history; filtering by `weekKeyOf` on the client is O(N) at trivial N. New query (`listSessionsInWeek({ sinceUtc, untilUtc })`) is overkill for v1.
   - Recommend reusing `useSessions()` with a `useMemo` filter. Defer a server-bound query to a follow-up if the user history grows past O(1000) sessions.

8. **Cross-feature consistency — should `MeasurementsProgressStrip` also be tappable?** The prompt is scoped to the history strip; the bodyweight chart at `measurements/index.tsx` is a *line* chart (different primitive) with no obvious tap target. Out-of-scope unless Designer decides otherwise. Flag.

## Out-of-scope flags

- **Per-exercise breakdown within the week view.** "Top exercise by volume this week" is tempting but adds an O(weeks×exercises) reduction. Defer to a follow-up.
- **PR detection / "first time at ≥ X kg" overlays.** Not in the prompt.
- **Week-over-week comparison numbers / arrows / streak indicators.** Not in the prompt.
- **Goals (target volume per week, gap to target).** Not in the prompt.
- **Editing sessions from the drill-down.** The existing `session-summary-row.tsx` → `history/[id].tsx` flow already handles edit/delete; the drill-down's job is to **navigate to** sessions, not to embed editing.
- **Backfilling `totalSets` / `totalVolumeKg` into `SessionSummaryRow`** (still queued from 2026-05-19's final-summary line 73). Tempting to do here for the per-week list, but it requires either a new server aggregation or fetching sets per session. Keep it out — same justification as the prior run.
- **Fixing the single-session warmup-inclusion inconsistency** at `history/[id].tsx:130-142`. Still flagged for a follow-up, not this run.
- **A new bar-chart component** for the per-day chart (if shape C is chosen). Designer should choose whether to reuse `ProgressChart` (line chart over 7 points) or write a small bar-by-day component — but introducing a *new* chart primitive expands scope; reusing one of the existing primitives keeps the run tight.
- **Pagination of the per-week sessions list.** A week typically has ≤7 sessions; no pagination needed.
- **Tappability for the measurements strip.** See Unknown #8.
