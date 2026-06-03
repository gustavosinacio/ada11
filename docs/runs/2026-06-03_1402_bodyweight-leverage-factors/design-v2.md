# Design v2 — 2026-06-03_1402_bodyweight-leverage-factors

> Self-contained. The Validator/Implementer read THIS file, not v1 + a diff. Everything from v1 that the
> Validator confirmed sound is carried forward verbatim; the two MAJORs + two actionable MINORs are folded in.

## Changes from v1 (diff intent — read this first)

| Change | v1 | v2 | Driver |
|---|---|---|---|
| **MAJ-1 — closed set was FALSE (2 builders, not 6)** | Wiring table + closed-set proof named only `volume-target-slot.tsx` (MAP) + `makeBwInput` (prop) and asserted "no third builder". | Wiring table + closed-set proof now cover **all 6** `SetBodyweightInput`/`equipmentByExerciseId` builders. The 4 missed sites (`workout/[sessionId].tsx`, `workout/verdict/[sessionId].tsx`, `history/[id].tsx`, `session-verdict-math.ts`) each get a spec: build a parallel `factorByExerciseId` map in the SAME useMemo/loop that builds `equipmentByExerciseId`, sourced from the `useAllExercises` rows' `bodyweight_factor`. `factorByExerciseId` decided **REQUIRED** on the type (MAP-symmetry — see MAJ-1 resolution). | validation-v1.md MAJ-1 |
| **MAJ-2 — `numeric` is a JSON STRING, not number** | `bodyweight_factor: number \| null`; `effectiveWeightKg(..., factor?: number \| null)`; `Number.isFinite("0.64")===false` ⇒ silent no-op. Left the decision to the Implementer as a runtime probe. | Committed to the STRING-aware shape (v1's Alternative #3, now mandatory): `WeeklyVolumeRow.exercises.bodyweight_factor: string \| null`, `ExerciseRow.bodyweight_factor: string \| null`, `effectiveWeightKg(..., factor?: number \| string \| null)` with internal `parseFloat`. `factorByExerciseId: Map<string, number>` (parseFloat at each build site). | validation-v1.md MAJ-2 / R-2 |
| **MIN-1 — cross-surface test had no teeth** | Edge case 12 threaded `0.64` (number) through MAP/ROW/prop. | Edge case 12 threads the STRING `"0.64"` end-to-end (ROW `row.exercises.bodyweight_factor="0.64"`, MAP, prop) **and** adds a verdict/live-header surface; asserts one number. Surfaces named for the Tester. | validation-v1.md MIN-1 |
| **MIN-2 — widening breaks existing fixtures** | Not addressed. | Explicit instruction + file list: add `bodyweight_factor: null` to existing `WeeklyVolumeRow` fixtures (preserves f=1 byte-for-byte) and add `factorByExerciseId` to the `SetBodyweightInput` test literals. | validation-v1.md MIN-2 |
| MIN-3 (NULL-no-default) / MIN-4 (single atomic migration) | sound | unchanged — kept verbatim. MIN-4 note for the Tester carried forward (the 3 reclassified movements newly APPEAR, not just shift). | validation-v1.md MIN-3/4 |
| R-5 (7 exact catalog names) | LIVE-VERIFIED clean by the Validator | kept verbatim; Implementer pre-apply verification query kept as hygiene. | validation-v1.md R-5 |

### Top 1-2 things I most want the Validator to re-check
1. **The 6-builder closed set is now truly closed.** I confirmed the 4 missed builders + their `useAllExercises` source by reading source (cited file:line below). Please re-run `grep -rn "equipmentByExerciseId\|SetBodyweightInput\|computeVolumeTarget(\|sumLiveVolume(\|sumPastVolume(" app/ src/` and confirm there is no **7th** `SetBodyweightInput` construction site.
2. **The string typing is consistent across ALL paths, including the maps.** `bodyweight_factor` is `string | null` at BOTH read boundaries (`WeeklyVolumeRow.exercises` join + `ExerciseRow` `select("*")`); `factorByExerciseId` is `Map<string, number>` with `parseFloat` applied at each of the 6 build sites; `effectiveWeightKg` accepts `number | string | null`. Please confirm no path lets a raw `"0.64"` string reach `Number.isFinite` un-parsed (the v1 no-op bug).

---

## Goal (1 sentence)
Refine the Phase-0 bodyweight volume kernel so a bodyweight exercise contributes `(bodyweightKg × leverageFactor) + addedLoad` per rep instead of full bodyweight, with the per-exercise factor stored in a new nullable `exercises.bodyweight_factor` column backfilled on the canonical rows (migration 0021), backend-only.

## Approach

This is a **one-seam refinement** on top of Phase-0 (`docs/runs/2026-05-30_0126_bodyweight-volume-per-muscle/`). The factor enters at exactly **one arithmetic site** — `effectiveWeightKg` (`src/utils/bodyweight.ts:26-40`) — which gains an optional 4th param `factor?: number | string | null`. The bodyweight branch changes from `bw + addedLoad` to `bw * f + addedLoad`, where `f` is the coalesced factor. **Everything else is plumbing**: the factor must reach `effectiveWeightKg` at every volume call site Phase-0 already wired, via the same threading shapes Phase-0 established (ROW-fed widened SELECT, full-`ExerciseRow`-fed free column, MAP-fed parallel map, prop-fed scalar). The factor VALUES live in the DB on the canonical rows, backfilled by migration 0021 mirroring `0014`'s idempotent canonical UPDATE shape; the same migration **reclassifies** three currently-`equipment=null` movements to `equipment='bodyweight'` so they count bodyweight at all.

Three load-bearing rules govern correctness:

- **Invariant L (no-change-when-absent):** `effectiveWeightKg(eq, w, bw)` called with **no factor arg**, OR with `factor` NULL/`undefined`/non-finite (incl. a non-numeric string), coalesces to `1.0` and returns **byte-for-byte today's number**. The only new code path is the `* f` multiply in the `equipment === "bodyweight"` branch, and `f === 1.0` is the identity. This mirrors Phase-0's optional-`bodyweight` and `windowStartMs?` discipline (the proven "absent ⇒ old output" seam), and is provable by construction: a non-bodyweight row never reaches the multiply; a bodyweight row with `f = 1` reproduces `bw + addedLoad`.

- **addedLoad is NEVER scaled.** The formula is `bw * factor + addedLoad`, NOT `(bw + addedLoad) * factor`. A weighted dip's belt/vest load is a true external load and is leveraged at 1.0. (Confirmed by the prompt's own formula and U4.)

- **The factor is a `numeric` column ⇒ PostgREST returns it as a JSON STRING.** Every `numeric` in this app is typed `string | null` and `parseFloat`d at the seam (`sets.weight`, `sets.rpe`, `measurement_entries.weight_kg`, `routine_exercise_sets.target_weight`; `db/types.ts:93-95` documents the convention). `bodyweight_factor` follows the same convention: typed `string | null` at both read boundaries, parsed inside `effectiveWeightKg` (and at the map build sites). A `number | null` typing would silently no-op the feature (`Number.isFinite("0.64") === false` ⇒ coalesce to 1.0). This is committed as the contract, not deferred to a runtime probe.

Why a DB column over a code map (U1, locked): the column is **id-keyed** (survives renames — relevant because the catalog naming is inconsistent: `Chin-up` hyphen vs `Pull Up` space), rides `select("*")` for free on the single-row sites, covers any future user-owned bodyweight exercise, and reaches a future UI editor without a second migration. The tradeoff (a migration + schema/types + one SELECT widen + the parallel map at each builder) is accepted and is exactly Phase-0's blast radius for `equipment`.

## Mudanças por arquivo

### PURE kernels (the seam + threading reads) — no I/O, vitest-covered
| File | Type | Change |
|---|---|---|
| `src/utils/bodyweight.ts` | edited | `effectiveWeightKg` gains optional 4th param `factor?: number \| string \| null`. Internally coalesces a string via `parseFloat` (see contract). Bodyweight branch: `return bw * f + addedLoad`. Non-bodyweight branch unchanged (`return addedLoad`). Docstring updated: `bw*factor + addedLoad` formula + coalesce-to-1.0-never-0 rule + the string-`numeric` note + Invariant L. (`:26-40`) |
| `src/utils/volume-target.ts` | edited | (a) `SetBodyweightInput` (`:17-22`) gains **required** `factorByExerciseId: Map<string, number>`. (b) `ComputeVolumeTargetInput.bodyweight` (`:84-91`) gains required `factorByExerciseId: Map<string, number>`. (c) All three `effectiveWeightKg(...)` calls — `sumPastVolume:115`, `sumLiveVolume:157`, `effWeightOf:248-252` — pass a 4th arg `bw.factorByExerciseId.get(s.exercise_id)`. (d) The two internal `sumPastVolume`/`sumLiveVolume` re-invocations inside `computeVolumeTarget` (`:208-213`, `:227-230`) forward `factorByExerciseId` alongside `equipmentByExerciseId`. |
| `src/utils/progress-page-math.ts` | edited | 5 sites (`:88,190,233,310,393`): each `effectiveWeightKg(row.exercises?.equipment, row.weight, bw)` gains 4th arg `row.exercises?.bodyweight_factor` (a `string \| null`, parsed inside the seam). No structural change. |
| `src/utils/weekly-muscle-volume.ts` | edited | 1 site (`:121`): `effectiveWeightKg(ex.equipment, row.weight, bw)` gains 4th arg `ex.bodyweight_factor` (`ex` is the full `ExerciseRow` from `libById`; `string \| null`). |
| `src/utils/weekly-volume-strip-math.ts` | edited | 1 site (`:91`): add 4th arg `row.exercises?.bodyweight_factor` (`string \| null`). |
| `src/utils/exercise-session-row-format.ts` | edited | `presentExerciseSessionRow` input (`:49-59`) + `presentSetVolumeLines` input (`:115-123`) gain optional `factor?: number \| string \| null`. `makeBwInput` (`:79-88`) gains a `factor` param and writes a one-entry `factorByExerciseId` map (parseFloat applied — see contract). `presentSetVolumeLines`'s inline call (`:132`) passes `factor ?? null` as the 4th arg. |
| `src/utils/session-verdict-math.ts` | edited | **MAJ-1 site 4.** `computeCurrentSessionVolumeByExercise` (`:36-52`) — NO code change beyond the `SetBodyweightInput` type gaining `factorByExerciseId`. It forwards `bw` opaquely into `sumLiveVolume(group, bw)` (`:48`), so it is automatically correct once callers pass the new field. Listed here only to record it is in the closed set. |

### ROW-fed consumers (read the widened row; no kernel change) — UI/hook
| File | Type | Change |
|---|---|---|
| `src/hooks/use-progress-page.ts` | edited | 1 site (`:296`): `effectiveWeightKg(r.exercises?.equipment, r.weight, bw)` gains 4th arg `r.exercises?.bodyweight_factor` (`string \| null`). |
| `app/(app)/history/week/[isoWeek].tsx` | edited | 1 site (`:105`): add 4th arg `row.exercises?.bodyweight_factor` (`string \| null`). |

### Full-`ExerciseRow`-fed + prop-fed consumers (column rides `select("*")`)
| File | Type | Change |
|---|---|---|
| `app/(app)/exercises/[id]/progress.tsx` | edited | (a) Volume reduce (`:206`): `effectiveWeightKg(equipment, set.weight, bw)` gains 4th arg `exercise.data?.bodyweight_factor`; add `exercise.data?.bodyweight_factor` to the `useMemo` deps (`:242`). (b) e1RM path (`:195-202`) UNCHANGED — Invariant D. (c) `presentSetVolumeLines(...)` call (`:326-337`) gains `factor: exercise.data?.bodyweight_factor ?? undefined`. (d) `<ExerciseSessionRow>` (`:349-356`) gains `factor={exercise.data?.bodyweight_factor ?? undefined}`. |
| `src/components/exercise-block.tsx` | edited | `<VolumeTargetSlot>` mount (`:245-252`) gains `factor={exercise.bodyweight_factor ?? undefined}` (`exercise` is the full `ExerciseRow`, `:19`). |
| `src/components/volume-target-slot.tsx` | edited | **MAJ-1 site 5 (was wired in v1; carried forward).** (a) `Props` (`:19-28`) gains `factor?: number \| string`. (b) The `bodyweight` useMemo (`:63-90`) builds `factorByExerciseId = new Map([[exerciseId, parseFactor(factor)]])` alongside `equipmentByExerciseId`, adds it to the returned object + the dep array (`:84-90` deps gain `factor`). (c) Both `presentSetVolumeLines(...)` calls (`:125-130`, `:200-205`) pass `factor`. |
| `src/components/exercise-session-row.tsx` | edited | **MAJ-1 site 6 (was wired in v1; carried forward).** (VERIFIED: this IS the wrapper `progress.tsx:349` mounts — `Props.equipment?` at `:20`, threaded into BOTH `presentExerciseSessionRow` `:59-64` and `presentSetVolumeLines` `:65-70`.) `Props` (`:15-26`) gains `factor?: number \| string`; pass `factor` into both presenter calls (`:59-70`). |

### MAJ-1 — the 4 previously-missed `SetBodyweightInput` builders (NEW in v2)
| File | Type | Change |
|---|---|---|
| `app/(app)/workout/[sessionId].tsx` | edited | **MAJ-1 site 1 — live workout session-header total.** The `equipmentByExerciseId` useMemo (`:96-102`) loops `exercisesQ.data ?? []` (a `useAllExercises()` result ⇒ `select("*")` rows carrying `bodyweight_factor`). In the SAME useMemo, build `factorByExerciseId = new Map<string, number>()` and, for each `e` where `e.bodyweight_factor != null`, set `factorByExerciseId.set(e.id, parseFloat(e.bodyweight_factor))`. Pass `factorByExerciseId` in the inline `{ equipmentByExerciseId, bodyweightKg }` object fed to `sumLiveVolume` (`:111-114`). The useMemo dep array stays `[exercisesQ.data]` (both maps derive from it). |
| `app/(app)/workout/verdict/[sessionId].tsx` | edited | **MAJ-1 site 2 — end-of-session verdict total + PR detection.** The `equipmentByExerciseId` useMemo (`:58-64`) loops `exercisesQ.data ?? []` (`useAllExercises`). In the SAME useMemo build `factorByExerciseId` (parseFloat each non-null `e.bodyweight_factor`). Add `factorByExerciseId` to the `setBodyweightInput` literal (`:75-78`), which already flows into BOTH `sumLiveVolume` (`:81`) AND `computeCurrentSessionVolumeByExercise` (`:88-89`) — so one wiring fixes both. Dep arrays unchanged (`equipmentByExerciseId`/`setBodyweightInput` already track `exercisesQ.data`). |
| `app/(app)/history/[id].tsx` | edited | **MAJ-1 site 3 — History session-detail total.** Inside the `totals` useMemo (`:200-223`), the inline `equipmentByExerciseId` loop (`:210-213`) iterates `exercisesQ.data ?? []` (`useAllExercises`). In the SAME loop build `factorByExerciseId` (parseFloat each non-null `e.bodyweight_factor`). Pass `factorByExerciseId` in the `{ equipmentByExerciseId, bodyweightKg }` object fed to `sumLiveVolume` (`:218-221`). The useMemo dep array already includes `exercisesQ.data` (`:223`). |
| `src/utils/session-verdict-math.ts` | edited | **MAJ-1 site 4 — see PURE-kernels table above.** Type-only; forwards `bw` opaquely. |

### Schema / types / query (the one read-path touch)
| File | Type | Change |
|---|---|---|
| `src/db/schema.ts` | edited | Add `bodyweightFactor: numeric("bodyweight_factor")` to the `exercises` pgTable (`:46-71`). `numeric` is already imported (`:7`). Nullable (no `.notNull()`, no `.default`). |
| `src/db/types.ts` | edited | `ExerciseRow` (`:162-179`) gains `bodyweight_factor: string \| null` (matches every sibling `numeric` on the row types — see MAJ-2 contract). |
| `src/api/stats.ts` | edited | (a) Widen the `SELECT` constant (`:32-34`): `exercises!inner(equipment)` → `exercises!inner(equipment, bodyweight_factor)`. (b) `WeeklyVolumeRow.exercises` type (`:28`): `{ equipment: string }` → `{ equipment: string; bodyweight_factor: string \| null }`. |

### Migration (NOT auto-applied — Conductor/human runs `npm run db:push`)
| File | Type | Change |
|---|---|---|
| `supabase/migrations/0021_bodyweight_factor.sql` | new | Add nullable `bodyweight_factor numeric` column; idempotent canonical backfill of 7 rows (4 existing bodyweight + 3 reclassified); set `equipment='bodyweight'` on the 3 reclassified rows. See "Migration 0021 spec". |

### Tests
| File | Type | Change |
|---|---|---|
| `tests/unit/bodyweight.test.ts` | edited | Add a `describe("effectiveWeightKg — leverage factor")` block. **All factor cases assert with STRING inputs** (`"0.64"`, `"1.0"`, `"abc"`) plus NULL/undefined/number for the coalesce branches (see Edge cases). All existing cases (`:44-94`) re-pass unchanged (4-arity call with the 4th omitted). |
| `tests/unit/volume-target-factor.test.ts` (or extend an existing volume-target test) | new/edited | Cross-surface consistency (MIN-1): feed the SAME leveraged bodyweight set as a STRING `"0.64"` through `sumPastVolume` (MAP `factorByExerciseId`), a ROW-fed reduce (`row.exercises.bodyweight_factor = "0.64"`), `presentSetVolumeLines` (prop), AND a verdict/live-header surface (`computeCurrentSessionVolumeByExercise` via `SetBodyweightInput.factorByExerciseId`); assert one number. Plus the e1RM-unchanged regression. |
| `tests/unit/session-verdict-math.test.ts` | edited | **MIN-2.** Add `factorByExerciseId: new Map()` (or a populated map for new leveraged cases) to the two `SetBodyweightInput` literals (`:658-661`, `:708-711`). Add `bodyweight_factor: null` to the two explicit `exercises: { equipment: "bodyweight" }` fixtures (`:639`, `:689`) and to the `mkRow` default (`:72`). |
| `tests/unit/weekly-volume-bucketing.test.ts` | edited | **MIN-2.** Widen the `RowInput.exercises` type (`:49`) to `{ equipment: string; bodyweight_factor: string \| null }`; add `bodyweight_factor: null` to the `buildRow` default (`:64`). |
| `tests/unit/progress-page-math.test.ts` | edited | **MIN-2.** Add `bodyweight_factor: null` to the `mkRow` default (`:78`) and to any explicit `exercises:` override literal. |

> **MIN-2 closed-set note for the Implementer:** after widening `WeeklyVolumeRow.exercises` + `SetBodyweightInput`, run `npx tsc --noEmit` (or the project's typecheck) and fix EVERY `exercises: { equipment: ... }` / `SetBodyweightInput` literal the compiler flags. The three test files above are the known ones; the typecheck is the authority. Add `bodyweight_factor: null` (preserves f=1 byte-for-byte) to existing fixtures and string values (`"0.64"`) to new leveraged ones.

## Contratos de I/O

### `effectiveWeightKg` — the one seam (STRING-aware — MAJ-2)
```ts
export function effectiveWeightKg(
  equipment: string | null | undefined,
  weight: string | null,
  bodyweightKg: number | null,
  factor?: number | string | null, // NEW. numeric reads back as a STRING; parseFloat internally.
): number {
  const parsed = weight == null ? 0 : parseFloat(weight);
  const addedLoad = Number.isFinite(parsed) ? parsed : 0;
  if (equipment === "bodyweight") {
    const bw =
      bodyweightKg != null && Number.isFinite(bodyweightKg) ? bodyweightKg : 0;
    // Coalesce-to-1.0-NEVER-0. numeric arrives as "0.64"; parseFloat it.
    let f: number;
    if (factor == null) {
      f = 1;
    } else {
      const n = typeof factor === "string" ? parseFloat(factor) : factor;
      f = Number.isFinite(n) ? n : 1; // NaN/Infinity/"abc" ⇒ 1.0, NEVER 0
    }
    return bw * f + addedLoad; // addedLoad NEVER scaled
  }
  return addedLoad; // non-bodyweight never reads the factor
}
```
- **Invariant L:** with the 4th arg omitted, `factor == null` ⇒ `f = 1`, so `bw * 1 + addedLoad === bw + addedLoad` (today's body). Byte-for-byte.
- **Coalesce-to-1.0-never-0:** NULL, `undefined`, a non-numeric string (`"abc"`), `NaN`, `Infinity`, `-Infinity` ⇒ `1`, NOT `0`. (A `0` here would zero out every bodyweight volume — a silent catastrophic regression. The guard mirrors the existing `Number.isFinite(bodyweightKg)` posture at `:34`.)
- **String-aware:** `numeric` columns return as JSON strings (`"0.64"`); `parseFloat("0.64") === 0.64`. If a number ever arrives (defensive), `typeof factor === "string"` is false and the number flows through `Number.isFinite` unchanged — strictly safer with zero downside.
- **Legitimately-`0` factor in the DB:** the catalog backfill never writes `0` (min value is `0.50`). A stored `"0"` ⇒ `parseFloat("0") = 0` ⇒ `0 * bw + addedLoad = addedLoad` — that is a *deliberate* stored value, distinct from the *missing/garbage* coalesce. The guard only catches `null`/non-finite, so a stored finite `0` is honored. Correct: `0` is a valid (if unusual) leverage; NULL is "unknown ⇒ 1.0".

### `WeeklyVolumeRow` type + SELECT (the ROW-fed read path) — STRING (MAJ-2)
```ts
// src/api/stats.ts
export type WeeklyVolumeRow = {
  completed_at: string;
  weight: string | null;
  reps: number | null;
  set_type: SetType;
  exercise_id: string;
  session_id: string;
  exercises: { equipment: string; bodyweight_factor: string | null }; // +bodyweight_factor (STRING)
  sessions: { started_at: string; ended_at: string };
};

const SELECT =
  "completed_at, weight, reps, set_type, exercise_id, session_id, " +
  "exercises!inner(equipment, bodyweight_factor), sessions!inner(started_at, ended_at)";
```
This single widen feeds all 8 ROW-fed sites (`progress-page-math` ×5, `weekly-volume-strip-math:91`, `use-progress-page:296`, `history/week/[isoWeek]:105`). They read `row.exercises?.bodyweight_factor` (a `string | null`) and pass it straight as the 4th arg to `effectiveWeightKg`, which parseFloats it. The `!inner` join is unchanged (every set already requires an exercise row), so row-preservation is identical to Phase-0.

### Why `string | null`, not `number | null` (MAJ-2 — load-bearing, settled statically)
Every `numeric` column this app reads via supabase-js returns as a JSON **string** and is typed `string | null` + `parseFloat`d at the seam — a uniform, documented convention (`db/types.ts:93-95`: "the Supabase JS client returns columns as-is"):

| Column | App type | Evidence |
|---|---|---|
| `sets.weight` | `string \| null` | `db/types.ts:246`, `stats.ts:19`, `parseFloat` at `bodyweight.ts:31` + `volume-target.ts:123,165,254` |
| `sets.rpe` | `string \| null` | `db/types.ts:247` |
| `measurement_entries.weight_kg` | `string \| null` | `db/types.ts:261`, `parseFloat(m.weight_kg)` at `bodyweight.ts:73` |
| `routine_exercise_sets.target_weight` | `string \| null` | `db/types.ts:211` |
| all `measurement_entries` body metrics | `string \| null` | `db/types.ts:262-269` |

`bodyweight_factor numeric` uses the same PostgREST instance + client ⇒ it returns `"0.64"`. A `number | null` typing + `Number.isFinite("0.64") === false` ⇒ coalesce to 1.0 ⇒ the factor is silently dropped (push-ups stay full-bodyweight) — while number-literal unit tests stay green (false-green). Both read boundaries (`WeeklyVolumeRow.exercises.bodyweight_factor` join read AND `ExerciseRow.bodyweight_factor` `select("*")` read) are typed `string | null`. Phase-0 dodged this only because `equipment` is `text`.

### `SetBodyweightInput` + `ComputeVolumeTargetInput.bodyweight` (the MAP-fed contract)
```ts
// src/utils/volume-target.ts
export type SetBodyweightInput = {
  equipmentByExerciseId: Map<string, string>;
  factorByExerciseId: Map<string, number>; // NEW (REQUIRED). exercise_id → parsed leverage factor. Missing key ⇒ effectiveWeightKg coalesces to 1.0.
  bodyweightKg: number | null;
};

// ComputeVolumeTargetInput.bodyweight:
bodyweight?: {
  equipmentByExerciseId: Map<string, string>;
  factorByExerciseId: Map<string, number>; // NEW (REQUIRED)
  liveBodyweightKg: number | null;
  pastBodyweightBySession: Map<string, number | null>;
};
```
**`factorByExerciseId` is REQUIRED, not optional** (decision below). Inside the kernels, the 4th arg is `bw.factorByExerciseId.get(s.exercise_id)` — `Map.get` returns `undefined` for a missing key, which `effectiveWeightKg` coalesces to `1.0`. So a partially-populated map is safe (a non-bodyweight exercise can be absent with no harm — it never reads the factor anyway).

**`Map<string, number>` (parseFloat at the build site), not `Map<string, number | string>`:** the map values are parsed `number`s; each of the 6 build sites reads `e.bodyweight_factor` / `factor` (a `string | null`) and `parseFloat`s it BEFORE inserting (guarding `!= null` first). This keeps the seam's runtime contract clean (`Map.get` yields `number | undefined`, both of which `effectiveWeightKg` handles) and matches the existing `equipmentByExerciseId: Map<string, string>` shape. Applied uniformly across all 6 builders.

#### Decision: `factorByExerciseId` REQUIRED (not optional-defaulting-to-1.0)
**Required, for MAP-symmetry with the already-required `equipmentByExerciseId`.** Justification:
- `equipmentByExerciseId` is already a **required** field on `SetBodyweightInput` (no `?`). Making `factorByExerciseId` optional would create an asymmetric type where one of two parallel maps is mandatory and the other isn't — a smell that invites a builder to populate equipment but silently forget the factor (the exact MAJ-1 desync). Required forces the compiler to flag every one of the 6 builders that omits it.
- **Required is the consistency-enforcing choice, not merely the compile-forcing one.** The risk with "optional defaulting to 1.0" is precisely what MAJ-1 warned: a builder dodges the compile error by relying on the default and silently ships un-leveraged numbers on that surface, breaking "same number everywhere". Required makes the 6th builder a compile error until wired — the desync is structurally impossible to ship.
- Cost: the test fixtures (`session-verdict-math.test.ts:658-661,708-711`) must add `factorByExerciseId` (a one-line `factorByExerciseId: new Map()` for the f=1 cases). This is MIN-2 and is explicitly listed. Small, bounded, and the right tradeoff for correctness.

### `factorByExerciseId` BUILD SITES (all 6 — closed set re-proven for MAJ-1)
`SetBodyweightInput` (and the `equipmentByExerciseId` it carries) is constructed at exactly **6** sites. The `factor`/`bodyweight_factor` source for each is the same `useAllExercises()` row (or threaded prop) that already supplies `equipment`:

| # | Builder | Equipment source | Factor source (NEW) | Feeds |
|---|---|---|---|---|
| 1 | `app/(app)/workout/[sessionId].tsx:96-115` | `equipmentByExerciseId` useMemo over `exercisesQ.data` (`useAllExercises`) | parallel `factorByExerciseId` in the same useMemo: `parseFloat(e.bodyweight_factor)` for each non-null | `sumLiveVolume` (live header total) |
| 2 | `app/(app)/workout/verdict/[sessionId].tsx:58-92` | `equipmentByExerciseId` useMemo over `exercisesQ.data` (`useAllExercises`) | parallel `factorByExerciseId` in the same useMemo; added to `setBodyweightInput` (`:75-78`) | BOTH `sumLiveVolume` (`:81`) AND `computeCurrentSessionVolumeByExercise` (`:88-89`, PR detection) |
| 3 | `app/(app)/history/[id].tsx:200-223` | inline `equipmentByExerciseId` loop over `exercisesQ.data` (`useAllExercises`) inside the `totals` useMemo | parallel `factorByExerciseId` in the same loop | `sumLiveVolume` (history session-detail total) |
| 4 | `src/utils/session-verdict-math.ts:36-52` (`computeCurrentSessionVolumeByExercise`) | passes `bw` through opaquely | n/a — forwards `bw` to `sumLiveVolume`; auto-correct once callers (site 2) pass the field | `sumLiveVolume` per-exercise |
| 5 | `src/components/volume-target-slot.tsx:63-90` (the `bodyweight` useMemo) | one-entry `Map([[exerciseId, equipment]])` | one-entry `Map([[exerciseId, parseFactor(factor)]])`; `factor` is a NEW prop from `exercise-block.tsx:245-252` (full `ExerciseRow.bodyweight_factor`) | `computeVolumeTarget` |
| 6 | `src/utils/exercise-session-row-format.ts:makeBwInput:79-88` | loops `sets`, `set(s.exercise_id, equipment)` | loops `sets`, `set(s.exercise_id, parseFactor(factor))`; `factor` is a NEW input param | `sumLiveVolume` via `presentSetVolumeLines` / `presentExerciseSessionRow` |

For sites 1-3, the parallel-map build (each screen already holds the `useAllExercises` list to build `equipmentByExerciseId`; the factor rides the same `select("*")` rows — VERIFIED at `workout/[sessionId].tsx:96-102`, `verdict/[sessionId].tsx:58-64`, `history/[id].tsx:210-213`):
```ts
// parallel to the existing equipment loop (sites 1-3):
const factorByExerciseId = new Map<string, number>();
for (const e of exercisesQ.data ?? []) {
  if (e.bodyweight_factor != null) factorByExerciseId.set(e.id, parseFloat(e.bodyweight_factor));
}
// ... then pass `factorByExerciseId` alongside `equipmentByExerciseId` into the SetBodyweightInput literal.
```
`parseFactor` (sites 5/6, where `factor` may be `number | string | undefined` from a prop): `factor == null ? undefined : (typeof factor === "string" ? parseFloat(factor) : factor)` — guard `!= null` before `set` so the map never holds a `NaN` from an absent factor; an absent key coalesces to 1.0 at the seam anyway.

**Closed-set proof (MAJ-1 — 6 builders, all wired):** `computeVolumeTarget` is consumed by exactly one component (`volume-target-slot.tsx:94` — builder #5). `SetBodyweightInput` (the `{ equipmentByExerciseId, ..., bodyweightKg }` shape fed to `sumLiveVolume`/`sumPastVolume`/`computeCurrentSessionVolumeByExercise`) is built at builders #1, #2, #3, #6, and forwarded opaquely by #4. All six are in the wiring table. **Implementer MUST, before finishing, re-grep `grep -rn "equipmentByExerciseId\|SetBodyweightInput\|computeVolumeTarget(\|sumLiveVolume(\|sumPastVolume(" app/ src/` and confirm every hit maps to one of these 6 builders (or is a kernel definition/internal re-invocation already covered). If a 7th builder surfaces, wire it the same way and flag it.** Because `factorByExerciseId` is REQUIRED, the compiler will independently flag any builder left un-wired.

### Prop chain (`presentSetVolumeLines` / `presentExerciseSessionRow`) — builder #6
```ts
// exercise-session-row-format.ts
export function presentExerciseSessionRow(input: {
  sets: SetRow[];
  unit: WeightUnit;
  equipment?: string;
  factor?: number | string | null; // NEW — same source as equipment (exercise.bodyweight_factor)
  bodyweightKg?: number | null;
}): ExerciseSessionRowPresentation { /* makeBwInput(sets, equipment, factor, bodyweightKg) */ }

export function presentSetVolumeLines(input: {
  sets: SetRow[];
  unit: WeightUnit;
  equipment?: string;
  factor?: number | string | null; // NEW
  bodyweightKg?: number | null;
}): SetVolumeLine[] { /* effectiveWeightKg(equipment, s.weight, bodyweightKg ?? null, factor ?? null) */ }

function makeBwInput(
  sets: SetRow[],
  equipment: string | undefined,
  factor: number | string | null | undefined, // NEW
  bodyweightKg: number | null | undefined,
): SetBodyweightInput | undefined {
  if (equipment === undefined) return undefined;
  const equipmentByExerciseId = new Map<string, string>();
  const factorByExerciseId = new Map<string, number>();
  const f =
    factor == null
      ? undefined
      : typeof factor === "string"
        ? parseFloat(factor)
        : factor;
  for (const s of sets) {
    equipmentByExerciseId.set(s.exercise_id, equipment);
    if (f != null && Number.isFinite(f)) factorByExerciseId.set(s.exercise_id, f);
  }
  return { equipmentByExerciseId, factorByExerciseId, bodyweightKg: bodyweightKg ?? null };
}
```
Prop-fed callers and their factor source:
- `progress.tsx:326-337` `presentSetVolumeLines(...)` → `factor: exercise.data?.bodyweight_factor ?? undefined`.
- `progress.tsx:349` `<ExerciseSessionRow ... />` → `factor={exercise.data?.bodyweight_factor ?? undefined}` → `exercise-session-row.tsx:59-70` forwards into `presentExerciseSessionRow` + `presentSetVolumeLines`.
- `volume-target-slot.tsx:125-130,200-205` `presentSetVolumeLines(...)` → `factor: factor` (the new prop).

### `ExerciseRow` (full-row-fed sites) — STRING (MAJ-2)
```ts
// src/db/types.ts
export type ExerciseRow = {
  id: string;
  user_id: string | null;
  name: string;
  muscles: string[];
  equipment: string | null;
  bodyweight_factor: string | null; // NEW — numeric ⇒ STRING; rides select("*") on every read path
  notes: string | null;
  source: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};
```
Sites #9 (`weekly-muscle-volume.ts:121` via `libById`) and #12 (`progress.tsx:206` via `useExercise`), plus MAJ-1 sites #1-#3 (via `useAllExercises`), read `ex.bodyweight_factor` / `exercise.data?.bodyweight_factor` (a `string | null`) for free. **No API change** — `createExercise`/`updateExercise` field lists are NOT touched (U2: backend-only, no write path).

## Migration 0021 spec

File: `supabase/migrations/0021_bodyweight_factor.sql`. Hand-written, single-file (Supabase CLI wraps in BEGIN/COMMIT). Applied via `npm run db:push`. **NOT auto-applied** — the Conductor/human runs it; the Implementer writes it but does not apply it.

```sql
-- =============================================================================
-- 0021_bodyweight_factor.sql
-- Hand-written. Adds a per-exercise bodyweight leverage factor + backfills the
-- canonical bodyweight catalog. Mirrors 0011/0014's idempotent canonical-row
-- UPDATE shape (WHERE user_id IS NULL AND deleted_at IS NULL).
--
-- The factor scales ONLY the bodyweight component in effectiveWeightKg
-- (bw*factor + addedLoad); addedLoad (belt/vest) is never scaled. NULL ⇒ the
-- app coalesces to 1.0 (NEVER 0). The column is nullable with no default, so
-- every user-owned and non-bodyweight row stays NULL ⇒ 1.0 ⇒ byte-for-byte
-- today's numbers.
--
-- RETROACTIVE SHIFT (call-out): step 2 reclassifies Pull Up, Chest Dip, and
-- Hanging Knee Raise from equipment=NULL to equipment='bodyweight'. Today they
-- count ZERO bodyweight volume; after this migration every historical session
-- of those three gains bodyweight*factor*reps volume (same class of retroactive
-- change as Phase 0). This changes historical PRs/max-volume for those three,
-- and makes them APPEAR on per-muscle/strip/PR surfaces where they were absent.
-- =============================================================================

-- 1. Add the nullable column (no default → existing rows stay NULL ⇒ 1.0).
alter table public.exercises add column if not exists bodyweight_factor numeric;

-- 2. Reclassify the three mis-tagged bodyweight movements to count bodyweight.
update public.exercises set equipment = 'bodyweight'
  where user_id is null and deleted_at is null
    and name in ('Pull Up', 'Chest Dip', 'Hanging Knee Raise');

-- 3. Backfill the leverage factors on all seven canonical bodyweight rows.
--    Idempotent: re-running sets the same values. Matched by exact name on
--    canonical (user_id IS NULL), non-deleted rows.
update public.exercises set bodyweight_factor = 0.64
  where user_id is null and deleted_at is null and name = 'Push-up';
update public.exercises set bodyweight_factor = 1.0
  where user_id is null and deleted_at is null and name = 'Dip';
update public.exercises set bodyweight_factor = 1.0
  where user_id is null and deleted_at is null and name = 'Chin-up';
update public.exercises set bodyweight_factor = 1.0
  where user_id is null and deleted_at is null and name = 'Pull Up';
update public.exercises set bodyweight_factor = 1.0
  where user_id is null and deleted_at is null and name = 'Chest Dip';
update public.exercises set bodyweight_factor = 0.50
  where user_id is null and deleted_at is null and name = 'Hanging Leg Raise';
update public.exercises set bodyweight_factor = 0.50
  where user_id is null and deleted_at is null and name = 'Hanging Knee Raise';
```

**DDL decisions + justification:**
- **`add column ... numeric` nullable, no default.** Justification: NULL is the "unknown ⇒ coalesce to 1.0" sentinel, identical in effect to a `1.0` default for every non-backfilled row, but semantically honest (it says "no leverage value set" not "leverage is exactly 1.0"). A `default 1.0` would also work numerically, but (a) it would write `1.0` to all ~95 rows including non-bodyweight ones where the value is meaningless, and (b) NULL-vs-stored-1.0 lets a future UI distinguish "unset" from "explicitly 1.0". The app's coalesce-to-1.0 guard makes NULL safe regardless. `add column if not exists` makes step 1 idempotent. (MIN-3 — Validator confirmed sound.)
- **Type `numeric`** (not `numeric(3,2)` or `real`): matches the `max_volume_window` numeric-tuning-column precedent and avoids a precision/scale CHECK the feature doesn't need. The Drizzle schema uses bare `numeric("bodyweight_factor")`.
- **No CHECK constraint** on the factor range (e.g. `>= 0`). Justification: the app's coalesce handles garbage at read time; a CHECK would only guard the (out-of-scope) write path, which doesn't exist (U2). Out of scope; noted for a future UI-editor migration.
- **Single atomic migration (reclassify + backfill together).** (MIN-4 — Validator confirmed sound.) Splitting risks a window where a reclassified row has no factor (still safe — NULL ⇒ 1.0 — but two migrations to manage). U3 locked the reclassify + backfill together.

**Name-matching strategy + the EXACT-NAME verification (R-5 — LIVE-VERIFIED clean by the Validator):**
The 7 names are taken from Discovery's live-catalog inventory and were independently LIVE-VERIFIED by the Validator (validation-v1.md:69-84, anon client, project `ykrbgpctbfvndxjnpzrg`): the query returned exactly 7 rows, one per name, zero misses. The 4 already-`bodyweight` rows are `Chin-up` (hyphen), `Dip`, `Hanging Leg Raise`, `Push-up` (hyphen); the 3 currently-`null` reclassify rows are `Pull Up` (space), `Chest Dip`, `Hanging Knee Raise`. The names are EXACT — keep them verbatim. The migration uses exact `name = '...'` (not `ilike`) so it is strict and idempotent.

The Implementer's mandatory pre-apply verification query is kept as hygiene (the catalog could drift between this validation and apply):
```sql
select name, equipment, user_id, deleted_at from public.exercises
where user_id is null and deleted_at is null
  and name in ('Push-up','Dip','Chin-up','Pull Up','Chest Dip','Hanging Leg Raise','Hanging Knee Raise')
order by name;
-- Expect exactly 7 rows. If any name returns 0 rows, the canonical string differs
-- (case/whitespace/hyphen) — do NOT guess; re-query with ilike/trim to find the
-- true string and fix the migration literal. A name miss = a silent un-backfilled
-- row (factor stays NULL ⇒ 1.0 ⇒ that exercise keeps full-BW volume, NOT the
-- intended leverage). This is the one place a typo ships a wrong number silently.
```

## Identity / back-compat
- **Factor 1.0 / NULL / absent ⇒ today's numbers (Invariant L).** Proven by construction: the only new code is the `* f` multiply, and `f = 1` is the identity. Every non-bodyweight row, every user-owned row (all NULL today — zero user-owned bodyweight exercises exist), and every kernel call with the 4th arg omitted reproduces Phase-0 output byte-for-byte.
- **Existing `tests/unit/bodyweight.test.ts:44-94` stay green unchanged.** They call `effectiveWeightKg` with 3 args; the 4th defaults to `undefined` ⇒ `f = 1`. E.g. `effectiveWeightKg("bodyweight","0",80) === 80` still holds (`80 * 1 + 0`).
- **Coalesce-to-1.0-NEVER-0 guard:** NULL, undefined, non-numeric string, NaN, ±Infinity ⇒ 1.0. A stored finite `"0"`/`0` is honored as a deliberate value (catalog never writes 0; min is 0.50).
- **Legacy mixed-case `"Bodyweight"`** still never triggers the bodyweight branch (`bodyweight.ts:33` exact-token gate) ⇒ never reads a factor. Unchanged (`bodyweight.test.ts:82-84` re-passes).
- **e1RM unchanged** — the factor never touches `epley1RM` (Invariant D). See e1RM exclusion below.
- **MIN-2 fixture migration preserves identity:** adding `bodyweight_factor: null` to existing `WeeklyVolumeRow` fixtures keeps their f=1 semantics byte-for-byte; adding `factorByExerciseId: new Map()` to existing `SetBodyweightInput` literals keeps f=1 (empty map ⇒ every `get` undefined ⇒ 1.0).

## e1RM exclusion (Invariant D holds)
The factor must NOT reach either e1RM path:
- `app/(app)/exercises/[id]/progress.tsx:195-202` — `w = parseFloat(set.weight)` → `epley1RM(w, r)`. This block is UNTOUCHED; the factor change lands only on the *separate* volume reduce at `:206` (the two-variable split Phase-0 introduced as MAJ-2). The `useMemo` dep add (`bodyweight_factor`) does not change the e1RM output because the e1RM branch never reads the factor.
- `src/utils/e1rm-strength.ts:14-17,146-150` — logged-weight-only; UNTOUCHED.

**Regression assertion (Test plan):** for a bodyweight set with a factor set (e.g. push-up `"0.64"`, bodyweight 80, logged weight 0), assert `epley1RM`-derived e1RM is identical with and without the factor — i.e. the e1RM path produces NO point for a 0-logged-weight set regardless of factor (Invariant D), and for a weighted bodyweight set (logged weight 20) the e1RM derives from `20` only, independent of the factor.

## Edge cases / behaviors to test
> **Factor cases assert with STRING inputs (MAJ-2 teeth).** A number-literal test passes under EITHER typing and is a false-green; it would not catch the string-drop bug. At least one case per coalesce branch uses the runtime-true type.

1. **Push-up at "0.64" (STRING):** `effectiveWeightKg("bodyweight","0",80,"0.64") === 51.2` (`80 * 0.64 + 0`).
2. **Push-up with added load (STRING factor):** `effectiveWeightKg("bodyweight","10",80,"0.64") === 61.2` (`80*0.64 + 10` — addedLoad NOT scaled; NOT `(80+10)*0.64 = 57.6`).
3. **Dip at "1.0" (STRING) = today:** `effectiveWeightKg("bodyweight","0",80,"1.0") === 80` (identical to Phase-0).
4. **Weighted dip (STRING factor):** `effectiveWeightKg("bodyweight","30",80,"1.0") === 110` (`80*1 + 30`; the belt's 30 kg is leveraged at 1.0, i.e. unscaled).
5. **Reclassified-three retroactive:** after migration, a historical `Pull Up` set (bw 80, reps 8, equipment now 'bodyweight', factor `"1.0"`) contributes `80*1*8 = 640` kg where it contributed `0` before. (Cannot unit-test the migration directly; assert at the kernel level that an `equipment='bodyweight'` row with factor `"1.0"` produces bodyweight volume, and verify post-apply via the backfill query.)
6. **NULL factor ⇒ 1.0:** `effectiveWeightKg("bodyweight","0",80,null) === 80`.
7. **undefined / absent factor ⇒ 1.0:** `effectiveWeightKg("bodyweight","0",80) === 80` (Invariant L identity).
8. **Non-finite-STRING factor ⇒ 1.0:** `effectiveWeightKg("bodyweight","0",80,"abc") === 80` (parseFloat ⇒ NaN ⇒ coalesce). Also a number `NaN`/`Infinity`/`-Infinity` ⇒ 1.0.
9. **Stored finite "0" honored:** `effectiveWeightKg("bodyweight","10",80,"0") === 10` (`parseFloat("0")=0`; `80*0 + 10` — deliberate, distinct from NULL).
10. **Non-bodyweight ignores factor:** `effectiveWeightKg("barbell","100",80,"0.64") === 100` (factor never read off the bodyweight branch).
11. **Defensive number path:** `effectiveWeightKg("bodyweight","0",80,0.64) === 51.2` (a number still works — strictly safer).
12. **e1RM unchanged** (Invariant D) — see e1RM exclusion.
13. **Cross-surface consistency (MIN-1 — STRING end-to-end, 4 surfaces named):** the SAME leveraged push-up set (bw 80, factor `"0.64"`, reps 10, expected `512` kg) yields one number through:
    - **ROW path** — `row.exercises.bodyweight_factor = "0.64"` fed to a `sumLiveVolume`/`sumPastVolume`-style row reduce (Progress / strip / muscle-chart / history-week surfaces).
    - **MAP path** — `SetBodyweightInput.factorByExerciseId = new Map([["pushup", 0.64]])` fed to `sumPastVolume`.
    - **prop path** — `presentSetVolumeLines({ ..., factor: "0.64" })`.
    - **verdict/live-header path** — `computeCurrentSessionVolumeByExercise(sets, { equipmentByExerciseId, factorByExerciseId: new Map([["pushup", 0.64]]), bodyweightKg: 80 })`.
    All four must return `512` for the push-up. Tester: name these four surfaces so the assertion has teeth against both the string-drop (R-2) and the un-wired-surface desync (MAJ-1).

## Riscos
- **R-1 Data integrity — RETROACTIVE volume shift for the 3 reclassified movements (Confidence HIGH, Risk MEDIUM, visibility HIGH).** Reclassifying `Pull Up`, `Chest Dip`, `Hanging Knee Raise` to `equipment='bodyweight'` makes them count `bodyweight*factor*reps` volume on ALL historical sessions where today they count `0`. This changes per-session max-volume PRs, the weekly strip, the per-muscle chart, the Progress page totals, and the History week headlines for any user who logged those movements. **MIN-4 nuance for the Tester:** these three will newly APPEAR on per-muscle/strip/PR surfaces where they were previously absent (a *new* contribution, not just a shifted number) — expect the appearance of new data, not only changed numbers. Same class of retroactive change Phase-0 introduced for the original 4; intended (U3) but high-visibility. Mitigation: the migration comment calls it out; the human locked it; the change is deterministic and reversible (set `equipment=null` + `bodyweight_factor=null` to revert). No data is destroyed.
- **R-2 Data integrity — `numeric` JSON shape (string vs number) — RESOLVED in v2 by committing to the string-aware shape (MAJ-2).** PostgREST returns `bodyweight_factor` as the JSON string `"0.64"`. v1's `number | null` typing would silently drop the factor (`Number.isFinite("0.64") === false` ⇒ coalesce to 1.0). v2 types both read boundaries `string | null`, parseFloats inside `effectiveWeightKg` and at the map build sites, and the unit tests assert with STRING inputs (cases 1-3, 8, 9, 13) so the false-green is impossible. Residual: Confidence HIGH (5 in-repo numeric columns, all string-typed, all parseFloat'd; documented convention `db/types.ts:93-95`); the string-aware seam is strictly safer even if a number ever arrived.
- **R-3 Data integrity — NEVER-0 coalesce (Confidence HIGH, Risk HIGH if wrong).** A coalesce to `0` instead of `1.0` would zero every bodyweight volume app-wide. The guard is explicit and unit-tested (cases 6-9). Low probability given the test, but catastrophic if it regresses.
- **R-4 UX regression — shared kernel blast radius across ALL 6 builders + the kernel sites (Confidence HIGH, Risk LOW).** All volume surfaces share `effectiveWeightKg`; a wrong 4th-arg wiring at any one site (or a missed builder) desyncs that surface from the others. **MAJ-1 was exactly this** — 4 builders were un-wired in v1. Mitigation: the 6-builder closed-set wiring table + the REQUIRED `factorByExerciseId` (compiler flags any missed builder) + the cross-surface consistency test (case 13, now covering the verdict/live-header surface) + the "same number everywhere" invariant. The factor is `undefined`/`1.0` for every non-leveraged exercise, so unaffected surfaces are byte-for-byte unchanged.
- **R-5 UX regression — name-match miss leaves a row un-backfilled (Confidence MEDIUM→HIGH, Risk LOW).** RESOLVED-clean by the Validator's live query (7/7 names exact). If the catalog drifts before apply, that `UPDATE` matches 0 rows, the factor stays NULL ⇒ 1.0, and that exercise silently keeps full-BW volume. Mitigation: the mandatory pre-apply verification query (expect exactly 7 rows). Kept as hygiene.
- **R-6 Platform divergence (Confidence HIGH, Risk LOW).** Pure arithmetic + a column read; no iOS/Android/web divergence. No native modules, no SVG, no platform APIs touched.
- **R-7 Performance (Confidence HIGH, Risk LOW).** One `Map.get` (MAP path) or one already-fetched column read (ROW/full-row path) per set; the SELECT adds one column to an existing `!inner` join; the parallel `factorByExerciseId` build (sites 1-3) is one extra `Map.set` inside an already-existing loop over `exercisesQ.data`. Negligible — no new query, no new round-trip, no extra scan.

## Alternativas descartadas
1. **Code map (`Record<canonical-name, number>`)** — descartada (locked U1) because it is name-keyed (rename-fragile — the catalog has `Chin-up` vs `Pull Up` inconsistency), ignores user-owned bodyweight rows, and can't reach a UI editor without a later rewrite. Tradeoff noted: the map would need zero migration/schema/SELECT change for a 7-row catalog — cheaper today, but the human chose the id-keyed, owned-row-covering, UI-future-proof column.
2. **`default 1.0` on the column instead of nullable-no-default** — descartada (MIN-3, Validator agreed) because it writes a meaningless `1.0` to all ~95 rows (incl. non-bodyweight), and erases the "unset vs explicitly-1.0" distinction a future UI wants; the app's coalesce makes NULL behave identically to a 1.0 default at read time, so the default buys nothing and costs semantic clarity.
3. **Keep `effectiveWeightKg`'s 4th arg strictly `number | null` (reject string)** — descartada / now FORBIDDEN (MAJ-2). The live `numeric` reads back as a string; the strict-`number` signature silently coalesces `"0.64"` to 1.0 (R-2) and number-literal tests false-green. v2 types the 4th arg `number | string | null` and `parseFloat`s a string internally. Settled statically by the 5-column convention, not deferred to a runtime probe.
4. **`factorByExerciseId` OPTIONAL on `SetBodyweightInput` (default 1.0)** — descartada because it lets a builder dodge the compile error and silently ship un-leveraged numbers on that surface (the MAJ-1 desync). REQUIRED makes any missed builder a compile error — the desync is structurally impossible. The cost (one-line `new Map()` in two test literals, MIN-2) is bounded and worth the correctness.
5. **`factorByExerciseId: Map<string, number | string>` (parseFloat at the seam)** — descartada in favor of `Map<string, number>` (parseFloat at each build site), to keep the seam's runtime contract clean and mirror `equipmentByExerciseId: Map<string, string>`. Applied uniformly across all 6 builders.
6. **`(bw + addedLoad) * factor` (scale the whole load)** — descartada (locked U4) because the belt/vest addedLoad is a true external load; scaling it would under-count a weighted dip. The formula is `bw*factor + addedLoad`.
7. **Add the factor to the API write path / a UI Controller now** — descartada (locked U2: backend-only). Zero user-owned bodyweight exercises exist, so a UI editor has no user to serve yet; the 4 canonical defaults + 3 reclassified deliver the entire value. Deferred (Out of scope).
8. **Apply the migration as part of this run / auto-apply** — descartada because the playbook + Phase-0 precedent have the Conductor/human run `npm run db:push`; the Implementer writes the SQL but does not apply it (matches `0011`/`0020` handling).
9. **A separate `factorByExerciseId` fetch hook for `volume-target-slot` / the verdict/live screens** — descartada because the factor rides the full `ExerciseRow` that each screen already holds (`useAllExercises` ⇒ `select("*")` for sites 1-3; `exercise-block.tsx` for site 5). A new fetch would duplicate data and add a round-trip. It threads exactly like `equipment` does.
10. **CHECK constraint `bodyweight_factor >= 0` (or `> 0`)** — descartada because it only guards the (out-of-scope) write path; the app's read-time coalesce handles garbage. Noted for a future UI-editor migration.
11. **Reclassify the 3 movements in a SEPARATE migration from the factor backfill** — descartada (MIN-4, Validator agreed) because the factor for `Pull Up`/`Chest Dip`/`Hanging Knee Raise` is only meaningful once they are `equipment='bodyweight'`; splitting risks a window where a reclassified row has no factor (still safe — NULL ⇒ 1.0 — but two migrations). One migration keeps reclassify + backfill atomic (U3).

## Out of scope
- **UI field** — no `bodyweight_factor` Controller on `exercises/[id]/index.tsx` or `new.tsx` (U2).
- **zod / `ExerciseInput` / API write path** — `createExercise`/`updateExercise` field lists untouched (U2).
- **e1RM / strength chart** — Invariant D; the factor never touches `epley1RM` or `e1rm-strength.ts`.
- **Scaling addedLoad** — only the bodyweight component is leveraged (U4).
- **Non-bodyweight equipment multiplier** — the factor is gated to `equipment === "bodyweight"` only.
- **Per-exercise UI editor / admin factor edit UI** — deferred until user-owned bodyweight exercises exist.
- **CHECK constraint / range validation on the factor** — deferred to a future write-path migration.
- **Pull-up factor research / Hanging-Leg-Raise biomechanics** — values are human-supplied (U4), not derived here.
- **Pre-existing screenshot PNG working-tree noise** in other runs' folders — not touched (`state.md:12-13`).

## What is NOT in this change (forbidding clause — guards against drift)
- The factor is NOT applied in any e1RM/`epley1RM` path.
- The factor does NOT multiply `addedLoad`.
- The factor coalesce target is NOT `0` — it is `1.0`.
- The factor type is NOT `number | null` — it is `string | null` at the read boundaries and `number | string | null` at the seam (numeric reads back as a string).
- `factorByExerciseId` is NOT optional — it is REQUIRED on `SetBodyweightInput` (compiler enforces all 6 builders).
- There are NOT 2 `SetBodyweightInput` builders — there are 6, all in the wiring table.
- No new query, no new fetch, no new hook — the factor rides existing reads (`select("*")` + the one widened `stats.ts` SELECT).
- No write-path / zod / `ExerciseInput` / Controller change.
- No per-site arithmetic — the factor multiplies ONLY inside `effectiveWeightKg`.

## Response to Validator issues (validation-v1.md)

**MAJ-1 (closed set was FALSE — 6 builders, not 2): RESOLVED.** The wiring table now covers all 6 `SetBodyweightInput`/`equipmentByExerciseId` builders. The 4 previously-missed sites are spec'd (NEW "MAJ-1 — the 4 previously-missed builders" table + the 6-row BUILD SITES table): sites 1-3 build a parallel `factorByExerciseId` in the same useMemo/loop that builds `equipmentByExerciseId`, sourced from the `useAllExercises` rows' `bodyweight_factor` (VERIFIED `workout/[sessionId].tsx:96-102`, `verdict/[sessionId].tsx:58-64`, `history/[id].tsx:210-213` — each already loops `exercisesQ.data` to build the equipment map; `listAllExercises` uses `select("*")` so the factor rides the same rows, `api/exercises.ts:36-44`); site 4 (`session-verdict-math.ts`) is type-only, forwarding `bw` opaquely. `factorByExerciseId` decided **REQUIRED** (MAP-symmetry — the compiler then flags any un-wired builder, making the desync structurally impossible; consistency-not-just-compilation). Closed-set re-proven with the mandatory re-grep instruction (`equipmentByExerciseId|SetBodyweightInput|computeVolumeTarget(|sumLiveVolume(|sumPastVolume(`) to confirm no 7th.

**MAJ-2 (commit to the string-aware shape): RESOLVED.** `WeeklyVolumeRow.exercises.bodyweight_factor: string | null` (`stats.ts`), `ExerciseRow.bodyweight_factor: string | null` (`db/types.ts` — matches every sibling numeric), `effectiveWeightKg(..., factor?: number | string | null)` with internal `parseFloat` (coalesce-to-1.0-never-0 preserved; stored `"0"` honored). `factorByExerciseId: Map<string, number>` with `parseFloat` at each of the 6 build sites (chosen over `Map<string, number | string>`; applied uniformly). Tests assert with STRING inputs (cases 1-3, 8, 9, 13) so a number-literal false-green is impossible.

**MIN-1 (cross-surface test threads STRING end-to-end + covers verdict/live-header): RESOLVED.** Edge case 13 threads `"0.64"` (string) through ROW / MAP / prop / verdict-live-header (`computeCurrentSessionVolumeByExercise`) and asserts `512` on all four. Surfaces named for the Tester.

**MIN-2 (widening breaks existing fixtures): RESOLVED.** Test-file list with exact lines: `session-verdict-math.test.ts` (`mkRow` default `:72`, explicit `:639`/`:689` fixtures, `SetBodyweightInput` literals `:658-661`/`:708-711`), `weekly-volume-bucketing.test.ts` (`RowInput` type `:49`, `buildRow` default `:64`), `progress-page-math.test.ts` (`mkRow` default `:78`). Add `bodyweight_factor: null` to existing `WeeklyVolumeRow` fixtures (preserves f=1) and `factorByExerciseId: new Map()` to existing `SetBodyweightInput` literals; the typecheck is the authority for any others.

**MIN-3 (NULL-no-default) / MIN-4 (single atomic migration): kept (Validator confirmed sound).** No change to the column DDL or the single-migration shape. MIN-4's "they newly APPEAR" nuance carried into R-1 + the migration comment for the Tester.

**R-5 (7 exact catalog names): kept verbatim (Validator LIVE-VERIFIED clean).** Names unchanged; the Implementer pre-apply verification query kept as hygiene.

---

No peer invocations were required for this re-design — the 4 new builder sites + their `useAllExercises` source were confirmed by reading source directly (cited above). No `peer_invocation:` entry to log.
