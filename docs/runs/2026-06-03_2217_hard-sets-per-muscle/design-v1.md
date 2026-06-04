# Design v1 — 2026-06-03_2217_hard-sets-per-muscle

## Goal (1 sentence)
Add a "hard sets per muscle per week" metric to the existing Progress per-muscle chart, surfaced via a kg↔sets segmented toggle on `<WeeklyMuscleVolumeSection>`, by extracting a shared bucketing scaffold parameterized by a per-row INCLUDE-predicate + per-row CONTRIBUTION — tonnage output unchanged byte-for-byte.

## Approach
The tonnage presenter `presentWeeklyVolumeByMuscle` (`src/utils/weekly-muscle-volume.ts`) already does ALL the work the sets metric needs above and below the accumulation seam: the window guard, the first-trained week-axis derivation, the week-index lookup, the dangling-exercise skip, the `muscles[0]` attribution, and the canonical-order emit + drop-all-zero. The ONLY thing that differs between tonnage and hard-sets is (a) **which rows are included** and (b) **what each included row contributes**. I extract an internal `bucketByMuscleWeek(...)` scaffold parameterized by exactly those two closures, and re-express `presentWeeklyVolumeByMuscle` as a thin wrapper over it (no behavior change) plus a new sibling `presentWeeklyHardSetsByMuscle`. This is Discovery's U5 recommendation and the right shape because the two metrics genuinely diverge on the row set (LOCKED decision #3: tonnage includes working+dropset rows with `w>0 && r>0`; hard-sets includes `set_type === 'working'` rows regardless of load/reps) — a single accumulator-only `metric` flag could not express the divergent include-predicate cleanly, and a fully-independent sibling would duplicate ~90% of the axis/attribution code (so feature #2's secondary-muscle attribution would have to be edited in two places — U6). The scaffold makes U6 land in ONE place by construction.

The two metrics share the same chart, the same per-muscle line palette, and the same line-selection (`visible` Set) state. The section gains one piece of ephemeral `useState` (`metric: "kg" | "sets"`, defaulting to `"kg"`) rendered as a segmented control mirroring `<ProgressWindowSelector>`'s idiom verbatim. The metric drives (1) which presenter the memo calls, (2) the y-axis `formatValue`, and (3) the header label.

**Containment rests on one fact, verified against source: `WeeklyVolumeRow.set_type: SetType` is already on the type (`src/api/stats.ts:23`) AND already in the SELECT (`src/api/stats.ts:35`, `"... set_type, ..."`).** So the hard-sets reduce reads `row.set_type` with zero query/type/migration change — the 6 shared `useLifetimeWeeklyVolume` consumers are untouched. NO `stats.ts`, kernel, `bodyweight.ts`, or migration change.

## Load-bearing invariants (proved by construction)

- **Invariant T (tonnage byte-for-byte):** `presentWeeklyVolumeByMuscle(args)` produces the IDENTICAL output it does today — same row set, same numbers, same series, same axis. Proof by construction: the refactor moves the existing body verbatim into `bucketByMuscleWeek`, and `presentWeeklyVolumeByMuscle` calls it with the include-predicate `(w, r) => w > 0 && r > 0` (the current `:123` guard) and contribution `(w, r) => w * r` (the current `:130` value). No line of math changes; only the call site of the now-shared scaffold. The existing 14 unit tests (`tests/unit/weekly-muscle-volume.test.ts:88-478`) stay GREEN UNCHANGED — they are the executable spec for Invariant T.
- **Invariant S (sets ignore load/reps — LOCKED U1):** the hard-sets path MUST NOT inherit the `w > 0 && r > 0` guard. A `set_type === 'working'`, non-dangling, in-window row counts as exactly `1` regardless of `weight`/`reps`. Proof by construction: the sets include-predicate is `(row) => row.set_type === "working"` and the contribution is `() => 1` — the bodyweight/`effectiveWeightKg`/`resolveBw` machinery is NEVER called on the sets path (the scaffold computes `w`/`r`/`bw` lazily, only when a metric's predicate/contribution asks for them — see Contracts). A bodyweight working set with `weight=0` and no weigh-in counts as 1.
- **Invariant D (intentional divergence — LOCKED #3):** tonnage and hard-sets have DIFFERENT per-row inclusion. A `set_type === 'dropset'` row with `w>0 && r>0` contributes to TONNAGE but contributes 0 to HARD-SETS. The scaffold parameterizes the include-predicate precisely so this divergence is explicit, not emergent.

## Mudanças por arquivo
| File | Type | Change |
|---|---|---|
| `src/utils/weekly-muscle-volume.ts` | edited | Extract internal `bucketByMuscleWeek(...)` scaffold from the current `presentWeeklyVolumeByMuscle` body (shared axis/window/attribution/emit). Re-express `presentWeeklyVolumeByMuscle` as a thin wrapper (Invariant T). Add exported sibling `presentWeeklyHardSetsByMuscle(...)`. One responsibility: the bucketing-by-(muscle×week) presenter layer, now with two metrics. |
| `src/components/weekly-muscle-volume-section.tsx` | edited | Add ephemeral `metric: "kg" \| "sets"` state (default `"kg"`); render a kg↔sets segmented control (mirrors `<ProgressWindowSelector>`); branch the memo to call the sets presenter when `metric === "sets"`; swap `formatValue` (integer/unitless vs `formatVolume`) + the header label. One responsibility: the section's metric toggle + display swap. Line-selection (`visible`) state shared, unchanged. |
| `tests/unit/weekly-muscle-volume.test.ts` | edited | Add `describe("presentWeeklyHardSetsByMuscle")` with the new sets cases (below). Existing tonnage `describe` block UNCHANGED (Invariant T executable proof). |
| `tests/e2e/weekly-muscle-volume.spec.ts` | edited | Parameterize `seedFinishedSession` to accept an optional `setType` (default `"working"`, preserving the 4 existing tonnage tests). Add one toggle test: tap the sets segment, assert the header swaps to "Weekly hard sets per muscle" AND the Chest y-axis reads an integer count (teeth: a SPECIFIC value, not a tick count). Add one dropset-exclusion assertion via a seeded `dropset` row. |

**Confirmed NO change:** `src/api/stats.ts` (`set_type` already selected + typed), `src/utils/bodyweight.ts` (sets path never calls it), `src/components/multi-series-chart.tsx` (integer series renders unchanged — y-min pinned 0, `:81`; `formatValue` is caller-supplied, `:46`), any kernel, any migration (latest is `0021`; no new column).

## Contratos de I/O

### `src/utils/weekly-muscle-volume.ts`

**New internal scaffold** (NOT exported — implementation detail shared by the two presenters):

```ts
type RowMetric = {
  /** Per-row inclusion. Receives the raw row + the (lazily computed) effective
   *  weight/reps so tonnage can keep its `w>0 && r>0` gate and sets can ignore
   *  load entirely. */
  include: (row: WeeklyVolumeRow, w: number, r: number) => boolean;
  /** Per-row contribution to the (muscle, week) accumulator. */
  contribute: (row: WeeklyVolumeRow, w: number, r: number) => number;
  /** Whether this metric needs the bodyweight/effectiveWeight machinery at all.
   *  Sets path = false → skip resolveBw/effectiveWeightKg entirely (Invariant S,
   *  perf). Tonnage = true. */
  needsLoad: boolean;
};

function bucketByMuscleWeek(args: {
  rows: WeeklyVolumeRow[];
  exercises: ExerciseRow[];
  measurements: MeasurementEntryRow[];
  windowStartMs: number | undefined;
  now: Date;
  metric: RowMetric;
}): WeeklyMuscleVolumeModel;
```

Scaffold body = today's `presentWeeklyVolumeByMuscle` body verbatim, with exactly these substitutions at the per-row seam (`weekly-muscle-volume.ts:120-130`):

```ts
// inside the bucket loop, after the dangling-skip (:114) + attribution (:116-118):
let w = 0;
let r = 0;
if (metric.needsLoad) {
  const bw = resolveBw(row.session_id, row.sessions.started_at);
  w = effectiveWeightKg(ex.equipment, row.weight, bw, ex.bodyweight_factor);
  r = row.reps ?? 0;
}
if (!metric.include(row, w, r)) continue;
// ... lazily allocate the values array (unchanged :125-129) ...
values[idx]! += metric.contribute(row, w, r);
```

Everything else (`:69-88` axis, `:72-74`/`:107-109` window guard, `:111-112` week-index, `:113-114` dangling skip, `:116-118` attribution, `:133-140` emit + drop-all-zero, the empty-`rows` early return `:67`, the empty-`weeks` early return `:84`) is moved UNCHANGED.

**Wrapper (unchanged public signature — Invariant T):**

```ts
export function presentWeeklyVolumeByMuscle(args: {
  rows: WeeklyVolumeRow[];
  exercises: ExerciseRow[];
  measurements: MeasurementEntryRow[];
  windowStartMs?: number;
  now?: Date;
}): WeeklyMuscleVolumeModel {
  const { rows, exercises, measurements, windowStartMs, now = new Date() } = args;
  return bucketByMuscleWeek({
    rows, exercises, measurements, windowStartMs, now,
    metric: {
      needsLoad: true,
      include: (_row, w, r) => w > 0 && r > 0,   // today's :123 guard, verbatim
      contribute: (_row, w, r) => w * r,          // today's :130 value, verbatim
    },
  });
}
```

**New sibling presenter** — mirrors the tonnage signature MINUS `measurements` (the sets metric needs no bodyweight; passing it would be dead weight and a U1 trap):

```ts
export type WeeklyMuscleHardSetsModel = WeeklyMuscleVolumeModel; // same shape; `values` are integer counts, not kg.

export function presentWeeklyHardSetsByMuscle(args: {
  rows: WeeklyVolumeRow[];
  exercises: ExerciseRow[];
  windowStartMs?: number;
  now?: Date;
}): WeeklyMuscleVolumeModel {
  const { rows, exercises, windowStartMs, now = new Date() } = args;
  return bucketByMuscleWeek({
    rows, exercises, measurements: [], windowStartMs, now,
    metric: {
      needsLoad: false,                                   // Invariant S — no effectiveWeightKg
      include: (row) => row.set_type === "working",       // LOCKED #1/#3 — working-only
      contribute: () => 1,                                // one hard set per qualifying row
    },
  });
}
```

Notes:
- `measurements: []` is passed to the scaffold but `needsLoad: false` means `resolveBw` is never invoked, so the empty array is inert (it only feeds `resolveBw`). The sibling signature OMITS `measurements` so the section never wires `useMeasurements()` into the sets path.
- The sets `include` ignores `w`/`r` entirely → Invariant S. A `weight=0` bodyweight working row and a `reps=0/null` working row both pass `row.set_type === "working"` → both count (U1, U4).
- `WeeklyMuscleHardSetsModel` is a type alias (same shape) rather than a structurally distinct type — the chart consumes `{ weeks, series:[{key,values:number[]}] }` identically; only the formatter interprets `values` as counts vs kg. The shared `MuscleSeriesKey`/`WeeklyMuscleSeries` types are reused.

### `src/components/weekly-muscle-volume-section.tsx`

**State / wiring:**

```ts
const [metric, setMetric] = useState<"kg" | "sets">("kg"); // ephemeral, default kg (U9)

const model = useMemo(() => {
  if (!rows || !exercises) return null;
  return metric === "sets"
    ? presentWeeklyHardSetsByMuscle({ rows, exercises, windowStartMs: props.windowStartMs })
    : presentWeeklyVolumeByMuscle({
        rows, exercises, measurements: measurements ?? [], windowStartMs: props.windowStartMs,
      });
}, [rows, exercises, measurements, props.windowStartMs, metric]); // `metric` added to deps
```

- **Memo strategy: branch the single memo on `metric`** (recompute the active model only), NOT compute-both. Rationale: only one model is rendered at a time; the visible-line `<MultiSeriesChart>` consumes one `series` array; recomputing on toggle is O(rows) and cheap (sets is strictly cheaper than tonnage — no `effectiveWeightKg`). Adding `metric` to the deps array is the only memo change. (`measurements` stays in deps — harmless on the sets branch since it isn't read there.)
- **`visible` (line-selection) state is UNCHANGED and SHARED.** It is keyed off `model.series.map(s => s.key)` (`:60-63`). Both metrics emit the SAME `MuscleSeriesKey` set for a given dataset's trained muscles (same attribution path), so toggling metric does NOT spuriously reseed visibility in the common case — the `seriesKeysSig` (`:64`) is stable across a kg↔sets flip when the same muscles are present. (Edge: a muscle present in tonnage but absent in sets — e.g. all its rows are dropsets — would change the signature and reseed to all-on; acceptable and consistent with the existing refetch-reseed behavior at `:71-75`. Pinned as R-4.)

**Segmented control** (mirrors `<ProgressWindowSelector>` `:33-67` verbatim — `flex-1 rounded-md py-2`, active `bg-black dark:bg-white`, short-circuit when already selected):

```tsx
<View className="mb-2 flex-row gap-2">
  {(["kg", "sets"] as const).map((m) => {
    const selected = metric === m;
    return (
      <Pressable
        key={m}
        onPress={() => { if (selected) return; setMetric(m); }}
        accessibilityRole="button"
        accessibilityLabel={m === "kg" ? "Metric: volume in kg" : "Metric: hard sets"}
        accessibilityState={{ selected }}
        className={`flex-1 rounded-md py-2 ${selected ? "bg-black dark:bg-white" : "border border-gray-300 dark:border-gray-700"}`}
      >
        <Text className={`text-center text-base font-medium ${selected ? "text-white dark:text-black" : "text-black dark:text-white"}`}>
          {m === "kg" ? "Volume (kg)" : "Hard sets"}
        </Text>
      </Pressable>
    );
  })}
</View>
```

**Header label + formatter swap (U7):**

```ts
const headerLabel = metric === "sets" ? "Weekly hard sets per muscle" : "Weekly volume per muscle";
const formatValue =
  metric === "sets"
    ? (v: number) => `${Math.round(v)}`        // integer, unitless
    : (v: number) => formatVolume(v, unit);    // kg/lbs (unchanged :122)
```
- `headerLabel` replaces the hardcoded "Weekly volume per muscle" at `:99`.
- `formatValue` replaces the inline `(v) => formatVolume(v, unit)` at `:122`.
- The sets formatter uses `Math.round` defensively (the y-tick generator at `multi-series-chart.tsx:92-96` produces fractional intermediate tick values `(range/4)*i` even when data is integer — rounding keeps the axis labels reading as whole counts, e.g. `0,1,2,3` or `0,2,3,5,7` rather than `1.75`). NO kg↔lbs conversion (sets are unitless — Out of scope). `unit`/`useWeightUnit()` stays wired (still needed for the kg branch).

## Edge cases / tests

### Existing tonnage tests — stay GREEN UNCHANGED (Invariant T)
All 14 cases in `tests/unit/weekly-muscle-volume.test.ts:88-478` run against the wrapper with zero edits. This is the regression proof for the refactor. Notably the `"drops an all-zero muscle series"` case (`:260-280`, a barbell `weight:0,reps:5` working row → 0 tonnage → no series) MUST still pass on the tonnage path — and its row is the exact pin for the SETS divergence below (the same row counts as 1 set).

### New `describe("presentWeeklyHardSetsByMuscle")` cases
1. **count per (muscle, week) + zero-fill** — 3 working Chest rows in W21, none in W20, mirror the W19/0/W21 axis (`:125-153`); assert Chest values `[…, 0, 3]` (count, not kg). Pins Invariant S contribution = 1/row + shared zero-fill.
2. **KEY DIVERGENCE — bodyweight working set, `weight:0`, NO weigh-in, COUNTS as 1.** Seed a `equipment:"bodyweight"`, `weight:"0"`, `reps:10` working row with `measurements: []`. Tonnage would drop it (`w=0`); SETS asserts `series[0].values === [1]`. This is the executable proof the `w>0` guard was correctly dropped (Invariant S / U1). Explicitly contrasts the tonnage `:212-239` bodyweight case (which NEEDS a weigh-in to be non-zero) and the tonnage `:260-280` all-zero-drop case (which under SETS KEEPS the row).
3. **`reps:0`/`null` working row COUNTS (U4).** Seed `weight:"50", reps:0` (and a sibling `reps:null`) working row → assert count 1 each. Pins the U4 decision (matches `exercise-session-row-format.ts:35-37`).
4. **dropset row does NOT count (Invariant D / LOCKED #1+#3).** Seed one `set_type:"working"` row + one `set_type:"dropset"` row (both `w>0,r>0`, same muscle/week) → assert Chest count is **1**, NOT 2. This is the divergence pin: the same two rows under tonnage would BOTH contribute. Requires extending the `mkRow` fixture to accept `set_type` (it hardcodes `"working"` at `:35`).
5. **`muscles[0]` attribution + "Other" bucket (count).** A multi-muscle exercise attributes its working rows to the primary only; an unknown-muscle exercise's rows go to "Other" as a count. Reuses the tonnage attribution fixtures; asserts integer counts.
6. **dangling exercise_id skipped** — a working row whose exercise is not in the lib → no series (mirrors tonnage `:241-258`).
7. **empty input → `{ weeks:[], series:[] }`** (mirrors `:89-98`).
8. **windowed parity (shared scaffold)** — repeat W-1/W-3 shape (`:354-398`, `:437-478`) for the sets presenter: a pre-window working row is excluded; a row started exactly at the threshold is included. Confirms the window guard is shared (same scaffold) and the sets count honors it.

**Do NOT write** a "0-count muscle dropped" sets test (U8): a muscle with ≥1 in-window non-dangling working row always has count ≥1, so the drop-all-zero branch (`:138`) cannot fire for a present-but-zero muscle on the sets path. The branch is kept (harmless) but un-exercisable for sets, so a test asserting it for sets would be a false-teeth test (per feedback: do not write an assertion that cannot fire).

### Invariant-T deepEqual anchor (new, in the tonnage describe block is acceptable, OR adjacent)
Add ONE case asserting `presentWeeklyVolumeByMuscle(fixture)` equals a frozen expected model on a multi-week multi-muscle fixture — a deepEqual guard so the refactor cannot silently drift the tonnage output. (The existing 14 cases already cover this in aggregate; this is the explicit "byte-for-byte" pin per the standing lesson.)

### E2E (`tests/e2e/weekly-muscle-volume.spec.ts`)
- **Parameterize `seedFinishedSession`** to accept `setType?: "working" | "dropset" | "warmup"` defaulting to `"working"` (line `:119` becomes `set_type: opts.setType ?? "working"`). The 4 existing tests pass `undefined` → unchanged behavior.
- **New test "5. kg↔sets toggle swaps header + axis (with teeth)":** seed 3 working Bench Press sets (Chest, `weight:100,reps:5`). Default render asserts "Weekly volume per muscle" header + the kg y-axis (an existing assertion shape). Tap the "Metric: hard sets" segment (locate by `getByLabel` — web does NOT map `accessibilityState` to `aria-checked`, `:280-285`, so assert on the swapped TEXT). Assert: (a) header text becomes **"Weekly hard sets per muscle"** (a specific string that PROVABLY changes — teeth, not a tick count); (b) the y-axis renders a count tick — assert the chart shows the integer `"3"` for the Chest peak (3 working sets) AND that the kg-only string `"500"` (= 100×5, the tonnage peak that would show in kg mode) is ABSENT after the swap. This asserts a SPECIFIC value that changes with the metric, per the standing e2e-teeth lesson — not the auto-thinned tick COUNT.
- **New test "6. dropset row excluded from the sets count":** seed 2 working + 1 dropset Bench Press sets in the same week; toggle to sets; assert the Chest peak reads **"2"** (working-only), not "3". This is the e2e teeth for Invariant D. (If asserting the exact axis value proves flaky on the thinned SVG axis, fall back to asserting the chart's max-tick label text equals "2" — still a specific value, still has teeth.)

## Riscos
- **Data integrity** — `LOW confidence of issue / LOW risk`. No DB write, no migration, no SELECT change. The whole feature is a derived read over the already-fetched `WeeklyVolumeRow[]`. `set_type` is confirmed present in the SELECT (`stats.ts:35`) and on the type (`stats.ts:23`) — the containment claim has no hidden plumbing. The 6 shared `useLifetimeWeeklyVolume` consumers (progress, history list, week drill-down, verdict, strip, hero) are untouched because the SELECT is unchanged.
- **Refactor-without-regressing-tonnage (Invariant T)** — `MEDIUM/MEDIUM`. The scaffold extraction is the one real risk: any divergence in the moved body silently corrupts the SHIPPED tonnage chart (and, via the strip/hero/verdict, multiple surfaces). Mitigation: the 14 existing tonnage tests are the executable spec and must pass unchanged; the wrapper passes the verbatim `:123` predicate + `:130` contribution; the deepEqual anchor pins the aggregate. **Top thing I want the Validator to scrutinize** (below).
- **UX regressions** — `LOW/LOW`. The kg path is byte-for-byte unchanged (Invariant T). The toggle adds a control above the chart; `visible` line-selection is shared and persists across the flip in the common case. The one edge: a muscle present in tonnage (working+dropset rows) but ABSENT in sets (only dropset rows) flips `seriesKeysSig` → reseeds visibility to all-on (R-4) — consistent with the existing refetch-reseed (`:71-75`), not a new failure mode.
- **Intentional divergence (Invariant D)** — `HIGH confidence / MEDIUM risk if mis-implemented`. Tonnage counts working+dropset rows (w>0&&r>0); hard-sets counts working-only. A naive `metric` flag that branched ONLY the accumulator (not the include-predicate) would WRONGLY count dropset rows as hard sets. The scaffold parameterizes BOTH the include-predicate and the contribution precisely to make this divergence explicit and testable (unit case 4, e2e case 6). Validator should confirm the include-predicate is parameterized, not just the accumulator.
- **Platform-specific** — `LOW/LOW`. `<MultiSeriesChart>` renders integer series identically (y-min 0, caller `formatValue`). The segmented control reuses the `<ProgressWindowSelector>` idiom already shipping on web. Web `accessibilityState` does NOT map to `aria-checked` (`:280-285`) — the e2e asserts on swapped TEXT and the active class, not `aria-checked`.
- **Performance** — `LOW/LOW`. Sets is strictly cheaper than tonnage (no `effectiveWeightKg`/`resolveBw` — `needsLoad:false`). Toggling recomputes ONE model (memo branches on `metric`); O(rows), sub-ms for realistic datasets.

## Alternativas descartadas
1. **`metric: "tonnage"|"sets"` flag on the existing signature, branch only at the accumulator** — descartada porque it cannot express the divergent include-predicate (Invariant D) without smuggling a second branch in anyway, AND it would carry the dead `measurements`/bodyweight args into the sets path (a U1 trap — an Implementer could re-introduce the `w>0` guard). The scaffold captures the DRY win without the dead args.
2. **Fully independent sibling `presentWeeklyHardSetsByMuscle` that duplicates the axis/attribution/emit code** — descartada porque ~90% duplication means feature #2 (fractional secondary attribution, U6) would have to edit attribution in TWO places; the shared scaffold makes U6 a single-site change by construction.
3. **Separate `<WeeklyHardSetsSection>` stacked below tonnage (two charts)** — descartada porque the LOCKED U2 decision is a toggle on the ONE existing chart, sharing line-selection; two charts would duplicate the legend + visibility state and not share the "isolate Chest across metrics" affordance.
4. **Compute BOTH models every render, swap on toggle without recompute** — descartada porque it doubles the per-render work for a view only one of which is shown; branching the single memo on `metric` is cheaper and the toggle recompute is sub-ms.
5. **Fold dropsets into their parent working set (the memo's original lean)** — descartada porque it requires `parent_set_id` (NOT on `WeeklyVolumeRow`; `stats.ts:34-36`), which would widen the shared SELECT (breaking 6-consumer containment) AND depends on unverified historical parent linkage. SUPERSEDED by the human's LOCKED U3 = count working-only (no dropset count at all), which needs zero plumbing.
6. **Persist the metric choice (stored preference)** — descartada porque LOCKED U9 = ephemeral default-kg, mirroring the line-selection + window-selector idioms (all non-persisted).
7. **`formatValue = (v) => v.toFixed(0)` for sets** — descartada in favor of `Math.round(v)` (identical for integers but explicit about intent; both avoid fractional tick labels). Marginal; either is acceptable to the Implementer.

## Out of scope
- Removing or altering the tonnage metric (LOCKED: augment, not replace; Invariant T preserves it byte-for-byte).
- Widening the `stats.ts` SELECT / changing `WeeklyVolumeRow` (not needed — `set_type` already present; widening would touch 6 shared consumers).
- Feature #2 (fractional secondary-muscle attribution) — only ensure the sets reduce SHARES the `muscles[0]` attribution path (via the scaffold) so #2 lands once (U6).
- Any migration / new column — hard sets is a derived count over existing rows (latest migration `0021`, unchanged).
- kg/lbs unit conversion on the sets axis — a set count is unitless (LOCKED).
- Persisting the toggle across navigation/sessions (LOCKED U9 ephemeral).
- The fold-dropset-into-parent algorithm (superseded by LOCKED U3 working-only).

## Top 1-2 things I most want the Validator to scrutinize
1. **Invariant T (the refactor must not regress tonnage).** Confirm the scaffold extraction moves the body verbatim and the wrapper's include-predicate `(w,r)=>w>0&&r>0` + contribution `(w,r)=>w*r` reproduce today's `:123`/`:130` exactly — and that the 14 existing tonnage tests are the binding spec that stays green unchanged. This is the one change that can silently corrupt SHIPPED surfaces (strip/hero/verdict all read the same rows, though only this section reads the per-muscle presenter).
2. **Invariant D — the include-predicate must be parameterized, not just the accumulator.** Confirm the dropset-exclusion (working-only) is enforced by the sets `include` closure (`row.set_type === "working"`), so the same `dropset` row that contributes to tonnage contributes 0 to hard-sets — and that unit case 4 + e2e case 6 actually pin a dropset row being EXCLUDED (count differs between the two metrics on the identical row set).
