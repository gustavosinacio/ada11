# Review v1 — 2026-06-03_1402_bodyweight-leverage-factors

## Decision

**PASS** — 0 blockers / 0 majors / 2 minors. Both are test-quality / hand-off notes, not regressions.

Reasoning: the two v1-rejection causes (MAJ-2 string-aware seam; MAJ-1 6-builder closed set) are both
verified RESOLVED against the shipped diff with file:line teeth. Invariant L (byte-for-byte when absent),
Invariant D (e1RM untouched), the string-shape end-to-end, the migration, and all fixture updates are
correct. The two minors are an Invariant-D unit case that asserts a tautology instead of driving the
production path (MIN-1) and a Tester hand-off for runtime-only checks (MIN-2). Decision rule:
0 blockers + ≤1 major → pass (here 0 majors).

## Diff scope
- Diff command: `git diff 3c85c23 -- src/ app/ supabase/ tests/` (working tree; implementation is uncommitted)
- Files changed: 26 source/test + 1 new migration + 1 new test = 28 (29 incl. the run's own docs folder)
- Lines: +361 / -61 (src/app/tests); migration `0021_bodyweight_factor.sql` new (45 lines)
- Excluded as out-of-run noise: pre-existing screenshot PNGs in other runs' folders + `docs/runs/2026-06-01_1301.../state.md` (per `state.md:12-13`).

## Gates I re-ran (not trusted from implementation.md)
- `npm run typecheck` (`tsc --noEmit`) → **0 errors**. Matches the Implementer's claim.
- `npm run lint` → **0 errors, 1 pre-existing warning** (`.expo/types/router.d.ts`, auto-generated, baseline-unchanged). Matches.
- Spot-ran `npx vitest run tests/unit/bodyweight.test.ts tests/unit/volume-target-factor.test.ts` → **41/41 PASS**. (Full suite is the Tester's; I did not re-run all 505.)

## Verification of implementation.md claims
| Claim | Verified? | Notes |
|---|---|---|
| Seam `factor?: number \| string \| null`; parseFloat string internally; coalesce-1.0-never-0 | yes | `bodyweight.ts:47-66` — `factor==null⇒f=1`; `typeof==="string"?parseFloat:factor`; `Number.isFinite(n)?n:1`. A raw `"0.64"` is parsed INSIDE the seam, never hits `Number.isFinite` as a string. |
| `bw*f + addedLoad`, addedLoad NEVER scaled | yes | `bodyweight.ts:63` `return bw * f + addedLoad`. Test case 2 asserts `"10",80,"0.64"⇒61.2` (NOT 57.6). |
| Stored `"0"` honored; non-bodyweight ignores factor | yes | `bodyweight.test.ts` case 9 (`"0"⇒10` and `"0"⇒0`); case 10 (`barbell...⇒100`); `:65` non-bw returns addedLoad before reading factor. |
| Both read boundaries typed `string \| null` | yes | `stats.ts:28` `exercises: {equipment:string; bodyweight_factor: string\|null}`; `db/types.ts:176` `bodyweight_factor: string \| null`. NOT number. |
| `factorByExerciseId: Map<string, number>`, parsed at every build site | yes | `volume-target.ts:28,97`. All 5 numeric-building sites parseFloat the string BEFORE `set`, guarding `!= null` (sites 1-3) / `!= null && Number.isFinite` (5,6). No raw string in the map. |
| All 3 kernel calls + 2 internal re-invocations forward the factor | yes | `volume-target.ts:131` (sumPast), `:174` (sumLive), `:268` (effWeightOf); internal re-invocations `:224`, `:244` forward `bodyweight.factorByExerciseId`. |
| 6 builders all wired | yes | re-grep below confirms; `factorByExerciseId` REQUIRED so the typecheck (0 errors) independently proves all 6 wired. |
| Invariant L: fixtures got `bodyweight_factor: null` / `new Map()` | yes | all 7 fixture files updated with `null` / empty Map — f=1 preserved byte-for-byte. |
| Invariant D: e1RM untouched | yes | `progress.tsx:198-205` e1RM block uses `w = parseFloat(set.weight)` (separate var); factor lands only on `:209` volume `effW`. `e1rm-strength.ts` not in diff. |
| Migration 0021 byte-for-byte spec | yes | `0021_bodyweight_factor.sql` matches design §"Migration 0021 spec" exactly. |
| Write path untouched (U2) | yes | `src/api/exercises.ts` has 0 mentions of `bodyweight_factor`; createExercise/updateExercise field lists unchanged. |
| 8 existing fixture files + 2 new; vitest 505 | partial | I confirmed the 7 fixture diffs + the 2 new/key tests pass (41). Full 505 is the Tester's re-run. |

## MAJ-2 (string-aware seam) — VERIFIED RESOLVED, with teeth

Traced every path that puts a factor into a `Map<string, number>` or passes it to the seam; **no raw
numeric string reaches `Number.isFinite` un-parsed** (the v1 silent-no-op bug):

- **Seam** (`bodyweight.ts:55-62`): `factor==null⇒1`; else `n = typeof factor === "string" ? parseFloat(factor) : factor`; `f = Number.isFinite(n) ? n : 1`. The string is parsed first; `Number.isFinite` only ever sees a number. Coalesce-1.0-never-0 + stored-`"0"`-honored both hold.
- **ROW-fed sites** (8): each passes `row.exercises?.bodyweight_factor` / `ex.bodyweight_factor` (a `string | null`) **straight as the 4th arg** → parsed inside the seam. `progress-page-math.ts:88,195,243,325,413`, `weekly-muscle-volume.ts:121`, `weekly-volume-strip-math.ts:91`, `use-progress-page.ts:296`, `history/week/[isoWeek].tsx:105`. Correct — no premature `Number.isFinite`.
- **MAP-fed sites** (`Map<string, number>`): the build sites are the ONLY place a string→number parse happens for the map, and they parse BEFORE `set`, guarding `!= null`. So `Map.get` yields `number | undefined`; an absent/garbage key is omitted ⇒ seam coalesces to 1.0. Verified at `workout/[sessionId].tsx:106`, `workout/verdict/[sessionId].tsx:67`, `history/[id].tsx:216` (sites 1-3, guard `!= null`), `volume-target-slot.tsx:75-82` (site 5, guard `!= null && Number.isFinite`), `exercise-session-row-format.ts:243-253` (site 6, same). No double-coalesce data loss — build-site parse and seam coalesce act on disjoint inputs.
- **Read-boundary types**: `WeeklyVolumeRow.exercises.bodyweight_factor: string | null` (`stats.ts:28`), `ExerciseRow.bodyweight_factor: string | null` (`db/types.ts:176`) — both STRING, matching the 5 sibling numerics.
- **Tests have STRING teeth**: `bodyweight.test.ts` cases 1-10 assert with `"0.64"`/`"1.0"`/`"abc"`/`"0"` (runtime-true type). The cross-surface `volume-target-factor.test.ts` threads the literal STRING `"0.64"` end-to-end through the ROW path (`bucketLifetimeWeeklyVolumes` reading `row.exercises.bodyweight_factor="0.64"`) and the prop path (`presentSetVolumeLines({factor:"0.64"})`) — **if the seam coalesced `"0.64"` to 1.0 these return 800, not 512.** A number-literal-only false-green is impossible. NOT a false-green.

## MAJ-1 (6-builder closed set) — VERIFIED RESOLVED, re-grepped independently

Re-ran `grep -rn "equipmentByExerciseId|SetBodyweightInput|computeVolumeTarget(|sumLiveVolume(|sumPastVolume(|computeCurrentSessionVolumeByExercise(|factorByExerciseId" app/ src/`:

| # | Builder | Factor wired | Evidence |
|---|---|---|---|
| 1 | `workout/[sessionId].tsx` live header | yes | `:100-109` one-memo returns BOTH maps from `exercisesQ.data`; reduce `:119-122` passes `factorByExerciseId`; deps `:128-129`. parseFloat `:106` guarded `!= null`. |
| 2 | `workout/verdict/[sessionId].tsx` verdict total + PR | yes | `:61-70` one-memo; `setBodyweightInput` `:84-85`; flows into `sumLiveVolume` `:92` AND `computeCurrentSessionVolumeByExercise` `:98-100` (PR detection). One wiring fixes both. |
| 3 | `history/[id].tsx` session-detail total | yes | `:211-216` inline loop builds both maps; `sumLiveVolume` `:223-225`; deps already track `exercisesQ.data`. |
| 4 | `session-verdict-math.ts` `computeCurrentSessionVolumeByExercise` | yes (type-only) | No diff — forwards `bw` opaquely to `sumLiveVolume`. Auto-correct once site 2 passes the field. Confirmed `git diff` shows ZERO change to this file. |
| 5 | `volume-target-slot.tsx` `<VolumeTargetSlot>` | yes | `:75-82` one-entry map (parseFloat guarded finite); `:96` into bodyweight obj; `factor` in deps; both `presentSetVolumeLines` `:143`,`:219`. `factor` prop from `exercise-block.tsx:247`. |
| 6 | `exercise-session-row-format.ts` `makeBwInput` | yes | `:243-254` parseFloat guarded `!= null && Number.isFinite`; threaded from `presentExerciseSessionRow`/`presentSetVolumeLines` `factor` param. |

**No 7th builder.** The only other `sumLiveVolume` hits are deliberately bw-free and byte-for-byte unchanged:
- `admin/index.tsx:394` — `sumLiveVolume(detailQ.data.sets)`, NO `SetBodyweightInput` (the `"kg"` is `formatVolume`'s arg). Correctly excluded.
- `workout/[sessionId].tsx:114` — pre-session-start fallback `sumLiveVolume(setsQ.data ?? [])`, bw-free. Correctly excluded.

Because `factorByExerciseId` is REQUIRED on `SetBodyweightInput` + `ComputeVolumeTargetInput.bodyweight`, the
passing typecheck (0 errors) is an independent proof that every builder is wired — a missed one would be a
hard compile error.

## Invariant L (byte-for-byte when absent) — VERIFIED
- 4th-arg-omitted calls: `factor==null⇒f=1`, so `bw*1+addedLoad === bw+addedLoad`. `bodyweight.test.ts` case 7 asserts `effectiveWeightKg("bodyweight","0",80) === 80`.
- Existing fixtures: all 7 updated files add `bodyweight_factor: null` (ROW/ExerciseRow) and `factorByExerciseId: new Map()` (SetBodyweightInput literals). `null` → seam coalesces to 1.0; empty Map → every `get` undefined → 1.0. No arbitrary values introduced. Prior assertions stay valid by construction.
- MIN-NEW-1 closed: all 7 fixture files the Validator named are updated (3 design-named + `volume-target.test.ts`, `e1rm-strength.test.ts`, `weekly-muscle-volume.test.ts`, `group-session-volumes.test.ts`).

## Invariant D (e1RM untouched) — VERIFIED
`progress.tsx:198-205`: `const w = set.weight ? parseFloat(set.weight) : 0; if (w > 0 && r > 0) { epley1RM(w, r) }`
— the e1RM weight is the LOGGED weight, a separate variable from the volume `effW = effectiveWeightKg(equipment, set.weight, bw, factor)` at `:209`. The factor never reaches `epley1RM`. `e1rm-strength.ts` is not in the diff. The `useMemo` dep add (`exercise.data?.bodyweight_factor`, `:246`) re-runs the memo but cannot change the e1RM output because the e1RM branch never reads the factor.

## Migration 0021 — VERIFIED
`supabase/migrations/0021_bodyweight_factor.sql` matches the design spec byte-for-byte:
- `alter table ... add column if not exists bodyweight_factor numeric` — nullable, no default, idempotent (`:22`).
- 3 reclassify UPDATEs `set equipment='bodyweight'` for `Pull Up`, `Chest Dip`, `Hanging Knee Raise` with `WHERE user_id IS NULL AND deleted_at IS NULL` (`:25-27`).
- 7 backfill UPDATEs, exact `name = '...'` literals, factors 0.64/1.0/1.0/1.0/1.0/0.50/0.50, same WHERE clause (`:32-45`).
- Retroactive-shift comment present (`:13-18`).
- `schema.ts:62` adds `bodyweightFactor: numeric("bodyweight_factor")` (nullable). `numeric` already imported.
- NOT applied (Implementer ran a read-only pre-apply verification query; the human/Conductor runs `npm run db:push`).
- No zod/UI/write-path change (U2).

## Security checklist
- [x] **RLS / authorization**: no new query SURFACE. The only query change is widening the existing `stats.ts` SELECT (`exercises!inner(equipment)` → `exercises!inner(equipment, bodyweight_factor)`) — same `!inner` join, one more projected column, same RLS-protected `exercises` table, identical row cardinality. The `bodyweight_factor` column rides the existing `select("*")` on `useAllExercises`/`useExercise` for free. No new table (the column is added to an existing table that already has RLS). No new policy needed — reads only.
- [x] **No service-role / signing key in client code**: grep-clean — 0 `SERVICE_ROLE`/`service_role` in `src/`/`app/`.
- [x] **Input handling**: the migration uses fixed string literals (`name = 'Push-up'` etc.), no user input, no string concat. No `rpc`/raw SQL in the shipped TS. `parseFloat` on a DB-controlled `numeric` string — not user-typed-into-a-query.
- [x] **`EXPO_PUBLIC_*`**: no new public env vars.

## Style / convention checklist
- [x] **No new `any`**: grep-clean — 0 `: any`/`<any>`/`as any`/`as unknown` added in the diff.
- [x] **No new `@ts-ignore` / `@ts-expect-error` / `eslint-disable`**: grep-clean.
- [x] **Comments narrate WHY**: the seam docstring explains the string-`numeric` rationale + coalesce-never-0 + Invariant L; the build-site comments explain "parseFloat once here so the map only ever holds finite numbers"; the migration comment calls out the retroactive shift. All rationale, not line-narration.
- [x] **Imports follow `~/`-rooted project style**: the new test imports `~/api/stats`, `~/db/types`, `~/utils/...` package-first then relative. Consistent.
- [x] **New files in conventional folders**: `tests/unit/volume-target-factor.test.ts` (unit dir), `supabase/migrations/0021_*.sql` (migrations dir, next free slot). Conventional.

## Issues

### Blockers
- None.

### Majors
- None.

### Minors
- **[MIN-1]** `tests/unit/volume-target-factor.test.ts:206-222`: the e1RM-unchanged (Invariant D) regression cases assert TAUTOLOGIES — `expect(loggedWeight > 0).toBe(false)` (a hand-computed `0 > 0`) and `expect(epley1RM(20,5)).toBe(epley1RM(20,5))` — rather than driving the actual `progress.tsx` e1RM reduce with-vs-without a factor. They DOCUMENT the invariant but do not EXERCISE it through the production path, so they would NOT fail if a future change leaked the factor into the e1RM branch. The invariant genuinely holds (I verified statically: `progress.tsx:198-205` uses a separate `w = parseFloat(set.weight)` and the factor lands only on `:209`), so this is a test-quality gap, not a regression. On a feature whose central guard is "the factor must NOT touch e1RM", a case that actually runs the reduce twice (factor present vs null) and asserts the e1RM series is identical would have real teeth. Fix (optional): add a case that calls the e1RM-producing path (or a thin extracted helper) with `factor="0.64"` vs `null` and asserts the e1RM points are identical. Minor — the cross-surface VOLUME cases (surfaces 1-4) DO have teeth and the e1RM untouchedness is statically verified.

- **[MIN-2]** Tester hand-off (runtime-only — static review cannot confirm): (a) **R-1 retroactive shift** — after `npm run db:push` applies 0021, `Pull Up` / `Chest Dip` / `Hanging Knee Raise` (reclassified to `bodyweight`) will newly APPEAR on per-muscle / strip / PR / max-volume / History-week surfaces where they were absent (a NEW contribution, not just a shifted number) for any session that logged them; `Push-up` sessions scale to 0.64 BW; the other bodyweight movements stay 1.0 (no change). Expect new data, not only changed numbers. (b) **String-shape end-to-end LIVE** — the unit suite proves the string-aware seam with synthetic `"0.64"`; the Tester should confirm a LIVE push-up session (post-migration) actually reads `bodyweight_factor` as `"0.64"` from PostgREST and renders the leveraged total (not full-BW). A live full-BW push-up total = the string-drop bug escaped the unit layer. (c) **7 catalog names live** — the migration matches by exact `name`; the Implementer's read-only pre-apply query found all 7 present/exact, but the Tester should confirm post-apply that all 7 rows carry the expected factor (a name miss = a silent un-backfilled NULL ⇒ that exercise keeps full-BW volume).

## Tester hand-off summary
1. **Apply 0021 first** (`npm run db:push`) — every post-migration runtime check depends on it. Pre-apply, all rows are NULL ⇒ 1.0 ⇒ today's numbers (Invariant L), so a pre-apply e2e would show NO leverage.
2. **R-1 retroactive shift** (MIN-2a) — the 3 reclassified movements newly APPEAR; verify on per-muscle/strip/PR/History-week surfaces.
3. **String-shape live** (MIN-2b) — a live leveraged push-up renders the 0.64-scaled total, not full BW. This is the v1 no-op bug's runtime close-loop.
4. **7-name backfill** (MIN-2c) — post-apply, confirm all 7 canonical rows carry the expected factor + the 3 reclassified rows are now `equipment='bodyweight'`.
5. **Full vitest** — re-run all 505 (I spot-ran 41 of the 2 key files; the 7 fixture diffs are mechanical f=1-preserving updates but the suite is yours).
