# Design v3 — 2026-05-22_0030_progress-page

> v3 == v2 + tight fixes for the 4 items raised in `validation-v2.md` (BLK-3, MAJ-4, MIN-8, MIN-9). Nothing else changes. Section tags: `[v2-carryover]` (untouched), `[changed-v3]` (revised), `[new-v3]` (introduced). To avoid duplication, where a section is entirely untouched I point at design-v2 instead of re-pasting; where it changes I show the delta.

## Resposta a issues do Validator [new-v3]

### Blocker

#### BLK-3 — Null `completed_at` crash on the lifetime branch. **Fix: add `.not("completed_at", "is", null)` to every read.**

**Root cause confirmed.** `SetRow.completed_at: string | null` (`src/db/types.ts:124`). `finishSession` (`sessions.ts:62-71`) only stamps `ended_at` on the session row; it does NOT auto-stamp `completed_at` on remaining unchecked sets. Those unchecked-but-in-a-finished-session sets persist with `completed_at = null`. The existing `stats.ts:29` lifetime-naive query uses `.gte("completed_at", sinceUtc)` which **implicitly** excludes `NULL` (PostgreSQL: `NULL >= '...'` evaluates to `NULL` → row dropped by PostgREST). v2's lifetime branch drops the `.gte()` and adds nothing in its place. Crash path:

```
listWeeklyVolumeRows({}) // sinceUtc omitted → no .gte() filter
  → returns rows including ones with completed_at = null
  → bucketWeeklyVolumes(rows) calls weekKeyOf(parseISO(row.completed_at))
  → parseISO(null) → Invalid Date
  → format(Invalid Date, "RRRR-'W'II") → RangeError: Invalid time value
  → React render throws → Progress page crashes
```

**Fix — apply `.not("completed_at", "is", null)` to all three read paths:**

1. `listWeeklyVolumeRows` — **both** branches (sinceUtc-bound AND lifetime). The sinceUtc-bound branch is safe today because `.gte` excludes nulls implicitly, but adding the explicit filter makes the contract obvious and survives future scope changes (e.g., someone swapping `.gte` for `.in` or a function-style filter).
2. `listSetsThisWeek` — defensive. Currently safe via `.gte("completed_at", ...)` but fragile for the same reason.
3. `listFinishedSessionStartedAts` — N/A. That query reads `sessions.started_at`, which is `NOT NULL` in the schema; no analogue.

**Concrete query — `listWeeklyVolumeRows` (BOTH branches):**

```ts
// src/api/stats.ts — both branches now share this filter chain:
supabase
  .from("sets")
  .select(
    "completed_at, weight, reps, set_type, exercise_id, session_id, sessions!inner(started_at, ended_at)",
  )
  .is("deleted_at", null)
  .not("completed_at", "is", null)            // [new-v3 per BLK-3]
  .not("sessions.ended_at", "is", null)
  .neq("set_type", "warmup")
  .order("completed_at", { ascending: true })
  // sinceUtc-bound branch ONLY:
  .gte("completed_at", opts.sinceUtc)
  // lifetime branch: no .gte(); paginate via .range(from, from + PAGE - 1)
```

**Concrete query — `listSetsThisWeek`:**

```ts
supabase
  .from("sets")
  .select(
    "*, sessions!inner(id, started_at, ended_at), exercises!inner(id, name, muscles, deleted_at)",
  )
  .is("deleted_at", null)
  .not("completed_at", "is", null)            // [new-v3 per BLK-3, defensive]
  .not("sessions.ended_at", "is", null)
  .neq("set_type", "warmup")
  .gte("completed_at", opts.weekStartIso)
  .lte("completed_at", opts.weekEndIso)
  .order("completed_at", { ascending: true });
```

> NOTE re MAJ-4 below: `listSetsThisWeek` is dropped in v3. The defensive filter still gets documented here because if a future contributor reintroduces a week-window server fetch (e.g., for a different feature), the v2/v3 design history must show that `.not("completed_at", "is", null)` is the correct pattern. The filter is added to the contract section for `listSetsThisWeek` BUT the function itself is removed from the file map.

**Type narrowing on the consumer side.** Because `SetRow.completed_at` remains nullable at the type level, the math helpers must still cope (TypeScript won't know the runtime filter). Two options:

- (a) Narrow at the API boundary: `WeeklyVolumeRow.completed_at: string` (no longer `string | null`), with a runtime `assert row.completed_at !== null` after the supabase call. Implementer call. **Recommendation: (a)** — pushes the invariant into the type system and removes the `?? ""` noise in `weekly-volume-strip.tsx:44`.
- (b) Leave the type nullable and add a defensive `if (!row.completed_at) continue;` inside `bucketWeeklyVolumes`. Cheaper but lets the invariant leak into call sites.

For v3 we pin (a): `WeeklyVolumeRow.completed_at: string` (narrowed), with a single post-fetch `assert` line in `listWeeklyVolumeRows`. See Contratos de I/O below.

**Unit test added — `null completed_at filtering`:**

> Test #42 (new): supabase mock returns a page that contains a row with `completed_at: null`. Assert that the function under test issues a `.not("completed_at", "is", null)` call on the query builder (verified via spy on the mock builder). Assert that if the mock ignores the filter and returns the null row anyway, the post-fetch narrow-cast `assert row.completed_at !== null` throws with a descriptive error message rather than letting the row reach `parseISO`.

Test placement: `tests/unit/progress-page-math.test.ts` under a new `describe("listWeeklyVolumeRows null-completed_at safety")` block, OR co-located with the supabase-mocking tests if such a file is added during Implement. Implementer call on file placement; the test itself is required.

**Defensive: also added a test for `listSetsThisWeek` even though that function is dropped (see MAJ-4).** Rationale: the spec for `listSetsThisWeek` lives in this design as a historical artifact; if reintroduced, the filter must be there. Test deferred unless `listSetsThisWeek` returns to the spec.

### Major

#### MAJ-4 — Pin `useExercisesThisWeek` data source. **Decision: derive from lifetime rows + `useAllExercises`. Drop `listSetsThisWeek`.**

**Rationale for derive (vs server-side fetch):**

1. **No extra round-trip.** The lifetime `WeeklyVolumeRow[]` from `useLifetimeWeeklyVolume` already carries `exercise_id`, `session_id`, `completed_at`, `weight`, `reps`, `set_type`, `sessions.started_at`, `sessions.ended_at`. Filtering client-side to the current ISO week is O(N) on rows already in memory.
2. **Single source of truth.** Both `usePrsThisWeek` and `useExercisesThisWeek` derive from the same lifetime kernel, so the "PR-flagged exercises" set in the hero matches the per-row `isPrThisWeek` flags in the list by construction. With a separate `listSetsThisWeek` fetch, those two could drift if the queries diverge (e.g., one filters `set_type = "warmup"` and the other doesn't).
3. **Fewer moving parts.** Deleting `listSetsThisWeek` removes one PostgREST query, one function, one ThisWeekSetRow type, and one spec entry. Less surface area for bugs.
4. **Library data already cached.** `useAllExercises` is mounted on every screen that reads exercises (it's the canonical exercise-library hook). The Progress page does NOT trigger a new network call for it — TanStack cache reuse covers it.

**Tradeoff accepted:** the client-side filter pass adds a few microseconds per render. Negligible for ~15k rows total / ~50-150 rows for the current-week window. Mitigated by `useMemo`.

**Concrete derivation in `useExercisesThisWeek`:**

```ts
// src/hooks/use-progress-page.ts
export function useExercisesThisWeek(): {
  data: ExerciseThisWeekRow[];
  isLoading: boolean;
  isError: boolean;
} {
  const lifetime = useLifetimeWeeklyVolume();
  const lib = useAllExercises();

  const data = useMemo<ExerciseThisWeekRow[]>(() => {
    if (!lifetime.data || !lib.data) return [];
    const weekStart = isoWeekStart(new Date());
    const weekEnd = endOfWeek(new Date(), { weekStartsOn: 1 });

    // 1. Filter lifetime rows to current ISO week (client-side).
    const thisWeekRows = lifetime.data.filter((r) => {
      const t = parseISO(r.completed_at);
      return t >= weekStart && t <= weekEnd;
    });

    // 2. Bucket by exercise_id: sum(weight*reps) per exercise across all
    //    this-week sessions (multiple sessions in the same week → summed).
    const nowKgByExercise = new Map<string, number>();
    for (const r of thisWeekRows) {
      const w = parseFloat(r.weight ?? "0");
      const reps = r.reps ?? 0;
      if (w > 0 && reps > 0) {
        nowKgByExercise.set(
          r.exercise_id,
          (nowKgByExercise.get(r.exercise_id) ?? 0) + w * reps,
        );
      }
    }

    // 3. Lifetime max single-session volume per exercise.
    //    Group all lifetime rows by (exercise_id, session_id), reduce to volume,
    //    then take per-exercise max. Reuses the bucketing inside countPrsThisWeek.
    const maxKgByExercise = computeLifetimeMaxPerExercise(lifetime.data);

    // 4. PR flags (per-exercise, this-week dedupe).
    const prSet = computePrExerciseIdsThisWeek({
      rows: lifetime.data,
      currentWeekStartIso: weekStart.toISOString(),
      currentWeekEndIso: weekEnd.toISOString(),
    });

    // 5. Join with library for name/muscles, group by primary muscle.
    const libById = new Map(lib.data.map((e) => [e.id, e] as const));
    const out: ExerciseThisWeekRow[] = [];
    for (const [exId, nowKg] of nowKgByExercise) {
      const ex = libById.get(exId);
      if (!ex) continue;  // dangling exercise_id — skip; matches history/[id].tsx safety
      const maxKg = maxKgByExercise.get(exId) ?? 0;
      const gapKg = Math.max(maxKg - nowKg, 0);
      const muscles = ex.muscles ?? [];
      const primary = muscles[0] ?? null;
      const group: MuscleGroup | "Other" =
        primary && (MUSCLE_GROUPS as readonly string[]).includes(primary)
          ? (primary as MuscleGroup)
          : "Other";
      out.push({
        exerciseId: exId,
        exerciseName: ex.name,
        muscles,
        group,
        maxKg,
        nowKg,
        gapKg,
        isPrThisWeek: prSet.has(exId),
      });
    }
    // Sort within each group: PR rows first, then by nowKg descending.
    // Group order driven by groupExercisesByPrimaryMuscle's canonical order.
    return out;
  }, [lifetime.data, lib.data]);

  return {
    data,
    isLoading: lifetime.isLoading || lib.isLoading,
    isError: lifetime.isError || lib.isError,
  };
}
```

**New helpers needed in `src/utils/progress-page-math.ts`** [new-v3]:

- `computeLifetimeMaxPerExercise(rows: WeeklyVolumeRow[]): Map<string, number>` — extracted from `countPrsThisWeek` so both helpers share the (exercise_id, session_id) bucketing pass. Returns per-exercise lifetime max single-session volume.
- `computePrExerciseIdsThisWeek(opts): Set<string>` — returns the set of exercise_ids that hit a PR during the current ISO week (the "set" form of `countPrsThisWeek`). `countPrsThisWeek` becomes `computePrExerciseIdsThisWeek(...).size`. Avoids two parallel implementations of the same scan.

**Files dropped from v2 spec** [changed-v3]:

- `listSetsThisWeek` removed from `src/api/progress-page.ts`.
- `ThisWeekSetRow` type removed from `src/api/progress-page.ts`.
- `src/api/progress-page.ts` now exports only `listFinishedSessionStartedAts`. (File still exists because it owns that one function. If the Implementer prefers, the function can fold into `src/api/sessions.ts` — that's a cosmetic call, not load-bearing. **Recommendation: keep the file** so Progress-page network surface is co-located.)

### Minors

#### MIN-8 — File-ordering prose corrected.

v2 said: "Add a 5th `<Tabs.Screen name="progress" …>` between `history` and `measurements`."

v3 corrects: **"Add a new `<Tabs.Screen name="progress" …>` after `history` in source order. Visible tab order on the bar will be History → Progress → Profile because `measurements` has `href: null` (hidden). Source order is the alphabetical group: exercises, history, measurements, profile, progress, workout — but because Expo Router preserves declaration order in the file, the literal placement in `app/(app)/_layout.tsx` is: place the new `<Tabs.Screen>` block immediately after the `history` block (or anywhere in the file — tab order is driven by `tabBarIcon` rendering and the visible-tab filter, not by source position). For readability, place it between the `history` block and the `measurements` block."** Net: same code outcome, accurate prose.

#### MIN-9 — `staleTime: 60_000` pinned for `useFinishedSessionStartedAts`.

v2 spec listed `staleTime: 60_000` only for `useLifetimeWeeklyVolume`. v3 adds the same `staleTime: 60_000` to `useFinishedSessionStartedAts`, matching the lifetime hook. Both queries cover the same temporal domain (lifetime, slow-changing) and should share refresh cadence. Updated in Contratos de I/O below.

---

## Goal (1 sentence) [v2-carryover]

See `design-v2.md` §Goal. Unchanged.

## Approach [v2-carryover with two tactical edits]

See `design-v2.md` §Approach for the seven Conductor calls. Two edits in v3:

- **Call #6 (lifetime read)** now explicitly filters `completed_at IS NOT NULL` server-side, in both the sinceUtc-bound branch (defensive) and the lifetime branch (load-bearing per BLK-3).
- **Per-exercise list data source** is pinned to client-side derivation from the lifetime rows + `useAllExercises` (MAJ-4); no `listSetsThisWeek` server fetch.

Everything else carries over.

## Decisions on unknowns [v2-carryover + 2 new rows]

See `design-v2.md` §"Decisions on unknowns" for rows 1-12. Two new rows in v3:

| # | Unknown | Decision | Rationale | Change vs v2 |
|---|---|---|---|---|
| 13 | **[new-v3]** Null `completed_at` in finished sessions | Server-side filter `.not("completed_at", "is", null)` on every reads; narrow `WeeklyVolumeRow.completed_at` to `string` post-fetch | BLK-3 | new-v3 |
| 14 | **[new-v3]** `useExercisesThisWeek` data source | Derive client-side from lifetime rows + `useAllExercises` | MAJ-4 | new-v3 |

## Mudanças por arquivo [changed-v3 — three deltas]

Carrying over every row from `design-v2.md` §"Mudanças por arquivo" **except** the three rows below, which change in v3. The full v2 list is in design-v2.md §"Mudanças por arquivo"; the deltas are:

| File | Type | Change |
|---|---|---|
| `app/(app)/_layout.tsx` | edited | **[changed-v3 per MIN-8]** Add a new `<Tabs.Screen name="progress" options={{ title: "Progress", tabBarIcon: ({color, size}) => <TrendingUp color={color} size={size} /> }} />`. Place it after the `history` block in source order (between `history` and `measurements`). Visible tab order on the bar will be **History → Progress → Profile** because `measurements` has `href: null`. Add `TrendingUp` to the `lucide-react-native` import. No other changes. |
| `src/api/stats.ts` | edited | **[changed-v3 per BLK-3]** All v2 changes plus: add `.not("completed_at", "is", null)` to BOTH branches (sinceUtc-bound AND lifetime) of `listWeeklyVolumeRows`. Add a post-fetch narrow-cast `assert row.completed_at !== null` (single line; throws on violation) and narrow the returned type to `WeeklyVolumeRow.completed_at: string` (non-null). Implementer detail: do the assert as `if (rows.some(r => r.completed_at === null)) throw new Error("listWeeklyVolumeRows: null completed_at slipped past the server filter")` — single pass, cheap. |
| `src/api/progress-page.ts` | new | **[changed-v3 per MAJ-4]** v2 listed two functions; v3 keeps only `listFinishedSessionStartedAts()`. `listSetsThisWeek` and `ThisWeekSetRow` are DROPPED. Rationale: `useExercisesThisWeek` now derives from `useLifetimeWeeklyVolume` + `useAllExercises` client-side (MAJ-4). The file still exists to own the streak-data fetch and stays paginated for safety. Defensive: when listing the dropped `listSetsThisWeek` query in this design's Contratos section, the filter `.not("completed_at", "is", null)` is documented so a future reintroduction inherits it. |
| `src/hooks/use-progress-page.ts` | new | **[changed-v3 per MAJ-4 + MIN-9]** v2 wired `useExercisesThisWeek` to optionally call `listSetsThisWeek`; v3 wires it to derive from `useLifetimeWeeklyVolume` + `useAllExercises` (no new cache key — it's a `useMemo`). `useFinishedSessionStartedAts` gets `staleTime: 60_000` (MIN-9). All other exports unchanged from v2. |
| `src/utils/progress-page-math.ts` | new | **[changed-v3 per MAJ-4]** v2 listed five helpers (`bucketWeeklyVolumes`, `findBestWeek`, `countPrsThisWeek`, `groupExercisesByPrimaryMuscle`, `computeStreaks`). v3 adds two more, extracted from `countPrsThisWeek` so both surfaces share the bucketing pass: `computeLifetimeMaxPerExercise(rows): Map<string, number>` and `computePrExerciseIdsThisWeek(opts): Set<string>`. `countPrsThisWeek` becomes `computePrExerciseIdsThisWeek(...).size` (one-liner; not a separate algorithm). Reduces duplication; both `usePrsThisWeek` and `useExercisesThisWeek` end up consistent by construction. |
| `tests/unit/progress-page-math.test.ts` | new | **[changed-v3]** All v2 tests, plus: test #42 (null-`completed_at` filter spy + post-fetch narrow-cast assertion — BLK-3). Tests #15-24 still apply to `countPrsThisWeek` AND to `computePrExerciseIdsThisWeek` (the latter is the source of truth for the count; the former is a thin wrapper). One test (#23 boundary single-prior, MAJ-3) gets a "tested via `.size`" assertion for the wrapper. |

**Unchanged rows** (carry over from v2 §"Mudanças por arquivo"):
- `app/(app)/progress/_layout.tsx` (new) — unchanged
- `app/(app)/progress/index.tsx` (new) — unchanged
- `src/hooks/use-stats.ts` (edited) — unchanged
- `src/components/weekly-volume-strip.tsx` (edited) — unchanged (BLK-2 fix from v2 still applies)
- `src/components/progress-hero.tsx` (new) — unchanged
- `src/components/exercises-this-week-list.tsx` (new) — unchanged
- `src/components/streak-card.tsx` (new) — unchanged
- `src/components/max-now-to-pr-line.tsx` (new) — unchanged
- `tests/e2e/progress-page.spec.ts` (new) — unchanged
- `tests/unit/weekly-volume-bucketing.test.ts` — still NO EDIT (MIN-1 v2 decision stands)
- `docs/features.md` — unchanged (Conductor concern post-merge)

No changes to: `src/api/progress.ts`, `src/utils/volume-target.ts`, `src/utils/dates.ts`, `src/utils/units.ts`, `src/db/schema.ts`, RLS policies, the active-session banner, `useSessions`/`useStartSession`/`useFinishSession`/`useSoftDeleteSession`/`useUpdateSessionTimes` cache-invalidation wiring (BLK-1 still relies on the existing `["stats"]` cascade).

## Contratos de I/O [changed-v3]

### `src/api/stats.ts` (edited) — [changed-v3 per BLK-3]

```ts
export type WeeklyVolumeRow = {
  completed_at: string;          // [changed-v3] narrowed from `string | null`
                                  // (server filter + post-fetch assert guarantee non-null)
  weight: string | null;
  reps: number | null;
  set_type: SetType;
  exercise_id: string;
  session_id: string;
  sessions: { started_at: string; ended_at: string };
};

/**
 * Reads finished, non-warmup, non-deleted sets with non-null completed_at.
 *
 * When `sinceUtc` is provided, filters `completed_at >= sinceUtc` and issues a
 * single-shot read (≤1000 rows expected).
 *
 * When `sinceUtc` is omitted, iterates paginated `.range(from, from + PAGE - 1)`
 * until a short page returns (PostgREST silent-1000-truncation mitigation).
 *
 * Both branches apply `.not("completed_at", "is", null)` server-side AND
 * assert non-null post-fetch (BLK-3 defence-in-depth — type is narrowed to
 * `completed_at: string` so downstream call sites don't need to coalesce).
 */
export async function listWeeklyVolumeRows(opts: {
  sinceUtc?: string;
}): Promise<WeeklyVolumeRow[]>;
```

**Select string (BOTH branches):** `"completed_at, weight, reps, set_type, exercise_id, session_id, sessions!inner(started_at, ended_at)"`.

**Filter chain (BOTH branches):**
- `.is("deleted_at", null)`
- `.not("completed_at", "is", null)` **[new-v3 per BLK-3]**
- `.not("sessions.ended_at", "is", null)`
- `.neq("set_type", "warmup")`
- `.order("completed_at", { ascending: true })`

Branch-specific: sinceUtc-bound adds `.gte("completed_at", opts.sinceUtc)`; lifetime branch paginates via `.range(from, from + PAGE - 1)`.

**Post-fetch narrow-cast (single line):**
```ts
if (rows.some(r => r.completed_at === null)) {
  throw new Error("listWeeklyVolumeRows: null completed_at slipped past server filter");
}
return rows as WeeklyVolumeRow[];  // safe narrow — completed_at: string
```

### `src/hooks/use-stats.ts` (edited) — [v2-carryover]

See design-v2.md. Unchanged.

### `src/api/progress-page.ts` (new) — [changed-v3 per MAJ-4]

```ts
/**
 * Minimal projection for streak math: every finished, non-deleted session's
 * `started_at`. Lifetime scope; paginated read via `.range()` for safety.
 */
export async function listFinishedSessionStartedAts(): Promise<
  { started_at: string }[]
>;
```

Underlying query:

```ts
const PAGE = 1000;
let from = 0;
const all: { started_at: string }[] = [];
while (true) {
  const { data, error } = await supabase
    .from("sessions")
    .select("started_at")
    .is("deleted_at", null)
    .not("ended_at", "is", null)
    .order("started_at", { ascending: true })
    .range(from, from + PAGE - 1);
  if (error) throw error;
  const page = (data ?? []) as { started_at: string }[];
  all.push(...page);
  if (page.length < PAGE) break;
  from += PAGE;
}
return all;
```

(`sessions.started_at` is `NOT NULL` in schema → no `.not("started_at", "is", null)` needed.)

**Removed in v3:** `listSetsThisWeek` and `ThisWeekSetRow`. See MAJ-4 rationale above. If reintroduced in the future, the filter chain MUST include `.not("completed_at", "is", null)`.

RLS: scoped by `auth.uid() = user_id` via existing policies. No new policy.

### `src/hooks/use-progress-page.ts` (new) — [changed-v3 per MAJ-4 + MIN-9]

```ts
import type { UseQueryResult } from "@tanstack/react-query";
import type { MuscleGroup, ExerciseRow } from "~/db/types";

export function useLifetimeBestWeek(): {
  data: { isoWeekKey: string; weekStartLabel: string; totalKg: number } | null;
  isLoading: boolean;
  isError: boolean;
};
// useMemo over useLifetimeWeeklyVolume()

export function usePrsThisWeek(): { data: number; isLoading: boolean; isError: boolean };
// useMemo: computePrExerciseIdsThisWeek({...}).size

/**
 * Lifetime read of every finished, non-deleted session's `started_at`.
 * Cache key: ["stats", "progress-page", "session-started-ats"]
 * staleTime:  60_000   // [changed-v3 per MIN-9 — matches useLifetimeWeeklyVolume]
 */
export function useFinishedSessionStartedAts():
  UseQueryResult<{ started_at: string }[], Error>;

export function useStreaks(): { data: { current: number; best: number }; isLoading: boolean; isError: boolean };

/**
 * Exercises trained this ISO week, derived CLIENT-SIDE from
 * useLifetimeWeeklyVolume + useAllExercises. No server round-trip.
 * No new cache key.
 */
export type ExerciseThisWeekRow = {
  exerciseId: string;
  exerciseName: string;
  muscles: string[];
  group: MuscleGroup | "Other";
  maxKg: number;
  nowKg: number;
  gapKg: number;
  isPrThisWeek: boolean;
};

export function useExercisesThisWeek(): { data: ExerciseThisWeekRow[]; isLoading: boolean; isError: boolean };

export function useProgressPageRefresh(): {
  refreshing: boolean;
  onRefresh: () => Promise<void>;
};
```

**Implementation note — single lifetime kernel, no week-window server fetch** [changed-v3]:

- `useLifetimeWeeklyVolume()` (paginated lifetime read of `WeeklyVolumeRow[]`) feeds **all four** derived hooks: `useLifetimeBestWeek`, `usePrsThisWeek`, `useExercisesThisWeek`, and the strip's `bestWeekKg` prop (which reads from `useLifetimeBestWeek`).
- `useAllExercises()` (the canonical library hook, already TanStack-cached) supplies name/muscles/deleted_at for the per-row display.
- `useFinishedSessionStartedAts()` is the only OTHER lifetime read — it feeds `useStreaks` exclusively. (Why a second query? Because session metadata isn't carried in `WeeklyVolumeRow` for sessions where no sets were checked. A finished session with all sets unchecked would NOT appear in the sets-based query — its rows have `completed_at = null` and are now filtered out per BLK-3. The streak math counts ANY finished session, even if no sets were checked. So the two reads are NOT redundant: the sets-based read tells you "what was logged", the sessions-based read tells you "what sessions happened".)
- **Total Progress cold-start parallel queries: 4** (lifetime weekly volume, 8-week weekly volume from the embedded strip, finished-session started_ats, full exercises library). All four fire in parallel.

Cache invalidation: `["stats"]` prefix on `useFinishSession`/`useUpdateSessionTimes`/`useSoftDeleteSession` covers all three Progress-page raw fetches. `["exercises"]` covers the library read. Unchanged from v2.

### `src/utils/progress-page-math.ts` (new) — [changed-v3 per MAJ-4]

```ts
import type { MuscleGroup, ExerciseRow } from "~/db/types";
import type { WeeklyVolumeRow } from "~/api/stats";

export function bucketWeeklyVolumes(
  rows: WeeklyVolumeRow[],
): Map<string, number>;
// Buckets rows into weekKeyOf(parseISO(completed_at)). Volume = parseFloat(weight) * reps
// with w > 0 && r > 0 guard. (completed_at is now non-null per BLK-3 — no defensive
// skip needed inside the loop. The type system enforces it.)

export function findBestWeek(
  buckets: Map<string, number>,
): { isoWeekKey: string; weekStartLabel: string; totalKg: number } | null;
// Insertion-order Map + strict `>` → oldest tied week wins (MIN-7).

/**
 * [new-v3 per MAJ-4]
 * Lifetime max single-session volume per exercise.
 * Internally: group rows by (exercise_id, session_id), reduce each group to
 * its volume (sum of w*r with w>0 && r>0 guard), then take the per-exercise max.
 * Shared by usePrsThisWeek and useExercisesThisWeek.
 */
export function computeLifetimeMaxPerExercise(
  rows: WeeklyVolumeRow[],
): Map<string, number>;

/**
 * [new-v3 per MAJ-4]
 * Returns the set of exercise_ids that hit a strict-PR session during the
 * current ISO week. Algorithm:
 *   1. Group rows by (exercise_id, session_id), reduce to volume.
 *   2. For each exercise, sort sessions ASC by sessions.started_at.
 *      Compute running priorMax (starts at 0; updated AFTER each session).
 *   3. A session "is a PR" iff volume > priorMax AND priorMax > 0
 *      (first-ever session is NOT a PR — matches volume-target.ts:124-126).
 *   4. An exercise is in the returned set iff it has ≥1 PR session whose
 *      sessions.started_at falls in [currentWeekStartIso, currentWeekEndIso].
 */
export function computePrExerciseIdsThisWeek(opts: {
  rows: WeeklyVolumeRow[];
  currentWeekStartIso: string;
  currentWeekEndIso: string;
}): Set<string>;

/**
 * [v2-carryover] Thin wrapper over computePrExerciseIdsThisWeek for the
 * hero's count display. Implementation:
 *   countPrsThisWeek = (opts) => computePrExerciseIdsThisWeek(opts).size
 */
export function countPrsThisWeek(opts: {
  rows: WeeklyVolumeRow[];
  currentWeekStartIso: string;
  currentWeekEndIso: string;
}): number;

export function groupExercisesByPrimaryMuscle(
  exercises: ExerciseRow[],
): Map<MuscleGroup | "Other", ExerciseRow[]>;

export function computeStreaks(
  sessions: { started_at: string }[],
  now: Date,
): { current: number; best: number };
```

### UI prop shapes — [v2-carryover]

See design-v2.md. Unchanged. The `<WeeklyVolumeStrip>` `bestWeekKg`/`bestWeekLabel` props and BLK-2 denominator math carry over verbatim.

### DB columns / queries [changed-v3]

No new columns, no new indexes, no new policies. Existing `sets_exercise_completed_idx (exercise_id, completed_at)` covers per-exercise lifetime scans; existing `sessions_user_started_idx (user_id, started_at)` covers session-only queries. **The new `.not("completed_at", "is", null)` filter benefits from the existing `completed_at`-aware index** — PostgREST translates `IS NOT NULL` to a SARGable predicate when the column is indexed, so no extra cost vs the old `.gte` filter. RLS unaffected.

## Page composition [v2-carryover]

See design-v2.md. Unchanged.

## Hooks + API additions (summary signatures) [changed-v3]

```ts
// src/api/stats.ts
export async function listWeeklyVolumeRows(opts: { sinceUtc?: string }): Promise<WeeklyVolumeRow[]>;
// WeeklyVolumeRow.completed_at is now `string` (narrowed; BLK-3)

// src/api/progress-page.ts
export async function listFinishedSessionStartedAts(): Promise<{ started_at: string }[]>;
// (listSetsThisWeek DROPPED in v3 — MAJ-4)

// src/hooks/use-stats.ts
export function useLifetimeWeeklyVolume(): UseQueryResult<WeeklyVolumeRow[], Error>;
//   cache key ["stats", "weekly-volume", "lifetime"], staleTime: 60_000

// src/hooks/use-progress-page.ts
export function useLifetimeBestWeek(): { data: BestWeek | null; isLoading: boolean; isError: boolean };
export function usePrsThisWeek(): { data: number; isLoading: boolean; isError: boolean };
export function useFinishedSessionStartedAts(): UseQueryResult<{ started_at: string }[], Error>;
//   cache key ["stats", "progress-page", "session-started-ats"], staleTime: 60_000  // [changed-v3 per MIN-9]
export function useStreaks(): { data: { current: number; best: number }; isLoading: boolean; isError: boolean };
export function useExercisesThisWeek(): { data: ExerciseThisWeekRow[]; isLoading: boolean; isError: boolean };
//   derives from useLifetimeWeeklyVolume + useAllExercises — no new key
export function useProgressPageRefresh(): { refreshing: boolean; onRefresh: () => Promise<void> };
```

## Test plan [changed-v3]

All tests #1-#41 from design-v2.md §"Test plan" carry over. New + revised tests in v3:

### Unit — null-`completed_at` safety [new-v3 per BLK-3]

**Test #42 — "lifetime branch filters null completed_at server-side"**:
- Mock `supabase.from("sets").select(...)` to return a builder that records each `.not()` invocation.
- Call `listWeeklyVolumeRows({})` (lifetime branch, no `sinceUtc`).
- Assert the builder received `.not("completed_at", "is", null)`.
- Assert the builder also received `.not("sessions.ended_at", "is", null)` (carryover sanity).

**Test #43 — "sinceUtc branch also filters null completed_at"**:
- Same as #42 but with `listWeeklyVolumeRows({ sinceUtc: "2026-04-01T00:00:00Z" })`.
- Assert `.not("completed_at", "is", null)` is in the chain alongside `.gte("completed_at", "2026-04-01T00:00:00Z")`.

**Test #44 — "post-fetch assert throws if server filter is bypassed"**:
- Mock supabase to return a row with `completed_at: null` (simulating a broken filter or RLS edge case).
- Call `listWeeklyVolumeRows({})`.
- Expect: throws with message containing "null completed_at slipped past server filter".
- Asserts the defense-in-depth assertion fires rather than letting the null row reach `parseISO`.

**Test #45 — "no null rows → returns narrowed rows, no throw"**:
- Mock supabase to return 3 valid rows (all `completed_at: string`).
- Expect: returns 3 rows, no throw, TypeScript narrow `row.completed_at: string` holds at call-site.

### Unit — `computeLifetimeMaxPerExercise` [new-v3 per MAJ-4]

**Test #46** — Empty rows → empty map.
**Test #47** — One exercise, one session, two sets (weight 100×reps 5 + weight 100×reps 5) → Map { exId → 1000 }.
**Test #48** — One exercise, two sessions, S1 = 500 kg total, S2 = 800 kg total → Map { exId → 800 }.
**Test #49** — Two exercises, distinct sessions → both keys present with correct maxes.

### Unit — `computePrExerciseIdsThisWeek` [new-v3 per MAJ-4]

Carries over tests #14-#24 from `countPrsThisWeek` (which is now `.size` of this) but asserted on the returned `Set`:
**Test #50** — One exercise hits PR this week → Set has size 1, contains the exercise_id.
**Test #51** — Two exercises both PR this week → Set has size 2, contains both ids.
**Test #52** — `countPrsThisWeek` wrapper returns `.size` of `computePrExerciseIdsThisWeek` for the same inputs (parity test pinning the contract).

### Unit — `useExercisesThisWeek` derivation [new-v3 per MAJ-4]

If/once the hook is unit-testable with the standard TanStack mock pattern used elsewhere in the codebase (Implementer call on whether to test through the hook or through a directly-exported pure helper):

**Test #53** — Two exercises trained this week, one in the library, one not in the library → only the in-library row appears in the output (dangling exercise_id is skipped).
**Test #54** — Exercise with `muscles: []` ends up in `group: "Other"`.
**Test #55** — Exercise with `muscles: ["Chest", "Shoulders"]` ends up in `group: "Chest"` (primary-only rule from v1 Decision #1).
**Test #56** — `isPrThisWeek` flag matches `computePrExerciseIdsThisWeek` for the same input. (Parity guard.)

### Unit + E2E carryover

- Tests #1-#41 — see design-v2.md.
- E2E suite (`tests/e2e/progress-page.spec.ts`) — unchanged from v2 (7 tests).

### Manual smoke (Tester scope)

Items #1-#9 carry over from design-v2.md (including the v2 MIN-3 benchmark item). **New item #10** [new-v3 per BLK-3]: **smoke-test the lifetime read against a real account that has at least one finished session containing unchecked sets** (e.g., a user who started 5 sets, completed 3, then tapped "Finish"). Expected: Progress page renders without error; the unchecked sets are absent from the chart, hero, list, and streak math. Procedure: create such a session in the dev account, navigate to Progress, confirm no RangeError, confirm the in-finished-session unchecked sets are not counted anywhere.

## Riscos [changed-v3 — two updates, rest carryover]

All risks from design-v2.md §Riscos carry over. Two updates in v3:

- **[changed-v3] Data integrity — null `completed_at` in finished sessions**: addressed by BLK-3 fix. Server-side filter on every read + post-fetch assertion + narrow-cast type. The risk is now eliminated at three independent layers (server filter, runtime assertion, TypeScript narrow). Defense-in-depth.

- **[changed-v3] Performance — lifetime read on cold start**: `.not("completed_at", "is", null)` is SARGable against the existing `sets_exercise_completed_idx (exercise_id, completed_at)` index, so the filter does not slow the query. Net query time unchanged from v2's 2.5-3s estimate (still unmeasured; benchmark item #9 in Manual smoke covers).

All other risks from design-v2.md (UX regression on History strip, cache key collision, TZ correctness, platform divergence, render cost, PR-count edge cases, refresh fan-out, active-session interaction, iPhone SE tab width, lifetime peak outlier, bar visual regression on Progress) — unchanged. See design-v2.md §Riscos for the full list.

## Alternativas descartadas [changed-v3 — 4 new]

All 18 alternatives from design-v2.md §"Alternativas descartadas" carry over. Four new in v3:

19. **[new-v3 per BLK-3]** Leave `WeeklyVolumeRow.completed_at` typed as `string | null` and defensively skip null rows inside each math helper (`if (!row.completed_at) continue;`). **Descartada** because: (i) lets the invariant leak into every consumer; (ii) `parseISO(null)` ambiguity surfaces at the call site rather than the API boundary; (iii) inconsistent — what does "exercise volume" mean for a row with no completed_at? Better to filter once at the API.

20. **[new-v3 per BLK-3]** Backfill `completed_at` for the unchecked sets via a one-time migration. **Descartada** because: (i) out of scope — this run is a read-only dashboard, not a data-correctness migration; (ii) backfill semantics are unclear (set `completed_at = session.ended_at`? Then those sets appear in the chart as if they happened, which is wrong); (iii) the proper fix is to NOT show unchecked sets at all (the server filter accomplishes this).

21. **[new-v3 per BLK-3]** Add a `CHECK` constraint on `sets.completed_at NOT NULL` when `session.ended_at IS NOT NULL`. **Descartada** because: (i) DB-level fix is heavier than the read-side filter; (ii) breaks `finishSession`'s current "stamp ended_at only" semantics — would need an accompanying trigger to auto-stamp `completed_at` on session finalize, which is a bigger change; (iii) out of scope. Note: a future migration to enforce this constraint at the DB level is a sound idea, but belongs in its own run.

22. **[new-v3 per MAJ-4]** Keep `listSetsThisWeek` and use it for `useExercisesThisWeek` (server-side fetch with the `exercises!inner` join). **Descartada** because: (i) one extra round-trip per Progress mount with zero correctness benefit; (ii) drift risk between the lifetime PR set and the per-row PR flag (two queries, two filter chains); (iii) defeats the "single lifetime kernel" architecture principle from v1 Decision #6. Keep the option open for a future scope expansion (e.g., if the Progress page grows past 200 weekly sets), but for v1 ship, derive client-side.

## Out of scope [v2-carryover + 3 new]

All items from design-v2.md §"Out of scope" carry over. Three new in v3:

- **[new-v3]** Backfilling `completed_at` for unchecked sets in finished sessions (alternative 20).
- **[new-v3]** Adding a DB-level `CHECK` or `BEFORE UPDATE` trigger to require `completed_at` on finalized sessions (alternative 21).
- **[new-v3]** Server-side week-window join for `useExercisesThisWeek` (`listSetsThisWeek` reintroduction; alternative 22).

---

## Self-check vs Validator v2 findings

- **BLK-3**: addressed at three layers — server-side `.not("completed_at", "is", null)` filter on both branches of `listWeeklyVolumeRows`, post-fetch assertion that throws on violation, TypeScript narrow of `WeeklyVolumeRow.completed_at` to non-null `string`. Filter also applied defensively in the design contract for `listSetsThisWeek` even though that function is dropped in v3 (MAJ-4) — historical record so future reintroduction inherits the pattern. Four new tests (#42-#45) added.
- **MAJ-4**: addressed by pinning to client-side derivation. `useExercisesThisWeek` derives from `useLifetimeWeeklyVolume` + `useAllExercises`. `listSetsThisWeek` and `ThisWeekSetRow` are DROPPED from the spec. Two new helpers (`computeLifetimeMaxPerExercise`, `computePrExerciseIdsThisWeek`) introduced to share the bucketing pass with `usePrsThisWeek`. `countPrsThisWeek` becomes `.size` of the latter. Seven new tests (#46-#52, #53-#56 conditional on hook testability).
- **MIN-8**: addressed. File-ordering prose rewritten to call out that `measurements` is hidden (`href: null`) and the visible tab sequence is History → Progress → Profile.
- **MIN-9**: addressed. `useFinishedSessionStartedAts` gets `staleTime: 60_000` to match `useLifetimeWeeklyVolume`.

No new blockers or majors introduced (verified against design-v2.md item by item; only the four targeted items change, plus the cascading helper extraction in `progress-page-math.ts`).

## What did NOT change from v2 (explicit)

- BLK-1 cache-key namespacing decision (option (a), `["stats", "progress-page", …]`).
- BLK-2 max-aware chart denominator formula and overlay y-position.
- MAJ-1 paginated read pseudocode for the lifetime branch (only the filter chain gained `.not("completed_at", "is", null)`).
- MAJ-2 `completed_at`-based week-window filter pattern (documented in the dropped `listSetsThisWeek` contract for future inheritance).
- MAJ-3 single-prior-session PR boundary tests (#23 and #24).
- MIN-1 through MIN-7 acknowledgements.
- Page composition, ASCII mockups, tab icon (`TrendingUp`), `<MaxNowToPrLine>` shape, streak math semantics, muscle-grouping rule, empty-state copy decisions.
- All other risks, all other alternatives, all other tests.
