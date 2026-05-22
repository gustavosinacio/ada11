# Discovery — 2026-05-22_0030_progress-page

## Feature prompt

> New Progress tab + page. Dedicated top-level surface for momentum visibility. All comparisons use "lifetime best" as the anchor (never "previous week" or "previous session" alone) — matches the live-strip's existing `Max · Now · To PR` shape and is the only honest progress signal.
>
> Page structure, top → bottom:
> - **Hero**: `PRs this week: N` headline + weekly volume `Max · Now · To PR` (lifetime-best comparison).
> - **Bars**: richer version of the weekly-volume chart currently on History. History mini-strip stays where it is.
> - **List**: exercises trained this week, grouped by muscle group, each row shows per-exercise `Max · Now · To PR` (uses same per-session-max definition as the live strip).
> - **Cards**: streak — current consecutive weeks with ≥1 finished session + best-ever streak.
>
> Architecture: new bottom-tab entry "Progress". ISO week (Monday-Sunday, BRT) window. Empty state copy for early-week. No schema change. May need to extend `listWeeklyVolumeRows` to unbounded scope OR add a new aggregate API.
>
> Accepted trade-off: lifetime-best anchor is strict; one outlier-peak week makes every normal week show regression. Soften only if it bites.

(BRT-absolute today is 2026-05-21 — the current ISO week is `2026-W21`, Monday 2026-05-18 → Sunday 2026-05-24.)

## Scope summary

Add a fifth bottom-tab "Progress" with a dedicated screen aggregating four blocks: a hero (PRs-this-week count + weekly-volume `Max · Now · To PR`), a richer weekly-volume bar chart, a per-exercise list grouped by muscle for exercises trained this week (each row `Max · Now · To PR`), and a streak card. All "Max" anchors are lifetime-bests (best ISO week ever for the hero, best single-session volume ever for each exercise row), and "Now" is the in-progress current ISO week's value. Read-only screen; no mutations; no schema change.

## Affected files (verified)

### New files (will be created by Implementer)

- `app/(app)/progress/_layout.tsx` — header-only Stack layout, mirrors `app/(app)/history/_layout.tsx` / `app/(app)/workout/_layout.tsx` (each is a one-line `<Stack screenOptions={{ headerShown: false }} />`).
- `app/(app)/progress/index.tsx` — the Progress screen.
- `src/api/progress-page.ts` (or extension of existing files) — new aggregate read(s).
- `src/hooks/use-progress-page.ts` (or extensions to `use-stats.ts` / `use-progress.ts`).
- Pure helpers for streak math, PR-this-week count, weekly-volume kernel over unbounded scope, per-exercise lifetime-best volume — likely in `src/utils/` (e.g. `progress-page-math.ts`) so they can be unit-tested.
- `tests/unit/progress-page-math.test.ts` — kernel tests.
- `tests/e2e/progress-page.spec.ts` — at minimum: empty-state, populated-state, navigation from a row, tab visibility.

### Existing files that will be edited

- `app/(app)/_layout.tsx:12-65` — add a 5th `<Tabs.Screen name="progress" …>` registration alongside the existing four (Workout, Exercises, History, Profile) plus the two hidden tabs (Routines, Measurements). Comment at lines 16-25 about `backBehavior="history"` must be preserved.
- `docs/features.md:3-18` — move the spec from the "[ ]" pending list to the "## Done" section once the feature ships (a Conductor-step concern, not Implementer).

### Existing files referenced read-only by the new code

- `src/db/types.ts:32-57, 59-70, 98-128` — `SetType`, `MuscleGroup`, `MUSCLE_GROUPS`, `ExerciseRow.muscles: string[]`, `SessionRow`, `SetRow.completed_at` nullability.
- `src/utils/dates.ts:1-72` — `isoWeekStart`, `weekKeyOf`, `lastNIsoWeeks`, `parseISO`. These are the canonical ISO-week helpers; do NOT introduce parallel ones.
- `src/utils/units.ts:33-40` — `formatVolume(kg, unit)` for displaying aggregate kg in the hero + per-row.
- `src/utils/volume-target.ts:111-165` — `computeVolumeTarget({ pastSessions, currentSessionSets })` and the discriminated `VolumeTargetState` union (`no-pr` | `chasing` | `surpassed`). This is the canonical per-exercise `Max · Now · To PR` semantic.
- `src/api/stats.ts:1-33` — `listWeeklyVolumeRows({ sinceUtc })` and the `WeeklyVolumeRow` type. The "extend to unbounded" or "add new aggregate" decision in the prompt centers on this file.
- `src/api/progress.ts:1-39` — `listSetsForExercise(exerciseId)` returns `SessionSets[]` grouped by session, finished-only, soft-delete-aware.
- `src/api/sessions.ts:4-12` — `listSessions()` returns all non-deleted sessions ordered by `started_at` desc.
- `src/api/exercises.ts:11-19, 36-44` — `listExercises()` (excludes soft-deleted; for the per-row library) vs `listAllExercises()` (includes soft-deleted; for history surfaces). The Progress page is a hybrid: it shows exercises trained THIS WEEK, so the list should include soft-deleted ones if they appear in this week's sessions (matches the precedent set in `app/(app)/history/[id].tsx:45`).
- `src/components/weekly-volume-strip.tsx:1-146` — existing strip component; the "richer bars" block should reuse the same `WeeklyVolumeRow` data shape and the same height-mapping formula but render over a different (longer) window. Don't fork this component; either parametrize the existing one or write a sibling that shares the same bucketing kernel.
- `app/(app)/history/week/[isoWeek].tsx:1-228` — the drill-down screen the existing strip taps into. The richer Progress chart should keep this route as the per-bar destination.
- `app/(app)/history/index.tsx:1-62` — confirms the History mini-strip is mounted via `ListHeaderComponent={<WeeklyVolumeStrip />}` (line 48). Per prompt, this stays put.
- `src/components/exercise-block.tsx:148-159`, `src/components/exercise-list-item.tsx:12-14`, `src/components/routine-exercise-row.tsx:57-72` — the established convention for rendering muscles: `muscles.join(", ")` with `mt-0.5 text-sm text-gray-500`. The per-exercise list rows on Progress should follow the same idiom.
- `app/(app)/exercises/[id]/progress.tsx:1-155` — the existing per-exercise progress screen; this is the navigation destination when a list row is tapped (already wired in the App; just `router.push(/(app)/exercises/${id}/progress)`).
- `src/components/progress-chart.tsx:1-138` — the SVG line-chart used on the per-exercise progress and measurements screens. Available if the "richer bars" wants tick marks/labels at the level of the existing `ProgressChart`, but **bars are different from lines** — see Unknown #7.
- `src/hooks/use-stats.ts:6-27`, `src/hooks/use-progress.ts:5-12`, `src/hooks/use-sessions.ts:15-19` — TanStack Query cache keys. New keys must not collide.

## Relevant conventions (verified by reading code)

- **Bottom-tab registration**: `app/(app)/_layout.tsx:26-63` — every visible tab is a `<Tabs.Screen name=… options={{ title, tabBarIcon }} />` block; hidden routes (Routines, Measurements) use `options={{ href: null }}`. Icons come from `lucide-react-native`; size + color come from the `tabBarIcon` render-prop's args.
- **Tab routing structure**: each tab's folder under `app/(app)/<name>/` contains a `_layout.tsx` (a one-liner `<Stack screenOptions={{ headerShown: false }} />`) plus an `index.tsx` for the tab root. Verified across `workout/`, `history/`, `exercises/`, `measurements/`.
- **Header style**: tab roots use `<Stack.Screen options={{ title: "<Tab name>", headerShown: true }} />` inside the screen body (see `history/index.tsx:26`, `exercises/index.tsx`, `measurements/index.tsx`). Profile (no nav stack inside) writes the title inline as a regular `<Text>` instead.
- **Page chrome**: every screen uses `className="flex-1 bg-white dark:bg-black"` as the root container background. `text-black dark:text-white` for primary text, `text-gray-500` for secondary, `text-gray-500 dark:text-gray-400` for de-emphasised secondary.
- **ScrollView vs FlatList**: list-like surfaces use `FlatList` with `ListHeaderComponent` for the strip and `data` for the rows (see `history/index.tsx:45-58`, `measurements/index.tsx:73-87`); detail screens use `ScrollView contentContainerClassName="pb-12"` (see `profile.tsx:25-28`, `history/week/[isoWeek].tsx:194-197`). The Progress page is closer to a detail/dashboard layout (4 different blocks, no flat repeating data) — a single `ScrollView` is the precedent fit.
- **Pull-to-refresh**: list screens pass `refreshing` + `onRefresh` to the FlatList. Two query refetches combine via `Promise.all([refetch(), refetchOther()])` (see `history/index.tsx:14-22`). The Progress page should support refresh too because every block is a derived read.
- **Aggregate volume kernel**: parse weight with `parseFloat(weight)` (string column), filter `set_type !== "warmup"`, guard `w > 0 && r > 0`, sum `w * r`. The kernel is duplicated 4 times today (`weekly-volume-strip.tsx:43-51`, `volume-target.ts:58-69, 78-89`, `exercises/[id]/progress.tsx:73-93`). The Progress page's new aggregates should follow the same predicate so numbers stay consistent across screens.
- **Finished-only filter**: every "lifetime" or "history" read filters by `sessions.ended_at IS NOT NULL` server-side (`stats.ts:27`, `progress.ts:14`, `sets.ts:113`). In-progress sessions never count toward Now or Max.
- **Soft-delete handling**: `is("deleted_at", null)` on the sets table; **soft-deleted exercises** are explicitly included in history surfaces (see `useAllExercises` and the comment chain at `api/exercises.ts:32-44`, `history/[id].tsx:41-46`). The "exercises trained this week" list must include them too — otherwise sessions that referenced a deleted exercise would silently drop rows.
- **Query keys (cache-key tree)**: `["stats", …]`, `["progress", exerciseId]`, `["sessions", …]`, `["exercises", …]`. Mutations invalidate by prefix (`use-sessions.ts:62-63` invalidates `["stats"]` + `["progress"]` on session finish). New keys should slot under one of these prefixes so existing invalidations cascade correctly.
- **No persistence of derived aggregates**: every aggregate is computed at read time from `sets` + `sessions`. There is no PR table, no denormalized weekly_volume table (deferred in `roadmap.md:124` and `docs/decisions.md` — confirmed by reading the schema in full).
- **ISO week math is local-time, not UTC**: `dates.ts:9-16` — explicitly uses `startOfWeek/endOfWeek` against local Date getters so a Sunday 23:30 BRT set lands in its own week. The `weekKeyOf` returns `RRRR-'W'II` derived from the local Monday. The Progress page MUST use these helpers as-is.
- **`formatVolume` is `Math.round`'d kg with `en-US` thousands separator** (`utils/units.ts:33-40`) — render exactly this way on the new screen so the hero's "Max 26,210 kg" matches the strip.

## Constraints

- **Data**:
  - Tables touched (read-only): `sets`, `sessions`, `exercises`. All have RLS `auth.uid() = user_id`. No new policies needed; RLS scopes everything automatically.
  - No new column, no new index, no new table. The existing `sets_exercise_completed_idx (exercise_id, completed_at)` covers the per-exercise lifetime-max query well; the `sessions_user_started_idx (user_id, started_at)` covers session-set scans.
  - "Lifetime best week" requires reading every non-warmup, non-deleted, finished-session set the user has — see Specific Question #2 for size analysis.
  - `parent_set_id` chain on dropsets — the existing weekly-volume kernel treats dropsets as regular working volume (`set_type !== "warmup"`); the Progress page must match.

- **UI**:
  - 5th bottom tab on iPhone widths. Lucide icons render at `size` from React Navigation's tab bar (~22-24 px default). Labels: current tabs are `Workout / Exercises / History / Profile`. Adding `Progress` → 5 labels at ~64 px per tab on a 320 px iPhone SE width = 5×64 = 320 — fits exactly, no truncation expected. iPhone 12 mini and up are 360+ px → comfortable. See Specific Question #1.
  - NativeWind class patterns: `border-b border-gray-200 dark:border-gray-800`, `px-4 py-5`, `text-2xl font-semibold`, `text-xs uppercase tracking-wide text-gray-500` (uppercase eyebrow) — established by the existing `<WeeklyVolumeStrip>` and the History list.
  - Section grouping (muscle group headers): no existing precedent in this codebase for grouped lists; closest is the muscle-pill chip pattern in `MuscleGroupPicker`. Designer will need to pick one (sectioned list / collapsible accordions / plain headers). Plain section headers like `"mt-4 mb-2 text-sm font-medium uppercase text-gray-500"` from `history/week/[isoWeek].tsx:23-24` are the in-repo idiom.
  - `tabular-nums` on numeric values (used in `volume-target-slot.tsx`, `session-summary-row.tsx`) keeps columns of numbers stable when the digit set changes.
  - Empty-state copy precedent: `history/index.tsx:40-43` ("No sessions yet. Finish your first workout and it will appear here."); `exercises/[id]/progress.tsx:128-133`; `history/week/[isoWeek].tsx:210-214`. Tone: one sentence, calm, action-oriented.

- **Platform**:
  - Pure React Native + NativeWind + lucide-react-native; renders identically on iOS, Android, web. No platform divergence.
  - The richer bar chart can be a wider/taller version of the existing strip (same RN Views with width + height styles), or a `react-native-svg` chart like `ProgressChart`. RN-Skia is NOT a dependency today; introducing it for one chart is scope creep — see Specific Question #7.

- **Auth**:
  - Reads via the existing `supabase` JS client. RLS = `auth.uid() = user_id`. The screen is mounted inside `(app)/` which already gates on auth via the parent `app/_layout.tsx`.

- **Performance**:
  - The hero's "lifetime best week" requires aggregating across the full history of `sets`. At a typical lifter's volume (~3-5 sessions/week × ~30 working sets each × 2-3 years) = ~10-15k rows. Filtered by `deleted_at IS NULL`, `set_type != 'warmup'`, joined to `sessions.ended_at IS NOT NULL`, the result set is still under 10k rows on the client. PostgREST can return this in one round-trip; the client reducer is O(N) — sub-100ms even on a low-end device. Two scaling options analysed in Specific Question #2.
  - The per-exercise list (Q5/Q4 below) loops over distinct exercises trained THIS WEEK (typically 5-20 exercises). For each, computing "lifetime best per-session volume" requires reading all that exercise's past sets (already supported by `useExerciseProgress(id)` / `listSetsForExercise(id)`, but firing 5-20 of those queries in parallel is wasteful: each is a separate round-trip). Designer should consider a single aggregate query that returns `(exercise_id, session_id, sum(weight*reps)) GROUP BY exercise_id, session_id` over the user's lifetime, then reduce client-side. PostgREST does not support `GROUP BY` without a view/RPC, so this is a tradeoff between (a) one large flat row scan + client reduction, (b) N parallel `useExerciseProgress` queries, (c) a new Postgres function. Validator/Designer call.
  - Cache reuse: `useExerciseProgress(id)` is already invalidated correctly on session finish (`use-sessions.ts:62-63`); the Progress page's `current_isoweek` derivations should subscribe to the same `["stats", …]` + `["progress", …]` prefixes so existing finish-mutation invalidations propagate.

## Existing precedents

- **Multi-block dashboard scrolling layout**: `app/(app)/profile.tsx:25-146` — `ScrollView` with `contentContainerClassName="px-6 pt-16 pb-12"`, a vertical stack of independent blocks each with their own `border` + `rounded-lg` container. Closest existing precedent to the Progress page's structure.
- **`ListHeaderComponent` style stat-strip**: `app/(app)/measurements/index.tsx:76` mounts `<MeasurementsProgressStrip />` (line 76); `app/(app)/history/index.tsx:48` mounts `<WeeklyVolumeStrip />`. Both follow the same pattern: a contained card-shaped block above the list, with `border-b border-gray-200 px-4 py-5 dark:border-gray-800`. The Progress page's hero block should follow this idiom.
- **Per-exercise volume target line**: `src/components/volume-target-slot.tsx:78-107` (chasing) and `:122-141` (surpassed/matched) — this IS the visual + semantic template for each per-exercise row on the Progress page list. The kernel is `computeVolumeTarget` (verified at `volume-target.ts:111`). Reusing this slot's chasing-branch styling for the per-exercise list rows is the canonical move.
- **Hero with big numeric** (`text-2xl font-semibold text-black dark:text-white` over an eyebrow `text-xs uppercase tracking-wide text-gray-500`): `weekly-volume-strip.tsx:102-107`, `measurements-progress-strip.tsx:57-60`. Direct template for the hero PR-count + weekly-volume number.
- **Bar chart**: `weekly-volume-strip.tsx:109-143` — a `flex-row gap-1.5` of `Pressable` columns, each a `<View style={{ height, marginTop }} className={barCls} />` baseline-aligned bar plus a date label below. The "richer" Progress version should reuse this idiom (wider window, more bars, optional value labels) rather than introducing a new chart type.
- **Pure helper + co-located test**: `src/utils/volume-target.ts` + `tests/unit/volume-target.test.ts`; `src/utils/dates.ts` + `tests/unit/dates.test.ts`. Aggregation math should follow this layout.
- **`docs/runs/2026-05-21_2225_multi-metric-strip/`** — the immediately prior run that shipped the live per-exercise `Max · Now · To PR` strip. The Progress page reuses the same kernel verbatim for the per-exercise list and the same display shape for the hero. Conventions established there:
  - "Max" = best-ever single-session aggregate volume (per exercise), via `sumPastVolume(SessionSets[i].sets)` reduction (`volume-target.ts:58-69`).
  - "Now" = current-session checked-only volume (per exercise), via `sumLiveVolume`. For the Progress page's "current ISO week" context, "Now" is the sum across all finished sessions in the current week (so `completed_at IS NOT NULL` is implicit because `listWeeklyVolumeRows` already only reads finished sessions). No `sumLiveVolume`-style draft filter needed at week granularity.
  - "To PR" = `Max - Now` when positive, surpassed/matched branch otherwise.

## Answers to specific questions

### 1. Tab infrastructure (5th tab on iPhone widths)

- **Current wiring**: `app/(app)/_layout.tsx:26-63` uses `expo-router`'s `<Tabs>` with `backBehavior="history"`. Four visible tabs (`workout`, `exercises`, `history`, `profile`) and two hidden ones (`routines`, `measurements`) via `options={{ href: null }}`. Each visible tab specifies `title` + `tabBarIcon` from `lucide-react-native`.
- **Adding a 5th tab**: drop a `<Tabs.Screen name="progress" options={{ title: "Progress", tabBarIcon: ({color, size}) => <Icon color={color} size={size} /> }} />` block alongside the others. No additional config needed; expo-router infers screen URL from `name`. Verified by reading the existing four registrations.
- **Layout/width concern**: React Navigation's bottom tab bar distributes tabs with `flex: 1` per tab. At 5 tabs on a 320 px iPhone SE → 64 px per tab including icon + label. Existing tab labels are `Workout` (7 chars), `Exercises` (9), `History` (7), `Profile` (7). `Progress` (8) sits between them — within the same character envelope. Standard tab bar font is ~10-11 px; `Progress` measures ~52 px wide at that size, fits comfortably under the icon. No truncation expected. (Fact: verified by the existing `Exercises` label at 9 characters rendering without truncation on the same widths.)
- **Hidden-route side effect**: none. The hidden routes stay hidden; the new visible tab joins the existing four.
- **Active session banner**: `<ActiveSessionBanner />` (line 15) sits above `<Tabs>` — unchanged. The banner is the persistent "you have an in-progress workout" hint; it must keep working across tab switches including to the new Progress tab.
- **Icon picking** (not a constraint, but useful for the Designer): `lucide-react-native` exports candidates like `TrendingUp`, `Activity`, `BarChart`, `Target`, `Award`, `Flame`, `Sparkles`. The prompt says "icon TBD". This is a Designer call. (No icon-collision risk — the existing four are `Dumbbell`, `Wrench`, `History`, `User`.)

### 2. Existing weekly-volume kernel scope: extend vs new aggregate

`listWeeklyVolumeRows({ sinceUtc })` in `src/api/stats.ts:18-33` currently reads every non-warmup, non-deleted, finished-session set with `completed_at >= sinceUtc`. The strip's caller (`use-stats.ts:18-26`) passes `sinceUtc = lastNIsoWeeks(8)[0].start.toISOString()` to limit the window to 8 weeks.

For "lifetime best week", the lower bound disappears (or becomes `'1970-01-01'`).

**Option A — drop the date filter on the same API**:
- Pro: no new code surface; the kernel that bucket the strip already handles any number of rows.
- Pro: one network round-trip serves both the strip (filters client-side) and the hero (uses all of it).
- Pro: cache reuse — a single `["stats", "weekly-volume", "lifetime"]` query can be re-used by both screens.
- Con: row count for a 3-year-active user with 30 working sets/session × 3 sessions/week × 156 weeks = ~14,000 rows. PostgREST returns these in one JSON response (~700 KB at ~50 bytes/row). Network is the bottleneck on the gym wifi; this is ~3 seconds on a slow connection.
- Con: every existing call site that uses the 8-week query will get 14k rows it doesn't need unless we keep two parallel surfaces.
- Con: PostgREST has a default row limit of 1000 unless overridden via `range` or `limit`. Without an explicit unbounded `limit`, the response silently truncates and `Max` is wrong.

**Option B — new server-side aggregate** (e.g. a Postgres function `weekly_volume_aggregate()` returning one row per ISO week with `(week_start, total_kg)`):
- Pro: response is small (~52 weeks per year × 3 years = ~156 rows, ~10 KB).
- Pro: lifetime-max is a single `MAX(total_kg)` reduction client-side, trivial.
- Pro: no PostgREST row-limit concern.
- Con: introduces a custom Postgres function. The architecture currently has only `seed_new_user` and `touch_updated_at` triggers (`roadmap.md:135`); adding an RPC is a step outside the "thick database, thin server but no custom logic" pattern of v1.
- Con: new migration file (`0009_weekly_volume_aggregate.sql`), new RPC call in `src/api/stats.ts`, new Drizzle-side awareness if we want type generation. Schema-level change to the deployment.
- Con: requires `db:push` step before the feature is testable on local dev — slower iteration.

**Option C — paginated lifetime read** (re-issue `listWeeklyVolumeRows` in chunks via `range`):
- Pro: bypasses the row limit without an RPC.
- Con: complex client logic, worst of both worlds.

The Designer should pick A or B. Default leaning (verified evidence, not opinion): **A is the smaller change** (one query function param + one cache key), **B is the cleaner long-term architecture**. The prompt language ("MAY need to extend `listWeeklyVolumeRows` to unbounded scope OR add a new aggregate API") gives both as live options.

### 3. Lifetime best week math

Verified semantic from `weekly-volume-strip.tsx:38-65`:
```
for each set: w = parseFloat(row.weight), r = row.reps ?? 0
if (Number.isFinite(w) && w > 0 && r > 0) total_for_week[weekKey] += w * r
```
where rows are pre-filtered server-side to `deleted_at IS NULL`, `set_type != 'warmup'`, `sessions.ended_at IS NOT NULL`.

Lifetime best week = `max(total_for_week[weekKey])` across every weekKey that has rows. Confirmed: this is the same shape as the existing 8-week strip's `model.maxKg`, just over an unbounded window. There is no schema change and no different filter.

Empty-history user (no rows): `maxKg = 0`. The hero must handle this branch — see Question #8.

### 4. PRs-this-week count

Working definition: "a PR fires when a single session's volume for an exercise exceeds the previous best single-session volume for that exercise across the user's full history". This is the SAME PR definition used by the live strip's `surpassed` branch (`volume-target.ts:131-138`).

**Computation**:
1. Gather every finished session in the current ISO week (those with `started_at` in `[Monday, Sunday]` BRT, `ended_at != null`, `deleted_at IS NULL`).
2. For each (session, exercise) pair in those sessions, compute that session's exercise-volume (`sumPastVolume`).
3. Compare against `max(sumPastVolume(prior session for same exercise))` over ALL of that user's prior finished sessions (i.e. across the user's entire history before the candidate session's `started_at`).
4. Count = number of (session, exercise) pairs where the candidate volume > prior max.

**Cost / data shape**:
- Naive client-side: load `listSessions()` (all finished sessions, lightweight — ~156 rows for a 3-year user) and load `listSetsForExercise()` for each distinct exercise trained this week. For ~10 exercises this week and ~150 past sessions, the calls fan out but each is small.
- Smarter: a single query reading every working/dropset set joined to its session, grouped client-side by `(exercise_id, session_id)`, computed once. ~10-15k rows for a 3-year user — same row count as Option A in Q2. If we already pay that cost, the PR count comes "for free" from the same dataset.
- Cleanest: a Postgres function returning `(exercise_id, session_id, started_at, session_volume_kg, rank_desc)` so the client just filters `rank_desc == 1 AND started_at IN current_iso_week`. Same B-vs-A tradeoff as Q2.

**Edge cases** that the Designer must lock down:
- **First-ever session for an exercise**: there's no "previous best". Does that count as a PR? (The live strip returns `no-pr` and hides the surpassed message. The PR-this-week count should match — first session is NOT counted as a PR, otherwise every brand-new exercise pollutes the headline.)
- **Multiple PRs in the same week for the same exercise**: if the user trains bench 3× in a week and each session beats the previous one, are those 1 PR or 3 PRs? Live strip's semantic is "1 per exercise per beat". For a weekly headline, counting each new high feels more truthful (motivational), but it inflates against monthly trends. Designer decision.
- **Warm-ups** must be excluded from the per-session volume (consistent with the live strip).
- **Soft-deleted exercises** that hit a PR this week — should still count if the exercise existed at the session time (RLS doesn't care; the soft-delete is a UI flag).

### 5. Per-exercise list grouped by muscle

- **Data shape (verified)**: `ExerciseRow.muscles` is `string[]` (`src/db/types.ts:63`). The 7-value `MuscleGroup` enum (`MUSCLE_GROUPS` at `src/db/types.ts:49-57`): `Chest, Upper back, Lower back, Shoulders, Arms, Legs, Core`. The picker (`muscle-group-picker.tsx:13-19`) is a multi-select; users CAN tag an exercise with multiple muscles. There is no "primary muscle" concept — verified by reading the schema (`schema.ts:50` is just `text("muscles").array().notNull()`) and the form (`exercises/[id]/index.tsx:138-146` uses `MuscleGroupPicker`, multi-select). The migration `0004_exercise_muscles_array.sql` (lines 17-37) explicitly maps the legacy `primary_muscle` into a single-element array, but new-form entries are multi-select.
- **Convention for display when multiple**: `muscles.join(", ")` (`exercise-list-item.tsx:13`, `exercise-block.tsx:152`, `routine-exercise-row.tsx:70`). No "primary" treatment.
- **Decision required** (Designer): when grouping by muscle, an exercise tagged `[Chest, Shoulders]` either (a) appears in BOTH groups (duplicates math), (b) appears in the FIRST listed muscle only (treats `muscles[0]` as primary even though the form doesn't), or (c) appears in a synthetic "Multi" group. No in-repo precedent — pick one. The friendliest UX is probably (b) — first muscle as the grouping key — which preserves the user's explicit ordering in the multi-select chip array, and keeps each row to one place.
- **Untagged exercises**: `muscles` defaults to `[]` (`schema.ts:50` `default(sql\`'{}'::text[]\`)`). Some seeded or imported exercises may have an empty array. The Designer should pick a fallback group label — "Other" or "Untagged" — and apply it consistently. Precedent for the empty-fallback chip: `exercise-list-item.tsx:13` renders `null` (no subtitle) when muscles is empty; that doesn't translate to grouping.
- **Group order**: `MUSCLE_GROUPS` defines the canonical order (`src/db/types.ts:50-56`). Use it.

### 6. Streak math

- **Definition (per prompt)**: a "trained week" = an ISO week with ≥1 finished session. Current streak = number of consecutive trailing weeks (newest → oldest) meeting this, ending at the current week if the current week qualifies. Best streak = longest such run in history.
- **Data path**: `listSessions()` (`src/api/sessions.ts:4-12`) returns every non-deleted session ordered DESC. Filter to `ended_at != null`, bucket by `weekKeyOf(parseISO(s.started_at))`. Stream pairs `(weekKey, count > 0)` → standard "longest run of 1s" algorithm.
- **Sets table not needed** — confirmed by the prompt and the definition. Sessions alone determine training presence.
- **Edge case — current in-progress week**: per the spec ("finished sessions only"), the current week does NOT count toward the streak if no session in it is finished yet. If the user is mid-session on Tuesday with no finished session yet this week, the current streak shows 0 (or the count up to last week's end). If they finished one session yesterday, the streak includes the current week. Designer should confirm the rendering choice when current-streak is 0 (the spec hints "best streak so a break is contextualised rather than punishing" — implying the best-streak card is the soft fallback).
- **Edge case — user just started**: 0 sessions total → both streaks are 0. The cards should still render (showing `0 / 0`) or be hidden — Designer decision; precedent: the live-strip returns `null` when there's no data, but a streak card that never appears is harder to discover. Suggested default: render `Current 0 weeks · Best 0 weeks` with the empty-state copy folded into the card.

### 7. Chart component: reuse vs new

- **Existing strip** (`weekly-volume-strip.tsx:109-143`): hand-rolled bar chart using `flex-row gap-1.5` of `Pressable` columns. Each column = one `View` baseline-aligned bar + a date label. Constants: `PLOT_HEIGHT = 96`, `MIN_BAR_HEIGHT = 4`, `WEEKS_WINDOW = 8`. Width fluid (`flex: 1` per column). Color: blue for current, gray for past, very light gray for zero-volume.
- **"Richer" requirements** (implied by prompt, not stated): probably more weeks (12-26 weeks worth?), maybe value labels on bars, maybe Y-axis tick marks, possibly an interaction (hover/tap → numeric tooltip). All achievable as parameters on a refactored `<WeeklyVolumeStrip>` or as a sibling `<WeeklyVolumeChart>` that shares the same bucketing helper (`computeStripModel`).
- **`<ProgressChart>` reuse?** `src/components/progress-chart.tsx:1-138` is an SVG LINE chart with grid lines, dot markers, Y-tick labels, polyline path. It's the right structural template for "richer" chart chrome — but bars are not lines. Realistic options: (a) extend `<WeeklyVolumeStrip>` to accept a `weeksWindow` prop + an optional `showValueLabels` prop and call it twice; (b) write a `<WeeklyVolumeChart>` sibling that uses `react-native-svg` for proper Y-axis ticks + bars (mirrors `ProgressChart`'s SVG approach); (c) introduce a charting library.
- **RN-Skia**: NOT a dependency today (`package.json` does not list it — `react-native-svg` is the chart primitive in use). Adding Skia for one chart is scope creep without a measurable benefit at the data sizes here.
- **The dominant question for the Designer**: how rich is "richer"? If the answer is "wider window + labels" → option (a). If it's "y-axis grid + tooltips" → option (b). If it's "interactive zoom/pan" → defer or pick a real library. Bias toward (a) given the rest of the codebase's minimalism.

### 8. Empty / early-week states

Verified empty-state precedents (all use `text-center text-base text-gray-500` and a one-sentence message):
- `history/index.tsx:40-43` — "No sessions yet. Finish your first workout and it will appear here."
- `exercises/[id]/progress.tsx:128-133` — "No working sets recorded yet. Complete a workout with this exercise to see progress."
- `history/week/[isoWeek].tsx:210-215` — "No sessions this week."

**Per block, on a Tuesday morning of an unloaded current week** (but with prior history):

- **Hero — PRs this week**: `"0"` (no special chrome; just a number). PRs is a count, not a measurement.
- **Hero — Weekly volume Max·Now·To PR**: `Max = lifetime best` (non-zero), `Now = 0`, `To PR = Max`. Renders identically to the chasing branch of `<VolumeTargetSlot>` with Now=0. (Note: at the per-exercise live-session level the slot HIDES the reps clause when `runningKg === 0` per the multi-metric-strip run's MAJ-1 fix — but the weekly hero has no "reps clause" so this branch is moot.)
- **Bars (richer chart)**: Renders with current bar at minimum height (4 px), past bars present. Same behavior as the existing strip's current week before any logging.
- **List of exercises trained this week**: EMPTY. The prompt explicitly says "exercises trained this week" — if none, the list shows the early-week empty-state copy ("Go log a session to start the week" per the prompt's suggestion at line 16 of `docs/features.md:15`).
- **Streak cards**: If last week qualified, current streak might still tick toward 0 once we cross Monday with no finished session. Best streak is unchanged. Render `Current 0 weeks · Best N weeks`.

**Day-zero new user** (no history at all): every block has `Max = 0`, no PRs, no exercises, streak `0/0`. The honest UX is to hide the per-exercise list and weekly bars (matches the existing strip's `if (model.maxKg === 0) return null;` branch at `weekly-volume-strip.tsx:95`). The hero may still render with a flat "Log your first session" CTA — Designer call.

### 9. Test infrastructure

- **Unit test** for `lastNIsoWeeks` / `weekKeyOf` / `isoWeekStart` (`tests/unit/dates.test.ts`) — 14 tests verified at lines 5-121.
- **Unit test** for the strip kernel (`tests/unit/weekly-volume-bucketing.test.ts`) — 7 tests verified at lines 46-159.
- **Unit test** for the volume-target math (`tests/unit/volume-target.test.ts`) — 17 KB, covers chasing/surpassed/no-pr; the Progress page's per-row math is the same kernel.
- **E2E**:
  - Tab navigation: `tests/e2e/crud.spec.ts:89, 138, 191, 391` and `auth.spec.ts:301-303` confirm the bottom-tab selector pattern: `await page.getByText("<Label>", { exact: true }).first().click();`. The Progress tab will work the same.
  - Weekly volume strip: `tests/e2e/weekly-volume-strip.spec.ts` (10.9 KB, 287 lines) — dynamic seeding via admin API, sign-in, assert visible text. The Progress page's e2e can follow the same skeleton.
  - Week drill-down: `tests/e2e/week-drill-down.spec.ts` — assertions on the per-bar `Pressable` → `/history/week/<isoMonday>` navigation. If the Progress bars link to the same destination, that flow should continue to work.
  - Volume target: `tests/e2e/volume-target.spec.ts` — golden path for the per-exercise live strip; the Progress page reuses the same kernel so this is the regression baseline.

The Implementer should expect to write:
- One unit test file for the new aggregate helpers (PRs-this-week, streak, lifetime best week, per-exercise-this-week list grouped by muscle).
- One e2e for the Progress page end-to-end (empty user, populated user, navigation).

### 10. Risks / unknowns

- **Cache key collisions**: existing `["stats", "weekly-volume", "<since-date>"]` keys (`use-stats.ts:23`). New keys should use `["stats", "weekly-volume", "lifetime"]` or a separate prefix like `["stats", "progress-page", "<current-iso-week>"]`. As long as the new key is a strict tuple prefix of `["stats", …]`, the existing `invalidateQueries({ queryKey: ["stats"] })` in `useFinishSession` (`use-sessions.ts:62`) cascades correctly.
- **TZ correctness**: the lifetime-best-week boundary MUST be computed via `weekKeyOf` (the canonical local-time helper). A naive UTC bucketing would mis-classify Sunday-night-BRT sets across the week boundary (verified by the test at `tests/unit/weekly-volume-bucketing.test.ts:143-158`). Implementer must NOT introduce parallel date helpers.
- **PostgREST row limit**: silent truncation at 1000 rows if Option A in Q2 is taken without explicit `limit(N)` or `range(0, N)`. Verifiable by running `EXPLAIN ANALYZE` on the Supabase dashboard — or by counting rows returned and asserting against the DB count. The Designer/Implementer must address this in the design.
- **Behaviour on "outlier peak week"**: prompt accepts this. ANY normal week after a one-off peak shows "To PR = positive (regression)". This is honest but feels harsh. The prompt's softening trigger is "kernel change only, no UI change" (swap lifetime max for trailing-12-weeks max). Out of scope for v1 but worth flagging in the implementation comments so the future change is obvious.
- **Refresh fan-out**: pull-to-refresh on the Progress page should invalidate all the underlying queries (`["stats", …]`, `["sessions"]`, `["progress", …]`, `["exercises"]`). The existing patterns invalidate one or two at a time; the Progress page calls them all. Verify cache thrash isn't a problem (it's not — each prefix has 1-2 active queries at most).
- **Active-session interaction**: while a user is mid-session, none of their drafts count toward the current week's volume (because the kernel filters `ended_at IS NOT NULL`). When they Finish, `useFinishSession` invalidates `["stats"]` + `["progress"]` (`use-sessions.ts:62-63`) and the Progress page updates. Verified behaviour; no new wiring needed.
- **iPhone SE tab-width estimate**: explicit measurement was not run; the conclusion is based on character-count comparison against the existing 9-char `Exercises` label rendering without truncation. If the Designer wants certainty, they should run a manual smoke on a 320 px viewport. (LOW risk — even if `Progress` truncated, it would still fit `Prog…` and be tappable; this is cosmetic, not blocking.)

## Unknowns (require Designer judgment or human decision)

1. **Per-row muscle grouping**: should an exercise tagged with multiple muscles appear in every matching group, the first one only, or a synthetic "Multi" group? Assumption: first-listed muscle (`muscles[0]`) — matches the user's explicit ordering, keeps each row to one place. **Fact** that there's no `primary_muscle` concept; **assumption** about which choice is best UX.
2. **Exercises with empty `muscles` array**: which group label? "Other" / "Untagged" / "—". Assumption: "Other" — neutral, matches the seeded library's existing tone. No precedent.
3. **Multiple PRs same exercise same week**: count each individual beat (e.g. session 1 beats lifetime, session 2 beats session 1, session 3 beats session 2 → 3 PRs), or just the final one (1 PR)? Assumption: count each beat — motivational, matches the live strip's "every check shrinks the gap" feedback loop. No precedent.
4. **First-ever session for an exercise**: PR or no PR? Assumption: NOT a PR (matches the live strip's `no-pr` branch). **Fact** verified from `volume-target.ts:124-126`.
5. **Lifetime-best vs trailing-N-weeks max**: prompt accepts lifetime-best as the v1 default. Confirmed. The "soften if it bites" tradeoff is post-ship; out of scope.
6. **Q2 Option A vs B (extend query vs new aggregate)**: tradeoffs documented; Designer must pick. Default leaning: A is lower-risk for v1, B is cleaner long-term.
7. **Q7 chart richness**: extend existing strip with params, or sibling SVG chart? Default leaning: extend with `weeksWindow` + optional value labels. Designer call.
8. **Streak rendering when current = 0 and best = 0**: hide the card, or render flat zeros? Assumption: render `Current 0 weeks · Best 0 weeks` with a one-line empty-state hint inside the card. No precedent.
9. **Tab icon**: prompt says "icon TBD". Pure Designer choice. Candidates in `lucide-react-native` (already a dep): `TrendingUp`, `Activity`, `BarChart3`, `Target`, `Award`. No collision with existing icons.
10. **`Now` definition for weekly hero with respect to in-progress sessions**: confirmed by the prompt and existing kernel — finished sessions only, `completed_at IS NOT NULL` is implicit via the server-side filter. In-progress draft sets don't count. (Listed as Q-not-question to be explicit: in-progress drafts are NEVER counted at the weekly-hero level. The live strip's check-state semantic does NOT propagate to weekly aggregations.)

## Out-of-scope flags

- **Schema change**: prompt explicitly forbids. No new column, no new index, no new table, no new RLS policy.
- **Postgres RPC / function**: Option B in Q2 would introduce one. If the Designer picks B, that's still inside scope for "no schema change to user-data tables", but it is a new SQL artifact. The Designer should weigh A first.
- **Softening the lifetime-best anchor to trailing-12-weeks**: prompt explicitly says "soften only if it bites" — defer.
- **End-of-session verdict screen** (`docs/features.md:20`): listed in the pending features as a separate feature. Adjacent to the Progress page semantically; not in this scope.
- **PR-table denormalization / persistence**: deferred per `docs/roadmap.md:124`.
- **Notifications / haptics on PR achievement**: out of scope.
- **Interactivity on the richer chart beyond tap-to-week-drill-down**: the existing strip's tap targets each bar and routes to `/history/week/<isoMonday>`. The Progress chart should preserve this; anything else (hover tooltips, zoom, pan) is scope creep.
- **Reordering / customising muscle groups**: the seven values in `MUSCLE_GROUPS` are fixed by `0004_exercise_muscles_array.sql`. Out of scope.
- **Surfacing the Progress page from inside an active session**: not requested. The page is a top-level tab; mid-session, the user is on the Workout tab.
- **Cross-week comparison metrics** (week-over-week %, "this week vs last week"): prompt explicitly excludes ("never `previous week`").
- **Multi-user / shared progress**: out of scope per `roadmap.md:138-144`.
- **Doc cleanup** of stale data-model.md `completed_at NOT NULL` line (line 67) — unrelated to this run.
