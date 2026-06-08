# Run: 2026-06-04_1700_routine-preview-start

## Feature prompt
Routine preview-then-start (Strong-style). Tapping a routine on the Workout page should open a read-only PREVIEW of it (the routine's exercises + their target sets/reps/weight) instead of starting the session immediately; that preview has a "Start workout" button that begins the session. Today tapping a routine row starts the workout DIRECTLY (`workout/index.tsx:145` → `startFromRoutine` → live session), and the only routine detail screen (`routines/[id]/index.tsx`) is the EDITOR (reached via a separate "Edit" affordance), with no start button.

## Baseline
- Branch: main
- baseline_branch: main
- Commit: 592dd51a2baceaf38389efd10a609fe752e490dd
- baseline_commit: 592dd51a2baceaf38389efd10a609fe752e490dd

> Working tree clean at baseline except pre-existing screenshot PNG noise in
> OTHER runs' folders (+ favorites run state.md). Not part of this run.

## Current state
- Owner: conductor → evaluator
- Step: 7. Finalize (Test PASS after Tester-socket-drop recovery; final-summary + Evaluator)
- Round (current loop): n/a (D↔V 2 rounds; I↔R 1; I↔T 1)
- Status: done
- Started (BRT): 2026-06-04 17:00
- Updated (BRT): 2026-06-08 14:00

## Budgets remaining
- Design ↔ Validate rounds: 2 / 3 (round 1 consumed: v1 NO-GO — 2 majors, e2e label-selector fan-out)
- Implement ↔ Review rounds: 2 / 2
- Implement ↔ Test rounds: 2 / 2
- Implementer soft-callbacks: 2 / 2

## Artifacts produced
- [x] discovery.md
- [x] design-v1.md
- [x] validation-v1.md (NO-GO — 0 blockers / 2 majors / 3 minors)
- [x] design-v2.md
- [x] validation-v2.md (GO — 0 blockers / 0 majors / 3 new minors)
- [x] implementation.md (7 files: 2 new + 5 edited; typecheck/lint clean; vitest 515/515; labels close-set re-grep 0 stale)
- [x] review-v1.md (PASS — 0 blockers / 0 majors / 2 minors)
- [x] test-report-v1.md (PASS — e2e 24/25; 1 fail pre-existing+out-of-scope; Guard-A teeth RED→GREEN; prod code unchanged)
- [x] final-summary.md
- [ ] retro.md (post-run, filled in by owner)

## Follow-up clarifications
- 2026-06-07 — Human resolved the 3 escalated unknowns (all recommended):
  - **U1** → **NEW read-only route `app/(app)/routines/[id]/preview.tsx`** (exercises + per-set target reps/weight + Start button). New read-only card component (precedent: History read-only `<ReadOnlySetRow>`/`set-display.ts`); editor stays separate. NOT reuse-editor-with-mode, NOT modal.
  - **U3** → **Preview-only**: tapping a routine row navigates to the preview (no one-tap direct-start). `startAdHocWorkout` "Quick start workout" button UNCHANGED. So the row's main Pressable becomes `router.push(preview)`; `startFromRoutine` MOVES into the preview (U2.i — no direct-start to share with).
  - **U4** → **Edit button IN the preview** (header → `/routines/{id}` builder). The row's separate "Edit" affordance is REMOVED (preview is the hub) → `<RoutineListItem>` becomes a single Pressable → preview (drop `onEditPress`). Row a11y label → "View routine: {name}".
- Designer adopts Discovery defaults for the rest: U2.i (move the start handler — `useStartSessionFromRoutine` + the `pendingRoutineId`/`active.data`/seed-fail guards from `workout/index.tsx:60-83` — INTO the preview, don't reimplement); U5 (preview is read-only so it's safe while a session is active — recommend allow preview anytime and the preview's Start routes to the ACTIVE session when one exists, mirroring today's `:61-63` push-to-live, preserving the single-active-session invariant; Designer finalizes vs the current rows-disabled-when-active behavior); U6 allow Start on empty routine (parity); U7 mirror the editor's filtered `exercise:exercises(*)` join (preview ≡ what-gets-seeded); U8 a11y label "View routine: {name}" + update the 5 `routine-strong-builder.spec.ts` tests to add a preview→Start step + new Start selector; U9 seed-fail stays on the preview with an error (re-pin test 6's URL assertion to the preview route).

## Decisions / events log
- 2026-06-04 17:00 — Conductor: run scaffolded; baseline 592dd51 (clean). Feature = routine preview-then-start (Strong-style). Likely a UI/navigation feature reading EXISTING data (routine_exercises + routine_exercise_sets — the Strong-like builder already stores targets); no migration expected. Discovery invoked.
