# Validation v2 — 2026-06-03_1402_bodyweight-leverage-factors

## DECISION: **GO** (round 2 of 3)

- **Blockers:** 0
- **Majors:** 0 (both v1 majors RESOLVED — verified against source)
- **Minors:** 2 (1 new must-fix-for-the-Implementer + 1 cosmetic; carry forward, neither blocks)

Decision rule: **0 blockers + 0 majors → go** (playbook). The two v1 NO-GO majors (MAJ-1 un-wired builders; MAJ-2 string-aware contract) are both resolved with file:line-verified deltas, no new blocker/major appeared, and the v1-sound parts carried forward intact. MIN-NEW-1 (the MIN-2 fixture list is incomplete) is a real but mechanical, compile-deterministic gap — it does NOT force the Implementer to guess any semantics (the typecheck the design itself names as "the authority" surfaces every missed literal), so it is a go-with-must-fix, not a no-go override. Round 2/3 — no budget pressure (this GO closes the D↔V loop).

---

## MAJ-1 resolution — VERIFIED RESOLVED (the 6-builder closed set is truly closed)

**Verdict: RESOLVED.** I re-ran the design's mandated grep myself and independently confirmed there is no 7th `SetBodyweightInput` builder; all 6 are in the wiring table; sites 1–3's `useAllExercises` source carries `bodyweight_factor`.

### Independent re-grep (I did not trust the design's list)
`grep -rn "equipmentByExerciseId|SetBodyweightInput|computeVolumeTarget(|sumLiveVolume(|sumPastVolume(|computeCurrentSessionVolumeByExercise(" app/ src/` maps to exactly the 6 builders + the kernel internals:

| Builder | Site | Verified source |
|---|---|---|
| 1 — live workout header | `app/(app)/workout/[sessionId].tsx:96-115` | `:96-102` loops `exercisesQ.data ?? []` building `equipmentByExerciseId`; reduce at `:104-115` feeds `sumLiveVolume(setsQ.data, { equipmentByExerciseId, bodyweightKg })` `:111-114`. VERIFIED. |
| 2 — verdict total + PR detection | `app/(app)/workout/verdict/[sessionId].tsx:58-92` | `:58-64` loops `exercisesQ.data`; `setBodyweightInput` literal `:75-78` flows into BOTH `sumLiveVolume` `:81` AND `computeCurrentSessionVolumeByExercise` `:87-89`. One wiring fixes both. VERIFIED. |
| 3 — History session-detail total | `app/(app)/history/[id].tsx:200-223` | `:210-213` inline `equipmentByExerciseId` loop over `exercisesQ.data` inside the `totals` useMemo; feeds `sumLiveVolume(rows, { equipmentByExerciseId, bodyweightKg })` `:218-221`; deps already include `exercisesQ.data` `:223`. VERIFIED. |
| 4 — `computeCurrentSessionVolumeByExercise` | `src/utils/session-verdict-math.ts:36-52` | `bw?: SetBodyweightInput` (`:38`) forwarded opaquely into `sumLiveVolume(group, bw)` (`:48`). Type-only — auto-correct once site 2 passes the field. VERIFIED. |
| 5 — `<VolumeTargetSlot>` | `src/components/volume-target-slot.tsx:63-90` | `bodyweight` useMemo builds one-entry `equipmentByExerciseId` `:65-67`, feeds `computeVolumeTarget` `:94`. `factor` arrives from `exercise-block.tsx:245-252` (full `ExerciseRow`). VERIFIED. |
| 6 — `makeBwInput` | `src/utils/exercise-session-row-format.ts:79-88` | loops `sets`, `equipmentByExerciseId.set(...)` `:85-86`; feeds `sumPastVolume` via `presentExerciseSessionRow:63` / `presentSetVolumeLines`. VERIFIED. |

**No 7th builder.** The only other `sumLiveVolume` hit is `app/(app)/admin/index.tsx:394` — `sumLiveVolume(detailQ.data.sets)` with **no `SetBodyweightInput`** (the trailing `"kg"` is `formatVolume`'s arg, not the kernel's). It is a deliberate no-bw caller → `f` never enters → byte-for-byte unchanged. Correctly excluded. (The design does not name it as an excluded no-bw caller; that omission is harmless — see MIN-NEW-2.) The second `sumLiveVolume(setsQ.data ?? [])` at `workout/[sessionId].tsx:106` is the same file's pre-session-start no-bw fallback, also correctly bw-free.

### `useAllExercises` source confirmed in scope at sites 1–3
- `workout/[sessionId].tsx:21,74` `import { useAllExercises }` + `const exercisesQ = useAllExercises()`. VERIFIED.
- `workout/verdict/[sessionId].tsx:7,48` same. VERIFIED.
- `history/[id].tsx:22,55` same. VERIFIED.
- `useAllExercises` → `listAllExercises` → `select("*")` (`api/exercises.ts:36-44`), so `bodyweight_factor` rides those rows ⇒ a parallel `factorByExerciseId` map reading `e.bodyweight_factor` is buildable in the same loop that already reads `e.equipment`. VERIFIED.

### REQUIRED `factorByExerciseId` is consistent (anti-desync) — and forces the fixture updates
`factorByExerciseId` is REQUIRED on both `SetBodyweightInput` (design-v2:167-171) and `ComputeVolumeTargetInput.bodyweight` (`:174-179`). The compiler will flag any un-wired builder — exactly the structural guarantee that makes the MAJ-1 desync impossible to ship. **This is the correct, stronger choice.** Its necessary consequence: every test literal building these shapes MUST add `factorByExerciseId` or it won't compile. The design's MIN-2 list covers some but not all of them — see MIN-NEW-1.

---

## MAJ-2 resolution — VERIFIED RESOLVED (string-aware contract on every path)

**Verdict: RESOLVED.** No path lets a raw `numeric` string reach `Number.isFinite` un-parsed; the maps are `Map<string, number>` parsed at each build site; the read boundaries are both `string | null`; the tests assert with string teeth.

- **Seam** (`effectiveWeightKg`, design-v2:102-124): 4th param `factor?: number | string | null`; `factor == null ⇒ f=1`; `typeof factor === "string" ? parseFloat(factor) : factor` then `Number.isFinite(n) ? n : 1`. A raw `"0.64"` is `parseFloat`d INSIDE the seam → never hits `Number.isFinite` as a string. Coalesce-to-1.0-never-0 preserved; stored `"0"` honored (`parseFloat("0")=0`). VERIFIED against the contract + the current body at `bodyweight.ts:26-40` (the only delta is the `* f` multiply + the parse block; f=1 is the identity ⇒ Invariant L holds by construction).
- **Read boundaries both `string | null`:** `WeeklyVolumeRow.exercises.bodyweight_factor: string | null` (design-v2:141) and `ExerciseRow.bodyweight_factor: string | null` (`:271`). Matches the documented convention (`db/types.ts:93-95` "the Supabase JS client returns columns as-is") and the 5 sibling numerics already typed `string | null`. VERIFIED — the current `stats.ts:28` (`{ equipment: string }`) and `db/types.ts:162-179` (no factor today) are exactly the lines v2 widens.
- **Maps parsed at the build site, never a string in `Map<string, number>`:** all 6 build sites read a `string | null` (`e.bodyweight_factor` for sites 1–3 over `useAllExercises`; the `factor` prop for sites 5/6) and `parseFloat` BEFORE `set`, guarding `!= null` (and `Number.isFinite` in `makeBwInput`, design-v2:243-253). So a missing/garbage key is simply ABSENT from the map ⇒ `Map.get` returns `undefined` ⇒ seam coalesces to 1.0. No string slips into the map unparsed; no double-coalesce drops a legit value (the build-site parse and the seam coalesce act on disjoint inputs — the map only ever holds finite numbers or omits the key). VERIFIED.
- **Tests have string teeth:** edge cases assert with `"0.64"` (case 1), `"1.0"` (case 3), `"abc"`→1.0 (case 8), `"0"` honored (case 9), `null`/absent→1.0 (cases 6/7), defensive number (case 11). The cross-surface case 13 threads the STRING `"0.64"` through ROW / MAP / prop / verdict-live-header and asserts `512` on all four (MIN-1). A number-literal-only false-green is impossible. VERIFIED at design-v2:373-390.

---

## v1-sound parts — carried forward UNBROKEN (spot-checked, not re-litigated)

| Item | Status |
|---|---|
| Seam f=1 identity / Invariant L | Intact — the `* f` multiply with f=1 reproduces `bw + addedLoad`; 3-arg calls default `factor=undefined⇒f=1`. `bodyweight.test.ts:44-94` re-pass. VERIFIED. |
| addedLoad never scaled | `bw*f + addedLoad` (design-v2:121); cases 2/4 assert it. VERIFIED. |
| Migration 0021 slot free | latest on disk is `0020_user_exercise_favorites.sql`; `0021` free. No pre-existing `bodyweight_factor` anywhere in src/app/supabase. VERIFIED. |
| 7 exact catalog names | Unchanged verbatim from v1 (LIVE-VERIFIED clean last round). Per the prompt, NOT re-queried — no drift suspected. Pre-apply hygiene query kept. |
| e1RM untouched (Invariant D) | `progress.tsx:195-202` `const w = parseFloat(set.weight); epley1RM(w,r)` is a SEPARATE variable from the volume `const effW = effectiveWeightKg(...)` at `:206`; v2 adds the 4th arg only to `effectiveWeightKg`. `e1rm-strength.ts` untouched. VERIFIED. |
| NULL-no-default column | `add column ... numeric` nullable, no default; idempotent UPDATEs `WHERE user_id IS NULL AND deleted_at IS NULL`. VERIFIED (MIN-3). |
| Single atomic migration | reclassify + backfill in one file. VERIFIED (MIN-4). |
| `!inner` row-preservation | adding `bodyweight_factor` to `exercises!inner(equipment, bodyweight_factor)` projects one more column on the SAME join → cardinality identical to Phase-0. VERIFIED. |
| `select("*")` free column | `exercises.ts:14,24,39,52` — `bodyweight_factor` rides for free on ExerciseRow sites; `createExercise`/`updateExercise` field lists untouched (U2). VERIFIED. |
| No new scope | No UI/zod/write-path/Controller; factor gated to `equipment === "bodyweight"` only; no new fetch/hook. VERIFIED against the Out-of-scope + forbidding-clause sections. |

---

## Issues

### MINOR

**MIN-NEW-1 — the MIN-2 fixture-update file list is INCOMPLETE; four more test files will fail the typecheck.** *Location: design-v2.md:92-96 (the MIN-2 "known files" list) + the REQUIRED-`factorByExerciseId` decision :185-189.*

Because `factorByExerciseId` is REQUIRED on `SetBodyweightInput` AND `ComputeVolumeTargetInput.bodyweight`, and because `ExerciseRow`/`WeeklyVolumeRow.exercises` gain a required field, **every** test literal building these shapes is a hard compile error until updated. The design's named list (`session-verdict-math.test.ts`, `weekly-volume-bucketing.test.ts`, `progress-page-math.test.ts`) is correct but **omits four files** I found by grepping the whole `tests/` tree:

1. **`tests/unit/volume-target.test.ts:768,791,832,874,910`** — the MOST material omission: 5 `SetBodyweightInput` / `ComputeVolumeTargetInput.bodyweight` literals (`{ equipmentByExerciseId, liveBodyweightKg, pastBodyweightBySession }` at `:790-794` etc.) — all become "missing `factorByExerciseId`" errors. Fix: add `factorByExerciseId: new Map()` (f=1) to each.
2. **`tests/unit/e1rm-strength.test.ts`** — `mkRow(): WeeklyVolumeRow` (`:41` `exercises: { equipment: ... }`) AND `mkExercise(): ExerciseRow` (`:52-63`) — both break. Fix: `bodyweight_factor: null` in each builder.
3. **`tests/unit/weekly-muscle-volume.test.ts`** — `mkRow(): WeeklyVolumeRow` (`:38`) AND `mkExercise(): ExerciseRow` (`:48-59`) — both break. Fix: `bodyweight_factor: null`.
4. **`tests/unit/group-session-volumes.test.ts:42`** — `mkRow(): WeeklyVolumeRow` with `overrides.exercises ?? { equipment: "barbell" }` — the default literal breaks. Fix: `bodyweight_factor: null`.

Also, within the listed files the design under-enumerates the explicit override literals that ALSO break once the local types widen: `weekly-volume-bucketing.test.ts:249,270,290` (after widening `RowInput.exercises` `:49`) and `progress-page-math.test.ts:1657,1693,1706,1737,1750,1786,1799` (override literals checked against `Partial<WeeklyVolumeRow>`). The design's generic "the typecheck is the authority for any others" (`:96`) DOES disposition these correctly, but they should be expected, not surprises.

**Why this is a minor, not a major:** the fix is purely mechanical and compile-DETERMINISTIC — the design itself instructs the Implementer to run `npx tsc --noEmit` and "fix EVERY ... literal the compiler flags" (`:96`), which surfaces all four files and every literal as hard errors with an obvious one-line fix (`new Map()` / `: null`, both preserving f=1 byte-for-byte). It forces ZERO product-semantics guesses. It does not touch production code. It is flagged only because the prompt asked me to confirm the list is complete, and it is not — the Implementer must treat the design's named list as non-exhaustive and lean on the typecheck. **Must-fix-for-the-Implementer; tell the Tester the re-run surface is all 6 listed/added test files + the typecheck.**

**MIN-NEW-2 (cosmetic) — site-1 second-useMemo dep array + the un-named `admin/index.tsx` no-bw caller.** *Location: design-v2.md:70 (site 1 row); the closed-set proof :214.*

(a) `workout/[sessionId].tsx` builds the equipment map in one useMemo (`:96-102`, deps `[exercisesQ.data]`) and does the volume reduce in a SECOND useMemo (`:104-115`, deps `[..., equipmentByExerciseId]`). The design's "build `factorByExerciseId` in the same useMemo ... the dep array stays `[exercisesQ.data]` (both maps derive from it)" reads as intending both maps returned from the FIRST memo. That is the correct shape — but if the Implementer instead memoizes `factorByExerciseId` separately, the SECOND reduce's dep array (`:115`) must add it. Since both maps derive from the SAME `exercisesQ.data`, they update in lockstep regardless, so even a sub-optimal split is not a correctness bug — only a staleness foot-gun. Cosmetic; flag so the Implementer returns both maps from the one `:96-102` memo (cleanest).

(b) The closed-set proof names the 6 builders but does not record `admin/index.tsx:394` as a deliberately-excluded no-bw caller. Harmless (admin volume is bodyweight-unaware by design and stays byte-for-byte unchanged), but the Implementer's mandated post-finish re-grep WILL hit it — pre-naming it as "excluded, intentional" avoids a false alarm. Cosmetic.

---

## Items I explicitly assessed and found SOUND (no issue)

- **NEVER-0 coalesce (R-3):** NULL/`undefined`/`"abc"`/NaN/±Infinity ⇒ 1.0, never 0; stored finite `"0"` honored. Catastrophe-avoiding and unit-tested (cases 6–9). Sound.
- **No double-coalesce data-loss:** build-site `parseFloat`+`!= null` guard and the seam coalesce operate on disjoint inputs — a legit `"0.64"` survives the build-site parse into the map as `0.64`, and the seam never re-coalesces a present finite value. Sound.
- **R-1 retroactive shift (3 reclassified movements newly APPEAR):** correctly called out in R-1 + the migration comment for the Tester (the MIN-4 "appearance, not just shift" nuance carried forward, design-v2:393). Locked U3. Sound.
- **Defensive number path:** if `bodyweight_factor` ever arrived as a number, `typeof factor === "string"` is false and the number flows through `Number.isFinite` unchanged — strictly safer, zero downside. Sound.
- **No CHECK constraint / no write-path / no UI:** correctly deferred (U2). Sound.

---

## Decision reasoning (against the playbook rule)

Mechanical rule: 0 blockers + 0 majors → **go**.

Both v1 majors are resolved with source-verified deltas: MAJ-1's closed set is now genuinely closed (I re-ran the grep and confirmed no 7th builder; all 6 wired; `useAllExercises` source in scope at sites 1–3), and MAJ-2's string contract is consistent on every path (seam parses internally, both read boundaries `string | null`, maps `Map<string, number>` parsed at build sites, tests have string teeth). No new blocker or major surfaced. The two carry-forward minors are: MIN-NEW-1 (an incomplete-but-compile-deterministic fixture list — the Implementer leans on the typecheck the design already names as authority) and MIN-NEW-2 (two cosmetic notes). Neither forces a semantics guess or touches production correctness, so neither warrants a NO-GO override of the mechanical go. This GO closes the D↔V loop at round 2/3 with one round to spare.

---

## Recommendation to Conductor

- **status:** done
- **output_path:** `docs/runs/2026-06-03_1402_bodyweight-leverage-factors/validation-v2.md`
- **decision:** **go**
- **counts:** `{ blockers: 0, majors: 0, minors: 2 }`
- **recommendation:** invoke Implementer. Carry two must-fix notes: (1) MIN-NEW-1 — the MIN-2 fixture list is non-exhaustive; ALSO update `volume-target.test.ts` (5 `SetBodyweightInput`/`bodyweight:{}` literals → add `factorByExerciseId: new Map()`), `e1rm-strength.test.ts` + `weekly-muscle-volume.test.ts` (both `mkRow: WeeklyVolumeRow` AND `mkExercise: ExerciseRow` → add `bodyweight_factor: null`), `group-session-volumes.test.ts` (`mkRow` default → `bodyweight_factor: null`), plus the override literals once the local types widen; run `npx tsc --noEmit` as the authority and fix every flagged literal. (2) MIN-NEW-2 — return both maps from the `workout/[sessionId].tsx:96-102` memo (or add `factorByExerciseId` to the `:115` reduce deps), and treat `admin/index.tsx:394` as an intentional no-bw caller during the post-finish re-grep. R-5 names are clean (no action; Implementer pre-apply query is hygiene).
