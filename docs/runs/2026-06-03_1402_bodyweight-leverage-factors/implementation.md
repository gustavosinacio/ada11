# Implementation — 2026-06-03_1402_bodyweight-leverage-factors

Based on: `design-v2.md` (final approved) and `validation-v2.md` (GO; carries
MIN-NEW-1 fixture must-fix + MIN-NEW-2 cosmetic notes).

Backend-only per-exercise bodyweight leverage factor. `effectiveWeightKg` gains
an optional 4th param `factor?: number | string | null`; the bodyweight branch
becomes `bw*factor + addedLoad` (addedLoad NEVER scaled; coalesce-to-1.0-never-0;
stored "0" honored). The factor is stored in a new nullable
`exercises.bodyweight_factor numeric` column (migration 0021, written but NOT
applied), backfilled on 7 canonical rows + 3 reclassified to `bodyweight`. e1RM
untouched (Invariant D).

## Files changed

### Seam + pure kernels (vitest-covered)
- `src/utils/bodyweight.ts` (edited) — `effectiveWeightKg` gains 4th param
  `factor?: number | string | null`; internal `parseFloat` for string;
  coalesce-to-1.0-NEVER-0 (NULL/undefined/non-numeric-string/NaN/±Infinity ⇒ 1);
  bodyweight branch returns `bw * f + addedLoad`. Docstring updated.
- `src/utils/volume-target.ts` (edited) — `SetBodyweightInput` +
  `ComputeVolumeTargetInput.bodyweight` gain **required** `factorByExerciseId:
  Map<string, number>`; the 3 `effectiveWeightKg` calls (`sumPastVolume`,
  `sumLiveVolume`, `effWeightOf`) pass `bw.factorByExerciseId.get(s.exercise_id)`
  as the 4th arg; the 2 internal `sumPastVolume`/`sumLiveVolume` re-invocations
  forward `factorByExerciseId`.
- `src/utils/progress-page-math.ts` (edited) — 5 `WeeklyVolumeRow` sites each
  gain 4th arg `row.exercises?.bodyweight_factor` (STRING, parsed inside seam).
- `src/utils/weekly-muscle-volume.ts` (edited) — 1 site gains `ex.bodyweight_factor`.
- `src/utils/weekly-volume-strip-math.ts` (edited) — 1 site gains
  `row.exercises?.bodyweight_factor`.
- `src/utils/exercise-session-row-format.ts` (edited) — `presentExerciseSessionRow`
  + `presentSetVolumeLines` gain optional `factor?: number | string | null`;
  `makeBwInput` (builder #6) gains `factor`, parseFloats it, builds a one-entry
  `factorByExerciseId` map (guarded `!= null && Number.isFinite`).
- `src/utils/session-verdict-math.ts` (edited — type-only) — `computeCurrentSessionVolumeByExercise`
  forwards `bw` opaquely into `sumLiveVolume`; auto-correct once callers pass the
  new field. No code change beyond the `SetBodyweightInput` type widening.

### ROW-fed / full-ExerciseRow-fed / prop-fed consumers
- `src/hooks/use-progress-page.ts` (edited) — 1 site gains `r.exercises?.bodyweight_factor`.
- `app/(app)/history/week/[isoWeek].tsx` (edited) — 1 inline reduce site gains
  `row.exercises?.bodyweight_factor`.
- `app/(app)/exercises/[id]/progress.tsx` (edited) — volume reduce gains a local
  `factor = exercise.data?.bodyweight_factor` + 4th arg; useMemo deps gain
  `exercise.data?.bodyweight_factor`; `presentSetVolumeLines` call gains
  `factor`; `<ExerciseSessionRow>` mount gains `factor`. e1RM path (`:195-202`)
  UNTOUCHED.
- `src/components/exercise-block.tsx` (edited) — `<VolumeTargetSlot>` mount gains
  `factor={exercise.bodyweight_factor ?? undefined}`.
- `src/components/volume-target-slot.tsx` (edited — builder #5) — `Props` gains
  `factor?: number | string`; the `bodyweight` useMemo builds a one-entry
  `factorByExerciseId` (parseFloat the STRING, guarded finite), adds it to the
  returned object + `factor` to deps; both `presentSetVolumeLines` calls pass
  `factor`.
- `src/components/exercise-session-row.tsx` (edited) — `Props` gains
  `factor?: number | string | null`; forwarded into both presenter calls.

### MAJ-1 screen builders (sites 1-3)
- `app/(app)/workout/[sessionId].tsx` (edited — builder #1) — the single memo
  now returns `{ equipmentByExerciseId, factorByExerciseId }` (both derived from
  `exercisesQ.data`/`useAllExercises`, parseFloat each non-null factor); the
  `sumLiveVolume` object + its dep array gain `factorByExerciseId`. (MIN-NEW-2(a):
  both maps returned from the one memo — no staleness foot-gun.)
- `app/(app)/workout/verdict/[sessionId].tsx` (edited — builder #2) — same one-memo
  shape; `setBodyweightInput` literal + its deps gain `factorByExerciseId`. Flows
  into BOTH `sumLiveVolume` AND `computeCurrentSessionVolumeByExercise` (PR
  detection) — one wiring fixes both.
- `app/(app)/history/[id].tsx` (edited — builder #3) — the inline `equipmentByExerciseId`
  loop in the `totals` useMemo also builds `factorByExerciseId`; passed in the
  `sumLiveVolume` object. Deps already include `exercisesQ.data`.

### Schema / types / query
- `src/db/types.ts` (edited) — `ExerciseRow` gains `bodyweight_factor: string | null`
  (STRING — matches every sibling numeric on the row types).
- `src/api/stats.ts` (edited) — `WeeklyVolumeRow.exercises` gains
  `bodyweight_factor: string | null`; SELECT widened
  `exercises!inner(equipment)` → `exercises!inner(equipment, bodyweight_factor)`.
- `src/db/schema.ts` (edited) — `exercises` pgTable gains
  `bodyweightFactor: numeric("bodyweight_factor")` (nullable, no default).

### Migration (written, NOT applied)
- `supabase/migrations/0021_bodyweight_factor.sql` (new) — byte-for-byte the
  design-v2 spec: add nullable `bodyweight_factor numeric`; reclassify Pull Up /
  Chest Dip / Hanging Knee Raise to `equipment='bodyweight'`; idempotent backfill
  of 7 factors (Push-up 0.64, Dip 1.0, Chin-up 1.0, Pull Up 1.0, Chest Dip 1.0,
  Hanging Leg Raise 0.50, Hanging Knee Raise 0.50);
  `WHERE user_id IS NULL AND deleted_at IS NULL`. **NOT applied** — the Conductor
  runs `npm run db:push`.

### Tests
- `tests/unit/bodyweight.test.ts` (edited) — new `describe("effectiveWeightKg —
  leverage factor (MAJ-2 STRING-aware)")` block, 13 cases, all STRING-input
  with teeth: `"0.64"`⇒51.2, addedLoad-not-scaled `"0.64"`⇒61.2, `"1.0"`⇒80,
  weighted dip `"1.0"`⇒110, reclassified `"1.0"`⇒80, NULL⇒80, undefined⇒80,
  `"abc"`⇒80, NaN/±Infinity⇒80, stored `"0"`⇒honored (80*0+10=10), non-bodyweight
  ignores factor, defensive number `0.64`⇒51.2, legacy `"Bodyweight"` never reads
  factor. Existing 12 cases re-pass unchanged.
- `tests/unit/volume-target-factor.test.ts` (new) — MIN-1 cross-surface
  consistency: the SAME leveraged push-up (bw 80, factor STRING `"0.64"`, reps
  10 ⇒ 512) threaded through ROW (`bucketLifetimeWeeklyVolumes` reading
  `row.exercises.bodyweight_factor`), MAP (`sumPastVolume` `factorByExerciseId`),
  prop (`presentSetVolumeLines({ factor: "0.64" })`), and verdict/live-header
  (`computeCurrentSessionVolumeByExercise` via `factorByExerciseId`); asserts 512
  on all four + a "single number" set-size check. Plus the e1RM-unchanged
  regression (Invariant D — factor never reaches `epley1RM`).
- `tests/unit/session-verdict-math.test.ts` (edited — MIN-NEW-1) — `mkRow`
  default + 4 explicit `exercises: { equipment: "bodyweight" }` literals gain
  `bodyweight_factor: null`; 2 `SetBodyweightInput` literals gain
  `factorByExerciseId: new Map()`.
- `tests/unit/weekly-volume-bucketing.test.ts` (edited — MIN-NEW-1) — local
  `RowInput.exercises` type widened; `buildRow` default + 3 override literals
  gain `bodyweight_factor: null`.
- `tests/unit/progress-page-math.test.ts` (edited — MIN-NEW-1) — `mkRow` default,
  `mkExercise` default, + 7 explicit bodyweight override literals updated.
- `tests/unit/e1rm-strength.test.ts` (edited — MIN-NEW-1) — `mkRow` + `mkExercise`
  defaults gain `bodyweight_factor: null`.
- `tests/unit/weekly-muscle-volume.test.ts` (edited — MIN-NEW-1) — `mkRow` +
  `mkExercise` defaults gain `bodyweight_factor: null`.
- `tests/unit/group-session-volumes.test.ts` (edited — MIN-NEW-1) — `mkRow`
  default override literal gains `bodyweight_factor: null`.

## Deviations from design
None. Every change maps to a design-v2 instruction or the carried-in MIN-NEW-1
fixture must-fix. MIN-NEW-2(a) was honored by returning both maps from the one
`workout/[sessionId].tsx` memo (the cleanest shape the Validator recommended);
MIN-NEW-2(b)'s `admin/index.tsx:394` no-bw caller was confirmed excluded in the
post-finish re-grep (no factor map added). The fixture-update list was derived by
running `npx tsc --noEmit` (the authority), not hand-guessed — it surfaced
exactly the design's named files + the 4 MIN-NEW-1 additions + the under-enumerated
override literals.

## Soft callbacks made (during this implementation pass)
None. The design was decision-dense; no ambiguity blocked progress. Soft-callback
budget intact (2/2).

## Quality gates
- [x] `npm run typecheck` (`tsc --noEmit`) passed — 0 errors. Run after each
  `replace_all` (progress-page-math 5-site; session-verdict-math 2×; volume-target
  3×; weekly-volume-bucketing 1×) and at the end with the new test files. The
  one residual after the bodyweight literal replace_alls (a 6-space-indented
  `toWvr` literal the 8-space-indented `replace_all` didn't match) was caught by
  the typecheck and fixed surgically.
- [x] `npm run lint` passed — 0 errors, 1 pre-existing warning
  (`.expo/types/router.d.ts`, auto-generated, baseline-unchanged).
- [x] `npm run test:unit` (`vitest run`) — **505/505** passing (baseline 485;
  +20: bodyweight leverage block +13, volume-target-factor +7).
- [x] No new `any` / `as any` / `as unknown` — grep-clean across all 21 touched
  source/test files.
- [x] No new `// @ts-ignore` / `@ts-expect-error` / `eslint-disable` — grep-clean.
- [x] No stray `console.log` / `debugger` — grep-clean.

## String-typing confirmation (MAJ-2)
- `effectiveWeightKg(..., factor?: number | string | null)` — parseFloats a
  string INSIDE the seam; a raw `"0.64"` never hits `Number.isFinite` un-parsed.
- `WeeklyVolumeRow.exercises.bodyweight_factor: string | null` (`stats.ts`) and
  `ExerciseRow.bodyweight_factor: string | null` (`db/types.ts`) — both read
  boundaries STRING-typed.
- `factorByExerciseId: Map<string, number>` — every build site (#1-#3, #5, #6)
  reads the `string | null` and `parseFloat`s it BEFORE `set`, guarding `!= null`
  (and `Number.isFinite` in `makeBwInput` / `volume-target-slot`). No raw string
  enters the number map; an absent/garbage key is simply omitted ⇒ `Map.get`
  undefined ⇒ seam coalesces to 1.0.
- Tests assert with STRING inputs (`"0.64"`, `"1.0"`, `"abc"`, `"0"`) so a
  number-literal false-green is impossible.

## 6-builder wiring confirmation + closed-set re-grep
All 6 `SetBodyweightInput`/`equipmentByExerciseId` builders wired with
`factorByExerciseId` (the REQUIRED field made the compiler flag any omission —
0 typecheck errors = all 6 wired):
1. `workout/[sessionId].tsx` (live header) — one-memo both maps.
2. `workout/verdict/[sessionId].tsx` (verdict total + PR) — one-memo, into
   `setBodyweightInput` → both `sumLiveVolume` + `computeCurrentSessionVolumeByExercise`.
3. `history/[id].tsx` (session-detail total) — inline loop in `totals` memo.
4. `session-verdict-math.ts` (`computeCurrentSessionVolumeByExercise`) — type-only,
   forwards `bw` opaquely.
5. `volume-target-slot.tsx` — one-entry map from the new `factor` prop.
6. `exercise-session-row-format.ts` (`makeBwInput`) — loops sets from the new
   `factor` param.

Post-finish re-grep `equipmentByExerciseId|SetBodyweightInput|computeVolumeTarget(|sumLiveVolume(|sumPastVolume(|computeCurrentSessionVolumeByExercise(`
over `app/ src/` confirms **no 7th builder**. The only bw-free `sumLiveVolume`
hits are `admin/index.tsx:394` (deliberate no-bw caller; `"kg"` is `formatVolume`'s
arg) and `workout/[sessionId].tsx:114` (pre-session-start fallback) — both
correctly excluded, byte-for-byte unchanged.

## Migration pre-apply verification (hygiene — read-only, NOT applied)
Ran the read-only 7-name verification query against project `ykrbgpctbfvndxjnpzrg`
via the anon client (canonical catalog is anon-readable via the widened RLS
SELECT; throwaway script created in the project dir then removed; NO DB mutation,
NO `db:push`). Result — **all 7 names present and exact**:
```
Chest Dip          | equipment=null        | user_id=null | deleted_at=null
Chin-up            | equipment=bodyweight  | user_id=null | deleted_at=null
Dip                | equipment=bodyweight  | user_id=null | deleted_at=null
Hanging Knee Raise | equipment=null        | user_id=null | deleted_at=null
Hanging Leg Raise  | equipment=bodyweight  | user_id=null | deleted_at=null
Pull Up            | equipment=null        | user_id=null | deleted_at=null
Push-up            | equipment=bodyweight  | user_id=null | deleted_at=null
```
The 3 currently-`null` rows (Chest Dip, Hanging Knee Raise, Pull Up) are exactly
the ones migration step 2 reclassifies to `bodyweight`; the 4 already-`bodyweight`
rows match. No drift since the Validator's live check. The migration literals are
correct as written.

## Notes for Reviewer / Tester
- **Migration NOT applied.** The Conductor/human must run `npm run db:push` to
  apply 0021 before the post-migration gates (`expo export` / e2e that read the
  factor live). Until applied, every row's `bodyweight_factor` is NULL ⇒ 1.0 ⇒
  byte-for-byte today's numbers (Invariant L) — so the unit suite + typecheck are
  fully green pre-apply.
- **Reviewer — scrutinize the string seam.** Confirm no path lets a raw numeric
  string reach `Number.isFinite` un-parsed (the v1 no-op bug). The parseFloat
  lives in `effectiveWeightKg` AND at each map build site; the read boundaries are
  both `string | null`.
- **Reviewer — confirm Invariant L byte-for-byte.** Every existing fixture got
  `bodyweight_factor: null` / `factorByExerciseId: new Map()`, which keeps f=1, so
  the 485 baseline assertions are unchanged. Spot-check `progress.tsx:195-202`
  (e1RM untouched — separate `w = parseFloat(set.weight)` variable; the factor
  lands only on the `:206` volume reduce).
- **Tester — RETROACTIVE SHIFT (R-1).** After applying 0021, Pull Up / Chest Dip /
  Hanging Knee Raise (reclassified to `bodyweight`) will newly APPEAR on
  per-muscle / strip / PR / max-volume surfaces where they were absent (a new
  contribution, not just a shifted number) for any session that logged them.
  Push-up sessions get scaled to 0.64 BW; the other bodyweight movements stay at
  1.0 (no change). Expect the appearance of new data, not only changed numbers.
- **Tester — cross-surface re-run surface (MIN-NEW-1).** The fixture changes touch
  8 existing unit files + 2 new; full `vitest run` is green (505). e2e is yours to
  run (I did NOT run playwright). The MIN-1 cross-surface test names the 4 surfaces
  (ROW / MAP / prop / verdict-live-header) so a string-drop or un-wired surface
  fails it loudly.
