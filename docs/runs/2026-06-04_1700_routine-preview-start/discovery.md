# Discovery — 2026-06-04_1700_routine-preview-start

## Feature prompt
"Routine preview-then-start (Strong-style). Tapping a routine on the Workout page should open a read-only PREVIEW of it (the routine's exercises + their target sets/reps/weight) instead of starting the session immediately; that preview has a 'Start workout' button that begins the session."

## Premise check (verify-the-prompt-against-live-code — the standing first move)
- **The Conductor's framing is FACT, verified by reading.** Today tapping a routine row STARTS the session immediately: `<RoutineListItem onPress>` (`app/(app)/workout/index.tsx:145`) → `startFromRoutine(item)` (`:60-83`) → `useStartSessionFromRoutine().mutateAsync` → `router.replace('/(app)/workout/{id}')` (`:72`). The "Edit" affordance (`:146`) → `/(app)/routines/{id}` (the EDITOR). VERIFIED.
- **The data for a preview ALREADY EXISTS — NO migration, NO new query needed (FACT, HIGH confidence).** The editor already loads the exact shape a preview wants: `useRoutineExercises(id)` (`src/hooks/use-routine-exercises.ts:16-22` → `listRoutineExercises` `src/api/routine-exercises.ts:50-61`, returns `RoutineExerciseEntry = RoutineExerciseRow & { exercise: ExerciseRow }` with name/equipment/muscles via `select("*, exercise:exercises(*)")`) and `useRoutineExerciseSets(id)` (`src/hooks/use-routine-exercise-sets.ts:17-23` → `listRoutineExerciseSetsForRoutine` `src/api/routine-exercise-sets.ts:53-69`, returns `RoutineExerciseSetRow[]` with `set_number / set_type / target_reps / target_weight / parent_set_id`, sorted `set_number ASC`). The editor groups sets by `routine_exercise_id` at `routines/[id]/index.tsx:152-160`. A read-only preview reads the same two hooks and the same grouping. The prompt's "read-only" constraint is satisfiable with zero data work.
- **Net reframe: this is a UI + navigation feature, not a data feature.** The only real engineering surface is (1) where the preview screen lives, (2) re-pointing the row tap, (3) sharing the existing start flow + its guards, and (4) the e2e blast-radius (every existing start-from-routine e2e taps the row to START).

## Scope summary
Re-point the Workout-tab routine-row tap from "start the session now" to "open a read-only preview of the routine (exercises + per-set target reps/weight)"; add a "Start workout" button in that preview that invokes the SAME existing `useStartSessionFromRoutine` mutation + the same `pendingRoutineId`/`hasActive`/seed-failure guards that `workout/index.tsx:60-83` runs today. Lives entirely on the Workout tab (`app/(app)/workout/`) and the routines route group; no DB/migration/RLS change.

## Affected files (verified)

### In-scope — WILL change
- `app/(app)/workout/index.tsx:60-83,142-150` — `startFromRoutine` (the immediate-start handler) + the `<RoutineListItem onPress>` wiring. The row tap must navigate to the preview instead of starting. The start LOGIC + its guards must move/be-shared with the preview screen (see §4). The `startAdHocWorkout` "Quick start workout" button (`:47-58,114-118,132-136`) is UNCHANGED. The `pendingRoutineId` guard (`:32,65-66,81`) and `hasActive` (`:45,147`) are load-bearing — see §4/§6.
- `src/components/routine-list-item.tsx:40-57` — the main Pressable's `accessibilityLabel` is hard-coded `"Start workout: ${routine.name}"` (`:43`). If the tap now opens a preview, this label is semantically wrong ("View routine: X" / "Preview routine: X"). **CAUTION: this exact label is the e2e selector for the start flow** (`tests/e2e/routine-strong-builder.spec.ts:212,217,272,319,420,486` use `[aria-label^="Start workout: ..."]`). Changing it without updating those specs breaks 5 tests — see §7.

### Likely NEW (the central design fork — see §2)
- `app/(app)/routines/[id]/preview.tsx` — read-only preview screen + "Start workout" button (Option (a), recommended). OR a reuse-the-editor mode in `routines/[id]/index.tsx` (Option (b)). OR a modal/bottom-sheet (Option (c)).
- A read-only routine-set/exercise presentation component (the existing `<RoutineExerciseCard>` is edit-only — see §2). Possibly a new `src/components/read-only-routine-exercise-card.tsx` + a `RoutineExerciseSetRow` presenter, mirroring the History `<ReadOnlyExerciseBlock>`/`<ReadOnlySetRow>` precedent (see §2, Existing precedents).
- Possibly a shared start-from-routine hook (`useStartRoutineFlow`) if the start logic must serve BOTH a preview-start AND any future direct-start — see §4.
- `tests/e2e/routine-strong-builder.spec.ts` — the 5 start-from-routine tests need a preview→Start step inserted (see §7). Possibly a new `tests/e2e/routine-preview.spec.ts` for the preview itself.

### Read-only — VERIFIED, must NOT change
- `src/hooks/use-sessions.ts:73-99` — `useStartSessionFromRoutine`. The preview's Start button REUSES this verbatim; do NOT reimplement the hard-fail seed policy (`:85-91`) or its `onSuccess` cache writes (`:93-97`).
- `src/api/routine-exercise-sets.ts:225-381` — `seedSetsForSession` (the seed). Reused as-is.
- `src/api/routine-exercises.ts:50-61`, `src/api/routine-exercise-sets.ts:53-69` — the read queries the preview reuses. No change.
- `src/db/types.ts:187-223` — `RoutineRow`, `RoutineExerciseRow`, `RoutineExerciseSetRow`, `RoutineExerciseEntry`. No new column.
- `app/(app)/workout/[sessionId].tsx` — the live session screen. The Start button still `router.replace`s here. No change.
- `src/components/routine-exercise-card.tsx` — the EDIT card (see §2: not read-only-able as-is).

## Section 1 — current navigation + start flow (pinned exactly)
1. **Initial-settle guard.** `workout/index.tsx:37-43` returns a spinner while `active.isLoading` so the start handlers' `active.data` check has no race window (the "MAJ-NEW-1 fix" comment).
2. **`hasActive`** = `!!active.data` (`:45`); rows are `disabled={hasActive}` (`:147`); `<RoutineListItem>` renders dimmed + non-interactive when disabled (`routine-list-item.tsx:34-41`).
3. **`startAdHocWorkout`** (`:47-58`): if active → `router.push(/workout/{active.id})`; else `start.mutateAsync({})` → `router.replace(/workout/{id})`. The "Quick start workout" button (`:114-118,132-136`).
4. **`startFromRoutine`** (`:60-83`): if active → `router.push(/workout/{active.id})` (`:61-63`); `pendingRoutineId` in-flight guard blocks re-entry (`:65-66`, cleared in `finally` `:80-81`); `startFromRoutineMut.mutateAsync({routine_id, name})` (`:68-71`); on success `router.replace(/workout/{row.id})` (`:72`); on seed failure the `catch` (`:73-79`) keeps the user on the routines list — the orphan empty session stays in History (MAJ-2 hard-fail policy, documented at `use-sessions.ts:58-71`).
5. **`useStartSessionFromRoutine`** (`use-sessions.ts:73-99`): `startSession({routine_id, name})` then `seedSetsForSession({session_id, routine_id, user_id})` with NO try/catch (seed errors propagate). `onSuccess` writes `active` cache + invalidates sessions + `["sets", row.id]`.

## Section 2 — WHERE the preview screen lives (the central design fork)
Enumerated options, including the cheap middle, with a recommendation.

### Option (a) — NEW route, read-only preview screen + new read-only components. **RECOMMENDED.**
- Route: `app/(app)/routines/[id]/preview.tsx` (sibling of the existing `routines/[id]/index.tsx`). The routines stack is headerless (`routines/_layout.tsx:1-5`, `<Stack screenOptions={{ headerShown: false }}>`), so the preview owns its own `<Stack.Screen options={{ headerShown: true, title }} />` like the editor does (`routines/[id]/index.tsx:168`).
- Row tap → `router.push('/(app)/routines/{id}/preview')`. Start button inside → reuse start flow → `router.replace('/(app)/workout/{sessionId}')`.
- Data: reuse `useRoutineExercises(id)` + `useRoutineExerciseSets(id)` + the `routines/[id]/index.tsx:152-160` grouping verbatim.
- Read-only rendering: the existing `<RoutineExerciseCard>` is **edit-only** — every set is a `<SetEditorRow>` with `<TextInput>` weight/reps cells (`routine-exercise-card.tsx:347-409`), move/trash controls, an add-set menu (`:226-288`), and a rest field (`:411-448`). It is NOT trivially read-only-able. So Option (a) implies a NEW read-only card (mirror of History's `<ReadOnlyExerciseBlock>`/`<ReadOnlySetRow>`).
- **Tradeoff:** + clean separation (preview is read-only by construction; no `isEditing` branching inside a 339-line editor); + the Start button + its guards live on a dedicated screen; + the URL `/routines/{id}/preview` is e2e-addressable. − one new screen + one new read-only card component (≈ the History read-only triad's effort, which already shipped).
- Confidence the read-only render is straightforward: **HIGH** — the per-cell presenters are pure (`displayWeight`/`displayReps`, `src/utils/set-display.ts:41-60`) and reusable directly on `target_weight`/`target_reps` (they take a raw `string|null` / `number|null`).

### Option (b) — REUSE the editor screen with a read-only/preview MODE. **Viable cheap middle; second choice.**
- Add an `isEditing` toggle to `routines/[id]/index.tsx` (default OFF = preview) + a "Start workout" button, exactly mirroring the History detail screen's screen-level toggle (`history/[id].tsx:78-81`: `const [isEditing, setIsEditing] = useState(false)`, default read-only, flipped by a header Pencil→Done). One screen serves view+edit+start, very Strong-like.
- **Feasibility verdict (FACT, read the editor):** the editor is a `react-hook-form` form (`routines/[id]/index.tsx:72-96`) with Save/Delete buttons, an `<ExercisePicker>` (`:324-336`), and edit-only `<RoutineExerciseCard>`s. To make it read-only you'd still need to swap `<RoutineExerciseCard>` for a read-only card (the card has no read-only mode), suppress the form/Save/Add/Delete, and add a Start button — so Option (b) does NOT actually save the new-read-only-card cost; it adds mode-branching INSIDE the editor on top of it. The History precedent shows the toggle pattern works, but History had a clean read-only-block already; the routine editor does not.
- **Tradeoff:** + one screen, no new route; + Strong-style "preview that you can flip to edit". − heavier mode-branching in an already-busy 339-line screen; − the row tap would land on the editor route (`/routines/{id}`), colliding semantically with the existing "Edit" affordance (`workout/index.tsx:146`) which ALSO goes to `/routines/{id}` — you'd lose the view/edit distinction unless you pass a query param (`?mode=preview`).
- Confidence: **MEDIUM** — works, but does not reduce the component cost vs (a) and muddies the editor.

### Option (c) — bottom-sheet / modal preview over the Workout list. **Not recommended.**
- A modal over `workout/index.tsx` showing the read-only routine + Start.
- **Tradeoff:** − no addressable URL (breaks the e2e pattern of waiting on a route); − the app's existing modals (`<ExercisePicker>`, `<ConfirmDelete>`) are small confirmation surfaces, not full scrollable exercise lists — no precedent for a sheet this large; − Strong itself uses a full-screen preview, not a sheet. − still needs the read-only card.
- Confidence this is the wrong fit: **HIGH**.

**Recommendation: Option (a)** — new `routines/[id]/preview.tsx` + a new read-only routine card, with the Start button reusing the existing start flow. It is the cleanest, most addressable, and the read-only render cost is unavoidable in (a) and (b) alike. **Confidence: MEDIUM-HIGH** — (b) is a legitimate fallback if the owner wants the Strong-style "preview flips to edit" single-screen; that is a product call (Unknown U1).

## Section 3 — data + hook feeding the preview (NO new query/migration)
- `useRoutine(id)` (`src/hooks/use-routines.ts`) → `RoutineRow` (name/notes) for the header.
- `useRoutineExercises(id)` → `RoutineExerciseEntry[]` = `RoutineExerciseRow & { exercise: ExerciseRow }`. Per entry: `exercise.name`, `exercise.equipment` (via `formatEquipment`, used in the editor `routine-exercise-card.tsx:144`), `exercise.muscles`, `target_rest_seconds`, `position` (already ordered ASC by the query `routine-exercises.ts:58`).
- `useRoutineExerciseSets(id)` → `RoutineExerciseSetRow[]`: `set_number`, `set_type` (`warmup`/`working`/`dropset`), `target_reps` (`number|null`), `target_weight` (`string|null`, numeric kg), `parent_set_id` (dropset chaining). Ordered `set_number ASC` (`routine-exercise-sets.ts:61`).
- Grouping: `setsByExercise = Map<routine_exercise_id, RoutineExerciseSetRow[]>` — copy `routines/[id]/index.tsx:152-160` verbatim.
- **Unit:** weights are stored canonical kg as `string` (`target_weight: numeric(6,2)`). The preview should display via the user's `useWeightUnit()` preference (`history/[id].tsx:24,57`) through `displayWeight(target_weight, unit)` (`set-display.ts:41-50`). `displayReps(target_reps)` (`:57-60`) for reps.

## Section 4 — the Start button = the existing start flow (what must be shared, not reimplemented)
The preview's "Start workout" must run the IDENTICAL logic as `startFromRoutine` (`workout/index.tsx:60-83`):
- `useStartSessionFromRoutine().mutateAsync({ routine_id, name })` (the seed + hard-fail policy live in the hook `use-sessions.ts:73-99` — DO NOT duplicate).
- The `pendingRoutineId` in-flight guard (`:32,65-66,80-81`) — the idempotency e2e (`routine-strong-builder.spec.ts:303-340`) double-taps and asserts exactly ONE session; this guard MUST survive on the Start button.
- The `active.data` guard (`:61-63`) — if a session is already active, route to it instead of starting a new one (see §6).
- On success: `router.replace('/(app)/workout/{row.id}')`. On seed-failure: the `catch` (`:73-79`) keeps the user where they are (orphan session stays in History).
- **Where the shared logic should live (Unknown U2):**
  - (i) Keep it in the preview's component (move the ~20-line handler there). Simplest; single remaining caller.
  - (ii) Extract a `useStartRoutineFlow()` hook returning `{ start(routine), pending, hasActive }` that both the preview AND (if a direct-start ever returns) the Workout list can call. Cleaner if there are two callers.
  - **Recommendation:** since the row tap NO LONGER starts directly (it previews), the ONLY remaining start site is the preview's button — so the simplest correct answer is to MOVE the handler to the preview screen (option i) and DELETE `startFromRoutine` from `workout/index.tsx`. A shared hook (ii) is only worth it if the owner wants to keep a direct-start affordance too (see U3). **Confidence: MEDIUM** — depends on U3 (does direct-start survive).

## Section 5 — navigation + affordance changes (scope)
Current row (`workout/index.tsx:142-150`): main Pressable (`onPress=startFromRoutine`, a11y "Start workout: X") + "Edit" Pressable (`onEditPress` → `/routines/{id}`).

Proposed:
- **Main `onPress`** → `router.push('/(app)/routines/{id}/preview')` (Option a). The a11y label `routine-list-item.tsx:43` should change from `"Start workout: ${name}"` to e.g. `"View routine: ${name}"` / `"Preview routine: ${name}"` — **but this is the e2e selector** (§7). Decide the label + update the specs together.
- **"Edit" affordance** (`workout/index.tsx:146`, `routine-list-item.tsx:58-69`) → KEEP, still → `/routines/{id}` (the editor). Unknown: should the PREVIEW screen also offer an "Edit" jump to the builder? Strong does. Low-cost (a header button → `router.push('/routines/{id}')`). See U4.
- **"Quick start workout" ad-hoc button** (`workout/index.tsx:114-118,132-136`) → UNCHANGED (it's not routine-based).
- **`disabled={hasActive}`** on the row (`:147`): today rows are disabled when a session is active. With preview-then-start, should rows still be disabled (can't even preview during an active session), or should preview always be reachable and only the Start button route-to-active? See U5/§6.

## Section 6 — active-session / edge cases (spell out)
- **Active session exists.** Today: tapping a routine `router.push`es to the live session (`:61-63`) AND rows are `disabled={hasActive}` (`:147`) — i.e. the rows are dimmed and the push-to-live is effectively dead code (disabled rows don't fire `onPress`, `routine-list-item.tsx:41`). For preview: **option A** keep rows disabled during an active session (no preview while one runs — matches today's "can't start a second session"); **option B** allow preview but the Start button, on tap, routes to the active session (mirrors `startFromRoutine`'s `active.data` branch). Recommend matching today's behavior (rows disabled when active) for the row, AND keep the `active.data` guard in the preview's Start handler as defense-in-depth (a session could become active while the preview is open). See U5.
- **Empty routine (no exercises / no sets).** The editor renders "No exercises yet" (`routines/[id]/index.tsx:229-234`) and per-exercise "No sets yet" (`routine-exercise-card.tsx:218-223`). The preview needs equivalent empty copy. Starting an empty routine seeds zero sets (`seedSetsForSession` inserts nothing) → a valid empty live session. Decide: disable Start on an empty routine, or allow it (current direct-start allows it). Recommend allow (parity with today). See U6.
- **Soft-deleted exercises.** `listRoutineExercises` filters `deleted_at IS NULL` (`routine-exercises.ts:57`) for the routine_exercises join; `listRoutineExerciseSetsForRoutine` filters the same (`routine-exercise-sets.ts:60`). So a routine_exercise that was soft-deleted won't appear in the preview — consistent with the editor. An exercise whose underlying `exercises` row was soft-deleted but whose routine_exercise is still active: the inner `exercise:exercises(*)` join still returns it (History uses `useAllExercises` precisely to show `(deleted)`, but the routine editor uses the filtered join and does not special-case it). The seed (`seedSetsForSession` step 1, `routine-exercise-sets.ts:233-242`) inner-joins active `routine_exercises`, so it seeds whatever the preview shows. Low risk; mirror the editor. See U7.

## Relevant conventions (verified by reading code)
- **Routes are file-based (expo-router).** `routines/[id]/preview.tsx` would be a new route under the headerless `routines` stack (`routines/_layout.tsx:1-5`); the screen owns its own `<Stack.Screen options={{ headerShown: true }} />` like the editor (`routines/[id]/index.tsx:168`) — FACT.
- **Screen-level read-only/edit toggle precedent.** History detail flips `isEditing` (default read-only) via a header Pencil→Done and swaps `<ExerciseBlock>` ↔ `<ReadOnlyExerciseBlock>` (`history/[id].tsx:78-81`, imports `:15,17`) — FACT, the direct precedent for Option (b).
- **Read-only render = pure presenters + dedicated components.** `src/utils/set-display.ts` (`presentReadOnlySetRow` `:101-125`, `presentReadOnlyExerciseBlock` `:150-174`, `displayWeight` `:41-50`, `displayReps` `:57-60`) feed `<ReadOnlySetRow>`/`<ReadOnlyExerciseBlock>`. The set-display helpers are pure + unit-tested (vitest picks up only `tests/unit/**/*.test.ts`, `set-display.ts:15-16`) — FACT.
- **In-flight guard idiom.** `pendingRoutineId` state mirrors `pickingId` (`workout/index.tsx:30-32`) — FACT. Must persist on the Start button.
- **`router.replace` to the live session** (so back doesn't return to the start surface) — `workout/index.tsx:54,72`; History uses the same to bounce in-progress sessions to the live screen (`history/[id].tsx:92-96`) — FACT.

## Constraints
- **Data**: NONE new. Reads existing `routines` / `routine_exercises` / `routine_exercise_sets` / `exercises` via existing RLS-scoped hooks. No migration, no RLS, no FK change. (FACT — §1, §3.)
- **UI**: NativeWind classes; `<Stack.Screen>` per-screen header; the row's two-sibling-Pressables a11y contract (`routine-list-item.tsx:19-26` — RN-Web forbids nested interactive elements). Dark-mode classes throughout.
- **Platform**: e2e runs RN-Web (`page.goto`, `aria-label` selectors). A new route must be web-addressable (favors Option a; rules out Option c). No native-only API involved.
- **Auth**: same authed Supabase session; `seedSetsForSession` re-reads `auth.getUser()` (`routine-exercise-sets.ts:87-89`) and the hook re-checks user (`use-sessions.ts:77-79`).
- **Performance**: two existing `useQuery`s (exercises + sets); the editor already pays this cost. No new hot path.

## Existing precedents
- **History read-only triad** — `<ReadOnlyExerciseBlock>` (`src/components/read-only-exercise-block.tsx`) + `<ReadOnlySetRow>` (`src/components/read-only-set-row.tsx`) + `set-display.ts` presenters. This is the 1:1 template for the preview's read-only render — BUT note it operates on `SetRow` (session sets: `weight`/`reps`/`completed_at`/`rpe`), NOT `RoutineExerciseSetRow` (`target_weight`/`target_reps`, no completed/rpe). So `displayWeight`/`displayReps` are reusable directly; `presentReadOnlySetRow` and the components are a structural PRECEDENT to mirror, not a drop-in (the preview has no checkmark/RPE/notes-glyph columns). (FACT — read both files.)
- **History screen-level edit toggle** — `history/[id].tsx:78-81` (the direct precedent for Option b).
- **The editor itself** — `routines/[id]/index.tsx` shows the exact hooks + grouping (`:58-68,152-160`) the preview reuses, and `<RoutineExerciseCard>` shows the (edit-only) rendering the read-only card mirrors.
- **The Strong-builder seed-on-start flow** — already wired end-to-end (`use-sessions.ts:73-99` + `seedSetsForSession`); the preview's Start button is a NEW caller of an EXISTING flow, not new logic.

## Close-the-set: start-session affordances (exhaustive-by-construction)
Grep `Start workout|startSession\(|useStartSession|startFromRoutine|seedSetsForSession` across `app/` + `src/`:

| Site | What it does | In scope? |
|---|---|---|
| `workout/index.tsx:60-83,145` `startFromRoutine` + row `onPress` | start-from-routine (immediate) | YES — re-point to preview |
| `workout/index.tsx:47-58,116,134` `startAdHocWorkout` + Quick-start | ad-hoc start (no routine) | NO — unchanged |
| `routine-list-item.tsx:43` a11y "Start workout: X" | the row's label (= e2e selector) | YES — label + specs |
| `src/api/sessions.ts:38` `startSession` | the create primitive | NO — reused as-is |

**Verdict (FACT — grep):** there is exactly ONE start-FROM-ROUTINE affordance in the entire app (the `<RoutineListItem>` row, consumed only at `workout/index.tsx:143`) and exactly ONE ad-hoc start. No editor/verdict/other screen starts a session. The preview screen is greenfield; the Start button is the ONLY thing that must inherit `startFromRoutine`'s guards. No N+1th start site exists.

## Section 7 — tests & conventions (the load-bearing blast-radius)
- **`tests/e2e/routine-strong-builder.spec.ts` — 5 tests tap the row to START and WILL break.** Each does `page.locator('[aria-label^="Start workout: <Name>"]').first().click()` then asserts a live-session outcome:
  - Test 1 golden (`:208-247`): click → `waitForURL(/\/workout\/[0-9a-f-]+/)` → assert 3 seeded sets.
  - Test 2 dropset (`:253-297`): click → live → assert parent_set_id.
  - Test 3 idempotency (`:303-340`): **double-click** → assert exactly ONE session (the `pendingRoutineId` guard).
  - Test 5 edit-then-start (`:407-449`): click → live → soft-delete a routine set → assert live sets unchanged.
  - Test 6 seed-fail (`:455-511`): click → `expect(page.url()).toMatch(/\/workout\/?$/)` (stays on the bare Workout home) + orphan session + zero sets.
  - **Impact:** with tap→preview, each test must insert "tap row → land on preview → click 'Start workout' button in preview → THEN waitForURL". The idempotency double-tap and the in-flight guard move onto the preview's Start button. The seed-fail URL assertion (`:493`, expects bare `/workout`) changes: after preview→Start fails, the user is on the PREVIEW route (`/routines/{id}/preview`), not `/workout` — so that assertion must be re-pinned (or the Start handler must `router.back()` to the list on failure — a design call, U9). **This is the single highest-impact downstream change.** (FACT — read all 5 tests.)
  - If the a11y label changes (e.g. "View routine: X"), the selectors `[aria-label^="Start workout: ..."]` must change too — but they'd then select the ROW (preview nav), and a NEW selector is needed for the preview's "Start workout" button.
- **New e2e** likely warranted: a `routine-preview.spec.ts` asserting the preview renders the routine's exercises + per-set targets read-only and that Start begins the session.
- **Unit tests:** minimal pure logic (mostly UI/nav). If a new `presentRoutineSetRow` presenter is added for `target_*`, it is unit-testable like `set-display.ts` (vitest `tests/unit/**/*.test.ts`). The existing `set-display` unit tests are the precedent.
- **No other e2e taps a routine to start** (the `/\/workout/` grep across `tests/e2e/` returned only sign-in landings elsewhere, not routine-row taps). (FACT.)

## Unknowns (ranked by design impact)

- **U1 — preview screen approach: NEW route (a) vs reuse-editor-with-mode (b) vs modal (c)?** (a) what: where the read-only preview lives. (b) why: defines the whole feature's surface — new screen + new read-only card (a), or mode-branching inside the 339-line editor + new read-only card (b), or a modal with no addressable URL (c). (c) recommend (a) new `routines/[id]/preview.tsx` — cleanest, e2e-addressable, read-only-card cost is unavoidable in both (a)/(b); (b) is the fallback if the owner wants the Strong-style "preview flips to edit" single screen. **Confidence: MEDIUM-HIGH. HUMAN/product call.**
- **U2 — where the start logic lives: move handler into the preview (i) vs extract `useStartRoutineFlow` hook (ii)?** (a) what: the shared start-flow location. (b) why: avoids duplicating the `pendingRoutineId`/`active.data`/seed-fail guards. (c) recommend (i) move the ~20-line handler to the preview + delete `startFromRoutine` from the list, since the row no longer starts — UNLESS a direct-start survives (U3), in which case (ii). **Confidence: MEDIUM (depends on U3).**
- **U3 — does a direct-"start now" affordance survive anywhere?** (a) what: whether the user can still start a routine without previewing first (e.g. a long-press, or a Start button on the row). (b) why: Strong's default is preview-only; but power users may want one-tap start. If yes → the shared hook (U2.ii) is warranted. (c) recommend preview-only (matches Strong + the prompt). **Confidence: MEDIUM. HUMAN call.**
- **U4 — does the preview screen offer an "Edit" jump to the builder?** (a) what: a header button → `/routines/{id}`. (b) why: Strong's preview has it; the row's existing "Edit" affordance already exists, so it may feel redundant. (c) recommend YES (low cost, a header Pressable) for parity with the editor's header pattern. **Confidence: MEDIUM.**
- **U5 — row + Start behavior during an active session.** (a) what: are routine rows still `disabled={hasActive}` (no preview while active), or always previewable with the Start button routing to the active session? (b) why: today rows are disabled when active (`:147`) and the push-to-live is dead code behind it. (c) recommend keep rows disabled when active (parity), AND keep the `active.data` guard in the preview's Start handler as defense. **Confidence: MEDIUM.**
- **U6 — Start on an empty routine (no exercises/sets).** (a) what: disable Start, or allow starting an empty session? (b) why: current direct-start allows it (seeds zero sets → valid empty live session). (c) recommend allow (parity with today); show empty copy in the preview. **Confidence: MEDIUM.**
- **U7 — soft-deleted exercise handling in the preview.** (a) what: how the preview treats a routine_exercise whose underlying `exercises` row was soft-deleted. (b) why: the routine editor uses the filtered `exercise:exercises(*)` inner join and does not special-case it; History uses `useAllExercises` to show `(deleted)`. (c) recommend mirror the EDITOR (filtered join, no special-case) since the seed reads the same join — keeps preview ≡ what-gets-seeded. **Confidence: MEDIUM-HIGH.**
- **U8 — the a11y label on the row.** (a) what: "Start workout: X" → "View routine: X" / "Preview routine: X"? (b) why: it is BOTH the screen-reader label AND the e2e selector for 5 tests. (c) recommend "View routine: X" + update the 5 specs to add the preview→Start step and a new Start-button selector. **Confidence: HIGH (mechanical, but must be coordinated).**
- **U9 — seed-failure landing from the preview.** (a) what: on seed failure inside the preview's Start, does the user stay on the preview, or `router.back()` to the list? (b) why: test 6 asserts the bare `/workout` URL today; the preview lands the user on `/routines/{id}/preview`. (c) recommend stay on the preview with an error message (consistent with the editor's `console.warn` pattern), and re-pin test 6's URL assertion to the preview route. **Confidence: MEDIUM.**

## Out-of-scope flags
- NO migration / schema / RLS change — the data already exists.
- NOT changing the routine EDITOR's behavior or `<RoutineExerciseCard>` (read-only render is a NEW component, not a refactor of the editor's card).
- NOT changing `startAdHocWorkout` ("Quick start workout").
- NOT changing `useStartSessionFromRoutine` / `seedSetsForSession` (the Start button is a new CALLER, the flow is unchanged).
- NOT adding edit capability to the preview (read-only by the prompt; an "Edit" jump to the existing builder is the most that's in scope, U4).
- Spinner-on-pending and richer Strong-style preview chrome (rest timers, supersets) are follow-up unless the owner scopes them in.
