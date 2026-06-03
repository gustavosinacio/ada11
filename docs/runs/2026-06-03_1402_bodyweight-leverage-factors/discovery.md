# Discovery — 2026-06-03_1402_bodyweight-leverage-factors

## Feature prompt
"Bodyweight leverage factors — per-exercise fraction of bodyweight (push-up ≈ 0.64 BW, pull-up/dip ≈ 1.0 BW) instead of the full-BW approximation. (refines Phase 0)"

## Scope summary
Phase-0 (`docs/runs/2026-05-30_0126_bodyweight-volume-per-muscle/`) made volume bodyweight-aware via ONE arithmetic seam, `effectiveWeightKg(equipment, weight, bodyweightKg)` in `src/utils/bodyweight.ts:26-40`: for `equipment === "bodyweight"` it returns `(bodyweightKg ?? 0) + addedLoad` — the FULL bodyweight is the moved load. This feature replaces "full BW" with a per-exercise LEVERAGE FACTOR, so the contribution becomes `(bodyweightKg × factor) + addedLoad` (push-up ≈ 0.64, dip ≈ 1.0). It is fundamentally a one-seam refinement plus two design questions: WHERE the factor lives (code map vs DB column) and whether users can edit it. e1RM is explicitly out of scope (logged-weight metric).

## Affected files (verified)
- `src/utils/bodyweight.ts:26-40` — the seam `effectiveWeightKg`; gains an optional `factor` param (1.0 identity).
- `src/utils/volume-target.ts:84-91,115,157,248` — MAP-fed kernels (`sumPastVolume`/`sumLiveVolume`/`effWeightOf`); factor rides a sibling map on the `bodyweight` input.
- `src/utils/progress-page-math.ts:88,190,233,310,393` — five ROW-fed kernel sites; read factor off the widened `WeeklyVolumeRow.exercises`.
- `src/utils/weekly-muscle-volume.ts:121` — ROW + `libById` `ExerciseRow`; reads factor off the full `ExerciseRow`.
- `src/utils/weekly-volume-strip-math.ts:91` — ROW-fed; widened row.
- `src/hooks/use-progress-page.ts:296` — ROW-fed (`nowKgByExercise`); widened row.
- `app/(app)/exercises/[id]/progress.tsx:206` — per-exercise volume reduce; reads `exercise.data` `ExerciseRow`. (`:198-202` e1RM path stays UNCHANGED.)
- `app/(app)/history/week/[isoWeek].tsx:105` — headline `weekVolumeKg`; widened row.
- `src/utils/exercise-session-row-format.ts:115-138` (`presentSetVolumeLines`) + `presentExerciseSessionRow` — scalar-prop-fed; gain an optional `factor` prop/arg.
- `src/api/stats.ts:18-34` — `WeeklyVolumeRow` type + `SELECT` constant; widen `exercises!inner(equipment)` → `(equipment, bodyweight_factor)` (only if column option chosen).
- `src/db/schema.ts:46-71` + `src/db/types.ts:162-179` — add `bodyweight_factor` to Drizzle schema + `ExerciseRow` (only if column option).
- `src/api/exercises.ts:4-9,60-97` — `ExerciseInput` + create/update field lists (only if UI/owned-editable in scope).
- `app/(app)/exercises/[id]/index.tsx:29-39,229-240` + `app/(app)/exercises/new.tsx:15-25,93-104` — zod schema + a numeric Controller under EquipmentPicker (only if UI in scope).
- `supabase/migrations/0021_*.sql` — NEW migration: add nullable column + backfill the 4 canonical bodyweight rows (only if column option). Latest is `0020_user_exercise_favorites.sql`.
- `tests/unit/bodyweight.test.ts:44-94` — extend `effectiveWeightKg` cases with factor; add e1RM-unchanged regression elsewhere.

## The arithmetic seam (FACT — verified by reading)
- `effectiveWeightKg` (`src/utils/bodyweight.ts:26-40`): `parsed = parseFloat(weight)`; `addedLoad = finite(parsed) ? parsed : 0`; gate `if (equipment === "bodyweight") return bw + addedLoad` (bw = finite `bodyweightKg` else 0); else `return addedLoad`.
- **Where the factor multiplies in:** the bodyweight branch becomes `return bw * factor + addedLoad`. **Identity = 1.0** (absent/null factor ⇒ coalesce to 1.0) ⇒ byte-for-byte today's numbers. Mirrors Phase-0's optional-param discipline (`windowStartMs?`, optional `bodyweight`).
- **Invariant for the design:** a non-bodyweight row never reads the factor; a bodyweight row with factor 1.0 ⇒ identical to today; **addedLoad (weighted vest / dip belt) is NEVER scaled** — only the bodyweight component is leveraged. (HIGH confidence — the prompt's `(bodyweightKg × leverageFactor) + addedLoad` confirms it.)
- NaN/finite discipline must hold: a non-finite factor coalesces to 1.0 (same posture as the existing `Number.isFinite` guards on weight + bodyweightKg).

## Close-the-set kernel inventory (exhaustive-by-construction)
Method: `grep -rn "effectiveWeightKg" app/ src/ tests/` (all call sites) + a negative-space grep for inline weight kernels NOT routed through the seam (`parseFloat(.*weight)` / `epley1RM`). Every volume number in the app routes through `effectiveWeightKg`; the ONLY un-routed `parseFloat(weight)` sites are the two e1RM paths (excluded by design) and the `else`-branch logged-weight fallbacks INSIDE the kernels already listed. **No N+1th volume site exists.**

| # | Call site | How it gets `equipment` today | How the factor rides in |
|---|---|---|---|
| 1 | `volume-target.ts:115` (`sumPastVolume`) | `bw.equipmentByExerciseId.get(s.exercise_id)` (MAP) | sibling `factorByExerciseId.get(id)` on the same `bodyweight` input |
| 2 | `volume-target.ts:157` (`sumLiveVolume`) | same MAP | same |
| 3 | `volume-target.ts:248` (`effWeightOf`, currentWeight pick) | same MAP | same |
| 4 | `progress-page-math.ts:88` | `row.exercises?.equipment` (ROW) | `row.exercises?.bodyweight_factor` |
| 5 | `progress-page-math.ts:190` | ROW | same |
| 6 | `progress-page-math.ts:233` | ROW | same |
| 7 | `progress-page-math.ts:310` (`computeSessionVolumes`) | ROW | same |
| 8 | `progress-page-math.ts:393` | ROW | same |
| 9 | `weekly-muscle-volume.ts:121` | `ex.equipment` from `libById.get(...)` (full `ExerciseRow`) | `ex.bodyweight_factor` (already holds full row) |
| 10 | `weekly-volume-strip-math.ts:91` | `row.exercises?.equipment` (ROW) | row field |
| 11 | `use-progress-page.ts:296` (nowKgByExercise) | `r.exercises?.equipment` (ROW) | row field |
| 12 | `app/(app)/exercises/[id]/progress.tsx:206` (per-exercise reduce) | `exercise.data?.equipment` (single `ExerciseRow`) | `exercise.data?.bodyweight_factor` |
| 13 | `app/(app)/history/week/[isoWeek].tsx:105` (headline `weekVolumeKg`) | `row.exercises?.equipment` (ROW) | row field |
| 14 | `exercise-session-row-format.ts:132` (`presentSetVolumeLines`) | scalar `equipment` PROP (from caller) | NEW optional `factor` prop, same path |
| — | `exercise-session-row-format.ts` `presentExerciseSessionRow` | scalar `equipment` arg | NEW optional `factor` arg (sibling of `equipment`) |

Three threading shapes (this IS the wiring problem):
- **MAP-fed (1-3):** `volume-target.ts:84-91` carries `bodyweight.equipmentByExerciseId: Map<string,string>`. Factor rides a parallel `factorByExerciseId: Map<string,number>` built by the same caller. (Designer should grep `computeVolumeTarget` callers to pin the build site — not located in this pass.)
- **ROW-fed (4-8, 10, 11, 13):** consume `WeeklyVolumeRow` whose `exercises` sub-object is `{ equipment: string }` (`stats.ts:18-30`). Widen the `stats.ts` SELECT `exercises!inner(equipment)` → `(equipment, bodyweight_factor)`.
- **Full-`ExerciseRow`-fed (9, 12):** `weekly-muscle-volume.ts` (`libById`/`useAllExercises`) + `progress.tsx` (`useExercise`) already hold the full row — a new column rides `select("*")` (`api/exercises.ts:11-58`) with ZERO query change.
- **Prop-fed (14):** `presentSetVolumeLines` / `presentExerciseSessionRow` take a scalar `equipment?` from `progress.tsx:332,353`; a new optional `factor?` threads the same way.

## Where the factor comes from — THE central decision (options + tradeoffs)
Live catalog inventory (read-only query via anon client against project `ykrbgpctbfvndxjnpzrg`, `deleted_at IS NULL`): **95 visible exercises; equipment distribution `{null:61, barbell:7, dumbbell:9, bodyweight:4, machine:8, cable:6}`. Exactly 4 rows have `equipment = "bodyweight"`, all canonical (`user_id IS NULL`), none deleted:**

| name | equipment | suggested factor |
|---|---|---|
| Chin-up | bodyweight | ≈ 1.0 |
| Dip | bodyweight | ≈ 1.0 |
| Hanging Leg Raise | bodyweight | ≈ 0.x — NOT given by prompt (product decision) |
| Push-up | bodyweight | ≈ 0.64 |

**LOAD-BEARING FINDING (FACT):** the prompt's headline "pull-up ≈ 1.0 BW" does NOT apply to the live catalog as-gated: **"Pull Up" has `equipment = null`, NOT "bodyweight"** (verified). So Pull Up counts ZERO bodyweight today and gets NO factor under any equipment-gated scheme. Same for "Chest Dip" and "Hanging Knee Raise" (both `equipment = null`). Only 4 exercises are in the bodyweight regime. (Same canonical-catalog-vs-seed nuance the e1rm-strength-chart retro flagged: the live `user_id IS NULL` catalog is the source of truth, not the `0001` seed.)

Options:
- **(a) Hardcoded per-exercise map in code** (`Record<canonical-name, number>` in `db/types.ts`). PRO: no migration, no query change, trivially testable, only 4 entries. CON: name-keyed (rename breaks it); ignores user-OWNED bodyweight exercises (fall to 1.0); not user-editable.
- **(b) Per-EQUIPMENT default.** REJECT — too coarse: push-up (0.64) and dip (1.0) are both "bodyweight". Eliminated by the data.
- **(c) NEW nullable `bodyweight_factor numeric` column** backfilled on the 4 canonical rows via a migration mirroring `0014` (NULL ⇒ 1.0). PRO: per-exercise, id-keyed (survives renames), rides `select("*")` on single-row sites, only `stats.ts` SELECT widens; covers user-owned bodyweight rows; future-proofs the UI option. CON: migration + schema/types + SELECT-widening + the `volume-target` map. Migration number **0021** (latest `0020`).
- **(d) Hybrid** (code defaults + column override) — over-engineered for 4 rows.

**Recommended default (MEDIUM confidence): option (c) the nullable column, NULL ⇒ 1.0.** Only option that is id-keyed, covers owned rows, rides Phase-0's seam, and reaches the UI option without a 2nd migration; the backfill is 4 rows. The competing case for (a): if the human wants ZERO migration AND ZERO UI, a 4-entry name-keyed map is the cheapest refinement — at the cost of ignoring owned rows + rename fragility. **This is the #1 question for the human/Designer.**

## Identity / back-compat (FACT)
- **Reproduce today exactly:** factor 1.0 (NULL/absent ⇒ 1.0). Existing `tests/unit/bodyweight.test.ts:44-94` (`effectiveWeightKg("bodyweight","0",80) === 80`, etc.) must still pass with factor defaulting to 1.0.
- **User-owned bodyweight exercises:** ZERO exist today. Under (c) a NULL factor ⇒ 1.0 ⇒ identical to today; under (a) they fall to 1.0. Invariant holds either way.
- **Unknown / NULL / non-finite factor ⇒ coalesce to 1.0, NEVER 0** (0 would zero out every bodyweight volume — silent catastrophic regression). Guard mirrors `Number.isFinite(bodyweightKg)` at `bodyweight.ts:34`.
- **Legacy mixed-case "Bodyweight":** still does NOT trigger the addend (`bodyweight.ts:33` exact-token gate; `bodyweight.test.ts:82-84`) ⇒ never reads a factor. Unchanged.

## e1RM exclusion (FACT — confirmed)
e1RM stays LOGGED-weight-only; leverage does NOT apply. Two e1RM sites, both un-routed through `effectiveWeightKg` by design:
- `app/(app)/exercises/[id]/progress.tsx:195-202` — `w = parseFloat(set.weight)` → `epley1RM(w,r)`; comment "e1RM — logged weight ONLY … out of scope for bodyweight (Invariant D)".
- `src/utils/e1rm-strength.ts:14-17,146-150` — "Invariant D — LOGGED weight only … NOT `effectiveWeightKg`." A 0-weight bodyweight set yields NO e1RM point.
**The factor must NOT touch either path.** A weighted dip's e1RM derives from logged added load only and does not change. Add a regression assertion (e1RM unchanged for a bodyweight set when a factor is set).

## Where users would SEE / EDIT a factor (#6)
- Edit form `app/(app)/exercises/[id]/index.tsx` — react-hook-form + zod (`:29-39`), Controllers (`:202-255`), `EquipmentPicker` at `:229-240`. A `bodyweight_factor` numeric field would sit under EquipmentPicker, ideally shown only when `equipment === "bodyweight"`.
- Create form `app/(app)/exercises/new.tsx` — same zod shape (`:15-25`), same Controllers.
- Read-only canonical view (`index.tsx:141-192`): non-admins see canonical rows read-only. **Canonical rows are app-immutable for non-admins** (RLS `exercises_update` scoped to `auth.uid() = user_id`, `0011`; admins via `0018`). So a user-set factor applies only to USER-OWNED bodyweight exercises; the 4 canonical ones get their factor from the backfill (or admin edit).
- API/zod: `ExerciseInput` (`api/exercises.ts:4-9`) + both zod schemas gain the field; `createExercise`/`updateExercise` pass explicit field lists, so a new write field must be added there (NOT auto via `select("*")`, which is read-only).

**Recommended scope (MEDIUM confidence): START backend-only — canonical defaults via the backfill, NO UI field.** The value (correct push-up vs dip volume) is delivered entirely by the 4 canonical defaults; with zero user-owned bodyweight exercises, a UI editor has no user to serve yet. Defer the per-exercise UI field. If the human wants UI now it's contained (one numeric Controller on two forms + zod + `ExerciseInput`) but expands the test surface + the admin/RLS story. **This is the #2 question for the human.**

## Data source for the factor VALUES (#7)
- Prompt gives push-up ≈ 0.64, dip/pull-up ≈ 1.0. Of these only **Push-up** and **Dip** are in the live bodyweight set; **Chin-up** (≈1.0, biomech-equivalent to pull-up) is in; **Pull-up is `equipment=null`** so moot.
- **Hanging Leg Raise** (4th) has NO prompt value — a hanging core lever; defensibly well below 1.0 but **a product/human decision**, not a fact I can verify.
- Literature values exist (push-up ≈ 0.64-0.69 BW by hand position; dip/chin-up ≈ 1.0) but the EXACT shipped numbers are a product call. **The Designer should treat the 4 factor values as human-supplied inputs, not derive them.**

## Relevant conventions (verified by reading code)
- **One seam, "same number everywhere"** (`bodyweight.ts:5-9`): the factor must enter ONLY at `effectiveWeightKg` — no per-site arithmetic. (FACT)
- **Optional-param back-compat discipline:** Phase-0/window kernels add behavior behind an optional param that, when absent, reproduces the old path byte-for-byte (`volume-target.ts:76-92`, `progress-page-math.ts:284`). The factor must follow this. (FACT)
- **Equipment is `string` not `Equipment` at the kernel boundary** (`stats.ts:25-28`) — legacy rows may hold arbitrary strings; the `=== "bodyweight"` test is the canonical gate. Factor lookup must be equally defensive (null/non-finite ⇒ 1.0). (FACT)
- **`select("*")` for exercises** (`api/exercises.ts:11,22,37,50`) ⇒ a new column is auto-read on `ExerciseRow`-fed sites; only `stats.ts:32-34`'s explicit `exercises!inner(equipment)` must widen. (FACT)
- **Migration shape:** hand-written SQL in `supabase/migrations/`, `npm run db:push`. `0014` is the precedent for "alter/backfill canonical (`user_id IS NULL`, `deleted_at IS NULL`) rows by name, idempotent UPDATEs." Next number: **0021**. (FACT)
- **Schema source of truth:** `src/db/schema.ts:46-71` (Drizzle) + `src/db/types.ts:162-179` (`ExerciseRow`). Drizzle: `numeric("bodyweight_factor")`. (FACT)
- **Tests:** pure-kernel unit tests under `tests/unit/` (vitest, deterministic). `tests/unit/bodyweight.test.ts` is the direct target; volume bucketing at `tests/unit/weekly-volume-bucketing.test.ts`. (FACT)

## Constraints
- **Data:** `exercises` table, RLS — SELECT `user_id IS NULL OR auth.uid() = user_id`; mutate scoped to `auth.uid() = user_id` (canonical app-immutable for non-admins; admins via `0018`). Backfill migration runs as service role (bypasses RLS). New column must be nullable (no NOT-NULL backfill trap on user rows).
- **UI:** NativeWind; edit/create forms use react-hook-form + zod; conditional render (factor only when `equipment === "bodyweight"`) is the natural UX if UI is in scope.
- **Platform:** none specific — pure arithmetic + optional form field. No iOS/Android/web divergence.
- **Auth:** owner session for reads/writes; service role for the backfill.
- **Performance:** one map lookup / one column read per set — negligible. The SELECT widening adds one column to an existing join — negligible.

## Existing precedents
- **Phase-0 (`docs/runs/2026-05-30_0126_bodyweight-volume-per-muscle/`)** — threaded `equipment` + per-session bodyweight through all the same sites. The factor rides the EXACT same plumbing (MAP for `volume-target`, widened ROW for `stats.ts`-fed, `ExerciseRow` field for single-exercise, prop for `presentSetVolumeLines`).
- **`0014` migration** — by-name idempotent UPDATE of canonical rows, `WHERE user_id IS NULL AND deleted_at IS NULL`. Copy for the 4-row factor backfill.
- **`0009`/`0015` `max_volume_window`** — precedent for a numeric tuning column + an optional kernel param.
- **`ExerciseRow` widening on a read** — `select("*")` gives single-exercise sites the column free; only the explicit `stats.ts` SELECT is the manual touch (same as Phase-0 adding `equipment`).

## Unknowns (ranked by design impact)
1. **WHERE the factor lives — DB column (c) vs code map (a).** (a) what: nullable `bodyweight_factor numeric` column + backfill vs a 4-entry name-keyed code map. (b) why: drives migration/schema/types/SELECT-widening AND whether owned rows can have a factor AND whether the UI is reachable. (c) **Recommended: option (c) the column** (id-keyed, covers owned rows, rides the seam, future-proofs UI), NULL⇒1.0 — MEDIUM confidence; (a) is the legit "no-migration/no-UI, accept fragility" alternative for a 4-row catalog.
2. **UI scope — backend-only vs user-editable field (#6).** (a) what: ship 4 canonical defaults with NO form field vs add a numeric Controller. (b) why: doubles the test surface (validation + conditional render + admin/RLS) and turns "kernel refinement" into "kernel + UI." (c) **Recommended: backend-only first** (zero owned bodyweight exercises) — MEDIUM confidence.
3. **Factor VALUE for "Hanging Leg Raise" (#7).** (a) what: prompt gives push-up/dip/pull-up, not the 4th. (b) why: a wrong value silently mis-scales every hanging-leg-raise number. (c) **Recommended: HUMAN supplies** (a hanging lower-body lever ≈ 0.x, not derivable) — LOW confidence on any guess.
4. **Factor scales ONLY the bodyweight component, never addedLoad.** (a) what: confirm `bw*factor + addedLoad` (NOT `(bw+addedLoad)*factor`). (b) why: a weighted dip's belt load is a true external load. (c) **Recommended: scale bodyweight only** — HIGH confidence (the prompt's own formula).
5. **NULL/non-finite/unknown factor ⇒ 1.0, never 0.** (a) what: the identity/fallback. (b) why: 0 zeroes out every bodyweight volume — silent catastrophe. (c) **Recommended: coalesce to 1.0**, guarded like the existing `Number.isFinite` checks — HIGH confidence.
6. **`effectiveWeightKg` signature shape.** (a) what: add an optional 4th param `factor?: number | null` (absent ⇒ 1.0) vs a wrapper. (b) why: 14 call sites + the prop-fed presenter must pass it. (c) **Recommended: optional 4th param defaulting to 1.0** — HIGH confidence (mirrors how `bodyweightKg` was added).
7. **`stats.ts` SELECT widening + `WeeklyVolumeRow` type.** (a) what: `exercises!inner(equipment)` → `(equipment, bodyweight_factor)` and the `exercises: { equipment: string }` type gains the field. (b) why: the 8 ROW-fed sites read it from there. (c) **Recommended: widen SELECT + type** (only under option c) — HIGH confidence it's the single read-path touch.
8. **`volume-target` map plumbing.** (a) what: add `factorByExerciseId: Map<string,number>` alongside `equipmentByExerciseId` on the `bodyweight` input, built by the same caller. (b) why: sites 1-3 are MAP-fed, not ROW-fed. (c) **Recommended: parallel map** built where `equipmentByExerciseId` is built — MEDIUM confidence (build site not pinned this pass; Designer should grep `computeVolumeTarget` callers).
9. **e1RM regression guard.** (a) what: assert e1RM unchanged for a bodyweight set when a factor is set. (b) why: prove the factor never leaks into the logged-weight metric. (c) **Recommended: add an explicit unit/e2e assertion** — HIGH confidence.

## Out-of-scope flags
- e1RM / strength chart math — logged-weight only; the factor must NOT touch `epley1RM` paths (Invariant D).
- Scaling the addedLoad / external-load component — only the bodyweight component is leveraged.
- A general per-exercise load multiplier for non-bodyweight equipment — the factor is gated to `equipment === "bodyweight"` only.
- Pull-up's factor — moot: "Pull Up" is `equipment=null` in the live catalog, so it has no bodyweight component to leverage (do NOT silently re-classify it as bodyweight unless the human asks).
- Tombstoned / deleted bodyweight exercises — none exist; follow `0014`'s `deleted_at IS NULL` filter.
