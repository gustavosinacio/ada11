# Discovery — 2026-05-23_0211_configurable-max-volume-window

## Feature prompt
> The progress screen shows me my max volume and the exercises also show the max volume pr, but these info are all time. I would like to make this customizable, so the user can choose how many weeks to compare. So let's say, one user can choose to have it's max volume calculated based on the previous 10, 20 or 30 weeks.

## Scope summary
The Progress screen and the per-exercise/live-session "max volume" surfaces all compute their "max" by reducing the **entire lifetime** of finished, non-warmup sets. The feature is to make that reduction respect a per-user **rolling window of N most recent ISO weeks** (or "lifetime" as an explicit option), with the choice stored on `user_preferences` and surfaced from the Profile screen. The same window must flow consistently through (a) weekly-volume max on the Progress hero + strip overlay, (b) per-exercise lifetime-max in the "Exercises this week" rows, (c) PR detection in `usePrsThisWeek`, `computePrsForSession` (verdict screen) and `computeVolumeTarget` (live-session strip).

This is **fact**: every "max" today is a strict reduction over the full `WeeklyVolumeRow[]` lifetime dataset (see Affected files below). It is **assumption** that the user wants the same window applied uniformly across all five surfaces — the prompt only names the hero and the per-exercise list explicitly. See Unknowns.

## Affected files (verified)

### Settings / data plumbing (where the new pref would live)
- `src/db/schema.ts:33-40` — `user_preferences` table: currently `weight_unit text NOT NULL default 'kg'`, `length_unit text NOT NULL default 'cm'`, plus `created_at/updated_at/deleted_at`. Single 1:1 row per `auth.users.id`. This is the only existing per-user settings table.
- `src/db/types.ts:13` — `UserPreferences = InferSelectModel<typeof userPreferences>`. Inferred row type; will gain a new field when the column is added.
- `src/api/preferences.ts:4-11` — `UserPreferencesRow` shape (snake_case PostgREST contract). `getMyPreferences` (line 13-26), `setWeightUnit` (line 28-41), `setLengthUnit` (line 43-56) — symmetric mutation precedent.
- `src/hooks/use-preferences.ts:1-39` — `usePreferences`, `useWeightUnit`, `useLengthUnit`, `useSetWeightUnit`, `useSetLengthUnit`. Cache key `["preferences", "me"]`. Each setter mutates via `qc.setQueryData` on success — no invalidation needed because the row is self-contained. **A new `useMaxVolumeWindow` + `useSetMaxVolumeWindow` would slot in identically.**
- `supabase/migrations/0005_measurements.sql:24-37` — **the precedent** for adding a new `user_preferences` column. Pattern: `ALTER TABLE … ADD COLUMN <name> text NOT NULL DEFAULT '<val>'` + `ADD CONSTRAINT <name>_check CHECK (<name> in (…))`. No RLS change required; existing policies are uniform `auth.uid() = user_id`.
- `supabase/migrations/0001_rls_and_seed.sql:55` — `seed_new_user()` inserts `(user_id, weight_unit)` only; new column relies on its DEFAULT for new signups. No seed-function rewrite needed (matches the `length_unit` migration's note at `0005_measurements.sql:9-10`).

### Profile screen (where the new setting lives in the UI)
- `app/(app)/profile.tsx:1-148` — Renders `Preferences` card with two segmented controls (Weight unit, Length unit) backed by `useSetWeightUnit` / `useSetLengthUnit`. Lines 37-122 show the canonical layout: `border` card, internal rows split by border, segmented `Pressable`s with `bg-black dark:bg-white` for the active variant. **A third row for "Max-volume window" plugs in here.**

### Lifetime-max kernel (the central reduction)
- `src/utils/progress-page-math.ts:144-183` — `computeLifetimeMaxPerExercise(rows: WeeklyVolumeRow[]) => Map<exercise_id, maxKg>`. Steps: (1) group by `(exerciseId, sessionId)` reducing each to total volume; (2) per-exercise max across all session volumes. **No date filter.** Used by `usePrsThisWeek` (for `priorMax`) and `useExercisesThisWeek` (for the per-row `Max`). Also imported by `session-verdict-math.ts`. This is the central place where a window filter must be threaded.
- `src/utils/progress-page-math.ts:29-42` — `bucketLifetimeWeeklyVolumes(rows)` aggregates per ISO-week; lifetime-best comes from this map via `findBestWeek` (lines 63-95). Drives the Progress hero's `Max` (weekly volume) and the dotted overlay on `<WeeklyVolumeStrip>`.
- `src/utils/progress-page-math.ts:224-293` — `computePrsThisWeek({rows, currentWeekStartIso, currentWeekEndIso})`. Walks sessions ASC per exercise maintaining a `priorMax` running tally **over the full history**. The exercise PRs iff a current-week session beats the prior running max. **Window logic would need to either pre-filter `rows` or cap the running window of prior sessions considered.**
- `src/utils/progress-page-math.ts:309-315` — `computePrExerciseIdsThisWeek` — thin Set wrapper over `computePrsThisWeek`.

### Lifetime-max consumers (what users see)
- `src/components/progress-hero.tsx:31-174` — Progress hero: `usePrsThisWeek()` for the PRs count + accordion; `useLifetimeBestWeek()` for `maxKg = bestWeekQ.data?.totalKg`. `MaxNowToPrLine` renders `Max · Now · To PR` (line 155-161). Caption "Max = best week ever" (line 163) is the user-visible promise that breaks once windowed.
- `src/components/weekly-volume-strip.tsx:38-52, 218-228, 319-336` — Receives `bestWeekKg?: number` from `app/(app)/progress/index.tsx:50` (NOT from history `index.tsx:48`, which mounts the strip bare). When provided, draws a dotted emerald overlay at `overlayY` and renders the `bestWeekLabel` caption below. Currently the `bestWeekKg` is the lifetime best (via `useLifetimeBestWeek` → `findBestWeek(bucketLifetimeWeeklyVolumes(rows))`).
- `src/components/exercises-this-week-list.tsx:99-140` — Per-row `Max · Now · To PR` line via `MaxNowToPrLine` with `maxLabel="Best session"`. `row.maxKg` comes from `useExercisesThisWeek().maxKgByExercise` → `computeLifetimeMaxPerExercise(lifetime.data)` (see `src/hooks/use-progress-page.ts:227`).
- `src/hooks/use-progress-page.ts:33-44` — `useLifetimeBestWeek()`. Pipes `useLifetimeWeeklyVolume()` → `bucketLifetimeWeeklyVolumes` → `findBestWeek`.
- `src/hooks/use-progress-page.ts:50-61` — `useCurrentWeekVolume()`. Uses the same lifetime dataset, but filters to the current ISO week — orthogonal to the window question (Now is always "this week"; only Max changes).
- `src/hooks/use-progress-page.ts:82-117` — `usePrsThisWeek()`. Calls `computePrsThisWeek` over the lifetime dataset; emits `count`, `prIds`, `prsByExerciseId`.
- `src/hooks/use-progress-page.ts:193-295` — `useExercisesThisWeek()`. Calls `computeLifetimeMaxPerExercise(lifetime.data)` at line 227 for the per-exercise `maxKg`. Also reuses `prsByExerciseId` from `usePrsThisWeek` (line 203, MIN-C single-source comment).

### Per-exercise progress screen (parallel lifetime max)
- `app/(app)/exercises/[id]/progress.tsx:54-93` — Computes `bestE1rm` over the exercise's full history (`progressQ.data ?? []`) — a **separate** lifetime reduction that does NOT route through `computeLifetimeMaxPerExercise`. It uses `useExerciseProgress` → `listSetsForExercise` (`src/api/progress.ts:10-39`), which scopes to finished sessions but not to a window. The screen's headline copy `Best est. 1RM: …` (line 116) is the user-facing surface. **The prompt names "max volume PR per exercise"; this screen shows estimated-1RM rather than volume, but its `Total volume` chart (line 135-142) also reflects every past session.** Flag: the prompt may or may not want this screen included.

### Live-session "max volume" (volume target)
- `src/utils/volume-target.ts:34-165` — `computeVolumeTarget({pastSessions, currentSessionSets})`. Reduces `pastSessions` (already scoped to `ended_at IS NOT NULL` for this exercise) to `previousMaxKg` via `sumPastVolume` (no completion filter). No date filter — **lifetime over all finished sessions for the exercise**. Drives the chasing/surpassed copy on `<VolumeTargetSlot>`.
- `src/components/volume-target-slot.tsx:29-143` — Consumer. Renders `Max · Now · To PR · ≈ N reps @ Wkg` (chasing) or `New PR! +X over your previous` (surpassed). The "previous" is the full-history max.
- `src/hooks/use-progress.ts:1-12` + `src/api/progress.ts:10-39` — `useExerciseProgress(exerciseId)` returns ALL finished sessions for the exercise, oldest→newest. To window this, either the query gains a `sinceUtc` filter (matches `listWeeklyVolumeRows`'s precedent) or `computeVolumeTarget` accepts a window param and trims `pastSessions` client-side.

### End-of-session verdict (PR detection)
- `src/utils/session-verdict-math.ts:82-116` — `computePrsForSession({rows, currentSessionId, currentSessionVolumeByExercise})`. (1) Drops current-session rows from `rows` to get `priorRows`; (2) `computeLifetimeMaxPerExercise(priorRows)` → `priorMaxByExercise`; (3) emits PR iff `currentKg > priorMaxKg && priorMaxKg > 0`. **Inherits any window filter applied to `computeLifetimeMaxPerExercise` automatically — no separate plumbing needed if we filter at the kernel.**
- `app/(app)/workout/verdict/[sessionId].tsx:57-68` — Calls `computePrsForSession` with the lifetime dataset.

### Shared dataset feeding all consumers
- `src/hooks/use-stats.ts:20-29` — `useLifetimeWeeklyVolume()`. Cache key `["stats", "weekly-volume", "lifetime"]`. Paginated server-side reads of every finished, non-warmup, non-deleted set. **Single source feeding the strip, hero, PRs, per-exercise list AND the verdict screen.** The previous 8-week branch (line 18-19 comment) was removed for the chart-scroll feature.
- `src/api/stats.ts:48-96` — `listWeeklyVolumeRows({sinceUtc?})`. Still supports a `sinceUtc` lower-bound branch (kept for test compatibility per the comment in `use-stats.ts:18-19`), but production no longer calls it.

### Tests pinned to lifetime semantics (need update or new coverage)
- `tests/unit/progress-page-math.test.ts:98-165` — `bucketLifetimeWeeklyVolumes` cases #1-#9.
- `tests/unit/progress-page-math.test.ts:171-211` — `findBestWeek` cases #10-#13 (MIN-7 oldest-tie-wins behaviour).
- `tests/unit/progress-page-math.test.ts:217-578` — `computePrExerciseIdsThisWeek` + `computePrsThisWeek` cases #14-#24, (a)-(f). Includes "PR-then-non-PR same week" (line 669) and "priorMaxKg=0 first-ever session" (line 759) — both semantics will need a windowed-mode variant once N is finite.
- `tests/unit/progress-page-math.test.ts:46-49 area` — `computeLifetimeMaxPerExercise` cases #46-#49.
- `tests/unit/session-verdict-math.test.ts:185-306+` — `computePrsForSession` cases #10-#20 (strict-`>` tie, lifetime-leakage filter on current-session, multi-exercise). Each implicitly asserts lifetime semantics.
- `tests/unit/volume-target.test.ts:100-570+` — `computeVolumeTarget` cases that assert specific `previousMaxKg` values from `pastSessions`.
- `tests/unit/weekly-volume-bucketing.test.ts:138-202` — Strip-model bucketing tests, including `"includes rows older than 8 weeks now that buckets are lifetime-spanning"` (line 185) — that test asserts a 10-weeks-ago bucket is counted; a windowed denom must NOT regress this for the bar-height denominator (which is `model.maxKg` over the bucket range itself), but the dotted-overlay `bestWeekKg` should respect the window.
- `tests/e2e/progress-page.spec.ts:333-387` — Asserts `PR! +900 kg (was 1,500 kg)` for an exercise that beats its lifetime best this week. Lifetime semantics baked into the literal numbers.

## Relevant conventions (verified by reading code)
- **Per-user settings live on `user_preferences`** (Supabase, RLS-protected). New scalar prefs are added via a numbered migration: `ALTER TABLE … ADD COLUMN … text NOT NULL DEFAULT 'x'` + `ADD CONSTRAINT …_check CHECK (… in (…))`. Precedent: `0005_measurements.sql:24-37`. The seed function (`0001_rls_and_seed.sql:55`) does NOT need rewriting — it omits the column and the DEFAULT picks it up.
- **API layer for prefs follows symmetric setters**: one `getMyPreferences()` reader, one `setX(value)` mutation per field. See `src/api/preferences.ts:28-56`.
- **Hook layer**: one `useX` accessor returning a typed scalar with a default fallback (`useWeightUnit` → `"kg"`), one `useSetX` mutation that cache-updates via `qc.setQueryData(KEY, row)` — no invalidation cascade.
- **Profile UI**: segmented `Pressable` row inside a single bordered card. Active state = `bg-black dark:bg-white`. Pattern repeats verbatim in `app/(app)/profile.tsx:41-79` (weight) and `83-121` (length).
- **Lifetime kernel is a `WeeklyVolumeRow[]` reduction**, ALWAYS. No date filtering anywhere downstream of `useLifetimeWeeklyVolume`. The TanStack cache key is `["stats", "weekly-volume", "lifetime"]`; pull-to-refresh invalidates `["stats"]`.
- **PR semantic is strict `>`**, NOT `>=` (matches `volume-target.ts:124-126`, `session-verdict-math.ts:74`, `progress-page-math.ts:267`). First-ever session is NOT a PR. This must hold under any window.
- **ISO weeks are local-time Monday-Sunday** (`src/utils/dates.ts`). A windowed N means "the N most recent ISO weeks ending at the current week" — but the exact semantics ("last N completed weeks" vs "current + last N-1" vs "last N session-bearing weeks") is an Unknown.
- **WeeklyVolumeRow** is non-warmup, non-deleted, `completed_at IS NOT NULL`, `sessions.ended_at IS NOT NULL` (`src/api/stats.ts:55-89`).
- **Drizzle owns the schema** (`src/db/schema.ts`); `npm run db:generate` produces SQL but per `0006_add_source_flag.sql` precedent the migration file is hand-written when CHECK constraints + indexes are needed.

## Constraints
- **Data**: change touches `user_preferences` only — add one column (e.g. `max_volume_window_weeks integer NOT NULL DEFAULT 0`, where `0` denotes "lifetime") + CHECK. RLS unchanged. No new index needed (single row per user, read whenever prefs are read). The lifetime dataset query (`useLifetimeWeeklyVolume`) does NOT need a server-side filter rewrite — windowing happens client-side at the kernel boundary, because the lifetime dataset is already in cache and the windowed view is a slice. **Server-side filter would be a future optimisation, not a v1 need.**
- **UI**: NativeWind classes per the Profile precedent (segmented Pressable row inside a card). Hero copy "Max = best week ever · Now = this week · To PR = remaining" (`progress-hero.tsx:163`) becomes inaccurate under a window — needs to change to e.g. "Max = best of last 12 weeks". Live-session `<VolumeTargetSlot>` copy "Previous best …" and "New PR! +X over your previous" also presumes lifetime context — may need a tooltip or qualifier under windowed mode.
- **Platform**: pure JS change, no native modules, no Expo plugin. Works uniformly iOS/Android/web.
- **Auth**: writes route through `setX(...)` → `supabase.from("user_preferences").update(…).eq("user_id", userId)`; RLS enforces ownership. `getMyPreferences` already gates on `auth.user?.id`.
- **Performance**: kernels currently iterate `WeeklyVolumeRow[]` linearly once per memo. Windowing is a single date-comparison per row — no big-O change. The TanStack cache is shared, so re-deriving with a window is `O(N)` over the same in-memory array. **No perf risk.**
- **Backwards compatibility**: existing users must default to a sensible value. If `max_volume_window_weeks = 0` denotes "lifetime" (preserving today's behaviour), no behaviour changes for any current user until they opt in. This is the LOW-risk default.

## Existing precedents
- **`length_unit` migration + hook + Profile row** (`supabase/migrations/0005_measurements.sql:24-37`, `src/api/preferences.ts:43-56`, `src/hooks/use-preferences.ts:20-23, 33-39`, `app/(app)/profile.tsx:81-121`) is the cleanest precedent. Adding `max_volume_window_weeks` follows the SAME pattern at every layer.
- **Windowed query branch already exists**: `listWeeklyVolumeRows({sinceUtc})` (`src/api/stats.ts:51-69`). Currently dormant but kept "for test compatibility / future windowed reads" (`use-stats.ts:18-19`). If a future iteration wants server-side filtering, the plumbing is already there.
- **Strict-`>` PR semantic** is shared across `volume-target.ts:124-126`, `session-verdict-math.ts:96-108`, `progress-page-math.ts:267, 274`. Windowing must keep this invariant.
- **`computeStripModel`'s bar-height denom** (`weekly-volume-strip-math.ts:88`) is the bucket-array max, NOT a lifetime constant. It is already independent of any "lifetime max" — only the **dotted overlay** uses `bestWeekKg`. So the strip's bar heights don't need to change semantics; only the overlay does.
- **The `bestWeekKg` prop is optional** (`weekly-volume-strip.tsx:38-46`). History calls the strip without it (`app/(app)/history/index.tsx:48`) — overlay only renders on the Progress screen. So the window choice naturally lives on the Progress hero's caller side; the strip stays a dumb display.
- **"Soften to trailing-N-weeks max" was explicitly deferred** in the original Progress page run: `docs/runs/2026-05-22_0030_progress-page/discovery.md:248, 259, 270`. The note was "soften only if it bites" and "kernel change only, no UI change". This run is precisely the "it bites" follow-up.

## Unknowns (require Designer judgment or human decision)
1. **Uniform vs per-surface window.** The prompt only names "the progress screen" and "the exercises" (per-exercise rows). Should the same N also apply to (a) `computePrsForSession` (verdict screen), (b) `computeVolumeTarget` (live-session strip on the workout page), (c) `bestE1rm` on the per-exercise progress chart (`app/(app)/exercises/[id]/progress.tsx`)? **Recommended default**: yes, uniform — otherwise the verdict screen says "PR!" when the windowed Progress page says you're still chasing, which is incoherent. **Risk**: HIGH if non-uniform — surfaces will contradict each other. **Confidence**: MEDIUM that the user wants uniformity; the prompt doesn't say.
2. **Allowed window values.** Prompt mentions "10, 20 or 30 weeks". Should "lifetime" remain selectable (preserves current behaviour as opt-in default)? Should 4/8/12 also be offered? **Recommended default**: `[lifetime, 12, 26, 52]` (lifetime as default, then quarterly/half-yearly/yearly). Or stick to prompt's literal `[10, 20, 30]` + lifetime. Designer call.
3. **Default value for new + existing users.** "Lifetime" is the safe choice (zero behaviour change until opt-in). Alternative: "last 12 weeks" matches what other lifting apps default to, but silently shifts every existing user's PR meaning. **Strongly recommend lifetime as default** to preserve invariants. **Confidence**: HIGH on the rec; user should sign off.
4. **Window semantics — "last N weeks" definition.** Three plausible interpretations:
   - (a) Last N completed ISO weeks **excluding** the current week (so the user is always comparing the current week against the prior N).
   - (b) Last N ISO weeks **including** the current (so the current week competes against the last N-1 + itself).
   - (c) The N most recent ISO weeks that contain ≥1 finished session (skip rest weeks).
   The verdict screen and `computePrsForSession` care most: today, `priorRows` filters out only the current session — adding a date window changes whether last month's PR is still your benchmark. **Recommended default**: (a) — clean separation between "this week" (Now) and "the window" (Max). Excludes current-week sessions from the Max baseline, matching the existing `computePrsThisWeek` priorMax semantic.
5. **PR semantic under a window.** If the window excludes a previously-PR session (e.g. you set 1,500 kg 40 weeks ago and the window is 26 weeks), does beating the 26-week max trigger a "PR!"? Two readings:
   - (i) Yes — the PR is relative to the user-chosen window. Internally consistent.
   - (ii) No — only true all-time PRs trigger the celebration; the windowed Max is just a softer comparison anchor for the hero/list, while PR detection stays lifetime.
   **Recommended default**: (i) — uniformity beats subtle two-mode logic. But this changes the meaning of "PR" — call this out clearly in copy. **Confidence**: LOW that the user has thought this through; needs sign-off.
6. **Hero copy under a window.** "Max = best week ever" (`progress-hero.tsx:163`) becomes a lie. Options: change to "Max = best week (last 12 weeks)" / "Best in window" / silently drop the caption when window ≠ lifetime. Designer call.
7. **Should `useLifetimeBestWeek` rename?** If the hook now respects a window, `useLifetime…` is a misnomer. Renaming to `useBestWeekInWindow` is a refactor that ripples through `app/(app)/progress/index.tsx:32`. **Recommend**: rename to `useBestWindowWeek` (or keep the name with a JSDoc that says "lifetime when window=0"). Designer call.
8. **Where the setting is stored.** Server (`user_preferences`) vs local (AsyncStorage). Server is the established pattern (weight/length units). AsyncStorage avoids a migration but desyncs across devices. **Strongly recommend server** to match precedent. **Confidence**: HIGH on the rec.
9. **Storage representation.** Integer `weeks` (e.g. `0 = lifetime, 10, 20, 30`) vs text enum (`"lifetime" | "10w" | "20w" | "30w"`). Integer is simpler and matches the prompt's "X weeks" framing; text enum is rigid and harder to evolve. **Recommend integer** (e.g. `max_volume_window_weeks integer NOT NULL DEFAULT 0 CHECK (max_volume_window_weeks >= 0 AND max_volume_window_weeks <= 520)`). **Confidence**: HIGH.
10. **Per-exercise progress chart (`app/(app)/exercises/[id]/progress.tsx`).** The chart's `bestE1rm` (lines 58-83) and `Total volume` chart range are not in the prompt's named scope but are obvious adjacent surfaces. Include in this feature or defer? **Recommend defer** to keep the run scoped — the screen is a "see all history" surface where lifetime view is arguably the right default. **Confidence**: MEDIUM.

## Out-of-scope flags
- **Server-side window filtering on `listWeeklyVolumeRows`.** v1 is client-side filtering at the kernel boundary; pushing the bound into PostgREST is a future perf optimisation only worthwhile if the dataset grows past ~10k rows.
- **Per-exercise window override.** Prompt asks for a global setting, not per-exercise; do not introduce a per-exercise UI affordance.
- **Custom integer entry** (e.g. "enter any N"). Use a fixed picker, matching the segmented control idiom already used for weight/length units. A free-form number input creates picker-vs-segmented inconsistency and adds validation surface.
- **Visual "window scope" indicator on the strip bars.** The dotted overlay already communicates "the line you're aiming at"; an extra annotation would clutter.
- **Notifications / haptics when the windowed PR detection changes meaning.** Out of scope.
- **Backfill / re-detection of past PRs.** PRs aren't persisted (Progress page reconstructs them per render); no historical records to rewrite. If `usePrsThisWeek` ever gets persistence, that's a separate run.
- **Per-exercise progress screen (`app/(app)/exercises/[id]/progress.tsx`).** Adjacent; recommend deferring (see Unknown #10). If the Designer disagrees, it's a small additive change but expands the test surface.
- **Adjusting `WeeklyVolumeStrip`'s per-bucket bar height denom** to respect the window. Today the denom is `Math.max(model.maxKg, bestWeekKg ?? 0)` (line 222). Changing this changes what the strip "looks like" beyond the overlay — should NOT be touched unless explicitly requested, because the bar-height scale is about visual readability, not PR semantics.
