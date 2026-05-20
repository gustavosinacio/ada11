# Discovery — 2026-05-19_2144_weekly-volume-stat

## Feature prompt
Add a weekly training volume stat to the history screen. I want to see my total volume (sum of weight × reps across working sets) by week, with the last several weeks visible at a glance.

## Scope summary
Add a stat strip (header above the existing sessions list) to the History tab — `app/(app)/history/index.tsx` — that buckets completed sets by week and shows total volume (Σ weight × reps for working sets) per week, for the last N weeks. Data already exists in `sets` + `sessions`; no schema changes required. The work is: (a) a new aggregation query / helper that joins `sets` to `sessions`, (b) a week-bucket utility, (c) a new component for the weekly tiles/bars, and (d) wiring into the History screen.

## Affected files (verified)

### Will likely change
- `app/(app)/history/index.tsx:1-50` — current History screen. Today renders only `SessionSummaryRow` items in a `FlatList`; needs a header (ListHeaderComponent) hosting the weekly stat.
- `src/api/progress.ts:10-36` — precedent for joining `sets` with `sessions!inner(...)`. A new aggregation query for "all working sets in the last N weeks" should live alongside this (e.g. `src/api/stats.ts` or extended `progress.ts`).
- `src/hooks/use-progress.ts:1-12` — precedent for the TanStack Query hook style. A new `useWeeklyVolume()` hook would mirror this.
- `src/utils/units.ts:13-17` — `formatWeight(kg, unit)` is the canonical formatter and must be reused (volume must respect the user's `weight_unit` preference).
- `src/hooks/use-preferences.ts:15-18` — `useWeightUnit()` returns the active unit; the new UI must call it.

### New files expected (per architecture boundaries)
- `src/utils/dates.ts` (new) — pure helpers for week bucketing. None exists today; only ad-hoc `new Date(...).toLocaleString(...)` calls live in components.
- `src/api/stats.ts` (new) OR extend `src/api/progress.ts` — query helper for "sets completed in last N weeks across all exercises, with session.started_at and ended_at".
- `src/hooks/use-stats.ts` (new) OR extend `use-progress.ts` — TanStack Query hook.
- `src/components/weekly-volume-strip.tsx` (new) — UI for the strip / tiles / mini-bars.

### Read-only references
- `src/db/schema.ts:126-170` — `sets` table (incl. `set_type`, `weight`, `reps`, `completed_at`, soft-delete `deleted_at`).
- `src/db/schema.ts:105-124` — `sessions` table (incl. `started_at`, `ended_at`).
- `src/db/types.ts:105-121` — `SetRow` shape returned by Supabase JS (snake_case, `weight: string | null` numeric).
- `src/db/types.ts:92-103` — `SessionRow` shape.
- `app/(app)/exercises/[id]/progress.tsx:29-68` — precedent for computing per-session volume from `SetRow[]` (skips warmups; parses numeric weight string; multiplies `weight * reps`).
- `app/(app)/history/[id].tsx:130-142` — second precedent for computing total volume (this one currently counts **all** sets, not just working — divergence flagged below).
- `src/components/progress-chart.tsx:1-138` — existing SVG chart primitive (`react-native-svg` `Polyline` + `Circle`); reusable if the designer prefers a line chart over bars/tiles.

## Relevant conventions (verified by reading code)

- **Data flow**: `Supabase JS client → src/api/*.ts → src/hooks/*.ts (TanStack Query) → screens/components`. Discovered in every existing feature (`src/api/sessions.ts`, `src/hooks/use-sessions.ts`, etc.). RLS enforces per-user scoping — every query auto-filters to `auth.uid() = user_id`.
- **Soft delete is universal**: every read filters `.is("deleted_at", null)` (see `src/api/sessions.ts:7-9`, `src/api/sets.ts:27`, `src/api/progress.ts:15`). Must include in the new aggregation.
- **Completed-session predicate**: `progress.ts:14` uses `.not("sessions.ended_at", "is", null)` to exclude in-progress sessions. Same precedent applies — weekly volume should only count finished workouts.
- **Working-set rule**: in `app/(app)/exercises/[id]/progress.tsx:41` the existing volume chart does `if (set.set_type === "warmup") continue;` — i.e. it counts `working` + `dropset` and excludes only `warmup`. This is the established interpretation of "working sets" for volume in this codebase. (The prompt says "working sets" — designer should explicitly choose either "exclude warmup only" (matches existing chart) or "working only, exclude warmup and dropset" (literal reading). Flagged in Unknowns.)
- **Weights stored in kg**: `sets.weight` is `numeric(6,2)` representing kg (decisions.md #8, data-model.md "Weights in kg internally"). `SetRow.weight` is `string | null` because Supabase returns numerics as strings — must `parseFloat(s.weight)` (precedent: `app/(app)/history/[id].tsx:136`, `app/(app)/exercises/[id]/progress.tsx:42`).
- **Unit display**: convert kg → user's preferred unit only at the formatter boundary via `formatWeight(kg, unit)` (precedent: `session-summary-row.tsx:63`). Internal math stays in kg.
- **NativeWind styling**: classes follow `bg-white dark:bg-black`, `text-black dark:text-white`, `text-gray-500` for muted, `border-gray-200 dark:border-gray-800` for dividers, `px-4/px-6 py-3/py-4` for padding. Header chrome via `<Stack.Screen options={{ title, headerShown: true }} />`.
- **Loading / empty / error states**: every list screen has all three branches (precedent `app/(app)/history/index.tsx:17-33`, `app/(app)/exercises/[id]/progress.tsx:70-77,96-102`). Use `ActivityIndicator` for loading, gray-500 centered message for empty.
- **Currency of "stat" components**: `progress-chart.tsx` is the only existing "stat" / chart primitive. It uses `react-native-svg` — already in deps.
- **Routing**: History tab uses an inner `<Stack>` (`app/(app)/history/_layout.tsx`); screen lives at `/(app)/history/index.tsx`.

## Constraints

- **Data**:
  - Tables touched (read only): `sets`, `sessions`. Both RLS-scoped to `auth.uid() = user_id`; no service-role bypass required.
  - Soft-delete filter (`deleted_at IS NULL`) mandatory on both.
  - Only count `sessions.ended_at IS NOT NULL` (finished workouts) — established precedent in `progress.ts:15`.
  - `set_type` filter required to honor "working sets" semantics (see Unknowns below).
  - All weights internally in kg; `SetRow.weight: string | null` → `parseFloat` then guard `Number.isFinite`.
  - All timestamps are `timestamptz` (UTC on the wire). Bucketing into "weeks" happens client-side and must be done against a chosen local timezone (likely the device locale, but ISO weeks are UTC-agnostic if everyone is in one TZ — flagged).
- **UI**:
  - NativeWind tokens listed above. Dark mode required (every screen handles both).
  - Stat strip should fit above the existing `FlatList` of sessions without breaking pull-to-refresh — use `ListHeaderComponent`.
  - Header title stays "History" (set in `history/index.tsx:15` via `<Stack.Screen>`).
- **Platform**:
  - Universal app (iOS / Android / web from one codebase). No web-vs-native divergence anywhere in the History flow today. `react-native-svg` works on all three.
  - `useWindowDimensions()` is the pattern for responsive widths (precedent `exercises/[id]/progress.tsx:26-27`).
- **Auth**:
  - Provided by `useAuth()` + Supabase JS client. All queries inherit the JWT. No new auth-context work.
- **Performance**:
  - `useSessions()` fetches **all** sessions for the user (no pagination — `src/api/sessions.ts:4-12`). Fine at single-user scale, but the new aggregation will pull all working sets across all sessions in the window. Should bound by `completed_at >= <window_start>` (e.g. last 12 weeks) to avoid pulling the full history.
  - Per-session totals are **not** currently computed in the history list (the `totalSets` / `totalVolumeKg` props on `SessionSummaryRow` exist but are never passed — see `history/index.tsx:37-43` and `session-summary-row.tsx:9-10`). The list scales sets-fetches with row count, so the current design deliberately avoids N+1. The new feature should follow the same instinct: **one** range query, not per-week sub-queries.
  - No Postgres views or aggregation functions exist (`supabase/migrations/0001_rls_and_seed.sql` only declares RLS + seed + `touch_updated_at`). Aggregation is currently 100 % client-side (`reduce` over `SetRow[]`).
  - TanStack Query persists to AsyncStorage (`src/lib/query-client.ts`; `_layout.tsx:43` `maxAge: 7 days`). New query keys cache automatically; pick a stable key like `["stats", "weekly-volume", weeks]`.

## Existing precedents

- **Volume aggregation per session**: `app/(app)/exercises/[id]/progress.tsx:29-68` — closest precedent. Same math (`weight * reps`, skip warmup, parse numeric string) but bucketed by session, not week. The designer should reuse this kernel and only change the bucketing key.
- **Joining sets with sessions**: `src/api/progress.ts:11-18` — `.select("*, sessions!inner(id, started_at, ended_at)").not("sessions.ended_at", "is", null)`. Identical join is what the new query needs (probably with `sessions!inner(started_at, ended_at)` plus `gte("completed_at", windowStart)`).
- **Range-bound query**: none in the codebase yet. All current queries fetch the full per-user history. The weekly-volume query will be the **first** range-bound read — pick a convention now (e.g. `.gte("completed_at", iso)`).
- **Chart primitive**: `src/components/progress-chart.tsx` — SVG line chart already in use on the per-exercise progress route. Reusable for "weekly trend" presentation but its API is `DataPoint[] { label, value }` — fits a weekly series cleanly.
- **Stat-line styling**: `session-summary-row.tsx:55-66` — small caps row with "metric · metric · metric" pattern, plus muted `text-gray-500`. Useful template for tiles.
- **Unit-aware display**: `app/(app)/exercises/[id]/progress.tsx:115-118` — `formatValue={(v) => v >= 1000 ? \`${(v/1000).toFixed(1)}k\` : v.toFixed(0)}`. Good idiom for compact volume display (gym volume is routinely 5-50 t/week).
- **History `[id]` "Total" line**: `app/(app)/history/[id].tsx:223-229` — already shows total volume for a single session (but counts **all** set types, including warmups — see Unknowns).

## Unknowns (require Designer judgment or human decision)

1. **"Week" definition.** Three viable readings:
   - ISO week (Mon → Sun, ISO 8601). Aligns with gym programming culturally and `date-fns`'s default `getISOWeek`.
   - Calendar week starting Sunday (US default in `Intl`).
   - Rolling 7-day buckets ending today.
   No precedent in the codebase — no current code calls `getWeek` / `startOfWeek` / etc. **`date-fns` is in `package.json` but currently unused** (`grep` found zero imports outside `node_modules`); designer can introduce it cleanly. Suggest ISO week (Mon-Sun) as the default for a fitness app.

2. **Timezone for week boundaries.** Timestamps are stored as UTC (`timestamptz`). A set completed at 23:30 BRT Sunday is 02:30 UTC Monday — on UTC bucketing it falls in the next week. Owner is single-user in BRT (per global CLAUDE.md). Use `America/Sao_Paulo` for bucketing, or device-local? Recommend device-local (matches the user's lived experience) and document the choice.

3. **"Several weeks" count.** Prompt says "the last several weeks visible at a glance". Concrete options:
   - 4 weeks (one month, minimal scroll).
   - 8 weeks (two months, common for block periodization).
   - 12 weeks (one mesocycle, fits the existing 7-day persisted-cache `maxAge` nicely).
   Recommend 8 as the default. Could also expose as a horizontal scrollable strip showing more weeks if the user has the history.

4. **"Working sets" definition — strict or loose?**
   - Strict (literal): only `set_type === 'working'`. Excludes warmups and dropsets.
   - Loose (matches existing per-exercise volume chart at `app/(app)/exercises/[id]/progress.tsx:41`): everything except `warmup`. Includes dropsets, because they're working effort.
   - Current single-session total at `history/[id].tsx:130-142` is even looser — counts **everything** including warmups. This is arguably a bug.
   Recommend "loose" (matches the existing per-exercise progress chart) for consistency, and flag the single-session total as inconsistent for a follow-up. **Designer must pick one and call it out explicitly.**

5. **Empty-state behavior.**
   - User with zero finished sessions: do not render the strip at all? Or render placeholder zeros for each week?
   - Week within the window where the user did not train: show "0 kg" tile, "Rest" label, blank tile, or omit?
   No precedent. Recommend: don't render the strip when there are no finished sessions in the window (matches the "no sessions yet" empty state on the list below). When some weeks are zero, render an explicit "0" tile so the gap is visible (rest weeks are meaningful information for the owner).

6. **Visual treatment — tiles, bars, mini-chart, or chip strip?**
   No precedent for a "stat tile" component. `ProgressChart` exists but is a line chart designed for many points. The phrase "at a glance" + only 4-12 buckets suggests bars or stat tiles rather than a line. Designer's call.

7. **Interaction.** Should tapping a week navigate to a filtered session list, drill into that week's sessions, or be non-interactive? Prompt doesn't say. Recommend: non-interactive in v1 (cheapest), follow-up for drilldown.

8. **Live in-progress session.** Current week may contain an in-progress session. Precedent (`progress.ts:14`) excludes in-progress sessions from progress aggregations. The current week's number will therefore "jump" when the session is finished. Acceptable but worth a callout in design.

9. **Unit toggle reactivity.** When the user changes weight unit on Profile (`useSetWeightUnit`), the strip must re-render. `useWeightUnit()` is a TanStack Query subscription — this is automatic if used directly inside the component. Note for the implementer, not a blocker.

10. **`date-fns` adoption.** Introducing it for the first time is a low-risk dep change (already installed), but it's still a "first import" decision. Alternative: hand-roll a small `startOfISOWeek(d): Date` in `src/utils/dates.ts` (~20 lines). Recommend using `date-fns` — it's already paid for and tree-shakes well.

## Out-of-scope flags

- **Backfilling per-session totals on the existing list rows.** The `SessionSummaryRow` accepts `totalSets`/`totalVolumeKg` but the list doesn't pass them today. Tempting to fix while here, but it requires either an aggregated server query or fetching sets for every visible session — separate feature, separate decision. Do not bundle.
- **Fixing the single-session "Total volume" inconsistency** at `app/(app)/history/[id].tsx:130-142` (counts warmups). Note it for a follow-up, do not change in this run.
- **A new Postgres aggregation view / function.** Tempting but adds a migration; the data volume at one user × ~12 weeks × ~30 sets/week ≈ 360 rows is trivially client-aggregatable. Defer until there is real pain.
- **Adding a chart route under `/history/<something>`.** The prompt asks for "visible at a glance" on the History screen — keep it in-page, not a new route.
- **Volume per exercise / per muscle group breakdown.** Out of scope; the prompt is explicit about a single aggregate number per week.
- **Comparison to previous week / streak indicators / goals.** Not in the prompt.
- **Drilldown navigation from a week tile.** See Unknown #7.
- **Pagination of the underlying sessions list.** Already unpaginated; do not couple this work to a list refactor.
