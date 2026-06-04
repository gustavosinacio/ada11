# Discovery — 2026-06-03_2217_hard-sets-per-muscle

## Feature prompt
"Add a 'hard sets per muscle per week' view to the Progress per-muscle chart, AUGMENTING (not replacing) the existing weekly tonnage chart."

Decision context (settled — do not relitigate): this is the "augment" outcome of open feature #3. Tonnage stays as the overload signal; we ADD a hard-sets view alongside it. Definition is **locked**: count each non-warmup working set = 1 hard set, attributed to the exercise's primary muscle, bucketed by ISO week, with the SAME attribution model + week axis + zero-fill as the existing tonnage per-muscle chart. Dropset handling is the one open sub-question.

## Scope summary
The per-muscle tonnage chart shipped in run `2026-05-30_0126_bodyweight-volume-per-muscle`: a pure presenter `presentWeeklyVolumeByMuscle` (`src/utils/weekly-muscle-volume.ts`) feeds `<WeeklyMuscleVolumeSection>` (`src/components/weekly-muscle-volume-section.tsx`), rendered via `<MultiSeriesChart>` on the Progress page (`app/(app)/progress/index.tsx:99`). This feature adds a "hard sets per muscle/week" metric — a strictly simpler reduce (`+= 1` per qualifying row vs `+= w*r`), reusing the SAME `WeeklyVolumeRow[]` rows, attribution, week axis, zero-fill, windowing, and chart component. The change is contained to the presenter layer + the one section component + tests — NO change to `stats.ts`, `WeeklyVolumeRow`, kernels, or migrations.

## Affected files (verified)

### In-scope — change/add
- `src/utils/weekly-muscle-volume.ts:58-146` — the tonnage presenter. The accumulation seam is **line 130** (`values[idx]! += w * r`), guarded by **line 123** (`if (!(w > 0 && r > 0)) continue;`). The sets variant accumulates `+= 1` and MUST NOT inherit the `w>0 && r>0` guard. (See "The accumulation seam" + U1.)
- `src/components/weekly-muscle-volume-section.tsx:39-163` — the section component. Wires `useLifetimeWeeklyVolume` + `useAllExercises` + `useMeasurements` → presenter → `<MultiSeriesChart>`. Holds the check-all + per-muscle toggle state. Y-axis formatter `formatValue={(v) => formatVolume(v, unit)}` (`:122`); header "Weekly volume per muscle" (`:99`). (See U2 — toggle vs second chart.)
- `tests/unit/weekly-muscle-volume.test.ts:1-479` — the tonnage presenter's unit suite. Injectable `NOW` (`:19`), `mkRow`/`mkExercise`/`mkMeasurement` fixtures (`:21-86`). New sets cases needed (see "Tests").
- `tests/e2e/weekly-muscle-volume.spec.ts:1-351` — the Progress-page e2e. If a kg↔sets toggle ships, a new test for the toggle (header/formatter swap). The seed helper `seedFinishedSession` (`:89-127`) already seeds `set_type: "working"` rows.

### Read-only — verified NOT to change (the close-the-set, below)
- `src/api/stats.ts:18-105` — `WeeklyVolumeRow` + `listWeeklyVolumeRows`. Rows are ALREADY non-warmup (server `.neq("set_type", "warmup")` on BOTH branches, `:66,:90`). NO widening needed for the sets metric — UNLESS the dropset decision is "fold into parent," which needs `parent_set_id` (NOT in the SELECT, `:34-36`). See U3.
- `src/utils/bodyweight.ts:43-66` — `effectiveWeightKg`. The sets reduce does NOT call this at all (load is irrelevant to a hard-set count). Read to confirm the w>0 divergence (below).
- `src/components/multi-series-chart.tsx:1-177` — reusable as-is; only the caller's `formatValue` + `series.values` change. Y-min pinned to 0 (`:81`), single-dot first-week (`:84-86`), empty-state (`:67-79`) all handle an integer (count) series unchanged.

## The accumulation seam (FACT — verified by reading)
`presentWeeklyVolumeByMuscle` accumulates at exactly ONE site:

```
weekly-muscle-volume.ts:120-130
  const bw = resolveBw(row.session_id, row.sessions.started_at);
  const w = effectiveWeightKg(ex.equipment, row.weight, bw, ex.bodyweight_factor);
  const r = row.reps ?? 0;
  if (!(w > 0 && r > 0)) continue;        // ← guard (line 123)
  ...
  values[idx]! += w * r;                   // ← accumulation (line 130)
```

A hard-sets variant replaces lines 120-130 with `values[idx]! += 1` and DROPS the entire bodyweight/equipment/factor machinery (`resolveBw`, `effectiveWeightKg`, the `w>0 && r>0` guard). Everything ABOVE the seam (window guard `:107-110`, week-index lookup `:111-112`, dangling-exercise skip `:113-114`, primary-muscle attribution `:116-118`) is IDENTICAL and MUST be shared. Everything BELOW (canonical-order emit + drop-all-zero `:133-140`, axis construction `:69-88`) is IDENTICAL.

**Key correctness divergence (FACT, HIGH confidence) — the sets reduce must NOT inherit the `w>0 && r>0` guard.** A bodyweight set with `weight = 0` and NO prior weigh-in resolves `bw = 0` → `effectiveWeightKg` returns `0` (`bodyweight.ts:51-54,63`) → the tonnage guard `w>0` drops it. But it is STILL a hard set (a hard set counts regardless of load). If the sets reduce inherited `w>0`, every bodyweight-only set for a user with no logged bodyweight would be uncounted — a systematic undercount of exactly the population the literature-aligned metric most wants to capture (calisthenics-only trainees). The sets reduce should count a row iff it survives the dangling-exercise skip and the window guard — load and reps are irrelevant. (Open sub-question: does a `reps = 0`/null row count? See U4.)

## Presenter shape — mode-param vs sibling presenter (the seam decision)
Two viable shapes:
- **(A) `metric: "tonnage" | "sets"` param on the SAME presenter.** Branch only at the seam: `metric === "sets" ? (values[idx]! += 1) : (guard; values[idx]! += w*r)`. DRY — one axis/attribution/zero-fill path; the #2-attribution change (U6) lands once.
- **(B) sibling `presentWeeklyHardSetsByMuscle`.** Mirrors the e1RM precedent (`e1rm-strength.ts` is a sibling presenter, not a mode of the volume presenter). Clearer single-responsibility; the sets reduce skips the bodyweight imports entirely (no `effectiveWeightKg`/`bodyweightKgAsOf`/`measurements` arg). Cost: ~90 % duplicated axis/attribution/emit code; two places to touch for any axis/attribution change.

**Recommendation (MEDIUM): extract a shared `bucketByMuscleWeek(rows, exercises, windowStartMs, now, perRowValue)` scaffold parameterized by a per-row contribution closure (`() => 1` for sets vs the `w*r` closure for tonnage).** This captures the DRY/single-attribution win (U6 lands once, by construction) WITHOUT the dead `measurements`/bodyweight args that a naive `metric` flag on the current signature would carry into the sets path. If extraction feels heavy, a `metric` param (A) is the next-best; a full sibling (B) is the weakest (duplicated attribution = the U6 desync risk). The Designer should pick between scaffold-extraction and the `metric` flag.

## Where users SEE it (UI — toggle vs second chart)
`<WeeklyMuscleVolumeSection>` renders today: a header row (`:97-114`, "Weekly volume per muscle" + a "Check all"/"Uncheck all" pill); `<MultiSeriesChart>` with `formatValue={(v) => formatVolume(v, unit)}` (`:116-123`, kg y-axis); per-muscle legend chips with toggle state (`:126-160`), local `useState<Set<MuscleSeriesKey>>` (`:65`) re-seeded to "all on" when the series set changes (`:71-75`).

Two UI shapes:
- **(A) kg↔sets mode toggle on the SAME chart.** One section, one chart, one set of per-muscle lines + visibility state. A segmented control (`kg | sets`) swaps `model` (tonnage vs sets) + `formatValue` + the header label; the per-muscle line-selection state is SHARED (both metrics are per-muscle). Precedent: `<ProgressWindowSelector>` (`src/components/progress-window-selector.tsx`, just shipped) is the exact segmented-control idiom — `flex-1 rounded-md py-2`, active `bg-black dark:bg-white`, short-circuit on already-selected.
- **(B) separate `<WeeklyHardSetsSection>` below the tonnage section.** Mirrors how `<E1rmStrengthSection>` sits as its own block below the muscle section (`progress/index.tsx:99-100`). Two charts stacked; no mode state.

**Recommendation (MEDIUM): (A) an in-section kg↔sets segmented toggle.** Rationale: (1) the prompt says "view ON the per-muscle chart" (augment the chart, not add a sibling); (2) both metrics are per-muscle lines over the same week axis + muscle palette — sharing line-selection means isolating "Chest" carries across metrics; (3) `<ProgressWindowSelector>` is a drop-in segmented-control precedent shipped days ago. Tradeoff: adds mode state to an otherwise stateless-except-visibility component, and the windowed `formatValue`/`title` swap needs a new e2e. (B) is defensible if product wants both metrics visible at once — flag for human/Designer (U2).

## Dropset handling (the one real sub-decision) — FACT-grounded
- `set_type` is `"warmup" | "working" | "dropset"` (`db/types.ts:48`). Chart rows are already non-warmup (server filter `stats.ts:66,90`), so they are `working` + `dropset`.
- **The codebase has BOTH counting conventions, verified:**
  - `set_type !== "warmup"` (dropsets INCLUDED, counts each non-warmup row): the per-session working-set count `exercise-session-row-format.ts:65`, the volume kernels `volume-target.ts:124,167`, `progress-page-math.ts:323`, the History detail `history/[id].tsx:206`. **Dominant convention.**
  - `set_type === "working"` (dropsets EXCLUDED): the live-workout per-exercise count `workout/[sessionId].tsx:201`, `auto-fill-set.ts` (`:8`). Used where a dropset is conceptually a continuation, not a fresh set.
- **LOAD-BEARING FACT: `WeeklyVolumeRow` does NOT carry `parent_set_id`** (SELECT `stats.ts:34-36`: `completed_at, weight, reps, set_type, exercise_id, session_id, exercises!inner(...), sessions!inner(...)`). `SetRow` HAS `parent_set_id` (`db/types.ts:255`), but it is NOT projected into the chart rows. So "fold a dropset into its parent working set" is NOT computable from the rows the chart sees — it would require widening the `stats.ts` SELECT to include `parent_set_id`, touching the shared kernel + its type + the null-safety contract (breaks containment), AND is only well-defined if historical dropset rows reliably carry a non-null parent (unverified — legacy/in-progress data may have null parents).

**Recommendation (MEDIUM, lean count-each-non-warmup-row): count each non-warmup row as 1 hard set (dropsets included).** Rationale: (1) dominant existing convention (5 sites incl. the closest sibling, the per-session set count); (2) NO change to `stats.ts`/`WeeklyVolumeRow` (containment preserved → the 6 shared consumers untouched, below); (3) simplest defensible default. **This is the TOP unknown — surface for the human/Designer (U3).** The memo "leaned fold-into-parent"; this recommendation CONTRADICTS that lean on containment + data-availability grounds — surface explicitly. If product insists on fold-into-parent: cost is widen `stats.ts` SELECT + the `WeeklyVolumeRow` type + a parent-linkage reduce + a rule for dropsets whose parent is itself filtered out.

## Close-the-set / blast radius (per STANDING feedback lesson)
The STANDING lesson is: when threading a field through a shared kernel, enumerate INPUT BUILDERS, not just call sites. **It does NOT apply here as a fan-out risk** — this feature does NOT thread a new field through `effectiveWeightKg`; the sets reduce ABANDONS that kernel (no new `SetBodyweightInput`/`equipmentByExerciseId` builder to enumerate). The relevant close-the-set is: (i) is there any OTHER surface showing a per-muscle/per-week set count today, and (ii) does any consumer of the presenter / the shared rows get touched?

- **Existing "set count" displays (grep `set count`/`setCount`/`hard set`/`.length` on sets):** the only set-COUNT displays are per-SESSION/per-exercise, NOT per-muscle/per-week — the delete-exercise confirmation `workout/[sessionId].tsx:330-345`, the per-session-row working-set count `exercise-session-row-format.ts:65`, the insert-count return `routine-exercise-sets.ts:339-378` (a mutation result, not a display). NONE is a weekly-per-muscle set metric. The hard-sets-per-muscle/week metric is genuinely NEW — no N+1th display to sync. (FACT, HIGH confidence.)
- **Consumers of `presentWeeklyVolumeByMuscle` / its types:** exactly ONE production consumer (`weekly-muscle-volume-section.tsx:50`) + the unit suite. `e1rm-strength.ts:11` only NAMES it in a doc comment. No other importer. (FACT — grep.)
- **Consumers of the shared `useLifetimeWeeklyVolume` rows:** 6 surfaces (progress, history list `history/index.tsx:20`, week drill-down `history/week/[isoWeek].tsx:55`, verdict `workout/verdict/[sessionId].tsx:50`, the strip `weekly-volume-strip.tsx:83`, the hero via `use-progress-page.ts`). All consume the SAME `WeeklyVolumeRow` shape. Because the sets metric does NOT widen the SELECT, none is affected. (FACT — grep on `useLifetimeWeeklyVolume`.)

**Containment verdict (HIGH confidence):** with the recommended dropset default, the change is contained to `weekly-muscle-volume.ts` + `weekly-muscle-volume-section.tsx` + the two test files. NO change to `stats.ts`, `WeeklyVolumeRow`, `bodyweight.ts`, any kernel, or any migration (latest is `0021`; no new column — verified). **If the dropset decision flips to fold-into-parent, ALL 6 shared consumers' SELECT widens (regression surface) — an additional reason to prefer count-each-row.**

## Tests & conventions
- Unit (`tests/unit/weekly-muscle-volume.test.ts`): injectable `NOW = 2026-05-18` (`:19`); `mkRow` defaults `set_type: "working"` (`:35`). New sets cases:
  - count per (muscle, week) = number of qualifying rows (e.g. 3 rows in W21 for Chest → value 3) with zero-fill across the axis (mirror the W19/0/W21 tonnage test `:125-153`).
  - **bodyweight-only set, weight=0, NO weigh-in STILL counts = the key divergence from tonnage** — proves the `w>0` guard was correctly dropped. Contrast the existing tonnage "drops all-zero" test (`:260-280`), which for SETS must now KEEP the row as count 1.
  - `muscles[0]` attribution + "Other" bucket (count, not kg).
  - dropset handling per the chosen decision (a `set_type: "dropset"` row counts as 1 under count-each-row).
  - reps=0/null row: does it count? (U4 — recommend counting it; matches `exercise-session-row-format.ts:35-37`).
  - empty input → empty weeks+series; windowed cases (mirror W-0…W-3 `:306-478`) if windowing is shared.
- E2E (`tests/e2e/weekly-muscle-volume.spec.ts`): if a kg↔sets toggle ships, add a test tapping the toggle and asserting the y-axis/header swap (e.g. 3 working sets → the "Chest" line at value 3). The seed helper already seeds `working` rows (`:119`); a dropset-inclusion e2e seeds a `dropset` row and asserts the count. NOTE web `accessibilityState` does NOT map to `aria-checked` (assert on a visible class/label per `:280-285`).

## Relevant conventions (verified by reading code)
- Pure presenters live in `src/utils/*.ts` (no React/RN) so they run under vitest; the section component holds React state (`weekly-muscle-volume.ts:7-11`, `e1rm-strength.ts:11`). FACT.
- Injectable `now?: Date` on the presenter for deterministic week-axis tests (`weekly-muscle-volume.ts:63`). FACT.
- Per-muscle line colors: fixed `Record<MuscleSeriesKey, string>` keyed to `MUSCLE_GROUPS` + "Other" (`weekly-muscle-volume-section.tsx:28-37`). Sets metric reuses the SAME color map. FACT.
- Local non-persisted toggle state re-seeded to "all on" on series-signature change (`weekly-muscle-volume-section.tsx:65-75`; same idiom `e1rm-strength-section.tsx:85-95`). FACT.
- Segmented-control idiom: `<ProgressWindowSelector>` + `profile.tsx:151-187` — `flex-1 rounded-md py-2`, active `bg-black dark:bg-white`, short-circuit on already-selected. FACT.
- Windowing: `windowStartMs?` view-only filter on `started_at`, bucketing on `completed_at` (dual-anchor, `weekly-muscle-volume.ts:48-56`); the page owns the ephemeral window and passes it to BOTH trend sections (`progress/index.tsx:98-100`). Sets metric should honor the SAME window. FACT.
- Volume formatter `formatVolume` (en-US thousands comma, `units.ts:33-40`); a sets formatter is a simple integer — sets are unitless, NOT kg↔lbs. FACT.

## Constraints
- **Data**: read-only on existing `sets`/`sessions`/`exercises` via the shared `WeeklyVolumeRow`. NO migration, NO new column, NO RLS change (recommended dropset default). `stats.ts` SELECT MUST stay unchanged to preserve the 6-consumer containment.
- **UI**: NativeWind; per-muscle multi-line `<MultiSeriesChart>` over a shared ISO-week axis; y-min pinned to 0. Sets y-axis is integer + unitless. Dark-mode classes mirror the existing section.
- **Platform**: web (react-native-web 0.21) is the e2e target. `accessibilityState` does NOT map to `aria-checked` on web (`weekly-muscle-volume.spec.ts:280-285`); a sets-toggle e2e must assert on a visible class/label.
- **Auth**: standard authenticated user; RLS already gates the shared rows. No change.
- **Performance**: the sets reduce is strictly cheaper than tonnage (no `effectiveWeightKg`/bodyweight resolution). If a mode toggle recomputes both metrics, add `metric` to the `useMemo` deps (`weekly-muscle-volume-section.tsx:48-56`) or compute both once.

## Existing precedents
- The tonnage presenter + section + tests triad (`weekly-muscle-volume.{ts,tsx}` + the two test files) — the 1:1 template; the sets metric is a near-clone with a one-line seam swap.
- `e1rm-strength.ts`/`e1rm-strength-section.tsx` — the precedent for a SIBLING presenter+section over the same rows (UI option B).
- `<ProgressWindowSelector>` (`progress-window-selector.tsx`) — segmented-control precedent for an in-section mode toggle (UI option A).
- `exercise-session-row-format.ts:35-65` — the existing "working-set count = `set_type !== 'warmup'` row count, counts even null/0 reps" semantic; the closest sibling to the hard-sets definition and the basis for the count-each-row dropset recommendation.

## Unknowns (ranked by design impact)

- **U1 — verify the guard divergence is honored (resolved-by-definition). (a)** The sets reduce must accumulate `+= 1` and NOT inherit the tonnage `w>0 && r>0` guard (`weekly-muscle-volume.ts:123`). **(b)** If inherited, every bodyweight-only set for a user with no logged bodyweight is uncounted — a systematic undercount of the exact population the metric targets. **(c)** Recommended: count any non-warmup, non-dangling, in-window row as 1 regardless of load/reps. HIGH confidence (a correctness assertion, not a choice).

- **U2 — UI: kg↔sets toggle on one chart vs a separate section. (a)** Mode toggle on the existing per-muscle chart, or a second stacked chart? **(b)** Drives the component shape (mode state vs new section) + the e2e plan. **(c)** Recommended: in-section segmented toggle (`kg | sets`) reusing `<ProgressWindowSelector>`'s idiom and sharing the per-muscle line-selection state. MEDIUM confidence — the prompt's "view on the chart / augment" language favors the toggle; product may prefer both visible at once. **Flag for human/Designer.**

- **U3 — Dropset handling. (a)** Does a dropset count as its own hard set (+1) or fold into its parent working set? **(b)** Folding requires `parent_set_id`, NOT on `WeeklyVolumeRow` (`stats.ts:34-36`) — it breaks the "no `stats.ts` change" containment AND depends on historical dropset rows reliably carrying a parent (unverified). **(c)** Recommended: count each non-warmup row as 1 (dropsets included) — dominant convention (5 sites), no plumbing, containment preserved. MEDIUM confidence. **TOP unknown — flag for human/Designer.** (Memo leaned fold-into-parent; this contradicts the memo on containment + data-availability grounds — surface explicitly.)

- **U4 — Does a `reps = 0`/`null` row count as a hard set? (a)** A logged set with no reps entered. **(b)** Tonnage drops it (`r>0` guard); sets must decide independently. **(c)** Recommended: COUNT it — the user logged the set; matches `exercise-session-row-format.ts:35-37` ("counts even if reps null/0"). LOW-MEDIUM confidence — product may prefer "real effort" = reps>0. Cheap to flip; pin a test either way.

- **U5 — Presenter shape: shared scaffold vs `metric` param vs sibling. (a)** Extract `bucketByMuscleWeek` parameterized by a per-row contribution closure, branch on a `metric` flag, or a separate `presentWeeklyHardSetsByMuscle`. **(b)** A shared path forces tonnage + sets to share the attribution helper (so U6 changes one place); a sibling duplicates ~90 % of the axis/attribution code. **(c)** Recommended: shared `bucketByMuscleWeek` scaffold with a per-row contribution closure (`() => 1` vs `w*r`). MEDIUM confidence.

- **U6 — Attribution coupling with feature #2 (note, do not build). (a)** Attribution is `muscles[0]` (primary only) today (`weekly-muscle-volume.ts:116-118`). If feature #2 ships fractional secondary attribution, it must apply to BOTH tonnage AND sets. **(b)** If sets and tonnage attribute differently, the two metrics disagree on which muscle a set/its volume belongs to. **(c)** Recommended: the sets reduce shares the SAME attribution path as tonnage (reinforces U5), so #2 changes one site. HIGH confidence (architectural; do not build #2 here).

- **U7 — Sets y-axis formatter + label. (a)** What does the sets y-axis read (`"3"` vs `"3 sets"`) and the header label ("Weekly hard sets per muscle"?). **(b)** Affects `formatValue` + header copy + the e2e assertion target. **(c)** Recommended: integer formatter, unitless (no kg↔lbs), header "Weekly hard sets per muscle". LOW confidence — copy is a product call.

- **U8 — drop-all-zero asymmetry. (a)** The tonnage presenter drops all-zero muscle series (`:133-140`); for sets, any muscle with a non-warmup in-window row has count ≥ 1, so the branch effectively never fires. **(b)** The Designer should not assume symmetric drop behavior or write a "0-volume muscle dropped" test for sets (it can't happen the same way). **(c)** Recommended: keep the branch (harmless) but document it only fires for sets when a muscle's only rows are dangling/out-of-window. MEDIUM confidence.

- **U9 — Default metric on first paint + toggle persistence. (a)** On landing, is the chart in kg or sets, and does the choice persist across navigation/sessions? **(b)** Determines ephemeral `useState` vs a stored preference. **(c)** Recommended: default kg (sets is the augment), ephemeral non-persisted mode state (mirrors the existing line-selection + window-selector idioms — all non-persisted). LOW-MEDIUM confidence — product may want sets as the default or a stored pref.

## Out-of-scope flags
- Do NOT remove or alter the tonnage metric (decision: augment, not replace).
- Do NOT widen the `stats.ts` SELECT or change `WeeklyVolumeRow` under the recommended dropset default — doing so touches 6 shared consumers (regression surface) and is only needed if the human chooses fold-into-parent (U3).
- Do NOT build feature #2 (fractional secondary-muscle attribution) — only ensure the sets reduce shares the attribution path so #2 lands once (U6).
- Do NOT add a migration/column — hard sets is a derived count over existing rows.
- Do NOT introduce kg/lbs unit conversion on the sets axis — a set count is unitless.
