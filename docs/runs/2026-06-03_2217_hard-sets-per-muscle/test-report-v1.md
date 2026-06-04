# Test report v1 — 2026-06-03_2217_hard-sets-per-muscle

Testing: implementation against `design-v1.md` (approved) + `review-v1.md` (PASS).

## Decision

**pass**

The hard-sets-per-muscle feature works end-to-end: the kg↔sets toggle swaps the per-muscle chart's header, y-axis, and peak caption; the sets count is the working-set count (not tonnage, not naive row count); dropsets are excluded (Invariant D, proven RED→GREEN at BOTH unit and e2e level); bodyweight working sets count (Invariant S). Tonnage is byte-for-byte unchanged (Invariant T) — 13 tonnage unit cases + the T-anchor + 48/48 sibling-spec regression all green. Both Reviewer minors (MIN-1/MIN-2) and all 4 Tester hand-offs (T-1..T-4) resolved with runtime evidence.

**Round-1 caveat (test-quality only, NOT a feature defect):** the two NEW e2e cases (5 and 6) initially failed for TEST-HARNESS reasons — an over-broad locator (test 5) and a schema-invalid dropset seed (test 6). I own test quality: I diagnosed both with a live runtime probe, fixed the spec, re-ran 6/6 green, and PROVED test 6's teeth via a RED→GREEN include-flip. The feature code was correct the whole time; no production change was needed or made.

## Environment
- Commands used to run app: `npm run web` (Expo web dev server, http://localhost:8081, health-checked `200` between batches)
- Browser / device: Playwright Chromium (headless), web build
- Test data: fresh per-test users seeded via service-role admin client; live project `ykrbgpctbfvndxjnpzrg`
- Baseline: `80621ba` (HEAD == baseline; feature uncommitted). No migration to apply (pure derived count).

## Static gates (all GREEN, re-run by Tester — not trusted from implementation.md/review)
| Gate | Result |
|---|---|
| `npm run typecheck` (`tsc --noEmit`) | **0 errors** |
| `npm run lint` (`expo lint`) | **0 errors, 1 pre-existing warning** (`.expo/types/router.d.ts`, auto-generated, baseline-unchanged) |
| `npx vitest run` (full suite, JSON-reporter authoritative) | **515 / 515 passed, 0 failed** (505 baseline + 10 new) across 139 files |
| `tests/unit/weekly-muscle-volume.test.ts` (file) | **23 / 23** (13 tonnage UNCHANGED + 1 T-anchor + 9 sets S-1..S-8b) |

The 13 existing tonnage unit cases are green and unchanged (Invariant T executable spec).

## T-3 teeth proof (REQUIRED) — RED→GREEN, both levels

The dropset-divergence proof was driven at BOTH the unit (deterministic) and e2e (live-surface) level by temporarily flipping the sets include-predicate in `src/utils/weekly-muscle-volume.ts:257` from `(row) => row.set_type === "working"` to `() => true` (count all rows), then reverting.

**Unit level (Invariant-D deterministic guard — case S-4):**
- Under the flip: `tests/unit/weekly-muscle-volume.test.ts` → **22/23, S-4 FAILED**: `AssertionError: expected [ 2 ] to deeply equal [ 1 ]` at `:663`. The dropset row was counted (2 instead of working-only 1). S-1/S-2/S-3 stayed green (working-only rows — correctly don't exercise the divergence).
- After revert: **23/23 GREEN**.

**E2E level (live rendered surface — test 6):**
- Under the flip: `weekly-muscle-volume.spec.ts -g "6. dropset"` → **FAILED**: `getByTestId('weekly-muscle-peak')` Expected `"Peak 2 sets"`, Received `"Peak 3 sets"` (the dropset got counted on the live rendered peak caption).
- After revert: **6/6 GREEN**.

A test that stayed green under the flip would be a false-green. Both go RED under the flip and GREEN after revert → genuine teeth. **The flip was reverted; the suite ends GREEN (verified: marker count 0 in source, line 257 restored to `row.set_type === "working"`, full unit suite 515/515).**

## Golden path
**Spec** (design): a kg↔sets toggle on `<WeeklyMuscleVolumeSection>` swaps the per-muscle chart between tonnage and a working-set count, default kg, ephemeral.

**Steps run** (e2e test 5 + live runtime probe):
1. Seed 3 working Chest sets @ 100×5 (weekly tonnage 1,500 kg, sets 3); sign in via UI; navigate to /progress.
2. Default (kg): header "Weekly volume per muscle"; peak caption `Peak 1,500 kg`; chart SVG y-ticks `["0 kg","375 kg","750 kg","1,125 kg","1,500 kg"]`.
3. Tap "Metric: hard sets": header → "Weekly hard sets per muscle"; peak caption → `Peak 3 sets`; chart SVG y-ticks → `["0","1","2","2","3"]` (integer, unitless).
4. (Implicit) Toggle back is the kg path which is byte-for-byte the pre-feature presenter (Invariant T).

**Result**: **pass**

**Observed sets value**: the sets number is the **working-set COUNT (3)**, NOT tonnage (1,500) and NOT a naive row count — confirmed both by the peak caption swap and by the SVG y-axis swapping from kg strings to integers. This was observed on the ACTUAL rendered surface via a runtime probe (since removed; evidence preserved below).

**Evidence** (runtime probe, before→after toggle, on the live web build):
```
PEAK BEFORE: Peak 1,500 kg
SVG <text> BEFORE: ["0 kg","375 kg","750 kg","1,125 kg","1,500 kg","01/06", <e1RM chart ticks ...>]
PEAK AFTER:  Peak 3 sets
SVG <text> AFTER:  ["0","1","2","2","3","01/06", <e1RM chart ticks ...>]
```
The muscle chart (the feature surface) swaps; the adjacent e1RM strength chart's ticks (`0.0 kg … 116.7 kg`) are unrelated and correctly unchanged.

## E2E results (`tests/e2e/weekly-muscle-volume.spec.ts` — full, 6/6 GREEN after spec fix)
| # | Case | Result |
|---|---|---|
| 1 | section renders; old per-session chart gone | **pass** (pre-existing tonnage) |
| 2 | check-all / uncheck-all toggles every line | **pass** (pre-existing tonnage) |
| 3 | per-muscle chip toggles a single line | **pass** (pre-existing tonnage) |
| 4 | bodyweight exercise feeds the chart (Phase-0 kernel) | **pass** (pre-existing tonnage) |
| 5 | kg↔sets toggle swaps header + peak caption | **pass** (after fix — over-broad locator) |
| 6 | dropset rows EXCLUDED from the sets count (Invariant D) | **pass** (after fix — schema-invalid seed) + teeth-proven |

Final run: `expected: 6, unexpected: 0, flaky: 0`. The 4 pre-existing tonnage tests passed unchanged at every run (Invariant T at the e2e level).

### Round-1 e2e failures — diagnosis + test-only fixes (Tester owns test quality)

**Test 6 — schema-invalid dropset seed (test-data defect, NOT a feature defect).** The original `seedFinishedSession` inserted a standalone `dropset` row with `parent_set_id = NULL`, which violates the `sets_parent_matches_type` CHECK constraint (`supabase/migrations/0000_schema.sql:67-68`: a `dropset` REQUIRES a non-null `parent_set_id`; `working`/`warmup` require NULL). The insert was rejected at the DB before the feature code ever ran (`Error: sets insert: new row ... violates check constraint "sets_parent_matches_type"`). **The Reviewer's MIN-3 verification ("two seedFinishedSession calls into the same week") could not catch this — it requires running against the real schema.** Fix: refactored `seedFinishedSession` to optionally append ONE dropset row in the SAME session, linked via `parent_set_id` to working set #1 (the schema-honoring pattern used by `auto-fill-placeholder-on-check.spec.ts`, `rest-timer-auto-start.spec.ts`, `routine-strong-builder.spec.ts`). Test 6 now seeds 2 working + 1 valid dropset in one session → `Peak 2 sets`, dropset excluded. Teeth proven (RED under the include-flip).

**Test 5 — over-broad page-wide locator (test-quality defect, NOT a feature defect).** The binding teeth (peak caption `Peak 1,500 kg` → `Peak 3 sets`) PASSED. The failure was the EXTRA negative assertion `getByText("1,500 kg", {exact:true}).toHaveCount(0)` — written on the false premise that "1,500 kg" appears ONLY in the muscle chart. A runtime probe proved otherwise: 5 other Progress-page surfaces legitimately render the same 1,500 kg weekly total and are NOT affected by the chart-local toggle:
```
MATCH[0..3] ctx="PRs this week 0 · Max 1,500 kg · Now 1,500 kg · To PR 0 kg ..."   (weekly-volume PR/hero strip)
MATCH[4..5] ctx="Chest · Bench Press · Best session 1,500 kg · Now 1,500 kg ..."   (exercise volume-target card)
```
These are correct, pre-existing surfaces — the toggle is scoped to the per-muscle chart by design. Fix: replaced the page-wide absence assertion with a caption-scoped one (`await expect(peak).not.toContainText("kg")`) — the same stable handle flips from a kg string to a set count, which is the actual divergence proof.

## Edge cases

### Edge 1 (Invariant S): bodyweight working set (weight=0, NO weigh-in) COUNTS
**Steps**: unit S-2 — a `equipment:"bodyweight"`, `weight:"0"`, `reps:10` working row, no measurements.
**Expected**: sets `[1]`; the SAME row under tonnage drops to `[]` (effectiveWeightKg→0).
**Actual**: sets `series[0].values === [1]`, tonnage `series === []`.
**Result**: **pass** (also live-confirmed by e2e test 4 — a bodyweight Chin-up line renders).
**Evidence**: `vitest` S-2 green; contrast pin in the same case.

### Edge 2 (Invariant D): dropset does NOT count — diverges from tonnage on identical rows
**Steps**: unit S-4 + e2e test 6 — 1 working + 1 dropset, both w>0,r>0, same muscle/week.
**Expected**: sets count 1 (S-4) / `Peak 2 sets` (e2e); tonnage counts BOTH (`[1140]` = 500+640).
**Actual**: matches exactly; goes RED under the include-flip (teeth proven).
**Result**: **pass**

### Edge 3 (U4): reps=0 / reps=null working rows COUNT
**Steps**: unit S-3 — a `reps:0` and a `reps:null` working row.
**Expected**: both count → `[2]`.
**Actual**: `series[0].values === [2]`.
**Result**: **pass**

### Edge 4 (MIN-2 / Dev-1 cosmetic — T-2): uncheck-all → "Peak 0 …", no crash
**Steps**: live probe — seed 3 sets, tap "Hide all muscles", read the peak caption (kg), then toggle to sets.
**Expected**: caption reads "Peak 0 kg" / "Peak 0 sets" gracefully; section stays mounted; no error.
**Actual**:
```
PEAK (all on):            Peak 1,500 kg
PEAK (uncheck-all, kg):   Peak 0 kg
PEAK (uncheck-all, sets): Peak 0 sets
```
Section header still visible; no crash; singular/plural correct ("sets" for 0).
**Result**: **pass** (benign cosmetic edge, exactly as the Reviewer predicted in MIN-2).

### Edge 5 (windowed parity — shared scaffold): pre-window row excluded, threshold inclusive
**Steps**: unit S-8a/S-8b — a pre-window working row + a boundary (===threshold IN, −1ms OUT).
**Result**: **pass** (the window guard is shared via the scaffold and honored by sets).

## Regression check (Invariant T + adjacent flows) — 48/48 across 9 sibling specs, 0 flaky
All run at the default window on the live web build, health-checked `200` before each batch. No OOM cascade.

| Spec | Result | Surface guarded |
|---|---|---|
| `e1rm-strength.spec.ts` | **3/3** | the chart that mounts beside the muscle chart (Invariant D for e1RM) |
| `progress-page.spec.ts` | **8/8** | the page that hosts `<WeeklyMuscleVolumeSection>` |
| `progress-window-selector.spec.ts` | **3/3** | the page-level window the section threads |
| `weekly-volume-strip.spec.ts` | **4/4** | shared `useLifetimeWeeklyVolume` consumer (tonnage) |
| `week-drill-down.spec.ts` | **5/5** | shared `useLifetimeWeeklyVolume` consumer |
| `max-volume-window.spec.ts` | **6/6** | shared window + tonnage |
| `end-of-session-verdict.spec.ts` | **2/2** | shared `WeeklyVolumeRow` pipeline (tonnage) |
| `volume-target.spec.ts` | **7/7** | tonnage surface (renders "1,500 kg" — Invariant T) |
| `session-total-volume-header.spec.ts` | **5/5** | tonnage / total-volume header |
| `read-only-history.spec.ts` | **5/5** | history list (shared rows) |

Plus the feature's own `weekly-muscle-volume.spec.ts` **6/6**. Grand total e2e: **54/54 across 11 specs, 0 flaky.** Invariant T holds: the tonnage (kg) numbers are byte-for-byte unchanged — proven by the 13 unchanged tonnage unit cases + the T-anchor (`Chest [500,0,1100]`, `Legs [0,0,600]`) + the green tonnage e2e surfaces above.

## Reviewer hand-offs — all resolved
- **T-1 (default kg unit):** **resolved** — the fresh e2e user renders `Peak 1,500 kg` (kg suffix) on first load (probe + test 5). Default unit is kg; the kg-mode assertions are valid.
- **T-2 (uncheck-all no crash):** **resolved** — `Peak 0 kg` / `Peak 0 sets`, section stays mounted, no error (Edge 4 probe).
- **T-3 (dropset teeth proof):** **resolved** — RED→GREEN at unit (S-4) AND e2e (test 6) under the include-flip; reverted, suite GREEN.
- **T-4 (seed-name realness):** **resolved** — live read-only catalog query on project `ykrbgpctbfvndxjnpzrg`: `Bench Press` → barbell, `muscles[0]="Chest"`; `Chin-up` → bodyweight, `muscles[0]="Upper back"`. Both resolve; no spec name fix needed.

## Invariants protected
- **Invariant T (tonnage byte-for-byte unchanged):** **held** — 13 tonnage unit cases + T-anchor green-unchanged; 4 tonnage e2e cases + all tonnage-reading sibling specs (strip, drill-down, verdict, volume-target, session-total-header) green. No per-muscle tonnage value shifted.
- **Invariant S (bodyweight working set counts; dropset does not):** **held** — S-2 (bodyweight weight=0 counts), S-4 (dropset excluded), live e2e test 6.

## Cross-platform
- **Web**: **pass** — Playwright Chromium + Expo web (the harness platform).
- **iOS**: **not tested** — web-only harness. Risk LOW: the change is a pure-TS presenter scaffold extraction + a `react-native-svg` `<MultiSeriesChart>` reused as-is (integer series render identically, y-min pinned 0, caller-supplied `formatValue`) + a segmented control reusing the `<ProgressWindowSelector>` idiom already shipping on iOS/Android. No native module, no new dependency, no migration (design R-platform LOW/LOW).
- **Android**: **not tested** — same reasoning as iOS.

## Test commands
- [x] `npm run typecheck` — 0 errors.
- [x] `npm run lint` — 0 errors, 1 pre-existing warning (router.d.ts).
- [x] `npx vitest run` — 515/515 passed (JSON reporter authoritative).
- [x] `npx playwright test` (feature spec + 9 sibling regression specs, partitioned) — 54/54, 0 flaky.

## Untestable / not-covered (disclosed, NOT marked pass)
- **iOS / Android** — web-only harness (Risk LOW, reasoning above).
- **R-4 reseed edge** (a muscle present in tonnage but all-dropset in sets flips `seriesKeysSig` → reseed visibility to all-on): not exercised end-to-end. The dropset-only-muscle dataset is structurally rare and the behavior is consistent with the existing refetch-reseed (`weekly-muscle-volume-section.tsx:91-94`). Verified-correct by code path; a coverage residual, not a miss.

## Decision

**pass**

Reasoning:
- Golden path works on the live rendered surface: the toggle swaps header + y-axis + peak caption; the sets value is the working-set COUNT (3), observed directly (not tonnage 1,500, not a naive row count).
- Invariant T holds byte-for-byte (13 tonnage unit cases + T-anchor + 48/48 sibling regression, 0 flaky).
- Invariant S/D proven with teeth at BOTH unit (S-4) and e2e (test 6) level — RED under the include-flip, GREEN after revert.
- All 4 Reviewer hand-offs (T-1..T-4) and both minors (MIN-1/MIN-2) resolved with runtime evidence.
- The two round-1 e2e failures were TEST-QUALITY defects (over-broad locator + schema-invalid dropset seed) that I diagnosed, fixed in the spec, and re-ran 6/6 green — the feature code was correct throughout, no production change made. The teeth flip was reverted; the suite ends GREEN.

Recommendation: **finalize**.
