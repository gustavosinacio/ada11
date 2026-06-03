# Design v1 — 2026-06-03_1402_bodyweight-leverage-factors

## Goal (1 sentence)
Refine the Phase-0 bodyweight volume kernel so a bodyweight exercise contributes `(bodyweightKg × leverageFactor) + addedLoad` per rep instead of full bodyweight, with the per-exercise factor stored in a new nullable `exercises.bodyweight_factor` column backfilled on the canonical rows (migration 0021), backend-only.

## Approach

This is a **one-seam refinement** on top of Phase-0 (`docs/runs/2026-05-30_0126_bodyweight-volume-per-muscle/`). The factor enters at exactly **one arithmetic site** — `effectiveWeightKg` (`src/utils/bodyweight.ts:26-40`) — which gains an optional 4th param `factor?: number | null`. The bodyweight branch changes from `bw + addedLoad` to `bw * f + addedLoad`, where `f` is the coalesced factor. **Everything else is plumbing**: the factor must reach `effectiveWeightKg` at all 14 volume call sites Phase-0 already wired, via the same three threading shapes Phase-0 established (ROW-fed widened SELECT, full-`ExerciseRow`-fed free column, MAP-fed parallel map, prop-fed scalar). The factor VALUES live in the DB on the canonical rows, backfilled by migration 0021 mirroring `0014`'s idempotent canonical UPDATE shape; the same migration **reclassifies** three currently-`equipment=null` movements to `equipment='bodyweight'` so they count bodyweight at all.

Two load-bearing rules govern correctness:

- **Invariant L (no-change-when-absent):** `effectiveWeightKg(eq, w, bw)` called with **no factor arg**, OR with `factor` NULL/`undefined`/non-finite, coalesces to `1.0` and returns **byte-for-byte today's number**. The only new code path is the `* f` multiply in the `equipment === "bodyweight"` branch, and `f === 1.0` is the identity. This mirrors Phase-0's optional-`bodyweight` and `windowStartMs?` discipline (the proven "absent ⇒ old output" seam), and is provable by construction: a non-bodyweight row never reaches the multiply; a bodyweight row with `f = 1` reproduces `bw + addedLoad`.

- **addedLoad is NEVER scaled.** The formula is `bw * factor + addedLoad`, NOT `(bw + addedLoad) * factor`. A weighted dip's belt/vest load is a true external load and is leveraged at 1.0. (Confirmed by the prompt's own formula and U4.)

Why a DB column over a code map (U1, locked): the column is **id-keyed** (survives renames — relevant because the catalog naming is inconsistent: `Chin-up` hyphen vs `Pull Up` space), rides `select("*")` for free on the single-row sites, covers any future user-owned bodyweight exercise, and reaches a future UI editor without a second migration. The tradeoff (a migration + schema/types + one SELECT widen + the `volume-target` map) is accepted and is exactly Phase-0's blast radius for `equipment`.

## Mudanças por arquivo

### PURE kernels (the seam + threading reads) — no I/O, vitest-covered
| File | Type | Change |
|---|---|---|
| `src/utils/bodyweight.ts` | edited | `effectiveWeightKg` gains optional 4th param `factor?: number \| null`. Bodyweight branch: `return bw * f + addedLoad` where `f = (factor != null && Number.isFinite(factor)) ? factor : 1`. Non-bodyweight branch unchanged (`return addedLoad`). Docstring updated to state the `bw*factor + addedLoad` formula + the coalesce-to-1.0-never-0 rule + Invariant L. (`:26-40`) |
| `src/utils/volume-target.ts` | edited | (a) `SetBodyweightInput` (`:17-22`) gains `factorByExerciseId: Map<string, number>`. (b) `ComputeVolumeTargetInput.bodyweight` (`:84-91`) gains `factorByExerciseId: Map<string, number>`. (c) All three `effectiveWeightKg(...)` calls — `sumPastVolume:115`, `sumLiveVolume:157`, `effWeightOf:248-252` — pass a 4th arg `bw.factorByExerciseId.get(s.exercise_id)`. (d) The two internal `sumPastVolume`/`sumLiveVolume` re-invocations inside `computeVolumeTarget` (`:208-213`, `:227-230`) forward `factorByExerciseId` alongside `equipmentByExerciseId`. |
| `src/utils/progress-page-math.ts` | edited | 5 sites (`:88,190,233,310,393`): each `effectiveWeightKg(row.exercises?.equipment, row.weight, bw)` gains 4th arg `row.exercises?.bodyweight_factor`. No structural change. |
| `src/utils/weekly-muscle-volume.ts` | edited | 1 site (`:121`): `effectiveWeightKg(ex.equipment, row.weight, bw)` gains 4th arg `ex.bodyweight_factor` (`ex` is the full `ExerciseRow` from `libById`). |
| `src/utils/weekly-volume-strip-math.ts` | edited | 1 site (`:91`): add 4th arg `row.exercises?.bodyweight_factor`. |
| `src/utils/exercise-session-row-format.ts` | edited | `presentExerciseSessionRow` input (`:49-59`) + `presentSetVolumeLines` input (`:115-123`) gain optional `factor?: number \| null`. `makeBwInput` (`:79-88`) gains a `factor` param and writes a one-entry `factorByExerciseId` map. `presentSetVolumeLines`'s inline call (`:132`) passes `factor ?? null` as the 4th arg. |

### ROW-fed consumers (read the widened row; no kernel change) — UI/hook
| File | Type | Change |
|---|---|---|
| `src/hooks/use-progress-page.ts` | edited | 1 site (`:296`): `effectiveWeightKg(r.exercises?.equipment, r.weight, bw)` gains 4th arg `r.exercises?.bodyweight_factor`. |
| `app/(app)/history/week/[isoWeek].tsx` | edited | 1 site (`:105`): add 4th arg `row.exercises?.bodyweight_factor`. |

### Full-`ExerciseRow`-fed + prop-fed consumers (column rides `select("*")`)
| File | Type | Change |
|---|---|---|
| `app/(app)/exercises/[id]/progress.tsx` | edited | (a) Volume reduce (`:206`): `effectiveWeightKg(equipment, set.weight, bw)` gains 4th arg `exercise.data?.bodyweight_factor`; add `exercise.data?.bodyweight_factor` to the `useMemo` deps (`:242`). (b) e1RM path (`:195-202`) UNCHANGED — Invariant D. (c) `presentSetVolumeLines(...)` call (`:326-337`) gains `factor: exercise.data?.bodyweight_factor ?? undefined`. (d) `<ExerciseSessionRow>` (`:349-356`) gains `factor={exercise.data?.bodyweight_factor ?? undefined}`. |
| `src/components/exercise-block.tsx` | edited | `<VolumeTargetSlot>` mount (`:245-252`) gains `factor={exercise.bodyweight_factor ?? undefined}` (`exercise` is the full `ExerciseRow`, `:19`). |
| `src/components/volume-target-slot.tsx` | edited | (a) `Props` (`:19-28`) gains `factor?: number`. (b) The `bodyweight` useMemo (`:63-90`) builds `factorByExerciseId = new Map([[exerciseId, factor ?? 1]])` alongside `equipmentByExerciseId`, and adds it to the returned object + the dep array (`:84-90` deps gain `factor`). (c) Both `presentSetVolumeLines(...)` calls (`:125-130`, `:200-205`) pass `factor`. |
| `src/components/exercise-session-row.tsx` | edited | (VERIFIED: this IS the wrapper `progress.tsx:349` mounts — `Props.equipment?` at `:20`, threaded into BOTH `presentExerciseSessionRow` `:59-64` and `presentSetVolumeLines` `:65-70`.) `Props` (`:15-26`) gains `factor?: number`; pass `factor` into both presenter calls (`:59-70`). |

### Schema / types / query (the one read-path touch)
| File | Type | Change |
|---|---|---|
| `src/db/schema.ts` | edited | Add `bodyweightFactor: numeric("bodyweight_factor")` to the `exercises` pgTable (`:46-71`). `numeric` is already imported (`:7`). Nullable (no `.notNull()`, no `.default`). |
| `src/db/types.ts` | edited | `ExerciseRow` (`:162-179`) gains `bodyweight_factor: number \| null`. (See Contracts note on `numeric` → JS type.) |
| `src/api/stats.ts` | edited | (a) Widen the `SELECT` constant (`:32-34`): `exercises!inner(equipment)` → `exercises!inner(equipment, bodyweight_factor)`. (b) `WeeklyVolumeRow.exercises` type (`:28`): `{ equipment: string }` → `{ equipment: string; bodyweight_factor: number \| null }`. |

### Migration (NOT auto-applied — Conductor/human runs `npm run db:push`)
| File | Type | Change |
|---|---|---|
| `supabase/migrations/0021_bodyweight_factor.sql` | new | Add nullable `bodyweight_factor numeric` column; idempotent canonical backfill of 7 rows (4 existing bodyweight + 3 reclassified); set `equipment='bodyweight'` on the 3 reclassified rows. See "Migration 0021 spec". |

### Tests
| File | Type | Change |
|---|---|---|
| `tests/unit/bodyweight.test.ts` | edited | Add a `describe("effectiveWeightKg — leverage factor")` block: identity (no arg / NULL / undefined / non-finite ⇒ 1.0), 0.64 push-up, 1.0 dip, addedLoad-never-scaled, NEVER-0 guard, non-bodyweight ignores factor. All existing cases (`:44-94`) re-pass unchanged (4-arity call with the 4th omitted). |
| `tests/unit/volume-target-factor.test.ts` (or extend an existing volume-target test) | new/edited | Cross-surface consistency: feed the SAME leveraged bodyweight set through `sumPastVolume` (MAP), a ROW-fed reduce, and `presentSetVolumeLines` (prop) and assert one number. Plus the e1RM-unchanged regression (see Test plan). |

## Contratos de I/O

### `effectiveWeightKg` — the one seam
```ts
export function effectiveWeightKg(
  equipment: string | null | undefined,
  weight: string | null,
  bodyweightKg: number | null,
  factor?: number | null, // NEW. absent / null / non-finite ⇒ coalesce to 1.0 (NEVER 0)
): number {
  const parsed = weight == null ? 0 : parseFloat(weight);
  const addedLoad = Number.isFinite(parsed) ? parsed : 0;
  if (equipment === "bodyweight") {
    const bw = bodyweightKg != null && Number.isFinite(bodyweightKg)
      ? bodyweightKg
      : 0;
    const f = factor != null && Number.isFinite(factor) ? factor : 1; // coalesce-to-1.0
    return bw * f + addedLoad; // addedLoad NEVER scaled
  }
  return addedLoad; // non-bodyweight never reads the factor
}
```
- **Invariant L:** with the 4th arg omitted, `f = 1`, so `bw * 1 + addedLoad === bw + addedLoad` (today's body). Byte-for-byte.
- **Coalesce-to-1.0-never-0:** the guard is `factor != null && Number.isFinite(factor) ? factor : 1`. A NULL, `undefined`, `NaN`, `Infinity`, or `-Infinity` factor ⇒ `1`, NOT `0`. (A `0` here would zero out every bodyweight volume — a silent catastrophic regression. The guard mirrors the existing `Number.isFinite(bodyweightKg)` posture at `:34`.)
- **Note on a legitimately-`0` factor in the DB:** the catalog backfill never writes `0` (min value is `0.50`). A hypothetical future `0` factor would correctly produce `0 * bw + addedLoad = addedLoad` — that is a *deliberate* stored value, distinct from the *missing/garbage* coalesce. The guard only catches `null`/non-finite, so a stored finite `0` is honored. This is correct: `0` is a valid (if unusual) leverage, NULL is "unknown ⇒ 1.0".

### `WeeklyVolumeRow` type + SELECT (the ROW-fed read path)
```ts
// src/api/stats.ts
export type WeeklyVolumeRow = {
  completed_at: string;
  weight: string | null;
  reps: number | null;
  set_type: SetType;
  exercise_id: string;
  session_id: string;
  exercises: { equipment: string; bodyweight_factor: number | null }; // +bodyweight_factor
  sessions: { started_at: string; ended_at: string };
};

const SELECT =
  "completed_at, weight, reps, set_type, exercise_id, session_id, " +
  "exercises!inner(equipment, bodyweight_factor), sessions!inner(started_at, ended_at)";
```
This single widen feeds all 8 ROW-fed sites (`progress-page-math` ×5, `weekly-volume-strip-math:91`, `use-progress-page:296`, `history/week/[isoWeek]:105`). They read `row.exercises?.bodyweight_factor`. The `!inner` join is unchanged (every set already requires an exercise row), so row-preservation is identical to Phase-0.

### `numeric` → JS type (load-bearing — verify in implementation)
PostgREST returns `numeric` columns as **JSON numbers** when read via `select` (so `row.exercises.bodyweight_factor` arrives as `number | null`, directly usable by `effectiveWeightKg`). However, the supabase-js typing and the `as unknown as WeeklyVolumeRow[]` cast at `stats.ts:68,92` mean the TS type is whatever we declare. **Decision: declare `bodyweight_factor: number | null`.** If PostgREST is observed to return the value as a *string* (`"0.64"`) — which it does for some `numeric` configs — then `effectiveWeightKg`'s `Number.isFinite(factor)` guard would coalesce a string to `1.0` (a `string` is not a finite `number`), silently dropping the factor. **This is the #1 thing to verify at implementation/test time** (see Risks R-2 + Test plan): assert against the live query shape, and if `numeric` arrives as a string, either (a) declare the type `string | null` and `parseFloat` at the read sites, or (b) cast in the SELECT. Phase-0 dodged this because `equipment` is `text`. The `ExerciseRow.bodyweight_factor` from `select("*")` has the same question. Drizzle's `numeric(...)` maps to `string` by default in its own types, but the app's `ExerciseRow` is a hand-written type in `db/types.ts`, not inferred from Drizzle — so we control it. **Recommended:** treat the factor as possibly-string at the read boundary by passing it through a tiny coalescing read, OR (cleaner) make `effectiveWeightKg` accept `number | string | null` and `parseFloat` a string internally. See Alternatives #3.

### `SetBodyweightInput` + `ComputeVolumeTargetInput.bodyweight` (the MAP-fed contract)
```ts
// src/utils/volume-target.ts
export type SetBodyweightInput = {
  equipmentByExerciseId: Map<string, string>;
  factorByExerciseId: Map<string, number>; // NEW. exercise_id → leverage factor. Missing key ⇒ effectiveWeightKg coalesces to 1.0.
  bodyweightKg: number | null;
};

// ComputeVolumeTargetInput.bodyweight:
bodyweight?: {
  equipmentByExerciseId: Map<string, string>;
  factorByExerciseId: Map<string, number>; // NEW
  liveBodyweightKg: number | null;
  pastBodyweightBySession: Map<string, number | null>;
};
```
Inside the kernels, the 4th arg is `bw.factorByExerciseId.get(s.exercise_id)` — `Map.get` returns `undefined` for a missing key, which `effectiveWeightKg` coalesces to `1.0`. So a partially-populated map is safe (a non-bodyweight exercise can be absent from the factor map with no harm — it never reads the factor anyway).

### `factorByExerciseId` BUILD SITE (pinned — Discovery left this unpinned)
The ONLY caller that builds `bodyweight.equipmentByExerciseId` for `computeVolumeTarget` is **`src/components/volume-target-slot.tsx:63-90`** (the `bodyweight` useMemo). It builds a one-entry `equipmentByExerciseId = new Map([[exerciseId, equipment]])` (`:65-67`). The factor map is built at the SAME spot:
```ts
// volume-target-slot.tsx, inside the `bodyweight` useMemo (replaces :65-67 region):
const equipmentByExerciseId = new Map<string, string>([[exerciseId, equipment]]);
const factorByExerciseId = new Map<string, number>([[exerciseId, factor ?? 1]]);
// ... return { equipmentByExerciseId, factorByExerciseId, liveBodyweightKg, pastBodyweightBySession };
```
`factor` is a NEW prop on `<VolumeTargetSlot>` (`Props.factor?: number`), threaded from its only caller — **`src/components/exercise-block.tsx:245-252`**, which already holds the full `exercise: ExerciseRow` and passes `equipment={exercise.equipment ?? undefined}`; it adds `factor={exercise.bodyweight_factor ?? undefined}`. The factor thus rides the full `ExerciseRow` (free via `select("*")`), exactly as `equipment` does — there is NO separate fetch. (Add `factor` to the `bodyweight` useMemo dep array at `volume-target-slot.tsx:84-90`.)

**Closed-set proof for the MAP path:** `computeVolumeTarget` is consumed by exactly one component (`volume-target-slot.tsx:94`). `sumPastVolume`/`sumLiveVolume`'s `SetBodyweightInput` is also built by `exercise-session-row-format.ts:makeBwInput` (the prop-fed path) — both build sites are in the wiring table. There is no third `SetBodyweightInput` builder. (Implementer must `grep -rn "equipmentByExerciseId\|factorByExerciseId\|SetBodyweightInput\|computeVolumeTarget(" app/ src/` to confirm no N+1th builder before finishing.)

### Prop chain (`presentSetVolumeLines` / `presentExerciseSessionRow`)
```ts
// exercise-session-row-format.ts
export function presentExerciseSessionRow(input: {
  sets: SetRow[];
  unit: WeightUnit;
  equipment?: string;
  factor?: number | null; // NEW — same source as equipment (exercise.bodyweight_factor)
  bodyweightKg?: number | null;
}): ExerciseSessionRowPresentation { /* makeBwInput(sets, equipment, factor, bodyweightKg) */ }

export function presentSetVolumeLines(input: {
  sets: SetRow[];
  unit: WeightUnit;
  equipment?: string;
  factor?: number | null; // NEW
  bodyweightKg?: number | null;
}): SetVolumeLine[] { /* effectiveWeightKg(equipment, s.weight, bodyweightKg ?? null, factor ?? null) */ }

function makeBwInput(
  sets: SetRow[],
  equipment: string | undefined,
  factor: number | null | undefined, // NEW
  bodyweightKg: number | null | undefined,
): SetBodyweightInput | undefined {
  if (equipment === undefined) return undefined;
  const equipmentByExerciseId = new Map<string, string>();
  const factorByExerciseId = new Map<string, number>();
  for (const s of sets) {
    equipmentByExerciseId.set(s.exercise_id, equipment);
    factorByExerciseId.set(s.exercise_id, factor ?? 1);
  }
  return { equipmentByExerciseId, factorByExerciseId, bodyweightKg: bodyweightKg ?? null };
}
```
Prop-fed callers and their factor source:
- `progress.tsx:326-337` `presentSetVolumeLines(...)` → `factor: exercise.data?.bodyweight_factor ?? undefined`.
- `progress.tsx:349` `<ExerciseSessionRow ... />` → `factor={exercise.data?.bodyweight_factor ?? undefined}` → `exercise-session-row.tsx:59-70` forwards into `presentExerciseSessionRow` + `presentSetVolumeLines`.
- `volume-target-slot.tsx:125-130,200-205` `presentSetVolumeLines(...)` → `factor: factor` (the new prop).

### `ExerciseRow` (full-row-fed sites)
```ts
// src/db/types.ts
export type ExerciseRow = {
  id: string;
  user_id: string | null;
  name: string;
  muscles: string[];
  equipment: string | null;
  bodyweight_factor: number | null; // NEW — rides select("*") on every read path
  notes: string | null;
  source: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};
```
Sites #9 (`weekly-muscle-volume.ts:121` via `libById`) and #12 (`progress.tsx:206` via `useExercise`) read `ex.bodyweight_factor` / `exercise.data?.bodyweight_factor` for free. **No API change** — `createExercise`/`updateExercise` field lists are NOT touched (U2: backend-only, no write path).

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
-- change as Phase 0). This changes historical PRs/max-volume for those three.
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
- **`add column ... numeric` nullable, no default.** Justification: NULL is the "unknown ⇒ coalesce to 1.0" sentinel, identical in effect to a `1.0` default for every non-backfilled row, but semantically honest (it says "no leverage value set" not "leverage is exactly 1.0"). A `default 1.0` would also work numerically, but (a) it would write `1.0` to all ~95 rows including non-bodyweight ones where the value is meaningless, and (b) NULL-vs-stored-1.0 lets a future UI distinguish "unset" from "explicitly 1.0". The app's coalesce-to-1.0 guard makes NULL safe regardless. `add column if not exists` makes step 1 idempotent.
- **Type `numeric`** (not `numeric(3,2)` or `real`): matches the `max_volume_window` numeric-tuning-column precedent and avoids a precision/scale CHECK the feature doesn't need. The Drizzle schema uses bare `numeric("bodyweight_factor")`.
- **No CHECK constraint** on the factor range (e.g. `>= 0`). Justification: the app's coalesce handles garbage at read time; a CHECK would only guard the (out-of-scope) write path, which doesn't exist (U2). Out of scope; noted for a future UI-editor migration.

**Name-matching strategy + the EXACT-NAME verification (LOAD-BEARING — see R-5):**
The 7 names above are taken from **Discovery's live-catalog inventory** (`discovery.md:60-69`, verified via the anon client against project `ykrbgpctbfvndxjnpzrg`): the 4 existing bodyweight rows are `Chin-up` (hyphen), `Dip`, `Hanging Leg Raise`, `Push-up` (hyphen); the 3 reclassified rows are `Pull Up` (space), `Chest Dip`, `Hanging Knee Raise`. **I (Designer) could NOT re-run the live query — the DB tool is not in my whitelist; Discovery's anon-client read is the source.** Therefore the Implementer (who has Bash + DB access) MUST, before applying, run a verification query and confirm each `UPDATE` matched exactly one canonical row:
```sql
select name, equipment, user_id, deleted_at from public.exercises
where user_id is null and deleted_at is null
  and name in ('Push-up','Dip','Chin-up','Pull Up','Chest Dip','Hanging Leg Raise','Hanging Knee Raise')
order by name;
-- Expect 7 rows. If any name returns 0 rows, the canonical string differs
-- (case/whitespace/hyphen) — do NOT guess; re-query with ilike/trim to find
-- the true string and fix the migration. The id-keyed column survives renames,
-- but the BACKFILL is name-matched, so a name miss = a silent un-backfilled row
-- (factor stays NULL ⇒ 1.0 ⇒ that exercise keeps full-BW volume, NOT the intended
-- leverage). This is the one place a typo ships a wrong number silently.
```
The migration uses exact `name = '...'` (not `ilike`) so it is strict and idempotent. If verification shows a different canonical string, the Implementer corrects the literal in the migration. The Validator should scrutinize this as the top risk.

## Identity / back-compat
- **Factor 1.0 / NULL / absent ⇒ today's numbers (Invariant L).** Proven by construction: the only new code is the `* f` multiply, and `f = 1` is the identity. Every non-bodyweight row, every user-owned row (all NULL today — zero user-owned bodyweight exercises exist), and every kernel call with the 4th arg omitted reproduces Phase-0 output byte-for-byte.
- **Existing `tests/unit/bodyweight.test.ts:44-94` stay green unchanged.** They call `effectiveWeightKg` with 3 args; the 4th defaults to `undefined` ⇒ `f = 1`. E.g. `effectiveWeightKg("bodyweight","0",80) === 80` still holds (`80 * 1 + 0`).
- **Coalesce-to-1.0-NEVER-0 guard** (`factor != null && Number.isFinite(factor) ? factor : 1`): NULL, undefined, NaN, ±Infinity ⇒ 1.0. A stored finite `0` is honored as a deliberate value (catalog never writes 0; min is 0.50).
- **Legacy mixed-case `"Bodyweight"`** still never triggers the bodyweight branch (`bodyweight.ts:33` exact-token gate) ⇒ never reads a factor. Unchanged (`bodyweight.test.ts:82-84` re-passes).
- **e1RM unchanged** — the factor never touches `epley1RM` (Invariant D). See e1RM exclusion below.

## e1RM exclusion (Invariant D holds)
The factor must NOT reach either e1RM path:
- `app/(app)/exercises/[id]/progress.tsx:195-202` — `w = parseFloat(set.weight)` → `epley1RM(w, r)`. This block is UNTOUCHED; the factor change lands only on the *separate* volume reduce at `:206` (the two-variable split Phase-0 introduced as MAJ-2). The `useMemo` dep add (`bodyweight_factor`) does not change the e1RM output because the e1RM branch never reads the factor.
- `src/utils/e1rm-strength.ts:14-17,146-150` — logged-weight-only; UNTOUCHED.

**Regression assertion (Test plan):** for a bodyweight set with a factor set (e.g. push-up 0.64, bodyweight 80, logged weight 0), assert `epley1RM`-derived e1RM is identical with and without the factor — i.e. the e1RM path produces NO point for a 0-logged-weight set regardless of factor (Invariant D), and for a weighted bodyweight set (logged weight 20) the e1RM derives from `20` only, independent of the factor.

## Edge cases / behaviors to test
1. **Push-up at 0.64:** `effectiveWeightKg("bodyweight","0",80,0.64) === 51.2` (`80 * 0.64 + 0`).
2. **Push-up with added load:** `effectiveWeightKg("bodyweight","10",80,0.64) === 61.2` (`80*0.64 + 10` — addedLoad NOT scaled; NOT `(80+10)*0.64 = 57.6`).
3. **Dip at 1.0 = today:** `effectiveWeightKg("bodyweight","0",80,1.0) === 80` (identical to Phase-0).
4. **Weighted dip:** `effectiveWeightKg("bodyweight","30",80,1.0) === 110` (`80*1 + 30`; the belt's 30 kg is leveraged at 1.0, i.e. unscaled).
5. **Reclassified-three retroactive:** after migration, a historical `Pull Up` set (bw 80, reps 8, equipment now 'bodyweight', factor 1.0) contributes `80*1*8 = 640` kg where it contributed `0` before. (Cannot unit-test the migration directly; assert at the kernel level that an `equipment='bodyweight'` row with factor 1.0 produces bodyweight volume, and verify post-apply via the backfill query.)
6. **NULL factor ⇒ 1.0:** `effectiveWeightKg("bodyweight","0",80,null) === 80`.
7. **undefined / absent factor ⇒ 1.0:** `effectiveWeightKg("bodyweight","0",80) === 80` (Invariant L identity).
8. **Non-finite factor ⇒ 1.0:** `effectiveWeightKg("bodyweight","0",80,NaN) === 80`; same for `Infinity`, `-Infinity`.
9. **Stored finite 0 honored:** `effectiveWeightKg("bodyweight","10",80,0) === 10` (`80*0 + 10` — deliberate, distinct from NULL).
10. **Non-bodyweight ignores factor:** `effectiveWeightKg("barbell","100",80,0.64) === 100` (factor never read off the bodyweight branch).
11. **e1RM unchanged** (Invariant D) — see e1RM exclusion.
12. **Cross-surface consistency:** the SAME leveraged push-up set (bw 80, factor 0.64, reps 10) yields `512` kg through `sumPastVolume` (MAP path with `factorByExerciseId`), through a ROW-fed reduce (`row.exercises.bodyweight_factor = 0.64`), and through `presentSetVolumeLines` (prop `factor = 0.64`). One number on strip / muscle-chart / history-row / progress.

## Riscos
- **R-1 Data integrity — RETROACTIVE volume shift for the 3 reclassified movements (Confidence HIGH, Risk MEDIUM, visibility HIGH).** Reclassifying `Pull Up`, `Chest Dip`, `Hanging Knee Raise` to `equipment='bodyweight'` makes them count `bodyweight*factor*reps` volume on ALL historical sessions where today they count `0`. This changes per-session max-volume PRs, the weekly strip, the per-muscle chart, the Progress page totals, and the History week headlines for any user who logged those movements. Same class of retroactive change Phase-0 introduced for the original 4; intended (U3) but high-visibility. Mitigation: the migration comment calls it out; the human locked it; the change is deterministic and reversible (set `equipment=null` + `bodyweight_factor=null` to revert). No data is destroyed.
- **R-2 Data integrity — `numeric` JSON shape (string vs number) (Confidence MEDIUM, Risk MEDIUM).** If PostgREST returns `bodyweight_factor` as a *string* (`"0.64"`), `effectiveWeightKg`'s `Number.isFinite(string)` is `false` ⇒ coalesce to `1.0` ⇒ the factor is SILENTLY DROPPED (push-ups stay at full BW, the feature appears to do nothing). The most likely silent-failure mode. Mitigation: the Implementer/Tester MUST verify the runtime shape of the field from the live query (both the `WeeklyVolumeRow.exercises.bodyweight_factor` join read AND the `ExerciseRow.bodyweight_factor` `select("*")` read); if string, adopt Alternatives #3 (accept `number | string` at the seam + `parseFloat` internally). Pinned as the #1 implementation verification.
- **R-3 Data integrity — NEVER-0 coalesce (Confidence HIGH, Risk HIGH if wrong).** A coalesce to `0` instead of `1.0` would zero every bodyweight volume app-wide. The guard is explicit and unit-tested (cases 6-8). Low probability given the test, but catastrophic if it regresses.
- **R-4 UX regression — shared kernel blast radius (Confidence HIGH, Risk LOW).** All 14 sites share `effectiveWeightKg`; a wrong 4th-arg wiring at any one site desyncs that surface from the others. Mitigation: the closed-set wiring table + the cross-surface consistency test (case 12) + the "same number everywhere" invariant. The factor is `undefined`/`1.0` for every non-leveraged exercise, so unaffected surfaces are byte-for-byte unchanged.
- **R-5 UX regression — name-match miss leaves a row un-backfilled (Confidence MEDIUM, Risk MEDIUM).** If a canonical name differs from the literal (case/whitespace/hyphen), that `UPDATE` matches 0 rows, the factor stays NULL ⇒ 1.0, and that exercise silently keeps full-BW volume (e.g. push-ups never drop to 0.64). Mitigation: the mandatory pre-apply verification query (expect exactly 7 rows). This is the top Validator scrutiny item.
- **R-6 Platform divergence (Confidence HIGH, Risk LOW).** Pure arithmetic + a column read; no iOS/Android/web divergence. No native modules, no SVG, no platform APIs touched.
- **R-7 Performance (Confidence HIGH, Risk LOW).** One `Map.get` (MAP path) or one already-fetched column read (ROW/full-row path) per set; the SELECT adds one column to an existing `!inner` join. Negligible — no new query, no new round-trip, no extra scan.

## Alternativas descartadas
1. **Code map (`Record<canonical-name, number>`)** — descartada (locked U1) because it is name-keyed (rename-fragile — the catalog has `Chin-up` vs `Pull Up` inconsistency), ignores user-owned bodyweight rows, and can't reach a UI editor without a later rewrite. Tradeoff noted: the map would need zero migration/schema/SELECT change for a 7-row catalog — cheaper today, but the human chose the id-keyed, owned-row-covering, UI-future-proof column.
2. **`default 1.0` on the column instead of nullable-no-default** — descartada because it writes a meaningless `1.0` to all ~95 rows (incl. non-bodyweight), and erases the "unset vs explicitly-1.0" distinction a future UI wants; the app's coalesce makes NULL behave identically to a 1.0 default at read time, so the default buys nothing and costs semantic clarity.
3. **Keep `effectiveWeightKg`'s 4th arg strictly `number | null` (reject string)** — partially descartada / FLAGGED. If the live `numeric` reads back as a string, the strict-`number` signature silently coalesces it to 1.0 (R-2). The safer alternative is to type the 4th arg `number | string | null` and `parseFloat` a string inside the guard. Recommendation: keep the strict signature ONLY if the Implementer verifies `numeric` reads as a JS number; otherwise widen to accept string. Documented so the Implementer makes the call against the live shape, not a guess.
4. **`(bw + addedLoad) * factor` (scale the whole load)** — descartada (locked U4) because the belt/vest addedLoad is a true external load; scaling it would under-count a weighted dip. The formula is `bw*factor + addedLoad`.
5. **Add the factor to the API write path / a UI Controller now** — descartada (locked U2: backend-only). Zero user-owned bodyweight exercises exist, so a UI editor has no user to serve yet; the 4 canonical defaults + 3 reclassified deliver the entire value. Deferred (Out of scope).
6. **Apply the migration as part of this run / auto-apply** — descartada because the playbook + Phase-0 precedent have the Conductor/human run `npm run db:push`; the Implementer writes the SQL but does not apply it (matches `0011`/`0020` handling).
7. **A separate `factorByExerciseId` fetch hook for `volume-target-slot`** — descartada because the factor rides the full `ExerciseRow` that `exercise-block.tsx` already holds (free via `select("*")`); a new fetch would duplicate data and add a round-trip. It threads as a prop exactly like `equipment`.
8. **CHECK constraint `bodyweight_factor >= 0` (or `> 0`)** — descartada because it only guards the (out-of-scope) write path; the app's read-time coalesce handles garbage. Noted for a future UI-editor migration.
9. **Reclassify the 3 movements in a SEPARATE migration from the factor backfill** — descartada because the factor for `Pull Up`/`Chest Dip`/`Hanging Knee Raise` is only meaningful once they are `equipment='bodyweight'`; splitting them risks a window where a reclassified row has no factor (still safe — NULL ⇒ 1.0 — but two migrations to manage). One migration keeps the reclassify + backfill atomic (U3 locked them together).

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
- No new query, no new fetch, no new hook — the factor rides existing reads (`select("*")` + the one widened `stats.ts` SELECT).
- No write-path / zod / `ExerciseInput` / Controller change.
- No per-site arithmetic — the factor multiplies ONLY inside `effectiveWeightKg`.
