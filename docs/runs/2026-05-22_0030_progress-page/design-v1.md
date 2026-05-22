# Design v1 — 2026-05-22_0030_progress-page

## Goal (1 sentence)

Ship a new bottom-tab "Progress" screen that aggregates four blocks (hero with PRs-this-week + weekly volume `Max · Now · To PR`, a richer 8-bar weekly histogram with a lifetime-best overlay, a per-muscle list of exercises trained this ISO week with per-row `Max · Now · To PR`, and a streak card) — all anchored to lifetime bests, with no schema change.

## Approach

Treat this as a **read-only dashboard composed of four independent kernels that all share a single lifetime-volume dataset**. The architecturally interesting choice is how to obtain the lifetime view of `WeeklyVolumeRow`s without tripping PostgREST's silent 1000-row truncation; everything else (PR count, streak math, muscle grouping) is downstream arithmetic on data the app already has.

Decisions across the seven Conductor calls:

1. **Lifetime-best week kernel — option (A) paginated** (Conductor lean). Extend `listWeeklyVolumeRows` to accept `sinceUtc?: string` (now optional) and add an internal pagination loop using `.range(from, from + PAGE - 1)` matching `scripts/import-strong.ts`'s precedent. No schema artifact, no migration, no RPC. The cost is one extra round-trip per ~1000 rows; for a 3-year user (~10-15k rows) that's 10-15 round-trips of ~50 KB each, all parallel-safe by PostgREST. Cache key `["stats", "weekly-volume", "lifetime"]` is a sibling of the existing 8-week key, both under the `["stats"]` prefix so `useFinishSession`'s `invalidateQueries({ queryKey: ["stats"] })` (`use-sessions.ts:62`) continues to cascade correctly. The 8-week strip on History keeps its existing key; the Progress hero + chart share the new lifetime key. (B) is rejected because it introduces a Postgres RPC artifact for a single screen — the cost is a migration + Drizzle awareness step that doesn't pay back until a second aggregation use-case appears.

2. **Muscle-grouping rule — (a) `muscles[0]` as grouping key** (Conductor lean). One row per exercise, lives in the user's first-listed muscle. This matches the order-preserving multi-select made canonical by the recent `f-muscles-multi-select` run (commit `b51dd01`); the user *can* re-order to express a different "primary" intent. Empty `muscles` array → group label `"Other"`. Soft-deleted exercises with sets in the current week still appear (matches `history/[id].tsx:45` precedent; mounted via `listAllExercises()`).

3. **PR-this-week count semantics** (per Conductor):
   - PR = a (session, exercise) pair whose `sumPastVolume(session.sets)` strictly exceeds the maximum `sumPastVolume` of every prior finished session for that same exercise (`started_at < candidate.started_at`).
   - First-ever session for an exercise: NOT a PR (no prior baseline). Matches `volume-target.ts:124-126`'s `previousMaxKg === 0 → no-pr` semantic.
   - Per-exercise dedupe: if a user beats their PR multiple times within the current ISO week, count as **1**, not N. The headline answers "how many exercises did I PR this week?", a count-of-exercises not a count-of-sessions.
   - Warmups excluded (the shared kernel `sumPastVolume` already does this).
   - Soft-deleted exercises whose set hits a PR this week still count (RLS doesn't care; the soft-delete is a UI flag).

4. **Chart richness — same 8-bar weekly histogram, plus a dotted overlay marking the lifetime-best week with a label** ("Best week: 28,400 kg") (Conductor lean). Cheap (one extra `<View>` line + one `<Text>` label inside the existing strip plot box), reinforces the lifetime-best anchor that all other blocks use, and preserves the per-bar tap-to-week-drill-down route. We do NOT widen the window beyond 8 weeks — at 12-26 bars the lifetime overlay becomes visually noisier without giving more information than the hero already does. Implementation extends `<WeeklyVolumeStrip>` with two optional props (`bestWeekKg?: number; bestWeekLabel?: string`) rather than forking the component; the History mount calls with both undefined (so it stays identical), the Progress mount passes both.

5. **Streak math** (per Conductor):
   - Trained week = ISO week with ≥1 finished session (`ended_at IS NOT NULL`, `deleted_at IS NULL`). Sets-irrelevant.
   - Current streak: consecutive trailing ISO weeks back from the current week. If the current week has ≥1 finished session, it counts; if not, the streak is the count ending at last week (so a Tuesday-morning glance with no sessions yet doesn't show "0" when last week had 4). This is the soft-fallback behaviour the prompt and Discovery both flag.
   - Best streak: longest such consecutive run across full history.
   - Display: `"3 weeks · best 7"` when current ≥ 1; `"Best 7 weeks"` alone when current = 0; nothing inside the card body when both = 0 (with a one-line empty-state CTA — see Empty states).

6. **Empty / early-week copy** (per Conductor):
   - Hero `Now = 0`: render `"To PR Xkg"` with no "PR! +Y" badge (beating 0 is trivial).
   - List with no sessions this week: `"No sessions yet this week — log one to start tracking."`
   - Streak `current = 0` with `best ≥ 1`: render only `"Best N weeks"`; hide the current-streak line.
   - Streak `current = 0` and `best = 0`: render `"Log a session to start your streak."` inside the card.
   - Day-zero new user (lifetime max = 0): hero shows `"Log your first session to set your PR baseline."` instead of `Max 0 kg · Now 0 kg · To PR 0 kg` triplet; bar chart returns `null` (existing `model.maxKg === 0 → return null` branch already covers this); list shows the empty-state copy; streak shows the CTA.

7. **Tab icon — `TrendingUp`** (Conductor lean). Action-verb feel consistent with Workout (`Dumbbell`), Exercises (`Wrench`), History (`History`), Profile (`User`). No collision with existing icons.

The "outlier peak week" tradeoff is accepted per prompt — one PR week makes every normal week show `To PR > 0`. The softening swap to trailing-12 max is left as a TODO comment in the kernel for future-Designer.

## Decisions on unknowns

| # | Unknown (Discovery) | Decision | Rationale |
|---|---|---|---|
| 1 | Multi-muscle exercise → which group? | `muscles[0]` only; one row per exercise. | Per Conductor lean. User-controlled ordering since `f-muscles-multi-select`; keeps each row in one place; no duplicate-math edge case. |
| 2 | Empty `muscles` array → group label? | `"Other"` | Neutral, matches seeded library tone. No precedent so picking the friendlier label. |
| 3 | Multiple PRs same exercise same week → count? | **1** per exercise per week. | Per Conductor. Headline answers "how many exercises did I PR?", count-of-exercises is the truthful unit. Avoids inflating against monthly cadence. |
| 4 | First-ever session for an exercise → PR? | **NOT** a PR. | Matches `volume-target.ts:124-126`'s `no-pr` branch; avoids polluting headline whenever a user logs a brand-new exercise. |
| 5 | Lifetime-best vs trailing-12 anchor | Lifetime-best (per prompt). | Prompt accepts the harshness; soften only if it bites. Kernel leaves a TODO comment for the future swap. |
| 6 | Lifetime weekly volume — extend query or new RPC? | Extend `listWeeklyVolumeRows`; paginated reads via `.range()`. | Per Conductor lean. No schema artifact; pagination cost amortized; existing cache invalidation prefix (`["stats", …]`) covers both new and old keys. |
| 7 | Chart richness | Same 8-bar histogram, plus dotted lifetime-best overlay + label. | Per Conductor. Minimal added complexity; reinforces lifetime-best anchor; preserves drill-down route. |
| 8 | Streak render when both = 0 | Render an inline CTA `"Log a session to start your streak."` inside the card. | Discoverable; soft-onboarding; no precedent forced a hide. |
| 9 | Tab icon | `TrendingUp` from `lucide-react-native`. | Per Conductor. Action-verb consistent with existing tabs. |
| 10 | "Now" semantic for weekly hero with in-progress drafts | Drafts NEVER count at the weekly level. The kernel filters `sessions.ended_at IS NOT NULL` server-side; drafts are absent from the dataset entirely. | Discovery #10 confirmed; aligned with `listWeeklyVolumeRows`'s existing JOIN filter. |

## Mudanças por arquivo

| File | Type | Change |
|---|---|---|
| `app/(app)/_layout.tsx` | edited | Add a 5th `<Tabs.Screen name="progress" options={{ title: "Progress", tabBarIcon: ({color, size}) => <TrendingUp color={color} size={size} /> }} />` block between the `history` and `measurements` registrations. Add `TrendingUp` to the `lucide-react-native` import. No other changes. |
| `app/(app)/progress/_layout.tsx` | new | One-line `<Stack screenOptions={{ headerShown: false }} />` to match `app/(app)/history/_layout.tsx`. |
| `app/(app)/progress/index.tsx` | new | The Progress screen body: header (`<Stack.Screen options={{ title: "Progress", headerShown: true }} />`), `<ScrollView>` with `RefreshControl`, and the four blocks composed top → bottom: Hero, WeeklyVolumeStrip (with `bestWeekKg` + `bestWeekLabel` props passed), ExercisesThisWeekList, StreakCard. Pulls all data via the new hooks below. |
| `src/api/stats.ts` | edited | (a) Make `sinceUtc` optional on `listWeeklyVolumeRows`'s opts. (b) When omitted, drop the `.gte("completed_at", sinceUtc)` clause AND switch to a paginated read loop (`.range(0, 999)`, `.range(1000, 1999)`, …) until a short page returns — pattern lifted verbatim from `scripts/import-strong.ts:38-58`. (c) Existing 8-week call sites unchanged. |
| `src/hooks/use-stats.ts` | edited | Add a new `useLifetimeWeeklyVolume()` hook returning the same `WeeklyVolumeRow[]` shape over the unbounded window. Cache key `["stats", "weekly-volume", "lifetime"]`. `staleTime: 60_000` matches the existing 8-week hook. |
| `src/api/progress-page.ts` | new | Two new aggregate reads: (a) `listSetsThisWeek({ weekStart, weekEnd }): Promise<ThisWeekSetRow[]>` — returns finished, non-deleted, working/dropset (warmups EXCLUDED) sets joined to `(session.started_at, session.ended_at)` and `(exercise.id, exercise.name, exercise.muscles, exercise.deleted_at)`. Filter `sessions.started_at >= weekStart AND sessions.started_at <= weekEnd`. (b) `listFinishedSessionStartedAts(): Promise<{ started_at: string }[]>` — minimal projection for streak math, ordered `started_at ASC`. |
| `src/hooks/use-progress-page.ts` | new | Five exported hooks: `useLifetimeBestWeek()`, `usePrsThisWeek()`, `useStreaks()`, `useExercisesThisWeek()`, `useProgressPageRefresh()`. Each is a thin `useQuery` or `useMemo`-over-other-queries layer; signatures in `Contratos de I/O`. |
| `src/utils/progress-page-math.ts` | new | Pure helpers (unit-testable): `bucketWeeklyVolumes(rows: WeeklyVolumeRow[]): Map<string, number>`, `findBestWeek(buckets): { key: string, kg: number, label: string } \| null`, `countPrsThisWeek({ allSetsByExerciseSession, currentWeekRange }): number`, `groupExercisesByPrimaryMuscle(exercises): Record<MuscleGroup \| "Other", ExerciseRow[]>`, `computeStreaks(finishedSessions: { started_at: string }[], now: Date): { current: number, best: number }`. All consume snake_case row shapes (Discovery convention) and use the canonical `weekKeyOf` / `isoWeekStart` helpers from `dates.ts`. |
| `src/components/weekly-volume-strip.tsx` | edited | Add two optional props `bestWeekKg?: number; bestWeekLabel?: string`. When `bestWeekKg > 0` is passed, render a horizontal dotted line at `y = PLOT_HEIGHT - Math.round((bestWeekKg / model.maxKg) * PLOT_HEIGHT)` across the plot, plus a small text label `"Best week: <formatVolume(bestWeekKg)>"` below the date-label row. When the props are omitted (History mount), behaviour is byte-identical. |
| `src/components/progress-hero.tsx` | new | The hero block — eyebrow `"PRs this week"`, big number for count (`text-2xl font-semibold`), divider, weekly volume `Max · Now · To PR` row that reuses the *display shape* (not the kernel) from `<VolumeTargetSlot>`'s chasing branch. No new kernel — uses `useLifetimeBestWeek()` + the current-week aggregate from `useLifetimeWeeklyVolume`. |
| `src/components/exercises-this-week-list.tsx` | new | The per-muscle list block. For each non-empty group in `MUSCLE_GROUPS` order + `"Other"` at the end, renders a section header (`text-sm font-medium uppercase text-gray-500 mt-4 mb-2` — matches `history/week/[isoWeek].tsx:23-24`) and one row per exercise. Each row: exercise name (`text-base font-medium`), `Max · Now · To PR` line below (re-uses `<VolumeTargetSlot>`'s display shape via a shared `<MaxNowToPrLine>` helper that takes three formatted strings). Row tap → `router.push(/(app)/exercises/${id}/progress)`. |
| `src/components/streak-card.tsx` | new | The streak card block. Border card per `profile.tsx` precedent (`border border-gray-200 dark:border-gray-800 rounded-lg p-4 mt-6`). Renders the streak math output per Decision #5 + #8. |
| `src/components/max-now-to-pr-line.tsx` | new | Shared display helper: takes `{ maxKg, nowKg, gapKg, unit, a11yPrefix }`, renders the single-line `"Max … · Now … · To PR …"` matching `volume-target-slot.tsx:78-106`'s exact tokens. Extracted so both `<ProgressHero>` and `<ExercisesThisWeekList>` use byte-identical typography. `<VolumeTargetSlot>` is NOT refactored to use it in this run (out of scope; that's a follow-up). |
| `tests/unit/progress-page-math.test.ts` | new | Unit tests for the five pure helpers in `progress-page-math.ts`. Detailed list in `Test plan`. |
| `tests/e2e/progress-page.spec.ts` | new | E2E coverage of the empty user, the populated user golden path, the per-row navigation, and the early-week empty states. Detailed list in `Test plan`. |
| `docs/features.md` | edited (Conductor concern, post-merge) | Move the Progress-page bullet from "[ ]" to "## Done" after shipping. NOT touched by Implementer. |

No changes to: `src/api/progress.ts`, `src/utils/volume-target.ts`, `src/utils/dates.ts`, `src/utils/units.ts`, `src/db/schema.ts`, RLS policies, the active-session banner, the existing 8-week strip mount in `history/index.tsx`.

## Contratos de I/O

### `src/api/stats.ts` (edited)

```ts
export type WeeklyVolumeRow = {
  completed_at: string;
  weight: string | null;
  reps: number | null;
  set_type: SetType;
  sessions: { started_at: string; ended_at: string };
};

/**
 * Reads finished, non-warmup, non-deleted sets.
 *
 * When `sinceUtc` is provided, filters `completed_at >= sinceUtc` (existing
 * 8-week strip behaviour, single round-trip).
 *
 * When `sinceUtc` is omitted (lifetime read), iterates through paginated
 * `.range(from, from + PAGE - 1)` until a short page returns. Pattern from
 * `scripts/import-strong.ts`. Required because PostgREST silently truncates
 * at 1000 rows otherwise.
 */
export async function listWeeklyVolumeRows(opts: {
  sinceUtc?: string;
}): Promise<WeeklyVolumeRow[]>;
```

Internal constant: `const PAGE = 1000`. The paginated loop reuses the same `select(...)` and filters; only the `.range()` and (conditional) `.gte()` differ.

### `src/hooks/use-stats.ts` (edited)

```ts
// Existing — unchanged signature, unchanged behaviour:
export function useWeeklyVolume(): UseQueryResult<WeeklyVolumeRow[], Error>;

// New — lifetime read for the Progress page.
export function useLifetimeWeeklyVolume():
  UseQueryResult<WeeklyVolumeRow[], Error>;
```

Cache key: `["stats", "weekly-volume", "lifetime"]`. `staleTime: 60_000`. Reuses the existing 8-week `useFinishSession`/`useUpdateSessionTimes`/`useSoftDeleteSession` invalidations (already invalidate `["stats"]` prefix at `use-sessions.ts:62, 108-109, 121-122`).

### `src/api/progress-page.ts` (new)

```ts
import type { ExerciseRow, SetRow } from "~/db/types";

/**
 * Joined row shape for "exercises trained this ISO week". Includes the
 * exercise's library row so the list can render name + muscles even for
 * soft-deleted exercises (matches `history/[id].tsx` convention).
 */
export type ThisWeekSetRow = SetRow & {
  sessions: { id: string; started_at: string; ended_at: string };
  exercises: Pick<ExerciseRow, "id" | "name" | "muscles" | "deleted_at">;
};

/**
 * Reads all finished, non-deleted, working/dropset sets whose session
 * started in the given ISO-week window. Window bounds are LOCAL Monday 00:00
 * and Sunday 23:59:59 from `isoWeekStart` / `endOfWeek`. Pagination not
 * needed at week granularity (worst-case ~150 sets/week).
 */
export async function listSetsThisWeek(opts: {
  weekStartIso: string; // ISO string of local Monday 00:00
  weekEndIso: string;   // ISO string of local Sunday 23:59:59.999
}): Promise<ThisWeekSetRow[]>;

/**
 * Minimal projection for streak math: every finished, non-deleted session's
 * `started_at`. Lifetime scope; paginated read via `.range()` for safety
 * (a 3-year user has ~500 sessions, well under 1000, but the loop costs
 * nothing).
 */
export async function listFinishedSessionStartedAts(): Promise<
  { started_at: string }[]
>;
```

Underlying queries:

```ts
// listSetsThisWeek:
supabase
  .from("sets")
  .select(
    "*, sessions!inner(id, started_at, ended_at), exercises!inner(id, name, muscles, deleted_at)",
  )
  .is("deleted_at", null)
  .not("sessions.ended_at", "is", null)
  .gte("sessions.started_at", opts.weekStartIso)
  .lte("sessions.started_at", opts.weekEndIso)
  .neq("set_type", "warmup");
// NOTE: exercises!inner NOT filtered by deleted_at — soft-deleted exercises
// still appear in this week's history (precedent: history/[id].tsx:45).

// listFinishedSessionStartedAts:
supabase
  .from("sessions")
  .select("started_at")
  .is("deleted_at", null)
  .not("ended_at", "is", null)
  .order("started_at", { ascending: true });
```

RLS: both queries are scoped by `auth.uid() = user_id` via the existing policies on `sets` / `sessions` / `exercises`. No new policy.

### `src/hooks/use-progress-page.ts` (new)

```ts
import type { UseQueryResult } from "@tanstack/react-query";
import type { MuscleGroup, ExerciseRow } from "~/db/types";

/**
 * Lifetime-best ISO week. Returns `null` when the user has zero history.
 *
 * Cache key: ["stats", "weekly-volume", "lifetime"] (shared with
 * `useLifetimeWeeklyVolume` — this hook is a `useMemo` on top, no extra
 * network).
 */
export function useLifetimeBestWeek(): {
  data: { isoWeekKey: string; weekStartLabel: string; totalKg: number } | null;
  isLoading: boolean;
  isError: boolean;
};

/**
 * Count of distinct exercises that hit a new lifetime-best single-session
 * volume during the current ISO week. Returns `0` while loading or on empty
 * history.
 *
 * Computed from `useLifetimeWeeklyVolume()` for the per-session aggregates
 * (since `WeeklyVolumeRow` doesn't carry `exercise_id`, the count uses
 * `useExercisesThisWeek()` data joined with `listSetsForExercise(id)`-style
 * prior-history reads). See implementation note: avoids fan-out by
 * computing PRs entirely from a single `listSetsForPrComputation()` call
 * that returns `(exercise_id, session_id, started_at, weight, reps, set_type)`
 * filtered to non-warmup, finished sessions, lifetime — same row count as
 * `useLifetimeWeeklyVolume` but with `exercise_id` projected.
 *
 * REVISION: to avoid two parallel lifetime reads, the lifetime-weekly hook is
 * generalized — see `WeeklyVolumeRow` revision below.
 */
export function usePrsThisWeek(): UseQueryResult<number, Error>;

/**
 * Current + best streak in finished-session ISO weeks. Per Decision #5:
 * - `current` does NOT drop to 0 on Monday/Tuesday of a fresh week if last
 *   week qualified — it shows last week's trailing count until either this
 *   week earns a session or the next ISO week begins.
 * - `best` is the longest run ever, including across the current run.
 */
export function useStreaks(): UseQueryResult<
  { current: number; best: number },
  Error
>;

/**
 * Exercises trained THIS ISO week, grouped by `muscles[0]` (or "Other"),
 * with per-row Max·Now·To PR pre-computed.
 *
 * "Now" = sum of this-week sets' volume (per exercise).
 * "Max" = max single-session volume across all finished sessions for that
 *         exercise (lifetime, computed from the same lifetime-rows dataset).
 * "Gap" = max(Max − Now, 0).
 *
 * Returns one entry per exercise, sorted by group then by `Now` desc within
 * group.
 */
export type ExerciseThisWeekRow = {
  exerciseId: string;
  exerciseName: string;
  muscles: string[]; // raw; group is derived
  group: MuscleGroup | "Other";
  maxKg: number;    // lifetime best single-session volume
  nowKg: number;    // sum across all this week's sessions
  gapKg: number;    // max(maxKg - nowKg, 0)
  isPrThisWeek: boolean; // whether nowKg, computed as a max of single-session totals this week, exceeded prior-best
};

export function useExercisesThisWeek(): UseQueryResult<
  ExerciseThisWeekRow[],
  Error
>;

/**
 * Pull-to-refresh fan-out. Invalidates ["stats"], ["sessions"], ["progress"],
 * ["exercises"] (covers every underlying query). Returns a handler suitable
 * for `<RefreshControl onRefresh={…} />`.
 */
export function useProgressPageRefresh(): {
  refreshing: boolean;
  onRefresh: () => Promise<void>;
};
```

**Implementation note — single lifetime kernel**: to avoid two parallel lifetime reads (`useLifetimeWeeklyVolume` for the chart + a parallel `listSetsForPrComputation` for the PR count + per-exercise list), `WeeklyVolumeRow` is **augmented to include `exercise_id` and `session_id`**:

```ts
// REVISED — single lifetime kernel:
export type WeeklyVolumeRow = {
  completed_at: string;
  weight: string | null;
  reps: number | null;
  set_type: SetType;
  exercise_id: string;     // NEW — needed for PR + per-exercise computations
  session_id: string;      // NEW — needed for "best single-session volume per exercise"
  sessions: { started_at: string; ended_at: string };
};
```

This is a **superset projection** of the existing shape; the existing `weekly-volume-strip.tsx` bucketing helper only reads `completed_at`, `weight`, `reps` (`weekly-volume-strip.tsx:43-51`) so the extra columns are inert there. The PostgREST query gains two more selected columns:

```ts
.select(
  "completed_at, weight, reps, set_type, exercise_id, session_id, sessions!inner(started_at, ended_at)",
)
```

The single lifetime dataset feeds `useLifetimeWeeklyVolume()` (chart + hero), `usePrsThisWeek()` (PR count), and `useExercisesThisWeek()` (per-exercise list's lifetime maxes). Network: 1 paginated query for the entire screen's lifetime data + 1 weekly-window query (`listSetsThisWeek`) + 1 sessions-only query (`listFinishedSessionStartedAts`) + library reads via `useAllExercises`. All four queries fire in parallel.

Cache invalidation: `["stats"]` prefix on `useFinishSession` invalidates all three lifetime/weekly queries; `["sessions"]` invalidates the streak query; `["exercises"]` covers library renames.

### `src/utils/progress-page-math.ts` (new)

```ts
import type { MuscleGroup, ExerciseRow, SetRow } from "~/db/types";
import type { WeeklyVolumeRow } from "~/api/stats";

/**
 * Buckets `rows` into one entry per `weekKeyOf(parseISO(completed_at))`
 * using the canonical `volume = parseFloat(weight) * reps` kernel with the
 * existing `w > 0 && r > 0` guard. Warmups are assumed already filtered
 * server-side.
 */
export function bucketWeeklyVolumes(
  rows: WeeklyVolumeRow[],
): Map<string, number>;

/**
 * Returns the (key, kg, label) of the highest-volume bucket. Label = "M/d"
 * of the local Monday. Returns `null` for empty input.
 */
export function findBestWeek(
  buckets: Map<string, number>,
): { isoWeekKey: string; weekStartLabel: string; totalKg: number } | null;

/**
 * Counts the number of distinct exercises that hit a new lifetime PR
 * during the ISO week `[currentWeekStart, currentWeekEnd]`.
 *
 * Algorithm:
 *  1. Group `rows` by `(exercise_id, session_id)` and reduce to a single
 *     volume per group (the per-session-per-exercise total).
 *  2. For each exercise, sort sessions ASC by `started_at`. The session's
 *     running max BEFORE that session is `priorMax`. The session "is a PR"
 *     iff `volume > priorMax`.
 *  3. Dedupe to one PR per exercise per week: if an exercise has ≥1 PR
 *     session in `[currentWeekStart, currentWeekEnd]`, count it as 1.
 *
 * The "first-ever session for an exercise" is NOT a PR because `priorMax`
 * is `0` and the comparison `volume > 0` only flips when there's data,
 * but the function treats "previousMaxKg === 0" identically to the
 * `volume-target.ts:124-126` `no-pr` branch — the first session does not
 * count as a PR by design.
 */
export function countPrsThisWeek(opts: {
  rows: WeeklyVolumeRow[]; // lifetime; carries `exercise_id`, `session_id`, `sessions.started_at`
  currentWeekStartIso: string;
  currentWeekEndIso: string;
}): number;

/**
 * Groups `exercises` by `muscles[0]` (or "Other" when empty). Iteration
 * order is `MUSCLE_GROUPS` followed by "Other".
 */
export function groupExercisesByPrimaryMuscle(
  exercises: ExerciseRow[],
): Map<MuscleGroup | "Other", ExerciseRow[]>;

/**
 * Computes (current, best) consecutive-ISO-week streaks of finished
 * sessions.
 *
 * Behavioural detail (Decision #5):
 *  - If the current ISO week (containing `now`) has ≥1 finished session,
 *    `current` includes it.
 *  - If the current ISO week is empty AND last week qualified, `current`
 *    equals the streak that ends at last week (so a Monday/Tuesday glance
 *    shows the still-alive trailing count).
 *  - If the current week is empty AND last week also didn't qualify,
 *    `current = 0`.
 *  - `best` is the longest such run across all history (current run can
 *    be the best).
 */
export function computeStreaks(
  sessions: { started_at: string }[],
  now: Date,
): { current: number; best: number };
```

### UI prop shapes

`<WeeklyVolumeStrip>` (edited):

```ts
type Props = {
  /** Lifetime-best-week kg. When >0 and provided, draws a dotted overlay
   *  + label. When undefined or 0, the strip renders byte-identically to
   *  today's behaviour. */
  bestWeekKg?: number;
  /** "Best week: <kg> (5/13)" — assembled by caller so the strip stays
   *  unit-agnostic. */
  bestWeekLabel?: string;
};
```

`<MaxNowToPrLine>` (new shared helper):

```ts
type Props = {
  maxKg: number;
  nowKg: number;
  gapKg: number;
  /** Optional prefix to disambiguate VoiceOver (e.g. "Bench press: "). */
  a11yPrefix?: string;
};
```

`<ProgressHero>` (new):

```ts
// No props — reads via `useLifetimeBestWeek()` + `useLifetimeWeeklyVolume()`
// + `usePrsThisWeek()`.
export function ProgressHero(): React.JSX.Element | null;
```

`<ExercisesThisWeekList>` (new):

```ts
export function ExercisesThisWeekList(): React.JSX.Element;
// Reads `useExercisesThisWeek()`. Renders empty-state copy on []  result.
```

`<StreakCard>` (new):

```ts
export function StreakCard(): React.JSX.Element;
// Reads `useStreaks()`.
```

### DB columns / queries

No new columns, no new indexes, no new policies. The existing `sets_exercise_completed_idx (exercise_id, completed_at)` covers the per-exercise lifetime scan; the existing `sessions_user_started_idx (user_id, started_at)` covers the streak + this-week-sessions queries.

The PostgREST `select` is the only schema-adjacent change — adding `exercise_id` + `session_id` to `listWeeklyVolumeRows`'s select. RLS unaffected (still filtered by `auth.uid()` on `sets` / `sessions`).

## Page composition

```
app/(app)/progress/index.tsx
  <Stack.Screen options={{ title: "Progress", headerShown: true }} />
  <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />} contentContainerClassName="pb-12" className="flex-1 bg-white dark:bg-black">
    <ProgressHero />                         // border-b chrome, same idiom as <WeeklyVolumeStrip>
    <WeeklyVolumeStrip
      bestWeekKg={bestWeek?.totalKg}
      bestWeekLabel={bestWeek ? `Best week: ${formatVolume(bestWeek.totalKg, unit)} (${bestWeek.weekStartLabel})` : undefined}
    />
    <ExercisesThisWeekList />                // section headers per muscle, rows w/ MaxNowToPrLine
    <StreakCard />                           // border card per profile.tsx idiom
  </ScrollView>
```

### ASCII mockup (populated mid-week)

```
┌─────────────────────────────────────────────────────────┐
│ Progress                                                │  <- header (Stack)
├─────────────────────────────────────────────────────────┤
│ PRS THIS WEEK                                           │
│ 3                                                       │
│                                                         │
│ Max 28,400 kg · Now 12,300 kg · To PR 16,100 kg         │
├─────────────────────────────────────────────────────────┤
│ THIS WEEK                                               │
│ 12,300 kg                                               │
│                                                         │
│ ┌──┐                                                    │
│ │  │   ┌──┐                                             │
│ │  │   │  │       ┌──┐         ┌──┐    ┌──┐             │
│ │  │   │  │  ┌──┐ │  │ ┌──┐   ┌─┴──┐   │  │             │
│ │  │   │  │  │  │ │  │ │  │   │    │   │██│   <- current
│ │  │   │  │  │  │ │  │ │  │   │    │   │██│      week
│ ┷━━┷━━━┷━━┷━━┷━━┷━┷━━┷━┷━━┷━━━┷━━━━┷━━━┷━━┷━━━━━━━━ <- dotted lifetime-best overlay
│ 4/6  4/13 4/20 4/27 5/4  5/11 5/18                      │
│                                                         │
│ Best week: 28,400 kg (4/6)                              │
├─────────────────────────────────────────────────────────┤
│ CHEST                                                   │
│ Bench press                                             │
│   Max 4,900 kg · Now 1,800 kg · To PR 3,100 kg          │
│                                                         │
│ UPPER BACK                                              │
│ Pullup                                                  │
│   Max 1,400 kg · Now 1,800 kg · To PR 0 kg  🏆 PR       │
│ Barbell row                                             │
│   Max 2,600 kg · Now 1,200 kg · To PR 1,400 kg          │
│                                                         │
│ LEGS                                                    │
│ Back squat                                              │
│   Max 6,200 kg · Now 4,800 kg · To PR 1,400 kg          │
├─────────────────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────────────┐   │
│ │ STREAK                                            │   │
│ │ 3 weeks · best 7                                  │   │
│ └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### ASCII mockup (early Tuesday — current week empty, last week qualified)

```
┌─────────────────────────────────────────────────────────┐
│ Progress                                                │
├─────────────────────────────────────────────────────────┤
│ PRS THIS WEEK                                           │
│ 0                                                       │
│                                                         │
│ Max 28,400 kg · Now 0 kg · To PR 28,400 kg              │
├─────────────────────────────────────────────────────────┤
│ THIS WEEK                                               │
│ 0 kg                                                    │
│ [ 8-bar histogram with current week at min-height 4 ]   │
│ Best week: 28,400 kg (4/6)                              │
├─────────────────────────────────────────────────────────┤
│ No sessions yet this week — log one to start tracking.  │
├─────────────────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────────────┐   │
│ │ STREAK                                            │   │
│ │ Best 3 weeks                                      │   │  <- current line hidden when current = 0
│ └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### ASCII mockup (day-zero new user — zero history)

```
┌─────────────────────────────────────────────────────────┐
│ Progress                                                │
├─────────────────────────────────────────────────────────┤
│ PRS THIS WEEK                                           │
│ 0                                                       │
│                                                         │
│ Log your first session to set your PR baseline.         │
├─────────────────────────────────────────────────────────┤
│  (8-bar histogram block returns null — no chrome)       │
├─────────────────────────────────────────────────────────┤
│ No sessions yet this week — log one to start tracking.  │
├─────────────────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────────────┐   │
│ │ STREAK                                            │   │
│ │ Log a session to start your streak.               │   │
│ └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

## Hooks + API additions (summary signatures)

```ts
// src/api/stats.ts
export async function listWeeklyVolumeRows(opts: { sinceUtc?: string }): Promise<WeeklyVolumeRow[]>;
// + WeeklyVolumeRow now includes exercise_id, session_id

// src/api/progress-page.ts
export async function listSetsThisWeek(opts: { weekStartIso: string; weekEndIso: string }): Promise<ThisWeekSetRow[]>;
export async function listFinishedSessionStartedAts(): Promise<{ started_at: string }[]>;

// src/hooks/use-stats.ts
export function useLifetimeWeeklyVolume(): UseQueryResult<WeeklyVolumeRow[], Error>;

// src/hooks/use-progress-page.ts
export function useLifetimeBestWeek(): { data: BestWeek | null; isLoading: boolean; isError: boolean };
export function usePrsThisWeek(): UseQueryResult<number, Error>;
export function useStreaks(): UseQueryResult<{ current: number; best: number }, Error>;
export function useExercisesThisWeek(): UseQueryResult<ExerciseThisWeekRow[], Error>;
export function useProgressPageRefresh(): { refreshing: boolean; onRefresh: () => Promise<void> };
```

## Test plan

### Unit — `tests/unit/progress-page-math.test.ts` (new)

`bucketWeeklyVolumes(rows)`:
1. Empty input → empty Map.
2. Single row in week W → Map of size 1 with the row's `w*r`.
3. Two rows in the same week → summed.
4. Two rows in different weeks → two separate entries.
5. Row with `weight = null` → not counted (`parseFloat(null)` is `NaN`).
6. Row with `reps = 0` → not counted.
7. Row with `reps = null` → not counted.
8. Row with negative weight → not counted.
9. Sunday 23:30 BRT row → bucketed into its own ISO week, NOT the next Monday's (TZ correctness).

`findBestWeek(buckets)`:
10. Empty map → `null`.
11. Three buckets with values `100, 500, 250` → returns the `500` entry.
12. Tie at top → returns the first encountered (Map insertion order, callers shouldn't depend on tie behaviour).
13. All-zero buckets → returns `null` (or `{ kg: 0 }` — pick one in spec; recommendation: `null`).

`countPrsThisWeek({ rows, currentWeekStartIso, currentWeekEndIso })`:
14. Empty rows → 0.
15. One exercise, three prior sessions ascending in volume, no this-week session → 0.
16. One exercise, two prior sessions (500, 800), one this-week session (900) → 1.
17. One exercise, two prior sessions (500, 800), one this-week session (700) → 0 (not a PR).
18. One exercise, two prior sessions (500, 800), TWO this-week sessions both beating 800 (900, then 1000) → still 1 (per-exercise dedupe).
19. Two exercises, both beating PR this week → 2.
20. First-ever session for an exercise (no prior, this-week is the only one) → 0 (NOT a PR per Decision #4).
21. PR session whose `started_at` is in last week → 0 for current week.
22. Warmup row in this-week session that "would be" a PR — must NOT count (kernel skips warmups at the row level; helper receives pre-filtered data, document the assumption).

`groupExercisesByPrimaryMuscle(exercises)`:
23. Empty → empty map.
24. Exercise with `muscles: ["Chest", "Shoulders"]` → goes to `"Chest"` only, not `"Shoulders"`.
25. Exercise with `muscles: []` → goes to `"Other"`.
26. Exercise with `muscles: ["Bogus"]` (not in `MUSCLE_GROUPS`) → goes to `"Other"` (graceful degradation for malformed data).
27. Insertion order matches `MUSCLE_GROUPS` order with `"Other"` last.

`computeStreaks(sessions, now)`:
28. Empty sessions → `{ current: 0, best: 0 }`.
29. One finished session this week → `{ current: 1, best: 1 }`.
30. One finished session last week, none this week, `now` is Tuesday → `{ current: 1, best: 1 }` (current includes last week per Decision #5's soft-fallback).
31. One finished session two weeks ago, none last or this → `{ current: 0, best: 1 }` (last week broke the streak).
32. Sessions in weeks W-3, W-2, W-1, W (current) → `{ current: 4, best: 4 }`.
33. Sessions in W-7..W-5 (3 weeks), gap, then W-1, W (current) → `{ current: 2, best: 3 }`.
34. Multiple finished sessions in the same ISO week → counted once for streak purposes.
35. TZ correctness: a Sunday 23:30 BRT session is in its own ISO week, not the next Monday's, with `now = next Monday 00:30 BRT`.

### Unit — `tests/unit/weekly-volume-bucketing.test.ts` (edited)

Existing 7 tests assume `WeeklyVolumeRow` lacks `exercise_id` + `session_id`. Add the fields to the existing `mkRow` factory with sensible defaults. Existing assertions on bucket totals remain correct.

Add 1 new test:
- `"strip ignores exercise_id and session_id when bucketing"` — sanity check that the lifetime-augmented shape doesn't change the strip's output.

### E2E — `tests/e2e/progress-page.spec.ts` (new)

Following the seeding pattern of `tests/e2e/weekly-volume-strip.spec.ts` (admin client seeds finished sessions + sets directly into Postgres, then signs in the test user). Each test:

1. **Tab is visible and tappable**:
   - Sign in. Tap "Progress" in the bottom tab bar. URL becomes `/progress`. Title "Progress" renders.

2. **Empty user (no history)**:
   - Sign up fresh user, sign in. Open Progress. Assert `"Log your first session to set your PR baseline."` visible. Assert `"No sessions yet this week — log one to start tracking."` visible. Assert `"Log a session to start your streak."` visible. Assert NO bar chart (no "This week" label).

3. **Populated user, mid-week**:
   - Seed: 3 sessions in current ISO week, 6 sessions in prior weeks, one of which is the lifetime-best (28,400 kg).
   - Open Progress. Assert `"PRs this week"` + a numeric count. Assert `"Max 28,400 kg"` and `"To PR"` visible. Assert at least one section header from `MUSCLE_GROUPS`. Assert `"Best week:"` overlay label visible.

4. **Per-row navigation**:
   - From the populated state, tap the first exercise row. Assert URL becomes `/exercises/<id>/progress`.

5. **Empty-this-week, full history**:
   - Seed: 0 sessions in current ISO week, 3 in last week, 6 in prior weeks.
   - Open Progress (Tuesday-equivalent — use a fixed `Date.now()` mock or ensure the seeded sessions are "before this week" relative to real-now). Assert `"PRs this week"` shows `"0"`. Assert `"No sessions yet this week — log one to start tracking."`. Assert streak card shows `"Best N weeks"` line (not `"current"`).

6. **PR-this-week badge** (smoke):
   - Seed a session this week whose per-exercise volume strictly exceeds every prior session for that exercise. Open Progress. Assert that exercise's row renders with a PR indicator (the `🏆 PR` glyph or a `text-emerald-600` "PR!" badge — Implementer call on the exact glyph; selector: a substring "PR" near the row, distinct from the `"To PR"` label by checking the row is in the populated list section).

7. **Tab does not regress existing tabs**:
   - Tap Workout, Exercises, History, Profile each at least once after introducing the Progress tab; assert each is still navigable (the 5-tab width concern).

### Manual smoke (Tester scope)

1. New device, fresh user → empty-state copy on every block.
2. Mid-session active banner is unaffected when on Progress tab.
3. Pull-to-refresh refreshes all four blocks (verify by editing a session via History, returning to Progress, pulling — number should update).
4. Dark mode contrast for the dotted overlay + label.
5. iPhone SE (320px width) — 5 tabs fit; verify `Progress` label doesn't truncate.
6. iOS / Android / web parity check — same screen shape; the dotted overlay is RN `<View>` flex, no platform divergence.
7. Soft-deleted exercise that was trained this week → still appears in the list with name.
8. Multi-muscle exercise (e.g. tagged `["Chest", "Shoulders"]`) → appears in `Chest` group, not `Shoulders`.

## Riscos

- **Data integrity (RLS, migrations)**: zero. No schema change, no new policy, no new index. The augmented `WeeklyVolumeRow` selects two extra columns from `sets` — both (`exercise_id`, `session_id`) are NOT NULL columns already protected by the existing `sets` RLS (`auth.uid() = user_id`). No migration needed.

- **PostgREST silent truncation**: the headline risk. If the paginated read loop is implemented incorrectly (e.g. forgetting the `.range()` upper bound, or breaking the loop early), the lifetime read returns ≤1000 rows and the lifetime-max is wrong (typically *too low* — older sets are clipped). Mitigation: copy the loop verbatim from `scripts/import-strong.ts`; add a unit test that mocks a 1500-row response and asserts the function issues two `.range()` calls; add an assertion comparing the page-count against a small `count()` query if Validator pushes back.

- **UX regression — existing 8-week strip**: `<WeeklyVolumeStrip>` is mounted by `history/index.tsx:48` with no props. The new `bestWeekKg` / `bestWeekLabel` props are optional with the existing branch returning byte-identical JSX. Validator should confirm by reading the diff and grepping every call site of the strip.

- **UX regression — cache key collision**: new keys `["stats", "weekly-volume", "lifetime"]`, `["stats", "progress-page", "prs-this-week"]`, `["sessions", "started-ats"]`, `["progress-page", "exercises-this-week"]` (or wherever the Implementer slots them). All are strict tuple prefixes of existing prefixes (`["stats"]`, `["sessions"]`) so the existing `useFinishSession` cascade in `use-sessions.ts:62-63` continues to cover them. Validator should grep `invalidateQueries` for any place that uses the EXACT key (not the prefix) — none should regress.

- **UX regression — TZ correctness**: every ISO-week-boundary computation MUST go through `weekKeyOf` / `isoWeekStart` from `dates.ts`. A naïve UTC bucketing mis-classifies Sunday 23:30 BRT sets. Mitigation: the helpers are mandated by the design; unit tests #9 + #35 explicitly guard the boundary case.

- **Platform divergence (iOS / Android / web)**: zero functional. The dotted overlay is a `<View>` with `borderBottomWidth: 1` and `borderStyle: "dashed"` (RN-supported on all three; "dotted" on Android falls back to dashed but is visually equivalent at 1px). The label position is `absolute` over the plot — Validator should sanity-check the layout doesn't clip the date-label row on Android.

- **Performance — lifetime read on cold start**: a 3-year user has ~15k rows × 6 columns ≈ ~70-100 KB per page (PostgREST JSON overhead), 15 pages = ~1.5 MB total. On gym wifi (5 Mbps real-world), that's ~2.5s of network. The `staleTime: 60_000` means subsequent navigations within a minute are instant. **HIGH-IMPACT mitigation**: if Validator/Tester finds the cold-start latency unacceptable, the fallback is Option (B) — a Postgres aggregate function. Designer accepts this risk for v1; documented as a fallback path. Empty-state and onboarding aren't affected (small user histories are fast).

- **Performance — render cost**: the list renders ~5-20 rows × a `<MaxNowToPrLine>` `<Text>` block each. RN can handle this in a single layout pass. The `<ScrollView>` (not `FlatList`) is correct because the four blocks are heterogeneous; the list itself is small enough to not require virtualization.

- **PR-count edge case — pre-existing data quirks**: if a user's seed data has a session with `started_at` before `1970-01-01` (impossible in practice, but defensive) or a session with `ended_at < started_at` (the existing schema doesn't enforce ordering), the PR count algorithm still works because it only sorts by `started_at`. Validator should confirm.

- **PR-count edge case — bulk-import "spike"**: a user who imports Strong history all at once has many "PRs" backfilled into the past. The current ISO week's PR count is unaffected (those imports landed in their original `completed_at` weeks). No mitigation needed.

- **Refresh fan-out**: pull-to-refresh invalidates `["stats"]`, `["sessions"]`, `["progress"]`, `["exercises"]` — four prefixes. Each prefix has 1-3 active queries on the Progress page; total fan-out is ~8 parallel refetches. PostgREST handles parallel requests on a single connection; total wall-clock ~= the slowest of the four (the lifetime read, ~2.5s). Acceptable.

- **Active-session interaction**: while a user is mid-session, the lifetime kernel filters `sessions.ended_at IS NOT NULL` so drafts NEVER appear in any Progress block. After Finish, `useFinishSession` invalidates `["stats"]` + `["progress"]` and the Progress page re-derives. Validated via existing wiring; no new code needed.

- **iPhone SE tab width**: 5 tabs × 64 px = 320 px on the smallest viewport. "Progress" (8 chars) fits in the same envelope as the existing 9-char "Exercises". LOW risk — even with truncation, the icon is still tappable. Tester should smoke-test on a 320 px browser viewport.

- **Lifetime peak outlier**: per prompt, accepted. One PR week makes every normal week show `To PR > 0`. The kernel comment leaves a TODO for the future trailing-12-weeks swap. No mitigation in v1.

## Alternativas descartadas

1. **(Alt to call #1) Option B — new Postgres aggregate function `weekly_volume_aggregate()`**. Descartada porque it introduces a new SQL artifact (migration + Drizzle awareness + `db:push` before testing) for a single-screen win. The pagination approach is mechanically simple and bounded; the row count for a 3-year user is well within PostgREST's per-request budget when paginated. Option B remains the right move if a second aggregation use-case appears.

2. **(Alt to call #1) Option C — paginated lifetime read of `listWeeklyVolumeRows` issuing N `useQuery` instances with rolling `since` bounds**. Descartada porque worst-of-both-worlds: cache fragmentation, inconsistent staleness across pages, complex invalidation. The single paginated read inside one `queryFn` is simpler and cache-cohesive.

3. **(Alt to call #2) Display a multi-muscle exercise in EVERY tagged group (option b in the brief)**. Descartada porque it duplicates the row visually and would force the user to mentally dedupe to answer "how many exercises did I train?". The `muscles[0]` rule preserves the user's explicit order from the multi-select (made order-preserving by commit `b51dd01`).

4. **(Alt to call #2) Synthetic "Multi-muscle" group for multi-tagged exercises**. Descartada porque it creates a noisy 8th category that splits the visual flow without aiding navigation.

5. **(Alt to call #3) Count each PR-beat as a separate PR — if user beats Bench twice this week, that's 2 PRs**. Descartada per Conductor: the headline is per-exercise, motivational, and resistant to inflation. A user doing back-to-back PR sessions of the same lift shouldn't double their headline count.

6. **(Alt to call #4) Drop the chart entirely from Progress; let Hero + List + Streak do the talking**. Descartada porque the chart is the visual heartbeat (Discovery #7); the lifetime overlay reinforces the anchor without adding complexity.

7. **(Alt to call #4) Widen the window to 12 or 26 bars**. Descartada porque it visually competes with the History 8-week strip and reduces per-bar contrast; the overlay does the "lifetime anchor" work already.

8. **(Alt to call #4) Switch to an SVG `<ProgressChart>`-style line chart**. Descartada porque bars are the right shape for "discrete weekly totals" (each week is an event, not a continuous signal). `react-native-svg` would also introduce render-engine variance; the `<View>`-based strip is cross-platform-uniform.

9. **(Alt to call #5) Strict streak — drop to 0 the instant the current ISO week is empty**. Descartada porque it would punish Monday/Tuesday morning glances. The soft-fallback (showing the trailing count until the next ISO week begins) matches the prompt's "best streak so a break is contextualised rather than punishing".

10. **(Alt to call #6) Hide the chart and list when current ISO week is empty**. Descartada porque the chart shows the bigger-picture history (still relevant); only the list and the current-week bar are about *this* week. Empty-state copy on the list is sufficient.

11. **(Alt to call #7) Use `Activity` (heartbeat) icon for the tab**. Descartada porque it overlaps semantically with `History` (clock-back) and `Workout` (Dumbbell). `TrendingUp` is unambiguously about progress.

12. **(Alt to per-row PR badge) Show a "+X kg over previous best" callout per-row**. Descartada — that's the `<VolumeTargetSlot>` surpassed branch, which is for the live session. On Progress, the user already sees the PR count in the hero and the `To PR = 0` per-row signals the surpassed state implicitly; an emoji/glyph badge (🏆 or a 2-char "PR" pill) is enough.

13. **(Alt to file structure) Fold the lifetime hooks into `src/hooks/use-stats.ts`** rather than creating `use-progress-page.ts`. Descartada because the Progress-page hooks compose multiple existing hooks (`useLifetimeWeeklyVolume`, `useAllExercises`, sessions list) — they're page-specific orchestration, not raw fetchers. The naming separation matches the codebase's `use-stats` / `use-progress` / `use-sessions` convention where each file owns one data domain.

14. **(Alt to `<MaxNowToPrLine>`) Refactor `<VolumeTargetSlot>`'s chasing-branch render into the shared component, replacing the existing inline render**. Descartada in this run as a scope cut — it's an adjacent cleanup that increases blast radius (e2e tests for `volume-target-slot` would need re-validating). Filed under Out of scope as a follow-up.

## Out of scope

- **Refactoring `<VolumeTargetSlot>` to consume `<MaxNowToPrLine>`** — adjacent cleanup; not requested.
- **Postgres aggregate function / RPC for weekly volume** — Option B from call #1; deferred unless cold-start latency bites.
- **Trailing-12-weeks max anchor (softening the lifetime-best harshness)** — explicit prompt deferral.
- **End-of-session verdict screen** (`docs/features.md:20`) — separate feature.
- **PR-table denormalization / Postgres trigger** — `roadmap.md:124`.
- **Notifications / haptics on PR achievement** — separate scope.
- **Interactivity on the chart beyond tap-to-week-drill-down** (hover tooltips, zoom, pan) — scope creep.
- **Reordering / customising muscle groups** — `MUSCLE_GROUPS` is fixed.
- **Surfacing Progress page from inside an active session** — top-level tab only.
- **Cross-week comparison metrics** — explicitly excluded by prompt.
- **Multi-user / shared progress** — out per `roadmap.md:138-144`.
- **Doc cleanup of stale `docs/data-model.md:67` line** (`completed_at NOT NULL`) — unrelated.
- **Updating `docs/features.md`** — Conductor step at end of run, not Implementer.
- **Batched `useExerciseMaxVolumes(ids[])` hook** — superseded by the single lifetime kernel in this design; the hook need never exist if Progress always reads lifetime data wholesale.
