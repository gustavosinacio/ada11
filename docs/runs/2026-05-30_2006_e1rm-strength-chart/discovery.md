# Discovery — 2026-05-30_2006_e1rm-strength-chart

## Feature prompt
(condensed from state.md)

Phase 2a — add a curated **multi-exercise e1RM (estimated-1-rep-max) trend chart** to the Progress page. One line per exercise, plotting that exercise's **best e1RM per session (or per week)** over time, oldest left. e1RM via the existing `epley1RM(weight, reps)` in `src/utils/formulas.ts`, computed from **LOGGED weight only** (Invariant D — a 0-weight bodyweight set yields NO e1RM point). Exercise selection is **AUTO**: auto-populate with the owner's **MOST-PERFORMED exercises** (top N by sessions/sets), derived from existing data — **no DB column, no migration**. **Selectable lines** with check-all/uncheck-all, mirroring the muscle chart UX. **Reuse `<MultiSeriesChart>`** if it fits; Discovery evaluates reuse-vs-extension. **Out of scope**: favorites (Phase 2b), leverage factors, secondary-muscle attribution, hard-sets/week. Carry-in lesson: produce an EXHAUSTIVE close-the-set inventory of e1RM sites.

Baseline: `main @ 3c00d8e` (Phase 0 bodyweight kernel + Phase 1 weekly per-muscle chart). Verified: `git rev-parse HEAD` = `3c00d8e02ac15eedf2dcd42e1b06909fef7c669a` (HEAD = baseline; tree clean).

## Scope summary
A new **read-only trend section** on the Progress page (`app/(app)/progress/index.tsx`), structurally a sibling of the just-shipped `<WeeklyMuscleVolumeSection>`. It computes best-e1RM-per-(exercise, time-bucket) from the lifetime `WeeklyVolumeRow[]` already fetched by `useLifetimeWeeklyVolume()`, auto-selects the top-N most-performed exercises, and renders selectable kg-valued lines via `<MultiSeriesChart>`. Pure computation over existing tables — **no migration**. The architectural twin is the Phase-1 muscle chart (presenter + section component + unit/e2e test pair); this feature mirrors it almost 1:1, swapping muscle bucketing/`muscles[0]` attribution for per-exercise best-e1RM and the fixed 7-color palette for a dynamic top-N palette.

## Affected files (verified)
- `src/utils/formulas.ts:1-5` — **REUSE** `epley1RM` (the single 1RM seam; do not re-inline).
- `app/(app)/exercises/[id]/progress.tsx:138-199` — **READ-ONLY reference** for e1RM/Invariant-D semantics (max-per-session, logged-weight guard `w>0`, unit conversion). Do NOT refactor (see Unknown #6).
- `src/components/multi-series-chart.tsx:1-177` — **REUSE AS-IS** (props contract fits kg-valued exercise lines on a shared axis).
- `src/components/weekly-muscle-volume-section.tsx:1-159` — **UX TEMPLATE** to mirror (selection state, check-all, chips, `opacity-40` OFF).
- `src/utils/weekly-muscle-volume.ts:50-128` — **STRUCTURAL TEMPLATE** for the new pure presenter (week axis, dangling skip, drop-all-zero series).
- `src/hooks/use-stats.ts:20-29` + `src/api/stats.ts:18-103` — `useLifetimeWeeklyVolume()` → `WeeklyVolumeRow[]` (already fetched; no new query).
- `src/hooks/use-exercises.ts:42-47` — `useAllExercises()` → `ExerciseRow[]` (names/equipment/muscles; include-deleted).
- `src/utils/dates.ts:40-126` — ISO-week helpers (`isoWeekStart`, `weekKeyOf`, `isoWeeksBetween`).
- **NEW** `src/utils/e1rm-strength.ts` (or similar) — pure presenter (Designer names it).
- **NEW** `src/components/<e1rm-strength-section>.tsx` — section component.
- **NEW** `tests/unit/<…>.test.ts` + `tests/e2e/<…>.spec.ts` — test pair.
- `app/(app)/progress/index.tsx:46-74` — **EDIT** one JSX insertion + import (mount the section); refresh the stale "four blocks" docstring (`:19-33`).
- **No migration** (latest is `0018`; e1RM is pure computation).

---

## 1. e1RM kernel inventory — CLOSE-THE-SET (the load-bearing deliverable)

**Method (per the carry-in retro lesson): exhaustiveness-by-construction, not enumeration-from-memory.** Ran three orthogonal greps across `app/` + `src/` and mapped every hit to a row. The set is closed.

### Grep A — `epley1RM` symbol (definition + all callers)
`grep -rn "epley1RM" app/ src/ tests/` → production hits:
- `src/utils/formulas.ts:1` — **definition** `export function epley1RM(weight, reps): number`.
- `app/(app)/exercises/[id]/progress.tsx:27` — import.
- `app/(app)/exercises/[id]/progress.tsx:157` — **the only production call site** (`const est = epley1RM(w, r);`).
- Test-only: `tests/unit/formulas.test.ts:3,5,7,13,15,19,20,24,25,30,31,32` (coverage of `epley1RM`, not a computation site).

### Grep B — inline Epley arithmetic `* (1 + reps/30)` and variants
`grep -rn "\* (1 +\|\*(1+\|1 + reps\|/30\|/ 30" app/ src/` → only real hit `src/utils/formulas.ts:4` (`return weight * (1 + reps / 30);` — the formula body). Every other `…/30` hit was a NativeWind opacity token (`bg-red-950/30`, `bg-green-950/30`, `set-input.tsx:157`, `read-only-set-row.tsx:55`) or a schema comment (`schema.ts:39`) — **none is an e1RM computation.**

### Grep C — alternate 1RM-formula names
`grep -rni "brzycki\|lombardi\|wathan\|oconner\|mayhew" app/ src/` → **zero hits.** Epley is the only 1RM model in the codebase.

### Hit → inventory-row table
| # | Site | File:line | Kind | Notes |
|---|---|---|---|---|
| K0 | `epley1RM` definition | `src/utils/formulas.ts:1-5` | shared helper | `if (reps<=0 \|\| weight<=0) return 0; if (reps===1) return weight; return weight*(1+reps/30);` |
| K1 | per-exercise progress reduce | `app/(app)/exercises/[id]/progress.tsx:155-159,169-173` | **only production caller** | `w = set.weight ? parseFloat(set.weight) : 0`; guard `if (w>0 && r>0)`; tracks `sessionBestE1rm`; pushes one `{label,value}` per session iff `>0`. |

### Verdict — "no N+1th site exists"
**Exactly 2 e1RM sites in production: 1 shared helper (`epley1RM`) + 1 caller (`progress.tsx:157`). No inline e1RM duplicate exists.** Unlike the volume kernel (Phase 0 found 14 inline copies), **e1RM was centralized into `epley1RM` from day one** — greps A/B/C agree. This is a meaningfully different shape from the last run: **the carry-in "missed inline copy" risk does NOT materialize for e1RM.** The new chart becomes the **2nd** production caller; if a shared `bestE1rmBy…` presenter is created it must call `epley1RM` (never re-inline `* (1+r/30)`).

### Reference-site detail — the post-3c00d8e two-variable w/effW split (`progress.tsx:138-199`)
Verified by reading the current file. The per-session reduce keeps **two independent variables with two divergent guards** (Invariant D made concrete):
- **e1RM path** (`:152-159`): `const w = set.weight ? parseFloat(set.weight) : 0;` then `if (w > 0 && r > 0) { const est = epley1RM(w, r); if (est > sessionBestE1rm) sessionBestE1rm = est; }`. **LOGGED weight `w` only.** `weight=0` → `w=0` → guard false → NO e1RM contribution.
- **Volume path** (`:161-166`): `const effW = effectiveWeightKg(equipment, set.weight, bw);` then `if (effW > 0 && r > 0) sessionVolume += effW * r;`. **Bodyweight-aware `effW`.** `weight=0` with `bw>0` still contributes `bw*reps`.
- Non-bodyweight equipment → `effW === w` → both guards fire identically (byte-for-byte). Bodyweight → diverge: **volume point, no e1RM point** (Invariant D).
- `warmup` skipped first (`:149`). e1RM pushed only when `sessionBestE1rm>0` (`:169`), **unit-converted at the boundary** (`:170` `unit==="kg" ? sessionBestE1rm : kgToLbs(sessionBestE1rm)`), one `DataPoint` per session, labelled `formatShortDate(s.started_at)` (`:139`).

**Most important reuse invariant:** the new presenter must replicate the e1RM guard **`w > 0 && r > 0` on LOGGED weight**, NOT `effectiveWeightKg`. Do not let the new presenter accidentally reuse the volume `effW` path — that would resurrect bodyweight movements as e1RM lines and violate Invariant D.

---

## 2. `<MultiSeriesChart>` reusability analysis

Read in full: `src/components/multi-series-chart.tsx:1-177`.

### Props contract (verified)
```ts
export type ChartSeries = {
  label: string;        // :6  — line/dot React keys + legend
  color: string;        // :7  — hex, caller-assigned
  values: number[];     // :8  — index-aligned to xLabels; PRE-unit-converted by caller
  visible: boolean;     // :10 — drives filter at :49
};
type MultiSeriesChartProps = {
  xLabels: string[];    // :15 — shared x-axis labels (oldest→newest)
  series: ChartSeries[];// :16
  width: number;        // :17
  height?: number;      // :18 — default 200
  title: string;        // :19 — "" renders no title row (:71,106)
  formatValue?: (v: number) => string; // :19 — default (v)=>v.toFixed(0)
};
```

### Behaviors (verified)
- **Y-domain** (`:53-61,81`): `max` across ALL visible series, **min pinned to 0**. For e1RM the interesting delta is compressed near the top (e1RM rarely starts near 0) — a cosmetic limitation, NOT a blocker (the muscle chart accepted the same).
- **X positioning** (`:84-87`): index-spacing over `xLabels.length`; `count===1` centers the lone dot. **No date interpolation** — straight lines between adjacent indices.
- **1-week single-dot** (`:83-87,150-160`): a dot per visible series (unlike `<ProgressChart>`'s `<2`-point bail) — good for first-week users.
- **Empty-state** (`:67-79`): "No data yet" when `count===0` OR no series visible OR `maxV===0`.
- **Value formatting** (`:130`): `formatValue` on y-ticks. Values are pre-converted by the caller (muscle section passes `formatVolume(v,unit)`, `weekly-muscle-volume-section.tsx:118`). For e1RM, `(v)=>v.toFixed(1)` matches the per-exercise chart (`progress.tsx:253`).

### Reusable AS-IS? — **YES, no extension required.**
e1RM-per-exercise series are kg-valued numeric lines over a shared x-axis — **structurally identical** to the muscle-volume series the component already renders. `<MultiSeriesChart>` is agnostic to whether the lines are "muscles" or "exercises"; it consumes `{label,color,values,visible}` + `xLabels`. The muscle section is a working proof. **Recommendation: reuse as-is.** Confidence: **HIGH.**

### UX template to mirror — `<WeeklyMuscleVolumeSection>` (`src/components/weekly-muscle-volume-section.tsx`)
- **Selection state** (`:61-71`): `useState<Set<Key>>(() => new Set(seriesKeys))` — all-on default; a **signature-tracking re-seed** (`seriesKeysSig`, `:60,67-71`) re-enables a freshly appearing line on data change. Local, non-persisted.
- **Check-all/uncheck-all** (`:89,97-110`): `allOn = keys.every(k=>visible.has(k))`; toggle flips to `new Set()` / `new Set(keys)`. a11y `"Hide all muscles"`/`"Show all muscles"`; visible text `"Uncheck all"`/`"Check all"`.
- **Per-line chips** (`:122-156`): `Pressable` with `accessibilityRole="checkbox"`, `accessibilityLabel={`Toggle ${key}`}`, colored dot, and OFF state adds **`opacity-40`** (the e2e source-of-truth, since rn-web 0.21 omits `aria-checked`).
- **Chart wiring** (`:73-82,112-119`): maps `model.series → ChartSeries[]` with `color: PALETTE[key]`, `visible: visible.has(key)`; passes `xLabels = model.weeks.map(w=>w.label)`, `title=""`, `formatValue`.
- **Loading/empty bail** (`:84-85`): `if (isLoading) return null; if (!model || series.length===0) return null;`.

### Color-assignment divergence (FLAG — the single material reuse decision)
The muscle chart uses a fixed `Record<MuscleSeriesKey,string>` of 7 + Other (`weekly-muscle-volume-section.tsx:28-37`). e1RM lines are a **dynamic top-N set** (arbitrary exercise ids/names) → a static keyed record won't work. The Designer must define a **palette-by-index** (ordered color array indexed by top-N rank), with a documented behavior when N exceeds palette length (wrap or cap N). Purely caller-side; `<MultiSeriesChart>` is unaffected.

---

## 3. "Most-performed exercises" derivation (no new fetch / no migration)

### Available data WITHOUT a new query
`useLifetimeWeeklyVolume()` (`use-stats.ts:20-29`) → `WeeklyVolumeRow[]` is already fetched on the Progress page. Each row (`stats.ts:18-30`) carries `completed_at, weight(string|null), reps(number|null), set_type, exercise_id, session_id, exercises:{equipment}, sessions:{started_at,ended_at}`. **Server-side filters already applied** (`stats.ts:60-66,84-89`): finished sessions, **non-warmup**, non-deleted set + session, non-null `completed_at` — so the presenter sees the working-set universe.

`useAllExercises()` (`use-exercises.ts:42-47`) → `ExerciseRow[]` (include-deleted, correct for progress) gives `id, name, muscles[], equipment` (`db/types.ts:139-150`).

### Ranking by frequency — fully derivable, no DB change
- **distinct sessions** per `exercise_id`: `Map<exercise_id, Set<session_id>>`, rank by `.size`.
- **set count** per `exercise_id`: count rows per `exercise_id`.
Both are pure reductions over the already-fetched array. **Recommended default: distinct sessions** (matches "sessions/sets appeared in"; intuitive "most-performed"). **No migration, no new query, no favorites table.**

### Dangling / soft-delete precedent (carry forward)
`use-progress-page.ts:316-321` is the canonical idiom:
```
const libById = new Map(lib.data.map((e) => [e.id, e] as const));
const ex = libById.get(exId);
if (!ex) continue; // dangling exercise_id — skip
```
Same at `weekly-muscle-volume.ts:95-96`. The e1RM presenter must **skip rows whose `exercise_id` is not in the library** and resolve the **name** via `ex.name` (`use-progress-page.ts:334,347`). Soft-deleted exercises ARE in `useAllExercises` (`allIncludingDeleted` key), so a soft-deleted-but-historically-performed exercise still resolves a name (correct — its e1RM history is real); a truly dangling id is skipped.

---

## 3b. e1RM series shape — per-session vs per-week computation

Each `WeeklyVolumeRow` carries everything needed: `weight`, `reps`, `exercise_id`, `session_id`, `sessions.started_at` (label source for per-session), `completed_at` (bucket source for per-week — matches the muscle chart).

### Best-e1RM-per-(exercise, SESSION)
Group by `(exercise_id, session_id)`; within each group `bestE1rm = max(epley1RM(parseFloat(weight), reps))` over rows where **`weight>0 && reps>0`** (logged-weight guard, Invariant D). Emit one point per non-zero session, x-labelled `formatShortDate(sessions.started_at)`, ordered by `started_at` ASC. **Caveat**: per-session axes for different exercises do NOT align (A on Mon, B on Wed) — `<MultiSeriesChart>` assumes a SHARED `xLabels` index and draws straight lines between adjacent indices (no date interpolation). A naive per-session axis needs a union-of-dates with zero-fill the component doesn't provide. **This is the strongest argument for per-week** (Unknown #1).

### Best-e1RM-per-(exercise, WEEK) — mirrors `presentWeeklyVolumeByMuscle`
Clean fit for the shared-axis contract. Mirror `weekly-muscle-volume.ts` exactly:
1. Earliest `completed_at` → `firstMonday = isoWeekStart(...)`; `currentMonday = isoWeekStart(now)`; `weeks = isoWeeksBetween(firstMonday, currentMonday)` (`:60-70`) — shared contiguous axis (Decision #4).
2. `weekIndex = Map<weekKey, idx>` via `weekKeyOf(parseISO(row.completed_at))` (`:73-74,93`).
3. Per row: skip dangling (`:95-96`); apply **logged-weight guard** `w>0 && r>0` with `w = row.weight ? parseFloat(row.weight) : 0`; compute `epley1RM(w, r)`; **take MAX into the (exercise, week) cell** — NOTE: a `max`, NOT the `+=` the volume presenter uses (`:112`). e1RM is a PEAK metric, not a sum.
4. Emit one series per exercise with any non-zero week; zero-fill across `weeks.length`; **drop a series whose every week is 0** (mirrors `:115-122`).

### Bodyweight exclusion (Invariant D) — CRITICAL
`epley1RM(0, r) = 0` (helper guard `weight<=0 → return 0`, `formulas.ts:2`). A bodyweight-only exercise (every set `weight=0`) → all-zero weeks → series dropped → **NO line plotted.** The `w>0` guard enforces it; the drop-all-zero rule finishes it. Do NOT use `effectiveWeightKg`. A Pull-up logged with ADDED weight (`weight>0`) WILL plot — correct, it's a weighted movement.

### ISO-week helpers available (`src/utils/dates.ts`, verified)
- `isoWeekStart(d)` (`:40-42`), `weekKeyOf(d)` (`:48-56`), `isoWeeksBetween(startMon, endMonInclusive)` (`:105-126`, `[]` if end<start), `lastNIsoWeeks(n, now)` (`:62-76`), `isoWeekContaining(d)` (`:83-92`), `parseISO` re-export (`:129`). All **device-local** by design (`:12-19` — a 23:30 BRT Sunday set belongs to that local week). The muscle presenter buckets on `completed_at` (`:93`); follow suit.

---

## 4. Progress-page mount point

`app/(app)/progress/index.tsx` post-3c00d8e JSX (`:46-74`) renders **5 children** in the `<ScrollView>`:
1. `<ProgressHero />` (`:55`)  2. `<WeeklyVolumeStrip … />` (`:66-69`)  3. **`<WeeklyMuscleVolumeSection />`** (`:70`)  4. `<ExercisesThisWeekList />` (`:71`)  5. `<StreakCard />` (`:72`).

**Recommended mount: immediately AFTER `<WeeklyMuscleVolumeSection>` (`:70`), BEFORE `<ExercisesThisWeekList>` (`:71`)** — keeps the two trend charts adjacent (volume-per-muscle → strength-per-exercise), matching the prompt's "strength complement to the volume chart" framing. The file docstring (`:19-33`) still says "four independent blocks" — **stale** (the muscle section was added in Phase 1 → 5 children); Implementer should refresh it when adding the 6th child. The new section owns its own hook + memo (like `<WeeklyMuscleVolumeSection>`), so the page change is a one-line JSX insert + import.

---

## 5. Test conventions

### Unit (vitest) — template `tests/unit/weekly-muscle-volume.test.ts`
- **Config** (`vitest.config.ts:11`): `include: ["tests/unit/**/*.test.ts"]` — `.test.ts` only, **NO RNTL** (no component rendering). The presenter MUST be a **pure function** (no React/Supabase) — mirror `presentWeeklyVolumeByMuscle`'s pure signature with an **injectable `now?: Date`** (`weekly-muscle-volume.ts:54`) for deterministic week axes.
- **Date pinning — two coexisting patterns**: (a) presenter test passes `now: NOW` explicitly, no fake timers (`weekly-muscle-volume.test.ts:18,92`); (b) code reading `new Date()` internally uses `vi.useFakeTimers()` + `vi.setSystemTime(new Date("2026-05-22T12:00:00-03:00"))` in `beforeEach` + `vi.useRealTimers()` in `afterEach` (`measurements-chart.test.ts:9-16`; also `dates.test.ts`, `progress-page-math.test.ts`, `format-display-date.test.ts`). **Recommended: injectable `now`** (pattern a — cleaner, tz-safe, what the sibling uses).
- **Fixtures**: copy `mkRow` (`weekly-muscle-volume.test.ts:20-40`), `mkExercise` (`:42-59`), `mkMeasurement` (`:61-84`).
- **Required cases**: empty → `{weeks:[],series:[]}`; single weighted exercise → one series w/ best-e1RM; multi-week zero-fill; **`max` semantics** (two sessions same week → higher e1RM wins, NOT a sum — key divergence from volume `+=`); **bodyweight `weight=0` → NO series** (Invariant D); dangling `exercise_id` skip; single-week one-dot.

### E2E (Playwright) — template `tests/e2e/weekly-muscle-volume.spec.ts`
- **Flow** (`:160-204`): admin service-role seed → `pickCanonicalExercise(admin, "<Name>")` → `seedFinishedSession({weight,reps,workingSets})` → `signInViaUi` → `gotoProgress` → assert header + legend; `.first()` on every navigation `getByText` (strict-mode).
- **Check-all/uncheck-all** via a11y button name (`:234-247`) → new section needs analogous labels (e.g. `"Hide all exercises"`/`"Show all exercises"`).
- **Per-line chip** via `getByLabel("Toggle <name>")` + the **`opacity-40` class** on OFF (`:280-295`) — **rn-web 0.21 does NOT emit `aria-checked` from `accessibilityState`** (documented `:281-285`). New chips must replicate `opacity-40` OFF for the e2e to assert.
- `vi.setSystemTime` is NOT an e2e tool — e2e seeds real dates via `mondayNWeeksAgoUtc()` (`:78-87`) + `completedAt`.

### `pickCanonicalExercise` catalog reality (CORRECTION to the prompt's gotcha)
Verified against `supabase/migrations/0001_rls_and_seed.sql:60-91`. **The prompt's claim that the catalog "has Chin-up/Dip/Push-up but NOT Pull-up" is FALSE** — `Pull-up` IS seeded (`:70`, bodyweight). Load-bearing fact for THIS feature: the catalog has **abundant WEIGHTED exercises** an e1RM chart needs — barbell: `Bench Press`, `Incline Bench Press`, `Back Squat`, `Front Squat`, `Deadlift`, `Romanian Deadlift`, `Overhead Press`, `Barbell Row`, `Pendlay Row`; dumbbell: `Bicep Curl`, `Hammer Curl`, `Lateral Raise`, `Dumbbell Bench Press`, `Dumbbell Row`, `Goblet Squat`, `Bulgarian Split Squat`; cable: `Lat Pulldown`, `Seated Cable Row`, `Face Pull`, `Cable Tricep Pushdown`; machine: `Leg Press`, `Leg Curl`, `Leg Extension`, `Calf Raise`. The **bodyweight** entries — `Pull-up`, `Chin-up`, `Dip`, `Push-up`, `Plank`, `Hanging Leg Raise` (`:70-73,90-91`) — produce **NO e1RM line** under Invariant D when logged `weight=0`. **The e2e MUST seed a weighted exercise (e.g. `Bench Press`) for a visible line; a bodyweight-only seed is the correct negative case (no line).** `pickCanonicalExercise` **throws** on an unknown name (`canonical-exercise.ts:49-54`) — pick a name actually in the seed.

---

## 6. Migration check — confirmed NO migration
- e1RM is **pure computation** over existing `sets.weight` / `sets.reps` (no new column).
- "Most-performed" is **derived** from the already-fetched `WeeklyVolumeRow[]` — no new column/query.
- **Favorites (the only thing that WOULD need a table — `user_exercise_favorites` + RLS) is OUT OF SCOPE** (Phase 2b, `docs/features.md:6`).
- Latest migration `0018_admin_edit_exercises.sql` (verified `ls supabase/migrations/`); **no `0019` needed.** The `exercises!inner(equipment)` SELECT already exists (Phase 0, `stats.ts:32-34`) — and e1RM doesn't even read `equipment`. **Confidence: HIGH.**

---

## Relevant conventions (verified by reading code)
- **Pure presenter + section-component + test-pair** is the established Progress-chart pattern: `presentWeeklyVolumeByMuscle` (`weekly-muscle-volume.ts`) ⟷ `<WeeklyMuscleVolumeSection>` ⟷ `weekly-muscle-volume.test.ts` + `.spec.ts`. Mirror it.
- **Unit conversion at the boundary**: presenter works in **kg**; values pre-converted for display (`weekly-muscle-volume-section.tsx:118`; `progress.tsx:170` via `kgToLbs`). Per-exercise e1RM formats `(v)=>v.toFixed(1)` (`progress.tsx:253`) — match it.
- **`epley1RM` is the single 1RM seam** — reuse; never re-inline `* (1+r/30)`.
- **Local-time ISO weeks** (`dates.ts:12-19`) — bucket on `completed_at`.
- **Selection state is component-local, non-persisted** (`weekly-muscle-volume-section.tsx:61-71`), with signature re-seed for newly-appearing series.
- **Owner is sole user; today 2026-05-30 BRT.** RLS already scopes the underlying reads.

## Constraints
- **Data**: read-only over `sets` + `exercises` via existing caches. No write path, no FK/RLS change. The `["stats"]` + `["exercises"]` invalidation cascade already live-updates the section after a session finishes (`progress/index.tsx:23-32`).
- **UI**: NativeWind classes mirror `<WeeklyMuscleVolumeSection>` (`px-4`, chip `rounded-full border px-2.5 py-1`, OFF `opacity-40`). SVG via `react-native-svg` inside `<MultiSeriesChart>` (unchanged). Width `Dimensions.get("window").width - 32` (match the sibling).
- **Platform**: rn-web 0.21 omits `aria-checked` from `accessibilityState` — e2e asserts on `opacity-40` (carry forward).
- **Auth**: owner session; RLS scopes the underlying queries. No new auth surface.
- **Performance**: all derivation is `useMemo`'d reductions over the SAME in-cache `WeeklyVolumeRow[]` — no new network. Lifetime rows already paginated to bypass PostgREST's 1000-row truncation (`stats.ts:77-96`), paid for by the existing page.

## Existing precedents
- **The entire Phase-1 muscle chart** (presenter `weekly-muscle-volume.ts`, section `weekly-muscle-volume-section.tsx`, tests `.test.ts` + `.spec.ts`) — the 1:1 structural template.
- **The per-exercise e1RM reduce** (`progress.tsx:138-199`) — exact e1RM/Invariant-D semantics (max-per-session, logged-weight guard, unit conversion) to lift into the new presenter.
- **`TOP_N = 5`** in `<ProgressHero>` (`progress-hero.tsx:24,105-106`) — precedent for a "top N" cap on the Progress page; reuse the magnitude/idiom.
- **Dangling-skip join** (`use-progress-page.ts:316-321`, `weekly-muscle-volume.ts:95-96`) — name resolution + skip.
- **`measurements-chart.ts` null-skip** — sibling "drop the point when the value is absent" idiom.

## Unknowns (require Designer judgment or human decision)

1. **(a)** Per-session vs per-week x-axis. **(b)** `<MultiSeriesChart>` requires a SHARED `xLabels` index; per-session axes for different exercises don't align (A on Mon, B on Wed), and the component draws straight lines between adjacent indices (no date interpolation). **(c)** **Recommended: per-WEEK** (best-e1RM-per-(exercise,week)), reusing the muscle chart's shared contiguous week axis verbatim — aligns all lines, matches the volume chart's x-axis, and is the only shape that fits the component without extension. Prompt says "per session OR per week" and defers to Designer.

2. **(a)** N for "top N most-performed" + tie-break. **(b)** Dynamic line count affects palette size + legibility (too many lines = unreadable). **(c)** **Recommended: N=5** (matches `progress-hero.tsx:24`), ranked by **distinct sessions** (`Map<exercise_id, Set<session_id>>.size`); break ties by most-recent activity (latest `completed_at`) then name ASC for determinism.

3. **(a)** Dynamic per-exercise color assignment. **(b)** The muscle chart's fixed `Record<key,color>` can't key on arbitrary exercise ids/names. **(c)** **Recommended: ordered color array indexed by top-N rank** (reuse the muscle palette's hexes; extend to N if N>7, or cap N at palette length). Purely caller-side; `<MultiSeriesChart>` unaffected. **The single material reuse decision.**

4. **(a)** Share the volume chart's week axis or compute an independent one? **(b)** Both presenters derive `isoWeeksBetween(firstTrainedMonday, currentMonday)` from the SAME data → identical axes. **(c)** **Recommended: each presenter computes its own axis** (decoupled, mirrors the muscle presenter's self-contained `now?` injection) — they coincide because the source is shared. Do NOT share a presenter.

5. **(a)** Bodyweight-only exercise handling. **(b)** Invariant D → `weight=0` → `epley1RM=0` → all-zero series → must be DROPPED (no flat-zero line). **(c)** **Recommended: drop all-zero series** (mirror `weekly-muscle-volume.ts:120`). The exclusion is the **logged-weight `w>0` guard**, not an equipment check — a Pull-up with added weight WILL plot.

6. **(a)** Extract a shared `bestE1rmBy…` presenter AND wire it into the existing `progress.tsx` reduce? **(b)** Carry-in lesson says "wire ALL call sites in one pass" — but `progress.tsx`'s reduce ALSO computes volume + max-volume-session in the same loop; extracting only the e1RM half would split a tight loop. **(c)** **Recommended: do NOT refactor `progress.tsx`.** Build a NEW multi-exercise presenter; leave the single-exercise screen intact. Both call the same `epley1RM`, so there's no formula duplication — the close-the-set risk does NOT apply (e1RM was never inlined). Flagged so the Designer doesn't over-refactor.

7. **(a)** Y-domain 0-baseline for e1RM. **(b)** `<MultiSeriesChart>` pins min to 0 (`:81`); e1RM clusters far from 0, so the delta is visually compressed. **(c)** **Recommended: accept the 0-baseline as-is** (the muscle chart did; a non-zero min is a `<MultiSeriesChart>` extension and the prompt says "strongly prefer reuse"). Flag as a possible future enhancement, not this run.

8. **(a)** Empty-state / first-week behavior. **(b)** A user with only bodyweight history, or no weighted sessions, produces zero series. **(c)** **Recommended: render nothing** when `series.length===0` (mirror `weekly-muscle-volume-section.tsx:85`), so the section absents silently rather than showing an empty chart. `<MultiSeriesChart>` also has its own "No data yet" if a series exists but is all-zero.

9. **(a)** Section title/header copy + check-all a11y labels. **(b)** The e2e asserts on exact strings. **(c)** **Recommended**: header `"Estimated 1RM per exercise"`, toggle a11y `"Hide all exercises"`/`"Show all exercises"`, chip a11y `"Toggle <exercise name>"`, OFF `opacity-40`. Designer fixes exact copy so the e2e can pin it.

## Out-of-scope flags
- **Favorites (Phase 2b)** — favorite toggle + `user_exercise_favorites(user_id, exercise_id)` + RLS. Deferred (`docs/features.md:6`). This run is **auto-selection only**.
- **Bodyweight leverage factors, secondary-muscle attribution, "hard sets/week" dose metric** — out (prompt + `features.md` open follow-ups).
- **Refactoring `progress.tsx`'s combined reduce** — out (Unknown #6; splits a tight loop for no dedup benefit).
- **Extending `<MultiSeriesChart>`** (non-zero y-min, per-session interpolation) — out; prompt mandates reuse and the component fits for a per-week axis.
- **Honoring `max_volume_window_weeks`** — out; trend charts are deliberately full-history (Decision #3, `weekly-muscle-volume.ts:48`).
- **Persisting line selection** — out; component-local like the muscle chart.
