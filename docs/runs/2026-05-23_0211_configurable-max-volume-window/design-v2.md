# Design v2 — 2026-05-23_0211_configurable-max-volume-window

Validator returned no-go on v1 (blockers=2, majors=2, minors=6). This version addresses every blocker and major, pins the minor recommendations, and restates the full design so the reader does not need to cross-reference v1.

## Diff from v1

| # | v1 problem (validator tag) | v2 fix | Files / sections affected |
|---|---|---|---|
| 1 | `supabase/migrations/0008_max_volume_window.sql` collides with the existing `0008_sets_unique_set_number.sql` (**BLK-1**). | Rename to **`0009_max_volume_window.sql`**. Every reference in the design (Mudanças table row 1, Contratos DB columns, Riscos Data integrity bullet) now uses `0009`. | `supabase/migrations/0009_max_volume_window.sql`, this design |
| 2 | "ISO-8601 strings sort lexicographically the same as chronological order — so we compare strings directly" was claimed in v1's Contracts → Filter predicate. PostgREST returns `+00:00` offsets while `new Date().toISOString()` returns `Z`; `+` (0x2B) lex-compares < `.` (0x2E), silently excluding the boundary row (**BLK-2**, also burned in the strong-csv run, see `docs/runs/2026-05-20_0127_import-strong-csv/regression-report.md:35` and `retro.md:20`). | Precompute `windowStartMs: number = parseISO(windowStartIso).getTime()` **once per kernel call**. Replace every row-level compare with `parseISO(row.<anchor>).getTime() >= windowStartMs`. Kernels already use `parseISO(...)` for date math (`progress-page-math.ts:34, 133, 265`), so the cost stays sub-millisecond for 5k rows. | `src/utils/progress-page-math.ts` (`bucketLifetimeWeeklyVolumes`, `computeLifetimeMaxPerExercise`, `computePrsThisWeek`), `src/utils/volume-target.ts` (`computeVolumeTarget`), Contratos → Filter predicate, Riscos → Performance |
| 3 | v1 filtered `computePrsThisWeek` by row-level `completed_at`. A session that starts in week N and ends in week N+1 would have its rows split — some included in the windowed priorMax, some excluded — producing a fractional session-volume that does not correspond to any real session (**MAJ-1**). | Pin **one anchor per kernel** and document the consistency rule. Windowing decisions use `session.started_at` everywhere, **after** rows are aggregated into per-session totals. The dual-anchor exception is `bucketLifetimeWeeklyVolumes`, which keeps `completed_at` for ISO-week bucket placement (preserves today's bar-week semantics on the strip) but uses `session.started_at` for window inclusion. New **Consistency rule** subsection in Contratos. | `src/utils/progress-page-math.ts`, `src/utils/session-verdict-math.ts`, `src/utils/volume-target.ts`, Contratos → Consistency rule |
| 4 | 4-segment Profile row (`Lifetime / 10w / 20w / 30w`) overflows on 320pt screens: ~54pt per segment is too narrow for the 62-68pt label "Lifetime" at `text-base font-medium` (**MAJ-2**). | Abbreviate `Lifetime → All` per validator option (a). Final labels: `All / 10w / 20w / 30w` (1-3 chars each, fits the 54pt budget comfortably). Add a legend caption beneath the row: *"Max-volume window — how many recent weeks to compare against."* — this clarifies the abbreviation. Rationale: (i) matches the integer-encoding mental model (`0 = no window`); (ii) preserves the 1-row segmented-control idiom from kg/lbs and cm/in; (iii) ASCII-only, no extra wrap risk. | `app/(app)/profile.tsx`, Contratos → Copy strings |
| 5 | v1 punted the `useMemo` dep-stability for `windowStartIso` to "implementation time" (**MIN-3**). | Pin the exact recipe: `const windowStart = useMemo(() => computeWindowStart(weeks, new Date()), [weeks])`. The helper returns `{ windowStartIso: string \| undefined; windowStartMs: number \| undefined }` — both `undefined` when `weeks === 0`. Calling `new Date()` **inside** the factory keeps the dependency list to `[weeks]`, which is stable. | `src/utils/window-utils.ts`, `src/hooks/use-progress-page.ts`, `src/components/volume-target-slot.tsx`, `app/(app)/workout/verdict/[sessionId].tsx`, Riscos → Implementation notes |
| 6 | Per-exercise progress chart deferral was justified in v1 but the rationale was not captured in-code (**MIN-1**). | Add a JSDoc note at the top of `app/(app)/exercises/[id]/progress.tsx` explaining the intentional deferral (e1RM kernel ≠ volume kernel; window pref deliberately not threaded). Tagged "(documentation only)" in the file table. | `app/(app)/exercises/[id]/progress.tsx` |
| 7 | `useLifetimeBestWeek` becomes a misnomer once windowed (**MIN-2**). | Keep the name; add a JSDoc explaining the window semantic ("when `weeks=0` the result is the lifetime best; otherwise the best week within the trailing N ISO weeks anchored at session.started_at"). No rename, no ripple. | `src/hooks/use-progress-page.ts` |
| 8 | MIN-4 (CHECK + types drift), MIN-5 (overlay caption wrap), MIN-6 (setter coupling). | Acknowledged in Riscos with no design change. MIN-4 trade-off accepted (adding `52` later is 3 coordinated edits, fine for a discrete enum). MIN-5 reverified at 30 chars worst case ("Best of last 30 weeks: 12,345 kg (May 11)" ≈ 41 chars at 14pt — within strip caption budget); confirm during Implementer review on the iPhone SE/Mini target. MIN-6 — every seeded user already has a `user_preferences` row (`0001_rls_and_seed.sql:55`); new column picks up `0` default during the column-rewrite. | Riscos |

Everything else from v1 was correct and is restated below verbatim (Approach, Alternativas, Out of scope) with only the BLK/MAJ-driven mutations applied. Confidence labels per section.

## Goal (1 sentence)

Add a server-stored per-user preference that lets users compare the "max volume" surfaces (Progress hero, lifetime-best strip overlay, per-exercise rows, live volume target, end-of-session PR detection) against the most recent **10**, **20**, or **30** ISO weeks instead of full lifetime, defaulting to lifetime (`All`) so no existing user's behaviour changes until they opt in.

## Approach

Thread a single optional `windowStartMs?: number` parameter through the four lifetime-max kernels (`computeLifetimeMaxPerExercise`, `bucketLifetimeWeeklyVolumes`, `computePrsThisWeek`, plus `computeVolumeTarget` for the live slot) and the verdict kernel (`computePrsForSession`). The window is computed at the hook layer (local Monday of the current ISO week minus N weeks, serialised as a numeric millisecond timestamp via `parseISO(windowStartIso).getTime()`) so the kernels remain pure numeric-comparators with no clock awareness and zero ISO-string ordering gotchas. The new pref is persisted under `user_preferences.max_volume_window_weeks` (integer, `0 = lifetime`) following the `length_unit` precedent verbatim — same migration shape, same API setter pair, same hook pair, same Profile segmented control idiom. The window is applied **uniformly** across all max/PR surfaces to keep semantic coherence (no "PR!" on the verdict screen while the Progress page says "still chasing"). The single time anchor for windowing decisions is **`session.started_at`**, applied after rows are aggregated into per-session totals — never to individual sets — so a session that crosses midnight or an ISO-week boundary is always included or excluded as one indivisible unit. Default is `0` (lifetime), so the migration is a no-op for behaviour and every existing test that uses lifetime semantics stays green by passing `windowStartMs = undefined`. Server-side filtering on `listWeeklyVolumeRows` is deliberately NOT touched (future optimisation only if datasets grow past ~10k rows).

Confidence: **HIGH** that the chosen path matches existing precedents and preserves every invariant (strict-`>` PRs, oldest-tie-wins, first-ever-session-is-not-PR). Risk: **MEDIUM** — change is broad (5 kernels + 5 consumer hooks + 3 user-visible surfaces) but every leaf is additive and gated by a default that preserves current behaviour.

## Mudanças por arquivo

| File | Type | Change |
|---|---|---|
| `supabase/migrations/0009_max_volume_window.sql` | new | Single migration: `ALTER TABLE public.user_preferences ADD COLUMN max_volume_window_weeks integer NOT NULL DEFAULT 0;` + `ADD CONSTRAINT user_preferences_max_volume_window_weeks_check CHECK (max_volume_window_weeks IN (0, 10, 20, 30));`. Mirrors `0005_measurements.sql:24-37` shape (column-then-check). No seed-function rewrite — `seed_new_user()` (`0001_rls_and_seed.sql:55`) omits the column and the DEFAULT picks it up. RLS unchanged. |
| `src/db/schema.ts` | edited | Add one column inside `userPreferences` table (line 33-40): `maxVolumeWindowWeeks: integer("max_volume_window_weeks").notNull().default(0)`. `integer` is already imported (line 6). No other table touched. |
| `src/db/types.ts` | edited | Add `MaxVolumeWindowWeeks = 0 \| 10 \| 20 \| 30` next to `LengthUnit` (line 34). Export `MAX_VOLUME_WINDOW_OPTIONS: readonly MaxVolumeWindowWeeks[] = [0, 10, 20, 30] as const` for the Profile segmented control to enumerate. |
| `src/api/preferences.ts` | edited | (a) Extend `UserPreferencesRow` (line 4-11) with `max_volume_window_weeks: MaxVolumeWindowWeeks`. (b) Add `setMaxVolumeWindowWeeks(weeks: MaxVolumeWindowWeeks): Promise<UserPreferencesRow>` symmetric with `setLengthUnit` (line 43-56). |
| `src/hooks/use-preferences.ts` | edited | Add `useMaxVolumeWindowWeeks(): MaxVolumeWindowWeeks` (default `0`, mirrors `useLengthUnit` line 20-23) and `useSetMaxVolumeWindowWeeks()` mutation (mirrors `useSetLengthUnit` line 33-39). Same `KEY = ["preferences", "me"]` cache, same `qc.setQueryData` pattern. |
| `src/utils/window-utils.ts` | new | Pure helper. Exports `computeWindowStart(weeks: MaxVolumeWindowWeeks, now: Date): { windowStartIso: string \| undefined; windowStartMs: number \| undefined }`. Returns `{ windowStartIso: undefined, windowStartMs: undefined }` when `weeks === 0` (lifetime). Otherwise: `iso = subWeeks(isoWeekStart(now), weeks).toISOString()`, `ms = parseISO(iso).getTime()`. The kernel threshold is **inclusive `>=`** on milliseconds — the boundary instant (the Monday 00:00 local of the window's first week) is included. Single source of truth so every consumer derives the same boundary. |
| `src/utils/progress-page-math.ts` | edited | (1) Add optional `windowStartMs?: number` to `bucketLifetimeWeeklyVolumes(rows, windowStartMs?)`. **Dual-anchor rule**: filter inclusion on `parseISO(row.sessions.started_at).getTime() >= windowStartMs` (session-anchor, decides which weeks are in the window), then bucket by `weekKeyOf(parseISO(row.completed_at))` (completed-anchor, decides which ISO-week bucket the volume lands in — preserves today's bar placement). (2) `computeLifetimeMaxPerExercise(rows, windowStartMs?)` — first aggregate `(exerciseId, sessionId) → {volume, startedAt}`, then drop session aggregates whose `parseISO(startedAt).getTime() < windowStartMs` BEFORE the per-exercise max reduction. (3) `computePrsThisWeek({..., windowStartMs?})` — the kernel already aggregates to per-session `{volume, startedAt}` (lines 234-252). Add a single-line filter step before the per-exercise walk: drop session aggregates with `parseISO(s.startedAt).getTime() < windowStartMs`. The `priorMax`-running-walk semantic is preserved. (4) `computePrExerciseIdsThisWeek` already routes through `computePrsThisWeek` — plumb the optional param through. (5) `computeCurrentWeekVolume` NOT touched ("Now" is always this week, orthogonal to the window). |
| `src/utils/session-verdict-math.ts` | edited | Add optional `windowStartMs?: number` to `computePrsForSession`. Passes the param straight through to the inner `computeLifetimeMaxPerExercise(priorRows, windowStartMs)` call (line 94). PR invariants (strict `>` and `priorMaxKg > 0`) survive trivially. |
| `src/utils/volume-target.ts` | edited | Add optional `windowStartMs?: number` to `ComputeVolumeTargetInput`. Inside `computeVolumeTarget`, filter `pastSessions` BEFORE the previous-max reduction (line 117-122): skip sessions whose `parseISO(session.started_at).getTime() < windowStartMs`. We filter on `SessionSets.started_at` (not individual set `completed_at`) so a session is always an indivisible unit — consistent with the cross-kernel rule. |
| `src/hooks/use-progress-page.ts` | edited | (1) `useLifetimeBestWeek` (line 33-44): read `useMaxVolumeWindowWeeks()`, derive `{windowStartMs}` via `useMemo(() => computeWindowStart(weeks, new Date()), [weeks])`, pass `windowStartMs` into `bucketLifetimeWeeklyVolumes(q.data, windowStartMs)`. Add `windowStartMs` to `useMemo` deps. **JSDoc updated** explaining the window semantic — name kept (no rename ripple). (2) `usePrsThisWeek` (line 82-117): same memo pattern, pass `windowStartMs` into `computePrsThisWeek`. (3) `useExercisesThisWeek` (line 193-295): same memo pattern, pass `windowStartMs` into `computeLifetimeMaxPerExercise(lifetime.data, windowStartMs)` at line 227. |
| `src/components/progress-hero.tsx` | edited | (1) Read `useMaxVolumeWindowWeeks()`. (2) Replace the static legend caption at line 163 with a window-aware string (see Copy strings). (3) No change to `MaxNowToPrLine` props — `maxKg` is already windowed by `useLifetimeBestWeek`. |
| `src/components/volume-target-slot.tsx` | edited | Read `useMaxVolumeWindowWeeks()`, derive `windowStartMs` via the pinned `useMemo` recipe, pass into `computeVolumeTarget({ pastSessions, currentSessionSets, windowStartMs })` (line 36-43). Memo deps gain `windowStartMs`. |
| `app/(app)/workout/verdict/[sessionId].tsx` | edited | Read `useMaxVolumeWindowWeeks()`, derive `windowStartMs` via the pinned memo recipe, pass into `computePrsForSession({rows, currentSessionId, currentSessionVolumeByExercise, windowStartMs})` (line 60-64). |
| `app/(app)/profile.tsx` | edited | Add a third segmented control row beneath the Length unit row (currently lines 80-121), matching that row's structure verbatim with 4 segments instead of 2. Iterates `MAX_VOLUME_WINDOW_OPTIONS`, label map `0 → "All"`, `10 → "10w"`, `20 → "20w"`, `30 → "30w"`. Backing hook: `useSetMaxVolumeWindowWeeks`. Active variant `bg-black dark:bg-white`. Add a `<Text>` legend caption directly below the segment row reading *"Max-volume window — how many recent weeks to compare against."* — `text-xs text-gray-500 dark:text-gray-400 mt-1`. |
| `app/(app)/exercises/[id]/progress.tsx` | edited | **(documentation only)** Top-of-file JSDoc comment block explaining the intentional deferral: this screen's `bestE1rm` (line 58-83) operates on the e1RM kernel (`max(weight * (1 + reps/30))`), NOT the volume kernel. The max-volume window pref is deliberately not threaded here; if/when an e1RM-window companion pref is added, this screen wires up there. No code change. Tagged MIN-1. |
| `tests/unit/progress-page-math.test.ts` | edited | Add windowed-mode blocks for `bucketLifetimeWeeklyVolumes`, `computeLifetimeMaxPerExercise`, `computePrsThisWeek`. Each block covers: (a) session at exactly `windowStartMs` (included via `>=`); (b) session 1 ms before `windowStartMs` (excluded); (c) ancient PR session excluded → in-window second-best becomes the priorMax → new PR fires when it wouldn't under lifetime; (d) `windowStartMs = undefined` falls back to identical lifetime numbers (regression guard); (e) cross-week session (`started_at` in week N, `completed_at` in week N+1): when `windowStartMs` is set to the Monday of week N+1, the **entire session** is excluded (not split). Keep all existing lifetime cases unchanged. |
| `tests/unit/session-verdict-math.test.ts` | edited | Add 3 windowed-mode cases for `computePrsForSession`: (a) ancient PR excluded by window → current session beats the in-window prior → PR fires; (b) in-window `priorMaxKg = 0` (only ancient sessions remain) → NOT a PR (first-in-window parity with `volume-target.ts`); (c) `windowStartMs = undefined` is identical to current behaviour. |
| `tests/unit/volume-target.test.ts` | edited | Add 3 windowed-mode cases for `computeVolumeTarget`: (a) ancient max session excluded → `previousMaxKg` becomes the in-window second-best; (b) all `pastSessions` excluded → `kind: "no-pr"` regardless of prior count; (c) `windowStartMs = undefined` is identical to current behaviour. |
| `tests/unit/window-utils.test.ts` | new | Cases: (1) `weeks = 0` → both `windowStartIso` and `windowStartMs` are `undefined`. (2) `weeks = 10` with `now = 2026-05-23` (Saturday in W21) → returns the Monday of 2026-W11 (10 weeks before 2026-W21). (3) DST boundary — pick a `now` near BRT's clock change (note: Brazil does not observe DST since 2019; test still verifies `subWeeks` calendar semantics under any TZ shift). (4) Snapshot the ISO string + numeric ms for `weeks = 10/20/30` against a fixed `now`. (5) `windowStartMs === parseISO(windowStartIso).getTime()` (round-trip consistency). |
| `tests/component/profile-max-volume-window.test.tsx` | new | Renders `<ProfileScreen />` with `usePreferences` mocked to each of `{0, 10, 20, 30}`. Asserts (a) the correct segment is rendered active (`bg-black dark:bg-white`); (b) pressing a different segment calls `useSetMaxVolumeWindowWeeks().mutate` with the right integer; (c) the legend caption "Max-volume window — how many recent weeks to compare against." renders. |

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
export type WindowStart = {
  windowStartIso: string | undefined;
  windowStartMs: number | undefined;
};
export function computeWindowStart(
  weeks: MaxVolumeWindowWeeks,
  now: Date,
): WindowStart;
// weeks === 0 → { windowStartIso: undefined, windowStartMs: undefined }.
// weeks > 0  → iso = subWeeks(isoWeekStart(now), weeks).toISOString();
//              ms  = parseISO(iso).getTime();

// src/utils/progress-page-math.ts
export function bucketLifetimeWeeklyVolumes(
  rows: WeeklyVolumeRow[],
  windowStartMs?: number, // NEW — undefined ⇒ no filter (lifetime)
): Map<string, number>;

export function computeLifetimeMaxPerExercise(
  rows: WeeklyVolumeRow[],
  windowStartMs?: number, // NEW
): Map<string, number>;

export function computePrsThisWeek(opts: {
  rows: WeeklyVolumeRow[];
  currentWeekStartIso: string;
  currentWeekEndIso: string;
  windowStartMs?: number; // NEW
}): PrThisWeek[];

export function computePrExerciseIdsThisWeek(opts: {
  rows: WeeklyVolumeRow[];
  currentWeekStartIso: string;
  currentWeekEndIso: string;
  windowStartMs?: number; // NEW
}): Set<string>;

// src/utils/session-verdict-math.ts
export function computePrsForSession(opts: {
  rows: WeeklyVolumeRow[];
  currentSessionId: string;
  currentSessionVolumeByExercise: Map<string, number>;
  windowStartMs?: number; // NEW
}): SessionPr[];

// src/utils/volume-target.ts
export type ComputeVolumeTargetInput = {
  pastSessions: SessionSets[] | undefined;
  currentSessionSets: SetRow[];
  windowStartMs?: number; // NEW
};
export function computeVolumeTarget(input: ComputeVolumeTargetInput): VolumeTargetState;
```

### Consistency rule (cross-kernel)

**All windowing decisions across kernels use `session.started_at` numerically, computed once via `parseISO(...).getTime()`. No ISO-string lex-compare anywhere.** Pinned per kernel:

| Kernel | Aggregation step (existing) | Window-filter step (new) | Bucketing/anchor (unchanged) |
|---|---|---|---|
| `bucketLifetimeWeeklyVolumes` | (none — iterates rows directly) | Per row: include iff `parseISO(row.sessions.started_at).getTime() >= windowStartMs`. **Dual-anchor exception** — see below. | Bucket key = `weekKeyOf(parseISO(row.completed_at))`. |
| `computeLifetimeMaxPerExercise` | Group `(exerciseId, sessionId) → {volume, startedAt}` (new — currently the kernel groups by `(exerciseId, sessionId)` to sum volume; now also carries `startedAt`). | Per session aggregate: drop iff `parseISO(startedAt).getTime() < windowStartMs`. | Per-exercise max across surviving aggregates. |
| `computePrsThisWeek` | Group `(exerciseId, sessionId) → {volume, startedAt}` (already present at lines 234-252). | Per session aggregate: drop iff `parseISO(startedAt).getTime() < windowStartMs`. | priorMax walk unchanged; `inWeek` check unchanged. |
| `computePrsForSession` | (delegates to `computeLifetimeMaxPerExercise`). | Inherits — passes `windowStartMs` straight through. | Inherits. |
| `computeVolumeTarget` | (iterates `SessionSets[]` directly — each entry is already a per-session aggregate). | Per `SessionSets`: drop iff `parseISO(session.started_at).getTime() < windowStartMs`. | Max across surviving sessions. |

**Dual-anchor exception for `bucketLifetimeWeeklyVolumes`**: it uses `session.started_at` to decide INCLUSION (which sessions are in the window) and `completed_at` to decide PLACEMENT (which ISO-week bucket the volume lands in). Rationale: the strip's bar-week assignment today is governed by `completed_at` (line 34) — that semantic must not change, because it determines which visual bar each set's volume contributes to. The window is "which weeks compete for Max", and the natural unit for that decision is the session, anchored at `started_at`. The two anchors disagree only when a session crosses midnight at an ISO-week boundary; in that case the volume lands in the later week's bar (existing semantic) AND the whole session is in/out of the window as one unit (new semantic). No fractional sessions. Confidence: HIGH.

**Why session-anchor over set-anchor everywhere**: a session that starts in week N and ends in week N+1 must be either entirely in the window or entirely out. Filtering at row level (v1's mistake) would split such sessions and produce fractional per-session totals that do not correspond to any real session. Choosing `started_at` (over `ended_at`) is consistent with `computePrsThisWeek`'s existing `inWeek` check (line 265-266), which already uses `startedAt`.

**Boundary is inclusive on the lower end (`>=`)**: a session whose `started_at` equals `windowStartIso` is INCLUDED. Mirrors `src/api/stats.ts:59` (`.gte("completed_at", opts.sinceUtc)`).

### Window semantics — "last N weeks excluding current week"

Implementation: `windowStartIso = subWeeks(isoWeekStart(now), N).toISOString()`; `windowStartMs = parseISO(windowStartIso).getTime()`.

- For `N = 10` and `now = 2026-05-23` (Saturday in 2026-W21): `isoWeekStart(now)` = Monday 2026-05-18 local. Subtract 10 weeks → Monday 2026-03-09 local (2026-W11). The set of weeks competing for "Max" is `[W11, W12, …, W20]` — exactly **10 prior weeks**. The current week (W21) is NOT part of the Max baseline; its sessions populate "Now".
- This matches `computePrsThisWeek`'s existing semantic (priorMax is the max strictly before the current week's PR session) and `computePrsForSession`'s semantic (filter out current session first, then take max). The window simply tightens "all prior" to "the most recent N prior weeks".

### DB columns

- Table: `public.user_preferences`.
- Column: `max_volume_window_weeks integer NOT NULL DEFAULT 0`.
- Constraint: `user_preferences_max_volume_window_weeks_check CHECK (max_volume_window_weeks IN (0, 10, 20, 30))`.
- RLS: unchanged (existing uniform `auth.uid() = user_id` policies cover all columns).
- Index: not needed (single row per user, fetched whenever prefs are loaded).
- Seed function: not touched — `seed_new_user()` omits the column and the DEFAULT applies on insert.
- Migration filename: **`supabase/migrations/0009_max_volume_window.sql`**.

### UI props / state

- `<ProgressHero>` and `<VolumeTargetSlot>` gain no new props. Both read the pref directly via `useMaxVolumeWindowWeeks()`.
- The verdict screen (`workout/verdict/[sessionId].tsx`) does the same — local hook read, no prop drilling.
- `<WeeklyVolumeStrip>` (the dumb display) keeps its existing `bestWeekKg?: number` + `bestWeekLabel?: string` props — caller (`app/(app)/progress/index.tsx:50`) feeds windowed values automatically because `useLifetimeBestWeek` is now window-aware.

### Copy strings (exact)

Hero legend (`progress-hero.tsx:163`), with `weeks` = current pref value:

- `weeks === 0` (lifetime): `"Max = best week ever · Now = this week · To PR = remaining"` (unchanged).
- `weeks > 0`: `` `Max = best of last ${weeks} weeks · Now = this week · To PR = remaining` `` — e.g. "Max = best of last 10 weeks · Now = this week · To PR = remaining".

Strip overlay label (`app/(app)/progress/index.tsx:36`):

- `weeks === 0`: `` `Best week: ${formatVolume(bestWeek.totalKg, unit)} (${bestWeek.weekStartLabel})` `` (unchanged).
- `weeks > 0`: `` `Best of last ${weeks} weeks: ${formatVolume(bestWeek.totalKg, unit)} (${bestWeek.weekStartLabel})` ``.

Profile segmented row (`app/(app)/profile.tsx`, new row beneath length unit):

- Section label: `"Max-volume window"`.
- Segment labels: `"All"`, `"10w"`, `"20w"`, `"30w"`. **(`Lifetime → All` per MAJ-2 fix.)**
- Layout: identical to length-unit row (lines 80-121) — `flex-1 rounded-md py-2`, active `bg-black dark:bg-white` / inactive `border border-gray-300 dark:border-gray-700`. Four segments instead of two; each remains `flex-1` and fits comfortably in the 54pt-per-segment iPhone SE/Mini budget.
- Legend caption directly below the row: `"Max-volume window — how many recent weeks to compare against."` (className `text-xs text-gray-500 dark:text-gray-400 mt-1`).

Live `<VolumeTargetSlot>` copy: **unchanged**. The strings "Previous best" and "New PR! +X over your previous" stay verbatim — already correct under any window (no "ever" or "all-time" qualifier).

Verdict screen copy: **unchanged**. The headline is `+N PRs · Y kg · Zh Wm`; PR rows show `+overflow kg (was prior kg)`. Same rationale.

## Riscos

### Data integrity
- **Migration**: pure additive `ADD COLUMN … DEFAULT 0`. Existing rows backfill with `0` (lifetime) during the column-rewrite, so behaviour is preserved for every user. The CHECK constraint enforces the IN-list atomically.
- **Migration filename**: `0009_max_volume_window.sql` (verified next-free index — `0008_sets_unique_set_number.sql` exists).
- **RLS**: no change. Existing `user_preferences` policies cover all columns uniformly.
- **Seed function**: no rewrite needed (`seed_new_user()` at `0001_rls_and_seed.sql:55` omits the column, DEFAULT applies for new signups). Matches `length_unit` migration precedent (`0005_measurements.sql:8-10`).
- **PR semantic invariants** (strict-`>` and `priorMax > 0`): preserved under windowing. Filtering session aggregates out of the running window does not change the comparison logic, only the dataset. Test coverage: `tests/unit/session-verdict-math.test.ts` case (b) ("in-window `priorMaxKg = 0`") guards this explicitly.
- **No cross-week session splitting** (MAJ-1 fix): all windowing decisions happen at the session aggregate level, after rows are grouped by `session_id`. A session whose `started_at` falls inside the window and `completed_at` falls outside (or vice versa) is always treated as one unit. Test coverage: case (e) in the new `progress-page-math.test.ts` block.
- **Numeric `parseISO(...).getTime()` comparison** (BLK-2 fix): eliminates the ISO-string lex-compare boundary error. The codebase already uses `parseISO` at `progress-page-math.ts:34, 133, 265` and `use-progress-page.ts:214` — this design extends the same pattern.

### UX regressions
- **Lifetime path (default)**: every kernel returns identical output for `windowStartMs = undefined` — verified by the regression-guard test cases that pass `undefined` and compare against existing lifetime expectations.
- **Hero legend copy change**: when `weeks > 0`, the copy line at `progress-hero.tsx:163` changes shape. **Action for Implementer**: grep `tests/` for the literal "best week ever" before implementation; if a snapshot pins it, update to branch on `weeks === 0` vs `weeks > 0`.
- **Strip overlay label change**: `tests/e2e/progress-page.spec.ts:333-387` pins literal PR numbers but those tests run under default `weeks = 0`; the lifetime path stays valid. **MIN-5 acknowledged**: the windowed caption `"Best of last 30 weeks: 12,345 kg (May 11)"` is ~41 chars at 14pt — within strip caption budget on iPhone SE/Mini. Implementer verifies during component review.
- **Cross-surface coherence**: uniform window means verdict + hero + list + live slot all use the same boundary. The chosen semantic (Discovery's Unknown #5 reading (i)) means a user who narrows their window may see a "PR" fire against the in-window prior even though an ancient lifetime max is higher. This is *intended* under the windowed mode; the hero legend ("Max = best of last N weeks") makes the window explicit.
- **Reset-to-lifetime is symmetric**: switching back to `0` (All) restores every kernel to its prior output instantly via the `useMemo` dep change. No cache invalidation needed.

### Platform-specific
- Pure JS change. No native modules, no Expo plugin, no platform `if`. The Profile segmented control uses the same `Pressable` + NativeWind classes as the weight/length rows.
- Timezone: `computeWindowStart` uses `isoWeekStart` (local Monday 00:00) and converts via `toISOString()` → numeric ms via `parseISO(...).getTime()`. The filter compares numeric milliseconds against `parseISO(row.sessions.started_at).getTime()` — both UTC instants, no string-ordering trap.
- DST: Brazil does not observe DST since 2019, but `subWeeks` from `date-fns` operates on calendar days so even under a TZ shift the resulting Monday is still local 00:00 (just expressed at a different UTC offset). Test coverage: case (3) in `tests/unit/window-utils.test.ts`.
- Small-phone overflow (MAJ-2 fix): `"All"` / `"10w"` / `"20w"` / `"30w"` are 1-3 chars each; well under the 54pt-per-segment budget on iPhone SE/Mini. Implementer verifies visually under the 320pt simulator preset during component review.

### Performance
- Each kernel gains: (a) one `parseISO(...).getTime()` per session aggregate (NOT per row — session aggregation already happens in `computeLifetimeMaxPerExercise` and `computePrsThisWeek`), (b) one numeric `<` per aggregate. For a user with 5,000 lifetime rows aggregated into ~500 sessions, this is ~500 `parseISO` calls + 500 numeric compares per memo — well under 1 ms.
- `bucketLifetimeWeeklyVolumes` (the one row-level kernel) does one extra `parseISO(row.sessions.started_at).getTime()` per row — 5,000 calls for the lifetime dataset, still sub-millisecond on modern devices. The sub-ms-for-5k-rows performance claim from v1 is preserved; the per-call cost rises slightly (string compare → parse + numeric compare) but stays in the same order of magnitude.
- No new query, no new cache namespace. The `["stats", "weekly-volume", "lifetime"]` cache is reused.

### Implementation notes (MIN-3 pinned recipe)

```ts
import { computeWindowStart } from "~/utils/window-utils";
import { useMaxVolumeWindowWeeks } from "~/hooks/use-preferences";

function SomeConsumer() {
  const weeks = useMaxVolumeWindowWeeks();
  const { windowStartMs } = useMemo(
    () => computeWindowStart(weeks, new Date()),
    [weeks], // ← only `weeks` in deps; new Date() lives inside the factory
  );
  // pass windowStartMs into the kernel
}
```

**Why this works**: `new Date()` is called inside the factory, so it does not appear in the dependency list. The factory re-runs only when `weeks` changes. The resulting `windowStartMs` is stable for ~24 h (until the local Monday rolls over), which is fine — the window only needs to be correct at the moment the user is looking at the screen, and any consumer re-mount (e.g., navigation away and back) creates a fresh `Date`. A consumer that needs sub-day precision (none today) would add a clock-tick trigger; that's out of scope.

### Acknowledged trade-offs (no design change)
- **MIN-4**: Adding a future value (e.g. `52` for yearly) requires 3 coordinated edits — migration ALTER for the CHECK, `MaxVolumeWindowWeeks` union update, Profile row segment. Accepted; the discrete enum is the right shape for v1.
- **MIN-5**: Strip overlay caption wrap on small phones — visually verified during Implementer review at the 320pt preset.
- **MIN-6**: Setter return-shape coupling — every seeded user already has a `user_preferences` row; column rewrite picks up `0` default. No backfill script needed.

## Alternativas descartadas

1. **Uniform vs per-surface window** — Per-surface (different N for live target vs Progress hero) — descartada porque it produces incoherent UX: the verdict screen could declare "PR!" while the Progress hero says you're still chasing. HIGH risk of user confusion. Confidence: HIGH.

2. **Allowed window values `[lifetime, 12, 26, 52]`** (quarterly / half / yearly) — descartada porque the prompt names "10, 20 or 30 weeks". Sticking to literal user wording avoids second-guessing. Confidence: HIGH.

3. **Default value `12 weeks`** (industry norm) — descartada porque it silently shifts every existing user's PR meaning at deploy time. `0 = lifetime` as default makes the feature opt-in. Confidence: HIGH.

4. **Window semantics (b) "last N including current"** — descartada porque conflating current week into Max makes `Max − Now = To PR` degenerate when this week is already the best week in the window. (a) keeps Max and Now disjoint.

5. **Window semantics (c) "N session-bearing weeks"** — descartada porque two users with the same N see different windows depending on training frequency — surprising and hard to explain.

6. **PR semantic decoupled from window (Unknown #5 reading ii)** — descartada porque it requires two parallel reductions + double-mode copy. The chosen reading (i) keeps "PR" defined relative to the chosen comparison anchor.

7. **Hero copy: silently drop the legend when window ≠ lifetime** — descartada porque the legend explains the three terms; dropping it removes context. Renaming `Max` in the legend is lighter touch.

8. **Hook name rename `useLifetimeBestWeek` → `useBestWindowWeek`** — descartada porque the rename ripples into `app/(app)/progress/index.tsx:32` and `progress-hero.tsx:34` without behavioural change. JSDoc note is cheaper (MIN-2 acknowledged).

9. **Storage as text enum `"lifetime" | "10w" | "20w" | "30w"`** — descartada porque integer is naturally orderable, easier to filter in SQL, and matches the "X weeks" framing. IN-list CHECK gives same enum-style safety. Confidence: HIGH.

10. **CHECK constraint `>= 0 AND <= 520`** (range-based) — descartada porque IN-list `(0, 10, 20, 30)` is tighter, matches the segmented control's allowed values exactly, and rejects malformed writes (`7`, `12`) at the DB.

11. **Server-side `sinceUtc` filter per window value** — descartada porque it would require a per-window cache namespace and a refetch on every pref change. Client-side filtering reuses the lifetime cache. Future optimisation only if datasets grow past ~10k rows.

12. **Custom integer entry (free-form N)** — descartada porque it breaks the segmented-control idiom, adds validation surface, and the prompt names a discrete set.

13. **Per-exercise window override** — descartada because the prompt frames the feature as a global preference. Per-exercise overrides multiply UI and storage shape.

14. **Row-level windowing on `completed_at` (v1's approach)** — descartada (MAJ-1) because a session crossing an ISO-week boundary would have its rows split — some included in the windowed priorMax, some excluded — producing a fractional session-volume that does not correspond to any real session. Session-aggregate filtering on `started_at` makes a session indivisible.

15. **ISO-string lexicographic comparison (v1's approach)** — descartada (BLK-2) because PostgREST's `+00:00` offsets vs `new Date().toISOString()`'s `Z` make the lex compare incorrect at the boundary instant. Numeric `parseISO(...).getTime()` is the codebase's existing convention (`progress-page-math.ts:34, 133, 265`).

16. **`Lifetime` label on the 4-segment Profile row** — descartada (MAJ-2) because 320pt screens give ~54pt per segment, while "Lifetime" at `text-base font-medium` needs ~62-68pt. Abbreviated to `All` matches the integer-encoding mental model (`0 = no window`) and stays within the budget. Legend caption clarifies the abbreviation for first-time users.

## Out of scope

- **Per-exercise progress chart `bestE1rm` on `app/(app)/exercises/[id]/progress.tsx`**: adjacent surface; the screen shows estimated 1RM (a separate kernel) rather than volume. Discovery flagged this as deferred. JSDoc note added explaining the deferral (MIN-1).
- **Server-side `sinceUtc` filter on `listWeeklyVolumeRows`**: existing dormant branch (`src/api/stats.ts:51-69`) stays dormant. Switch only if perf bites.
- **Custom integer entry / per-exercise overrides** (Alternatives #12, #13).
- **Notifications / haptics when windowed PR detection changes meaning**: no notification surface today.
- **Backfill / re-detection of past PRs**: PRs aren't persisted; reconstructed per render.
- **Strip per-bucket bar-height denom changes** (`weekly-volume-strip.tsx:222`): dotted overlay tracks the windowed best automatically; bar heights still scale to the visible bucket range for readability.
- **`<VolumeTargetSlot>` and verdict-screen copy that names the window**: "previous best" wording stays — accurate under any window.
- **Renaming `useLifetimeBestWeek`**: keep the name; JSDoc only (MIN-2).
- **iPhone SE/Mini visual confirmation**: Implementer's responsibility during component review under the 320pt simulator preset. Out of scope here in the sense that the design pins the abbreviated label; the visual sign-off is a deliverable of Implementation, not Design.

## Resposta a issues do Validator (v1)

- **[BLK-1] Migration filename collision** → renamed to `0009_max_volume_window.sql`. All references in `Mudanças por arquivo`, `Contratos → DB columns`, and `Riscos → Data integrity` updated. Verified: `supabase/migrations/0008_sets_unique_set_number.sql` exists; `0009` is the next free index.
- **[BLK-2] Lexicographic ISO compare** → replaced with `parseISO(...).getTime()` numeric compare. Threshold precomputed once per kernel call as `windowStartMs: number`. New helper `computeWindowStart` returns both `windowStartIso` (for display/debug) and `windowStartMs` (for kernel filtering); kernels accept the numeric form. Contracts and Performance sections rewritten. Pinned references to `progress-page-math.ts:34, 133, 265` and `use-progress-page.ts:214` to show the codebase's existing `parseISO` convention.
- **[MAJ-1] Cross-anchor field split** → pinned **`session.started_at`** as the single windowing anchor across all kernels; rows are always aggregated to per-session totals BEFORE the window filter, so a session is indivisible. The dual-anchor exception in `bucketLifetimeWeeklyVolumes` is documented explicitly: `started_at` decides inclusion, `completed_at` decides which ISO-week bucket the volume lands in (preserves today's bar-week placement). New "Consistency rule" subsection in Contratos. New test case (e) in `progress-page-math.test.ts` covers the cross-week session scenario.
- **[MAJ-2] Profile-row overflow** → labels abbreviated to `All` / `10w` / `20w` / `30w` per validator option (a). Legend caption "Max-volume window — how many recent weeks to compare against." added beneath the row to clarify the abbreviation. Rationale: matches the integer-encoding mental model, preserves 1-row segmented-control idiom, fits the 54pt-per-segment budget on 320pt screens.
- **[MIN-1] Per-exercise chart deferral rationale** → JSDoc note added at top of `app/(app)/exercises/[id]/progress.tsx` (documentation only).
- **[MIN-2] `useLifetimeBestWeek` misnomer** → name kept, JSDoc updated explaining the window semantic. No rename.
- **[MIN-3] `useMemo` dep stability** → exact recipe pinned in Riscos → Implementation notes section. `new Date()` inside the factory, `[weeks]` as the dep list.
- **[MIN-4] CHECK / type drift** → acknowledged in Riscos; no design change. Discrete enum is the right shape for v1.
- **[MIN-5] Strip overlay caption wrap** → acknowledged in Riscos; Implementer verifies visually at 320pt preset during component review.
- **[MIN-6] Setter return-shape coupling** → acknowledged in Riscos → Data integrity. Every seeded user already has a `user_preferences` row; column rewrite picks up `0` default. No backfill script needed.

Confidence: **HIGH** that this v2 resolves every blocker and major. Risk: **MEDIUM** (broad change set; gated by default-preserving behaviour and comprehensive test coverage including the new MAJ-1 cross-week regression case).
