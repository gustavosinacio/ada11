# Review v1 — 2026-06-04_1700_routine-preview-start

## Decision

**pass**

0 blockers / 0 majors / 2 minors → **pass** (rule: 0 blockers and ≤1 major). Both minors are
runtime-handoff / cosmetic, neither a regression. Recommend: **invoke Tester**.

Baseline: `592dd51` (the run's recorded `baseline_commit`). **The changes are in the working tree
(uncommitted) — `HEAD` IS `592dd51`.** Reviewed via `git diff 592dd51` (5 edited tracked files) +
direct read of the 2 new untracked files. 7 files total, matching the design's F1–F5.

Gates re-run by the Reviewer (NOT trusted from implementation.md):
- `npm run typecheck` → `tsc --noEmit` **0 errors** (exit 0). ✔ matches.
- `npm run lint` → **0 errors / 1 warning** (`router.d.ts`, pre-existing/baseline). ✔ matches.
- Full vitest is the Tester's; this is a UI/nav feature with no new pure presenter (design F6 says
  none) — no new unit tests, which is correct. Did not spot-run (no correctness question needed it).

---

## What I verified (the load-bearing risks)

### 1. The moved Start handler keeps ALL 3 guards — byte-for-byte equivalent ✔

Source-diffed the deleted `workout/index.tsx:60-83` `startFromRoutine` (read from baseline via
`git show 592dd51:'app/(app)/workout/index.tsx'`) against `preview.tsx:100-124` `onStart`:

| Guard | Baseline `startFromRoutine` | `preview.tsx` `onStart` | Verdict |
|---|---|---|---|
| A — active routing | `if (active.data) { router.push(\`/(app)/workout/${active.data.id}\`); return; }` (`:61-63`) | `preview.tsx:105-108` identical, on `active.data.id` | ✔ routes to existing session, NOT a 2nd |
| settle-gate (closes A's race) | `if (active.isLoading) return <ActivityIndicator/>` (`workout/index.tsx:37-43`) | `preview.tsx:52-59` identical, BEFORE the routine-loading branch | ✔ no race window |
| B — in-flight | `if (pendingRoutineId) return; setPendingRoutineId(r.id); … finally { setPendingRoutineId(null) }` (`:65-66,80-81`) | `preview.tsx:111-112,121-122` identical; `pendingRoutineId` state moved verbatim (`:47`) | ✔ double-start blocked |
| C — seed-fail | `catch (err) { console.warn("Start failed", err); }` — stays on screen, no `router.back()` (`:73-79`) | `preview.tsx:116-120` identical; stays on the preview | ✔ no broken nav |
| success | `router.replace(\`/(app)/workout/${row.id}\`)` (`:72`) | `preview.tsx:115` identical (`replace`, not push) | ✔ back doesn't return to preview mid-session |

The handler is the verbatim relocation, parameterized to `routine.data`. `useStartSessionFromRoutine`
(`use-sessions.ts`) and `seedSetsForSession` are NOT touched — the preview is a new CALLER of the
identical flow (confirmed: no `.from()`/`.insert()`/`.rpc()` in either new file).

### 2. No start-flow / data / migration change ✔

- No edits to `use-sessions.ts`, the seed, `useRoutineExercises`/`useRoutineExerciseSets`, the editor
  `routines/[id]/index.tsx`, `<RoutineExerciseCard>`, or any migration (diff touches only the 7 named
  files; `git diff --name-only` confirms).
- The preview's data hooks + grouping match the editor: `setsByExercise` reducer in `preview.tsx:87-95`
  is byte-identical to the editor's `routines/[id]/index.tsx:152-160`.
- Soft-deleted handling mirrors the editor by CONSTRUCTION: the preview calls the SAME
  `useRoutineExercises` hook → `listRoutineExercises` (`.select("*, exercise:exercises(*)")` +
  `.is("deleted_at", null)` on `routine_exercises`, `routine-exercises.ts:50-61`). No `(deleted)`
  special-case in the editor card (`routine-exercise-card.tsx:140-149`) and none in the read-only card
  — both render `entry.exercise.name` + `[muscles, formatEquipment(equipment)]`. Preview ≡
  what-gets-seeded (U7). ✔

### 3. `<RoutineListItem>` collapse ✔

- Single Pressable; `onPress` re-pointed to `router.push(\`/(app)/routines/${item.id}/preview\`)`
  (`workout/index.tsx:108` after edit). `onEditPress`/Edit-pill/`pending` removed; `Pencil` import
  removed.
- a11y label `"Start workout: ${name}"` → `"View routine: ${name}"` (`routine-list-item.tsx:43`).
- **`disabled={hasActive}` KEPT** with the byte-for-byte gating: `opacityClass = disabled ?
  "opacity-60" : ""` and `onPress={disabled ? undefined : onPress}` (single Pressable, no-op tap when
  active). The `|| pending` term is the only thing dropped from `effectivelyDisabled`; `disabled`
  still flows from `workout/index.tsx`. Opacity lives on the outer `<View>`, untouched by the relabel.
  Matches `probe-strong-unify.spec.ts:218-220` (opacity `0.6`) + `:226-228` (no-op tap).
- Prop-type `Props` has no dangling refs: `workout/index.tsx` no longer passes `onEditPress`/`pending`,
  and the orphaned `startFromRoutine`/`pendingRoutineId`/`startFromRoutineMut`/`useStartSessionFromRoutine`/
  `RoutineRow`/`useState` imports are all removed (verified in the diff — `useStartSession`/
  `useActiveSession`/`hasActive`/`startAdHocWorkout` STAY, used by the ad-hoc path).

### 4. `<ReadOnlyRoutineExerciseCard>` ✔

- Read-only render — no `<TextInput>`, no callbacks in `Props` (`entry`/`sets`/`unit` only). NOT a
  refactor of `<RoutineExerciseCard>` (separate file; editor card untouched).
- Uses `displayWeight(s.target_weight, unit)` / `displayReps(s.target_reps)` from `set-display.ts` —
  exact type match (`target_weight: string|null` / `target_reps: number|null` vs the helpers'
  `string|null` / `number|null`).
- Renders per-set badge (W/•/↓), dropset "↳N" parent ref via an internal `set_id → set_number`
  `useMemo` map, set_number, weight, reps, plus the exercise name/equipment subline using the editor's
  exact formula. Column-header strip only when `sets.length > 0`; empty-state `"No sets configured."`
  when `sets.length === 0`. Sensible.

### 5. Preview screen ✔

- Loads via the editor's hooks (`useRoutine`/`useRoutineExercises`/`useRoutineExerciseSets`). Loading
  + error branches mirror the editor, each with a `<Stack.Screen headerShown:true>`.
- Header `headerRight` Edit `<Pressable>` → `accessibilityLabel="Edit this routine"` (EXACT, no colon
  collision with the old `"Edit routine: {name}"`; visible text stays "Edit") → `router.push(
  \`/(app)/routines/${id}\`)` (the builder). ✔ MIN-1 fix landed.
- "Start workout" via `<Button label="Start workout" loading={startMut.isPending} />` — a real
  `<Button>`. **Note on the a11y handle (Tester confirm):** `<Button>` (`button.tsx:37-62`) does NOT
  set an explicit `accessibilityLabel`; it sets `accessibilityRole="button"` and renders `label` as a
  `<Text>` child, so the accessible NAME is computed from text content. `getByLabel("Start workout")`
  resolves via accessible-name-from-content (the same path every existing `<Button>` query uses, e.g.
  "Save details", "Quick start workout"). The Validator's "renders `aria-label`" phrasing is slightly
  imprecise but the queryable outcome is the same. Not an issue — handed to T-2.
- Empty-routine copy `"No exercises in this routine yet."`; Start allowed on empty routine (U6 parity).

### 6. e2e label close-set + the 2 deviations ✔

- **Re-grep (mine, not trusted):** `Start workout:` / `Edit routine:` / `aria-label^="Start workout` /
  `aria-label^="Edit routine` across `tests/ src/ app/` → **0 matches** (grep exit 1). 0 stale.
- New `View routine:` sites: 10 in `routine-strong-builder` (S2–S6 + P1/P3/P4/P5), 2 in
  `probe-strong-unify` (S7 + doc), 1 in `crud` (E1), 1 def in `routine-list-item.tsx:43`. `Edit this
  routine` exact: def `preview.tsx:138` + P4 (`:712`) + crud E1 (`:119`). The preview Start label is
  `"Start workout"` (no colon) — distinct from the deleted row `"Start workout:"` (colon), so the
  specs' `getByLabel("Start workout")` only ever resolves to the preview `<Button>`.
- The 5 `routine-strong-builder` tests (1,2,3,5,6) each got the row-selector re-point + a
  `waitForURL(/preview$/)` + `getByLabel("Start workout").click()` preview→Start step; the live-session
  + admin-count teeth are unchanged (`count===1`, `setCount===3/0`). Test 3's double-tap correctly
  moved onto the preview's Start button. Test 6's URL re-pinned to `/preview$` (R-2). S1 stale warmup
  line DELETED.
- `probe-strong-unify:217` re-pinned to `View routine:` with opacity-0.6 + no-op-tap PRESERVED;
  E2 (`:232`) re-routed to direct `page.goto('/routines/{id}')` reading the id once via admin
  (`admin`/`userId` in scope; row disabled-while-active so preview path is correctly unreachable).
- `crud:113` E1 re-routed via row→preview→header `"Edit this routine"`; the `/preview$` then
  `/routines/[id]$` waits correctly distinguish preview from builder.
- **Deviation (i) — crud post-delete (`crud.spec.ts:128-136`):** SOUND. The re-route changes the
  builder's back-stack origin (`/workout`→push→`/preview`→push→builder), so the builder's `onDelete`
  → `router.back()` (`routines/[id]/index.tsx:107`) now pops to `/preview`, NOT `/workout`. The
  original `:124` `waitForURL(/\/workout$/)` would go red. The Implementer replaced the implicit
  back-destination assertion with an explicit `page.goto("/workout")` + `expect(getByText(name))
  .not.toBeVisible()`. Delete-flow teeth PRESERVED (dialog accepted → routine soft-deleted → gone from
  the list); the `goto` is unconditional so the teeth hold regardless of where `back()` lands. A
  legitimate minimal correction of an unexamined design assumption ("assertions UNCHANGED"). Justified
  + documented (`implementation.md:35`).
- **Deviation (ii) — test 1 `routineId` destructure dropped:** SOUND. The deleted stale S1 warmup line
  (`getByLabel(\`Start workout: Golden RSB ${routineId.slice(0,0)||""}\`)`) was the ONLY consumer of
  `routineId` in test 1 (the session is read via admin). Dropping the destructure avoids an unused-var
  lint error. Genuinely unused after the warmup-line removal. Mechanical, within the design's "DELETE
  this stale warmup line" instruction.

### 7. MIN-NEW-1 teeth — P5 Guard-A e2e has real teeth ✔ (no false-green)

P5 (`routine-strong-builder.spec.ts:727-793`) seeds the active session as `{ user_id, started_at:
now, ended_at: null }` — which MATCHES `getActiveSession`'s exact predicate (`deleted_at IS NULL` AND
`ended_at IS NULL`, order `started_at DESC` limit 1 — `sessions.ts:26-36`). So `useActiveSession.data`
is truthy on reload → Guard A fires. Teeth: asserts the URL lands on `existingId` (`toContain`) AND
sessions `count === 1`. **If Guard A were removed**, `onStart` would skip past `:105-108` to start a
NEW session and `router.replace` into it (a different id) → `existingId` NOT in the URL AND count would
be 2; BOTH assertions go red. Genuine teeth — not a false-green. P5 opens the preview FIRST (row
interactive only while no session active), then seeds + `purgeQueryCache` (clears `ada11-query-cache`)
+ deep-link `page.goto(...preview)` so `useActiveSession` rehydrates. (See MIN-1 below for the one
runtime-timing item to confirm.)

### 8. Style / security ✔

- No new `any`/`as unknown`/`@ts-ignore`/`@ts-expect-error`/`eslint-disable` (grep-clean across all 4
  source files).
- No new query surface / no `SERVICE_ROLE` / no `.from()`/`.insert()`/`.rpc()` / no `EXPO_PUBLIC_*` in
  the new files — pure UI reusing existing RLS-protected hooks. (`SERVICE_ROLE` appears only in the
  test-only e2e admin client, never bundled.) The 2 `console.warn("Start failed", err)` are
  intentional Guard-C error logs matching the existing pattern; no `console.log`.
- Imports `~/`-rooted, package-first with a blank-line separator (both new files). New files in
  conventional folders: the route under `app/(app)/routines/[id]/`, the component under
  `src/components/`. Comments narrate WHY (the moved-handler provenance + 3-guard rationale, the
  read-only-by-construction contract, the settle-gate race rationale).

---

## Issues

### Blockers
- none.

### Majors
- none.

### Minors

- **[MIN-1] (runtime hand-off, not a defect)** — `routine-strong-builder.spec.ts:770-784` (P5
  rehydration timing). P5 relies on `purgeQueryCache` + a deep-link `page.goto(...preview)` causing
  `useActiveSession` to refetch the just-seeded active row BEFORE the `getByLabel("Start workout")`
  tap. Statically this is sound (mutation-free reload, fresh query on mount), but whether the refetch
  has SETTLED at tap time is a runtime-timing property the static review cannot confirm — if it taps
  before `active.data` populates, Guard A is skipped, P5 starts a 2nd session, and the count assertion
  goes red (a flaky-red, not a false-green). The Implementer's `implementation.md:55` reasons it's a
  deep-link reload with no optimistic write to race. **Tester T-1:** confirm P5 is deterministically
  green (not flaky) — if it flakes, add an explicit settle wait (e.g. await the row/state to reflect
  the active session) before the Start tap, mirroring `probe-strong-unify`'s `PERSIST_FLUSH_MS`
  convention. Severity MINOR (test-side timing; the assertion teeth themselves are correct).

- **[MIN-2] (runtime hand-off, not a defect)** — `preview.tsx:166-170` + the specs'
  `getByLabel("Start workout")`. The preview Start `<Button>` exposes its accessible name via text
  content (`button.tsx` sets `accessibilityRole="button"` but no explicit `accessibilityLabel`), so
  `getByLabel("Start workout")` resolves through RN-Web's accessible-name-from-content path. This is
  the same path every existing `<Button>` query uses and is almost certainly fine, but it is the one
  e2e handle the static review can't execute. **Tester T-2:** confirm `getByLabel("Start workout")`
  actually resolves to the preview Button on RN-Web (a regular queryable handle, not a never-queried
  surface). Severity MINOR (high-confidence-sound; runtime-confirmable only).

---

## Items assessed and found SOUND (no issue)

- Moved handler is the verbatim relocation with all 3 guards + settle-gate (source-diffed against the
  baseline commit, region-by-region).
- Grouping reducer byte-identical to the editor; soft-delete handled by construction (same hook).
- Row `disabled`/opacity-60/no-op-tap semantics intact under the single-Pressable collapse.
- No orphaned imports/props after the `workout/index.tsx` + `routine-list-item.tsx` edits.
- Label close-set genuinely closed: 0 stale refs (my own re-grep), new labels collision-proof
  (`"Edit this routine"` exact, `"Start workout"` no-colon distinct from the deleted row label).
- crud + test-1 deviations are both justified, minimal, teeth-preserving corrections.
- P5 Guard-A teeth are real (correct active-session predicate; would go red if Guard A removed).
- No migration / new query / secret / `any`.

---

## Tester hand-off — e2e flows to actually run

1. **Tap row → preview renders targets** (P1): row tap lands on `/routines/{id}/preview`, the
   exercise name + the distinctive `"137.5"` weight render on real `<Text>` nodes.
2. **Start → live session** (test 1 / P2): preview Start → `router.replace('/workout/{newId}')`, 3
   seeded sets via admin.
3. **Start-while-active → existing session** (P5, MIN-1): confirm DETERMINISTICALLY green (no flake)
   AND that it would FAIL if Guard A were removed (lands on the pre-existing id, count===1).
4. **Edit jump** (P4): preview header `"Edit this routine"` → builder (`/routines/{id}$`, no
   `/preview`), "Exercises" visible.
5. **Row no-op when active** (`probe-strong-unify`): dimmed row (opacity 0.6) tap stays on `/workout$`.
6. **crud delete flow**: routine deleted + gone from the Workout list after the re-routed
   builder-open + the explicit `goto("/workout")`.
7. **T-2:** `getByLabel("Start workout")` resolves to the preview `<Button>` on RN-Web.
8. **Live catalog:** the e2e seeds use `pickCanonicalExercise(admin, "Bench Press")` — confirm it
   resolves in the live canonical catalog (Implementer probed it green; a throw = catalog drift).

---

## Reasoning (decision)

- Rule: `0 blockers and ≤1 major → pass`. 0 blockers, 0 majors → **pass**.
- The single biggest correctness risk (the moved handler dropping a guard) is closed by a
  region-by-region source-diff against the baseline commit: all 3 guards + the settle-gate +
  `router.replace` success are byte-for-byte preserved. No start-flow/data/migration change.
- The 2 minors are both runtime-handoffs (P5 rehydration timing; the Button a11y handle), neither a
  regression and both Tester-confirmable. No design deviation is unjustified — the 2 declared
  deviations (crud back-stack, test-1 destructure) are minimal teeth-preserving corrections documented
  in `implementation.md`.
- Recommendation: **invoke Tester**.

No peer invocations — all claims settled by direct source verification (baseline source-diff,
predicate read, type-match read) + re-running the offline gates.
