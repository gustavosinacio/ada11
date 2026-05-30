# Validation v2 — 2026-05-30_0126_bodyweight-volume-per-muscle

Reviewing: `design-v2.md` (round 2 of 3 Design↔Validate)

## Scope of this round

v1's SOLID findings (F-1 single-session enumeration, `effective>0` byte-identity, `!inner(equipment)` safety, `bodyweightKgAsOf` prior→later→null + order-independence, the fallback rule, the plumbing seam, the Phase-1 chart decisions, F-5 removal, R-7/R-8 admin trade-off) are carried forward unchanged in design-v2 and are NOT re-litigated. This round verifies the two MAJ resolutions against real code, re-checks the exhaustiveness claim, and hunts for NEW defects introduced by v2's deltas.

## MAJ-1 — `weekVolumeKg` 14th kernel site — **RESOLVED**

Verified personally against `app/(app)/history/week/[isoWeek].tsx`:

- `:82-93` IS the inline kernel: `:88` `const w = row.weight ? parseFloat(row.weight) : 0`, `:90` `if (Number.isFinite(w) && w > 0 && r > 0) vol += w * r`, bucketed by `weekKeyOf(parseISO(row.completed_at))` (`:87`). Design routes `w` through `effectiveWeightKg(row.exercises.equipment, row.weight, bw)` with `bw = bodyweightKgAsOf(measurements, parseISO(row.sessions.started_at).getTime())` memoised per `session_id` (design `:26,68`, inventory row 14). Correct: `WeeklyVolumeRow` does carry `sessions.started_at` (`stats.ts:25`, verified) so per-row resolution works, and bucketing-by-`completed_at` vs bodyweight-by-`started_at` is the right split (bucket by set completion, weigh-in by session start).
- `avgVolumePerSession` (`:107-108`) is verified NOT a second kernel — it is literally `weekVolumeKg / endedSessionsCount`. It inherits the fix automatically. Design's claim (`:26,447b`) is accurate.
- `groupSessionVolumes(weeklyVolumeQ.data)` on the same screen (`:98-101`, inventory site 7) — the design's MAJ-1 file-change row (`:68`) explicitly states it "needs the same `{ measurements }` input passed in (see wiring table)" so the headline and the per-session rows match. Correct and called out. **However see MAJ-3-NEW** — the design's wiring threads `{ measurements }` to the week-drill-down's `groupSessionVolumes` but the History-list's `groupSessionVolumes` (the OTHER caller) is missed.
- Re-grep (below) independently confirms no 15th `weekVolumeKg`-class site on that screen.

## MAJ-2 — per-exercise e1RM/volume two-variable split — **RESOLVED**

Verified personally against `app/(app)/exercises/[id]/progress.tsx:124-179`:

- `:138-147` confirmed: ONE `const w = set.weight ? parseFloat(set.weight) : 0` (`:140`) under ONE guard `if (w > 0 && r > 0)` (`:142`), shared by `epley1RM(w, r)` (`:143`) and `sessionVolume += w * r` (`:145`). v1's "replace `const w`" would have polluted e1RM — correctly diagnosed.
- The v2 split (design `:242-262`) is correct against the real loop: keep `const w` driving `epley1RM` under unchanged `w > 0`; add `const effW = effectiveWeightKg(exercise.data?.equipment, set.weight, bw)` driving `sessionVolume += effW * r` under its own `effW > 0` guard.
- `maxVolumeKg`/`maxVolumeSession` at `:154-168` — verified they read `sessionVolume` (`:154,164-166`), so once `sessionVolume` is effective they become effective too. Design states this (`:269`). The `windowStartMs` Max-volume window filter (`:161-167`) is untouched — correct (it filters which session counts as max, not the weight). The e1RM path (`sessionBestE1rm > 0` gate `:149`, `e1rmData`) stays logged-weight — verified untouched by the split.
- **Invariant D is exactly what the split code produces**: a Pull-up logged `weight=0`, `bw>0` → `w=0` → `w>0` false → NO e1RM point; `effW=bw+0>0` → `effW>0` true → volume point `bw*reps`. For non-bodyweight `effW===w` so both guards fire identically (byte-for-byte). Confirmed.
- `SessionSets` carries `started_at` (`progress.ts:6,30`, verified) and the loop iterates `s.started_at` (`progress.tsx:133-134`), so resolving `bw = bodyweightKgAsOf(measurements, parseISO(s.started_at))` once per session inside the loop is correct. `exercise.data?.equipment` is in scope (`useAllExercise(id)`, surface 8). The design's mount-`useMeasurements` + dep instruction is sound.

## Re-grep exhaustiveness — **CONFIRMED at 14 active sites (no 15th)**

I independently ran `grep -rn '\* r' / 'parseFloat(.*weight' / 'weight ? parseFloat'` across `app/` and `src/`. Every accumulation site maps 1:1 to the design's inventory:

| Grep hit | Inventory site |
|---|---|
| `volume-target.ts:81` (`sumPastVolume`) | 1 |
| `volume-target.ts:110` (`sumLiveVolume`) | 2 |
| `volume-target.ts:178,185` (`computeVolumeTarget` gate+display) | 3 |
| `progress-page-math.ts:55` (`bucketLifetimeWeeklyVolumes`) | 4 |
| `progress-page-math.ts:154` (`computeCurrentWeekVolume`) | 5 |
| `progress-page-math.ts:198,201` (`computeLifetimeMaxPerExercise`) | 6 |
| `progress-page-math.ts:262` (`groupSessionVolumes`→`sumLiveVolume`) | 7 |
| `progress-page-math.ts:335,338` (`computePrsThisWeek`) | 8 |
| `weekly-volume-strip-math.ts:75` (`computeStripModel`) | 9 |
| `progress.tsx:145` (per-exercise reduce) | 10 |
| `exercise-session-row-format.ts:101` (`presentSetVolumeLines`) | 11 |
| `exercise-session-row-format.ts:55` (`presentExerciseSessionRow`→`sumPastVolume`) | 12 |
| `use-progress-page.ts:251` (`useExercisesThisWeek` nowKg) | 13 |
| `history/week/[isoWeek].tsx:90` (`weekVolumeKg`) | 14 (NEW) |

- `progress-page-math.ts:169,235` are doc comments (not code). `:537-586` `presentSessionVolumeChart` does not appear in the `* r` grep because its arithmetic is via `groupSessionVolumes` delegation — it is REMOVED in Phase 1, correct.
- `computeCurrentSessionVolumeByExercise` (`session-verdict-math.ts:33-48`) confirmed it delegates to `sumLiveVolume` (NOT a separate kernel) — verified `groupSessionVolumes` itself calls `sumLiveVolume(sets)` at `:262`. Design's claim is accurate.
- The non-volume `parseFloat(...weight)` hits (`measurements-chart.ts:30`, `measurement-list-item.tsx:26`, `measurements-progress-strip.tsx:48-50`, `auto-fill-set.ts`) are bodyweight-of-the-USER or set auto-fill, NOT volume kernels — correctly excluded.

**Conclusion: the kernel inventory is exhaustive at 14 sites. No 15th kernel exists.** Confidence HIGH (read every hit). The Designer's re-grep proof (`:443-451`) is accurate.

## Issues found

### Blockers
- None.

### Majors

- **[MAJ-3-NEW]** `app/(app)/history/index.tsx:22-25` (History LIST screen — **Discovery surface #1**) is NOT in design-v2's wiring table and is NOT mentioned anywhere in the design (grep of design-v2 for `history/index` = 0 hits). This screen computes per-session row totals via `groupSessionVolumes(weeklyVolumeData ?? [])` (`:23`, verified) — the SAME function the design is making bodyweight-aware (inventory site 7). The design wires `{ measurements }` into `groupSessionVolumes` ONLY for the week-drill-down (`history/week/[isoWeek].tsx`, MAJ-1 fix), but `groupSessionVolumes` has **two** call sites (verified: `history/index.tsx:23` AND `history/week/[isoWeek].tsx:99`). Left as-is, the History-list per-session totals stay raw `w*r` for a bodyweight exercise, so the SAME session's total reads SMALLER on the History list than on (a) the week drill-down row it links to, (b) the verdict screen, (c) the weekly strip, and (d) the new per-muscle chart — **directly breaking the owner's pre-confirmed "same number everywhere" invariant** (`state.md:7,58`). This is the exact twin of MAJ-1: a `WeeklyVolumeRow`-driven `groupSessionVolumes` consumer left un-wired. `history/index.tsx` does NOT currently mount `useMeasurements` (verified `:1-25`). Classified **major** (design-recoverable, no crash), not blocker.
  - **Required fix:** add `app/(app)/history/index.tsx` to the call-site wiring table; mount `useMeasurements`; pass `{ measurements }` into `groupSessionVolumes(weeklyVolumeData ?? [], { measurements })`. (Equipment arrives on the widened `WeeklyVolumeRow.exercises.equipment` — no `useAllExercises` needed here, per MIN-3.) This is mechanically identical to the week-drill-down `groupSessionVolumes` wiring the design already specifies.

### Minors

- **[MIN-NEW-1]** `groupSessionVolumes` signature is the shared seam for two screens but the design never writes its new signature. Design `:55` says it "gains the same optional input and passes a per-row resolver into `sumLiveVolume`," and the kernel-inventory row 7 says `WeeklyBodyweightInput?`. Because `groupSessionVolumes` groups multi-session rows by `session_id` (`:254-259`, verified) and `sumLiveVolume` takes a **single** `SetBodyweightInput` per call, the implementer must resolve bodyweight per-session-group inside `groupSessionVolumes` and build a per-group `SetBodyweightInput { equipmentByExerciseId?, bodyweightKg }` — but `equipmentByExerciseId` is unavailable on this path (WVR has equipment on the row, not a map). The clean shape is: `groupSessionVolumes(rows, bw?: WeeklyBodyweightInput)` resolves `bodyweightKgAsOf` per `session_id` and reads equipment from `row.exercises.equipment` directly (NOT via `sumLiveVolume`'s `equipmentByExerciseId` map). Suggested fix: state explicitly that `groupSessionVolumes` does its own per-row `effectiveWeightKg(row.exercises.equipment, ...)` reduce (like the other WVR kernels) rather than delegating the bodyweight arithmetic to `sumLiveVolume`'s map-based path — otherwise the implementer has to invent an `equipmentByExerciseId` map on a pipeline that doesn't have one. Non-blocking (the Implementer can infer this from the WVR-vs-SetRow split in MIN-3), but spelling it out removes a foot-gun.

- **[MIN-NEW-2]** Design `:80` wiring row for `src/components/exercise-session-row.tsx` says the per-exercise progress screen "already has both" `equipment`/`measurements`. Verified the screen has `equipment` (`useAllExercise`) and will mount `useMeasurements` (MAJ-2 fix). But the per-session `bodyweightKg` threaded into `presentExerciseSessionRow` must be resolved per `SessionSets.started_at` (each "Sessions" row is a different session, multi-session list). The design's prose treats it as a single value ("the resolved `bodyweightKg`"). Suggested fix: clarify it is resolved per-row from each session's `started_at` (the same per-session resolution the volume loop already does), so the "Sessions" list rows and the trend chart agree. Non-blocking.

- **[MIN-NEW-3]** `volume-target.ts:185` displayed `currentWeightKg` is `parseFloat(currentSet.weight as string)` (verified — note the `as string` cast, no `? :` null guard, because the gate at `:179` already proved `w>0`). The design's MIN-1 contract (`:218`) replaces it with `effectiveWeightKg(...)`. Correct, but the design should note that for a bodyweight set the gate (`:177-182`) must ALSO use `effectiveWeightKg` (design `:217` says it does) — otherwise a Pull-up `weight=0` is rejected by the gate (`w<=0 → return best`) and `currentSet` stays null, so `currentWeightKg=null → repsToBeat=null` regardless of the display fix. The design's three-spot enumeration (`:216-219`) does cover the gate, so this is consistent — flagging only to confirm the Implementer treats the gate as the FIRST of the three, not an afterthought. Verified consistent; no change required.

## Verification of the 5 v1 minors (each adequately addressed)

- **MIN-1** (`computeVolumeTarget` 3 spots) — RESOLVED. Verified all three exist in real code: gate `:177-182`, display `:184-186` (the `parseFloat(currentSet.weight as string)`), repsToBeat denom `:187-190`. Design `:216-219` enumerates all three. See MIN-NEW-3 (consistent).
- **MIN-2** (F-4 reason) — RESOLVED. Restated as the two-condition invariant (`:35,491`). Verified: zero e2e specs seed `measurement_entries` (grep = 0 files), `seedFinishedSession` always inserts positive `weight` (`progress-page.spec.ts:113`, callers pass 80/100), and 4 specs use `pickCanonicalExercise(admin)` with no preferred → first-name-ASC row which could be bodyweight (helper contract verified at `canonical-exercise.ts`). The Tester audit framing is correct.
- **MIN-3** (over-specified `equipmentByExerciseId`) — RESOLVED. Design `:78-83` correctly restricts the map to the SetRow/SessionSets path; WVR hooks take only `{ measurements }`. Verified `useExercisesThisWeek`'s `nowKgByExercise` reduce (`use-progress-page.ts:247-258`) consumes `lifetime.data` (WVR), so reading `r.exercises.equipment` off the widened row is correct.
- **MIN-4** (fixture migration) — RESOLVED and COMPLETE. Verified THREE fixture builders construct full `WeeklyVolumeRow` literals that will break when `exercises` becomes required: `weekly-volume-bucketing.test.ts` `buildRow` (`:24-37` + `RowInput` Omit `:17`), `progress-page-math.test.ts` `mkRow` (`:55-76`), and `session-verdict-math.test.ts` `mkRow` (`:55-76`). Design `:293-301` names all three (the third as "any WeeklyVolumeRow fixture builder"). Default `exercises: { equipment: "barbell" }` keeps all existing assertions green (`effectiveWeightKg` returns `addedLoad`). No other `WeeklyVolumeRow` literal builders found. Adequate.
- **MIN-5** (per-set-sum invariant) — RESOLVED. Promoted to Regression Invariant C (`:457`) with the identical-`equipment`+`bodyweightKg` precondition stated. Adequate.

## Decision

**go**

Reasoning (round 2 of 3 Design↔Validate):
- **MAJ-1 RESOLVED, MAJ-2 RESOLVED** — both verified against real code at the cited lines.
- New findings: **0 blockers, 1 major (MAJ-3-NEW), 3 minors.**
- Per the playbook decision rule ("0 blockers and ≤1 major → go, note the lingering major as known debt"), this is a **go**. I am NOT inflating MAJ-3-NEW to a second major or a blocker: it is a single un-wired surface, the fix is mechanically identical to the week-drill-down `groupSessionVolumes` wiring the design already fully specifies, and it does not crash. But it MUST be fixed during implementation — it is a real invariant break on a primary user surface, not acceptable permanent debt.

### Must-fix-during-implementation (carry into implementation.md)

1. **[MAJ-3-NEW]** Wire `app/(app)/history/index.tsx` (History list, surface #1): mount `useMeasurements`, pass `{ measurements }` into `groupSessionVolumes(weeklyVolumeData ?? [], { measurements })`. Without it the History-list per-session totals diverge from the week drill-down, verdict, strip, and chart for any bodyweight exercise. Apply in the same pass as the already-specified week-drill-down `groupSessionVolumes` wiring.

### Non-blocking notes for the Implementer

2. **[MIN-NEW-1]** Make `groupSessionVolumes(rows, bw?: WeeklyBodyweightInput)` do its OWN per-`session_id` `bodyweightKgAsOf` resolution and read equipment from `row.exercises.equipment` directly (mirror the other WVR kernels), rather than building an `equipmentByExerciseId` map to feed `sumLiveVolume` — the WVR pipeline has no such map.
3. **[MIN-NEW-2]** In the per-exercise "Sessions" list, resolve `bodyweightKg` per-row from each `SessionSets.started_at` (multi-session list), not a single value, so the rows and the trend chart agree.
4. **[MIN-NEW-3 / MIN-1 confirm]** In `computeVolumeTarget`, treat the selection gate (`:177-182`) as the FIRST of the three effective-weight spots — if the gate stays raw `w`, a `weight=0` Pull-up never becomes `currentSet` and the display/repsToBeat fix is dead.
5. The 5 v1 minors are all adequately resolved (verified above) — no further action beyond what design-v2 already specifies.

### Recommendation
`invoke Implementer` — with MAJ-3-NEW added to the implementation checklist as a must-fix in the same pass as the `groupSessionVolumes` change. The design is otherwise complete, internally consistent, and verified against source.
