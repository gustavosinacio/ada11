# Design v1 — Routine preview-then-start (Strong-style)

Run-id: `2026-06-04_1700_routine-preview-start`
Round: Design ↔ Validate round 1
Inputs: `discovery.md`, `state.md` (LOCKED decisions under "Follow-up clarifications"), `docs/feedback/designer.md`.

## Summary

Re-point the Workout-tab routine row from "start the session now" to "open a read-only PREVIEW
of the routine", add a "Start workout" button to that preview, and remove the one-tap direct-start.
This is a **UI + navigation feature only** — three load-bearing invariants:

- **NO migration / schema / RLS change.** The preview reads the exact data the editor already loads.
- **NO new query.** Reuse `useRoutine` + `useRoutineExercises` + `useRoutineExerciseSets` and the
  editor's grouping verbatim (`routines/[id]/index.tsx:152-160`).
- **The start flow is UNCHANGED.** `useStartSessionFromRoutine` (`use-sessions.ts:73-99`) and
  `seedSetsForSession` are not touched. The preview's Start button is a **new CALLER** of the
  identical flow; the ~20-line handler **moves** out of `workout/index.tsx:60-83` into the preview
  (per LOCKED U2.i — since no direct-start survives, there is exactly one caller, so a move is
  correct and no shared hook is introduced).

## Approach

1. **New read-only preview screen** `app/(app)/routines/[id]/preview.tsx` (sibling of the editor
   `routines/[id]/index.tsx`, under the headerless routines stack `routines/_layout.tsx:4`). It
   owns its own `<Stack.Screen options={{ headerShown: true, title: routine.name }} />` exactly as
   the editor does (`routines/[id]/index.tsx:168`). It loads the same three hooks the editor uses,
   groups sets by `routine_exercise_id` with the editor's exact reducer, and renders each exercise
   with a **new read-only card**. It has a "Start workout" `<Button>` at the bottom and a header
   "Edit" `<Pressable>` → the builder.
2. **New read-only card component** `src/components/read-only-routine-exercise-card.tsx`. The editor's
   `<RoutineExerciseCard>` is edit-only (every set is a `<TextInput>` row + move/trash + add-set
   menu, `routine-exercise-card.tsx:347-409`) and is **NOT** made read-only (LOCKED #1). The new
   card mirrors the History read-only precedent (`<ReadOnlyExerciseBlock>`/`<ReadOnlySetRow>` +
   `set-display.ts`) but on `RoutineExerciseEntry` + `RoutineExerciseSetRow` (targets), not
   `SetRow` (logged sets — no completed/rpe/notes columns).
3. **Nav rerouting.** `<RoutineListItem>`'s main Pressable now navigates to the preview instead of
   starting. The row's separate "Edit" affordance is REMOVED (the preview is the hub); the row
   becomes a single Pressable (LOCKED #2/#4). The a11y label changes "Start workout: {name}" →
   "View routine: {name}".
4. **Moved Start handler.** The full `startFromRoutine` handler — `useStartSessionFromRoutine`
   mutation + the `pendingRoutineId` in-flight guard + the `active.data` guard + the seed-failure
   `catch` + `router.replace('/(app)/workout/{sessionId}')` — moves from `workout/index.tsx:60-83`
   into the preview screen, wired to the Start button. ALL THREE guards are preserved (see Contracts).
5. **Edit jump.** A header "Edit" Pressable in the preview → `router.push('/(app)/routines/{id}')`
   (the existing builder), mirroring the History header-button pattern (`history/[id].tsx:299-308`).

This is **Option (a)** from Discovery §2, the human-locked choice (U1). Option (b) reuse-editor-with-mode
and Option (c) modal are rejected below.

## Exact file changes

| # | Path | Type | Responsibility (one each) |
|---|------|------|---------------------------|
| F1 | `app/(app)/routines/[id]/preview.tsx` | **new** | The read-only preview screen: load data, render read-only cards, host the moved Start handler + Edit jump. |
| F2 | `src/components/read-only-routine-exercise-card.tsx` | **new** | Render ONE routine exercise + its per-set targets, read-only. The History read-only triad mirrored onto routine targets. |
| F3 | `app/(app)/workout/index.tsx` | **edited** | Re-point the row tap to the preview; DELETE `startFromRoutine` + `pendingRoutineId` + their now-unused imports/props; drop the row's Edit wiring. |
| F4 | `src/components/routine-list-item.tsx` | **edited** | Collapse to a single Pressable → preview; drop `onEditPress`/`pending`; relabel a11y "View routine: {name}". |
| F5 | `tests/e2e/routine-strong-builder.spec.ts` | **edited** | Insert a preview→Start step (new Start-button selector) into the 5 row-tap tests; re-pin test 6's URL assertion. |
| F6 | `tests/unit/set-display.test.ts` (or a new `tests/unit/read-only-routine-card.test.ts`) | **edited/new** | Unit cases only IF a new pure presenter is added (see Test plan — likely none; reuse `displayWeight`/`displayReps`). |

### F1 — `app/(app)/routines/[id]/preview.tsx` (new)

Anchors it mirrors: editor data load (`routines/[id]/index.tsx:53-68`), grouping (`:152-160`),
header pattern (`:168`, `history/[id].tsx:299-308`), the moved handler (`workout/index.tsx:60-83`),
the empty-states (`routines/[id]/index.tsx:229-234` exercise-level, `read-only-set-row` set-level).

- `const { id } = useLocalSearchParams<{ id: string }>();`
- Hooks: `useRouter()`, `useRoutine(id)` (header title), `useRoutineExercises(id)`,
  `useRoutineExerciseSets(id)`, `useActiveSession()`, `useStartSessionFromRoutine()`,
  `useWeightUnit()` (`~/hooks/use-preferences`), `useColorScheme()`.
- `const [pendingRoutineId, setPendingRoutineId] = useState<string | null>(null);` (moved from
  `workout/index.tsx:32`).
- Initial-settle guard: while `active.isLoading` render a centered `<ActivityIndicator />` so the
  Start handler's `active.data` check has no race window — same precedent as `workout/index.tsx:37-43`
  (MAJ-NEW-1 fix).
- Loading/error branches mirror the editor (`routines/[id]/index.tsx:128-146`), each with a
  `<Stack.Screen options={{ title: "Routine", headerShown: true }} />`.
- Grouping (verbatim from `routines/[id]/index.tsx:152-160`):
  ```ts
  const setsByExercise = (() => {
    const map = new Map<string, RoutineExerciseSetRow[]>();
    for (const s of setsQ.data ?? []) {
      const list = map.get(s.routine_exercise_id) ?? [];
      list.push(s);
      map.set(s.routine_exercise_id, list);
    }
    return map;
  })();
  ```
- Render: a `<ScrollView>` (matching the editor's container) →
  - exercise list: `entries.length === 0` → centered empty copy
    `"No exercises in this routine yet."`; else `entries.map(entry => <ReadOnlyRoutineExerciseCard
    key={entry.id} entry={entry} sets={setsByExercise.get(entry.id) ?? []} unit={unit} />)`.
  - bottom Start `<Button label="Start workout" onPress={onStart} loading={startMut.isPending} />`
    (see Contracts for the exact handler). Allowed on an empty routine (LOCKED U6 — parity).
- Header: `<Stack.Screen options={{ title: routine.data?.name ?? "Routine", headerShown: true,
  headerRight: () => <Pressable onPress={() => router.push('/(app)/routines/' + id)}
  accessibilityLabel="Edit routine" accessibilityRole="button" className="px-3 py-1"><Text
  className="text-base font-medium text-blue-500">Edit</Text></Pressable> }} />` — mirrors
  `history/[id].tsx:299-308`.

### F2 — `src/components/read-only-routine-exercise-card.tsx` (new)

Mirrors `<ReadOnlyExerciseBlock>` (`read-only-exercise-block.tsx`) structurally, on routine targets:

- Header: exercise name `<Text>` + the muscles·equipment subline, reusing the editor's exact
  formula (`routine-exercise-card.tsx:140-149`): `[muscles.length>0 ? muscles.join(", ") : null,
  formatEquipment(entry.exercise.equipment)].filter(Boolean).join(" · ")`. `formatEquipment` is
  exported from `~/db/types` (used at `routine-exercise-card.tsx:12`). U7: mirror the editor — no
  `(deleted)` special-case; the filtered `exercise:exercises(*)` join is what gets seeded.
- A column-header strip ("# / Weight ({unit}) / Reps") shown only when `sets.length > 0`, dropping
  History's check/RPE/trash spacers (this card has no check/RPE/notes columns).
- Per-set rows: `sets.map(s => <set row>)`. Each row renders, **read-only text only**:
  - set-type badge (W / • / ↓) reusing the `TYPE_BADGE` shape from `read-only-set-row.tsx:29-33`,
  - dropset parent reference "↳N" via a `set_id → set_number` map (same pattern as
    `read-only-exercise-block.tsx:46-52,117-122`),
  - `set_number`,
  - `displayWeight(s.target_weight, unit)` (`set-display.ts:41-50` — takes `string | null`, exactly
    `RoutineExerciseSetRow.target_weight`'s type),
  - `displayReps(s.target_reps)` (`set-display.ts:57-60` — takes `number | null`, exactly
    `target_reps`'s type).
- Empty state: `sets.length === 0` → italic `"No sets configured."`.

### F3 — `app/(app)/workout/index.tsx` (edited)

- DELETE `startFromRoutine` (`:60-83`) entirely (moved to F1).
- DELETE `const [pendingRoutineId, setPendingRoutineId] = useState<string|null>(null);` (`:30-32`) —
  no longer used here (the in-flight guard now lives in the preview).
- DELETE `const startFromRoutineMut = useStartSessionFromRoutine();` (`:28`) and remove
  `useStartSessionFromRoutine` from the import on `:17-21` (it moves to F1). `useStartSession` and
  `useActiveSession` STAY (used by `startAdHocWorkout` + `hasActive`).
- `renderItem` (`:142-150`) becomes:
  ```tsx
  <RoutineListItem
    routine={item}
    onPress={() => router.push(`/(app)/routines/${item.id}/preview`)}
    disabled={hasActive}
  />
  ```
  Drops `onEditPress` and `pending`. (See Risk R-3 for the `disabled={hasActive}` decision.)
- `startAdHocWorkout` (`:47-58`) + the Quick-start `<Button>` (`:114-118,132-136`): UNCHANGED.
- `hasActive` (`:45`) STAYS.

### F4 — `src/components/routine-list-item.tsx` (edited)

- Remove the `onEditPress` and `pending` props from `Props` (`:9,16`) and the signature (`:30,32`).
  Keep `routine`, `onPress`, `disabled`.
- Remove the `pending` → `effectivelyDisabled` OR (`:34`): now just `const effectivelyDisabled =
  disabled;` (keep the dim-when-active visual).
- Remove the trailing Edit `<Pressable>` block (`:58-69`) and the `Pencil` import (`:1`).
- The chevron is now always shown (the `onEditPress ? null : <ChevronRight/>` ternary at `:56`
  collapses to just `<ChevronRight color="#9ca3af" size={18} />`).
- a11y label (`:43`): `"Start workout: ${routine.name}"` → `"View routine: ${routine.name}"`.
- The two-sibling-Pressable / nested-interactive caution in the doc comment (`:19-26`) is now moot
  (single Pressable); simplify the comment accordingly.

### F5 / F6 — see Test plan.

### Confirmed NO change (fenced out of scope)

`useStartSessionFromRoutine` (`use-sessions.ts:73-99`) · `seedSetsForSession`
(`routine-exercise-sets.ts:225-381`) · the read queries `listRoutineExercises` /
`listRoutineExerciseSetsForRoutine` · the editor `routines/[id]/index.tsx` · `<RoutineExerciseCard>`
(`routine-exercise-card.tsx`) · `startAdHocWorkout` / `useStartSession` · the live session screen
`workout/[sessionId].tsx` · `db/types.ts` (no new column) · any migration / RLS.

## Contracts (exact)

### Preview data loading (F1)

- `useRoutine(id)` → `RoutineRow | undefined` — `.data?.name` for the header title.
- `useRoutineExercises(id)` → `RoutineExerciseEntry[]` where `RoutineExerciseEntry =
  RoutineExerciseRow & { exercise: ExerciseRow }` (`routine-exercises.ts:4`). Ordered `position ASC`
  by the query (`:58`). Per entry the card reads `entry.exercise.name`, `entry.exercise.muscles:
  string[]`, `entry.exercise.equipment: string | null`.
- `useRoutineExerciseSets(id)` → `RoutineExerciseSetRow[]` (`db/types.ts:210-223`): `id`,
  `routine_exercise_id`, `set_number: number`, `set_type: SetType`, `target_reps: number | null`,
  `target_weight: string | null`, `parent_set_id: string | null`. Ordered `set_number ASC` (`:61`).
- Grouped shape: `Map<routine_exercise_id, RoutineExerciseSetRow[]>` (verbatim reducer above).

### `<ReadOnlyRoutineExerciseCard>` props (F2)

```ts
type Props = {
  entry: RoutineExerciseEntry;        // from ~/api/routine-exercises
  sets: RoutineExerciseSetRow[];      // pre-grouped, set_number ASC
  unit: WeightUnit;                   // from useWeightUnit()
};
```

No callbacks (read-only by construction — the type signature forbids any mutation affordance,
mirroring `<ReadOnlyExerciseBlock>`'s no-mutation contract). `set_id → set_number` map is built
internally for the dropset "↳N" reference (same as `read-only-exercise-block.tsx:46-52`).

### Moved Start handler (F1) — ALL THREE guards preserved

This is the verbatim relocation of `workout/index.tsx:60-83`, parameterized to the single routine
the preview is viewing (`routine.data`). Flag-for-the-Validator #2 — every guard must survive:

```ts
const onStart = async () => {
  const r = routine.data;
  if (!r) return;                                   // routine not loaded yet
  // Guard A — active-session routing (workout/index.tsx:61-63). LOCKED U5:
  // route to the ACTIVE session instead of starting a second one.
  if (active.data) {
    router.push(`/(app)/workout/${active.data.id}`);
    return;
  }
  // Guard B — in-flight idempotency (workout/index.tsx:65-66,80-81). The
  // double-tap e2e (test 3) asserts exactly one session; this guard MUST
  // survive on the Start button.
  if (pendingRoutineId) return;
  setPendingRoutineId(r.id);
  try {
    const row = await startMut.mutateAsync({ routine_id: r.id, name: r.name });
    router.replace(`/(app)/workout/${row.id}`);     // success → live session
  } catch (err) {
    // Guard C — seed-fail hard-fail (workout/index.tsx:73-79). LOCKED U9:
    // STAY on the preview with the warn; do NOT router.back(). The orphan
    // empty session remains in History (use-sessions.ts:58-71 policy).
    console.warn("Start failed", err);
  } finally {
    setPendingRoutineId(null);
  }
};
```

- Guard A (active routing): mirrors today's `:61-63` push-to-live, preserving the
  single-active-session invariant. The `active.isLoading` settle-gate (F1) closes the race window.
- Guard B (in-flight): `pendingRoutineId` state moves here verbatim.
- Guard C (seed-fail): the `catch` keeps the user on `/routines/{id}/preview` and warns; the
  mutation's hard-fail policy (`use-sessions.ts:85-91`, no try/catch around seed) is unchanged.

### `<RoutineListItem>` new prop shape (F4)

```ts
type Props = {
  routine: RoutineRow;
  onPress?: () => void;     // now → router.push(preview), never starts
  disabled?: boolean;       // dim + non-interactive when a session is active
};
```

`onEditPress` is **deleted** (the row no longer offers Edit — the preview is the hub, LOCKED #4).
`pending` is **deleted** — the row no longer starts anything, so there is no in-flight state to
reflect; the in-flight `pending` visual now lives on the preview's Start `<Button>` via its own
`loading={startMut.isPending}`. `disabled` is KEPT (the row stays dimmed during an active session —
see R-3).

## Close-the-set (grep-verified)

**Every consumer of `<RoutineListItem>`** — `import { RoutineListItem }` appears ONLY at
`workout/index.tsx:13`; the component is rendered ONLY at `workout/index.tsx:143` (the FlatList
`renderItem`). No other screen imports or renders it. So changing its prop shape (drop
`onEditPress`/`pending`) touches exactly one call site (F3). **Flag-for-the-Validator #1: re-grep
`RoutineListItem` across `app/` + `src/` to confirm this is the only consumer.**

**Every place that starts-from-routine** — Discovery's grep
(`Start workout|startSession\(|useStartSession|startFromRoutine|seedSetsForSession`) found exactly
ONE start-from-routine affordance (the `<RoutineListItem>` row → `startFromRoutine` at
`workout/index.tsx:60-83,145`) and one ad-hoc start (`startAdHocWorkout`, unchanged). After this
change the ONLY start-from-routine caller is the preview's Start button (F1). No editor/verdict/
history/other screen starts a session.

**Removing `startFromRoutine` / `pendingRoutineId` / `startFromRoutineMut` from `workout/index.tsx`
orphans nothing else** — within that file: `startFromRoutine` is referenced only at `:145`
(the row `onPress`, being re-pointed); `pendingRoutineId` only at `:32` (decl), `:65-66`/`:81`
(inside the handler being moved), `:148` (the row `pending` prop, being dropped);
`startFromRoutineMut` only at `:28` (decl) + `:68` (inside the handler being moved). After the move
all references leave with the handler. `useStartSession`/`useActiveSession`/`hasActive` are still
used by the ad-hoc path and stay.

**`<RoutineExerciseCard>` consumers** — imported/rendered only by the editor
(`routines/[id]/index.tsx:18,237`). The new read-only card is a SEPARATE component (F2); the editor's
card is untouched, so no card consumer is affected.

## Edge cases / behaviors to test

| # | Behavior | Expected |
|---|----------|----------|
| E1 | Tap a routine row | Navigates to `/routines/{id}/preview` — does NOT start a session. |
| E2 | Preview renders | Each exercise + its per-set targets (set_type badge, #, weight in user unit, reps) read-only; no `<TextInput>`/trash/add. |
| E3 | Start → success | Seeds via the unchanged flow → `router.replace('/workout/{sessionId}')` → live session with the seeded sets. |
| E4 | Start while a session is active (Guard A) | Routes to `/workout/{active.id}` (the existing session); no second session created. |
| E5 | Empty routine (no exercises / no sets) | Preview shows the empty copy; Start is allowed → seeds zero sets → valid empty live session (parity, U6). |
| E6 | Soft-deleted underlying exercise | Mirrors the editor (filtered join, no `(deleted)` special-case); preview ≡ what-gets-seeded (U7). |
| E7 | Header "Edit" tap | `router.push('/routines/{id}')` → the builder. |
| E8 | Row no longer starts (regression guard) | Tapping the row never reaches `/workout/{id}` directly; only the preview's Start does. |
| E9 | Seed-fail from preview (Guard C) | User stays on `/routines/{id}/preview`; orphan empty session in History; zero sets written. |
| E10 | Double-tap Start (Guard B) | Exactly ONE session (the `pendingRoutineId` guard on the Start button). |

## Risks & alternatives

### Risks (per-risk Confidence / Risk)

- **R-1 — e2e a11y-label selector coupling (the load-bearing test risk).** The 5 row-tap tests
  select `[aria-label^="Start workout: <Name>"]` to click the ROW. After F4 the row's label is
  "View routine: {name}", so that selector now (correctly) selects the row → opens the preview, and
  a NEW selector is needed for the preview's Start button. The design ADOPTS the safe option in the
  contract (per the feedback lesson): the Start button is a `<Button label="Start workout" />`,
  which renders `accessibilityRole="button"` (`button.tsx:48`) → a real `<button>` with
  `aria-label="Start workout"` on RN-Web — a **regular-text, query-able DOM handle of the exact
  shape the existing tests already use on `<RoutineListItem>`** (`getByLabel` / `[aria-label=...]`),
  not an SVG tick or a never-queried surface. The Tester queries `getByLabel("Start workout")` (or
  `[aria-label="Start workout"]`) inside the preview. **Confidence HIGH / Risk MEDIUM** (mechanical
  but must be coordinated across 5 tests; the seed-fail URL re-pin is the subtle one — see R-2).
- **R-2 — seed-fail URL assertion (test 6).** Today test 6 asserts `page.url()` matches
  `/\/workout\/?$/` (bare Workout home) because direct-start leaves the user on the list. With
  preview→Start, on seed failure the user stays on `/routines/{id}/preview` (LOCKED U9, Guard C).
  The assertion MUST be re-pinned to `/\/routines\/[0-9a-f-]+\/preview$/`. If left as-is the test
  ships a false-red. **Confidence HIGH / Risk MEDIUM** (named explicitly so the Tester re-pins it).
- **R-3 — the `disabled={hasActive}` decision (UX policy).** Today rows are `disabled={hasActive}`
  (`workout/index.tsx:147`) — dimmed + non-tappable while a session is active. **Decision: KEEP
  `disabled={hasActive}` on the row.** Rationale: (a) it preserves today's visible behavior (no
  surprise UX regression — the rows already look/behave this way during an active session); (b) it
  keeps the change minimal/navigation-only; (c) defense-in-depth — Guard A in the preview's Start
  handler STILL routes to the active session if a session becomes active while the preview is open
  (a session the user started in another tab), so the single-active-session invariant holds on both
  surfaces. LOCKED U5 left this to the Designer ("allowing preview is friendlier; your call"); I
  choose KEEP-disabled because it is the smaller, no-regression delta and the preview's reachability-
  while-active is not in the prompt. The friendlier always-previewable variant is parked
  (Alternative 4). **Confidence MEDIUM-HIGH / Risk LOW** (reversible one-line policy; either choice
  is safe because Guard A backstops the invariant).
- **R-4 — the moved handler losing a guard (data integrity / idempotency).** The single biggest
  correctness risk is the move dropping one of the three guards (A active-routing, B in-flight, C
  seed-fail). The Contracts section reproduces all three verbatim with their original file:line
  anchors and ties each to the e2e that proves it (E4/test1-2, E10/test3, E9/test6). **Flag-for-the-
  Validator #2.** **Confidence HIGH / Risk MEDIUM** (verbatim move; the e2e suite re-proves each guard).
- **R-5 — read-only card type drift.** `<ReadOnlySetRow>` takes a `SetRow` (logged: `weight`/`reps`/
  `completed_at`/`rpe`); the new card takes `RoutineExerciseSetRow` (targets: `target_weight:
  string|null`/`target_reps: number|null`, no completed/rpe/notes). It is a structural PRECEDENT,
  NOT a drop-in. `displayWeight`/`displayReps` ARE reusable as-is (their param types — `string|null`,
  `number|null` — match `target_weight`/`target_reps` exactly). **Confidence HIGH / Risk LOW**
  (the helpers are pure + unit-tested; the columns are a strict subset of History's).
- **R-6 — platform divergence (RN-Web e2e).** The new route must be web-addressable — `routines/[id]/
  preview.tsx` under expo-router file routing is (rules out the modal Option c). The Start button's
  `<button>` + `aria-label` render identically on web (the existing routine tests already rely on RN
  → web `<button>` mapping). No native-only API. **Confidence HIGH / Risk LOW.**
- **R-7 — performance.** Two existing `useQuery`s (exercises + sets) the editor already pays. No new
  hot path, no extra fetch (the preview and editor can even share the cached query results since
  they use the same query keys). **Confidence HIGH / Risk LOW.**
- **R-8 — back-stack UX after Start.** Start uses `router.replace` (not push) to the live session so
  the back button does not bounce the user back into the preview (mirrors `workout/index.tsx:72`
  and History's `:92-96` replace-to-live idiom). **Confidence HIGH / Risk LOW.**

### Alternatives considered

1. **Option (b) — reuse the editor with a read-only/preview mode** (Discovery §2b). Rejected: the
   editor's `<RoutineExerciseCard>` has no read-only mode, so (b) STILL needs the new read-only card
   AND adds mode-branching inside the 339-line form screen, AND the row tap would land on
   `/routines/{id}` colliding with the (now-removed) Edit affordance unless a query param is added.
   Also explicitly NOT the human-locked choice (U1 → new route).
2. **Option (c) — bottom-sheet/modal preview** (Discovery §2c). Rejected: no addressable URL (breaks
   the e2e route-wait pattern), no precedent for a full-screen scrollable sheet, still needs the
   read-only card. NOT the locked choice.
3. **Extract a `useStartRoutineFlow()` shared hook** (Discovery U2.ii). Rejected: with no direct-start
   surviving, the preview's button is the ONLY start-from-routine caller — a shared hook would have
   exactly one consumer. A move (U2.i, LOCKED) is correct and simpler; a hook adds an abstraction
   with no second caller to justify it.
4. **Always-previewable rows (drop `disabled={hasActive}`)** — friendlier (preview is harmless while
   active). Rejected for v1 as a scope-add beyond the prompt; Guard A already backstops the invariant
   if a session is active when Start is pressed. Parked under Out of scope.
5. **`router.back()` on seed-fail** (instead of staying on the preview). Rejected: LOCKED U9 says stay
   on the preview with an error surface; staying gives the user a Retry-able context and matches the
   editor's `console.warn` pattern. (Also: `router.back()` would re-introduce the bare-`/workout`
   assertion shape but lose the clearer error locality.)
6. **Make `<RoutineExerciseCard>` read-only via an `isEditing` prop** — rejected (LOCKED #1: do NOT
   make the editor card read-only; build a new card). It would bloat the 339-line card with branching.

## Out of scope

- Editor / `<RoutineExerciseCard>` refactor (the read-only render is a NEW component, not a refactor).
- `useStartSessionFromRoutine` / `seedSetsForSession` / the hard-fail policy — unchanged.
- `startAdHocWorkout` "Quick start workout" — unchanged.
- Migration / schema / RLS / new query.
- Strong-style preview chrome beyond exercises + per-set targets: rest timers, supersets, set-volume
  targets, reorder, inline edit.
- Always-previewable-while-active rows (Alternative 4) — parked.
- A spinner-on-row-pending (the row no longer starts, so there is no pending state to show on it).

## Test plan

### e2e — `tests/e2e/routine-strong-builder.spec.ts` (F5)

**Exactly 5 tests change** (1, 2, 3, 5, 6). Test 4 ("soft-delete then re-add") navigates DIRECTLY
to `/routines/{id}` (`spec:375`) and never taps the row — **no change**. Test 7
("duplicate-exercise") is pure DB, no UI — **no change**.

Each of tests 1, 2, 3, 5, 6 gets a **preview→Start insertion**: after the existing row-locator
click (which now opens the preview instead of starting), wait for the preview route, then click the
preview's Start button, THEN keep the existing live-session assertions.

- **Test 1 — golden path** (`spec:190-247`): the row click (`:217-219`) now opens the preview.
  Insert: `await page.waitForURL(/\/routines\/[0-9a-f-]+\/preview$/);` then `await
  page.getByLabel("Start workout").click();` then the existing `waitForURL(/\/workout\/[0-9a-f-]+/)`
  + the 3-seeded-sets assertions (unchanged — they prove the seed via admin).
- **Test 2 — dropset** (`spec:253-297`): same insertion after the row click (`:274-275`); existing
  parent_set_id assertion unchanged.
- **Test 3 — idempotency** (`spec:303-344`): the **double-tap moves to the Start button**. After the
  row click → preview, do `await Promise.all([startBtn.click(), startBtn.click().catch(()=>{})])`
  where `startBtn = page.getByLabel("Start workout")`. The `pendingRoutineId` guard (now on the
  preview) must still yield exactly ONE session (assertion unchanged). This test has TEETH: it asserts
  `count === 1` sessions AND `setCount === 1` seeded set — a real value, not a tick count.
- **Test 5 — edit-then-restart** (`spec:400-449`): same row-click→preview→Start insertion; the
  soft-delete + "live sets still 3" assertion unchanged.
- **Test 6 — seed-fail hard fail** (`spec:455-511`): the row click → preview → Start (the route
  intercept rejects the seed POST 500). **Re-pin the URL assertion** (`:493`): change
  `expect(page.url()).toMatch(/\/workout\/?$/)` → `expect(page.url()).toMatch(/\/routines\/[0-9a-f-]+\/preview$/)`
  (LOCKED U9 — the user stays on the preview). The orphan-session + zero-sets assertions
  (`:495-510`) are unchanged and keep their teeth (specific counts: 1 orphan session, 0 sets).

**New preview-specific e2e** (add to this spec or a new `routine-preview.spec.ts`):

- **P1 — tap row → preview renders targets (with teeth).** Seed a routine with a known set
  (e.g. reps 8, weight "60.00"). Sign in, click `[aria-label^="View routine: <Name>"]`, wait for the
  preview URL, then assert a SPECIFIC value on a real text surface: `await
  expect(page.getByText("60", { exact: true }).first()).toBeVisible()` (the displayed weight) and the
  exercise name visible. This asserts the read-only card actually rendered the target — a real value
  on a regular `<Text>` node, NOT an SVG tick (feedback lesson: real value + precedented handle). The
  empty-state spec (P1b, optional) seeds a routine with an exercise but no sets and asserts the
  "No sets configured." copy is visible.
- **P2 — Start from preview begins the session.** Click the preview's `getByLabel("Start workout")`,
  `waitForURL(/\/workout\/[0-9a-f-]+/)`, assert the seeded set exists via admin (subsumed by test 1's
  insertion, so P2 may be merged into test 1 rather than duplicated).
- **P3 — row no longer direct-starts (regression guard, E8).** After clicking the row, assert the URL
  is the preview route and NOT `/workout/{id}`: `await
  expect(page).toHaveURL(/\/routines\/[0-9a-f-]+\/preview$/)` before any Start click. This gives the
  "row stopped starting" behavior real teeth.
- **P4 — Edit jump (E7).** In the preview, click `getByLabel("Edit routine")`,
  `waitForURL(/\/routines\/[0-9a-f-]+$/)` (the builder, no `/preview` suffix), assert the editor's
  "Exercises" / "Save details" surface is visible.

### Unit tests (F6)

Likely **none new**: the preview reuses the existing PURE helpers `displayWeight`/`displayReps`
(`set-display.ts`), which already have unit coverage. The read-only card is JSX-only (no new pure
transform). IF the Implementer factors a `presentRoutineSetRow(s, unit)` presenter (optional, for
symmetry with `presentReadOnlySetRow`), it is unit-testable like `set-display.ts` and should get a
small `describe` block. The design does NOT require it — the two existing pure helpers cover the only
value-bearing logic. State this so the Implementer doesn't over-extract.

## What I most want the Validator to scrutinize

1. **Close-the-set on `<RoutineListItem>` consumers (Flag #1).** Re-grep `RoutineListItem` across
   `app/` + `src/` to confirm `workout/index.tsx:13,143` is the ONLY import + render. If a second
   consumer exists, dropping `onEditPress`/`pending` from the prop shape would break it — verify.
2. **The moved Start handler keeps ALL THREE guards (Flag #2, R-4).** Verify Guard A (active routing,
   `:61-63`), Guard B (`pendingRoutineId` in-flight, `:65-66,80-81`), and Guard C (seed-fail catch,
   `:73-79`) all survive the move into the preview, and that the e2e tests 3/6 re-prove B/C on the
   new Start-button surface.
3. **The e2e a11y-selector coupling + the seed-fail URL re-pin (R-1, R-2).** Confirm the new Start
   selector targets a real `<button>`/`aria-label` (not an SVG/never-queried surface) and that test
   6's `/\/workout\/?$/` assertion is re-pinned to the preview route — otherwise test 6 ships
   false-red.
