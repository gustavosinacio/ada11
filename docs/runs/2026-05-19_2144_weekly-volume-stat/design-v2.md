# Design v2 — 2026-05-19_2144_weekly-volume-stat

## Goal (1 sentence)
Add a non-interactive weekly volume strip to the History screen showing the last 8 ISO weeks (Mon-Sun, device-local) of Σ (weight × reps) across non-warmup sets, rendered as fixed-height bars with kg-or-lbs respecting the user's unit preference.

## Approach
Add one new range-bound Supabase query that joins `sets` with `sessions!inner(...)`, filtered to `set_type != 'warmup'`, soft-delete null, and `completed_at >= <window_start_utc>` (last 8 ISO weeks + current). A TanStack Query hook (`useWeeklyVolume`) caches it under a stable `["stats", ...]` prefix that every set/session mutation will invalidate. A pure utility module (`src/utils/dates.ts`) provides week-bucketing helpers built on `date-fns` v4 (`startOfWeek`/`endOfWeek` with `weekStartsOn: 1`, device-local). A new presentational component (`src/components/weekly-volume-strip.tsx`) buckets the returned rows into a `Bucket[]` (8 entries, zero-filled), computes per-week totals in kg, and renders a row of 8 fixed-height bars with the heaviest week scaled to 100%. The strip is mounted as `ListHeaderComponent` on the existing `FlatList` in `app/(app)/history/index.tsx` so pull-to-refresh continues to work; the screen's `onRefresh` is widened to refetch both `useSessions` and `useWeeklyVolume` in parallel. Internal math stays in kg; conversion happens at a new `formatVolume(kg, unit)` boundary inside the strip component (distinct from `formatWeight` because volumes need a `k`-shorthand and no decimal for whole numbers).

## Decisions on unknowns (carried forward from v1, unchanged)

| # | Unknown | Decision | Rationale |
|---|---|---|---|
| 1 | Week definition | **ISO week, Monday-Sunday** | Discovery's recommendation. Aligns with gym/programming culture; `date-fns` `startOfWeek(d, { weekStartsOn: 1 })` is a one-liner. No precedent to conflict with. |
| 2 | Timezone for week boundaries | **Device-local** (no explicit IANA TZ) | Matches the user's lived experience (a set logged at 23:30 BRT Sunday belongs to that Sunday's week, not the UTC Monday). `date-fns` already operates on the local `Date` object — no extra dep needed (`date-fns-tz` stays out). Owner is single-user in BRT per global CLAUDE.md; if multi-TZ becomes a thing, revisit. |
| 3 | Number of weeks shown | **8** (the last 8 ISO weeks including the current, in-progress week) | Discovery's recommendation. Two months of context, fits horizontally on a phone without scrolling. |
| 4 | "Working sets" semantics | **Loose: everything except `set_type === 'warmup'`** | Matches the existing per-exercise volume chart kernel at `app/(app)/exercises/[id]/progress.tsx:41`. Consistency across two volume readouts beats literalism on one. Single-session "Total" at `history/[id].tsx` remains inconsistent (counts warmups) — explicitly out of scope, flagged for follow-up. |
| 5 | Empty state | **Two-branch**: (a) zero finished sessions with non-warmup volume in the entire 8-week window → strip is not rendered at all. (b) Some weeks have zero non-warmup volume → those bars render as a flat 4 px-tall muted bar so the rest week is visually present. | Symmetric with the list-level empty state below; rest weeks are meaningful information so we render them, not omit them. Validator MIN-6 confirmed render-when-≥1-non-zero-week rule. |
| 6 | Visual treatment | **Fixed-height vertical bars** (8 bars in a row), 96 px-tall plot area, each bar's height scaled linearly against the max non-zero week in the window. Each bar has a weekday-of-Monday label underneath (e.g. `4/29`, `5/6`). The total for the **last (current) week** is shown above the strip in large text: `12.4k kg this week`. | Discovery: "at a glance" + small bucket count rules out a line chart. Bars give an instant trend read. Reuses NativeWind — no SVG. |
| 7 | Interaction | **Non-interactive in v1** | Discovery's recommendation. Drilldown is a separable follow-up. |
| 8 | In-progress session handling | **Excluded** — `not("sessions.ended_at", "is", null)` matches the precedent at `src/api/progress.ts:14`. The current-week total will "jump" when the user finishes a workout. | Consistency with the only other place this question has been answered. |
| 9 | Unit toggle reactivity | **Automatic via `useWeightUnit()`** called inside `WeeklyVolumeStrip` | `useWeightUnit()` is a TanStack subscription on `["preferences", "me"]`; calling it inside the component triggers re-render on toggle. Math stays in kg; only `formatVolume()` reads the unit. |
| 10 | `date-fns` adoption | **Use `date-fns` v4** (already in `package.json:31`, currently unused) | First import in repo — clean introduction. Tree-shakes per-function. |

## Mudanças por arquivo

| File | Type | Change |
|---|---|---|
| `src/utils/dates.ts` | new | Pure week-bucketing helpers: `isoWeekStart(d)`, `lastNIsoWeeks(n, now?)` returning `IsoWeek[]` oldest→newest, `weekKeyOf(d)` returning `YYYY-Www` from a Date (used as map key). All device-local, all built on `date-fns` v4. No I/O, fully unit-testable. Implementer must import `format`, `startOfWeek`, `endOfWeek`, `subWeeks`, `parseISO` from `date-fns` directly (no `Intl.DateTimeFormat`, no `toLocaleDateString`); date label uses the literal token string `'M/d'`. Bucket assignment uses local-time getters via `parseISO` + `weekKeyOf` (never `.getUTCDay()`/`.getUTCDate()`). |
| `src/api/stats.ts` | new | Single export `listWeeklyVolumeRows(opts: { sinceUtc: string })` returning `WeeklyVolumeRow[]`. Query: `.from("sets").select("completed_at, weight, reps, set_type, sessions!inner(started_at, ended_at)").is("deleted_at", null).not("sessions.ended_at", "is", null).neq("set_type", "warmup").gte("completed_at", sinceUtc).order("completed_at", { ascending: true })`. No client-side reduction — API layer stays dumb. |
| `src/hooks/use-stats.ts` | new | `useWeeklyVolume()` (no args; window is hardcoded 8 weeks inside the hook). Computes `sinceUtc` once per render from `lastNIsoWeeks(8)[0].start.toISOString()`. Cache key `["stats", "weekly-volume", sinceUtc.slice(0,10)]`. Uses stable prefix `["stats"]` to support cross-mutation invalidation (see edits to `use-sessions.ts` / `use-sets.ts` below). `staleTime: 60_000`. No `user_id` in the key — matches existing `useSessions` / `useExerciseProgress` convention (RLS scopes the data; user-switch invalidates the whole cache). |
| `src/utils/units.ts` | edited | Add a new exported helper `formatVolume(kg: number \| null \| undefined, unit: WeightUnit): string`. Returns `"—"` for null/undefined; converts kg→unit; applies `k`-shorthand at ≥ 1000 with one decimal (`"12.4k kg"`, `"27.3k lbs"`); for < 1000 returns a whole-number string (`"840 kg"`, `"412 lbs"`). Does NOT modify existing `formatWeight` callers. Single responsibility: it is the *volume* formatter, distinct from the *per-set weight* formatter. |
| `src/components/weekly-volume-strip.tsx` | new | Presentational. Calls `useWeeklyVolume()` + `useWeightUnit()`. Buckets rows into 8 weeks via `weekKeyOf(parseISO(row.completed_at))`. Computes per-week kg total with the existing kernel (`parseFloat(weight)`, `Number.isFinite`, `* reps`, guarded `> 0`). Renders header line (`{formatVolume(currentWeekKg, unit)} this week`) + a horizontal row of 8 bars + Monday-date labels. Early `return null` happens **before any wrapper View** (see §UI spec pseudo-code). No `weeks` prop — count is hardcoded 8 inside (validator MIN-9). |
| `src/hooks/use-sessions.ts` | edited | Extend `useFinishSession.onSuccess` and `useSoftDeleteSession.onSuccess` to also call `qc.invalidateQueries({ queryKey: ["stats"] })`. One responsibility: announce that session lifecycle events affect derived stats. No other hooks in this file change. |
| `src/hooks/use-sets.ts` | edited | Extend `useLogSet.onSuccess`, `useUpdateSet.onSuccess`, `useDeleteSet.onSuccess` to also call `qc.invalidateQueries({ queryKey: ["stats"] })` (in addition to the existing `KEYS.forSession(sessionId)` invalidation). One responsibility: announce that set mutations affect derived stats. |
| `app/(app)/history/index.tsx` | edited | Import `WeeklyVolumeStrip` and `useWeeklyVolume`. Add the strip as `ListHeaderComponent={<WeeklyVolumeStrip />}` on the existing `FlatList`. Widen `onRefresh` to a callback that triggers both `useSessions.refetch()` and `useWeeklyVolume.refetch()` in parallel (`Promise.all`); reflect combined `isRefetching` (logical OR) into the `refreshing` prop. No other changes. The "No sessions yet" branch is untouched — strip only appears inside the `FlatList`-branch, which only renders when `data && data.length > 0`. |

**Invalidation contract (new, documented here so future mutations know the rule)**: Any mutation that creates, updates, or soft-deletes a `sets` or `sessions` row MUST call `qc.invalidateQueries({ queryKey: ["stats"] })` in its `onSuccess`. The `["stats"]` prefix is intentionally broad — it covers `useWeeklyVolume` today and any future per-muscle / per-week aggregates without needing per-hook updates.

No schema changes, no migrations, no Postgres views/functions, no routing changes.

## Contratos de I/O

### New types (`src/api/stats.ts`)
```ts
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

### Date utility module (`src/utils/dates.ts`)
```ts
export type IsoWeek = {
  start: Date;     // local Monday 00:00:00
  end: Date;       // local Sunday 23:59:59.999
  key: string;     // 'YYYY-Www' (e.g. '2026-W20')
  label: string;   // 'M/d' for the Monday (e.g. '5/12'), produced by date-fns `format(..., 'M/d')`
};

export function isoWeekStart(d: Date): Date;            // Monday 00:00 local
export function weekKeyOf(d: Date): string;             // 'YYYY-Www'
export function lastNIsoWeeks(n: number, now?: Date): IsoWeek[]; // oldest → newest
```

### New formatter (`src/utils/units.ts`, added — existing exports untouched)
```ts
export function formatVolume(
  kg: number | null | undefined,
  unit: WeightUnit,
): string;
// kg == null              → "—"
// converted value >= 1000 → `${(v/1000).toFixed(1)}k ${unit}` (e.g. "12.4k kg")
// converted value <  1000 → `${Math.round(v)} ${unit}`       (e.g. "840 kg")
```

### Hook (`src/hooks/use-stats.ts`)
```ts
export function useWeeklyVolume(): UseQueryResult<WeeklyVolumeRow[], Error>;
// window is fixed at 8 weeks inside the hook (no args)
```

### Component props (`src/components/weekly-volume-strip.tsx`)
```ts
export function WeeklyVolumeStrip(): JSX.Element | null;
// no props; returns null when there is nothing meaningful to render
```

### Internal computed shape
```ts
type Bucket = {
  key: string;          // 'YYYY-Www'
  label: string;        // 'M/d' of Monday
  totalKg: number;      // 0 if no sets that week
  isCurrent: boolean;   // true for the rightmost (today's) week
};
type StripModel = {
  buckets: Bucket[];    // exactly 8 entries, oldest → newest
  maxKg: number;        // for bar scaling; 0 if every bucket is 0
  currentWeekKg: number;
};
```

### Edits to existing hooks

```ts
// src/hooks/use-sessions.ts
useFinishSession.onSuccess: (row) => {
  qc.setQueryData(KEYS.active, null);
  qc.invalidateQueries({ queryKey: KEYS.all });
  qc.setQueryData(KEYS.detail(row.id), row);
  qc.invalidateQueries({ queryKey: ["stats"] }); // NEW
};

useSoftDeleteSession.onSuccess: () => {
  qc.invalidateQueries({ queryKey: KEYS.all });
  qc.invalidateQueries({ queryKey: KEYS.active });
  qc.invalidateQueries({ queryKey: ["stats"] }); // NEW
};
```

```ts
// src/hooks/use-sets.ts
useLogSet.onSuccess: () => {
  qc.invalidateQueries({ queryKey: KEYS.forSession(sessionId) });
  qc.invalidateQueries({ queryKey: ["stats"] }); // NEW
};
useUpdateSet.onSuccess: () => {
  qc.invalidateQueries({ queryKey: KEYS.forSession(sessionId) });
  qc.invalidateQueries({ queryKey: ["stats"] }); // NEW
};
useDeleteSet.onSuccess: () => {
  qc.invalidateQueries({ queryKey: KEYS.forSession(sessionId) });
  qc.invalidateQueries({ queryKey: ["stats"] }); // NEW
};
```

### History screen `onRefresh` (edited)
```ts
const sessionsQ = useSessions();
const weeklyQ   = useWeeklyVolume();

const onRefresh = useCallback(async () => {
  await Promise.all([sessionsQ.refetch(), weeklyQ.refetch()]);
}, [sessionsQ.refetch, weeklyQ.refetch]);

// in FlatList:
// refreshing={sessionsQ.isRefetching || weeklyQ.isRefetching}
// onRefresh={onRefresh}
```

### Query / DB contract
- Table: `sets` (read), joined to `sessions` (read).
- Columns selected: `completed_at`, `weight`, `reps`, `set_type`, plus joined `sessions.started_at`, `sessions.ended_at`.
- Filters:
  - `.is("deleted_at", null)` on `sets` — soft-delete universal precedent.
  - `.not("sessions.ended_at", "is", null)` — exclude in-progress, matches `progress.ts:14`.
  - `.neq("set_type", "warmup")` — server-side "working sets" filter (loose definition).
  - `.gte("completed_at", sinceUtc)` — range bound; first range-bound read in the codebase.
- Order: `.order("completed_at", { ascending: true })`.
- RLS: existing `auth.uid() = user_id` on both tables; no policy change, no service-role.
- Expected row count: 8 weeks × ~30 working sets/week ≈ 240 rows worst-case.

## UI spec

### Render branching (explicit pseudo-code, validator MAJ-3)

The early-return MUST occur before any wrapper `View`, so an empty `ListHeaderComponent` does not draw padding/border chrome:

```tsx
export function WeeklyVolumeStrip(): JSX.Element | null {
  const { data, isLoading, isError } = useWeeklyVolume();
  const unit = useWeightUnit();

  // Bucket math is memoized on `data` only. `unit` is NOT a dep — it is only
  // read by display strings computed inline in JSX (MIN-5).
  const model: StripModel | null = useMemo(() => {
    if (!data || data.length === 0) return null;
    return computeStripModel(data); // pure: builds 8 buckets, maxKg, currentWeekKg
  }, [data]);

  // === BRANCH 1: loading ===
  // Renders skeleton WITH wrapper (so the user does not see a phantom collapse
  // and so the layout space is reserved, MIN-11).
  if (isLoading) {
    return (
      <View className="border-b border-gray-200 px-4 py-5 dark:border-gray-800">
        <View className="h-3 w-20 rounded-sm bg-gray-100 dark:bg-gray-900" />
        <View className="mt-2 h-7 w-32 rounded-sm bg-gray-100 dark:bg-gray-900" />
        <View className="mt-4 h-24 w-full rounded-sm bg-gray-100 dark:bg-gray-900" />
      </View>
    );
  }

  // === BRANCH 2: no data / error / all-zero — bare null, NO wrapper ===
  if (isError) return null;
  if (!model) return null;                          // data empty
  if (model.maxKg === 0) return null;               // every bucket is 0
  // (validator MIN-6: render whenever ≥ 1 non-zero week — equivalent to maxKg > 0)

  // === BRANCH 3: data — wrapper + bars ===
  return (
    <View className="border-b border-gray-200 px-4 py-5 dark:border-gray-800">
      <Text className="text-xs uppercase tracking-wide text-gray-500">
        This week
      </Text>
      <Text className="mt-1 text-2xl font-semibold text-black dark:text-white">
        {formatVolume(model.currentWeekKg, unit)}
      </Text>

      <View className="mt-4 h-24 flex-row items-end gap-1.5">
        {model.buckets.map((b) => {
          const h =
            model.maxKg === 0
              ? 4
              : Math.max(4, Math.round((b.totalKg / model.maxKg) * 96));
          const cls =
            b.totalKg === 0
              ? "flex-1 rounded-sm bg-gray-200 dark:bg-gray-800"
              : b.isCurrent
              ? "flex-1 rounded-sm bg-blue-500 dark:bg-blue-400"
              : "flex-1 rounded-sm bg-gray-300 dark:bg-gray-700";
          return <View key={b.key} style={{ height: h }} className={cls} />;
        })}
      </View>

      <View className="mt-1 flex-row gap-1.5">
        {model.buckets.map((b) => (
          <Text
            key={b.key}
            className="flex-1 text-center text-[10px] text-gray-500"
          >
            {b.label}
          </Text>
        ))}
      </View>
    </View>
  );
}
```

### Layout (illustrative)
```
┌─────────────────────────────────────────────────┐
│  THIS WEEK                                       │  ← text-xs uppercase tracking-wide text-gray-500
│  12.4k kg                                        │  ← text-2xl font-semibold text-black dark:text-white
│                                                  │
│   █                                              │
│   █  █     █                                     │  ← 96 px tall plot area
│   █  █  █  █  █     █                            │
│   █  █  █  █  █  █  █  █                          │  ← bar baseline (always 4 px even when 0)
│  4/1 4/8 ... 5/13 5/20                            │  ← text-[10px] text-gray-500, Monday-of-week
└─────────────────────────────────────────────────┘
```

### Bar sizing
- `flex-1` per bar, container clips at device width (no fixed bar width — validator MIN-1).
- Plot area: `h-24` (96 px), `flex-row items-end gap-1.5` (6 px gaps).
- Height: `Math.max(4, Math.round((totalKg / maxKg) * 96))` when `maxKg > 0`; `4` when zero-volume bucket. Floor of 4 px guarantees rest weeks are visible.

### Memoization rule (validator MIN-5)
- Bucket math (`StripModel`) goes through `useMemo(..., [data])` — `unit` is **not** in the deps.
- Display strings (`formatVolume(currentWeekKg, unit)`) are computed inline in JSX so they auto-react to `unit` without holding stale values.

### Dark-mode tokens (confirmed against existing screens)
- Bg / divider: `bg-white dark:bg-black`, `border-gray-200 dark:border-gray-800`.
- Text: `text-black dark:text-white` (primary), `text-gray-500` (muted, identical in both modes).
- Bar colors: `bg-blue-500 dark:bg-blue-400` (current), `bg-gray-300 dark:bg-gray-700` (past with volume), `bg-gray-200 dark:bg-gray-800` (zero / rest).
- Skeleton: `bg-gray-100 dark:bg-gray-900`.

### Copy
- Above the bars: `"This week"` (caps, muted) + value.
- Below the bars: only Monday-`M/d` labels, no other text.
- No tooltip, no per-bar text-overlay.

## Riscos

- **Data integrity / RLS**: Query relies on existing `auth.uid() = user_id` policies on `sets` and `sessions`. No new policy, no service-role. **Risk: low.**
- **Cache staleness (now mitigated)**: Without the new invalidation rule, the strip would show stale numbers after the user finished a workout or edited a set, because the cache is persisted to AsyncStorage for 7 days. v2 adds `qc.invalidateQueries({ queryKey: ["stats"] })` to every mutation that touches `sets` or `sessions`, and widens History's pull-to-refresh to refetch both queries. **Risk: low after fix.**
- **Strip-week-total ≠ sum-of-per-session-totals** (validator MIN-10): The strip excludes warmups (loose-working-sets); the existing single-session "Total" at `app/(app)/history/[id].tsx:130-142` counts warmups. A user with warmup volume will see the strip's week total differ from the sum of per-session totals for that week. **Risk: medium (user-visible inconsistency)**. Mitigation: documented; fix to the per-session total is filed for a follow-up run (see Out of scope). The strip's number is the correct one going forward.
- **Timezone edge**: A set logged at 23:30 BRT Sunday is 02:30 UTC Monday. Bucketing happens **client-side** on the local `Date` via `parseISO` + local-time getters (validator MIN-8), so it correctly falls in the Sunday week for a BRT device. **Risk: medium** if/when the user changes device timezone mid-week, the bucket can flip retroactively. Mitigation: bucketing is recomputed on every render; no cached pre-bucketed value to go stale.
- **`sinceUtc` over-fetch (validator MIN-4)**: `sinceUtc` is derived from `lastNIsoWeeks(8)[0].start.toISOString()`, which converts local Monday 00:00 to UTC. For a user east of UTC this would pull a few extra sets from the prior local-week; for BRT (UTC-3) it under-fetches by 0 hours (Monday 00:00 BRT = 03:00 UTC, so we cover everything from 03:00 UTC Monday onward). Over-fetch is bounded by `±` the TZ offset (max 14 h worldwide) and is **harmless** because client-side bucketing is the source of truth — any rows that fall outside the 8-week window just don't land in a bucket.
- **In-progress session "jump"**: Current-week bar grows when the user finishes today's workout because the query excludes `ended_at IS NULL`. **Risk: low** — matches precedent.
- **`weight = null` or `weight = 0`**: Bodyweight exercises log `weight: null`; some users log placeholder zeros. Kernel guards `Number.isFinite(w) && w > 0 && r > 0` before multiplying, matching `app/(app)/exercises/[id]/progress.tsx:42-49`. **Risk: low.**
- **UX regressions on History list**: `ListHeaderComponent` sits inside the scrollable surface, so `refreshing` + `onRefresh` continue to work. **Risk: low**. Implementer must not wrap the `FlatList` in a `ScrollView`.
- **Performance (query cost)**: ~240 rows worst-case per cache miss. **Verified: no `(user_id, completed_at)` index exists** (validator MIN-2 confirmed against `supabase/migrations/0000_schema.sql:97` — only `(exercise_id, completed_at)`). Tolerated at current scale (seq-scan of < 2k rows is microseconds); follow-up migration recommended once the dataset grows.
- **Performance (render)**: 8 `View`s in a row. Negligible. Reflow on unit toggle is one inline `formatVolume` call.
- **Web platform**: NativeWind + plain `View`s render identically on `react-native-web`. **Risk: nil.**
- **Cache key correctness**: Key includes `sinceUtc.slice(0,10)` (date portion only) so it changes when the rolling 8-week window slides forward at midnight local. Validator MIN-7 confirmed the key omits `user_id` per existing `useSessions` / `useExerciseProgress` convention (RLS scopes the data; user-switch invalidates the whole cache).
- **`date-fns` first-import discoverability**: Once introduced, future contributors may not realize it's now allowed. Mitigation: `src/utils/dates.ts` is the single import surface for date helpers in this run; implementation notes flag it as the canonical date utility going forward.

## Alternativas descartadas

1. **Line chart via existing `ProgressChart`** — Reuse `src/components/progress-chart.tsx` with 8 `DataPoint`s. Descartada porque (a) a line with 8 points reads ambiguously; (b) lines hide zero-volume rest weeks (flat line is less obvious than a flat zero-bar); (c) the chart is sized for a content-area route, not a strip header.
2. **Server-side aggregation** — Add a Postgres view or RPC that returns `(week_start, volume_kg)` pre-bucketed. Descartada porque the data volume (≤ 240 rows) is trivially client-aggregatable; a migration is out of scope; we'd lock in a server-side week definition (UTC vs local) that the client can't override per-device.
3. **Tile grid (3 × 3 or 4 × 2) instead of bars** — Each tile shows the date range + total. Descartada porque tiles force the user to scan 8 numbers; bars give the trend instantly.
4. **Horizontal scrollable strip of many weeks** — Descartada because the prompt says "at a glance"; scrolling defeats the glance.
5. **Hand-rolled week math (no `date-fns`)** — `startOfISOWeek` is ~15 lines of `getDay()`/`setDate()` arithmetic. Descartada porque `date-fns` is already paid for in `package.json` and DST handling is an evergreen source of bugs.
6. **Strict working-sets-only (excludes dropsets)** — Descartada in favor of consistency with `app/(app)/exercises/[id]/progress.tsx:41`. Dropsets are working effort.
7. **Reuse `formatWeight` for the strip header total (no shorthand)** — Would render `"12400.0 kg"` for a heavy week — ugly and breaks the "at a glance" intent (the eye stalls reading 5 digits + decimal). Descartada in favor of a separate `formatVolume` helper. The two formatters have different display contracts: `formatWeight` is per-set (always 1 decimal, never abbreviated, so users can read exact plate math); `formatVolume` is for aggregate readouts (abbreviated above 1000, no decimal for whole numbers, optimized for glance-reading). Putting both contracts in one function would mean either changing existing per-set displays (regression risk on every caller of `formatWeight`) or a flag argument that branches behavior — both worse than two named functions.
8. **Single shared invalidation key per mutation (e.g. invalidate everything)** — Calling `qc.invalidateQueries({})` after any mutation. Descartada because it would refetch unrelated queries (preferences, exercises catalog) on every set log. The `["stats"]` prefix is the surgical middle path: it covers current and future aggregates without thrashing unrelated caches.

## Out of scope

- Backfilling per-session `totalSets` / `totalVolumeKg` on `SessionSummaryRow` (the props exist but aren't passed).
- Fixing the inconsistent "Total volume" on `app/(app)/history/[id].tsx:130-142` (counts warmups). Flagged for a separate run; explicitly called out in §Riscos as a user-visible inconsistency.
- Adding a Postgres view, RPC, or materialized aggregation.
- Adding an index on `sets.completed_at` or `(user_id, completed_at)` — no migration in scope; flag in implementation notes.
- A new route for per-week drilldown.
- Per-exercise or per-muscle volume breakdown.
- Comparison to previous week, streak indicators, goals, PRs.
- Interactivity (tap-to-drilldown).
- Pagination of the sessions list.
- Bodyweight-volume support.
- `date-fns-tz` (no multi-TZ feature in scope).

## Resposta a issues do Validator (v1)

| ID | Addressed? | Where |
|---|---|---|
| MAJ-1 (`formatWeight` shorthand mismatch) | **yes** | §Mudanças — new `formatVolume(kg, unit)` added to `src/utils/units.ts`. §Contratos defines its exact branching. §UI spec uses `formatVolume` in the header. §Alternativas item 7 explains why a new helper instead of overloading `formatWeight`. |
| MAJ-2 (cache invalidation missing) | **yes** | §Mudanças — `src/hooks/use-sessions.ts` (`useFinishSession`, `useSoftDeleteSession`) and `src/hooks/use-sets.ts` (`useLogSet`, `useUpdateSet`, `useDeleteSet`) gain `qc.invalidateQueries({ queryKey: ["stats"] })`. §Contratos shows the exact `onSuccess` edits. History screen's `onRefresh` widened to `Promise.all([sessionsQ.refetch(), weeklyQ.refetch()])`. Invalidation contract documented as a rule for future mutations. |
| MAJ-3 (null-return placement) | **yes** | §UI spec — explicit pseudo-code shows the branching: loading → skeleton with wrapper; error/no-data/all-zero → bare `return null` (no wrapper, no border, no padding); data → wrapper + bars. |
| MIN-1 (bar-width rationale) | **yes** | §UI spec — wording changed to "`flex-1` per bar, container clips at device width". The "comfortable gutters" claim is gone. |
| MIN-2 (`completed_at` index) | **yes** | §Riscos — wording changed to "verified: no `(user_id, completed_at)` index exists; tolerated at current scale; follow-up migration recommended". |
| MIN-3 (date-fns `format` directive) | **yes** | §Mudanças — explicit directive in `src/utils/dates.ts` row: import `format` from `date-fns`, use literal token string `'M/d'`, do not use `toLocaleDateString` / `Intl.DateTimeFormat`. |
| MIN-4 (`sinceUtc` TZ over-fetch) | **yes** | §Riscos — one-line note "`sinceUtc` over-fetches by at most TZ-offset hours, harmless because client-side bucketing is the source of truth". |
| MIN-5 (`useMemo` deps + `unit`) | **yes** | §UI spec — "Memoization rule" section spells out: bucket math `useMemo(..., [data])` (no `unit` in deps); display strings (`formatVolume(currentWeekKg, unit)`) computed inline in JSX. |
| MIN-6 (render when ≥ 1 non-zero week) | **yes** | §Decisions row 5 + §UI spec branch 2 — `model.maxKg === 0 → return null` is equivalent to "render only when at least one non-zero week exists". Validator's confirmation referenced. |
| MIN-7 (cache key omits `user_id`) | **yes** | §Mudanças `src/hooks/use-stats.ts` row — explicit note: key is `["stats", "weekly-volume", sinceUtc.slice(0,10)]`; no `user_id`; matches `useSessions` / `useExerciseProgress` convention. |
| MIN-8 (`parseISO` + local-time getters) | **yes** | §Mudanças `src/utils/dates.ts` row — directive to use `parseISO` and rely on local-time getters (`.getDay()` not `.getUTCDay()`). |
| MIN-9 (drop `weeks?` prop) | **yes** | §Mudanças `src/components/weekly-volume-strip.tsx` row + §Contratos — `WeeklyVolumeStrip()` takes no props; 8 is hardcoded inside; `useWeeklyVolume()` likewise takes no args. |
| MIN-10 (strip-week-total ≠ sum-of-per-session-totals) | **yes** | §Riscos — explicit line documenting the inconsistency for follow-up; §Out of scope reiterates that the per-session total fix is a separate run. |
| MIN-11 (loading renders skeleton, not zero-bars) | **yes** | §UI spec branch 1 — loading branch renders the wrapper + 3 skeleton blocks (label, value, plot). Explicitly not a zero-bar grid, which would misread as "you've done nothing in 8 weeks". |

## Open questions for the Validator
None. All v1 majors are addressed with explicit contracts; all v1 minors are folded into the design. If the Validator still has concerns they will be new ones surfaced by the v2 changes (most likely candidates: shape of `formatVolume` rounding for borderline values like 999.5, and whether `Promise.all` in `onRefresh` should swallow individual failures — happy to address in v3 if flagged).
