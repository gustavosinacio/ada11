# Validation v1 — 2026-06-04_1700_routine-preview-start

Reviewing: `design-v1.md`

## Decision

**no-go**

0 blockers / **2 majors** / 3 minors → no-go per the rule (`2 or more majors → no-go`).
Round 1 of 3 (Design↔Validate). Budget healthy; a cheap v2 round resolves both
majors mechanically (they are test-scope completeness misses, not architecture
flaws). The production design — new route, moved handler, new read-only card,
reused start flow — is **sound and verified**; the no-go is entirely about an
**incomplete test-change blast radius**: the design names "exactly 5 tests change"
in ONE spec, but the row's a11y-label changes (relabel + Edit-pill removal) break
**two additional e2e specs the design never identified** (`crud.spec.ts`,
`probe-strong-unify.spec.ts`). Shipping as written leaves two specs red with no
instruction to the Implementer. See MAJ-1 / MAJ-2.

---

## Verification of Designer's claims

| # | Claim | Verified? | Evidence |
|---|---|---|---|
| 1 | `<RoutineListItem>` imported + rendered ONLY at `workout/index.tsx:13,143` | **yes** | grep `RoutineListItem` across `app/`+`src/`: only `workout/index.tsx:13` (import), `:143` (render), `routine-list-item.tsx:27` (definition). No 2nd consumer. |
| 1b | Removing `startFromRoutine`/`pendingRoutineId`/`startFromRoutineMut` from `workout/index.tsx` orphans nothing else | **yes** | `startFromRoutine` referenced only at `:145`; `pendingRoutineId` at `:32,65-66,81,148`; `startFromRoutineMut` at `:28,68`. All leave with the handler. `useStartSession`/`useActiveSession`/`hasActive` stay (used by `startAdHocWorkout` `:47-58` + `:45`). |
| 2 | Moved handler reproduces all 3 guards verbatim from `workout/index.tsx:60-83` | **yes** | Guard A active-routing `:61-63`; Guard B `pendingRoutineId` in-flight `:65-66,80-81`; Guard C seed-fail `catch` `:73-79`. Design's `onStart` (design-v1.md:202-227) matches byte-for-byte logic. |
| 2b | Success path is `router.replace` (not push) | **yes** | `workout/index.tsx:72` is `router.replace`. Sound choice — back from a live session must NOT return to the empty preview (R-8). See "assessed sound". |
| 3 | Start flow / seed / queries / editor / card / migration UNCHANGED | **yes** | `useStartSessionFromRoutine` (`use-sessions.ts:73-99`) untouched; `seedSetsForSession`, `listRoutineExercises` (`routine-exercises.ts:50-61`), `listRoutineExerciseSetsForRoutine` (`routine-exercise-sets.ts:53-69`) reused as-is. New caller only. No migration. |
| 3b | Preview grouping ≡ editor grouping (`routines/[id]/index.tsx:152-160`) | **yes** | Design's reducer (design-v1.md:81-89) is verbatim `routines/[id]/index.tsx:152-160`. `useRoutineExerciseSets(id).data` = `RoutineExerciseSetRow[]` (`use-routine-exercise-sets.ts:17-23`). Preview ≡ what-gets-seeded. |
| 4 | `<RoutineExerciseCard>` is edit-only → a NEW read-only card is genuinely needed | **yes** | Set rows are `<TextInput>` cells (`routine-exercise-card.tsx:353-376`) + move/trash (`:380-405`). No read-only mode. New component justified. |
| 4b | `displayWeight`/`displayReps` reusable on `target_weight`/`target_reps` | **yes** | `displayWeight(kgStr: string \| null, unit)` (`set-display.ts:41-50`) matches `target_weight: string\|null` (`db/types.ts:217`); `displayReps(reps: number \| null)` (`:57-60`) matches `target_reps: number\|null` (`:216`). |
| 4c | History read-only triad is an apt structural precedent | **yes** | `<ReadOnlySetRow>` (`read-only-set-row.tsx`), `<ReadOnlyExerciseBlock>` (`read-only-exercise-block.tsx`), `TYPE_BADGE` `:29-33`, `set_id→set_number` map `:46-52`+render `:112-123`. Operates on `SetRow` not `RoutineExerciseSetRow` — structural precedent, not drop-in (design R-5 says exactly this). |
| 4d | Card has the data it needs (name/equipment/set_type/targets) | **yes** | `RoutineExerciseEntry.exercise` has `name`/`muscles`/`equipment`; `formatEquipment` exported `db/types.ts:135`; subline formula matches editor `routine-exercise-card.tsx:140-149`. |
| 5 | In `routine-strong-builder.spec.ts`, tests 1,2,3,5,6 break; 4 hits editor directly; 7 is pure DB | **yes** | T1 `:217,222`; T2 `:272,276`; T3 double-tap `:325,327`; T5 `:420,424`; T6 `:486,493`. T4 `page.goto('/routines/${id}')` `:375` (no row tap). T7 admin-only, no `page` `:517-573`. **Exactly correct.** |
| 5b | New Start selector targets a real `<button>`/`aria-label`, not SVG | **yes** | `<Button>` is a `<Pressable accessibilityRole="button">` spreading `...rest` (`button.tsx:47-50`) → RN-Web `<button>` with `aria-label`. `getByLabel("Start workout")` resolves. |
| 5c | Test 6 seed-fail URL re-pin to the preview route is correct | **yes** | T6 `:493` asserts `/\/workout\/?$/`; with U9 (stay on preview), correct target is `/\/routines\/[0-9a-f-]+\/preview$/`. Re-pin needed (design R-2). |
| 5d | "Exactly 5 tests change" (whole-suite blast radius) | **NO — incomplete** | The 5-test count is correct **within `routine-strong-builder.spec.ts`**, but `crud.spec.ts:113` and `probe-strong-unify.spec.ts:217,232` also query the row's `Start workout:` / `Edit routine:` labels and break. See MAJ-1 / MAJ-2. |
| 6 | `disabled={hasActive}` KEEP + Guard A is internally consistent (U5) | **yes** | Rows dimmed/non-tappable when active (`workout/index.tsx:147`, `routine-list-item.tsx:34,41`); Guard A backstops if a session becomes active while preview is open. Single-active-session invariant holds on both surfaces. Consistent. |
| 7 | `RoutineListItemProps` drop of `onEditPress`/`pending` leaves no dangling refs | **partial** | In the COMPONENT + its one consumer (`workout/index.tsx:148`), yes. But the dropped `onEditPress` removes the row's "Edit routine:" affordance that `crud.spec.ts:113` + `probe-strong-unify.spec.ts:232` depend on — a behavioral/test dependency, not a type dangle. See MAJ-1. |
| 7b | No feature-flag/persisted-state creep; ad-hoc unchanged | **yes** | `startAdHocWorkout` (`workout/index.tsx:47-58,114-118,132-136`) untouched. No new persisted state — `pendingRoutineId` moves, not adds. |

---

## Issues found

### Blockers
- none.

### Majors

- **[MAJ-1]** `design-v1.md:387` ("Exactly 5 tests change") + F5 scope (design-v1.md:59, §"Close-the-set"
  254-258) — **the test blast radius is under-scoped: removing the row's Edit affordance breaks two
  e2e specs the design never identified.**
  - FACT: F4 deletes the row's trailing Edit `<Pressable>` (`routine-list-item.tsx:58-69`, label
    `accessibilityLabel={`Edit routine: ${routine.name}`}` at `:62`). The design drops `onEditPress`
    from the prop shape and the affordance from the row (design-v1.md:147-151,246).
  - FACT: `crud.spec.ts:113` — `test("routines: create, see in list, open detail, delete")` opens
    the builder via `page.getByLabel(\`Edit routine: ${name}\`).click()`. With the Edit pill removed,
    this selector resolves to nothing → the test fails at `:113` (and never reaches the delete-flow
    assertions). NOT in the design's F5 scope.
  - FACT: `probe-strong-unify.spec.ts:232` — `test("routine card with active session: opacity-60, tap
    is a no-op")` clicks `page.getByLabel(\`Edit routine: ${routineName}\`)` at `:232` to reach the
    builder during an active session. Same break. NOT in scope.
  - Why major (not blocker): the production code is correct and recoverable; the design simply omitted
    two specs from F5. But shipped as written, the Implementer is told "exactly 5 tests change" in one
    file and would leave `crud.spec.ts` + `probe-strong-unify.spec.ts` red. This is the
    close-the-set-on-the-LABEL gap (the component grep was right; the a11y-label fan-out was missed).
  - Suggested fix: extend F5 to cover BOTH specs. For each, the row no longer has an Edit pill; the
    Edit jump now lives in the preview header (`getByLabel("Edit routine")`, no `: {name}` suffix —
    note the design's preview Edit label is `"Edit routine"` per design-v1.md:99, which COLLIDES with
    the substring but not the exact pre-change `"Edit routine: {name}"`). Re-route the
    builder-open path: `crud.spec.ts` and the `probe-strong-unify` active-session test must now go
    **row → preview → header Edit**, OR `page.goto('/routines/{id}')` directly (the test 4 pattern).
    Pick one and pin it in F5.

- **[MAJ-2]** `design-v1.md` F4 / §"Close-the-set" — **the row a11y relabel "Start workout: {name}" →
  "View routine: {name}" breaks `probe-strong-unify.spec.ts:217`, also outside the named test scope.**
  - FACT: `probe-strong-unify.spec.ts:217` — `const row = page.getByLabel(\`Start workout: ${routineName}\`);`
    then asserts the dimmed-row opacity `0.6` (`:218-220`) and that a tap is a no-op (`:226-228`).
    After F4 relabels the row to "View routine: {name}" (`routine-list-item.tsx:43`, design-v1.md:154),
    `getByLabel("Start workout: ...")` matches nothing → the test fails at `:217` before the opacity
    assertion. The UNDERLYING behavior R-3 preserves (row stays `disabled={hasActive}` → `opacity-60`,
    tap no-op) is intact — but the test's SELECTOR is the old label, so it breaks on the relabel alone.
  - Why major (not blocker): recoverable in v2; mechanical. But it is a SECOND spec the "exactly 5
    tests" scope misses, and (with MAJ-1) it means a whole e2e file (`probe-strong-unify`) goes red.
  - Suggested fix: in `probe-strong-unify.spec.ts:217`, re-pin the row selector to
    `getByLabel(\`View routine: ${routineName}\`)`; keep the opacity-0.6 + no-op-tap assertions (they
    still hold under R-3). Combine with the MAJ-1 fix for the same test's `:232` Edit-pill click.
  - NOTE: this same test (`probe-strong-unify.spec.ts:188`) is the ONLY existing end-to-end proof of
    the **row-disabled-when-active** behavior the design's R-3 chooses to KEEP. Re-pinning it (rather
    than deleting it) is what keeps R-3's invariant proven. Call this out so the Implementer/Tester
    fixes the selector instead of removing the test.

### Minors

- **[MIN-1]** `design-v1.md:99` (preview header Edit label `"Edit routine"`) vs the old row label
  `"Edit routine: {name}"` — the new label is a **prefix** of the old. Any test using
  `[aria-label^="Edit routine"]` (prefix) would now ALSO match the preview header button. The two
  existing tests use EXACT `getByLabel(\`Edit routine: ${name}\`)` (not prefix), so no false-match
  today — but if the Implementer "fixes" them with a prefix selector, the preview header button could
  collide. Suggested fix: when re-pinning, use the exact preview-header label `getByLabel("Edit routine")`
  (exact) for the preview button and avoid `^=` prefix selectors on "Edit routine".

- **[MIN-2]** Test plan completeness (design-v1.md §"New preview-specific e2e" P1-P4) — the plan covers
  tap→preview-renders-targets (P1), Start-from-preview (P2), row-no-longer-starts regression (P3),
  Edit-jump (E7/P4). **Good coverage** — explicitly has the four tests "Also assess" asks for. One
  gap: no test asserts **Guard A (Start-while-active routes to the existing session, not a 2nd)** end-
  to-end (E4 is in the edge-case table but absent from the e2e plan). The existing suite proves the
  idempotency guard (T3) and seed-fail (T6) but NOT the active-routing guard on the new surface.
  Suggested fix: add a P5 — seed a routine, Quick-start an ad-hoc session, open the preview (if R-3
  keeps rows disabled, this requires opening the preview before going active, or via direct URL), tap
  Start, assert it lands on the EXISTING session id and `count===1` sessions. Low priority (Guard A is
  a verbatim move + the unit invariant is structurally simple), hence minor.

- **[MIN-3]** `design-v1.md:46` cites the History header pattern at `history/[id].tsx:299-308`; the
  actual Pencil/Done header `<Pressable>` block is `:288-308` (the Done arm `:300-307`). Off-by-a-few,
  harmless — the pattern is real and the design's `headerRight` snippet (design-v1.md:97-101) is a
  correct mirror. Suggested fix: none required; cosmetic citation drift.

---

## Items assessed and found SOUND (no issue)

- **replace-vs-push for Start success (R-8).** `router.replace('/(app)/workout/{sessionId}')` is
  correct: the user came from the preview, and a live session must not let `back` return to the
  now-stale empty preview. Mirrors `workout/index.tsx:72` + `history/[id].tsx:92-96`. **Sound.**
- **push-for-preview (row → preview).** `router.push('/(app)/routines/{id}/preview')` is correct —
  `back` from the preview should return to the Workout list. **Sound.**
- **U5 internal consistency.** KEEP `disabled={hasActive}` + Guard A is consistent: rows can't preview
  while active (no 2nd-start surface), and IF a session becomes active while the preview is open
  (cross-tab), Guard A routes to it. No path to a 2nd active session. **Sound** (and it matches the
  behavior `probe-strong-unify.spec.ts:188` asserts — see MAJ-2 note).
- **Idempotency double-tap on the preview's Start (T3).** After the 1st click sets `pendingRoutineId`
  + `router.replace`s, the 2nd click either hits the truthy guard (early return) or misses the
  unmounted button (caught). Either way exactly 1 session + 1 set. The assertion has real teeth
  (`count===1` AND `setCount===1`, `:335,343`), not a thinned/SVG surface. **Sound.**
- **New-route registration.** `routines/[id]/preview.tsx` auto-registers under the headerless
  `<Stack>` (`routines/_layout.tsx`) and owns its `<Stack.Screen>` like the editor — no manual
  registration. The `/routines→/workout` redirect test (`probe-strong-unify.spec.ts:80`) targets bare
  `/routines`, unaffected by the new sub-route. **Sound.**
- **No simpler/safer approach wrongly dismissed.** Option (b) reuse-editor-with-mode and (c) modal are
  correctly rejected (and (a) is the human-LOCKED choice). The "move handler, no shared hook" decision
  is correct given exactly one start caller survives. **Sound.**

---

## Issues raised in previous validation
N/A — round 1.

---

## Reasoning (decision)

- Rule: `2 or more majors → no-go`. Two majors (MAJ-1, MAJ-2) → **no-go**.
- Both majors are the SAME root: the design closed the set on the `<RoutineListItem>` *component*
  (correct — one consumer) but did NOT close it on the row's *a11y labels*. The label coupling fans
  out to two specs (`crud.spec.ts`, `probe-strong-unify.spec.ts`) outside the design's "exactly 5
  tests change in `routine-strong-builder.spec.ts`" scope. Shipped as written, two e2e files go red
  with no instruction.
- This is NOT a product-semantics ambiguity (the kind that forces a multi-round re-design). It is a
  test-completeness miss with a mechanical fix. A v2 that (a) extends F5 to cover `crud.spec.ts:113`,
  `probe-strong-unify.spec.ts:217,232`, and (b) decides the new builder-open path for those two tests
  (row→preview→header-Edit, or direct `goto`) closes both majors. Round budget is 3/3 — cheap.

### What v2 must address
1. **MAJ-1** — add `crud.spec.ts:113` and `probe-strong-unify.spec.ts:232` to the test-change scope.
   Re-route their "open the builder" step now that the row's Edit pill is gone (use the preview header
   `getByLabel("Edit routine")` or `page.goto('/routines/{id}')`). Update the "exactly 5 tests change"
   prose to the true count (5 in `routine-strong-builder` + 1 in `crud` + 1 in `probe-strong-unify`).
2. **MAJ-2** — add `probe-strong-unify.spec.ts:217` re-pin (`Start workout:` → `View routine:`),
   preserving the opacity-0.6 + no-op-tap assertions (R-3 keeps the behavior). Do NOT delete the test —
   it is the only e2e proof of the row-disabled-when-active behavior R-3 chooses to keep.
3. (Optional) MIN-1/MIN-2/MIN-3 — exact-label selector for the preview Edit button; a Guard-A active-
   routing e2e; the cosmetic citation fix.

No peer invocations — all claims settled by direct source + test verification.
