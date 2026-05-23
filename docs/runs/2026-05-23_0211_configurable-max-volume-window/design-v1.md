# Design v1 — 2026-05-23_0211_configurable-max-volume-window

## Goal (1 sentence)
Add a server-stored per-user preference that lets users compare the "max volume" surfaces (Progress hero, lifetime-best strip overlay, per-exercise rows, live volume target, and end-of-session PR detection) against the most recent **10**, **20**, or **30** ISO weeks instead of full lifetime, defaulting to lifetime so no existing user's behaviour changes until they opt in.

## Approach
Thread a single optional `windowStartIso?: string` parameter through the four lifetime-max kernels (`computeLifetimeMaxPerExercise`, `bucketLifetimeWeeklyVolumes`, `computePrsThisWeek`, `computeCurrentWeekVolume` is left alone — "Now" is always the current week) and through `computeVolumeTarget`'s `pastSessions`. The window is computed at the hook layer ("current ISO week's Monday minus N weeks, as `toISOString()`"), so kernels remain pure date-comparators with no clock awareness. The new pref is persisted under `user_preferences.max_volume_window_weeks` (integer, `0 = lifetime`) following the `length_unit` precedent verbatim — same migration shape, same API setter pair, same hook pair, same Profile segmented control. The window is applied **uniformly** across all max/PR surfaces to keep semantic coherence (no contradiction between "PR!" on the verdict screen and "still chasing" on the Progress page). Default is `0` (lifetime) — strictly opt-in — so the migration is a no-op for behaviour and every existing test that uses lifetime semantics stays green by passing `windowStartIso = undefined`. Server-side filtering on `listWeeklyVolumeRows` is deliberately NOT touched: the lifetime dataset is already in `["stats", "weekly-volume", "lifetime"]` cache, kernels iterate once per memo, and adding a `sinceUtc` round-trip would require a second cache namespace per window value — a future optimisation, not v1 need.

Confidence: HIGH that the chosen path matches existing precedents and preserves every invariant (strict-`>` PRs, oldest-tie-wins, first-ever-session-is-not-PR). Risk: MEDIUM — the change is broad (5 kernels + 5 consumer hooks + 3 user-visible surfaces), but every leaf is additive and gated by a default that preserves current behaviour.

## Mudanças por arquivo

| File | Type | Change |
|---|---|---|
| `supabase/migrations/0008_max_volume_window.sql` | new | Single migration: `ALTER TABLE public.user_preferences ADD COLUMN max_volume_window_weeks integer NOT NULL DEFAULT 0;` + `ADD CONSTRAINT user_preferences_max_volume_window_weeks_check CHECK (max_volume_window_weeks IN (0, 10, 20, 30));`. Mirrors `0005_measurements.sql:24-37` shape (column-then-check). No seed-function rewrite — `seed_new_user()` (`0001_rls_and_seed.sql:55`) omits the column and the DEFAULT picks it up. RLS unchanged. |
| `src/db/schema.ts` | edited | Add one column inside `userPreferences` table (line 33-40): `maxVolumeWindowWeeks: integer("max_volume_window_weeks").notNull().default(0)`. Imports already include `integer` (line 6). No other table touched. |
| `src/db/types.ts` | edited | Add string-literal union `MaxVolumeWindowWeeks = 0 | 10 | 20 | 30` next to `LengthUnit` (line 34). Export `MAX_VOLUME_WINDOW_OPTIONS: readonly MaxVolumeWindowWeeks[] = [0, 10, 20, 30] as const` for the Profile segmented control to enumerate. |
| `src/api/preferences.ts` | edited | (a) Extend `UserPreferencesRow` type (line 4-11) with `max_volume_window_weeks: MaxVolumeWindowWeeks`. (b) Add `setMaxVolumeWindowWeeks(weeks: MaxVolumeWindowWeeks): Promise<UserPreferencesRow>` symmetric with `setLengthUnit` (line 43-56). |
| `src/hooks/use-preferences.ts` | edited | Add `useMaxVolumeWindowWeeks(): MaxVolumeWindowWeeks` (default `0`, matches `useLengthUnit` shape line 20-23) and `useSetMaxVolumeWindowWeeks()` mutation hook (matches `useSetLengthUnit` line 33-39). Same `KEY = ["preferences", "me"]` cache, same `qc.setQueryData` pattern. |
| `src/utils/window-utils.ts` | new | Tiny pure helper: `export function windowStartIsoForWeeks(weeks: MaxVolumeWindowWeeks, now: Date): string | undefined`. Returns `undefined` when `weeks === 0` (lifetime). Otherwise returns `subWeeks(isoWeekStart(now), weeks).toISOString()` — the local Monday `N` weeks before the current ISO week's Monday, serialized as UTC ISO. Kernel-layer threshold is **strict `>=`**, so this Monday is the **earliest included `started_at`** — the "current week minus N prior weeks" semantic (see Window semantics below). Single source of truth so the hero, list, verdict, and live target all derive the same boundary. |
| `src/utils/progress-page-math.ts` | edited | (1) Add optional `windowStartIso?: string` to `bucketLifetimeWeeklyVolumes(rows, windowStartIso?)` — skip rows whose `parseISO(row.completed_at) < windowStartIso` (see Contracts). (2) Same param on `computeLifetimeMaxPerExercise(rows, windowStartIso?)`. (3) Same param on `computePrsThisWeek({rows, currentWeekStartIso, currentWeekEndIso, windowStartIso?})` — applied during the per-exercise prior-running-max walk by skipping rows older than `windowStartIso` BEFORE the priorMax accumulator updates (so an excluded ancient PR no longer suppresses a current-window PR). Critical detail: filter on `row.completed_at`, not `row.sessions.started_at`, to mirror `bucketLifetimeWeeklyVolumes`' bucketing rule. (4) `computePrExerciseIdsThisWeek` already routes through `computePrsThisWeek` — just plumb the optional param through. (5) `computeCurrentWeekVolume` NOT touched ("Now" is always this week, orthogonal to the window). |
| `src/utils/session-verdict-math.ts` | edited | Add optional `windowStartIso?: string` to `computePrsForSession`. Passes the param straight through to the inner `computeLifetimeMaxPerExercise(priorRows, windowStartIso)` call (`session-verdict-math.ts:94`). PR semantic stays strict-`>` and `priorMaxKg > 0` — both invariants survive windowing trivially. |
| `src/utils/volume-target.ts` | edited | Add optional `windowStartIso?: string` to `ComputeVolumeTargetInput`. Inside `computeVolumeTarget`, filter `pastSessions` BEFORE the previous-max reduction (line 117-122): skip sessions whose `started_at < windowStartIso`. We filter on the **session's `started_at`**, not on individual set `completed_at`, because `SessionSets` groups sets by session and the time-anchor of "the previous session you're chasing" is the session, not its trailing set. Window comparison uses `parseISO(session.started_at) >= parseISO(windowStartIso)`. |
| `src/hooks/use-progress-page.ts` | edited | (1) `useLifetimeBestWeek` (line 33-44): read `useMaxVolumeWindowWeeks()`, derive `windowStartIso` via `windowStartIsoForWeeks(weeks, new Date())`, pass into `bucketLifetimeWeeklyVolumes(q.data, windowStartIso)`. Add `windowStartIso` to `useMemo` deps. **Note on hook name**: keep the name `useLifetimeBestWeek` despite the slight misnomer, document with a JSDoc that says "when window=0 the result is lifetime; otherwise the best week within the trailing N weeks". Rationale: rename ripples into `app/(app)/progress/index.tsx:32` and `progress-hero.tsx:34`; the gain (clarity) doesn't justify the friction (Discovery's recommendation #7, plus zero downstream signature change). (2) `usePrsThisWeek` (line 82-117): pass `windowStartIso` into `computePrsThisWeek`. (3) `useExercisesThisWeek` (line 193-295): pass `windowStartIso` into `computeLifetimeMaxPerExercise(lifetime.data, windowStartIso)` (line 227). Add `windowStartIso` (a string-or-undefined memo) to deps. |
| `src/components/progress-hero.tsx` | edited | (1) Read `useMaxVolumeWindowWeeks()`. (2) Replace the static legend caption at `progress-hero.tsx:163` with a window-aware string (see Copy strings). (3) No change to `MaxNowToPrLine` props — `maxKg` is already windowed by `useLifetimeBestWeek`. |
| `src/components/volume-target-slot.tsx` | edited | Read `useMaxVolumeWindowWeeks()`, derive `windowStartIso` once via `useMemo`, pass into `computeVolumeTarget({ pastSessions, currentSessionSets, windowStartIso })` (line 36-43). Memo deps gain `windowStartIso`. |
| `app/(app)/workout/verdict/[sessionId].tsx` | edited | Read `useMaxVolumeWindowWeeks()`, derive `windowStartIso`, pass into `computePrsForSession({rows, currentSessionId, currentSessionVolumeByExercise, windowStartIso})` (line 60-64). Add to `useMemo` deps. |
| `app/(app)/profile.tsx` | edited | Add a third segmented control row beneath the Length unit row (currently lines 80-121), matching that row's structure verbatim. Iterates `MAX_VOLUME_WINDOW_OPTIONS`, label map `0 → "Lifetime"`, `10 → "10w"`, `20 → "20w"`, `30 → "30w"`. Backing hook: `useSetMaxVolumeWindowWeeks`. Active variant `bg-black dark:bg-white`. Error block mirrors the existing rows. |
| `tests/unit/progress-page-math.test.ts` | edited | Add a windowed-mode block for `bucketLifetimeWeeklyVolumes`, `computeLifetimeMaxPerExercise`, and `computePrsThisWeek`. Each block covers: (a) row exactly at `windowStartIso` (included — `>=`), (b) row 1ms before `windowStartIso` (excluded), (c) ancient PR excluded → in-window second-best becomes the priorMax → new PR fires when it wouldn't have under lifetime, (d) `windowStartIso = undefined` falls back to identical lifetime numbers (regression-guard for existing cases). Keep all existing lifetime-mode cases unchanged. |
| `tests/unit/session-verdict-math.test.ts` | edited | Add 3 windowed-mode cases for `computePrsForSession`: (a) ancient PR excluded by window → current session beats the in-window prior → PR fires; (b) in-window `priorMaxKg = 0` (only ancient sessions) → NOT a PR (first-ever-in-window-doesn't-count parity with `volume-target.ts`); (c) `windowStartIso = undefined` falls back to identical lifetime numbers. |
| `tests/unit/volume-target.test.ts` | edited | Add 3 windowed-mode cases for `computeVolumeTarget`: (a) ancient max excluded → `previousMaxKg` becomes the in-window second-best; (b) all `pastSessions` excluded → `kind: "no-pr"` regardless of how many prior sessions existed; (c) `windowStartIso = undefined` is identical to current behaviour. |
| `tests/unit/window-utils.test.ts` | new | Cases: (1) `weeks = 0` → `undefined`. (2) `weeks = 10` with `now = 2026-05-23` (Saturday) → returns the Monday of `2026-W11` (10 weeks before `2026-W21`). (3) DST boundary — pick a `now` that straddles BRT's local-time clock change and assert the returned Monday is still 00:00 local. (4) Snapshot the ISO string for `weeks = 10/20/30` against a fixed `now`. |
| `tests/unit/profile.test.tsx` (if it exists) OR new `tests/component/profile-max-volume-window.test.tsx` | new/edited | Smoke test: render `<ProfileScreen />` with a mocked `usePreferences` that returns each of `{0, 10, 20, 30}`. Assert the correct segment is rendered as active (`bg-black dark:bg-white`). Assert pressing a different segment calls `useSetMaxVolumeWindowWeeks().mutate` with the right integer. |

## Contratos de I/O

### Function signatures added or changed

```ts
// src/db/types.ts
export type MaxVolumeWindowWeeks = 0 | 10 | 20 | 30;
export const MAX_VOLUME_WINDOW_OPTIONS: readonly MaxVolumeWindowWeeks[] = [
  0, 10, 20, 30,
] as const;

// src/api/preferences.ts
export type UserPreferencesRow = {
  user_id: string;
  weight_unit: WeightUnit;
  length_unit: LengthUnit;
  max_volume_window_weeks: MaxVolumeWindowWeeks; // NEW
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};
export async function setMaxVolumeWindowWeeks(
  weeks: MaxVolumeWindowWeeks,
): Promise<UserPreferencesRow>;

// src/hooks/use-preferences.ts
export function useMaxVolumeWindowWeeks(): MaxVolumeWindowWeeks; // default 0
export function useSetMaxVolumeWindowWeeks(): UseMutationResult<
  UserPreferencesRow, Error, MaxVolumeWindowWeeks
>;

// src/utils/window-utils.ts
export function windowStartIsoForWeeks(
  weeks: MaxVolumeWindowWeeks,
  now: Date,
): string | undefined;
// weeks === 0 → undefined.
// weeks > 0  → subWeeks(isoWeekStart(now), weeks).toISOString().

// src/utils/progress-page-math.ts
export function bucketLifetimeWeeklyVolumes(
  rows: WeeklyVolumeRow[],
  windowStartIso?: string, // NEW — undefined ⇒ no filter (lifetime)
): Map<string, number>;

export function computeLifetimeMaxPerExercise(
  rows: WeeklyVolumeRow[],
  windowStartIso?: string, // NEW
): Map<string, number>;

export function computePrsThisWeek(opts: {
  rows: WeeklyVolumeRow[];
  currentWeekStartIso: string;
  currentWeekEndIso: string;
  windowStartIso?: string; // NEW
}): PrThisWeek[];

export function computePrExerciseIdsThisWeek(opts: {
  rows: WeeklyVolumeRow[];
  currentWeekStartIso: string;
  currentWeekEndIso: string;
  windowStartIso?: string; // NEW
}): Set<string>;

// src/utils/session-verdict-math.ts
export function computePrsForSession(opts: {
  rows: WeeklyVolumeRow[];
  currentSessionId: string;
  currentSessionVolumeByExercise: Map<string, number>;
  windowStartIso?: string; // NEW
}): SessionPr[];

// src/utils/volume-target.ts
export type ComputeVolumeTargetInput = {
  pastSessions: SessionSets[] | undefined;
  currentSessionSets: SetRow[];
  windowStartIso?: string; // NEW
};
export function computeVolumeTarget(input: ComputeVolumeTargetInput): VolumeTargetState;
```

### Filter predicate (uniform across kernels)

- **In `bucketLifetimeWeeklyVolumes`, `computeLifetimeMaxPerExercise`, `computePrsThisWeek`**: filter on `row.completed_at`. Skip iff `windowStartIso !== undefined && row.completed_at < windowStartIso`. ISO-8601 strings sort lexicographically the same as chronological order, so we compare strings directly — no `parseISO` cost per row.
- **In `computeVolumeTarget`**: filter on `session.started_at` from `SessionSets`. Skip iff `windowStartIso !== undefined && session.started_at < windowStartIso`. Different field because the kernel iterates `SessionSets[]`, not raw set rows, and the session's anchor is `started_at`.
- **Boundary is inclusive on the lower end (`>=`)**: a row whose `completed_at` exactly equals `windowStartIso` is INCLUDED. This matches the precedent at `src/api/stats.ts:59` (`.gte("completed_at", opts.sinceUtc)`).

### Window semantics — choice (a) "last N weeks excluding current week"

Implementation: `windowStartIso = subWeeks(isoWeekStart(now), N).toISOString()`.

- For `N = 10` and `now = 2026-05-23` (Saturday in `2026-W21`): `isoWeekStart(now)` = Monday 2026-05-18 local. Subtract 10 weeks → Monday `2026-03-09` local (`2026-W11`). The set of weeks competing for "Max" is `[W11, W12, …, W20]` — exactly **10 prior weeks**. The current week (`W21`) is **NOT** part of the Max baseline; its sessions populate "Now" instead.
- This matches `computePrsThisWeek`'s existing semantic (`priorMax` is the max strictly before the current week's PR session) and `computePrsForSession`'s semantic (filter out current session first, then take max). The window simply tightens "all prior" to "the most recent N prior weeks".
- Rejected alternative (b) "last N including current": would conflate Max and Now and require strip-overlay maths to handle the case where the dotted line equals the current week's tallest bar (visual confusion). Rejected (c) "N session-bearing weeks": introduces a stateful walk that depends on session density — two users with the same N see different windows depending on their training frequency, which violates the user's mental model of "weeks".

### DB columns

- Table: `public.user_preferences`.
- Column: `max_volume_window_weeks integer NOT NULL DEFAULT 0`.
- Constraint: `user_preferences_max_volume_window_weeks_check CHECK (max_volume_window_weeks IN (0, 10, 20, 30))`.
- RLS: unchanged (existing uniform `auth.uid() = user_id` policies cover all columns).
- Index: not needed (single row per user, fetched whenever prefs are loaded).
- Seed function: not touched — `seed_new_user()` omits the column and the DEFAULT applies on insert.

### UI props / state

- `<ProgressHero>` and `<VolumeTargetSlot>` gain no new props. Both read the pref directly via `useMaxVolumeWindowWeeks()`.
- The verdict screen (`workout/verdict/[sessionId].tsx`) does the same — local hook read, no prop drilling.
- `<WeeklyVolumeStrip>` (the dumb display) keeps its existing `bestWeekKg?: number` + `bestWeekLabel?: string` props — caller (`app/(app)/progress/index.tsx:50`) feeds windowed values automatically because `useLifetimeBestWeek` is now window-aware.

### Copy strings (exact)

Hero legend (`progress-hero.tsx:163`), with `weeks` = current pref value:

- `weeks === 0` (lifetime): `"Max = best week ever · Now = this week · To PR = remaining"` (unchanged, current copy).
- `weeks > 0`: `` `Max = best of last ${weeks} weeks · Now = this week · To PR = remaining` `` — e.g. "Max = best of last 10 weeks · Now = this week · To PR = remaining".

Strip overlay label (`app/(app)/progress/index.tsx:36`):

- `weeks === 0`: `` `Best week: ${formatVolume(bestWeek.totalKg, unit)} (${bestWeek.weekStartLabel})` `` (unchanged).
- `weeks > 0`: `` `Best of last ${weeks} weeks: ${formatVolume(bestWeek.totalKg, unit)} (${bestWeek.weekStartLabel})` ``.

Profile segmented row (`app/(app)/profile.tsx`, new row beneath length unit):

- Section label: `"Max-volume window"`.
- Segment labels: `"Lifetime"`, `"10w"`, `"20w"`, `"30w"`.
- Layout: identical to length-unit row (lines 80-121) — `flex-1 rounded-md py-2`, active `bg-black dark:bg-white` / inactive `border border-gray-300 dark:border-gray-700`. Four segments instead of two — Discovery's precedent has two but the same component composes cleanly with four (each remains `flex-1`).

Live `<VolumeTargetSlot>` copy: **unchanged**. The strings "Previous best" and "New PR! +X over your previous" stay verbatim. Rationale: the slot's text already says "previous" (singular, no "ever" or "all-time" qualifier), so it remains accurate under any window. Adding a window qualifier here would clutter a per-set strip that is already information-dense.

Verdict screen copy: **unchanged**. The headline is `+N PRs · Y kg · Zh Wm`; PR rows show `+overflow kg (was prior kg)`. Same rationale — no time qualifier in the existing string.

## Riscos

### Data integrity
- **Migration**: pure additive `ADD COLUMN … DEFAULT 0`. Existing rows backfill with `0` (lifetime) during the column-rewrite, so behaviour is preserved for every user. The CHECK constraint is enforced atomically; if any existing row somehow held a non-conforming value the ALTER aborts (it cannot, because the column does not exist yet — defence-in-depth only).
- **RLS**: no change. Existing `user_preferences` policies cover all columns uniformly.
- **Seed function**: no rewrite needed. `seed_new_user()` (`0001_rls_and_seed.sql:55`) omits `max_volume_window_weeks`, so the DEFAULT applies for new signups. Verified pattern matches `length_unit` migration (`0005_measurements.sql:8-10`).
- **PR semantic invariant**: strict-`>` and `priorMax > 0` (first-ever-not-a-PR) MUST survive windowing. The kernel changes preserve both — filtering rows out of the running window does not alter the comparison logic, only the dataset. Test coverage: case (b) in `tests/unit/session-verdict-math.test.ts` ("in-window `priorMaxKg = 0`") guards this explicitly.

### UX regressions
- **Lifetime path (default)**: every kernel returns identical output for `windowStartIso = undefined` — verified by the new test cases that pass `undefined` and compare against existing lifetime expectations. Zero regression for existing users.
- **Hero legend copy change**: when `weeks > 0`, the copy line at `progress-hero.tsx:163` changes shape. Snapshot tests (if any) that pin the literal "best week ever" string will fail; need to either delete that pin or branch it. **Action**: grep `tests/` for "best week ever" before implementation — if a snapshot exists, update it to assert against the windowed copy in the new test case and the lifetime copy in the existing one.
- **Strip overlay label change**: same as above — `tests/e2e/progress-page.spec.ts` (line 333-387 per Discovery) pins literal PR numbers; the windowed path is opt-in so the e2e baseline (lifetime) stays valid. NO change to existing e2e literals.
- **Cross-surface coherence**: uniform window means the verdict screen, hero, list, and live slot all use the same boundary. Decision (i) from Discovery's Unknown #5 — "PR is relative to the chosen window" — means a user who narrowed their window may see a "PR" fire on Strict-`>` against the in-window prior even though an ancient lifetime max is higher. This is *intended* under the chosen semantic but is a meaning-shift the copy doesn't surface. Mitigation: hero legend text ("Max = best of last N weeks") makes the window explicit; the verdict screen and live slot do not name the time horizon in their copy, so no contradiction arises from those strings. Out-of-scope: any "you have an older PR" disclosure.
- **Reset-to-lifetime is symmetric**: switching back to `0` (Lifetime) restores every kernel to its prior output instantly (React Query invalidation not needed because the dependency change re-runs the `useMemo`).

### Platform-specific
- Pure JS change. No native modules, no Expo plugin, no platform `if`. The Profile segmented control uses the same `Pressable` + NativeWind classes that the weight/length rows already use — verified to render correctly on iOS / Android / web in the existing precedent.
- Timezone: `windowStartIsoForWeeks` uses `isoWeekStart` (local Monday) and converts via `toISOString()` — so the boundary anchors to **local Monday 00:00**, expressed in UTC. The filter compares `row.completed_at` (UTC ISO from Postgres) against this UTC string; ISO-string lexicographic ordering is chronologically correct. DST shifts: `subWeeks` from `date-fns` operates on calendar days, so a DST clock change does NOT desync the window (the resulting Monday is still local 00:00, just expressed as a different UTC offset). Test coverage: case (3) in `tests/unit/window-utils.test.ts`.

### Performance
- Each kernel gains one extra string comparison per row (`row.completed_at < windowStartIso`). For a user with 5,000 lifetime rows, this is 5,000 extra string compares per memo — negligible (sub-millisecond).
- No new query, no new cache namespace. The `["stats", "weekly-volume", "lifetime"]` cache is reused; windowing happens during in-memory derivation.
- `useMemo` deps gain `windowStartIso` (a string-or-undefined). When the pref changes via `useSetMaxVolumeWindowWeeks`, the cache update triggers a re-derive across all consumer hooks — `O(N)` per affected memo, N = lifetime row count. Acceptable.
- The hooks compute `windowStartIso` via `useMemo` keyed on `useMaxVolumeWindowWeeks()` and `new Date()` rounded to "today" (else the dep changes every render). **Implementation note**: derive `now` once per render via a `useState` initialized lazily, OR memoize the ISO string by `weeks` alone since the resulting Monday is stable for ~24h — pick whichever is simpler at implementation time. Prefer the latter for hooks that don't otherwise depend on `now`.

## Alternativas descartadas

1. **Uniform vs per-surface window** — Per-surface (different N for live target vs Progress hero) — descartada porque it produces incoherent UX: the verdict screen could declare "PR!" while the Progress hero says you're still chasing. HIGH risk of user confusion, no concrete UX where divergence helps. Confidence: HIGH that uniformity wins.

2. **Allowed window values `[lifetime, 12, 26, 52]`** (quarterly / half / yearly) — descartada porque the prompt explicitly names "10, 20 or 30 weeks". Sticking to literal user wording avoids second-guessing the request. Confidence: HIGH.

3. **Default value `12 weeks`** (matches industry norm in other lifting apps) — descartada porque it silently shifts every existing user's PR meaning at deploy time. Choosing `0 = lifetime` as the default makes the feature opt-in, preserves invariants, and lets the user discover it intentionally. Confidence: HIGH (also Discovery's strong recommendation).

4. **Window semantics (b) "last N weeks including current"** — descartada porque the current week is the "Now" side of `Max · Now · To PR`; conflating it into "Max" makes the gap arithmetic degenerate when this week is already the best week in the window. (a) keeps Max and Now disjoint, matching the existing `priorMax`-style semantic in `computePrsThisWeek`.

5. **Window semantics (c) "N session-bearing weeks"** — descartada porque the user's mental model is "the last N weeks" (calendar), not "the last N weeks I trained" (session-bearing). Two users with the same N would see different windows depending on training frequency — surprising and hard to explain in copy.

6. **PR semantic decoupled from window (Unknown #5 reading ii)** — i.e. windowed Max is just a softer comparison anchor on the hero/list while PR detection stays lifetime — descartada porque it requires two parallel reductions (one windowed, one lifetime) and double-mode copy ("you set a PR in your window but not all-time"). Adds a maintenance burden and a subtle two-state UI for a question users haven't asked. The chosen reading (i) keeps "PR" defined relative to the chosen comparison anchor, which is also internally consistent across all surfaces.

7. **Hero copy: silently drop the legend when window ≠ lifetime** — descartada porque the legend explains the three terms ("Max", "Now", "To PR") — dropping it removes critical context. Renaming `Max` in the legend is the lighter touch.

8. **Hook name: rename `useLifetimeBestWeek` → `useBestWindowWeek`** — descartada porque the rename ripples into `app/(app)/progress/index.tsx:32` and `progress-hero.tsx:34` (two call sites) without behavioural change. A JSDoc note explaining "window=0 means lifetime" is cheaper and equally clear. Confidence: MEDIUM (Discovery's recommendation #7 was open).

9. **Storage as text enum `"lifetime" | "10w" | "20w" | "30w"`** — descartada porque integer is naturally orderable, easier to filter in SQL (e.g. `WHERE max_volume_window_weeks > 0` to count opt-in users), and matches the prompt's "X weeks" framing. The IN-list CHECK gives the same enum-style safety. Confidence: HIGH.

10. **CHECK constraint `max_volume_window_weeks >= 0 AND <= 520`** (range-based) — descartada porque IN-list `(0, 10, 20, 30)` is tighter, matches the segmented control's allowed values exactly, and makes it impossible for an unguarded mutation to write `7` or `12` into the column. The range form was Discovery's nominal suggestion; the IN-list is the Conductor's tighter recommendation and matches the `weight_unit` / `length_unit` precedent.

11. **Server-side `sinceUtc` filter on `listWeeklyVolumeRows` per window value** — descartada porque it would require a per-window cache namespace (`["stats", "weekly-volume", "window-10w"]` etc.) and a refetch every time the user changes the pref. Client-side filtering at the kernel boundary reuses the existing lifetime cache, costs one string compare per row (sub-ms for 5k rows), and lets the user toggle the pref instantly with no network round-trip. Future optimisation only if datasets grow past ~10k rows or users complain about derive latency.

12. **Custom integer entry (free-form N)** — descartada porque it breaks the segmented-control idiom used by every other pref, adds validation surface, and the prompt explicitly names a discrete set. Out-of-scope.

13. **Per-exercise window override** — descartada because the prompt frames the feature as a global preference ("the user can choose how many weeks"). Per-exercise overrides multiply the UI surface and the storage shape without addressing a stated need. Out-of-scope.

## Out of scope

- **Per-exercise progress chart `bestE1rm` on `app/(app)/exercises/[id]/progress.tsx`**: adjacent surface; the prompt names "max volume PR per exercise" but the screen actually shows *estimated 1RM* (a separate kernel from `computeLifetimeMaxPerExercise`). Discovery flagged this as deferred; we follow that. If the user wants the chart's "Best est. 1RM" line also windowed, that's a separate run touching `app/(app)/exercises/[id]/progress.tsx:58-83`.
- **Server-side `sinceUtc` filter on `listWeeklyVolumeRows`**: the existing windowed branch (`src/api/stats.ts:51-69`) stays dormant. Switch only if perf bites.
- **Custom integer entry / per-exercise overrides** (see Alternative #12, #13).
- **Notifications / haptics when windowed PR detection changes meaning**: no notification surface today; not adding one for this run.
- **Backfill / re-detection of past PRs**: PRs aren't persisted (the Progress page reconstructs them per render), so there is nothing to backfill.
- **Strip per-bucket bar-height denom changes** (`weekly-volume-strip.tsx:222`): the dotted overlay tracks the windowed best automatically; bar heights still scale to the visible bucket range, which is the desired "readability" semantic per Discovery's flag.
- **`<VolumeTargetSlot>` and verdict-screen copy that names the window**: keeping the existing "previous best" wording — it remains accurate under any window without needing a qualifier. If user testing shows confusion, copy can be tweaked in a follow-up without schema or kernel changes.
- **Renaming `useLifetimeBestWeek`**: keep the name; document via JSDoc.
