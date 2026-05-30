# Review v1 — 2026-05-30_0126_bodyweight-volume-per-muscle

Reviewing: the working-tree diff for the implementation against `design-v2.md` (final approved) + the MAJ-3-NEW carry-in from `validation-v2.md`.

## Diff scope
- Diff command: working tree vs baseline `5a2382b` (HEAD == baseline; the change is uncommitted, so reviewed via `git status` + `git diff 5a2382b -- <path>` + direct file reads).
- Files changed: 33 (20 source edits + 1 deletion, 5 new source files, 6 unit-test edits + 2 new unit tests, 1 new e2e, `docs/features.md`).
- Lines: not committed; reviewed file-by-file.

## Quality gates (re-run by Reviewer, not trusted from implementation.md)
- `npm run typecheck` — **0 errors** (exit 0). Confirms Implementer's claim.
- `npm run lint` — **0 errors, 1 warning** in `.expo/types/router.d.ts` (auto-generated, baseline-unchanged; no source file flagged). Confirms Implementer's claim.
- `npm run test:unit` — **431 passed / 431** across 26 test files (exit 0). Confirms Implementer's claim (+47 over the 384 baseline). New: `bodyweight.test.ts` (21), `weekly-muscle-volume.test.ts` (9).

## Verification of the 10 review priorities

### 1. Single-kernel invariant — all 14 sites route through `effectiveWeightKg`; no 15th
Re-grepped every `* r` / `* reps` accumulation site in `src/` + `app/(app)` and traced each `w`/`eff`/`effW` to its source:

| # | Site | file:line | `w` source | OK |
|---|---|---|---|---|
| 1 | `sumPastVolume` | `volume-target.ts:120` (bw path) / `:125` (fallback) | `effectiveWeightKg` / `parseFloat` | yes |
| 2 | `sumLiveVolume` | `volume-target.ts:162` / `:167` | `effectiveWeightKg` / `parseFloat` | yes |
| 3 | `computeVolumeTarget` 3 spots | `volume-target.ts:246-274` | `effWeightOf` → `effectiveWeightKg` | yes |
| 4 | `bucketLifetimeWeeklyVolumes` | `progress-page-math.ts:88,91` | `effectiveWeightKg(row.exercises.equipment,...)` | yes |
| 5 | `computeCurrentWeekVolume` | `progress-page-math.ts:190,193` | `effectiveWeightKg` | yes |
| 6 | `computeLifetimeMaxPerExercise` | `progress-page-math.ts:233,240,243` | `effectiveWeightKg` | yes |
| 7 | `groupSessionVolumes` | `progress-page-math.ts:310,313` | `effectiveWeightKg` (own per-row reduce, MIN-NEW-1) | yes |
| 8 | `computePrsThisWeek` | `progress-page-math.ts:393,400,403` | `effectiveWeightKg` | yes |
| 9 | `computeStripModel` | `weekly-volume-strip-math.ts:91,94` | `effectiveWeightKg` | yes |
| 10 | per-exercise VOLUME (MAJ-2) | `progress.tsx:163,165` | `effW = effectiveWeightKg(equipment,...)` | yes |
| 11 | `presentSetVolumeLines` | `exercise-session-row-format.ts:132-133` / `:135` fallback | `effectiveWeightKg` / `parseFloat` | yes |
| 12 | `presentExerciseSessionRow` | `exercise-session-row-format.ts:63` → `sumPastVolume(…, makeBwInput)` | `effectiveWeightKg` | yes |
| 13 | `useExercisesThisWeek` nowKg | `use-progress-page.ts:296,301` | `effectiveWeightKg(r.exercises.equipment,...)` | yes |
| 14 | `weekVolumeKg` headline (MAJ-1) | `history/week/[isoWeek].tsx:105,107` | `effectiveWeightKg(row.exercises.equipment,...)` | yes |

`presentSessionVolumeChart` + `SessionVolumeChartSection` are fully removed (grep `src/ app/ tests/` = 0 references). No 15th `w*r` site exists. **Confirmed.**

### 2. Invariant A — byte-for-byte non-bodyweight
`src/utils/bodyweight.ts:26-40` — for non-bodyweight equipment returns exactly `addedLoad = (weight == null ? 0 : parseFloat(weight))`, NaN→0. Traced against the OLD predicate (`w = weight ? parseFloat(weight) : NaN; Number.isFinite(w) && w>0`):
- `weight = null` → old NaN→excluded; new addedLoad=0 → `0>0` false → excluded. Same.
- `weight = ""` → old `"" ? : NaN`→NaN→excluded; new `parseFloat("")`→NaN→0→excluded. Same.
- `weight = "0"` → both 0 → `>0` false → excluded. Same.
- `weight = "-5"` → both negative → `>0` false → excluded. Same.
- `weight = "abc"` (whitespace/garbage) → both NaN→0 → excluded. Same.

The bw-undefined fallback branches (`volume-target.ts:125,167`, `exercise-session-row-format.ts:135`, `makeSessionBwResolver` returns `()=>null`, the strip's `resolveBw` returns `null`) all keep the exact old `w = weight ? parseFloat(weight) : NaN` parse with `Number.isFinite` guard, OR feed `effectiveWeightKg(eq, weight, null)` which equals `addedLoad` for non-bodyweight. `effective > 0` ≡ old `w > 0`. **Invariant A holds.** Unit-asserted at `volume-target.test.ts:887`, `progress-page-math.test.ts:1671`, `exercise-session-row-format.test.ts:268`.

### 3. `bodyweightKgAsOf` correctness
`bodyweight.ts:60-96`: prior (`ms <= instantMs`, keeps latest) → later (`ms > instantMs`, keeps earliest) → null. Compares `parseISO(measured_at).getTime()` (UTC instant), no local-day rounding. Skips `weight_kg == null` and non-finite parses (`:72-74`). Order-independent (single scan with min/max tracking). Exact-instant tie counts as PRIOR (`ms <= instantMs`, `:78`) — matches design. **Confirmed.** All branches unit-tested incl. exact-instant tie (`bodyweight.test.ts:164`) and DESC order independence (`:151`).

### 4. MAJ-2 two-variable split (`progress.tsx:148-167`)
`const w = set.weight ? parseFloat(set.weight) : 0` drives `epley1RM(w, r)` under UNCHANGED `w > 0` guard (`:155-159`). Separate `const effW = effectiveWeightKg(equipment, set.weight, bw)` drives `sessionVolume += effW * r` under its own `effW > 0` guard (`:163-166`). e1RM is NOT bodyweight-aware. `maxVolumeKg`/`maxVolumeSession` read `sessionVolume` (now effective); window filter on `started_at` untouched (`:181-187`). `useMemo` deps include `measurementsQ.data` (`:199`). **Confirmed.** Invariant D divergence is structural in the code.

### 5. MAJ-3 carry-in — both `groupSessionVolumes` callers wired
- `app/(app)/history/index.tsx:25,30-32` — mounts `useMeasurements`, calls `groupSessionVolumes(weeklyVolumeData ?? [], measurements ? { measurements } : undefined)`. **Confirmed (the carry-in must-fix).**
- `app/(app)/history/week/[isoWeek].tsx:56,117-119` — mounts `useMeasurements`, calls `groupSessionVolumes(weeklyVolumeQ.data ?? [], measurementsQ.data ? { measurements: measurementsQ.data } : undefined)`. **Confirmed.**

Both callers pass `{ measurements }`. MAJ-3-NEW closed.

### 6. MIN-1 — three `computeVolumeTarget` current-weight spots
`volume-target.ts`: (1) selection gate uses `effWeightOf(s)` in the reduce (`:261-266`) so a bodyweight set with addedLoad=0 qualifies; (2) displayed `currentWeightKg = currentSet ? effWeightOf(currentSet) : null` (`:270`); (3) `repsToBeat = gapKg / currentWeightKg` uses the effective `currentWeightKg` (`:271-274`). `effWeightOf` is bodyweight-aware when `bodyweight` provided, else the byte-for-byte `parseFloat` (`:246-255`). **Confirmed.** Unit-asserted at `volume-target.test.ts:402` (bodyweight `currentWeightKg === 80`).

### 7. The 5 deviations — each safe
- **#1** `session.session_id` not `session.id` (`volume-target.ts:211`): `SessionSets` exposes `session_id` (`src/api/progress.ts:5`), NOT `id`. The design's `.id` was a field-name slip. **Correct.**
- **#2** 4th fixture builder migrated (`group-session-volumes.test.ts:42`): full `WeeklyVolumeRow` literal would have broken typecheck once `exercises` became required; identical `?? { equipment: "barbell" }` default. The Validator's "no other builders" was an incomplete enumeration; the extension is the same shape. **Correct & justified.**
- **#3** e2e chip toggle asserts `opacity-40` class not `aria-checked` (`weekly-muscle-volume.spec.ts:286-295`): follows the `set-row-menu.spec.ts:141-145` sibling precedent (react-native-web 0.21 doesn't translate `accessibilityState`→`aria-*`). Component keeps `accessibilityRole="checkbox"`+`accessibilityState` for native. **Correct.** (See note to Tester re: class-literal DOM dependency.)
- **#4** eager `0`-seed in `groupSessionVolumes` (`progress-page-math.ts:306`): `if (!out.has(row.session_id)) out.set(row.session_id, 0)` BEFORE the guards. Preserves all-warmup-session-appears (the 12 existing `group-session-volumes` tests still pass). No phantom sessions — only `session_id`s present in `rows` get an entry; in-progress sessions are absent from `rows` server-side. **Correct.**
- **#5** `liveSessionStartedAt` threaded through `<ExerciseBlock>` to `<VolumeTargetSlot>` (`exercise-block.tsx:94,250`, `volume-target-slot.tsx:27,76`): the slot needs the live session start to resolve live bw; the block didn't carry it. Optional prop, forwarded from the workout screen. **Correct.**

### 8. Per-row bodyweight memoization in multi-session WVR kernels
`makeSessionBwResolver` (`progress-page-math.ts:28-39`) and the inline resolvers in `weekly-volume-strip-math.ts:75-85`, `history/week/[isoWeek].tsx:93-100`, `use-progress-page.ts:280-290`, `weekly-muscle-volume.ts:81-87` all memoize per `session_id` (`Map<string, number|null>`), resolving `bodyweightKgAsOf(measurements, parseISO(started_at))` once per session — NOT per set, NOT collapsed to one bw for all sessions. **Confirmed — the correctness trap is avoided.**

### 9. Phase 1
- `presentWeeklyVolumeByMuscle` (`weekly-muscle-volume.ts`): zero-fill on shared `isoWeeksBetween` axis (`:69,109`); bucket by `completed_at`, bw by `started_at` (`:93,102`); `muscles[0]`→MuscleGroup else "Other" (`:98-100`); dangling exercise_id skip (`:96`); drops all-zero/absent series (`:117-121`); empty input → `{weeks:[],series:[]}` (`:57`). **Confirmed.**
- `<MultiSeriesChart>` (`multi-series-chart.tsx`): y-domain max across VISIBLE series, min pinned 0 (`:53-61,81`); 1-week → centered single dot (`:84-85` + Circle dots); empty-state when nothing visible/all-zero/no axis (`:68`). **Confirmed.**
- `<WeeklyMuscleVolumeSection>`: check-all/uncheck-all + per-chip toggle local `Set` state (`:61-71,97-109,128-135`); re-seed "all on" on series-set change via signature guard (`:60,67-71`) — standard render-phase state-adjustment idiom, loop-safe; 7 fixed colors + gray "Other" (`:28-37`). **Confirmed.**
- `presentSessionVolumeChart` removed from `progress-page-math.ts`; `session-volume-chart-section.tsx` deleted; `progress/index.tsx:7,70` swaps in `<WeeklyMuscleVolumeSection />`. **Confirmed.**

### 10. Quality gates + style
Gates re-run above (typecheck 0, lint 0 err, 431/431). No new `any` / `@ts-ignore` / `eslint-disable` in any new/edited source (grep clean; the two `as unknown as WeeklyVolumeRow[]` in `stats.ts:68,92` are PRE-EXISTING — not in the diff). No `console.log` in shipped source (the e2e `[screenshot]` log matches `progress-page.spec.ts` convention). **Confirmed.**

## Verification of implementation.md claims
| Claim | Verified? | Notes |
|---|---|---|
| 14 sites routed through `effectiveWeightKg` | yes | Table in priority 1 |
| `bodyweight.ts` NaN-safe + exact-instant prior | yes | `bodyweight.ts:31-37,78` |
| stats SELECT widened + `exercises:{equipment}` | yes | `stats.ts:28,32-34` |
| MAJ-2 split, e1RM logged-weight | yes | `progress.tsx:155-166` |
| MAJ-3 both callers `{ measurements }` | yes | `history/index.tsx:30`, `week/[isoWeek].tsx:117` |
| MIN-1 all three spots | yes | `volume-target.ts:261-274` |
| `groupSessionVolumes` own per-row reduce (MIN-NEW-1) | yes | `progress-page-math.ts:300-316` |
| Deviation #1 `session.session_id` | yes | `progress.ts:5` exposes `session_id` |
| Deviation #4 eager 0-seed | yes | `progress-page-math.ts:306` |
| typecheck 0 / lint 0 err / 431 unit | yes | Re-run by Reviewer |
| No new `any`/`@ts-ignore`/`console.log` | yes | grep clean |
| `docs/features.md` not moved to Done | partial | diff adds 8 lines to a NEW `## Open` block (deferred items); phases NOT moved to Done. Consistent with "finalize moves to Done" + deferred scope. See MIN-1 below. |

## Issues

### Blockers
- None.

### Majors
- None.

### Minors
- **[MIN-1]** `docs/features.md` (diff +8 lines): the diff introduces a `## Open` block with five deferred items (e1RM chart, favorites, leverage factors, secondary-muscle, dose-metric). This is correct deferral tracking, but the two SHIPPED phases (Phase 0 kernel + Phase 1 chart) are not yet recorded in `## Done`. implementation.md:82 states the Conductor moves entries at finalize — acceptable, flagging only so the Conductor does not forget the Phase 0/1 "## Done" entries at finalize. Documentary, non-blocking.
- **[MIN-2]** `weekly-muscle-volume.spec.ts:289,292,295` (e2e, test 3): asserts the chip's visibility state via `toHaveClass(/opacity-40/)`. This depends on react-native-web emitting the NativeWind `opacity-40` token literally in the DOM `class` attribute (the OFF branch at `weekly-muscle-volume-section.tsx:143`). It follows the `set-row-menu.spec.ts` sibling precedent, so the pattern is established — but it is a runtime-only assertion the Reviewer cannot statically confirm resolves to a stable DOM class. Hand-off to Tester (below). Robustness note, non-blocking.
- **[MIN-3]** `weekly-muscle-volume.ts:120` `values.every((v) => v === 0)` is effectively dead: a series only gets a `values` array allocated when ≥1 row produced `w>0 && r>0` for that key (`:107-111`), so an allocated series always has a non-zero value. The guard is harmless defensive code (and the JSDoc claims it drops all-zero series). Not a bug; flagging that the "drop all-zero" contract is actually realized by the "absent series never allocated" path, not this `.every` check. Cosmetic, non-blocking.

## Security checklist
- [x] RLS: the only query change is the widened `stats.ts` SELECT (`exercises!inner(equipment), sessions!inner(...)`) on the already-RLS-protected `sets`/`exercises`/`sessions` tables. `exercises` is owner-readable (`user_id is null or auth.uid()=user_id`); FK `ON DELETE restrict` + deleted_at-agnostic RLS make `!inner` provably row-preserving (Validator-verified). No new table, no migration.
- [x] No `SUPABASE_SERVICE_ROLE_KEY` / service-role token in shipped code — grep of `src/` + `app/(app)` = NONE; `SERVICE_ROLE` appears only in `weekly-muscle-volume.spec.ts:35` (e2e admin-seed, test-only, matches `progress-page.spec.ts` convention).
- [x] No raw SQL / `rpc` with user-string concatenation — all data access is parameterized PostgREST; the e2e admin inserts use the client builder, not string SQL.
- [x] `EXPO_PUBLIC_*` — no new public env vars introduced; the e2e reads existing `EXPO_PUBLIC_SUPABASE_URL`/`ANON_KEY` (anon-safe).

## Style / convention checklist
- [x] No new `any` (grep clean across all 14 changed/new source files).
- [x] No new `// @ts-ignore` / `@ts-expect-error` / `eslint-disable`. The two `as unknown as WeeklyVolumeRow[]` in `stats.ts` are pre-existing (not in the diff).
- [x] Comments narrate *why* — the JSDoc on `effectiveWeightKg`, `bodyweightKgAsOf`, `makeSessionBwResolver`, the MAJ-1/MAJ-2/Invariant-C/MIN-NEW-1 inline comments all explain rationale + the design decision IDs, not just what the line does.
- [x] Imports follow project style (`~/`-rooted package imports first, then components/hooks/utils; consistent with neighbors).
- [x] New files in conventional folders: `src/utils/bodyweight.ts`, `src/utils/weekly-muscle-volume.ts` (pure presenters in `utils/`); `src/components/multi-series-chart.tsx`, `src/components/weekly-muscle-volume-section.tsx` (in `components/`); tests in `tests/unit/` + `tests/e2e/`.

## Decision

**pass**

Reasoning:
- 0 blockers, 0 majors, 3 minors. Meets the pass rule (0 blockers and ≤1 major).
- All 14 kernel sites verified routing through `effectiveWeightKg`; no 15th reintroduced; the per-session-memoized per-row bodyweight resolution is correct everywhere (priority 8 trap avoided).
- Invariant A (byte-for-byte non-bodyweight) holds by construction and is unit-asserted; the carry-in MAJ-3-NEW is closed with BOTH `groupSessionVolumes` callers wired; MAJ-2 keeps e1RM logged-weight; MIN-1's three spots are all effective-weight.
- All 5 deviations are safe and justified (deviation #1's `session_id` corrects a real design field-name slip; #4's eager seed introduces no phantom sessions).
- Reviewer-re-run gates: typecheck 0, lint 0 errors, 431/431 unit. The 3 minors are documentary/robustness/cosmetic — none is a regression.

## Non-blocking hand-off notes for the Tester
1. **Invariant A e2e audit (design F-4, the load-bearing owner guarantee).** Audit each of the 8 volume e2e specs for the TWO conditions that keep numbers stable: (i) does the spec seed any `measurement_entries` row? (ii) does every seeded set carry an explicit positive `weight`? The 4 specs using `pickCanonicalExercise(admin)` with NO preferred name take the alphabetically-first canonical row, which COULD be a bodyweight catalog row (Pull-up/Chin-up/Dip/Push-up/Plank/Hanging Leg Raise) — confirm none of those 4 ALSO seeds a measurement. If both F-4 conditions hold (expected), non-bodyweight numbers don't move. Report per-spec, don't assume.
2. **MIN-2 — runtime-only class assertion.** `weekly-muscle-volume.spec.ts` test 3 asserts the chip toggles `opacity-40` in the DOM. This is statically unverifiable (depends on react-native-web NativeWind class emission). If it flakes, the sibling `set-row-menu.spec.ts:141-145` is the precedent to align against.
3. **Invariant B (bodyweight PR shift) is the irreversible-looking behavior.** A previously-recorded PR badge for a bodyweight exercise CAN vanish (or appear) once the kernel counts bodyweight. This is intended per owner Decision (a). Verify the create + erase cases empirically if exercising the verdict/PR surfaces with a bodyweight exercise + a seeded weigh-in.
4. **e2e "Pull-up" + "Bench Press" seed dependency.** `weekly-muscle-volume.spec.ts` relies on canonical "Pull-up" (bodyweight, primary Upper back) and "Bench Press" (barbell, primary Chest) existing in the seed; `pickCanonicalExercise` throws loudly if absent (clear error, not a UI timeout).
