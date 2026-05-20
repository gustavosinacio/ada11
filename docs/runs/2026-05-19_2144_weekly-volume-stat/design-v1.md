# Design v1 — 2026-05-19_2144_weekly-volume-stat

## Goal (1 sentence)
Add a non-interactive weekly volume strip to the History screen showing the last 8 ISO weeks (Mon-Sun, device-local) of Σ (weight × reps) across non-warmup sets, rendered as fixed-height bars with kg-or-lbs respecting the user's unit preference.

## Approach
Add one new range-bound Supabase query that joins `sets` with `sessions!inner(...)`, filtered to `set_type != 'warmup'`, soft-delete null, and `completed_at >= <window_start_utc>` (last 8 ISO weeks + current). A TanStack Query hook (`useWeeklyVolume`) caches it under `["stats", "weekly-volume", 8]`. A pure utility module (`src/utils/dates.ts`) provides week-bucketing helpers built on `date-fns` v4 (`startOfWeek`/`endOfWeek` with `weekStartsOn: 1`, device-local). A new presentational component (`src/components/weekly-volume-strip.tsx`) buckets the returned rows into a `Bucket[]` (8 entries, zero-filled), computes per-week totals in kg, and renders a row of 8 fixed-height bars with the heaviest week scaled to 100%. The strip is mounted as `ListHeaderComponent` on the existing `FlatList` in `app/(app)/history/index.tsx` so pull-to-refresh still works. Internal math stays in kg; conversion happens at the `formatWeight(kg, unit)` boundary inside the strip component.

## Decisions on unknowns

| # | Unknown | Decision | Rationale |
|---|---|---|---|
| 1 | Week definition | **ISO week, Monday-Sunday** | Discovery's recommendation. Aligns with gym/programming culture; `date-fns` `startOfWeek(d, { weekStartsOn: 1 })` is a one-liner. No precedent to conflict with. |
| 2 | Timezone for week boundaries | **Device-local** (no explicit IANA TZ) | Matches the user's lived experience (a set logged at 23:30 BRT Sunday belongs to that Sunday's week, not the UTC Monday). `date-fns` already operates on the local `Date` object — no extra dep needed (`date-fns-tz` stays out). Owner is single-user in BRT per global CLAUDE.md; if multi-TZ becomes a thing, revisit. |
| 3 | Number of weeks shown | **8** (the last 8 ISO weeks including the current, in-progress week) | Discovery's recommendation. Two months of context, fits horizontally on a phone without scrolling, and 8 bars at ~32 px wide each leaves comfortable gutters on a 360 px-wide viewport. |
| 4 | "Working sets" semantics | **Loose: everything except `set_type === 'warmup'`** | Matches the existing per-exercise volume chart kernel at `app/(app)/exercises/[id]/progress.tsx:41`. Consistency across two volume readouts beats literalism on one. Single-session "Total" at `history/[id].tsx` remains inconsistent (counts warmups) — explicitly out of scope, flagged for follow-up. |
| 5 | Empty state | **Two-branch**: (a) zero finished sessions in the entire 8-week window → strip is not rendered at all (let the existing "No sessions yet" empty-list state do its work). (b) Some weeks have zero non-warmup volume → those bars render as a flat 4 px-tall muted bar so the rest week is visually present. | Symmetric with the list-level empty state below; rest weeks are meaningful information so we render them, not omit them. |
| 6 | Visual treatment | **Fixed-height vertical bars** (8 bars in a row), 96 px-tall plot area, each bar's height scaled linearly against the max non-zero week in the window. Each bar has a weekday-of-Monday label underneath (e.g. `4/29`, `5/6`). The total for the **last (current) week** is shown above the strip in large text: `12.4k kg this week`. | Discovery: "at a glance" + small bucket count rules out a line chart. Bars beat tiles because they give an instant trend read (rising/falling) without reading numbers; tiles would force the user to scan 8 numbers. Reuses NativeWind only — no SVG needed, so we avoid the `ProgressChart` API which is built for many points. |
| 7 | Interaction | **Non-interactive in v1** | Discovery's recommendation. Drilldown to per-week sessions is a separable follow-up; doing it now expands scope into routing + a new filtered list. |
| 8 | In-progress session handling | **Excluded** — `not("sessions.ended_at", "is", null)` matches the precedent at `src/api/progress.ts:14`. The current-week total will "jump" when the user finishes a workout. | Consistency with the only other place this question has been answered. Risk noted below. |
| 9 | Unit toggle reactivity | **Automatic via `useWeightUnit()`** called inside `WeeklyVolumeStrip` | `useWeightUnit()` is a TanStack subscription on `["preferences", "me"]`; calling it inside the component triggers re-render on toggle. Math stays in kg; only `formatWeight()` reads the unit. |
| 10 | `date-fns` adoption | **Use `date-fns` v4** (already in `package.json:31`, currently unused) | First import in repo — clean introduction. Tree-shakes per-function; we import only `startOfWeek`, `endOfWeek`, `subWeeks`, `addWeeks`, `format`, `isSameWeek`. Hand-rolling would be ~30 lines of fragile Date math (Sunday-vs-Monday off-by-one, DST). Worth the dep. |

## Mudanças por arquivo

| File | Type | Change |
|---|---|---|
| `src/utils/dates.ts` | new | Pure week-bucketing helpers: `isoWeekStart(d)`, `lastNIsoWeeks(n, now?)` returning `{ start: Date; end: Date; label: string }[]` oldest→newest, `weekKeyOf(d)` returning `YYYY-Www` from a Date (used as map key). All device-local, all built on `date-fns` v4. No I/O, fully unit-testable. |
| `src/api/stats.ts` | new | Single export `listWeeklyVolumeRows(opts: { sinceUtc: string })` returning `WeeklyVolumeRow[]`. Query: `.from("sets").select("completed_at, weight, reps, set_type, sessions!inner(started_at, ended_at)").is("deleted_at", null).not("sessions.ended_at", "is", null).neq("set_type", "warmup").gte("completed_at", sinceUtc).order("completed_at", { ascending: true })`. No client-side reduction here — keep the API layer dumb. |
| `src/hooks/use-stats.ts` | new | `useWeeklyVolume(weeks = 8)`. Computes `sinceUtc` once per render from `lastNIsoWeeks(weeks)[0].start.toISOString()`. Key `["stats", "weekly-volume", weeks, sinceUtc.slice(0,10)]` so a date roll-over invalidates the cache. `staleTime: 60_000`, persists via the existing AsyncStorage TanStack persister. |
| `src/components/weekly-volume-strip.tsx` | new | Presentational. Calls `useWeeklyVolume(8)` + `useWeightUnit()`. Buckets rows into 8 weeks via `weekKeyOf(parseISO(row.completed_at))`. Computes per-week kg total with the existing kernel (`parseFloat(weight)`, `Number.isFinite`, `* reps`). Renders header line (`{formatWeight(thisWeekKg, unit)} this week`) + a horizontal row of 8 bars + Monday-date labels. Handles loading (shows a 96 px-tall skeleton), error (silently renders nothing — list-level error state covers it), empty-window (renders nothing). |
| `app/(app)/history/index.tsx` | edited | Import `WeeklyVolumeStrip`. Add it as `ListHeaderComponent={<WeeklyVolumeStrip />}` on the existing `FlatList` (line ~34). No other changes. The "No sessions yet" branch is untouched — strip only appears when there is at least one session. |

No schema changes, no migrations, no Postgres views/functions, no routing changes.

## Contratos de I/O

### New types
```ts
// src/api/stats.ts
export type WeeklyVolumeRow = {
  completed_at: string;        // timestamptz ISO
  weight: string | null;       // numeric(6,2) from Supabase, kg
  reps: number | null;
  set_type: SetType;           // already filtered != 'warmup' by query
  sessions: { started_at: string; ended_at: string };
};

export async function listWeeklyVolumeRows(opts: {
  sinceUtc: string;            // ISO timestamp lower bound (inclusive)
}): Promise<WeeklyVolumeRow[]>;
```

### Date utility module
```ts
// src/utils/dates.ts
export type IsoWeek = {
  start: Date;     // local Monday 00:00:00
  end: Date;       // local Sunday 23:59:59.999
  key: string;     // 'YYYY-Www' (e.g. '2026-W20')
  label: string;   // 'M/D' for the Monday (e.g. '5/12')
};

export function isoWeekStart(d: Date): Date;
export function weekKeyOf(d: Date): string;          // 'YYYY-Www'
export function lastNIsoWeeks(n: number, now?: Date): IsoWeek[]; // oldest → newest
```

### Hook
```ts
// src/hooks/use-stats.ts
export function useWeeklyVolume(weeks?: number): UseQueryResult<WeeklyVolumeRow[], Error>;
// default weeks = 8
```

### Component props
```ts
// src/components/weekly-volume-strip.tsx
type Props = {
  weeks?: number;     // default 8
};
export function WeeklyVolumeStrip(props?: Props): JSX.Element | null;
```
The component returns `null` when there is no data in the window (no header chrome rendered at all).

### Internal computed shape
```ts
type Bucket = {
  key: string;          // 'YYYY-Www'
  label: string;        // 'M/D' of Monday
  totalKg: number;      // 0 if no sets that week
  isCurrent: boolean;   // true for the rightmost (today's) week
};
type StripModel = {
  buckets: Bucket[];    // exactly `weeks` entries, oldest → newest
  maxKg: number;        // for bar scaling; 0 if every bucket is 0
  currentWeekKg: number;
};
```

### Query / DB contract
- Table: `sets` (read), joined to `sessions` (read).
- Columns selected: `completed_at`, `weight`, `reps`, `set_type`, plus joined `sessions.started_at`, `sessions.ended_at`.
- Filters:
  - `.is("deleted_at", null)` on `sets` — soft-delete universal precedent.
  - `.not("sessions.ended_at", "is", null)` — exclude in-progress, matches `progress.ts:14`.
  - `.neq("set_type", "warmup")` — server-side "working sets" filter (loose definition).
  - `.gte("completed_at", sinceUtc)` — range bound; **first range-bound read in the codebase**, setting the convention.
- Order: `.order("completed_at", { ascending: true })`.
- RLS: existing `auth.uid() = user_id` on both tables; no policy change required, no service-role bypass.
- Expected row count: 8 weeks × ~30 working sets/week ≈ 240 rows worst-case for a heavy user. Acceptable in one round trip; no pagination needed.

## UI spec

### Layout (light mode shown; dark mirrors via NativeWind tokens)
```
┌─────────────────────────────────────────────────┐
│  This week                                       │  ← text-xs uppercase tracking-wide text-gray-500
│  12.4k kg                                        │  ← text-2xl font-semibold text-black dark:text-white
│                                                  │
│   █                                              │
│   █  █     █                                     │  ← 96 px tall plot area
│   █  █  █  █  █     █                            │
│   █  █  █  █  █  █  █  █                          │  ← bar baseline (always 4 px even when 0)
│  4/1 4/8 ... 5/13 5/20                            │  ← text-[10px] text-gray-500, Monday-of-week
└─────────────────────────────────────────────────┘
```

### Container
- Outer `View`: `className="border-b border-gray-200 px-4 py-5 dark:border-gray-800"`.
- Header row (this-week summary):
  - Caps label: `className="text-xs uppercase tracking-wide text-gray-500"` → `"This week"`.
  - Value: `className="mt-1 text-2xl font-semibold text-black dark:text-white"` → `formatWeight(currentWeekKg, unit)` with a `k` shorthand when ≥ 1000 (e.g. `12.4k kg`, `27.3k lbs`). Reuses the existing idiom from `app/(app)/exercises/[id]/progress.tsx:117`.

### Bars
- Plot area: `View` with `className="mt-4 h-24 flex-row items-end gap-1.5"` (24 × 4 px = 96 px tall; gap 6 px).
- Each bar: `View` with computed inline `style={{ height }}` where:
  - `height = maxKg === 0 ? 4 : Math.max(4, Math.round((totalKg / maxKg) * 96))`.
  - className: current week → `"flex-1 rounded-sm bg-blue-500 dark:bg-blue-400"`; other weeks → `"flex-1 rounded-sm bg-gray-300 dark:bg-gray-700"`; zero-volume week → `"flex-1 rounded-sm bg-gray-200 dark:bg-gray-800"` (the flat 4 px stub).
- Labels row: `View` with `className="mt-1 flex-row gap-1.5"`; each label `Text` with `className="flex-1 text-center text-[10px] text-gray-500"` showing the bucket's `label` (Monday `M/D`).

### Empty-state branches
1. **No finished sessions in the window** (`data?.length === 0` or all buckets are zero) → component returns `null`. The strip simply doesn't appear. The existing list shows "No sessions yet" if there are also no sessions at all.
2. **Some weeks have zero volume** (rest weeks) → those bars render as the 4 px-tall muted stub (`bg-gray-200 dark:bg-gray-800`). Label still rendered so the timeline is contiguous.
3. **Loading** (`isLoading === true`) → render a placeholder skeleton: same container, with a `h-24 w-full rounded-sm bg-gray-100 dark:bg-gray-900` block. No spinner — the list's own pull-to-refresh covers reload feedback.
4. **Error** → return `null`. The list below will surface the global error UI if the sessions query also fails; if only this query fails, swallowing it silently is better UX than blocking the list.

### Dark-mode tokens (confirmed against existing screens)
- Bg / divider: `bg-white dark:bg-black`, `border-gray-200 dark:border-gray-800`.
- Text: `text-black dark:text-white` (primary), `text-gray-500` (muted, identical in both modes — matches precedent).
- Bar colors: `bg-blue-500 dark:bg-blue-400` (current), `bg-gray-300 dark:bg-gray-700` (past), `bg-gray-200 dark:bg-gray-800` (zero).

### Copy
- Above the bars: `"This week"` (caps, muted) + value.
- Below the bars: only Monday-`M/D` labels, no other text.
- No tooltip, no per-bar text-overlay (out of scope per Unknown #7).

## Riscos

- **Data integrity / RLS**: Query relies on existing `auth.uid() = user_id` policies on `sets` and `sessions`. No new policy, no service-role. **Risk: low.** Mitigation: the new `listWeeklyVolumeRows` uses the same `supabase` JS client instance as every other read; no surface-area change.
- **Timezone edge (the recurring trap)**: A set logged at 23:30 BRT Sunday is 02:30 UTC Monday. Bucketing happens **client-side** on the local `Date`, so it correctly falls in the Sunday week for a BRT device. **Risk: medium** if/when the user changes device timezone mid-session, the bucket can flip retroactively. Mitigation: bucketing is recomputed on every render from `parseISO(row.completed_at)` (which returns a Date in local TZ via JS engine); no cached pre-bucketed value to go stale. Documented behavior, not a bug.
- **In-progress session "jump"**: The current-week bar grows when the user finishes today's workout, because the query excludes `ended_at IS NULL`. **Risk: low** — matches the precedent at `src/api/progress.ts:14`, and pulling to refresh after finishing is the standard pattern. Mitigation: none needed; document in implementation notes so the implementer doesn't get a "bug report" surprise.
- **`weight = null` or `weight = 0`**: Bodyweight exercises log `weight: null`; some users log placeholder zeros. The kernel guards `Number.isFinite(w) && w > 0 && r > 0` before multiplying, matching `app/(app)/exercises/[id]/progress.tsx:42-49`. **Risk: low.** These sets contribute 0 to volume (correct — there's no weight × reps math without a weight). Bodyweight tracking is a separate roadmap item, not part of this scope.
- **UX regressions on History list**: `ListHeaderComponent` is the standard `FlatList` slot — `refreshing` + `onRefresh` continue to work because the header sits inside the scrollable surface, not above it. **Risk: low**, but the implementer must keep the `FlatList` flat (not wrap it in a `ScrollView`, which would break the pull-to-refresh). Mitigation: explicit note in `implementation.md`, and validator should check.
- **Performance (query cost)**: ~240 rows worst-case for one round trip per cache miss. Indexed scan on `sets.completed_at` is required for the `.gte()` to be efficient — **need to verify there is an index** on `sets.completed_at` (or `(user_id, completed_at)`). **Risk: medium-low** because the table is per-user-RLS-scoped and small at this stage, but the convention this query sets will scale poorly without the index. Mitigation: leave the index out of this run (no migration in scope), but flag it in `implementation.md` for future work; current query will be a seq-scan at one user's volume (still microsecond-cheap).
- **Performance (render)**: 8 `View`s in a row. Negligible. Reflow on unit toggle is one `useMemo` recompute. **Risk: nil.**
- **Web platform**: NativeWind + plain `View`s render identically on `react-native-web`. No platform-specific code. **Risk: nil.**
- **Cache key correctness**: Key includes `sinceUtc.slice(0,10)` (date portion only) so it changes when the rolling 8-week window slides forward at midnight local. Without this, yesterday's cache would still be served when the window has actually shifted. **Risk: low** if implemented correctly; validator should grep for the key.
- **`date-fns` first-import discoverability**: Once introduced, future contributors may not realize it's now allowed. Mitigation: implementation notes should mention this is the canonical date utility going forward, and `src/utils/dates.ts` should be the single import surface (re-export what we need so callers don't reach into `date-fns` directly).

## Alternativas descartadas

1. **Line chart via existing `ProgressChart`** — Reuse `src/components/progress-chart.tsx` with 8 `DataPoint`s. Descartada porque (a) a line chart with 8 points reads ambiguously — the eye looks for a trend across many points; (b) lines hide zero-volume rest weeks (a flat line is visually less obvious than a flat zero-bar); (c) the chart is sized for a content-area route, not a strip header. Bars give a clearer "this week vs the rest" read in less vertical space.
2. **Server-side aggregation** — Add a Postgres view or RPC that returns `(week_start, volume_kg)` pre-bucketed. Descartada porque the data volume (≤ 240 rows) is trivially client-aggregatable, a migration is out of scope per the run brief, and we'd be locking in a server-side week definition (UTC vs local) that the client can't trivially override per-device. Defer until pain.
3. **Tile grid (3 × 3 or 4 × 2) instead of bars** — Each tile shows the date range + total. Descartada porque tiles force the user to scan 8 numbers to perceive trend; bars give the trend instantly. Tiles also waste vertical space (the strip would push the session list further down the screen).
4. **Horizontal scrollable strip of many weeks (e.g. all weeks the user has trained)** — Descartada because the prompt says "the last several weeks visible at a glance" — emphasis on at-a-glance. Scrolling defeats the glance.
5. **Hand-rolled week math (no `date-fns`)** — `startOfISOWeek` is ~15 lines of `getDay()`/`setDate()` arithmetic. Descartada porque `date-fns` is already paid for in `package.json`, tree-shakes per-function, and hand-rolled DST handling is an evergreen source of bugs. The first import sets the convention.
6. **Strict working-sets-only (excludes dropsets)** — Descartada in favor of consistency with `app/(app)/exercises/[id]/progress.tsx:41`. Dropsets are working effort and should count. The single-session "Total" inconsistency at `history/[id].tsx` is a separate fix.

## Out of scope

- Backfilling per-session `totalSets` / `totalVolumeKg` on `SessionSummaryRow` (the props exist but aren't passed).
- Fixing the inconsistent "Total volume" on `app/(app)/history/[id].tsx:130-142` (counts warmups). Flagged for a separate run.
- Adding a Postgres view, RPC, or materialized aggregation.
- Adding an index on `sets.completed_at` (no migration in scope; flag in implementation notes).
- A new route for per-week drilldown.
- Per-exercise or per-muscle volume breakdown.
- Comparison to previous week, streak indicators, goals, PRs.
- Interactivity (tap-to-drilldown) — Unknown #7 resolved as "non-interactive in v1".
- Pagination of the sessions list.
- Bodyweight-volume support (separate roadmap item).
- `date-fns-tz` (no multi-TZ feature in scope).

## Open questions for the Validator

1. **Cache key shape**: I'm proposing `["stats", "weekly-volume", weeks, sinceUtc.slice(0,10)]`. Is the date suffix the right invalidation lever, or should we also invalidate on the active user id (matches what `useSessions` does — or doesn't)? Worth a grep to confirm the pattern.
2. **Date locale**: `format(date, 'M/d')` from `date-fns` is locale-sensitive — does the project assume `en-US` (current `toLocaleDateString` calls use no locale arg → undefined → device locale)? If the device is `pt-BR`, the label format may render `'M/d'` literally but bucket-to-label calculation is fine. Implementer should hardcode `'M/d'` as a token-format string (which `date-fns` treats literally), not delegate to `toLocaleDateString`.
3. **Should the strip render when only the current (in-progress) week has data and all 7 prior buckets are zero?** I'm proposing yes (the strip shows once any finished session exists in the window), but a reviewer might argue "8 bars where 7 are flat looks broken." Open to flipping to "require ≥ 2 non-zero weeks" if the validator pushes back.
4. **`flex-1` bar width vs fixed width**: I'm using `flex-1` so the strip fills the available horizontal space at any device width. On very narrow viewports (< 320 px) the bars become uncomfortably thin. Acceptable, or fix the bar width and let the container scroll? My call: `flex-1` is fine; 320 px is below our supported floor.
5. **What if a user changes weight unit while the strip is on screen?** I'm relying on `useWeightUnit()` re-subscribing; should the validator check that no `useMemo` traps the `unit` value? Yes — implementer should include `unit` in the `useMemo` deps that compute the bucket model, and the validator should confirm.
6. **First range-bound query convention**: I'm picking `.gte("completed_at", isoUtcString)` with an ISO string built from a local Date. Worth the validator confirming this is the convention going forward and noting it for `docs/decisions.md` (out of scope to write the doc here).
