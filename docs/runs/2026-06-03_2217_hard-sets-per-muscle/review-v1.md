# Review v1 — 2026-06-03_2217_hard-sets-per-muscle

Reviewing: the working-tree diff for the implementation against `design-v1.md` (approved) + `validation-v1.md` (GO + MAJ-1 + MIN-1..4).

## Decision

**pass** — 0 blockers / 0 majors / 2 minors. The refactor preserves tonnage byte-for-byte (Invariant T verified by source trace + 13 unchanged tests + the new T-anchor), the sets divergence is enforced on the INCLUDE-predicate (Invariant D/S verified with teeth-bearing unit cases that contrast the same row set against tonnage), the section toggle is ephemeral/shared/non-stale, and the Deviation-1 peak caption is a correct, in-spirit MAJ-1 resolution. Both minors are a runtime-confirmation hand-off (default weight unit) and a cosmetic edge (uncheck-all peak reads "0") — neither a regression. The Validator's MAJ-1 is verified CLOSED with teeth; MIN-1/MIN-3 verified addressed.

## Diff scope
- Diff command: `git diff 80621ba` (working tree; HEAD == baseline `80621ba`, changes uncommitted — confirmed via `git status --short`).
- Files changed: 4 feature files (+713 / −48). Pre-existing screenshot PNG noise in OTHER runs' folders excluded (not part of this run, per `state.md:12-13`).
  - `src/utils/weekly-muscle-volume.ts` (+132 / −17)
  - `src/components/weekly-muscle-volume-section.tsx` (+116 / −27)
  - `tests/unit/weekly-muscle-volume.test.ts` (+~322 add-only)
  - `tests/e2e/weekly-muscle-volume.spec.ts` (+138 / −1)

## Gates re-run by the Reviewer (NOT trusted from implementation.md)
- `npm run typecheck` → **0 errors**.
- `npm run lint` → **0 errors, 1 pre-existing warning** (`.expo/types/router.d.ts`, auto-generated, baseline-unchanged).
- `npx vitest run tests/unit/weekly-muscle-volume.test.ts` → **23/23** (13 tonnage unchanged + 1 T-anchor + 9 sets S-1..S-8b).
- `npx vitest run` (full suite) → **515/515** — matches the Implementer's claim; no cross-file regression from the refactor.

## Verification of implementation.md claims
| # | Claim | Verified? | Evidence |
|---|---|---|---|
| 1 | Scaffold body = pre-refactor body verbatim (Invariant T) | **yes** | Diffed `git show 80621ba:…weekly-muscle-volume.ts` against current. The axis derivation (`:101-116`), window guard at BOTH loop heads (`:104-107` + `:140-143`), week-index (`:118-120`), libById/validMuscles (`:122-124`), `resolveBw` per-session memo (`:128-134`), dangling skip (`:147`), `muscles[0]` attribution (`:149-151`), emit + drop-all-zero (`:173-185`), empty-rows (`:99`), empty-weeks (`:116`) are byte-identical. ONLY the per-row seam changed: the old `bw/w/r` + `if(!(w>0&&r>0))continue` + `values[idx]!+=w*r` became the `needsLoad`-gated lazy block + `metric.include`/`metric.contribute` indirection (`:153-170`). |
| 2 | Tonnage wrapper reproduces `:123`/`:130` exactly | **yes** | `weekly-muscle-volume.ts:218-222` — `include:(_row,w,r)=>w>0&&r>0`, `contribute:(_row,w,r)=>w*r`, `needsLoad:true`. The wrapper computes the SAME `w`/`r` (under `needsLoad:true`) and feeds them to the same predicate+contribution → identical math, same row order → identical `resolveBw` memo population. |
| 2 | 13 existing tonnage unit cases UNCHANGED | **yes** | `git diff` on the unit file shows the only `-` line is the diff header itself; the `mkRow` `set_type` add defaults to `"working"` (was hardcoded `"working"`) → every pre-existing row is byte-identical. The 13 tonnage `it()` blocks (`:93-304` + W-0..W-3 `:310-482`) are untouched and green. |
| 3 | Sets `include = set_type==="working"`, `contribute=()=>1`, NOT `w>0&&r>0` | **yes** | `weekly-muscle-volume.ts:255-258`. The `w>0&&r>0` guard lives ONLY inside the tonnage closure (`:220`) → not inherited. |
| 3 | Sets path NEVER calls `effectiveWeightKg`/`resolveBw`; sibling OMITS `measurements` | **yes** | Sibling signature (`:242-247`) has no `measurements` param; passes `measurements:[]` to the scaffold (`:252`), but `resolveBw`/`effectiveWeightKg` are gated behind `if (metric.needsLoad)` (`:158`) and `needsLoad:false` (`:256`) → the entire load block is skipped. Structurally unreachable. |
| 3 | bodyweight weight=0 working row COUNTS; reps=0/null working row COUNTS | **yes (with teeth)** | Unit S-2 (`:581-615`): bodyweight `weight:"0"`, no weigh-in → sets `[1]`, AND contrast asserts tonnage `[]` on the SAME row. S-3 (`:617-638`): `reps:0` + `reps:null` working rows → `[2]`. Both are TRUE-teeth (if the guard leaked, S-2 → `[]` and `toHaveLength(1)` FAILS; S-3 → fails). Not false-greens. |
| 3 | dangling-skip + window guard + `muscles[0]` apply to sets | **yes** | Shared scaffold — sets calls the same `bucketByMuscleWeek`. Pinned by S-5 (`muscles[0]`+Other), S-6 (dangling), S-8a/S-8b (window + boundary). |
| 4 | INCLUDE-predicate parameterized (not just accumulator); dropset → tonnage yes, sets no | **yes (with teeth)** | Unit S-4 (`:640-674`): 1 working + 1 dropset (both w>0,r>0) → sets `[1]`, tonnage `[1140]` (500+640) on the IDENTICAL row set. If only the accumulator were branched (`include:()=>true`), the dropset would count → sets `[2]` → assertion FAILS. The T-anchor (`:484-540`) pins the tonnage side: a dropset row contributes to `Chest [500,0,1100]`. |
| 5 | Ephemeral `metric` state (default kg), NOT persisted; shares `visible` Set | **yes** | `:56` `useState<"kg"\|"sets">("kg")` — no AsyncStorage/preference write. `visible` Set (`:84-94`) unchanged + shared across both metrics. |
| 5 | memo branches on `metric` (not compute-both); deps correct (no stale model) | **yes** | `:61-75` — single memo, `metric` in deps (`:75`). `measurements` in deps is harmless on the sets branch (not read there). No stale-model: every input that changes the model (`rows`, `exercises`, `measurements`, `windowStartMs`, `metric`) is a dep. |
| 5 | `formatValue` swap (sets integer/unitless; kg formatVolume) + header label | **yes** | `:114-123` — sets → `(v)=>`${Math.round(v)}``; kg → `formatVolume(v,unit)`. Header `:114-117`. `useMeasurements` (`:51`) only feeds the kg branch. |
| 5 (Dev-1) | peak caption computes over VISIBLE series; unit tracks the kg↔sets swap | **yes** | `:129-137` — loop skips `!visible.has(s.key)`, takes max; label is `"N set(s)"` (sets, with `Math.round` + singular/plural) or `formatVolume(peakValue,unit)` (kg). Tracks the toggle correctly. testID `weekly-muscle-peak` is UNIQUE (grep: only `:184`). |
| 6 (MAJ-1) | e2e test 6 asserts naive count ("Peak 3 sets") ABSENT + correct ("Peak 2 sets") PRESENT, anchored on awaited header (not SVG tick) | **yes** | `weekly-muscle-volume.spec.ts:463-478` — awaits the "Weekly hard sets per muscle" header FIRST, then `peak.toHaveText("Peak 2 sets")` + `getByText("Peak 3 sets").toHaveCount(0)` on the stable `<Text>` testID handle. The Validator's MAJ-1 (untested SVG-tick surface) is CLOSED. |
| 6 (MIN-1) | kg-absence target is full `"1,500 kg"` (suffix + comma), not bare digits | **yes** | `:443,477` (test 5): `peak.toHaveText("Peak 1,500 kg")` then absence of `getByText("1,500 kg",{exact:true})`. `formatVolume(1500,"kg")` = `"1,500 kg"` confirmed (`units.ts:39`). |
| 6 (MIN-3) | dropset seed = TWO `seedFinishedSession` calls into the same week | **yes** | `:434-453` (test 6) — 2 working (call 1) + 1 dropset (call 2, `thisWeek+2h`, same ISO week). `seedFinishedSession` sets ONE `set_type`/call (`:125`); the `setType?` param defaults `"working"` so the 4 existing tonnage tests are unaffected. |
| 7 | NO stats.ts/`WeeklyVolumeRow`/kernel/migration change; no #2; no persisted toggle; no `any` | **yes** | `git diff` touches only the 4 feature files; no `.from()`/`.select()` change; no new `any`/`as unknown`/`@ts-ignore`/`eslint-disable` in the diff. `set_type` already in SELECT (`stats.ts:35`) + type (`stats.ts:22`). Latest migration `0021` unchanged. |

**All load-bearing claims verify against real source.** The architecture is sound; both load-bearing invariants are proven with teeth-bearing tests.

## Issues

### Blockers
- None.

### Majors
- None.

### Minors
- **[MIN-1]** `tests/e2e/weekly-muscle-volume.spec.ts:443,475` (+ `weekly-muscle-volume-section.tsx:137`): the kg peak assertions (`"Peak 1,500 kg"` in test 5, the kg branch generally) depend on the freshly-created e2e user defaulting to the **kg** weight unit. The peak caption reads `formatVolume(peakValue, unit)` where `unit = useWeightUnit()` — if a new user defaulted to `lbs`, `formatVolume(1500,"lbs")` would render `"3,307 lbs"` and the assertion would false-fail. This is a runtime/DB-state property the static review can't confirm, BUT it matches the precedent of the 4 existing tonnage tests in this SAME spec (which already assert `" kg"` strings, e.g. test 3's `"2,500 kg"`-class assertions) — so the default is almost certainly kg and the risk is LOW. Fix: none required (consistent with the spec's existing precedent); hand to the Tester to confirm the new user renders kg at runtime (see Tester hand-off T-1). Classified minor — it is a pre-existing assumption the new tests inherit, not a new defect.
- **[MIN-2]** `src/components/weekly-muscle-volume-section.tsx:129-137`: when the user unchecks ALL muscle lines, `peakValue` stays `0` → the caption reads `"Peak 0 sets"` (sets) / `"Peak 0 kg"` (kg). This is a benign cosmetic edge (no crash; the chart still renders its empty plot — the `model.series.length===0` early-return at `:108` does not fire because series exist, only their visibility is off). It reads slightly oddly but is honest ("0 visible peak"). Fix (optional): suppress the caption or show "—" when no series is visible (`allOn`-style guard). Not a regression; cosmetic only. Hand to the Tester to confirm the uncheck-all interaction does not error (T-2).

## Deviation assessed (Deviation 1 — the peak caption)
- **(a) Correctness:** the caption computes the peak over the VISIBLE series only (`:130-132` skips `!visible.has(s.key)`), and its unit/label tracks the kg↔sets swap (`:134-137`: `"N set(s)"` vs `formatVolume(...,unit)`). It uses `Math.round` consistently with the formatter (`:122`). **Correct.**
- **(b) Acceptable beyond the spec's toggle?** The design's UI snippet did not include a peak caption; the Implementer added it. **Acceptable — in-spirit, not overreach.** It is the EXACT resolution the Validator's MAJ-1 suggested-fix (b) prescribed ("add a `testID` to the chart's peak so the Tester can assert a stable handle"), recorded as Deviation 1 in `implementation.md:15` with justification. It follows the repo's `testID` precedent (`weekly-strip-scroller` at `weekly-volume-strip.tsx`), is a one-`<Text>` footprint in the existing header row, changes no presenter behavior, and is genuinely useful UX (the chart had no numeric peak readout). The alternative (querying `<SvgText>` y-ticks) was correctly rejected as untested + fractional-ambiguous. **Fine.**
- **(c) Edge case:** no-visible-series → "Peak 0 …" (see MIN-2). Empty data → the section returns `null` at `:107-108` before the caption renders (no crash). **Bounded.**

## Items I explicitly assessed and found SOUND
- **Invariant T including `resolveBw` memoization.** The moved body is byte-identical (source-diffed). The tonnage path still computes `resolveBw`→`w`→`r` in the SAME row order (rows are not reordered), so the per-`session_id` bw cache populates identically. The new "compute-under-`needsLoad`-then-`include`" structure reproduces today's "compute-then-guard" exactly for tonnage. The T-anchor (`:484-540`) pins absolute numbers `Chest [500,0,1100]`, `Legs [0,0,600]` — including a dropset row that tonnage INCLUDES — so a silent drift would go RED.
- **Warmup handling.** The server filters `.neq("set_type","warmup")` (`stats.ts:66,90`), so the presenter only ever sees `"working"`/`"dropset"` rows. The sets `include` (`set_type==="working"`) correctly excludes dropsets; warmups never arrive. The design's "warmup server-excluded" claim is verified at source.
- **Chart renders integer series unchanged.** `multi-series-chart.tsx:81` (`range = maxV`, y-min pinned 0), `:130` (`formatValue` caller-supplied applied to y-tick `v`). Integer values render identically; only the formatter differs. The `Math.round` in the sets formatter defends against the fractional intermediate ticks `(range/4)*i` (`:93`). The chart's "No data yet" branch is gated by the section's `model.series.length===0` early-return, so it cannot fire spuriously.
- **memo / visibility sharing / reseed edge.** Single memo branched on `metric` (cheaper than compute-both). The `visible` Set is shared; the R-4 reseed edge (a muscle present in tonnage but all-dropset in sets flips `seriesKeysSig` → reseed all-on) is consistent with the existing refetch-reseed (`:91-94`), not a new failure mode.
- **No new query surface / no fan-out.** Pure client-side derived read over the already-fetched `WeeklyVolumeRow[]`. SELECT unchanged → the 6 shared `useLifetimeWeeklyVolume` consumers are untouched. The presenter is consumed by exactly ONE production site (`weekly-muscle-volume-section.tsx`); `e1rm-strength.ts:11` only NAMES it in a doc comment.
- **e2e teeth structure.** Test 6's `"Peak 3 sets"` ABSENT + `"Peak 2 sets"` PRESENT on a stable non-SVG `<Text>` handle, anchored on the awaited header, is the correct teeth shape (absence-because-correct distinguished from absence-because-not-loaded). The Implementer's note to PROVE the assertion fails when the include is flipped to `()=>true` (`implementation.md:51`) is the right runtime close-loop.

## Security checklist
- [x] RLS / authorization: NO new query surface (pure client-side derived read over the already-fetched `WeeklyVolumeRow[]`; no `.from()`/`.select()`/`.insert()`/`.delete()` in the diff). No new table → no policy needed. `set_type` rides the existing SELECT (`stats.ts:35`).
- [x] No `SUPABASE_SERVICE_ROLE_KEY` / service-role token in client-bundled code (grep-clean in `src/`+`app/`; `SERVICE_ROLE` appears only in the e2e admin seed, test-only, never bundled).
- [x] No raw SQL / `.rpc()` / string concat of user input in the diff (no `.rpc(`/`raw(`/SQL template literal added).
- [x] No new `EXPO_PUBLIC_*` env vars.

## Style / convention checklist
- [x] No new `any` / `as any` / `as unknown` (grep-clean across the diff).
- [x] No new `// @ts-ignore` / `@ts-expect-error` / `eslint-disable`.
- [x] Comments narrate *why* (the `RowMetric.needsLoad` rationale + Invariant S/D/T, the lazy-load seam comment, the peak-caption "why non-SVG handle" comment, the `set_type` MIN-3 helper docstring) — not *what*.
- [x] Imports follow project style (`~/`-rooted, package-first; `SetType` from `~/db/types`).
- [x] No new files — both presenters live in the existing `src/utils/weekly-muscle-volume.ts`; the toggle in the existing section (design Alt: augment one chart, not a new component). Conventional placement.

## Decision

**pass**

Reasoning:
- 0 blockers + 0 majors → **pass** per the decision rule. The 2 minors are a runtime-confirmation hand-off (default unit, MIN-1) and a benign cosmetic edge (uncheck-all peak, MIN-2) — neither a regression.
- **Invariant T** (the gated risk) holds by construction: the scaffold body is byte-identical (source-diffed), the wrapper predicate/contribution reproduce the old `:123`/`:130` verbatim, the 13 existing tonnage cases are UNCHANGED and green, and the new T-anchor pins absolute numbers (including a dropset row tonnage includes).
- **Invariant D / S** are enforced on the INCLUDE-predicate (not just the accumulator) and proven with teeth-bearing unit cases (S-2 bodyweight-counts, S-3 reps-0/null-counts, S-4 dropset-excluded) that contrast the SAME row set against tonnage — a regression that leaked the guard or only branched the accumulator goes RED.
- **MAJ-1 (Validator carry-in) is CLOSED with teeth**: the e2e divergence proof now targets a stable `<Text>` peak caption, anchored on the awaited header, asserting the naive count ABSENT + correct PRESENT. MIN-1 (full `"1,500 kg"` string) and MIN-3 (two-call seed) are addressed.

### Tester hand-off notes
- **T-1 (MIN-1 close-loop):** confirm the freshly-created e2e user renders the **kg** unit at runtime (the `"Peak 1,500 kg"` assertion in test 5 + the kg-mode peak depend on it). If the default is lbs, both tests false-fail — but this matches the existing tonnage tests' kg assumption, so LOW risk. What a failure means: the default-unit preference drifted, not a feature bug.
- **T-2 (Dev-1 / MIN-2):** confirm the uncheck-all interaction does not error and the peak caption reads "Peak 0 …" gracefully (cosmetic; no crash expected since the section early-returns null only when series are absent, not merely hidden).
- **T-3 (MAJ-1 teeth proof, per `implementation.md:51`):** PROVE test 6 fails if the dropset is wrongly counted — flip the sets `include` to `() => true` locally and confirm the peak caption reads "Peak 3 sets" → assertion RED. Without this proof the e2e is decorative. The unit S-4 already pins Invariant D deterministically, so this is a runtime confirmation, not the sole guard.
- **T-4 (seed-name realness):** tests 5/6 seed via `pickCanonicalExercise(admin, "Bench Press")` — already proven-green in tests 1/2/3 of THIS same spec (no new canonical-catalog row introduced), so LOW risk; a `pickCanonicalExercise` throw at seed-time would mean the live catalog drifted.

No peer invocations — all claims settled by direct source verification + re-running the offline gates.
