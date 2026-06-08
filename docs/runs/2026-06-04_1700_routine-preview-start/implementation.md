# Implementation — 2026-06-04_1700_routine-preview-start

Based on: `design-v2.md` (final approved) and `validation-v2.md` (matching `go` — 0 blockers / 0 majors / 3 new minors carried forward as must-fix notes).

## Files changed

### New
- `app/(app)/routines/[id]/preview.tsx` (new, F1) — read-only routine preview screen. Loads the editor's three hooks (`useRoutine` + `useRoutineExercises` + `useRoutineExerciseSets`), groups sets by `routine_exercise_id` with the editor's verbatim reducer, renders each exercise via the new read-only card, hosts the MOVED Start handler (all 3 guards), and a header "Edit this routine" jump. `active.isLoading` settle-gate + routine loading/error branches mirror the editor.
- `src/components/read-only-routine-exercise-card.tsx` (new, F2) — read-only render of ONE routine exercise + its per-set targets. Structural mirror of `<ReadOnlyExerciseBlock>`/`<ReadOnlySetRow>` onto `RoutineExerciseEntry` + `RoutineExerciseSetRow` (targets), using `displayWeight`/`displayReps` from `set-display.ts`. Header subline reuses the editor's exact `[muscles, formatEquipment(equipment)].filter(Boolean).join(" · ")` formula. No callbacks (read-only by construction). Empty state `"No sets configured."`.

### Edited
- `app/(app)/workout/index.tsx` (edited, F3) — deleted `startFromRoutine` (`:60-83`), the `pendingRoutineId` state (`:30-32`), `startFromRoutineMut` (`:28`), the `useStartSessionFromRoutine` import, the now-unused `useState`/`RoutineRow` imports. Re-pointed `renderItem` to `onPress={() => router.push('/(app)/routines/{id}/preview')}`, dropped `onEditPress`/`pending`. `startAdHocWorkout`/"Quick start workout"/`useStartSession`/`useActiveSession`/`hasActive` UNCHANGED.
- `src/components/routine-list-item.tsx` (edited, F4) — collapsed to a single Pressable → preview. Dropped `onEditPress`/`pending` props + the Edit pill block + the `Pencil` import. a11y label `"Start workout: {name}"` → `"View routine: {name}"`. KEPT `disabled` → opacity-60 + `onPress={disabled ? undefined : onPress}` no-op (the active-session behavior `probe-strong-unify` asserts). Chevron now always shown.
- `tests/e2e/routine-strong-builder.spec.ts` (edited, F5) — tests 1,2,3,5,6 re-pointed (S1 stale warmup DELETED; S2–S6 row selectors `[aria-label^="Start workout: …"]` → `[aria-label^="View routine: …"]`) + a preview→Start insertion after each row click; test 3's double-tap moved to the preview's Start button; test 6's URL re-pinned to `/routines/{id}/preview$`. Added 4 new preview tests: P1 (preview renders targets), P3 (row never direct-starts), P4 (header Edit jump), P5 (Guard A active-routing).
- `tests/e2e/crud.spec.ts` (edited, F5) — E1 (`:113`) builder-open re-routed from the deleted Edit pill to row → preview → header "Edit this routine". Post-delete assertion adjusted (see Deviations).
- `tests/e2e/probe-strong-unify.spec.ts` (edited, F5) — S7 (`:217`) selector re-pinned `Start workout: {name}` → `View routine: {name}`; opacity-0.6 + no-op-tap assertions PRESERVED. E2 (`:232`) builder-open re-routed via direct `page.goto('/routines/{id}')` (the row is disabled-while-active so the preview is unreachable), reading the routine id once via admin.

## Moved-handler-keeps-3-guards confirmation
The `onStart` handler in `preview.tsx` is a verbatim relocation of `workout/index.tsx:60-83`, parameterized to `routine.data`. All three guards preserved:
- **Guard A** (active routing): `if (active.data) { router.push('/(app)/workout/{active.data.id}'); return; }` — routes to the EXISTING session, not a second one. The `active.isLoading` settle-gate (`preview.tsx`) closes the race window (mirrors `workout/index.tsx:37-43`).
- **Guard B** (in-flight idempotency): `pendingRoutineId` state moved here verbatim; `if (pendingRoutineId) return;` then `setPendingRoutineId(r.id)` / `finally { setPendingRoutineId(null) }`.
- **Guard C** (seed-fail hard-fail): the `catch` keeps the user on `/routines/{id}/preview` with `console.warn("Start failed", err)`; no `router.back()`.
- Success path: `router.replace('/(app)/workout/{row.id}')`.
- `useStartSessionFromRoutine` / `seedSetsForSession` NOT touched (new caller only).

## Label close-set re-grep result (proving 0 stale refs)
`grep -rn 'Start workout:|Edit routine:|aria-label^="Start workout|aria-label^="Edit routine' tests/ src/ app/` → **0 matches (exit 1)**. All 9 query sites (7 `Start workout:` + 2 `Edit routine:`) across the 3 specs were updated. The preview Start button renders `aria-label="Start workout"` (NO colon) — the intended new handle, correctly distinct from the old `Start workout:` (with colon) row label. "Quick start workout" (the ad-hoc visible-text button) is untouched and is a `getByText`, not an `aria-label`.

## The 3 new MINORS (validation-v2)
- **MIN-NEW-1** (P5 active-session seeding + teeth): P5 (`routine-strong-builder.spec.ts`) seeds the active session via admin matching `getActiveSession`'s exact predicate (`deleted_at IS NULL` + `ended_at IS NULL`, `sessions.ts:25-36`) — insert `{ user_id, started_at, ended_at: null }`. `sessions` has no CHECK constraints (`0000_schema.sql:39-49`), so the row is valid. TEETH: asserts the URL lands on the pre-existing session id (`page.url()` contains `existingId`) AND sessions `count === 1`. If Guard A were removed, Start would create a 2nd session and `router.replace` into it — the URL would NOT contain `existingId` AND count would be 2; both assertions go red.
- **MIN-NEW-2** (citation cosmetic): no code impact; not propagated into any comment.
- **MIN-NEW-3** (P1 weight anchor): P1 seeds a distinctive non-collision-prone weight `"137.50"` → displays `"137.5"`, which is unique in the preview, so `getByText("137.5", { exact: true })` cannot false-match a stray value. Also asserts the exercise name is visible — both on real `<Text>` nodes (not SVG ticks).

## Deviations from design
- **`crud.spec.ts` post-delete assertion (E1 re-route side-effect).** The design pinned the crud builder-open re-route to row → preview → header "Edit this routine" and described the delete-flow assertions (`:116-125`) as "UNCHANGED". But the re-route changes the builder's back-stack origin: previously `/workout` →push→ builder (Edit pill), so the builder's `onDelete` → `router.back()` (`routines/[id]/index.tsx:107`) returned to `/workout`; now `/workout` →push→ `/preview` →push→ builder, so `router.back()` pops to the (now-deleted) `/preview`, NOT `/workout`. The original `:124` `waitForURL(/\/workout$/)` would go red. I preserved the delete-flow's teeth (routine deleted + gone from the Workout list) by replacing the implicit `router.back()`-destination assertion with an explicit `page.goto("/workout")` + `expect(getByText(name)).not.toBeVisible()`. Same intent (delete succeeds, routine no longer listed), corrected for the legitimately-changed back-stack. The Validator's viability review (validation-v2.md:62-73) confirmed the re-route reaches the builder but did not flag the `router.back()` origin change — this is the minimal correctness fix within the design's intent. Confidence HIGH / Risk LOW (test-only, teeth preserved).
- **Test 1 `routineId` destructure dropped.** The design's S1 action deletes the stale `getByLabel(\`Start workout: Golden RSB ${routineId.slice(0,0)||""}\`)` warmup line, which was the only consumer of `routineId` in test 1. Dropped the `const { routineId } =` destructure to avoid an unused-var lint error (the session is read via admin). Mechanical, within the design's "DELETE this stale warmup line" instruction.

## Soft callbacks made (during this implementation pass)
- None. The one real ambiguity (the crud `router.back()` origin change) was resolvable within the design's intent against source and is recorded above as a justified deviation. Budget intact: 2/2.

## Quality gates
- [x] `npm run typecheck` passed — `tsc --noEmit` 0 errors. Run after the production edits (before touching e2e) and again at the end. No `replace_all` used — every edit was surgical/uniquely-anchored, so no shadow-rename risk.
- [x] `npm run lint` passed — 0 errors / 1 pre-existing warning (`.expo/types/router.d.ts`, baseline-unchanged).
- [x] Relevant unit tests pass — `npx vitest run` → **515/515** (baseline 515 unchanged; UI/nav-only feature, no new pure presenter → no new unit tests per design F6).
- [x] No new `any` — grep-clean (`: any`/`as any`/`as unknown` = 0) across all touched source.
- [x] No new `// @ts-ignore` — grep-clean (no `@ts-ignore`/`@ts-expect-error`/`eslint-disable`).
- [x] No stray `console.log` — grep-clean. The 2 `console.warn("Start failed", err)` (preview Guard C + ad-hoc) are intentional error logs matching the existing pattern.

## Notes for Reviewer / Tester
- **Reviewer — scrutinize the moved handler's 3 guards** (`preview.tsx`) against the verbatim source `workout/index.tsx:60-83` (now deleted): confirm Guard A routes to `active.data.id`, Guard B uses the moved `pendingRoutineId`, Guard C stays on the preview with `console.warn`, success = `router.replace`. Confirm `useStartSessionFromRoutine`/`seedSetsForSession` are unchanged (new caller only, no migration/query change).
- **Reviewer — confirm the F4 row semantics survive** the relabel + Edit-pill removal: opacity-60 lives on the outer `<View>`, `onPress={disabled ? undefined : onPress}` gates the single Pressable — both untouched by the relabel.
- **Reviewer — the crud deviation**: confirm the post-delete `page.goto("/workout")` + not-visible assertion preserves the delete-flow teeth given the back-stack origin change.
- **Tester — live catalog**: the e2e seeds use `pickCanonicalExercise(admin, "Bench Press")`, verified present in the live canonical catalog (`user_id IS NULL`, `deleted_at IS NULL`) via a read-only probe during this run; it is also the proven-green name across the existing 7 tests.
- **Tester — P5 teeth**: confirm P5 FAILS (creates a 2nd session, URL not containing `existingId`) if Guard A is removed from `preview.tsx`. The seeded active session matches `getActiveSession`'s predicate.
- **Tester — nav-race awareness**: P5 reloads the preview via `page.goto` after seeding the active session so `useActiveSession` rehydrates; this is a mutation-free deep-link reload (no optimistic write to race). The `probe-strong-unify` active-session test retains its pre-existing `PERSIST_FLUSH_MS` wait convention.
- **Do NOT run playwright/e2e here** — the Tester owns the e2e run.
