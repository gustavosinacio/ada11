# Implementation — 2026-06-03_2217_hard-sets-per-muscle

Based on: `design-v1.md` (approved) and `validation-v1.md` (GO — 0 blockers / 1 major / 4 minors). MAJ-1 + MIN-1/2/3/4 handled below.

## Files changed
- `src/utils/weekly-muscle-volume.ts` (edited) — Extracted the internal `bucketByMuscleWeek(...)` scaffold (shared axis/window/attribution/emit) parameterized by a `RowMetric` (per-row INCLUDE-predicate + per-row CONTRIBUTION + `needsLoad`). Re-expressed `presentWeeklyVolumeByMuscle` as a thin wrapper (Invariant T — verbatim `w>0&&r>0` predicate + `w*r` contribution). Added the exported sibling `presentWeeklyHardSetsByMuscle(...)` (working-only, `contribute:()=>1`, `needsLoad:false`, signature OMITS `measurements`) + the `WeeklyMuscleHardSetsModel` type alias.
- `src/components/weekly-muscle-volume-section.tsx` (edited) — Added ephemeral `metric: "kg"|"sets"` state (default kg, not persisted). Rendered the kg↔sets segmented toggle mirroring `<ProgressWindowSelector>`. Branched the single model memo on `metric` (sets branch passes no `measurements`). Swapped the header label + `formatValue` (sets → integer/unitless via `Math.round`; kg → `formatVolume`). Added a stable `testID="weekly-muscle-peak"` `<Text>` peak caption (the MAJ-1 non-SVG handle).
- `tests/unit/weekly-muscle-volume.test.ts` (edited) — Extended `mkRow` to accept an optional `set_type` (default `"working"`). Added the T-anchor deepEqual case (MIN-4) at the end of the tonnage block + a new `describe("presentWeeklyHardSetsByMuscle")` with 9 cases (S-1..S-8b). The 13 existing tonnage cases are UNCHANGED.
- `tests/e2e/weekly-muscle-volume.spec.ts` (edited) — Parameterized `seedFinishedSession` with an optional `setType` (default `"working"`; one set_type per call — MIN-3). Added test 5 (kg↔sets toggle swaps header + peak caption: kg peak `"Peak 1,500 kg"` for 3 sets @ 100×5 → 3×500=1500 with the en-US thousands comma; MIN-1 full `"1,500 kg"` string asserted absent after swap) and test 6 (dropset-divergence: 2 working + 1 dropset across TWO same-week calls → `"Peak 2 sets"` present, `"Peak 3 sets"` absent — MAJ-1 teeth).

**Confirmed NO change (hard constraints honored):** `src/api/stats.ts` (`set_type` already in SELECT `:35` + on the type `:22`), `src/utils/bodyweight.ts`, `src/components/multi-series-chart.tsx`, any kernel, any migration (latest `0021`, unchanged). Feature #2 (fractional secondary attribution) NOT built.

## Deviations from design

1. **Added a `testID="weekly-muscle-peak"` peak-value `<Text>` caption to the section (not in design-v1's snippet).** This is the resolution of the Validator's MAJ-1 must-fix, not a free scope addition. MAJ-1 flagged that the e2e teeth (especially test 6, the only end-to-end proof of Invariant D) rested on querying a `react-native-svg` `<SvgText>` y-tick — a surface NO existing spec queries and whose values are fractional-rounded/ambiguous (`Math.round((range/4)*i)`). MAJ-1's suggested fix (b) was: "the Implementer adds a `testID` to the chart's peak/top-tick so the Tester can assert a stable handle." I implemented exactly that, choosing a non-SVG `<Text>` caption (the `testID` precedent in this repo is `weekly-strip-scroller` at `weekly-volume-strip.tsx:273`, asserted by `chart-scroll-week-selector.spec.ts:360`). The caption reads `"Peak 500 kg"` (kg) / `"Peak 3 sets"` / `"Peak 2 sets"` (sets) and is computed over the VISIBLE series' max — so it reads honestly with the metric toggle AND with line-selection. This gives both e2e tests teeth that are independent of whether `getByText` can see SVG `<text>` on web (the residual MAJ-1 raised). It is also genuinely useful UX (the chart had no numeric readout of its peak). Justification: directly satisfies MAJ-1; minimal footprint (one `<Text>` in the existing header row); no behavior change to the presenters.

No other deviations. The scaffold extraction moves the pre-refactor body verbatim; the wrapper predicate/contribution are byte-identical to the old `:123`/`:130` seam.

## Soft callbacks made (during this implementation pass)
- None. The design + validation were decision-dense enough to implement without escalation; the one judgment call (MAJ-1 handle shape) was authorized by MAJ-1's own suggested fix (b) and recorded as Deviation 1. Soft-callback budget intact (2/2).

## Quality gates
- [x] `npm run typecheck` passed — 0 errors. Run after the presenter refactor, after the section edits, after the unit-test edits, and at the end. (NOTE: no `replace_all` was used — every edit was surgical/uniquely-anchored, so no shadow-rename risk; typecheck was still run after each logical batch.)
- [x] `npm run lint` passed — 0 errors, 1 pre-existing warning (`.expo/types/router.d.ts`, auto-generated, baseline-unchanged).
- [x] Relevant unit tests pass — `npx vitest run` → **515/515** (baseline 505 + 10 new in `weekly-muscle-volume.test.ts`: 1 T-anchor + 9 sets cases S-1..S-8b). The 13 existing tonnage `it()` cases are UNCHANGED and green (`weekly-muscle-volume.test.ts` now has 23 `it()` blocks: 13 tonnage + 1 T-anchor + 9 sets).
- [x] No new `any` — grep-clean (`: any`/`as any`/`as unknown` = 0) across all 4 touched files.
- [x] No new `// @ts-ignore` — grep-clean (no `@ts-ignore`/`@ts-expect-error`/`eslint-disable`).
- [x] No stray `console.log` — none in source; the 4 `console.log` in the e2e are the `[screenshot]` lines matching the established `weekly-muscle-volume.spec.ts` convention (tests 1, 4, 5, 6).

Did NOT run playwright/e2e (the Tester runs it). Did NOT run git commit/add or deploy.

## Tonnage byte-for-byte confirmation (Invariant T)
The refactor moves the presenter body verbatim into `bucketByMuscleWeek`; the only seam change is the lazy `needsLoad`-gated load computation + the `metric.include`/`metric.contribute` indirection. The tonnage wrapper passes `needsLoad:true`, `include:(_,w,r)=>w>0&&r>0` (old `:123`), `contribute:(_,w,r)=>w*r` (old `:130`). The 13 existing tonnage unit cases pass UNCHANGED (empty input, muscles[0] attribution, zero-fill multi-week, "Other" routing, MUSCLE_GROUPS+Other order, bodyweight `(bw+addedLoad)*reps`, dangling skip, all-zero-drop, single-week, W-0 Invariant-W param-equivalence, W-1 axis-shrink, W-2 muscle-drops-out, W-3 boundary). Plus the new T-anchor (`presentWeeklyVolumeByMuscle` over a 4-row fixture including a dropset row that tonnage INCLUDES) pins the absolute series numbers `Chest [500,0,1100]`, `Legs [0,0,600]` and the `YYYY-Www` axis keys.

## Invariant-S cases (the load-irrelevant divergence)
- **S-2 (KEY DIVERGENCE):** a bodyweight working set `weight:"0", reps:10, equipment:"bodyweight"` with NO weigh-in (no `measurements` arg) COUNTS as `[1]` in sets mode, while the SAME row under tonnage drops to `[]` (effectiveWeightKg→0). This is the executable proof the `w>0` guard was correctly dropped.
- **S-3 (U4):** a `reps:0` working row AND a `reps:null` working row both COUNT → `[2]`.
- **S-4 (Invariant D):** 1 working + 1 dropset (both `w>0,r>0`, same muscle/week) → sets count `[1]` (working-only), while the SAME rows under tonnage count BOTH → `[1140]` (500+640). The divergence is pinned on the identical row set.
- S-1 (count per muscle/week + zero-fill `[1,0,3]`), S-5 (muscles[0] attribution + "Other" as counts), S-6 (dangling skip), S-7 (empty input), S-8a/S-8b (windowed parity — pre-window excluded, threshold boundary inclusive).

## MAJ-1 / MIN handling
- **MAJ-1 (must-fix):** e2e test 6 re-framed to assert the NAIVE row-count `"Peak 3 sets"` is ABSENT and the working-only `"Peak 2 sets"` is PRESENT, anchored on the awaited "Weekly hard sets per muscle" header (absence-because-correct distinguished from absence-because-not-loaded). The teeth target is the stable `testID="weekly-muscle-peak"` `<Text>` handle (Deviation 1), NOT an SVG `<SvgText>` y-tick. The seed uses TWO `seedFinishedSession` calls into the same ISO week (2 working + 1 dropset) per MIN-3.
- **MIN-1:** the tonnage-absence assertion in test 5 targets the FULL string `"1,500 kg"` (formatVolume suffix + en-US thousands comma), not bare `"1500"`/`"500"`.
- **MIN-2:** acknowledged — the existing tonnage suite has 13 `it()` cases (design said 14); the "stay green unchanged" claim holds.
- **MIN-3:** the dropset divergence seed is two `seedFinishedSession` calls into the same week (the helper sets one `set_type` per call); the `setType` param defaults `"working"`.
- **MIN-4:** the T-anchor deepEqual is kept despite overlapping the W-0 case — it pins absolute numbers, not just param-equivalence.

## Notes for Reviewer / Tester
- **Reviewer — top scrutiny (per design):** (1) confirm `bucketByMuscleWeek` moves the pre-refactor body verbatim and the tonnage wrapper's `(w,r)=>w>0&&r>0` / `(w,r)=>w*r` reproduce the old `:123`/`:130` exactly — the 13 unchanged tonnage tests + the T-anchor are the binding spec. (2) Confirm Invariant D is enforced by the sets `include` closure (`row.set_type==="working"`), not just the accumulator — so a dropset row contributes to tonnage but 0 to sets (S-4 pins this on identical rows). (3) Confirm the sets path never reaches `resolveBw`/`effectiveWeightKg`: `needsLoad:false` gates the entire load block, and the sibling signature has no `measurements` arg to feed it.
- **Reviewer:** the peak-caption `testID` handle (Deviation 1) is the MAJ-1 resolution — please confirm it reads over the VISIBLE series (so it stays honest under line-selection) and that the kg/sets label swap matches the `formatValue` swap.
- **Tester (MAJ-1 close-the-loop):** the e2e teeth now target `getByTestId("weekly-muscle-peak").toHaveText(...)`. Please PROVE test 6 fails if the dropset is wrongly counted (e.g. flip the sets `include` to `() => true` locally and confirm the peak reads "Peak 3 sets" → assertion RED). Seeds use "Bench Press" (Chest), already proven-green in tests 1/2/3 of this same spec — no new canonical-catalog row introduced. The peak-caption text format is `"Peak {n} set"` (n===1) / `"Peak {n} sets"` (else) for sets, `"Peak {formatVolume(...)}"` (e.g. `"Peak 1,500 kg"`) for kg — note formatVolume's en-US thousands comma.
