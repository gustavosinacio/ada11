# Validation v1 — 2026-06-03_1402_bodyweight-leverage-factors

## DECISION: **NO-GO** (round 1 of 3)

- **Blockers:** 0
- **Majors:** 2
- **Minors:** 4

Decision rule: **2 majors → no-go** (playbook). Both majors are design-recoverable in a cheap v2 (one is a wiring-completeness miss the design's own "closed-set proof" asserts is impossible; the other is the R-2 type-shape decision that the design left explicitly *unresolved* and routed to the Implementer as a guess). Per my standing calibration: when a design's central correctness claim is *self-contradicted by the codebase* (MAJ-1) or *left as an unmade product/type decision the Implementer would have to guess* (MAJ-2), a no-go + a tight v2 round is cheaper than shipping the guess. See "Decision reasoning" at the end.

Round budget: this is round 1/3 — a no-go is well within budget and does not trigger budget-exhaustion.

---

## R-2 — the top-priority verdict (DEFINITIVE)

**Verdict: the `number | null` typing the design ships in its primary contract (design-v1.md:48,66-82,98,191) is WRONG and must be replaced with the string-aware shape (the design's own Alternative #3) BEFORE/AT implementation. This is MAJ-2.**

I could not run the live numeric-shape probe — the sandbox correctly blocked escalating to the service-role key to bypass RLS (anon reads of `sets`/`measurement_entries` return `[]` by RLS design, so the live value is not anon-readable). **I did not work around that block.** But the empirical read is unnecessary: the **codebase already settles R-2 decisively, statically, with zero ambiguity.** Every `numeric` column in this app that PostgREST returns is typed `string | null` and `parseFloat`d at the seam:

| Column | Drizzle type | App type | Evidence |
|---|---|---|---|
| `sets.weight` | `numeric("weight",{precision:6,scale:2})` `schema.ts:164` | `weight: string \| null` | `db/types.ts:246`, `stats.ts:19` (`weight: string \| null`), `parseFloat` at `bodyweight.ts:31`, `volume-target.ts:123,165,254` |
| `sets.rpe` | `numeric("rpe",{precision:3,scale:1})` `schema.ts:165` | `rpe: string \| null` | `db/types.ts:247` |
| `measurement_entries.weight_kg` | `numeric(...)` `schema.ts:207` | `weight_kg: string \| null` | `db/types.ts:261`, `parseFloat(m.weight_kg)` at `bodyweight.ts:73`, `measurements-chart.ts:30` |
| `routine_exercise_sets.target_weight` | `numeric(6,2)` | `target_weight: string \| null` | `db/types.ts:211` (comment: `numeric(6,2) — kg, internal`) |
| all `measurement_entries` body metrics | `numeric(...)` `schema.ts:208-216` | `string \| null` | `db/types.ts:262-269` |

This is a **uniform, intentional, codebase-wide convention** (`db/types.ts:93-95`: *"the Supabase JS client returns columns as-is"*). `bodyweight_factor numeric` will return as the JSON string `"0.64"`. The design's primary contract types it `number | null` and gates on `Number.isFinite(factor)` (design-v1.md:78) — and `Number.isFinite("0.64") === false` ⇒ **coalesce to 1.0 ⇒ the factor is silently dropped ⇒ push-ups stay at full bodyweight ⇒ the entire feature does nothing**, while every proposed unit test (using number literals `0.64`/`1.0`) stays green. This is the exact silent-false-green the design itself flagged as "the #1 thing to verify" (design-v1.md:108-109, R-2) — but it then shipped the wrong typing in the contract anyway and deferred the decision to the Implementer. That is the defect: the design *names* the risk but *adopts the unsafe option* as its primary.

**Required shape (the design's Alternative #3, now mandatory — not optional):**
- `WeeklyVolumeRow.exercises.bodyweight_factor: string | null` (NOT `number | null`) — `stats.ts:28,98`.
- `ExerciseRow.bodyweight_factor: string | null` (NOT `number | null`) — `db/types.ts`. (Matches every other numeric on `ExerciseRow`'s sibling row types.)
- `SetBodyweightInput.factorByExerciseId: Map<string, number | string>` OR keep `Map<string, number>` but `parseFloat` at the build site (the build site reads `exercise.bodyweight_factor` which is now a string).
- `effectiveWeightKg(..., factor?: number | string | null)` doing `parseFloat` internally:
  ```ts
  const f = (() => {
    if (factor == null) return 1;
    const n = typeof factor === "string" ? parseFloat(factor) : factor;
    return Number.isFinite(n) ? n : 1; // coalesce-to-1.0-NEVER-0 preserved
  })();
  ```
  (A stored literal `"0"` → `parseFloat` → `0` is still honored as a deliberate value, preserving the design's "stored finite 0 is honored" note at design-v1.md:86,296.)

**Tests must have teeth (R-2):** the factor unit cases (design edge cases 1-10) MUST assert with **STRING** inputs — `effectiveWeightKg("bodyweight","0",80,"0.64") === 51.2`, `effectiveWeightKg("bodyweight","0",80,"1.0") === 80`, plus a non-finite-string case `effectiveWeightKg("bodyweight","0",80,"abc") === 80` (coalesce to 1.0). A number-literal test (`0.64`) would pass under EITHER typing and is a false-green — it would not catch the very bug R-2 describes. At least one cross-surface case (edge 12) must thread the STRING `"0.64"` end-to-end (ROW path `row.exercises.bodyweight_factor = "0.64"`, MAP path, prop path) and assert one number.

Confidence: **HIGH** (5 in-repo numeric columns, all string-typed, all parseFloat'd; the convention is documented in `db/types.ts:93-95`). The only residual is the theoretical chance PostgREST is configured to return *this one* numeric differently — but it uses the same PostgREST instance and the same client, so the convention holds. The string typing is the safe choice REGARDLESS: if the value somehow arrived as a number, `typeof factor === "string"` is false and the number path runs unchanged. The string-aware seam is strictly safer with zero downside.

---

## Per-claim verification table

| # | Claim (design ref) | Verdict | Evidence (file:line) |
|---|---|---|---|
| 1 | Seam: bodyweight branch `bw*f + addedLoad`; `f` coalesces NULL/non-finite→1.0 never 0; addedLoad never scaled; 3-arg call ⇒ f=1 ⇒ byte-for-byte | **VERIFIED (with R-2 caveat)** | `bodyweight.ts:26-40` current body is `bw + addedLoad`; design's `f = factor != null && Number.isFinite(factor) ? factor : 1` is the identity at f=1. Arithmetic is correct; the *typing* of `factor` is wrong (MAJ-2). |
| 1b | Existing `bodyweight.test.ts:44-94` stay green | **VERIFIED** | All 14 cases call with 3 args (`:46-93`); omitted 4th ⇒ `f=1` ⇒ identical. The legacy-`"Bodyweight"` (`:82-84`) and machine-0 (`:73-74`) cases never reach the multiply. |
| 2 | All 14 `effectiveWeightKg` call sites enumerated; no N+1th *volume* site; e1RM excluded | **VERIFIED** | Grep of `effectiveWeightKg` returns exactly the 14 sites in the table (volume-target ×3, progress-page-math ×5, weekly-muscle ×1, strip ×1, use-progress-page ×1, progress.tsx ×1, history/week ×1, exercise-session-row-format ×1). Negative-space grep (`parseFloat(weight)`/`epley1RM`) finds only the 2 e1RM paths + the in-kernel `else` fallbacks already listed. No 15th volume site. |
| 2b | e1RM paths EXCLUDED, untouched | **VERIFIED** | `progress.tsx:195-202` `const w = set.weight ? parseFloat(set.weight) : 0; epley1RM(w,r)` is a SEPARATE variable from the volume `effW` at `:206` (Phase-0 MAJ-2 two-variable split). `e1rm-strength.ts:14-17,146-150` logged-weight only. The factor reaches neither. |
| 2c | `useMemo` dep add (`bodyweight_factor`) at `progress.tsx:242` doesn't change e1RM | **VERIFIED** | Deps at `:242` are `[progressQ.data, measurementsQ.data, exercise.data?.equipment, unit, windowStartMs]`. Adding `bodyweight_factor` is required for the volume reduce to recompute; the e1RM branch reads no factor so its output is invariant. |
| 3 | MAP build site is `volume-target-slot.tsx:63-90`; factor rides full `ExerciseRow` on `exercise-block.tsx`; ONLY 2 `SetBodyweightInput` builders | **REFUTED — see MAJ-1** | `volume-target-slot.tsx:63-90` IS the `computeVolumeTarget` builder (VERIFIED `:65-67,80,94`). `exercise-block.tsx:19` `exercise: ExerciseRow`, mount at `:245-252` (VERIFIED). BUT the "only 2 `SetBodyweightInput` builders" claim (design-v1.md:140) is **FALSE**: there are **6** equipment-map/`SetBodyweightInput` builders — see MAJ-1. |
| 4 | Migration 0021: nullable numeric, idempotent, `WHERE user_id IS NULL AND deleted_at IS NULL`; 0021 free; 7 exact names | **VERIFIED** | `0021` is free (latest is `0020_user_exercise_favorites.sql`). DDL `add column if not exists` + by-name idempotent UPDATEs with the canonical WHERE clause mirror `0014`. **R-5 LIVE-VERIFIED:** all 7 names match exactly one canonical row each (query below). |
| 5 | R-1 retroactive shift called out; locked U3; nothing *breaks* | **VERIFIED** | Migration comment (design-v1.md:218-223) + R-1 (`:302`) call it out; state.md:44 (U3) locks it. Live query confirms the 3 are `equipment=null` today → reclassify makes them count `bw*factor*reps` retroactively. No surface *breaks* (it's a number shift, not a crash) — see MIN-4 on one surface to watch. |
| 6 | SELECT widen + `!inner` row-preservation unchanged; 8 ROW-fed sites read `row.exercises?.bodyweight_factor` | **VERIFIED** | `stats.ts:32-34` `exercises!inner(equipment)` → adding a column to an existing embed does not change join cardinality. All ROW-fed sites read `row.exercises?.equipment` (`progress-page-math.ts:88,190,233,310,393`, `weekly-volume-strip-math.ts:91`, `use-progress-page.ts:296`, `history/week:105`) ⇒ `row.exercises?.bodyweight_factor` rides identically. |
| 7 | `api/exercises.ts` uses `select("*")` ⇒ free column on ExerciseRow sites; write path NOT touched | **VERIFIED** | `select("*")` at `exercises.ts:14,24,39,52`. `createExercise:67-73` + `updateExercise:86-91` use explicit field lists with NO `bodyweight_factor` and the design correctly leaves them untouched (U2). |
| 8 | Identity/scope: no UI/zod/write change; e1RM untouched; addedLoad never scaled; non-bw never reads factor | **VERIFIED** | Non-bodyweight branch (`bodyweight.ts:39` `return addedLoad`) never reaches the multiply. addedLoad added after `bw*f`. No `index.tsx`/`new.tsx`/`ExerciseInput` change in the design. |

---

## R-5 — LIVE catalog verification (read-only anon query, project `ykrbgpctbfvndxjnpzrg`)

Query (anon client, `user_id IS NULL AND deleted_at IS NULL`, `name=in.(...)`) returned **exactly 7 rows**, one per design name:

| name (exact) | equipment today | migration action |
|---|---|---|
| Chest Dip | `null` | reclassify → bodyweight, factor 1.0 |
| Chin-up | `bodyweight` | factor 1.0 |
| Dip | `bodyweight` | factor 1.0 |
| Hanging Knee Raise | `null` | reclassify → bodyweight, factor 0.50 |
| Hanging Leg Raise | `bodyweight` | factor 0.50 |
| Pull Up | `null` | reclassify → bodyweight, factor 1.0 |
| Push-up | `bodyweight` | factor 0.64 |

**Every name matches exactly one canonical row. Zero name misses.** The 3 currently-`null` rows (Chest Dip, Hanging Knee Raise, Pull Up) are precisely the design's reclassify set (migration step 2, design-v1.md:229-231). The 4 already-`bodyweight` rows match the design's existing-bodyweight set. R-5 is **RESOLVED — clean**. The Implementer's mandatory pre-apply verification query (design-v1.md:259-270) is still good hygiene (the catalog could drift before apply), but as of this validation the names are exact.

---

## Issues

### MAJOR

**MAJ-1 — The "closed-set proof for the MAP path" is FALSE: 4 un-wired `SetBodyweightInput` builders (design-v1.md:130-140).**
*Severity: major. Location: design-v1.md:140 ("There is no third `SetBodyweightInput` builder") + the wiring table (design-v1.md:53-57).*

The design claims the only two `SetBodyweightInput` / `equipmentByExerciseId` builders are `volume-target-slot.tsx` (MAP) and `makeBwInput` (prop). **A grep of `equipmentByExerciseId|SetBodyweightInput|computeVolumeTarget(` proves there are six.** The four MISSED builders all construct `{ equipmentByExerciseId, bodyweightKg }` and feed `sumLiveVolume` / `computeCurrentSessionVolumeByExercise` / `sumPastVolume`:

1. `app/(app)/workout/[sessionId].tsx:96-115` — live workout **session header total**: builds `equipmentByExerciseId`, passes inline `{ equipmentByExerciseId, bodyweightKg }` to `sumLiveVolume`.
2. `app/(app)/workout/verdict/[sessionId].tsx:58-92` — **end-of-session verdict + PR detection**: builds `setBodyweightInput = { equipmentByExerciseId, bodyweightKg }` (`:75-78`), passes to BOTH `sumLiveVolume` (`:81`) AND `computeCurrentSessionVolumeByExercise` (`:88-89`).
3. `app/(app)/history/[id].tsx:210-221` — **History session-detail total**: builds `equipmentByExerciseId`, passes inline to `sumLiveVolume`.
4. `src/utils/session-verdict-math.ts:36-52` (`computeCurrentSessionVolumeByExercise`) — takes `bw?: SetBodyweightInput`, calls `sumLiveVolume(group, bw)`.

Why this is a real defect, two failure modes depending on how the Implementer types `factorByExerciseId`:
- **If `factorByExerciseId` is REQUIRED on `SetBodyweightInput`** (as the design types it, design-v1.md:114-118 — non-optional): these 4 sites **fail to compile** (missing property), AND the test fixtures `session-verdict-math.test.ts:658-661,708-711` (literal `{ equipmentByExerciseId, bodyweightKg }`) **fail to compile**. The design tells the Implementer the close-set is complete, so they would hit these as surprise compile errors and have to improvise the wiring (where does the factor come from at the live-workout header? — answer: `useAllExercises` rows carry `bodyweight_factor` via `select("*")`, so a parallel `factorByExerciseId` map built in the same useMemo, mirroring the equipment map — but the design does not say this).
- **If the Implementer makes `factorByExerciseId` OPTIONAL to dodge the compile errors**: these 4 surfaces (live header, verdict total, PR detection, history-detail total) silently use **un-leveraged full-bodyweight numbers**, while the Progress page / strip / muscle chart / history-week (which the design DID wire) use leveraged numbers. That **breaks the "same number everywhere" invariant** (`bodyweight.ts:5-9`): a push-up's bodyweight volume would be `80×reps` on the verdict/header but `51.2×reps` on Progress. This is the exact class of miss that took the Phase-0 run two rounds (the un-wired 14th kernel + the un-wired 2nd `groupSessionVolumes` caller) — and my standing lesson is "a fixed function is not fully fixed until ALL its call sites are wired."

Suggested fix (v2): extend the wiring table to all 6 `SetBodyweightInput` builders. For sites 1-3, build a parallel `factorByExerciseId` in the same useMemo that builds `equipmentByExerciseId`, sourced from the `useAllExercises` rows' `bodyweight_factor` (`for (const e of exercisesQ.data) { if (e.bodyweight_factor != null) factorMap.set(e.id, parseFloat-or-number(e.bodyweight_factor)); }`). For site 4 (`session-verdict-math.ts`), no change beyond the `SetBodyweightInput` type — it forwards `bw` opaquely, so it's automatically correct once callers pass the field. Update the closed-set proof to "6 builders, all wired." Implementer must re-grep to confirm no 7th.

Note: the design's *14-site `effectiveWeightKg` inventory* IS complete and correct (claim 2 verified) — these 4 builders feed kernels (`sumLiveVolume`) that are already IN that inventory, but the design only traced the kernel **definitions**, not the **`SetBodyweightInput` construction sites** that feed them. The conflation of "all kernel call sites" with "all input builders" is the root of the miss.

**MAJ-2 — Primary contract ships the unsafe `number | null` typing for the `numeric` factor; must be `string`-aware (R-2). See the R-2 section above for the full verdict + required shape + teeth-bearing tests.**
*Severity: major. Location: design-v1.md:48,66-82,98,116,191; the design *flags* R-2 (`:108-109,303,313`) but adopts the unsafe option as its primary contract and routes the decision to the Implementer as a guess.*

This is a major (not a blocker) because: the production seam is recoverable with a small, well-specified type change (the design's own Alternative #3), and the change is strictly safer with zero downside. It is not a minor because: shipped as-typed, the feature **silently does nothing** (the highest-stakes failure mode for this feature) and the proposed number-literal tests would NOT catch it (false-green). It must be resolved in the contract before the Implementer writes code, not left as a runtime probe — the codebase evidence is decisive enough to commit to the string typing now.

### MINOR

**MIN-1 — Cross-surface consistency test (edge case 12) must use the STRING shape AND now cover all 6 builder surfaces.** *design-v1.md:299, test plan.* The design's case 12 threads `0.64` (number) through MAP/ROW/prop. Post-MAJ-1 + MAJ-2 it should thread `"0.64"` (string) and add the verdict/live-header path. Otherwise the "one number everywhere" assertion has no teeth against either the string-drop (R-2) or the un-wired-surface desync (MAJ-1). (Folded into MAJ-1/MAJ-2 fixes; flagged so the Tester names the surfaces.)

**MIN-2 — `WeeklyVolumeRow.exercises` widening breaks every test fixture that builds `exercises: { equipment }`.** Once `stats.ts:28` becomes `{ equipment: string; bodyweight_factor: string | null }`, every `mkRow` helper / fixture (`session-verdict-math.test.ts:639`, and any in `weekly-volume-bucketing.test.ts` / progress-page-math tests) that builds `exercises: { equipment: "bodyweight" }` becomes a TS error (missing `bodyweight_factor`). Not a design defect — a heads-up the Implementer must update fixtures. The field should be added as `bodyweight_factor: null` to existing fixtures (preserving their `f=1` semantics byte-for-byte) and `"0.64"`-style to new ones. Cite the re-run surface so the Tester confirms no regression.

**MIN-3 — NULL-no-default vs `default 1.0`: SOUND, agreed.** *design-v1.md:253, Alternative #2.* The design's reasoning (NULL = honest "unset" sentinel; avoids writing meaningless `1.0` to ~95 rows incl. non-bodyweight; read-time coalesce makes NULL == 1.0) is correct. My independent check: a `default 1.0` would additionally make every *new user-owned* row carry `1.0` — harmless (non-bodyweight ignores it) but semantically noisier. NULL is the right call. No change. (Listed as a minor only to record the explicit assessment, not as a defect.)

**MIN-4 — One migration (reclassify + backfill atomic): SOUND, agreed; one surface to watch.** *design-v1.md:319, Alternative #9.* Atomic is correct — splitting risks a window where a reclassified row has no factor (still safe, NULL→1.0, but two migrations). One nuance for R-1: the 3 reclassified movements (`Pull Up`, `Chest Dip`, `Hanging Knee Raise`) currently count **zero** bodyweight volume, so after the migration they will *appear* on the per-muscle chart / strip / PR surfaces where they were previously absent (not just "shift" — a *new* contribution). This is the locked U3 intent and does not break any surface (the kernels already `continue` on `w<=0`, and a now-`bodyweight` row with bw>0 simply starts contributing). No fix; flagged so the Tester/Reviewer expects the *appearance* of new data, not only changed numbers, for those three.

---

## Items I explicitly assessed and found SOUND (no issue)

- **NEVER-0 coalesce (R-3):** the guard `factor != null && Number.isFinite(factor) ? factor : 1` (and its string-aware variant) coalesces NULL/NaN/±Infinity to 1.0, never 0. Correct and catastrophe-avoiding. The "stored finite 0 is honored" note (design-v1.md:86) survives `parseFloat("0")=0`. VERIFIED sound.
- **addedLoad never scaled:** `bw*f + addedLoad`, not `(bw+addedLoad)*f`. Matches U4 + the prompt formula. Edge cases 2 & 4 (design-v1.md:289,291) assert it. Sound.
- **`!inner` join unchanged:** adding `bodyweight_factor` to the existing `exercises!inner(equipment)` embed cannot change row cardinality (same join, one more projected column). Row-preservation identical to Phase-0. Sound.
- **e1RM exclusion (Invariant D):** the two-variable split at `progress.tsx:195-208` and the logged-weight-only `e1rm-strength.ts` guarantee the factor never reaches `epley1RM`. The design correctly does not touch either. Sound. (Test: the e1RM-unchanged regression — design edge 11 — is worth keeping, but note it's near-tautological since the factor never enters those code paths; its value is as a *guard against future drift*, which is fine.)
- **`select("*")` free column for ExerciseRow sites (#9, #12):** verified at `exercises.ts:14,24,39,52`. Sound.
- **No CHECK constraint:** correctly deferred (only guards the out-of-scope write path). Sound.

---

## Decision reasoning (against the playbook rule)

Mechanical rule: 0 blockers + 2 majors → **no-go**.

I considered whether either major could be downgraded to land a go-with-must-fix:
- **MAJ-1 is not a minor:** it is a wiring-completeness break on 4 surfaces, two of which are user-facing volume readouts (live workout header, end-of-session verdict + PR detection). Shipping it forces the Implementer to either fight surprise compile errors (the design told them the set was closed) or — worse — silently desync four surfaces from the rest of the app, re-breaking the very "same number everywhere" invariant this feature depends on. This is the canonical Phase-0 two-round miss; catching it in design is the cheap path.
- **MAJ-2 is not a minor:** the design adopts the typing that makes the feature *silently no-op*, and the tests it proposes would not catch it. This is a contract decision the design must own before implementation, not a runtime probe deferred to the Implementer.

Neither is a blocker (no crash, no ship-stopper, no data destruction — both recoverable in a tight v2). But two design-level majors, both touching central correctness (factor delivery + factor typing), warrant the no-go + v2 round. This is round 1/3 — ample budget. A v2 that (a) extends the wiring table to all 6 `SetBodyweightInput` builders and re-proves the closed set, and (b) commits the contract to the string-aware shape with teeth-bearing string tests, will be a clean go.

---

## Recommendation to Conductor

- **status:** done
- **output_path:** `docs/runs/2026-06-03_1402_bodyweight-leverage-factors/validation-v1.md`
- **decision:** **no-go**
- **counts:** `{ blockers: 0, majors: 2, minors: 4 }`
- **recommendation:** invoke Designer for re-design (v2). Required v2 deltas: (1) MAJ-1 — extend the wiring table + closed-set proof to all **6** `SetBodyweightInput`/`equipmentByExerciseId` builders (`workout/[sessionId].tsx:96-115`, `workout/verdict/[sessionId].tsx:58-92`, `history/[id].tsx:210-221`, `session-verdict-math.ts:36-52`, plus the 2 already covered), specifying how `factorByExerciseId` is built at each (parallel map from `useAllExercises` rows' `bodyweight_factor`); (2) MAJ-2 — commit the contract to `bodyweight_factor: string | null` (ExerciseRow + WeeklyVolumeRow), `effectiveWeightKg(..., factor?: number | string | null)` with internal `parseFloat`, and STRING-input unit tests with teeth (incl. a non-finite-string case + a string cross-surface case). R-5 is already clean (no action) — the 7 names verified exact against the live catalog.
